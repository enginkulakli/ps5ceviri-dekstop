// Google Cloud Basic v2 message handling from Android V3.
package expo.modules.ps5translator.core

import org.json.JSONArray
import org.json.JSONObject

internal fun cloudRequest(queries: List<String>): ByteArray =
  JSONObject().put("q", JSONArray(queries)).put("source", "en").put("target", "tr").put("format", "text")
    .toString().toByteArray(Charsets.UTF_8)

internal fun cloudResponse(body: String, expected: Int): List<String> {
  val parsed = JSONObject(body).getJSONObject("data").getJSONArray("translations")
  check(parsed.length() == expected) { "Google Cloud eksik yanıt verdi." }
  return List(expected) { i -> decodeCloudText(parsed.getJSONObject(i).getString("translatedText")) }
}

internal fun cloudHttpError(code: Int): String = when (code) {
  400, 401 -> "Google Cloud anahtarı veya istek geçersiz."
  403 -> "Google Cloud erişimi reddedildi. API etkinliğini, anahtar kısıtlarını ve faturalandırmayı kontrol edin."
  429 -> "Google Cloud kota sınırına ulaşıldı."
  in 500..599 -> "Google Cloud geçici olarak yanıt veremiyor."
  else -> "Google Cloud isteği tamamlanamadı (HTTP $code)."
}

private val entities = Regex("&(?:amp|lt|gt|quot|apos|#\\d{1,7}|#x[0-9a-fA-F]{1,6});")
private fun decodeCloudText(text: String) = entities.replace(text) { match ->
  when (val value = match.value) {
    "&amp;" -> "&"
    "&lt;" -> "<"
    "&gt;" -> ">"
    "&quot;" -> "\""
    "&apos;" -> "'"
    else -> {
      val point = if (value.startsWith("&#x")) value.substring(3, value.length - 1).toIntOrNull(16)
        else value.substring(2, value.length - 1).toIntOrNull()
      if (point != null && Character.isValidCodePoint(point)) String(Character.toChars(point)) else value
    }
  }
}
