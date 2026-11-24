const { existsSync } = require("node:fs");
const { decode, Ocr } = require("./frames.cjs");
const { glossaryVersion } = require("./translation.cjs");

const fallbackRegion = { x: 0, y: .72, w: 1, h: .28 };

function rect(value) {
  if (!value || ![value.x, value.y, value.w, value.h].every(Number.isFinite)) return null;
  const { x, y, w, h } = value;
  if (x < 0 || y < 0 || w < .05 || h < .05 || x + w > 1.00001 || y + h > 1.00001) return null;
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

function optionsFrom(data = {}) {
  const engine = ["offline", "google_cloud", "ai"].includes(data.engine) ? data.engine : "offline";
  const number = (key, fallback, min, max) => Number.isFinite(data[key])
    ? Math.min(max, Math.max(min, data[key])) : fallback;
  return {
    mode: data.mode === "fullscreen" ? "fullscreen" : "subtitle",
    engine,
    ocrRegion: rect(data.ocrRegion) ?? fallbackRegion,
    exclusions: Array.isArray(data.exclusions) ? data.exclusions.slice(0, 8).map(rect).filter(Boolean) : [],
    ocrIntervalMs: number("ocrIntervalMs", 300, 150, 2000),
    clearDelayMs: number("clearDelayMs", 2000, 500, 10000),
    minimumVisibleMs: number("minimumVisibleMs", 700, 0, 3000),
    confirmations: Math.round(number("confirmations", 2, 1, 4)),
    sensitivity: number("sensitivity", .5, 0, 1),
    glossary: Array.isArray(data.glossary) ? data.glossary.slice(0, 80).flatMap((entry) =>
      typeof entry?.source === "string" && typeof entry.target === "string" && entry.source.trim() && entry.target.trim()
        ? [{ source: entry.source.trim().slice(0, 80), target: entry.target.trim().slice(0, 120) }] : []) : [],
    gameId: typeof data.gameId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(data.gameId) ? data.gameId : "general",
    generalArchive: data.generalArchive !== false,
    shareEngines: data.shareEngines === true,
    dailyCharacters: Math.round(number("dailyCharacters", 10000, 0, 10000000)),
    monthlyCharacters: Math.round(number("monthlyCharacters", 100000, 0, 100000000)),
  };
}

function archiveKey(options, source, normalized) {
  return { gameId: options.gameId, source, normalized, engine: options.engine, version: glossaryVersion(options.glossary) };
}

class Live {
  constructor({ ffmpeg, v3, archive, translator, ocr = new Ocr() }) {
    this.ffmpeg = ffmpeg;
    this.v3 = v3;
    this.archive = archive;
    this.translator = translator;
    this.ocr = ocr;
    this.options = optionsFrom();
    this.cache = new Map();
    this.attempts = new Map();
    this.failures = new Map();
    this.generation = 0;
    this.interval = 300;
    this.state = { active: false, english: "", turkish: "", ocr: "Bekliyor", translation: "Bekliyor" };
    this.lastFrameAt = -Infinity;
  }

  snapshot() {
    return {
      available: this.v3.available && (this.ffmpeg === "ffmpeg" || existsSync(this.ffmpeg)),
      model: this.translator.modelState,
      ...this.state,
    };
  }

  resetAttempts() {
    this.generation++;
    for (const attempt of this.attempts.values()) attempt.abort();
    this.attempts.clear();
    this.cache.clear();
    this.failures.clear();
  }

  async start(settings) {
    if (!this.snapshot().available) throw new Error("OCR ve V3 çalışma zamanı bulunamadı.");
    this.state = { active: true, english: "", turkish: "", ocr: "PS5 görüntüsü bekleniyor", translation: "Bekliyor" };
    await this.configure(settings, true);
    this.timer = setInterval(() => void this.reconcile(), 140);
  }

  async configure(settings, force = false) {
    if (!this.state.active) return;
    const next = optionsFrom(settings);
    if (!force && JSON.stringify(next) === JSON.stringify(this.options)) return;
    this.options = next;
    this.resetAttempts();
    this.archiveRevision = this.archive.revision;
    this.interval = this.options.ocrIntervalMs;
    this.lastFrameAt = -Infinity;
    this.state.english = "";
    this.state.turkish = "";
    await this.v3.call("configure", { options: this.options });
  }

  feed(bytes, source) {
    if (!this.state.active) return;
    this.decoder ??= decode(this.ffmpeg, (image) => void this.read(image),
      (error) => { this.state.ocr = error; });
    this.decoder.write(bytes, source);
  }

  async read(image) {
    if (!this.state.active || this.frameBusy || performance.now() - this.lastFrameAt < this.interval) return;
    this.lastFrameAt = performance.now();
    this.frameBusy = true;
    const generation = this.generation;
    try {
      const frame = await this.ocr.read(image, this.options);
      if (!this.state.active || generation !== this.generation) return;
      const outcome = await this.v3.call("frame", frame);
      if (generation !== this.generation) return;
      this.interval = outcome.scanMs;
      this.state.ocr = outcome.sources.length ? "Altyazı okunuyor" : "Metin aranıyor";
      this.state.ocrMs = Math.round(performance.now() - this.lastFrameAt);
      this.observe(outcome);
      void this.reconcile();
    } catch (error) {
      if (generation === this.generation) this.state.ocr = error.message || "OCR kareyi okuyamadı.";
    } finally { this.frameBusy = false; }
  }

  async reconcile() {
    if (!this.state.active || this.tickBusy) return;
    this.tickBusy = true;
    if (this.archiveRevision !== this.archive.revision) {
      this.resetAttempts();
      this.archiveRevision = this.archive.revision;
    }
    const generation = this.generation;
    try {
      const result = await this.v3.call("tick", { translations: Object.fromEntries(this.cache) });
      if (!this.state.active || generation !== this.generation) return;
      this.state.turkish = result.caption;
      this.observe(result);
    } catch (error) {
      if (generation === this.generation) this.state.translation = error.message;
    } finally { this.tickBusy = false; }
  }

  observe(result) {
    this.state.english = result.sources.map(({ text }) => text).join(" · ").slice(0, 420);
    const time = performance.now();
    const visible = new Set(result.sources.map(({ key }) => key));
    for (const [key, deadline] of this.failures) if (deadline <= time) this.failures.delete(key);
    const pending = new Map();
    for (const { text, key } of result.sources) {
      if (this.cache.has(key)) this.remember(key, this.cache.get(key));
      else if (!this.attempts.has(key) && !this.failures.has(key)) pending.set(key, text);
    }
    if (this.options.engine !== "offline" && pending.size > 2 - this.attempts.size) {
      for (const [key, attempt] of this.attempts) {
        if (!visible.has(key)) { attempt.abort(); this.attempts.delete(key); }
      }
    }
    for (const [key, text] of pending) {
      if (this.attempts.size >= 2) break;
      void this.translate(key, text);
    }
  }

  remember(key, value) {
    this.cache.delete(key);
    this.cache.set(key, value);
    if (this.cache.size > 180) this.cache.delete(this.cache.keys().next().value);
  }

  async translate(normalized, source) {
    const attempt = new AbortController();
    const revision = this.archive.revision;
    const generation = this.generation;
    const options = this.options;
    const key = archiveKey(options, source, normalized);
    const current = () => generation === this.generation && this.attempts.get(normalized) === attempt;
    this.attempts.set(normalized, attempt);
    try {
      const stored = this.archive.lookup(key, options);
      if (stored) {
        this.remember(normalized, stored);
        this.state.translation = "Yerel arşiv";
        return;
      }
      this.state.translation = options.engine === "offline" && this.translator.modelState !== "ready"
        ? "Yerel dil modeli hazırlanıyor" : "Çevriliyor";
      const text = await this.translator.translate(source, options, attempt.signal);
      if (!current()) return;
      if (!text) throw new Error("Çeviri motoru boş yanıt verdi.");
      this.remember(normalized, text);
      if (this.archive.revision === revision) this.archive.store(key, text);
      this.state.translation = "Hazır";
    } catch (error) {
      if (current()) {
        this.failures.set(normalized, performance.now() + (options.engine === "offline" ? 3000 : 30000));
        this.state.translation = error.message;
      }
    } finally {
      if (current()) {
        this.attempts.delete(normalized);
        void this.reconcile();
      }
    }
  }

  stop() {
    clearInterval(this.timer);
    this.resetAttempts();
    this.decoder?.stop();
    this.decoder = null;
    const active = this.state.active;
    this.state = { active: false, english: "", turkish: "", ocr: "Bekliyor", translation: "Bekliyor" };
    if (active && this.v3.child) void this.v3.call("clear").catch(() => {});
  }
}

module.exports = { Live, optionsFrom, archiveKey };
