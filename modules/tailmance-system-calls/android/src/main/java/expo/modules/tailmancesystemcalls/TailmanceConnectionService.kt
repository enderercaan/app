package expo.modules.tailmancesystemcalls

import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.DisconnectCause
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.telecom.VideoProfile
import java.util.UUID

private const val EXTRA_CALL_ID = "tailmance.callId"
private const val EXTRA_CALLER_NAME = "tailmance.callerName"
private const val EXTRA_CALL_TYPE = "tailmance.callType"
private const val EXTRA_RECIPIENT_PET_ID = "tailmance.recipientPetId"
private const val EXTRA_USER_ID = "tailmance.userId"

private data class CallContext(
  val callId: String,
  val callerName: String,
  val callType: String,
  val recipientPetId: String,
  val userId: String
)

private fun parseContext(extras: Bundle?): CallContext? {
  if (extras == null) return null
  val callId = extras.getString(EXTRA_CALL_ID)?.trim().orEmpty()
  val callerName = extras.getString(EXTRA_CALLER_NAME)?.trim().orEmpty().take(80)
  val callType = extras.getString(EXTRA_CALL_TYPE)?.trim().orEmpty()
  val recipientPetId = extras.getString(EXTRA_RECIPIENT_PET_ID)?.trim().orEmpty()
  val userId = extras.getString(EXTRA_USER_ID)?.trim().orEmpty()
  if (runCatching { UUID.fromString(callId) }.isFailure) return null
  if (callType != "audio" && callType != "video") return null
  if (recipientPetId.isNotEmpty() && runCatching { UUID.fromString(recipientPetId) }.isFailure) return null
  if (userId.isNotEmpty() && runCatching { UUID.fromString(userId) }.isFailure) return null
  return CallContext(callId, callerName.ifEmpty { "Tailmance" }, callType, recipientPetId, userId)
}

private class TailmanceConnection(private val context: CallContext, incoming: Boolean) : Connection() {
  init {
    setAudioModeIsVoip(true)
    setAddress(Uri.fromParts("tailmance", "call", null), TelecomManager.PRESENTATION_RESTRICTED)
    setCallerDisplayName(context.callerName, TelecomManager.PRESENTATION_ALLOWED)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) connectionProperties = PROPERTY_SELF_MANAGED
    videoState = if (context.callType == "video") VideoProfile.STATE_BIDIRECTIONAL else VideoProfile.STATE_AUDIO_ONLY
    if (incoming) setRinging() else setDialing()
  }

  private fun action(type: String) = buildMap {
    put("type", type)
    put("callId", context.callId)
    if (context.recipientPetId.isNotEmpty()) put("recipientPetId", context.recipientPetId)
    if (context.userId.isNotEmpty()) put("userId", context.userId)
  }

  override fun onAnswer(videoState: Int) { TailmanceSystemCallStore.enqueue(action("answer")); setActive() }
  override fun onAnswer() { TailmanceSystemCallStore.enqueue(action("answer")); setActive() }
  override fun onReject() {
    TailmanceSystemCallStore.enqueue(action("end"))
    setDisconnected(DisconnectCause(DisconnectCause.REJECTED))
    destroy(); TailmanceSystemCallStore.removeConnection(context.callId)
  }
  override fun onDisconnect() {
    TailmanceSystemCallStore.enqueue(action("end"))
    setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
    destroy(); TailmanceSystemCallStore.removeConnection(context.callId)
  }
  override fun onAbort() = onDisconnect()
}

class TailmanceConnectionService : ConnectionService() {
  override fun onCreateIncomingConnection(connectionManagerPhoneAccount: PhoneAccountHandle?, request: ConnectionRequest): Connection {
    val context = parseContext(request.extras) ?: return Connection.createFailedConnection(DisconnectCause(DisconnectCause.ERROR))
    val connection = TailmanceConnection(context, true)
    TailmanceSystemCallStore.putConnection(context.callId, connection)
    TailmanceSystemCallStore.enqueue(buildMap {
      put("type", "incoming_reported"); put("callId", context.callId)
      if (context.recipientPetId.isNotEmpty()) put("recipientPetId", context.recipientPetId)
      if (context.userId.isNotEmpty()) put("userId", context.userId)
    })
    return connection
  }

  override fun onCreateOutgoingConnection(connectionManagerPhoneAccount: PhoneAccountHandle?, request: ConnectionRequest): Connection {
    val context = parseContext(request.extras) ?: return Connection.createFailedConnection(DisconnectCause(DisconnectCause.ERROR))
    val connection = TailmanceConnection(context, false)
    TailmanceSystemCallStore.putConnection(context.callId, connection)
    return connection
  }

  override fun onCreateIncomingConnectionFailed(connectionManagerPhoneAccount: PhoneAccountHandle?, request: ConnectionRequest) {
    val context = parseContext(request.extras) ?: return
    TailmanceSystemCallStore.enqueue(mapOf("type" to "incoming_failed", "callId" to context.callId, "error" to "android_telecom_rejected"))
  }
}
