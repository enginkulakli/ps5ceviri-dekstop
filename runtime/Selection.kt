// Adapted from Android V3 RemoteSubtitlePipeline.kt at e8273ffffa813461207b24b859a89293905b66a7.
package expo.modules.ps5translator.core

internal data class Bounds(val left: Int, val top: Int, val right: Int, val bottom: Int) {
  fun width() = right - left
  fun height() = bottom - top
  fun centerX() = (left + right) / 2
  fun centerY() = (top + bottom) / 2
  fun exactCenterX() = (left + right) / 2f
  fun exactCenterY() = (top + bottom) / 2f
}

internal data class Line(val text: String, val confidence: Float, val boundingBox: Bounds)
internal data class SubtitleRead(val text: String, val reliable: Boolean)

internal class Selection(private val options: DesktopOptions) {
  private val hud = HudFilter()

  private val minConfidence get() = (0.68 - 0.46 * options.sensitivity).toFloat()

  fun screenText(result: List<List<Line>>, width: Int, height: Int): List<DetectedText> = SmartOcr.group(
    result.flatMapIndexed { group, block ->
      block.mapNotNull { line ->
        val bounds = line.boundingBox
        if (bounds.height() < 7 || (line.confidence > 0 && line.confidence < minConfidence)) return@mapNotNull null
        val x = bounds.left.coerceIn(0, width) / width.toDouble()
        val y = bounds.top.coerceIn(0, height) / height.toDouble()
        val w = bounds.right.coerceIn(0, width) / width.toDouble() - x
        val h = bounds.bottom.coerceIn(0, height) / height.toDouble() - y
        if (w <= 0 || h <= 0) null else OcrLine(line.text, FrameRect(x, y, w, h), group)
      }
    },
  )

  fun subtitleText(result: List<List<Line>>, width: Int, height: Int, now: Long): SubtitleRead? {
    val lines = result.flatten().filter { line ->
      val bounds = line.boundingBox
      val text = cleanOcr(line.text)
      if (text.length !in 2..160 || text.count(Char::isLetter) < 2 ||
        (line.confidence > 0 && line.confidence < minConfidence) ||
        bounds.height() < maxOf(7, height / 30)) return@filter false
      val x = bounds.exactCenterX() / width
      if ((x < .17 && bounds.right < width * .24) || (x > .83 && bounds.left > width * .76)) return@filter false
      !hud.isStatic(text, x, bounds.exactCenterY() / height, now)
    }
    val anchor = lines.minByOrNull { line ->
      val bounds = line.boundingBox
      kotlin.math.abs(bounds.centerX() - width / 2) * 3 - minOf(bounds.width(), width / 2)
    } ?: return null
    val anchorBounds = anchor.boundingBox
    val included = lines.filter { line ->
      val b = line.boundingBox
      kotlin.math.abs(b.centerX() - anchorBounds.centerX()) <= width / 5 &&
        kotlin.math.abs(b.centerY() - anchorBounds.centerY()) <= maxOf(b.height(), anchorBounds.height()) * 2
    }.sortedBy { it.boundingBox.top }.take(3)
    val source = cleanOcr(included.joinToString("\n") { it.text }).take(420)
    val reliable = anchorBounds.exactCenterX() / width in .28f.. .72f &&
      included.all { it.confidence >= .80f && it.boundingBox.height() >= maxOf(8, height / 24) }
    return SubtitleRead(source, reliable)
  }

}

private class HudFilter {
  private data class Seen(val x: Float, val y: Float, val start: Long, val last: Long)
  private val samples = LinkedHashMap<String, Seen>()
  fun isStatic(text: String, x: Float, y: Float, now: Long): Boolean {
    if (x in .29f.. .71f) return false
    samples.entries.removeAll { now - it.value.last > 4800 }
    val previous = samples[text]
    val stable = previous != null && kotlin.math.abs(previous.x - x) < .025 && kotlin.math.abs(previous.y - y) < .045
    val start = if (stable) previous!!.start else now
    samples[text] = Seen(x, y, start, now)
    if (samples.size > 64) samples.remove(samples.keys.first())
    return now - start >= 5800
  }
  fun clear() = samples.clear()
}
