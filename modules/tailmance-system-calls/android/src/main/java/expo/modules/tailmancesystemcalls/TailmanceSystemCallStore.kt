package expo.modules.tailmancesystemcalls

import android.telecom.Connection
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue

object TailmanceSystemCallStore {
  private const val MAX_ACTIONS = 64
  private val actions = ConcurrentLinkedQueue<Map<String, String>>()
  private val connections = ConcurrentHashMap<String, Connection>()

  fun enqueue(action: Map<String, String>) {
    actions.add(action)
    while (actions.size > MAX_ACTIONS) actions.poll()
  }

  fun drain(): List<Map<String, String>> {
    val out = mutableListOf<Map<String, String>>()
    while (true) out.add(actions.poll() ?: break)
    return out
  }

  fun putConnection(callId: String, connection: Connection) { connections[callId] = connection }
  fun getConnection(callId: String): Connection? = connections[callId]
  fun hasConnection(callId: String): Boolean = connections.containsKey(callId)
  fun removeConnection(callId: String): Connection? = connections.remove(callId)
}
