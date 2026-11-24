package expo.modules.ps5translator.core

import org.json.JSONArray
import org.json.JSONObject
import java.util.Base64
import java.util.concurrent.TimeUnit

internal data class DesktopOptions(
  val fullscreen: Boolean,
  val intervalMs: Long,
  val ttlMs: Long,
  val minimumMs: Long,
  val sensitivity: Double,
  val confirmations: Int,
) {
  constructor(o: JSONObject) : this(
    o.optString("mode") == "fullscreen",
    o.optLong("ocrIntervalMs", 300).coerceIn(150, 2000),
    o.optLong("clearDelayMs", 2000).coerceIn(500, 10000),
    o.optLong("minimumVisibleMs", 700).coerceIn(0, 3000),
    o.optDouble("sensitivity", .5).coerceIn(0.0, 1.0),
    o.optInt("confirmations", 2).coerceIn(1, 4),
  )
}

private fun now() = TimeUnit.NANOSECONDS.toMillis(System.nanoTime())

private class LiveCaptions(private val server: SubtitleServerCore, private val options: DesktopOptions) {
  private val selection = Selection(options)
  private val tracker = SubtitleTracker(options.intervalMs, options.confirmations)
  private val overlay = OverlayTracker()
  private val scanInterval = if (options.fullscreen) maxOf(options.intervalMs, 500) else options.intervalMs
  private val screenTtl = maxOf(options.ttlMs, scanInterval * 2 + 150)
  private var previousLuma: OverlayLuma? = null
  private var caption: SubtitleCaption? = null
  private var previousOverlay = emptyList<OverlayBox>()
  private var lastInputs = emptyList<OverlayBox>()
  private var lastLayout = emptyList<OverlayBox>()
  private var overlayExpires = 0L
  private var videoWidth = 1280
  private var videoHeight = 720

  fun frame(command: JSONObject): JSONObject {
    val width = command.getInt("width")
    val height = command.getInt("height")
    val groups = command.getJSONArray("groups")
    val result = (0 until minOf(groups.length(), 200)).map { group ->
      val lines = groups.getJSONArray(group)
      (0 until minOf(lines.length(), 100)).map { index ->
        val line = lines.getJSONObject(index)
        val b = line.getJSONArray("box")
        Line(line.getString("text").take(420), line.getDouble("confidence").toFloat(),
          Bounds(b.getInt(0), b.getInt(1), b.getInt(2), b.getInt(3)))
      }
    }
    val time = now()
    if (options.fullscreen) {
      videoWidth = width
      videoHeight = height
      val luma = OverlayLuma(Base64.getDecoder().decode(command.getString("luma")), 96, 54)
      val old = previousLuma
      overlay.observe(selection.screenText(result, width, height), time, screenTtl,
        old != null && luma.sceneChanged(old)) { rect -> old != null && luma.changedAt(old, rect) }
      previousLuma = luma
    } else {
      val reading = selection.subtitleText(result, width, height, time)
      tracker.observe(reading?.text.orEmpty(), time, reliable = reading?.reliable == true)
    }
    return state(time)
  }

  fun reconcile(translations: JSONObject): JSONObject {
    val time = now()
    if (options.fullscreen) {
      val alive = overlay.alive(time, screenTtl)
      val live = alive.mapNotNull { item ->
        val translated = translations.optString(item.normalized).takeIf(String::isNotBlank) ?: return@mapNotNull null
        val wasVisible = previousOverlay.any { it.id == item.id && it.text == translated }
        if (!wasVisible && !overlay.seenInLatestFrame(item)) return@mapNotNull null
        OverlayBox(item.id, translated, item.rect, item.seenAt + screenTtl - time)
      }
      val inputs = live.map { it.copy(ttlMs = 0) }.sortedBy { it.id }
      if (inputs != lastInputs) {
        lastInputs = inputs
        lastLayout = TvOverlayLayout.arrange(inputs)
      }
      val boxes = lastLayout.map { placed -> placed.copy(ttlMs = live.first { it.id == placed.id }.ttlMs) }
      val changed = boxes.map { it.copy(ttlMs = 0) } != previousOverlay.map { it.copy(ttlMs = 0) }
      if (changed || boxes.isNotEmpty() && time >= overlayExpires - maxOf(300, scanInterval + 100)) {
        server.sendOverlay(OverlayMessage(videoWidth, videoHeight, boxes))
        previousOverlay = boxes
        overlayExpires = time + (boxes.minOfOrNull { it.ttlMs } ?: 0)
      }
    } else {
      tracker.expire(time, options.ttlMs)
      val source = tracker.text
      val translated = translations.optString(source).takeIf(String::isNotBlank)
      val previous = caption
      val shown = SubtitleCaption.select(previous, source, translated, tracker.seenAt, time, options.ttlMs, options.minimumMs)
      caption = shown
      if (shown == null) previous?.let { server.clearIfCurrent(it.text) }
      else if (shown !== previous || shown.source == source && time - shown.sentAt >= minOf(850, options.ttlMs / 2)) {
        val remaining = (shown.until - time).coerceAtLeast(1)
        if (!server.refresh(shown.text, remaining)) server.send(shown.text, force = true, ttlMs = remaining)
        shown.sentAt = time
      }
    }
    return state(time)
  }

  private fun state(time: Long): JSONObject {
    tracker.expire(time, options.ttlMs)
    val candidates = JSONArray()
    if (options.fullscreen) {
      overlay.alive(time, screenTtl).filter(overlay::seenInLatestFrame).forEach {
        candidates.put(JSONObject().put("text", it.text).put("key", it.normalized))
      }
    } else if (tracker.text.isNotEmpty()) {
      candidates.put(JSONObject().put("text", tracker.text).put("key", tracker.text))
    }
    val scan = if (!options.fullscreen && scanInterval <= 300 && tracker.recentlyRead(time))
      minOf(180, scanInterval) else scanInterval
    return JSONObject().put("sources", candidates).put("scanMs", scan)
      .put("caption", if (options.fullscreen) previousOverlay.joinToString(" · ") { it.text }.take(420) else caption?.text.orEmpty())
  }

  fun clear() {
    caption?.let { server.clearIfCurrent(it.text) }
    server.sendOverlay(OverlayMessage(videoWidth, videoHeight, emptyList()))
  }
}

private fun tvStatus(server: SubtitleServerCore): JSONObject {
  val s = server.snapshot()
  return JSONObject().put("running", s.running).put("port", s.port)
    .put("clients", JSONArray(s.clients.map { it.address }))
    .put("overlayClients", server.overlayClientCount())
    .put("lastSentText", s.lastSentText ?: JSONObject.NULL)
    .put("lastError", s.lastError ?: JSONObject.NULL)
    .put("sentCount", s.sentCount).put("rejectedCount", s.rejectedCount)
}

fun main(args: Array<String>) {
  if (args.contentEquals(arrayOf("--self-test"))) {
    check(SubtitleTracker(300, 2).observe("Follow the lantern.", 200, true))
    check(GameGlossary(listOf(GlossaryEntry("Kratos", "Kratos"))).split("To KRATOS").last().protected)
    println("V3 JVM tracking and glossary ready")
    return
  }

  val server = SubtitleServerCore({ })
  var captions = LiveCaptions(server, DesktopOptions(JSONObject()))
  try {
    System.`in`.bufferedReader(Charsets.UTF_8).forEachLine { line ->
      val response = JSONObject()
      try {
        val cmd = JSONObject(line)
        response.put("id", cmd.getInt("id"))
        val data = when (cmd.getString("type")) {
          "configure" -> {
            captions.clear()
            captions = LiveCaptions(server, DesktopOptions(cmd.getJSONObject("options")))
            JSONObject()
          }
          "frame" -> captions.frame(cmd)
          "tick" -> captions.reconcile(cmd.getJSONObject("translations"))
          "clear" -> { captions.clear(); captions = LiveCaptions(server, DesktopOptions(JSONObject())); JSONObject() }
          "glossary" -> {
            val terms = cmd.getJSONArray("terms")
            val glossary = GameGlossary((0 until minOf(terms.length(), 80)).map { i ->
              val term = terms.getJSONObject(i)
              GlossaryEntry(term.getString("source"), term.getString("target"))
            })
            JSONArray(glossary.split(cmd.getString("text")).map {
              JSONObject().put("text", it.text).put("protected", it.protected)
            })
          }
          "cloudRequest" -> cloudRequest(cmd.getJSONArray("queries").map { it as String }).toString(Charsets.UTF_8)
          "cloudResponse" -> JSONArray(cloudResponse(cmd.getString("body"), cmd.getInt("count")))
          "cloudHttpError" -> cloudHttpError(cmd.getInt("status"))
          "normalize" -> JSONArray(cmd.getJSONArray("values").map { memoryText(it as String) })
          "tvStatus" -> tvStatus(server)
          "tvStart" -> {
            val port = cmd.getInt("port")
            require(port in 1..65535) { "Geçersiz TV sunucusu portu." }
            server.start(port, cmd.optString("allowedIp").ifBlank { null })?.let(::error)
            tvStatus(server)
          }
          "tvStop" -> { server.stop(); tvStatus(server) }
          "tvTest" -> { server.send("PS5 Çevirmen · Türkçe altyazı testi", force = true, ttlMs = 6500); tvStatus(server) }
          else -> error("Geçersiz masaüstü komutu.")
        }
        response.put("data", data)
      } catch (error: Exception) {
        response.put("error", error.message ?: "V3 işlemi tamamlanamadı.")
      }
      System.out.write((response.toString() + "\n").toByteArray(Charsets.UTF_8))
      System.out.flush()
    }
  } finally {
    server.stop()
  }
}
