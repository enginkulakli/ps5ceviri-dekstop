package expo.modules.ps5translator.core

import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor

data class ClientInfo(val address: String, val connectedAtMs: Long)

data class ServerSnapshot(
  val running: Boolean,
  val port: Int,
  val allowedIp: String?,
  val clients: List<ClientInfo>,
  val lastSentText: String?,
  val lastSentAtMs: Long,
  val lastSentClients: Int,
  val sentCount: Long,
  val rejectedCount: Long,
  val lastError: String?,
  val lastErrorAtMs: Long,
  val startedAtMs: Long,
)

enum class SendStatus { SENT, DUPLICATE, NO_CLIENTS, NOT_RUNNING }

data class SendResult(val status: SendStatus, val clients: Int)

/**
 * WebSocket server for the Tizen TV (the TV connects to ws://TABLET_IP:PORT).
 * Pure JVM code (Java-WebSocket, MIT) — no Android imports, unit-tested on a desktop JVM.
 *
 * Behaviour:
 *  - binds 0.0.0.0:PORT (reachable on the tablet's Wi-Fi IP), SO_REUSEADDR for quick restarts
 *  - optional TV IP allow-list, other peers are closed with 1008
 *  - a reconnecting TV replaces its stale connection from the same IP
 *  - the current subtitle is replayed to a TV that (re)connects
 *  - identical consecutive subtitles are not re-sent (unless forced)
 *  - dead connections are dropped by ping/pong (connectionLostTimeout)
 */
class SubtitleServerCore(
  private val onChange: (ServerSnapshot) -> Unit,
  private val clock: () -> Long = { System.currentTimeMillis() },
) {
  private val lock = Any()
  private var server: Inner? = null
  private var port = 8787
  @Volatile private var allowedIp: String? = null
  private val clients = LinkedHashMap<WebSocket, ClientInfo>()
  private val version2Clients = HashSet<WebSocket>()
  private val overlayClients = HashSet<WebSocket>()
  private var overlay: OverlayMessage? = null
  private var overlaySentAt = 0L
  private val timer = ScheduledThreadPoolExecutor(1) { runnable ->
    Thread(runnable, "subtitle-expiry").apply { isDaemon = true }
  }.apply {
    removeOnCancelPolicy = true
    setKeepAliveTime(30, TimeUnit.SECONDS)
    allowCoreThreadTimeOut(true)
  }
  private var expiry: ScheduledFuture<*>? = null
  private var expiresAt = 0L
  private var lastSentText: String? = null
  private var lastSentAtMs = 0L
  private var lastSentClients = 0
  private var sentCount = 0L
  private var rejectedCount = 0L
  private var lastError: String? = null
  private var lastErrorAtMs = 0L
  private var startedAtMs = 0L
  private var running = false

  fun snapshot(): ServerSnapshot = synchronized(lock) {
    ServerSnapshot(
      running, port, allowedIp, clients.values.toList(), lastSentText, lastSentAtMs, lastSentClients,
      sentCount, rejectedCount, lastError, lastErrorAtMs, startedAtMs,
    )
  }

  private fun emit() = onChange(snapshot())

  fun recordError(message: String) {
    synchronized(lock) {
      lastError = message
      lastErrorAtMs = clock()
    }
    emit()
  }

  fun setAllowedIp(ip: String?) {
    allowedIp = ip?.trim()?.takeIf { it.isNotEmpty() }
    emit()
  }

  /** Starts (or restarts) the server. Blocks up to [timeoutMs] for bind success; returns error text or null. */
  @Synchronized
  fun start(port: Int, allowedIp: String?, timeoutMs: Long = 4000): String? {
    stop()
    setAllowedIp(allowedIp)
    val latch = CountDownLatch(1)
    var bindError: String? = null
    val s = Inner(port, latch) { bindError = it }
    s.isReuseAddr = true
    s.connectionLostTimeout = 15
    synchronized(lock) {
      this.port = port
      server = s
    }
    try {
      s.start()
    } catch (t: Throwable) {
      bindError = t.message ?: t.javaClass.simpleName
      latch.countDown()
    }
    val ok = latch.await(timeoutMs, TimeUnit.MILLISECONDS)
    val err = when {
      bindError != null -> "Port $port açılamadı: $bindError"
      !ok -> "Sunucu $timeoutMs ms içinde başlamadı"
      else -> null
    }
    if (err != null) {
      synchronized(lock) { server = null; running = false }
      try { s.stop(200) } catch (_: Throwable) {}
      recordError(err)
    }
    return err
  }

  @Synchronized
  fun stop() {
    val s = synchronized(lock) {
      val current = server ?: return
      if (!lastSentText.isNullOrEmpty()) publishLocked("", null)
      expiry?.cancel(false)
      expiry = null
      expiresAt = 0L
      lastSentText = null
      overlay = null
      running = false
      server = null
      current
    }
    try {
      s.stop(1000, "Sunucu durduruldu")
    } catch (_: Throwable) {}
    synchronized(lock) {
      running = false
      clients.clear()
      version2Clients.clear()
      overlayClients.clear()
    }
    emit()
  }

  fun isRunning() = synchronized(lock) { running }

  fun clientCount() = synchronized(lock) { clients.size }

  internal fun overlayClientCount() = synchronized(lock) { overlayClients.size }

  fun send(text: String, force: Boolean = false, ttlMs: Long? = null): SendResult {
    val result = synchronized(lock) {
      if (server == null || !running) return SendResult(SendStatus.NOT_RUNNING, 0)
      if (!force && text == lastSentText) return SendResult(SendStatus.DUPLICATE, clients.size)
      publishLocked(text, ttlMs)
    }
    emit()
    return result
  }

  /** Extends a visible subtitle without transmitting its text again. */
  fun refresh(text: String, ttlMs: Long): Boolean = synchronized(lock) {
    if (!running || text.isEmpty() || text != lastSentText || remainingMs() <= 0) return false
    scheduleExpiryLocked(ttlMs)
    val payload = "{\"type\":\"refresh\",\"ttlMs\":$ttlMs}"
    for (client in version2Clients) if (client.isOpen) runCatching { client.send(payload) }
    true
  }

  fun clearIfCurrent(text: String) {
    val cleared = synchronized(lock) {
      if (!running || text.isEmpty() || text != lastSentText) return
      publishLocked("", null)
      true
    }
    if (cleared) emit()
  }

  /** Snapshots go only to TVs that opted into the spatial overlay protocol. */
  internal fun sendOverlay(message: OverlayMessage): Int = synchronized(lock) {
    if (!running) return 0
    val previous = overlay
    overlay = message.takeIf { it.blocks.isNotEmpty() }
    overlaySentAt = monotonicMs()
    if (previous == null && overlay == null) return 0
    val payload = message.encode()
    overlayClients.count { it.isOpen && runCatching { it.send(payload) }.isSuccess }
  }

  private fun monotonicMs() = TimeUnit.NANOSECONDS.toMillis(System.nanoTime())

  private fun remainingMs() = expiresAt - monotonicMs()

  private fun scheduleExpiryLocked(ttlMs: Long) {
    expiry?.cancel(false)
    expiresAt = monotonicMs() + ttlMs
    val deadline = expiresAt
    expiry = timer.schedule({
      val changed = synchronized(lock) {
        if (running && expiresAt == deadline && remainingMs() <= 0 && !lastSentText.isNullOrEmpty()) {
          publishLocked("", null)
          true
        } else false
      }
      if (changed) emit()
    }, ttlMs, TimeUnit.MILLISECONDS)
  }

  // Replay, refresh, clear and subtitle writes are serialized so a late socket callback
  // cannot enqueue an older subtitle behind a new one.
  private fun publishLocked(text: String, ttlMs: Long?): SendResult {
    lastSentText = text
    lastSentAtMs = clock()
    if (text.isEmpty()) {
      expiry?.cancel(false)
      expiry = null
      expiresAt = 0L
    } else scheduleExpiryLocked(ttlMs ?: 2000)
    val payload = SubtitleMessage.encode(text, ttlMs)
    var delivered = 0
    for (client in clients.keys) {
      if (client.isOpen && runCatching { client.send(payload) }.isSuccess) delivered++
    }
    if (delivered > 0) sentCount++
    lastSentClients = delivered
    return SendResult(if (delivered > 0) SendStatus.SENT else SendStatus.NO_CLIENTS, delivered)
  }

  private fun addr(c: WebSocket): String =
    try { c.remoteSocketAddress?.address?.hostAddress ?: "?" } catch (_: Throwable) { "?" }

  private inner class Inner(
    port: Int,
    private val latch: CountDownLatch,
    private val onBindError: (String) -> Unit,
  ) : WebSocketServer(InetSocketAddress(port)) {

    override fun onStart() {
      synchronized(lock) {
        if (server !== this) return
        running = true
        startedAtMs = clock()
        lastError = null
      }
      latch.countDown()
      emit()
    }

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
      val ip = addr(conn)
      val allow = allowedIp
      if (allow != null && ip != allow) {
        synchronized(lock) { rejectedCount++ }
        recordError("İzin verilmeyen cihaz reddedildi: $ip")
        conn.close(1008, "not allowed")
        return
      }
      val stale: List<WebSocket>
      synchronized(lock) {
        stale = clients.keys.filter { addr(it) == ip && it != conn }
        if (server !== this || !running) {
          conn.close(1000, "server is stopping")
          return
        }
        stale.forEach {
          clients.remove(it)
          version2Clients.remove(it)
          overlayClients.remove(it)
        }
        clients[conn] = ClientInfo(ip, clock())
        val replay = lastSentText
        val remaining = remainingMs()
        if (!replay.isNullOrEmpty() && remaining > 0) {
          runCatching { conn.send(SubtitleMessage.encode(replay, remaining)) }
        }
      }
      stale.forEach { try { it.close(1000, "replaced by new connection") } catch (_: Throwable) {} }
      emit()
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String?, remote: Boolean) {
      val removed = synchronized(lock) {
        version2Clients.remove(conn)
        overlayClients.remove(conn)
        clients.remove(conn) != null
      }
      if (removed) emit()
    }

    override fun onMessage(conn: WebSocket, message: String) {
      if (message != "{\"type\":\"hello\",\"subtitleVersion\":2}" &&
        message != "{\"type\":\"hello\",\"subtitleVersion\":3}") return
      synchronized(lock) {
        if (conn !in clients) return
        version2Clients.add(conn)
        if (message.endsWith(":3}") && overlayClients.add(conn)) {
          val current = overlay ?: return
          val elapsed = monotonicMs() - overlaySentAt
          val active = current.blocks.mapNotNull { block ->
            val remaining = block.ttlMs - elapsed
            if (remaining > 0) block.copy(ttlMs = remaining) else null
          }
          if (active.isNotEmpty()) runCatching { conn.send(current.copy(blocks = active).encode()) }
        }
      }
    }

    override fun onError(conn: WebSocket?, ex: Exception) {
      if (conn == null) {
        // server-level error (e.g. port already in use)
        onBindError(ex.message ?: ex.javaClass.simpleName)
        synchronized(lock) { if (server === this) running = false }
        latch.countDown()
        recordError("Sunucu hatası: ${ex.message ?: ex.javaClass.simpleName}")
      } else {
        recordError("Bağlantı hatası (${addr(conn)}): ${ex.message ?: ex.javaClass.simpleName}")
      }
    }
  }
}
