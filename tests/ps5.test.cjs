const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir, networkInterfaces } = require("node:os");
const { createSocket } = require("node:dgram");
const { EventEmitter, once } = require("node:events");
const { PassThrough } = require("node:stream");
const path = require("node:path");
const { Ps5, discover, parseDiscovery, broadcastAddresses, validAddress } = require("../desktop/ps5.cjs");

const id = "aabbccddeeff";
const ip = "192.168.1.75";
const changedIp = "192.168.1.84";
const packet = Buffer.from("HTTP/1.1 200 Ok\nHost-Type:PS5\nhost-id:AABBCCDDEEFF\nhost-name:PS5 Salon\n");

test("PS5 packet identities, standby and broadcast addresses", () => {
  assert.deepEqual(parseDiscovery(packet, ip), { id, ip, name: "PS5 Salon", standby: false });
  assert.equal(parseDiscovery(Buffer.from(packet.toString().replace("200 Ok", "620 Server Standby")), ip).standby, true);
  assert.equal(parseDiscovery(Buffer.from(packet.toString().replace("PS5", "PS4")), ip), null);
  assert.equal(parseDiscovery(Buffer.from(packet.toString().replace("AABBCCDDEEFF", "000000000000")), ip), null);
  assert.equal(parseDiscovery(packet, "127.0.0.1"), null);
  assert.deepEqual([...broadcastAddresses({
    eth: [{ address: ip, netmask: "255.255.255.0", family: "IPv4", internal: false }],
  })], ["255.255.255.255", "192.168.1.255"]);
});

test("PS5 discovery exchanges UDP packets with a local fixture", async (t) => {
  const address = Object.values(networkInterfaces()).flat().find((item) => item && validAddress(item.address))?.address;
  if (!address) return t.skip("No LAN interface");
  const server = createSocket("udp4");
  try {
    server.bind(0, address);
    await once(server, "listening");
    server.on("message", (value, sender) => {
      assert.match(value.toString(), /00030010/);
      server.send(packet, sender.port, sender.address);
    });
    const found = await discover({ destinations: [address], port: server.address().port, timeout: 400 });
    assert.deepEqual(found, [{ id, ip: address, name: "PS5 Salon", standby: false }]);
  } finally {
    server.close();
  }
});

test("PS5 upserts by MAC and reconnects at discovered address with protected credentials", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ps5-console-test-"));
  const key = Buffer.alloc(32, 9);
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  const sent = [];
  child.stdin.on("data", (part) => sent.push(Buffer.from(part)));
  const frames = [];
  const controller = new Ps5({
    directory, helper: process.execPath,
    encrypt: async (value) => { assert.equal(value, key.toString("base64")); return "protected"; },
    decrypt: async (value) => { assert.equal(value, "protected"); return key.toString("base64"); },
    scan: async () => [{ id, ip: changedIp, name: "PS5 Salon", standby: false }],
    pair: async () => Buffer.concat([Buffer.from(id, "hex"), key]),
    spawnProcess: (_, args, options) => {
      assert.deepEqual(args, ["stream", changedIp]);
      assert.equal(options.windowsHide, true);
      return child;
    },
    onVideo: (bytes) => frames.push(bytes),
  });
  try {
    await controller.pair(ip, "AAAAAAAAAAA=", "12345678", "Salon");
    await controller.pair(ip, "AAAAAAAAAAA=", "12345678", "Oyun");
    assert.deepEqual(controller.snapshot().consoles, [{ id, ip, name: "Oyun" }]);
    assert.doesNotMatch(readFileSync(path.join(directory, "ps5-consoles.json"), "utf8"), /12345678|AAAAAAAAAAA=|CQkJCQk/);
    await controller.start(id);
    assert.deepEqual(sent[0], key);
    assert.equal(controller.snapshot().consoles[0].ip, changedIp);
    child.stderr.write("login-pin-required\n");
    assert.equal(controller.snapshot().stage, "pin");
    controller.login("1234");
    assert.equal(sent[1].toString(), "1234\n");
    assert.throws(() => controller.login("wrong"));
    child.stderr.write("connected\n");
    child.stdout.write(Buffer.from("fixture-h264"));
    assert.equal(controller.snapshot().stage, "video");
    assert.equal(frames[0].toString(), "fixture-h264");
    controller.stop();
    child.emit("close", 0);
    assert.equal(controller.snapshot().stage, "idle");
    assert.deepEqual(controller.forget(id).consoles, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
