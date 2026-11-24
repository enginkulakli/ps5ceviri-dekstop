package expo.modules.ps5translator.core

/** Legacy subtitle payload, with optional lifetime understood by newer TVs. */
object SubtitleMessage {
  fun encode(text: String, ttlMs: Long? = null): String = buildString {
    append("{\"text\":")
    appendQuoted(this, text)
    if (ttlMs != null) append(",\"ttlMs\":").append(ttlMs)
    append('}')
  }

  internal fun appendQuoted(out: StringBuilder, text: String) {
    out.append('"')
    for (ch in text) {
      when (ch) {
        '"' -> out.append("\\\"")
        '\\' -> out.append("\\\\")
        '\n' -> out.append("\\n")
        '\r' -> out.append("\\r")
        '\t' -> out.append("\\t")
        '\b' -> out.append("\\b")
        '\u000C' -> out.append("\\f")
        else -> if (ch < ' ') out.append(String.format("\\u%04x", ch.code)) else out.append(ch)
      }
    }
    out.append('"')
  }
}
