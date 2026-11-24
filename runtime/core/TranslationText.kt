package expo.modules.ps5translator.core

import java.text.Normalizer

internal data class GlossaryEntry(val source: String, val target: String)
internal data class TextPart(val text: String, val protected: Boolean)

private val wrappedWord = Regex("(?<=\\p{L})-\\s*\\n\\s*(?=\\p{Ll})")
private val whitespace = Regex("\\s+")
private val punctuationSpacing = Regex("\\s+([,.!?;:%])")

internal fun cleanOcr(text: String): String = Normalizer.normalize(text, Normalizer.Form.NFKC)
  .replace("\u00ad", "")
  .replace(wrappedWord, "")
  .replace('’', '\'').replace('‘', '\'').replace('“', '"').replace('”', '"')
  .replace(whitespace, " ")
  .replace(punctuationSpacing, "$1")
  .trim()

internal class GameGlossary(entries: List<GlossaryEntry>) {
  private val terms = entries.associateBy { it.source.lowercase(java.util.Locale.ROOT) }
  private val matches = entries.sortedByDescending { it.source.length }.takeIf { it.isNotEmpty() }?.let { sorted ->
    val choices = sorted.joinToString("|") { Regex.escape(it.source) }
    Regex("(?<![\\p{L}\\p{N}])(?:$choices)(?![\\p{L}\\p{N}])", RegexOption.IGNORE_CASE)
  }

  fun split(source: String): List<TextPart> {
    val occurrences = matches?.findAll(source)?.toList().orEmpty()
    if (occurrences.isEmpty()) return listOf(TextPart(source, false))
    return buildList {
      var start = 0
      for (match in occurrences) {
        val entry = terms[match.value.lowercase(java.util.Locale.ROOT)] ?: continue
        if (match.range.first > start) add(TextPart(source.substring(start, match.range.first), false))
        add(TextPart(entry.target, true))
        start = match.range.last + 1
      }
      if (start < source.length) add(TextPart(source.substring(start), false))
    }
  }
}
