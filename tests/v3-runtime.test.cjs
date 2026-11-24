const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { once } = require("node:events");
const { createServer } = require("node:net");
const { setTimeout: delay } = require("node:timers/promises");
const path = require("node:path");
const { decode, Ocr } = require("../desktop/frames.cjs");
const { V3Runtime } = require("../desktop/v3.cjs");

const runtimeDir = process.env.PS5_TEST_RUNTIME ?? path.resolve("runtime-bin");
const core = () => new V3Runtime(runtimeDir, process.env.PS5_TEST_JAVA ?? "java");

async function fixtureImage() {
  const fixture = readFileSync(path.join(__dirname, "fixtures/subtitle.h264"));
  let first;
  let failure;
  const decoder = decode(process.env.PS5_TEST_FFMPEG ?? "ffmpeg",
    (image) => { first ??= image; }, (error) => { failure = error; });
  decoder.input.end(fixture);
  await once(decoder.process, "close");
  assert.equal(failure, undefined);
  assert.ok(first, "FFmpeg returned no decoded image");
  return first;
}

async function socketPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("decode H.264, crop and run real OCR before V3 accepts the English line", { timeout: 30000 }, async () => {
  const v3 = core();
  const ocr = new Ocr();
  try {
    const image = await fixtureImage();
    const options = { mode: "subtitle", ocrRegion: { x: 0, y: .72, w: 1, h: .28 }, exclusions: [] };
    await v3.call("configure", { options });
    const frame = await ocr.read(image, options);
    assert.equal(frame.width, 1280);
    assert.match(frame.groups.flat().map((line) => line.text).join(" "), /GET TO THE BOAT/i);
    await v3.call("frame", frame);
    const result = await v3.call("frame", frame);
    assert.deepEqual(result.sources, [{ text: "GET TO THE BOAT", key: "GET TO THE BOAT" }]);
    assert.equal(result.scanMs, 180);
    const glossary = await v3.call("glossary", { text: "Get to OLD MINE.", terms: [{ source: "Old Mine", target: "Eski Maden" }] });
    assert.equal(glossary.find((part) => part.protected).text, "Eski Maden");
  } finally {
    await ocr.stop();
    v3.stop();
  }
});

test("V3 WebSocket sends UTF-8, refreshes, replays on reconnect and clears", { timeout: 12000 }, async () => {
  const v3 = core();
  let tv;
  try {
    const port = await socketPort();
    assert.equal((await v3.call("tvStart", { port, allowedIp: "127.0.0.1" })).running, true);
    const connect = async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      const messages = [];
      socket.addEventListener("message", (event) => messages.push(JSON.parse(event.data)));
      await once(socket, "open");
      socket.send('{"type":"hello","subtitleVersion":2}');
      socket.send('{"type":"hello","subtitleVersion":3}');
      return { socket, messages };
    };
    const wait = async (predicate) => {
      for (let i = 0; i < 80 && !predicate(); i++) await delay(20);
      assert(predicate());
    };
    tv = await connect();
    await wait(() => tv.messages.length === 0);
    await v3.call("configure", { options: { clearDelayMs: 1800 } });
    const frame = { width: 1280, height: 200, groups: [[
      { text: "Follow the lantern.", confidence: .95, box: [490, 110, 790, 139] },
    ]] };
    await v3.call("frame", frame);
    const translations = { "Follow the lantern.": "Feneri takip et." };
    await v3.call("tick", { translations });
    await wait(() => tv.messages.some((message) => message.text === "Feneri takip et."));
    await delay(900);
    await v3.call("frame", frame);
    await v3.call("tick", { translations });
    await wait(() => tv.messages.some((message) => message.type === "refresh"));
    tv.socket.close();
    tv = await connect();
    await wait(() => tv.messages.some((message) => message.text === "Feneri takip et."));
    await v3.call("clear");
    await wait(() => tv.messages.some((message) => message.text === ""));
    assert.equal((await v3.call("tvStatus")).clients.length, 1);
    await v3.call("tvStop");
  } finally {
    tv?.socket.close();
    v3.stop();
  }
});

test("V3 spatial stream is opt-in and preserves normalized geometry", { timeout: 10000 }, async () => {
  const v3 = core();
  let tv;
  try {
    const port = await socketPort();
    await v3.call("tvStart", { port, allowedIp: "127.0.0.1" });
    tv = new WebSocket(`ws://127.0.0.1:${port}`);
    const packets = [];
    tv.addEventListener("message", (event) => packets.push(JSON.parse(event.data)));
    await once(tv, "open");
    tv.send('{"type":"hello","subtitleVersion":3}');
    for (let i = 0; i < 40 && !(await v3.call("tvStatus")).overlayClients; i++) await delay(20);
    assert.equal((await v3.call("tvStatus")).overlayClients, 1);
    await v3.call("configure", { options: { mode: "fullscreen" } });
    const frame = { width: 1280, height: 720, luma: Buffer.alloc(96 * 54).toString("base64"),
      groups: [[{ text: "Follow the lantern.", confidence: .95, box: [490, 580, 790, 620] }]] };
    await v3.call("frame", frame);
    await v3.call("tick", { translations: { "Follow the lantern.": "Feneri takip et." } });
    for (let i = 0; i < 40 && !packets.some((p) => p.type === "overlay"); i++) await delay(20);
    const overlay = packets.find((p) => p.type === "overlay");
    assert.equal(overlay.frameWidth, 1280);
    assert.equal(overlay.frameHeight, 720);
    assert.equal(overlay.blocks[0].text, "Feneri takip et.");
    assert.ok(overlay.blocks[0].x >= 0 && overlay.blocks[0].x + overlay.blocks[0].w <= 1);
    assert.ok(overlay.blocks[0].ttlMs > 0);
  } finally { tv?.close(); v3.stop(); }
});

test("headless H.264 fixture reaches the TV through OCR and the V3 archive without an API call", { timeout: 20000 }, async () => {
  const { Archive } = require("../desktop/archive.cjs");
  const { Live, archiveKey, optionsFrom } = require("../desktop/live.cjs");
  const v3 = core();
  const archive = new Archive(":memory:");
  const options = optionsFrom({ engine: "google_cloud", confirmations: 1 });
  const live = new Live({ ffmpeg: process.env.PS5_TEST_FFMPEG ?? "ffmpeg", v3, archive,
    translator: { modelState: "empty", translate: async () => { throw new Error("unexpected API call"); } },
  });
  let tv;
  try {
    const port = await socketPort();
    await v3.call("tvStart", { port, allowedIp: "127.0.0.1" });
    tv = new WebSocket(`ws://127.0.0.1:${port}`);
    const packets = [];
    tv.addEventListener("message", (event) => packets.push(JSON.parse(event.data)));
    await once(tv, "open");
    const english = "GET TO THE BOAT";
    archive.store(archiveKey(options, english, english), "Tekneye git.");
    await live.start(options);
    live.feed(readFileSync(path.join(__dirname, "fixtures", "subtitle.h264")));
    live.decoder.input.end();
    for (let i = 0; i < 120 && !packets.some((p) => p.text === "Tekneye git."); i++) await delay(40);
    assert.ok(packets.some((p) => p.text === "Tekneye git."), JSON.stringify(live.snapshot()));
    assert.equal(archive.usage("google_cloud").daily.requests, 0);
  } finally {
    live.stop();
    await live.ocr.stop();
    tv?.close();
    v3.stop();
    archive.db.close();
  }
});
