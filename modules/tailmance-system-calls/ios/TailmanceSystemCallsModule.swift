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

public final class TailmanceSystemCallsModule: Module, CXProviderDelegate, PKPushRegistryDelegate {
  private var provider: CXProvider?
  private let callController = CXCallController()
  private var pushRegistry: PKPushRegistry?
  private let metadataLock = NSLock()
  private var callMetadata: [UUID: (recipientPetId: String, userId: String)] = [:]
  private let tokenDefaultsKey = "tailmance.voipPushToken"

  private func validatedUUID(_ raw: String) throws -> UUID {
    guard let value = UUID(uuidString: raw) else {
      throw Exception(name: "SystemCallInvalidId", description: "system_call_invalid_id")
    }
    return value
  }

  private func ensureConfigured() {
    if provider == nil {
      let config = CXProviderConfiguration(localizedName: "Tailmance")
      config.supportsVideo = true
      config.maximumCallGroups = 1
      config.maximumCallsPerCallGroup = 1
      config.supportedHandleTypes = [.generic]
      let next = CXProvider(configuration: config)
      next.setDelegate(self, queue: DispatchQueue.main)
      provider = next
    }
    if pushRegistry == nil {
      let registry = PKPushRegistry(queue: DispatchQueue.main)
      registry.delegate = self
      registry.desiredPushTypes = [.voIP]
      pushRegistry = registry
    }
  }

  private func rememberMetadata(callId: UUID, recipientPetId: String, userId: String) {
    metadataLock.lock(); defer { metadataLock.unlock() }
    callMetadata[callId] = (recipientPetId, userId)
  }

  private func removeMetadata(callId: UUID) -> (recipientPetId: String, userId: String)? {
    metadataLock.lock(); defer { metadataLock.unlock() }
    return callMetadata.removeValue(forKey: callId)
  }

  private func metadata(callId: UUID) -> (recipientPetId: String, userId: String)? {
    metadataLock.lock(); defer { metadataLock.unlock() }
    return callMetadata[callId]
  }

  private func queueAction(type: String, callId: UUID? = nil, recipientPetId: String? = nil, userId: String? = nil, token: String? = nil, error: String? = nil) {
    var payload = ["type": type]
    if let callId { payload["callId"] = callId.uuidString.lowercased() }
    if let recipientPetId, !recipientPetId.isEmpty { payload["recipientPetId"] = recipientPetId }
    if let userId, !userId.isEmpty { payload["userId"] = userId }
    if let token, !token.isEmpty { payload["token"] = token }
    if let error, !error.isEmpty { payload["error"] = error }
    TailmanceSystemCallActionStore.shared.append(payload)
  }

  private func reportIncoming(callId: UUID, callerName: String, callType: String, recipientPetId: String, userId: String, completion: @escaping (Error?) -> Void) {
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

  public func definition() -> ModuleDefinition {
    Name("TailmanceSystemCalls")

    AsyncFunction("configureAsync") { () async -> Bool in
      await MainActor.run { self.ensureConfigured() }
      return true
    }

    AsyncFunction("drainActionsAsync") { () -> [[String: String]] in
      TailmanceSystemCallActionStore.shared.drain()
    }

    AsyncFunction("getVoipPushTokenAsync") { () -> String? in
      UserDefaults.standard.string(forKey: self.tokenDefaultsKey)
    }

    AsyncFunction("reportIncomingCallAsync") { (callIdRaw: String, callerName: String, callType: String, recipientPetId: String, userId: String) async throws -> Bool in
      let callId = try self.validatedUUID(callIdRaw)
      guard callType == "audio" || callType == "video" else { throw Exception(name: "SystemCallInvalidType", description: "system_call_invalid_type") }
      guard !recipientPetId.isEmpty, !userId.isEmpty else { throw Exception(name: "SystemCallInvalidContext", description: "system_call_invalid_context") }
      return try await withCheckedThrowingContinuation { continuation in
        DispatchQueue.main.async {
          self.reportIncoming(callId: callId, callerName: callerName, callType: callType, recipientPetId: recipientPetId, userId: userId) { error in
            if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: true) }
          }
        }
      }
    }

    AsyncFunction("reportOutgoingCallAsync") { (callIdRaw: String, calleeName: String, callType: String) async throws -> Bool in
      let callId = try self.validatedUUID(callIdRaw)
      guard callType == "audio" || callType == "video" else { throw Exception(name: "SystemCallInvalidType", description: "system_call_invalid_type") }
      await MainActor.run { self.ensureConfigured() }
      let handle = CXHandle(type: .generic, value: "Tailmance")
      let action = CXStartCallAction(call: callId, handle: handle)
      action.isVideo = callType == "video"
      return try await withCheckedThrowingContinuation { continuation in
        self.callController.request(CXTransaction(action: action)) { error in
          if let error { continuation.resume(throwing: error); return }
          let update = CXCallUpdate()
          update.localizedCallerName = String(calleeName.prefix(80))
          update.remoteHandle = handle
          update.hasVideo = callType == "video"
          self.provider?.reportCall(with: callId, updated: update)
          continuation.resume(returning: true)
        }
      }
    }

    AsyncFunction("reportCallConnectedAsync") { (callIdRaw: String) throws -> Bool in
      let callId = try self.validatedUUID(callIdRaw)
      self.provider?.reportOutgoingCall(with: callId, connectedAt: Date())
      return true
    }

    AsyncFunction("reportCallEndedAsync") { (callIdRaw: String, reason: String) throws -> Bool in
      let callId = try self.validatedUUID(callIdRaw)
      let mapped: CXCallEndedReason
      switch reason {
      case "declined": mapped = .remoteEnded
      case "failed": mapped = .failed
      case "unanswered": mapped = .unanswered
      default: mapped = .remoteEnded
      }
      self.provider?.reportCall(with: callId, endedAt: Date(), reason: mapped)
      _ = self.removeMetadata(callId: callId)
      return true
    }
  }

  public func providerDidReset(_ provider: CXProvider) {
    metadataLock.lock(); callMetadata.removeAll(); metadataLock.unlock()
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
    else { completion(); return }
    reportIncoming(callId: callId, callerName: callerName, callType: callType, recipientPetId: recipientPetId, userId: userId) { _ in completion() }
  }
}
