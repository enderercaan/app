package expo.modules.tailmancedeviceintegrity

import android.util.Base64
import android.os.Build
import android.os.Debug
import android.content.pm.ApplicationInfo
import java.io.File
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest
import java.security.SecureRandom
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

private suspend fun <T> com.google.android.gms.tasks.Task<T>.awaitResult(): T = suspendCoroutine { continuation ->
  addOnSuccessListener { continuation.resume(it) }
  addOnFailureListener { continuation.resumeWithException(it) }
}

class TailmanceDeviceIntegrityModule : Module() {
  @Volatile
  private var preparedProjectNumber: Long? = null
  @Volatile
  private var tokenProvider: StandardIntegrityManager.StandardIntegrityTokenProvider? = null

  private fun requestHash(value: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(digest, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
  }

  private fun localRiskSignals(): Map<String, Any> {
    val debuggerAttached = Debug.isDebuggerConnected() || Debug.waitingForDebugger()
    val fingerprint = Build.FINGERPRINT.lowercase()
    val model = Build.MODEL.lowercase()
    val product = Build.PRODUCT.lowercase()
    val hardware = Build.HARDWARE.lowercase()
    val emulatorOrSimulator = fingerprint.startsWith("generic") || fingerprint.contains("emulator") ||
      model.contains("google_sdk") || model.contains("emulator") || model.contains("android sdk built for") ||
      product.contains("sdk") || product.contains("emulator") || hardware.contains("goldfish") || hardware.contains("ranchu")
    val suspiciousRootPaths = arrayOf(
      "/system/bin/su", "/system/xbin/su", "/sbin/su", "/su/bin/su",
      "/system/app/Superuser.apk", "/system/app/Magisk.apk", "/data/adb/magisk"
    )
    val rootOrJailbreakHeuristic = (Build.TAGS?.contains("test-keys") == true) || suspiciousRootPaths.any { File(it).exists() }
    val context = appContext.reactContext
    val debugBuild = context != null && (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    return mapOf(
      "debuggerAttached" to debuggerAttached,
      "emulatorOrSimulator" to emulatorOrSimulator,
      "rootOrJailbreakHeuristic" to rootOrJailbreakHeuristic,
      "debugBuild" to debugBuild
    )
  }

  override fun definition() = ModuleDefinition {
    Name("TailmanceDeviceIntegrity")

    AsyncFunction("isAppAttestSupportedAsync") { false }
    AsyncFunction("generateAppAttestKeyAsync") {
      throw IllegalStateException("app_attest_ios_only")
    }
    AsyncFunction("attestAppAttestKeyAsync") { _: String, _: String ->
      throw IllegalStateException("app_attest_ios_only")
    }
    AsyncFunction("generateAppAttestAssertionAsync") { _: String, _: String ->
      throw IllegalStateException("app_attest_ios_only")
    }

    AsyncFunction("preparePlayIntegrityAsync") { cloudProjectNumber: String ->
      val projectNumber = cloudProjectNumber.toLongOrNull()
        ?: throw IllegalStateException("play_integrity_project_number_invalid")
      if (projectNumber <= 0L) throw IllegalStateException("play_integrity_project_number_invalid")

      if (preparedProjectNumber == projectNumber && tokenProvider != null) {
        return@AsyncFunction true
      }

      val context = appContext.reactContext ?: throw IllegalStateException("play_integrity_context_unavailable")
      val manager = IntegrityManagerFactory.createStandard(context)
      val request = StandardIntegrityManager.PrepareIntegrityTokenRequest.builder()
        .setCloudProjectNumber(projectNumber)
        .build()
      val provider = manager.prepareIntegrityToken(request).awaitResult()
      tokenProvider = provider
      preparedProjectNumber = projectNumber
      true
    }

    AsyncFunction("requestPlayIntegrityTokenAsync") { clientDataUtf8: String ->
      if (clientDataUtf8.length !in 32..4096) throw IllegalStateException("play_integrity_client_data_invalid")
      val provider = tokenProvider ?: throw IllegalStateException("play_integrity_not_prepared")
      val request = StandardIntegrityManager.StandardIntegrityTokenRequest.builder()
        .setRequestHash(requestHash(clientDataUtf8))
        .build()
      val response = provider.request(request).awaitResult()
      val token = response.token()
      if (token.isBlank()) throw IllegalStateException("play_integrity_token_empty")
      token
    }

    AsyncFunction("getLocalRiskSignalsAsync") {
      localRiskSignals()
    }

    AsyncFunction("generateSecureRandomBase64UrlAsync") { byteLength: Int ->
      if (byteLength !in 16..64) throw IllegalArgumentException("secure_random_length_invalid")
      val bytes = ByteArray(byteLength)
      SecureRandom().nextBytes(bytes)
      Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }
  }
}
