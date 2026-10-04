import ExpoModulesCore
import CoreML
import Vision
import CryptoKit

private let maxModelBytes: UInt64 = 256 * 1024 * 1024
private let maxImageBytes: UInt64 = 30 * 1024 * 1024
private let sha256Pattern = try! NSRegularExpression(pattern: "^[a-f0-9]{64}$")

public class TailmanceEdgeAiModule: Module {
  private let cacheLock = NSLock()
  private var modelCache: [String: VNCoreMLModel] = [:]
  private var modelCacheOrder: [String] = []
  private let maxCachedModels = 2

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
    let actual = try sha256File(url)
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

    let compiledURL = try await MLModel.compileModel(at: modelURL)
    let mlModel = try MLModel(contentsOf: compiledURL)
    let visionModel = try VNCoreMLModel(for: mlModel)

    cacheLock.lock()
    modelCache[sha256] = visionModel
    modelCacheOrder.removeAll { $0 == sha256 }
    modelCacheOrder.append(sha256)
    while modelCacheOrder.count > maxCachedModels {
      let evicted = modelCacheOrder.removeFirst()
      modelCache.removeValue(forKey: evicted)
    }
    cacheLock.unlock()
    return visionModel
  }

  private func classify(model: VNCoreMLModel, imageURL: URL, maxResults: Int, threshold: Float) async throws -> [[String: Any]] {
    try await withCheckedThrowingContinuation { continuation in
      let request = VNCoreMLRequest(model: model) { request, error in
        if let error { continuation.resume(throwing: error); return }
        guard let observations = request.results as? [VNClassificationObservation] else {
          continuation.resume(throwing: Exception(name: "EdgeAiUnexpectedModelOutput", description: "edge_ai_classifier_output_invalid"))
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
        continuation.resume(returning: rows)
      }
      request.imageCropAndScaleOption = .centerCrop
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let handler = VNImageRequestHandler(url: imageURL, options: [:])
          try handler.perform([request])
        } catch {
          continuation.resume(throwing: error)
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
      self.cacheLock.unlock()
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
