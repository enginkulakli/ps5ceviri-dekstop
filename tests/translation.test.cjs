const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { V3Runtime } = require("../desktop/v3.cjs");
const { Archive } = require("../desktop/archive.cjs");
const { Translator, glossaryVersion } = require("../desktop/translation.cjs");
const { Live, optionsFrom, archiveKey } = require("../desktop/live.cjs");
const { setTimeout: delay } = require("node:timers/promises");

const v3 = () => new V3Runtime(path.resolve("runtime-bin"), process.env.PS5_TEST_JAVA ?? "java");

test("Google v2 messages, glossary and budget preserve V3 behavior; OpenAI is separately configured", async () => {
  const core = v3();
  const archive = new Archive(":memory:");
  const attempts = [];
  const translator = new Translator({ directory: ".", archive, v3: core,
    readKey: async () => "fixture-api-key",
    fetcher: async (url, request) => {
      attempts.push({ url, request });
      if (url.includes("googleapis")) {
        return Response.json({ data: { translations: [{ translatedText: "git &amp; bak" }] } });
      }
      return Response.json({ choices: [{ message: { content: JSON.stringify({ translations: ["Gemiye bin."] }) } }] });
    },
  });
  try {
    const options = optionsFrom({ engine: "google_cloud", glossary: [{ source: "Kratos", target: "Kratos" }] });
    assert.equal(await translator.translate("Kratos GO", options), "Kratos git & bak");
    assert.deepEqual(JSON.parse(attempts[0].request.body), { q: ["GO"], source: "en", target: "tr", format: "text" });
    assert.equal(attempts[0].request.headers["x-goog-api-key"], "fixture-api-key");
    assert.deepEqual({ ...archive.usage("google_cloud").daily }, { chars: 2, requests: 1 });
    assert.equal(await translator.translate("Kratos", options), "Kratos");
    await assert.rejects(translator.translate("Test", { ...options, dailyCharacters: 2 }), /karakter sınırına/);
    assert.equal(attempts.length, 1);
    const openai = optionsFrom({ engine: "ai" });
    assert.equal(await translator.translate("Board the ship.", openai), "Gemiye bin.");
    assert.match(attempts[1].url, /api.openai.com/);
    assert.equal(archive.usage("ai").daily.requests, 1);
    assert.equal(glossaryVersion([]), "v3-e3b0c44298fc1c149afbf4c8");
  } finally { core.stop(); archive.db.close(); }
});

test("Android interchange imports atomically, uses V3 normalization and gives curated entries priority", async () => {
  const core = v3();
  const archive = new Archive(":memory:");
  const options = optionsFrom({ engine: "google_cloud" });
  const stored = archiveKey(options, "Get to the boat.", "Get to the boat.");
  archive.store(stored, "Tekneye git.");
  try {
    const doc = archive.export();
    doc.records.push({ ...doc.records[0], source: "Get   to the boat.", translated: "Tekneye geç.", engine: "package", version: "imported" });
    assert.deepEqual(await archive.import(doc, core), { added: 1, skipped: 1 });
    assert.equal(archive.lookup(stored, options), "Tekneye geç.");
    const record = archive.records("general", "boat", 0)[0];
    archive.edit(record.id, "Tekneye ilerle.");
    assert.equal(archive.lookup(stored, options), "Tekneye ilerle.");
    archive.delete(record.id);
    assert.equal(archive.lookup(stored, options), "Tekneye git.");
    doc.records.push({ ...doc.records[0], lang: "de" });
    await assert.rejects(archive.import(doc, core), /geçersiz/);
    assert.equal(archive.records("general", "boat", 0).length, 1);
    assert.equal(archive.records("general", "%", 0).length, 0);
  } finally { core.stop(); archive.db.close(); }
});

test("live translation coalesces repeated OCR, uses SQLite first and ignores superseded requests", async () => {
  const archive = new Archive(":memory:");
  const pending = new Map();
  const calls = [];
  const settings = optionsFrom({ engine: "google_cloud" });
  const core = { available: true, call: async () => ({ sources: [], caption: "" }) };
  const translator = {
    modelState: "ready",
    async translate(source, options, signal) {
      calls.push(source);
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        pending.set(source, resolve);
      });
    },
  };
  const live = new Live({ ffmpeg: "ffmpeg", v3: core, archive, translator });
  const observation = (...texts) => live.observe({ sources: texts.map((text) => ({ text, key: text })) });
  try {
    await live.start(settings);
    archive.store(archiveKey(settings, "Cached", "Cached"), "Kayıtlı");
    observation("Cached");
    assert.equal(live.cache.get("Cached"), "Kayıtlı");
    observation("Old");
    observation("Old");
    observation("Current", "Other");
    assert.deepEqual(calls, ["Old", "Current", "Other"]);
    pending.get("Old")("Eski");
    pending.get("Current")("Güncel");
    await delay(10);
    assert.equal(live.cache.has("Old"), false);
    assert.equal(live.cache.get("Current"), "Güncel");
  } finally { live.stop(); archive.db.close(); }
});
