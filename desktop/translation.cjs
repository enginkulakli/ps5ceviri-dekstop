const { createHash } = require("node:crypto");
const { mkdir, readFile, rename, writeFile } = require("node:fs/promises");
const path = require("node:path");

const google = "https://translation.googleapis.com/language/translate/v2";
const openai = "https://api.openai.com/v1/chat/completions";
const model = "onnx-community/opus-mt-tc-big-en-tr";
const revision = "ce128ea834a090aca240e4e113e7756e06cc78e0";
const tokenizerAssets = {
  "source.spm": "180d3f94ddfee5585d78b702290ded0f4f9bd40f299349c8383b32a579fefad4",
  "vocab.json": "01ef522455d2bf22b0716416ee34688cc2b3f5fa257f742665d21b6acc450ac1",
};

function glossaryVersion(terms) {
  const material = terms.map(({ source, target }) => source + "\x01" + target).join("\x00");
  return "v3-" + createHash("sha256").update(material).digest("hex").slice(0, 24);
}

async function tokenizerAsset(directory, name) {
  const file = path.join(directory, name);
  const expected = tokenizerAssets[name];
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const present = await readFile(file).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (present && digest(present) === expected) return file;
  const response = await fetch(`https://huggingface.co/${model}/resolve/${revision}/${name}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || !response.body) throw new Error("Yerel modelin sözcük dosyası indirilemedi.");
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > 4 * 1024 * 1024) throw new Error("Model sözcük dosyası beklenen boyutu aşıyor.");
    parts.push(Buffer.from(part));
  }
  const bytes = Buffer.concat(parts);
  if (digest(bytes) !== expected) throw new Error("Model sözcük dosyasının sağlama toplamı eşleşmedi.");
  await writeFile(file + ".new", bytes);
  await rename(file + ".new", file);
  return file;
}

async function startOffline(cache) {
  const { AutoModelForSeq2SeqLM, Tensor, env } = await import("@huggingface/transformers");
  const { SentencePieceProcessor } = require("@agnai/sentencepiece-js");
  const directory = path.join(cache, "opus-tokenizer-" + revision);
  await mkdir(directory, { recursive: true });
  env.cacheDir = cache;
  const [source, vocab] = await Promise.all(Object.keys(tokenizerAssets).map((name) => tokenizerAsset(directory, name)));
  const tokenizer = new SentencePieceProcessor();
  await tokenizer.load(source);
  const vocabulary = JSON.parse(await readFile(vocab, "utf8"));
  const byId = Object.fromEntries(Object.entries(vocabulary).map(([piece, id]) => [id, piece]));
  const engine = await AutoModelForSeq2SeqLM.from_pretrained(model, { revision, dtype: "q8", device: "cpu" });
  const { eos_token_id: eos, pad_token_id: pad } = engine.config;
  let queue = Promise.resolve();

  async function translate(query, signal) {
    signal?.throwIfAborted();
    const input = tokenizer.encodePieces(query).slice(0, 384).map((piece) =>
      BigInt(Object.hasOwn(vocabulary, piece) ? vocabulary[piece] : vocabulary["<unk>"]));
    input.push(BigInt(eos));
    const tensor = new Tensor("int64", BigInt64Array.from(input), [1, input.length]);
    const mask = new Tensor("int64", new BigInt64Array(input.length).fill(1n), [1, input.length]);
    const output = await engine.generate({
      input_ids: tensor, attention_mask: mask, max_new_tokens: 120, num_beams: 3, early_stopping: true,
    });
    signal?.throwIfAborted();
    return output.tolist()[0].map(Number).filter((id) => id !== eos && id !== pad)
      .map((id) => byId[id] ?? "").join("").replace(/▁/g, " ").trim();
  }

  return {
    translate(query, signal) {
      const result = queue.then(() => translate(query, signal));
      queue = result.catch(() => {});
      return result;
    },
    dispose: () => engine.dispose(),
  };
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
      const translations = [];
      for (const query of queries) translations.push(await engine.translate(query, signal));
      return translations;
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
