package expo.modules.tailmancesystemcalls

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.telecom.DisconnectCause
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.telecom.VideoProfile
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

private const val ACCOUNT_ID = "tailmance-calls-v1"
private const val EXTRA_CALL_ID = "tailmance.callId"
private const val EXTRA_CALLER_NAME = "tailmance.callerName"
private const val EXTRA_CALL_TYPE = "tailmance.callType"
private const val EXTRA_RECIPIENT_PET_ID = "tailmance.recipientPetId"
private const val EXTRA_USER_ID = "tailmance.userId"

class TailmanceSystemCallsModule : Module() {
  private fun context(): Context = appContext.reactContext ?: throw IllegalStateException("system_call_context_unavailable")
  private fun telecom(): TelecomManager = context().getSystemService(Context.TELECOM_SERVICE) as TelecomManager
  private fun accountHandle(): PhoneAccountHandle = PhoneAccountHandle(ComponentName(context(), TailmanceConnectionService::class.java), ACCOUNT_ID)
  private fun validUuid(raw: String): String = runCatching { UUID.fromString(raw).toString() }.getOrElse { throw IllegalArgumentException("system_call_invalid_id") }

  private fun configure(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    val manager = telecom()
    val handle = accountHandle()
    val existing = manager.ownSelfManagedPhoneAccounts.any { it == handle }
    if (!existing) {
      val account = PhoneAccount.builder(handle, "Tailmance")
        .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
        .build()
      manager.registerPhoneAccount(account)
    }
    return true
  }

  private fun callExtras(callId: String, callerName: String, callType: String, recipientPetId: String, userId: String): Bundle {
    if (callType != "audio" && callType != "video") throw IllegalArgumentException("system_call_invalid_type")
    val id = validUuid(callId)
    if (recipientPetId.isNotEmpty()) validUuid(recipientPetId)
    if (userId.isNotEmpty()) validUuid(userId)
    return Bundle().apply {
      putString(EXTRA_CALL_ID, id)
      putString(EXTRA_CALLER_NAME, callerName.take(80))
      putString(EXTRA_CALL_TYPE, callType)
      putString(EXTRA_RECIPIENT_PET_ID, recipientPetId)
      putString(EXTRA_USER_ID, userId)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("TailmanceSystemCalls")

    AsyncFunction("configureAsync") { configure() }
    AsyncFunction("drainActionsAsync") { TailmanceSystemCallStore.drain() }
    AsyncFunction("getVoipPushTokenAsync") { null as String? }

    AsyncFunction("reportIncomingCallAsync") { callId: String, callerName: String, callType: String, recipientPetId: String, userId: String ->
      if (!configure()) return@AsyncFunction false
      val manager = telecom()
      val handle = accountHandle()
      val normalizedId=validUuid(callId)
      if(TailmanceSystemCallStore.hasConnection(normalizedId))return@AsyncFunction true
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !manager.isIncomingCallPermitted(handle)) return@AsyncFunction false
      val extras = callExtras(normalizedId, callerName, callType, recipientPetId, userId)
      manager.addNewIncomingCall(handle, extras)
      true
    }

    AsyncFunction("reportOutgoingCallAsync") { callId: String, calleeName: String, callType: String ->
      if (!configure()) return@AsyncFunction false
      val manager = telecom()
      val handle = accountHandle()
      val outgoing = callExtras(callId, calleeName, callType, "", "")
      val extras = Bundle().apply {
        putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle)
        putInt(TelecomManager.EXTRA_START_CALL_WITH_VIDEO_STATE, if (callType == "video") VideoProfile.STATE_BIDIRECTIONAL else VideoProfile.STATE_AUDIO_ONLY)
        putBundle(TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS, outgoing)
      }
      manager.placeCall(Uri.fromParts("tailmance", "call", null), extras)
      true
    }

    AsyncFunction("reportCallConnectedAsync") { callId: String ->
      val id = validUuid(callId)
      TailmanceSystemCallStore.getConnection(id)?.setActive()
      true
    }

    AsyncFunction("reportCallEndedAsync") { callId: String, reason: String ->
      val id = validUuid(callId)
      val connection = TailmanceSystemCallStore.removeConnection(id)
      if (connection != null) {
        val cause = when (reason) {
          "declined" -> DisconnectCause(DisconnectCause.REJECTED)
          "failed" -> DisconnectCause(DisconnectCause.ERROR)
          "unanswered" -> DisconnectCause(DisconnectCause.MISSED)
          else -> DisconnectCause(DisconnectCause.LOCAL)
        }
        connection.setDisconnected(cause); connection.destroy()
      }
      true
    }
  }
}
