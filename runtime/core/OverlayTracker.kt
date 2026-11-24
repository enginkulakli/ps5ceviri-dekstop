package expo.modules.ps5translator.core

import kotlin.math.abs

internal data class DetectedText(val text: String, val rect: FrameRect)

internal class OverlayTracker {
  internal data class Item(val id: Long, val text: String, val rect: FrameRect, val seenAt: Long,
                           val normalized: String, val missed: Int = 0)
  private data class Detection(val block: DetectedText, val key: String)
  private data class Match(val index: Int, val item: Item, val distance: Double)

  private var nextId = 0L
  private val items = LinkedHashMap<Long, Item>()

  fun observe(
    blocks: List<DetectedText>, now: Long, ttl: Long, sceneChanged: Boolean = false,
    changedAt: (FrameRect) -> Boolean = { false },
  ) {
    alive(now, ttl)
    val remaining = items.values.toMutableList()
    val incoming = blocks.take(24).map { Detection(it, memoryText(it.text)) }
    val matched = HashMap<Int, Item>()

    // Match closest exact occurrences first. Replacement by geometry cannot take an
    // ID still needed by a nearby occurrence of the same text.
    incoming.flatMapIndexed { i, detection ->
      remaining.mapNotNull { old ->
        val distance = old.rect.distance(detection.block.rect)
        if (old.normalized == detection.key && distance < .14) Match(i, old, distance) else null
      }
    }.sortedBy { it.distance }.forEach { match ->
      if (match.index !in matched && remaining.remove(match.item)) matched[match.index] = match.item
    }

    val next = LinkedHashMap<Long, Item>()
    for ((index, detection) in incoming.withIndex()) {
      val (block, key) = detection
      val previous = matched[index] ?: remaining.takeUnless { sceneChanged }
        .orEmpty()
        .filter { it.rect.distance(block.rect) < .04 && it.rect.overlap(block.rect) > .60 }
        .minByOrNull { it.rect.distance(block.rect) }
        ?.also(remaining::remove)
      val id = previous?.id ?: ++nextId
      val rect = if (previous?.normalized == key) previous.rect.follow(block.rect) else block.rect
      next[id] = Item(id, block.text, rect, now, key)
    }
    for (old in remaining) {
      if (next.size == 24) break
      if (!sceneChanged && old.missed == 0 && !changedAt(old.rect) &&
        incoming.none { it.block.rect.overlap(old.rect) > .46 }) {
        next[old.id] = old.copy(missed = 1)
      }
    }
    items.clear()
    items.putAll(next)
  }

  fun alive(now: Long, ttl: Long): List<Item> {
    items.values.removeAll { now - it.seenAt >= ttl }
    return items.values.toList()
  }

  fun seenInLatestFrame(item: Item) = item.missed == 0
  fun clear() = items.clear()
}

/** Luminance grid used only to retire text that OCR no longer sees. */
internal class OverlayLuma(bytes: ByteArray, width: Int, height: Int) {
  private val samples = IntArray(COLS * ROWS) { index ->
    val x = index % COLS
    val y = index / COLS
    var total = 0
    for (dy in 1..2) for (dx in 1..2) {
      val px = (x * 3 + dx) * width / (COLS * 3)
      val py = (y * 3 + dy) * height / (ROWS * 3)
      total += bytes[py * width + px].toInt() and 255
    }
    total / 4
  }

  fun sceneChanged(previous: OverlayLuma): Boolean =
    samples.indices.count { abs(samples[it] - previous.samples[it]) >= 48 } >= samples.size * .37

  fun changedAt(previous: OverlayLuma, rect: FrameRect): Boolean {
    val left = (rect.x * COLS).toInt().coerceIn(0, COLS - 1)
    val right = (rect.right * COLS).toInt().coerceIn(left, COLS - 1)
    val top = (rect.y * ROWS).toInt().coerceIn(0, ROWS - 1)
    val bottom = (rect.bottom * ROWS).toInt().coerceIn(top, ROWS - 1)
    var changed = 0
    for (y in top..bottom) for (x in left..right) {
      val i = y * COLS + x
      if (abs(samples[i] - previous.samples[i]) >= 38) changed++
    }
    return changed >= maxOf(2.0, (right - left + 1) * (bottom - top + 1) * .40)
  }

  private companion object {
    const val COLS = 32
    const val ROWS = 18
  }
}
