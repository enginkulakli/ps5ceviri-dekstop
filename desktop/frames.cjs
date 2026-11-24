const { spawn } = require("node:child_process");
const { PNG } = require("pngjs");
const { createWorker, OEM, PSM } = require("tesseract.js");
const path = require("node:path");
const { existsSync } = require("node:fs");

const width = 1280;
const height = 720;

function decode(ffmpeg, onImage, onFailure) {
  const process = spawn(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-fflags", "+discardcorrupt",
    "-flags", "low_delay", "-probesize", "32768", "-analyzeduration", "500000",
    "-threads", "2", "-f", "h264", "-i", "pipe:0", "-an",
    "-vf", "select=not(mod(n\\,4)),scale=1280:720:flags=bilinear,format=gray",
    "-fps_mode", "passthrough", "-pix_fmt", "gray", "-threads", "1", "-f", "rawvideo", "pipe:1",
  ], { windowsHide: true });
  let frame = Buffer.allocUnsafe(width * height);
  let offset = 0;
  let closing = false;
  let lastError = "";
  let pausedSource;
  const resume = () => { pausedSource?.resume(); pausedSource = null; };
  process.stdin.on("drain", resume);
  process.once("close", resume);
  process.stderr.on("data", (bytes) => { lastError = (lastError + bytes.toString()).slice(-1000); });
  process.stdout.on("data", (bytes) => {
    let index = 0;
    while (index < bytes.length) {
      const size = Math.min(frame.length - offset, bytes.length - index);
      bytes.copy(frame, offset, index, index + size);
      offset += size;
      index += size;
      if (offset === frame.length) {
        const image = frame;
        frame = Buffer.allocUnsafe(width * height);
        offset = 0;
        onImage(image);
      }
    }
  });
  process.on("error", () => { if (!closing) onFailure("FFmpeg görüntü çözücüsü başlatılamadı."); });
  process.on("close", (code) => {
    if (!closing && code !== 0) onFailure("H.264 görüntüsü çözülemedi." + (lastError ? " " + lastError.split("\n").filter(Boolean).at(-1).slice(0, 120) : ""));
  });
  process.stdin.on("error", () => {});
  return {
    write(bytes, source) {
      if (process.stdin.destroyed) return;
      if (!process.stdin.write(bytes) && source) {
        pausedSource = source;
        pausedSource.pause();
      }
    },
    input: process.stdin,
    process,
    stop() {
      closing = true;
      process.stdin.end();
      process.kill();
    },
  };
}

function crop(image, full, region, exclusions) {
  const area = full ? { x: 0, y: 0, w: 1, h: 1 } : region;
  const x = Math.round(area.x * width);
  const y = Math.round(area.y * height);
  const w = Math.min(width - x, Math.round(area.w * width));
  const h = Math.min(height - y, Math.round(area.h * height));
  const pixels = Buffer.allocUnsafe(w * h);
  for (let row = 0; row < h; row++) {
    const start = (y + row) * width + x;
    image.copy(pixels, row * w, start, start + w);
  }
  if (!full) {
    for (const box of exclusions) {
      const left = Math.max(0, Math.round(box.x * width) - x);
      const top = Math.max(0, Math.round(box.y * height) - y);
      const right = Math.min(w, Math.round((box.x + box.w) * width) - x);
      const bottom = Math.min(h, Math.round((box.y + box.h) * height) - y);
      if (right <= left || bottom <= top) continue;
      for (let row = top; row < bottom; row++) pixels.fill(0, row * w + left, row * w + right);
    }
  }
  return { pixels, width: w, height: h };
}

function downsampleLuma(image) {
  const grid = Buffer.allocUnsafe(96 * 54);
  for (let row = 0; row < 54; row++) {
    for (let col = 0; col < 96; col++) {
      grid[row * 96 + col] = image[Math.floor(row * height / 54) * width + Math.floor(col * width / 96)];
    }
  }
  return grid.toString("base64");
}

function png({ pixels, width, height }) {
  return PNG.sync.write({ data: pixels, width, height }, { inputColorType: 0, colorType: 0, inputHasAlpha: false });
}

class Ocr {
  constructor(options = {}) {
    this.options = options;
    this.worker = null;
    this.mode = null;
  }

  async read(image, options) {
    const full = options.mode === "fullscreen";
    const frame = crop(image, full, options.ocrRegion, options.exclusions);
    if (!this.worker) {
      const langPath = path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
      const unpacked = langPath.replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
      this.worker = await createWorker("eng", OEM.LSTM_ONLY, {
        langPath: existsSync(unpacked) ? unpacked : langPath,
        cacheMethod: "none",
        ...this.options,
      });
    }
    if (full !== this.mode) {
      await this.worker.setParameters({ tessedit_pageseg_mode: full ? PSM.SPARSE_TEXT : PSM.SINGLE_BLOCK, user_defined_dpi: "150" });
      this.mode = full;
    }
    const { data } = await this.worker.recognize(png(frame), {}, { blocks: true, text: false });
    const groups = (data.blocks ?? []).map((block) => block.paragraphs.flatMap((p) => p.lines).map((line) => {
      const b = line.bbox;
      return { text: line.text.trim(), confidence: (line.confidence ?? 0) / 100, box: [b.x0, b.y0, b.x1, b.y1] };
    }));
    const result = { groups, width: frame.width, height: frame.height };
    if (full) result.luma = downsampleLuma(image);
    return result;
  }

  async stop() {
    await this.worker?.terminate();
    this.worker = null;
    this.mode = null;
  }
}

module.exports = { Ocr, decode, crop, width, height };
