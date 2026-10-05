import ExpoModulesCore
import CoreML
import Vision
import CryptoKit

private let maxModelBytes: UInt64 = 256 * 1024 * 1024
private let maxImageBytes: UInt64 = 30 * 1024 * 1024
private let sha256Pattern = try! NSRegularExpression(pattern: "^[a-f0-9]{64}$")

// Vision can report a failure through the request completion handler and also throw from perform(_:).
// A checked continuation must be resumed exactly once, so every terminal branch claims this flag first.
private final class SingleResume {
  private let lock = NSLock()
  private var claimed = false
  func claim() -> Bool {
    lock.lock(); defer { lock.unlock() }
    if claimed { return false }
    claimed = true
    return true
  }
}

public class TailmanceEdgeAiModule: Module {
  private let cacheLock = NSLock()
  private var modelCache: [String: VNCoreMLModel] = [:]
  private var modelCacheOrder: [String] = []
  private let maxCachedModels = 2
  // Memo of already-hashed model files keyed by path, size and modification time (guarded by cacheLock),
  // so a warm inference does not re-read up to 256 MB just to prove the same file is unchanged.
  private var verifiedFileHashes: [String: String] = [:]

  private func localFileURL(_ uri: String, kind: String) throws -> URL {
    guard let url = URL(string: uri), url.isFileURL else {
      throw Exception(name: "EdgeAiInvalidUri", description: "edge_ai_\(kind)_uri_must_be_local_file")
    }
    let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isReadableKey, .fileSizeKey])
    guard values.isRegularFile == true, values.isReadable == true else {
      throw Exception(name: "EdgeAiUnreadableFile", description: "edge_ai_\(kind)_file_unreadable")
    }
    return url
  }

  private func fileSize(_ url: URL) throws -> UInt64 {
    let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
    return (attrs[.size] as? NSNumber)?.uint64Value ?? 0
  }

  private func sha256File(_ url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var hasher = SHA256()
    while true {
      let data = try handle.read(upToCount: 1024 * 1024) ?? Data()
      if data.isEmpty { break }
      hasher.update(data: data)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  private func sha256FileMemoized(_ url: URL, size: UInt64) throws -> String {
    let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate?.timeIntervalSince1970 ?? 0
    let key = "\(url.path)|\(size)|\(modified)"
    cacheLock.lock()
    let known = verifiedFileHashes[key]
    cacheLock.unlock()
    if let known { return known }
    let hash = try sha256File(url)
    cacheLock.lock()
    if verifiedFileHashes.count >= 8 { verifiedFileHashes.removeAll() }
    verifiedFileHashes[key] = hash
    cacheLock.unlock()
    return hash
  }

  private func validateExpectedHash(_ hash: String) throws -> String {
    let normalized = hash.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let range = NSRange(normalized.startIndex..<normalized.endIndex, in: normalized)
    guard sha256Pattern.firstMatch(in: normalized, range: range)?.range == range else {
      throw Exception(name: "EdgeAiInvalidHash", description: "edge_ai_model_sha256_invalid")
    }
    return normalized
  }

  private func verifiedModelURL(_ modelUri: String, expectedSha256: String) throws -> (URL, String) {
    let expected = try validateExpectedHash(expectedSha256)
    let url = try localFileURL(modelUri, kind: "model")
    let size = try fileSize(url)
    guard size > 0 && size <= maxModelBytes else {
      throw Exception(name: "EdgeAiInvalidModelSize", description: "edge_ai_model_size_invalid")
    }
    guard url.pathExtension.lowercased() == "mlmodel" else {
      throw Exception(name: "EdgeAiInvalidModelFormat", description: "edge_ai_ios_model_format_invalid")
    }
    let actual = try sha256FileMemoized(url, size: size)
    guard actual == expected else {
      throw Exception(name: "EdgeAiModelIntegrityMismatch", description: "edge_ai_model_integrity_mismatch")
    }
    return (url, actual)
  }

  private func visionModel(for modelURL: URL, sha256: String) async throws -> VNCoreMLModel {
    cacheLock.lock()
    let cached = modelCache[sha256]
    if cached != nil {
      modelCacheOrder.removeAll { $0 == sha256 }
      modelCacheOrder.append(sha256)
    }
    cacheLock.unlock()
    if let cached { return cached }

    // MLModel.compileModel writes into a temporary directory. Keep the compiled bundle in Caches (keyed by the
    // verified source hash) so a later launch or cache eviction does not recompile it, and never leave the
    // temporary copy behind.
    let fileManager = FileManager.default
    let cacheRoot = try compiledModelDirectory()
    let permanentURL = cacheRoot.appendingPathComponent("\(sha256).mlmodelc", isDirectory: true)
    if !fileManager.fileExists(atPath: permanentURL.path) {
      let temporaryURL = try await MLModel.compileModel(at: modelURL)
      defer { try? fileManager.removeItem(at: temporaryURL) }
      try? fileManager.removeItem(at: permanentURL)
      try fileManager.moveItem(at: temporaryURL, to: permanentURL)
    }
    let mlModel: MLModel
    do {
      mlModel = try MLModel(contentsOf: permanentURL)
    } catch {
      try? fileManager.removeItem(at: permanentURL)
      throw error
    }
    let visionModel = try VNCoreMLModel(for: mlModel)

    cacheLock.lock()
    modelCache[sha256] = visionModel
    modelCacheOrder.removeAll { $0 == sha256 }
    modelCacheOrder.append(sha256)
    while modelCacheOrder.count > maxCachedModels {
      let evicted = modelCacheOrder.removeFirst()
      modelCache.removeValue(forKey: evicted)
    }
    let keep = Set(modelCacheOrder.map { "\($0).mlmodelc" })
    cacheLock.unlock()
    pruneCompiledModels(keeping: keep)
    return visionModel
  }

  private func compiledModelDirectory() throws -> URL {
    let base = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let directory = base.appendingPathComponent("tailmance-edge-ai", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private func pruneCompiledModels(keeping keep: Set<String>) {
    guard let directory = try? compiledModelDirectory(),
          let entries = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else { return }
    for entry in entries where !keep.contains(entry) {
      try? FileManager.default.removeItem(at: directory.appendingPathComponent(entry))
    }
  }

  private func classify(model: VNCoreMLModel, imageURL: URL, maxResults: Int, threshold: Float) async throws -> [[String: Any]] {
    try await withCheckedThrowingContinuation { continuation in
      let once = SingleResume()
      let request = VNCoreMLRequest(model: model) { request, error in
        if let error { if once.claim() { continuation.resume(throwing: error) }; return }
        guard let observations = request.results as? [VNClassificationObservation] else {
          if once.claim() { continuation.resume(throwing: Exception(name: "EdgeAiUnexpectedModelOutput", description: "edge_ai_classifier_output_invalid")) }
          return
        }
        let rows: [[String: Any]] = observations
          .filter { $0.confidence >= threshold }
          .prefix(maxResults)
          .enumerated()
          .map { offset, observation in
            [
              "label": observation.identifier,
              "displayName": observation.identifier,
              "score": Double(observation.confidence),
              "index": offset
            ]
          }
        if once.claim() { continuation.resume(returning: rows) }
      }
      request.imageCropAndScaleOption = .centerCrop
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let handler = VNImageRequestHandler(url: imageURL, options: [:])
          try handler.perform([request])
        } catch {
          if once.claim() { continuation.resume(throwing: error) }
        }
      }
    }
  }

  public func definition() -> ModuleDefinition {
    Name("TailmanceEdgeAi")

    AsyncFunction("isRuntimeAvailableAsync") { true }

    AsyncFunction("clearModelCacheAsync") {
      self.cacheLock.lock()
      self.modelCache.removeAll()
      self.modelCacheOrder.removeAll()
      self.verifiedFileHashes.removeAll()
      self.cacheLock.unlock()
      self.pruneCompiledModels(keeping: [])
      return true
    }


    AsyncFunction("sha256FileAsync") { (fileUri: String) throws -> String in
      let url = try self.localFileURL(fileUri, kind: "artifact")
      let size = try self.fileSize(url)
      guard size > 0 && size <= maxModelBytes else {
        throw Exception(name: "EdgeAiInvalidArtifactSize", description: "edge_ai_artifact_size_invalid")
      }
      return try self.sha256File(url)
    }

    AsyncFunction("classifyImageAsync") { (modelUri: String, expectedSha256: String, imageUri: String, maxResults: Int, scoreThreshold: Double) async throws -> [String: Any] in
      guard (1...20).contains(maxResults) else {
        throw Exception(name: "EdgeAiInvalidMaxResults", description: "edge_ai_max_results_invalid")
      }
      guard scoreThreshold.isFinite && scoreThreshold >= 0 && scoreThreshold <= 1 else {
        throw Exception(name: "EdgeAiInvalidThreshold", description: "edge_ai_score_threshold_invalid")
      }
      let (modelURL, actualHash) = try self.verifiedModelURL(modelUri, expectedSha256: expectedSha256)
      let imageURL = try self.localFileURL(imageUri, kind: "image")
      let imageSize = try self.fileSize(imageURL)
      guard imageSize > 0 && imageSize <= maxImageBytes else {
        throw Exception(name: "EdgeAiInvalidImageSize", description: "edge_ai_image_size_invalid")
      }
      let model = try await self.visionModel(for: modelURL, sha256: actualHash)
      let categories = try await self.classify(model: model, imageURL: imageURL, maxResults: maxResults, threshold: Float(scoreThreshold))
      return [
        "runtime": "coreml-vision",
        "modelSha256": actualHash,
        "categories": categories
      ]
    }
  }
}
