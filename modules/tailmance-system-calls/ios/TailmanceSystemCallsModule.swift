import ExpoModulesCore
import CallKit
import PushKit
import AVFAudio

private final class TailmanceSystemCallActionStore {
  static let shared = TailmanceSystemCallActionStore()
  private let lock = NSLock()
  private var actions: [[String: String]] = []

  func append(_ action: [String: String]) {
    lock.lock(); defer { lock.unlock() }
    actions.append(action)
    if actions.count > 64 { actions.removeFirst(actions.count - 64) }
  }

  func drain() -> [[String: String]] {
    lock.lock(); defer { lock.unlock() }
    let current = actions
    actions.removeAll(keepingCapacity: true)
    return current
  }
}

// The CallKit provider and the PushKit registry must exist from process launch: when a VoIP push wakes a
// terminated app, iOS delivers it to the registry that was created during launch, before any JavaScript
// (and therefore before any Expo module) runs. This singleton owns them so that the app-delegate subscriber
// below can create them at launch and the module can reuse the same instances afterwards.
public final class TailmanceCallCoordinator: NSObject, CXProviderDelegate, PKPushRegistryDelegate {
  public static let shared = TailmanceCallCoordinator()

  private let stateLock = NSLock()
  private var providerStorage: CXProvider?
  private var pushRegistry: PKPushRegistry?
  private var callMetadata: [UUID: (recipientPetId: String, userId: String)] = [:]
  private let tokenDefaultsKey = "tailmance.voipPushToken"
  let callController = CXCallController()

  // Safe to read from any thread; written once under the lock on the main thread.
  var provider: CXProvider? {
    stateLock.lock(); defer { stateLock.unlock() }
    return providerStorage
  }

  var storedVoipPushToken: String? {
    UserDefaults.standard.string(forKey: tokenDefaultsKey)
  }

  // Must run on the main thread.
  func ensureConfigured() {
    stateLock.lock()
    if providerStorage == nil {
      let config = CXProviderConfiguration(localizedName: "Tailmance")
      config.supportsVideo = true
      config.maximumCallGroups = 1
      config.maximumCallsPerCallGroup = 1
      config.supportedHandleTypes = [.generic]
      let next = CXProvider(configuration: config)
      next.setDelegate(self, queue: DispatchQueue.main)
      providerStorage = next
    }
    if pushRegistry == nil {
      let registry = PKPushRegistry(queue: DispatchQueue.main)
      registry.delegate = self
      registry.desiredPushTypes = [.voIP]
      pushRegistry = registry
    }
    stateLock.unlock()
  }

  func validatedUUID(_ raw: String) throws -> UUID {
    guard let value = UUID(uuidString: raw) else {
      throw Exception(name: "SystemCallInvalidId", description: "system_call_invalid_id")
    }
    return value
  }

  private func rememberMetadata(callId: UUID, recipientPetId: String, userId: String) {
    stateLock.lock(); defer { stateLock.unlock() }
    callMetadata[callId] = (recipientPetId, userId)
  }

  func removeMetadata(callId: UUID) -> (recipientPetId: String, userId: String)? {
    stateLock.lock(); defer { stateLock.unlock() }
    return callMetadata.removeValue(forKey: callId)
  }

  private func metadata(callId: UUID) -> (recipientPetId: String, userId: String)? {
    stateLock.lock(); defer { stateLock.unlock() }
    return callMetadata[callId]
  }

  func queueAction(type: String, callId: UUID? = nil, recipientPetId: String? = nil, userId: String? = nil, token: String? = nil, error: String? = nil) {
    var payload = ["type": type]
    if let callId { payload["callId"] = callId.uuidString.lowercased() }
    if let recipientPetId, !recipientPetId.isEmpty { payload["recipientPetId"] = recipientPetId }
    if let userId, !userId.isEmpty { payload["userId"] = userId }
    if let token, !token.isEmpty { payload["token"] = token }
    if let error, !error.isEmpty { payload["error"] = error }
    TailmanceSystemCallActionStore.shared.append(payload)
  }

  func reportIncoming(callId: UUID, callerName: String, callType: String, recipientPetId: String, userId: String, completion: @escaping (Error?) -> Void) {
    ensureConfigured()
    if metadata(callId: callId) != nil { completion(nil); return }
    rememberMetadata(callId: callId, recipientPetId: recipientPetId, userId: userId)
    let update = CXCallUpdate()
    update.localizedCallerName = String(callerName.prefix(80))
    update.remoteHandle = CXHandle(type: .generic, value: "Tailmance")
    update.hasVideo = callType == "video"
    update.supportsDTMF = false
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    provider?.reportNewIncomingCall(with: callId, update: update) { error in
      if let error {
        _ = self.removeMetadata(callId: callId)
        self.queueAction(type: "incoming_failed", callId: callId, recipientPetId: recipientPetId, userId: userId, error: error.localizedDescription)
      } else {
        self.queueAction(type: "incoming_reported", callId: callId, recipientPetId: recipientPetId, userId: userId)
      }
      completion(error)
    }
  }

  // iOS requires every VoIP push to be answered with a reported CallKit call; otherwise the system
  // terminates the app and eventually stops delivering VoIP pushes. A push we cannot use (malformed,
  // or a duplicate of a call already reported) therefore reports a placeholder call and ends it at once.
  private func reportPlaceholderCallAndEnd(completion: @escaping () -> Void) {
    ensureConfigured()
    let placeholderId = UUID()
    let update = CXCallUpdate()
    update.localizedCallerName = "Tailmance"
    update.remoteHandle = CXHandle(type: .generic, value: "Tailmance")
    update.hasVideo = false
    provider?.reportNewIncomingCall(with: placeholderId, update: update) { error in
      if error == nil {
        self.provider?.reportCall(with: placeholderId, endedAt: Date(), reason: .failed)
      }
      completion()
    }
  }

  public func providerDidReset(_ provider: CXProvider) {
    stateLock.lock(); callMetadata.removeAll(); stateLock.unlock()
    queueAction(type: "provider_reset")
  }

  public func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    let meta = metadata(callId: action.callUUID)
    queueAction(type: "answer", callId: action.callUUID, recipientPetId: meta?.recipientPetId, userId: meta?.userId)
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    let meta = removeMetadata(callId: action.callUUID)
    queueAction(type: "end", callId: action.callUUID, recipientPetId: meta?.recipientPetId, userId: meta?.userId)
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) { }
  public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) { }

  public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    UserDefaults.standard.set(token, forKey: tokenDefaultsKey)
    queueAction(type: "voip_token_updated", token: token)
  }

  public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    guard type == .voIP else { return }
    UserDefaults.standard.removeObject(forKey: tokenDefaultsKey)
    queueAction(type: "voip_token_invalidated")
  }

  public func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    guard type == .voIP else { completion(); return }
    let raw = payload.dictionaryPayload
    guard
      let callIdRaw = raw["callId"] as? String,
      let callId = UUID(uuidString: callIdRaw),
      let callerName = raw["callerPetName"] as? String,
      let callType = raw["callType"] as? String,
      (callType == "audio" || callType == "video"),
      let recipientPetId = raw["recipientPetId"] as? String,
      UUID(uuidString: recipientPetId) != nil,
      let userId = raw["userId"] as? String,
      UUID(uuidString: userId) != nil
    else { reportPlaceholderCallAndEnd(completion: completion); return }
    if metadata(callId: callId) != nil { reportPlaceholderCallAndEnd(completion: completion); return }
    reportIncoming(callId: callId, callerName: callerName, callType: callType, recipientPetId: recipientPetId, userId: userId) { _ in completion() }
  }
}

// Registered through expo-module.config.json (appDelegateSubscribers) so the provider and push registry are
// created during application launch, including a background launch caused by a VoIP push.
public final class TailmanceSystemCallsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    TailmanceCallCoordinator.shared.ensureConfigured()
    return true
  }
}

public final class TailmanceSystemCallsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TailmanceSystemCalls")

    AsyncFunction("configureAsync") { () async -> Bool in
      await MainActor.run { TailmanceCallCoordinator.shared.ensureConfigured() }
      return true
    }

    AsyncFunction("drainActionsAsync") { () -> [[String: String]] in
      TailmanceSystemCallActionStore.shared.drain()
    }

    AsyncFunction("getVoipPushTokenAsync") { () -> String? in
      TailmanceCallCoordinator.shared.storedVoipPushToken
    }

    AsyncFunction("reportIncomingCallAsync") { (callIdRaw: String, callerName: String, callType: String, recipientPetId: String, userId: String) async throws -> Bool in
      let callId = try TailmanceCallCoordinator.shared.validatedUUID(callIdRaw)
      guard callType == "audio" || callType == "video" else { throw Exception(name: "SystemCallInvalidType", description: "system_call_invalid_type") }
      guard !recipientPetId.isEmpty, !userId.isEmpty else { throw Exception(name: "SystemCallInvalidContext", description: "system_call_invalid_context") }
      return try await withCheckedThrowingContinuation { continuation in
        DispatchQueue.main.async {
          TailmanceCallCoordinator.shared.reportIncoming(callId: callId, callerName: callerName, callType: callType, recipientPetId: recipientPetId, userId: userId) { error in
            if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: true) }
          }
        }
      }
    }

    AsyncFunction("reportOutgoingCallAsync") { (callIdRaw: String, calleeName: String, callType: String) async throws -> Bool in
      let callId = try TailmanceCallCoordinator.shared.validatedUUID(callIdRaw)
      guard callType == "audio" || callType == "video" else { throw Exception(name: "SystemCallInvalidType", description: "system_call_invalid_type") }
      await MainActor.run { TailmanceCallCoordinator.shared.ensureConfigured() }
      let handle = CXHandle(type: .generic, value: "Tailmance")
      let action = CXStartCallAction(call: callId, handle: handle)
      action.isVideo = callType == "video"
      return try await withCheckedThrowingContinuation { continuation in
        TailmanceCallCoordinator.shared.callController.request(CXTransaction(action: action)) { error in
          if let error { continuation.resume(throwing: error); return }
          let update = CXCallUpdate()
          update.localizedCallerName = String(calleeName.prefix(80))
          update.remoteHandle = handle
          update.hasVideo = callType == "video"
          TailmanceCallCoordinator.shared.provider?.reportCall(with: callId, updated: update)
          continuation.resume(returning: true)
        }
      }
    }

    AsyncFunction("reportCallConnectedAsync") { (callIdRaw: String) throws -> Bool in
      let callId = try TailmanceCallCoordinator.shared.validatedUUID(callIdRaw)
      TailmanceCallCoordinator.shared.provider?.reportOutgoingCall(with: callId, connectedAt: Date())
      return true
    }

    AsyncFunction("reportCallEndedAsync") { (callIdRaw: String, reason: String) throws -> Bool in
      let callId = try TailmanceCallCoordinator.shared.validatedUUID(callIdRaw)
      let mapped: CXCallEndedReason
      switch reason {
      case "declined": mapped = .remoteEnded
      case "failed": mapped = .failed
      case "unanswered": mapped = .unanswered
      default: mapped = .remoteEnded
      }
      TailmanceCallCoordinator.shared.provider?.reportCall(with: callId, endedAt: Date(), reason: mapped)
      _ = TailmanceCallCoordinator.shared.removeMetadata(callId: callId)
      return true
    }
  }
}
