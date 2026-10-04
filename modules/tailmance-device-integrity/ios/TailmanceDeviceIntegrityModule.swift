import ExpoModulesCore
import DeviceCheck
import CryptoKit
import Darwin
import Security

public class TailmanceDeviceIntegrityModule: Module {
  private func hash(_ value: String) -> Data {
    Data(SHA256.hash(data: Data(value.utf8)))
  }

  private func debuggerAttached() -> Bool {
    var info = kinfo_proc()
    var mib = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    var size = MemoryLayout<kinfo_proc>.stride
    let status = sysctl(&mib, u_int(mib.count), &info, &size, nil, 0)
    return status == 0 && (info.kp_proc.p_flag & P_TRACED) != 0
  }

  private func localRiskSignals() -> [String: Any] {
    #if targetEnvironment(simulator)
    let simulator = true
    #else
    let simulator = false
    #endif
    #if DEBUG
    let debugBuild = true
    #else
    let debugBuild = false
    #endif
    let suspiciousPaths = [
      "/Applications/Cydia.app", "/Applications/Sileo.app", "/Library/MobileSubstrate/MobileSubstrate.dylib",
      "/bin/bash", "/usr/sbin/sshd", "/etc/apt", "/private/var/lib/apt"
    ]
    let pathHit = suspiciousPaths.contains { FileManager.default.fileExists(atPath: $0) }
    var writableOutsideSandbox = false
    let probe = "/private/tailmance_integrity_\(UUID().uuidString).tmp"
    do {
      try Data("tailmance".utf8).write(to: URL(fileURLWithPath: probe), options: .atomic)
      writableOutsideSandbox = true
      try? FileManager.default.removeItem(atPath: probe)
    } catch { }
    return [
      "debuggerAttached": debuggerAttached(),
      "emulatorOrSimulator": simulator,
      "rootOrJailbreakHeuristic": pathHit || writableOutsideSandbox,
      "debugBuild": debugBuild
    ]
  }

  public func definition() -> ModuleDefinition {
    Name("TailmanceDeviceIntegrity")

    AsyncFunction("isAppAttestSupportedAsync") {
      DCAppAttestService.shared.isSupported
    }

    AsyncFunction("generateAppAttestKeyAsync") { () async throws -> String in
      guard DCAppAttestService.shared.isSupported else { throw Exception(name: "AppAttestUnsupported", description: "app_attest_unsupported") }
      return try await DCAppAttestService.shared.generateKey()
    }

    AsyncFunction("attestAppAttestKeyAsync") { (keyId: String, clientDataUtf8: String) async throws -> String in
      guard DCAppAttestService.shared.isSupported else { throw Exception(name: "AppAttestUnsupported", description: "app_attest_unsupported") }
      let object = try await DCAppAttestService.shared.attestKey(keyId, clientDataHash: self.hash(clientDataUtf8))
      return object.base64EncodedString()
    }

    AsyncFunction("generateAppAttestAssertionAsync") { (keyId: String, clientDataUtf8: String) async throws -> String in
      guard DCAppAttestService.shared.isSupported else { throw Exception(name: "AppAttestUnsupported", description: "app_attest_unsupported") }
      let object = try await DCAppAttestService.shared.generateAssertion(keyId, clientDataHash: self.hash(clientDataUtf8))
      return object.base64EncodedString()
    }

    AsyncFunction("preparePlayIntegrityAsync") { (_: String) in false }
    AsyncFunction("requestPlayIntegrityTokenAsync") { (_: String) in throw Exception(name: "PlayIntegrityUnavailable", description: "play_integrity_android_only") }

    AsyncFunction("getLocalRiskSignalsAsync") {
      self.localRiskSignals()
    }

    AsyncFunction("generateSecureRandomBase64UrlAsync") { (byteLength: Int) throws -> String in
      guard byteLength >= 16 && byteLength <= 64 else {
        throw Exception(name: "SecureRandomInvalidLength", description: "secure_random_length_invalid")
      }
      var bytes = [UInt8](repeating: 0, count: byteLength)
      guard SecRandomCopyBytes(kSecRandomDefault, byteLength, &bytes) == errSecSuccess else {
        throw Exception(name: "SecureRandomFailed", description: "secure_random_failed")
      }
      return Data(bytes).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    }
  }
}
