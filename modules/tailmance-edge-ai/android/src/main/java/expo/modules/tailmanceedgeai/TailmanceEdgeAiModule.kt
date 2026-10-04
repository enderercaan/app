package expo.modules.tailmanceedgeai

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.imageclassifier.ImageClassifier
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.nio.channels.FileChannel
import java.security.MessageDigest
import kotlin.math.max

private const val MAX_MODEL_BYTES = 256L * 1024L * 1024L
private const val MAX_IMAGE_BYTES = 30L * 1024L * 1024L
private const val MAX_IMAGE_DIMENSION = 12_000
private const val TARGET_DECODE_EDGE = 2_048
private val SHA256_RE = Regex("^[a-f0-9]{64}$")

class TailmanceEdgeAiModule : Module() {
  private fun localFile(uriText: String, kind: String): File {
    val uri = Uri.parse(uriText)
    if (uri.scheme != "file") throw IllegalArgumentException("edge_ai_${kind}_uri_must_be_local_file")
    val path = uri.path ?: throw IllegalArgumentException("edge_ai_${kind}_uri_invalid")
    val file = File(path)
    if (!file.exists() || !file.isFile || !file.canRead()) throw IllegalArgumentException("edge_ai_${kind}_file_unreadable")
    return file
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
      while (true) {
        val count = input.read(buffer)
        if (count <= 0) break
        digest.update(buffer, 0, count)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private fun verifyModel(modelUri: String, expectedSha256: String): Pair<File, String> {
    val expected = expectedSha256.trim().lowercase()
    if (!SHA256_RE.matches(expected)) throw IllegalArgumentException("edge_ai_model_sha256_invalid")
    val file = localFile(modelUri, "model")
    val size = file.length()
    if (size <= 0L || size > MAX_MODEL_BYTES) throw IllegalArgumentException("edge_ai_model_size_invalid")
    val ext = file.extension.lowercase()
    if (ext !in setOf("tflite", "task")) throw IllegalArgumentException("edge_ai_android_model_format_invalid")
    val actual = sha256(file)
    if (!MessageDigest.isEqual(actual.toByteArray(Charsets.US_ASCII), expected.toByteArray(Charsets.US_ASCII))) {
      throw SecurityException("edge_ai_model_integrity_mismatch")
    }
    return file to actual
  }

  private fun decodeImage(imageUri: String): Bitmap {
    val file = localFile(imageUri, "image")
    val size = file.length()
    if (size <= 0L || size > MAX_IMAGE_BYTES) throw IllegalArgumentException("edge_ai_image_size_invalid")

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    val width = bounds.outWidth
    val height = bounds.outHeight
    if (width <= 0 || height <= 0 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      throw IllegalArgumentException("edge_ai_image_dimensions_invalid")
    }

    var sample = 1
    while (max(width / sample, height / sample) > TARGET_DECODE_EDGE) sample *= 2
    val options = BitmapFactory.Options().apply {
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    return BitmapFactory.decodeFile(file.absolutePath, options)
      ?: throw IllegalArgumentException("edge_ai_image_decode_failed")
  }

  override fun definition() = ModuleDefinition {
    Name("TailmanceEdgeAi")

    AsyncFunction("isRuntimeAvailableAsync") { true }

    AsyncFunction("clearModelCacheAsync") { true }

    AsyncFunction("sha256FileAsync") { fileUri: String ->
      val file = localFile(fileUri, "artifact")
      if (file.length() <= 0L || file.length() > MAX_MODEL_BYTES) throw IllegalArgumentException("edge_ai_artifact_size_invalid")
      sha256(file)
    }

    AsyncFunction("classifyImageAsync") { modelUri: String, expectedSha256: String, imageUri: String, maxResults: Int, scoreThreshold: Double ->
      if (maxResults !in 1..20) throw IllegalArgumentException("edge_ai_max_results_invalid")
      if (!scoreThreshold.isFinite() || scoreThreshold < 0.0 || scoreThreshold > 1.0) throw IllegalArgumentException("edge_ai_score_threshold_invalid")
      val (modelFile, actualHash) = verifyModel(modelUri, expectedSha256)
      val context = appContext.reactContext ?: throw IllegalStateException("edge_ai_context_unavailable")
      val bitmap = decodeImage(imageUri)
      var mpImage: com.google.mediapipe.framework.image.MPImage? = null
      var classifier: ImageClassifier? = null
      try {
        val mapped = FileInputStream(modelFile).channel.use { channel ->
          channel.map(FileChannel.MapMode.READ_ONLY, 0L, channel.size())
        }
        val baseOptions = BaseOptions.builder().setModelAssetBuffer(mapped).build()
        val options = ImageClassifier.ImageClassifierOptions.builder()
          .setBaseOptions(baseOptions)
          .setRunningMode(RunningMode.IMAGE)
          .setMaxResults(maxResults)
          .setScoreThreshold(scoreThreshold.toFloat())
          .build()
        classifier = ImageClassifier.createFromOptions(context, options)
        mpImage = BitmapImageBuilder(bitmap).build()
        val result = classifier.classify(mpImage)
        val categories = result.classificationResult().classifications()
          .flatMap { it.categories() }
          .sortedByDescending { it.score() }
          .take(maxResults)
          .map { category ->
            mapOf<String, Any?>(
              "label" to category.categoryName(),
              "displayName" to category.displayName(),
              "score" to category.score().toDouble(),
              "index" to category.index()
            )
          }
        mapOf<String, Any>(
          "runtime" to "mediapipe-tasks-vision",
          "modelSha256" to actualHash,
          "categories" to categories
        )
      } finally {
        mpImage?.close()
        classifier?.close()
        bitmap.recycle()
      }
    }
  }
}
