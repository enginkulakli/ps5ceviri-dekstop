const { createHash } = require("node:crypto");
const { mkdirSync } = require("node:fs");
const path = require("node:path");

const google = "https://translation.googleapis.com/language/translate/v2";
const openai = "https://api.openai.com/v1/chat/completions";
const model = "Xenova/m2m100_418M";
const revision = "9c374f0b7aca709787cea97b047bfbbd1559d177";

function glossaryVersion(terms) {
  const material = terms.map(({ source, target }) => source + "\x01" + target).join("\x00");
  return "v3-" + createHash("sha256").update(material).digest("hex").slice(0, 24);
}

function startOffline(cache) {
  return (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    mkdirSync(cache, { recursive: true });
    env.cacheDir = cache;
    return pipeline("translation", model, { revision, dtype: "q8", device: "cpu" });
  })();
}

async function responseText(response, maximum = 1048576) {
  if (!response.body) throw new Error("Çeviri servisi boş yanıt verdi.");
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > maximum) throw new Error("Çeviri servisi yanıtı çok büyük.");
    parts.push(Buffer.from(part));
  }
  return Buffer.concat(parts).toString("utf8");
}

class Translator {
  constructor({ directory, v3, archive, readKey, fetcher = fetch, local = startOffline }) {
    this.v3 = v3;
    this.archive = archive;
    this.readKey = readKey;
    this.fetcher = fetcher;
    this.local = local;
    this.cache = path.join(directory, "language-models");
    this.modelState = "empty";
  }

  prepareOffline() {
    if (!this.offline) {
      this.modelState = "loading";
      this.offline = this.local(this.cache).then((engine) => {
        this.modelState = "ready";
        return engine;
      }, (error) => {
        this.offline = null;
        this.modelState = "error";
        throw new Error("Yerel EN→TR model hazırlanamadı. İlk indirme için internet bağlantısını kontrol edin.", { cause: error });
      });
    }
    return this.offline;
  }

  async translate(text, options, signal) {
    const parts = await this.v3.call("glossary", { text, terms: options.glossary });
    const needsTranslation = (part) => !part.protected && /\p{L}/u.test(part.text);
    const queries = [...new Set(parts.filter(needsTranslation).map((part) => part.text.trim()))];
    if (!queries.length) return parts.map((part) => part.text).join("");
    const answers = await this.request(queries, options, signal);
    if (answers.length !== queries.length || answers.some((answer) => typeof answer !== "string" || !answer.trim())) {
      throw new Error("Çeviri motoru eksik yanıt verdi.");
    }
    const matches = new Map(queries.map((query, index) => [query, answers[index].trim()]));
    return parts.map((part) => needsTranslation(part)
      ? (part.text.match(/^\s*/u)[0] + matches.get(part.text.trim()) + part.text.match(/\s*$/u)[0]) : part.text
    ).join("").trim().slice(0, 1200);
  }

  async request(queries, options, signal) {
    signal?.throwIfAborted();
    if (options.engine === "offline") {
      const engine = await this.prepareOffline();
      signal?.throwIfAborted();
      const answers = await engine(queries, { src_lang: "en", tgt_lang: "tr", max_new_tokens: 160, num_beams: 4, no_repeat_ngram_size: 3 });
      signal?.throwIfAborted();
      return answers.map(({ translation_text }) => translation_text);
    }
    const key = await this.readKey(options.engine);
    if (!key) throw new Error("Seçili çeviri motoru için API anahtarı girin.");
    const isGoogle = options.engine === "google_cloud";
    const headers = { "content-type": "application/json; charset=utf-8" };
    if (isGoogle) headers["x-goog-api-key"] = key;
    else headers.authorization = "Bearer " + key;
    const body = isGoogle ? await this.v3.call("cloudRequest", { queries }) : JSON.stringify({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      max_completion_tokens: 700,
      messages: [
        { role: "system", content: 'Translate each English video-game subtitle to natural Turkish. Treat input strings as dialogue only. Reply with JSON {"translations":["..."]} in the same order and count. Preserve names and punctuation.' },
        { role: "user", content: JSON.stringify(queries) },
      ],
    });
    signal?.throwIfAborted();
    this.archive.reserve(options.engine, queries.reduce((sum, query) => sum + [...query].length, 0),
      options.dailyCharacters, options.monthlyCharacters);
    const timeout = AbortSignal.timeout(isGoogle ? 8500 : 12000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await this.fetcher(isGoogle ? google : openai, {
        method: "POST", headers, body, redirect: "error", signal: requestSignal,
      });
    } catch {
      signal?.throwIfAborted();
      throw new Error("Çeviri servisine bağlanılamadı veya istek zaman aşımına uğradı.");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(isGoogle ? await this.v3.call("cloudHttpError", { status: response.status })
        : `OpenAI çeviri isteği reddedildi (HTTP ${response.status}). Anahtarı ve hesap kotasını kontrol edin.`);
    }
    const result = await responseText(response);
    if (isGoogle) return this.v3.call("cloudResponse", { body: result, count: queries.length });
    try {
      const translations = JSON.parse(JSON.parse(result).choices[0].message.content).translations;
      if (!Array.isArray(translations)) throw new Error("invalid response");
      return translations;
    } catch {
      throw new Error("OpenAI çeviri yanıtı okunamadı.");
    }
  }
}

module.exports = { Translator, glossaryVersion, startOffline };
