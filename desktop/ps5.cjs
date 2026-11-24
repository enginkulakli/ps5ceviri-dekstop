const { createSocket } = require("node:dgram");
const { isIPv4 } = require("node:net");
const { networkInterfaces } = require("node:os");
const { existsSync, readFileSync, renameSync, writeFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const path = require("node:path");

const discoveryPort = 9302;
const request = Buffer.from("SRCH * HTTP/1.1\r\ndevice-discovery-protocol-version:00030010\r\n\r\n");

function validAddress(address) {
  return typeof address === "string" && isIPv4(address)
    && Number(address.split(".")[0]) > 0 && Number(address.split(".")[0]) < 224
    && !address.startsWith("127.") && !address.startsWith("169.254.");
}

function parseDiscovery(packet, address) {
  if (!validAddress(address) || packet.length > 4096) return null;
  const [status, ...lines] = packet.toString("utf8").split(/\r?\n/);
  const code = /^HTTP\/1\.1 (200|620)\b/.exec(status)?.[1];
  if (!code) return null;
  const headers = new Map();
  for (const line of lines) {
    const delimiter = line.indexOf(":");
    if (delimiter > 0) headers.set(line.slice(0, delimiter).toLowerCase(), line.slice(delimiter + 1).trim());
  }
  const id = (headers.get("host-id") ?? "").toLowerCase();
  if (headers.get("host-type")?.toUpperCase() !== "PS5" || !/^[0-9a-f]{12}$/.test(id) || id === "000000000000") return null;
  const name = (headers.get("host-name") || "PS5").replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, 80);
  return { id, ip: address, name, standby: code === "620" };
}

function broadcastAddresses(interfaces = networkInterfaces()) {
  const destinations = new Set(["255.255.255.255"]);
  for (const item of Object.values(interfaces).flatMap((entries) => entries ?? [])) {
    if (item.family !== "IPv4" || item.internal || !validAddress(item.address) || !isIPv4(item.netmask)) continue;
    const mask = item.netmask.split(".").map(Number);
    const broadcast = item.address.split(".").map((octet, index) => Number(octet) | (255 ^ mask[index])).join(".");
    if (broadcast !== item.address) destinations.add(broadcast);
  }
  return destinations;
}

function discover({ timeout = 1600, destinations = broadcastAddresses(), port = discoveryPort } = {}) {
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    const consoles = new Map();
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      if (error) reject(error);
      else resolve([...consoles.values()]);
    };
    const timer = setTimeout(finish, timeout);
    socket.on("error", finish);
    socket.on("message", (packet, sender) => {
      const console = parseDiscovery(packet, sender.address);
      if (console && (!consoles.has(console.id) || !console.standby)) consoles.set(console.id, console);
    });
    socket.bind(0, "0.0.0.0", () => {
      socket.setBroadcast(true);
      for (const target of destinations) socket.send(request, port, target, () => {});
    });
  });
}

function loadRecords(file) {
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(data)) throw new Error("invalid records");
    return data;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error("PS5 kayıt dosyası okunamadı.");
  }
}

async function pairing(helper, ip, accountId, pin) {
  if (!validAddress(ip)) throw new Error("Geçerli bir PS5 IPv4 adresi girin.");
  if (typeof accountId !== "string" || !/^[A-Za-z0-9+/]{11}=$/.test(accountId)
      || Buffer.from(accountId, "base64").toString("base64") !== accountId) {
    throw new Error("PSN Account ID, Base64 biçiminde 8 bayt olmalıdır.");
  }
  if (typeof pin !== "string" || !/^\d{8}$/.test(pin)) throw new Error("Eşleştirme PIN’i 8 haneli olmalıdır.");

  const input = Buffer.alloc(12);
  input.write(accountId, 0, 8, "base64");
  input.writeUInt32LE(Number(pin), 8);
  return new Promise((resolve, reject) => {
    const child = spawn(helper, ["pair", ip], { windowsHide: true });
    const output = Buffer.alloc(38);
    let size = 0;
    let overflow = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 20000);
    child.on("error", () => reject(new Error("Başsız Remote Play bileşeni çalıştırılamadı.")));
    child.stdout.on("data", (chunk) => {
      if (size + chunk.length > output.length) overflow = true;
      else { chunk.copy(output, size); size += chunk.length; }
      chunk.fill(0);
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.stdin.end(input, () => input.fill(0));
    child.on("close", (code) => {
      clearTimeout(timer);
      input.fill(0);
      if (!overflow && code === 0 && size === output.length && output.subarray(0, 6).some(Boolean)) resolve(output);
      else {
        output.fill(0);
        reject(new Error(timedOut ? "PS5 eşleştirme isteği zaman aşımına uğradı."
          : "PS5 eşleştirmeyi kabul etmedi. Remote Play’i, hesabı ve PIN’i kontrol edin."));
      }
    });
  });
}

class Ps5 {
  constructor({ directory, helper, encrypt, decrypt, scan = discover, pair = pairing, spawnProcess = spawn, onVideo, onEnd }) {
    this.file = path.join(directory, "ps5-consoles.json");
    this.helper = helper;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.scan = scan;
    this.pairRequest = pair;
    this.spawn = spawnProcess;
    this.onVideo = onVideo;
    this.onEnd = onEnd;
    this.state = { stage: "idle" };
    this.child = null;
    this.operation = null;
  }

  snapshot() {
    const consoles = loadRecords(this.file).map(({ id, name, ip }) => ({ id, name, ip }));
    return { available: !!this.helper && existsSync(this.helper), consoles, ...this.state };
  }

  save(records) {
    const temp = this.file + ".new";
    writeFileSync(temp, JSON.stringify(records), { mode: 0o600 });
    renameSync(temp, this.file);
  }

  async discover() {
    const consoles = await this.scan();
    const records = loadRecords(this.file);
    const byId = new Map(consoles.map((console) => [console.id, console]));
    let changed = false;
    for (const record of records) {
      const seen = byId.get(record.id);
      if (seen && seen.ip !== record.ip) { record.ip = seen.ip; changed = true; }
    }
    if (changed) this.save(records);
    return consoles;
  }

  async pair(ip, account, pin, name) {
    if (!this.snapshot().available) throw new Error("Remote Play bileşeni bulunamadı.");
    if (this.operation) throw new Error("Başka bir PS5 işlemi sürüyor.");
    if (typeof name !== "string" || !name.trim() || name.length > 80) throw new Error("Konsol adı 1–80 karakter olmalıdır.");
    this.operation = "pair";
    let result;
    try {
      result = await this.pairRequest(this.helper, ip, account, pin);
      const id = result.subarray(0, 6).toString("hex");
      const record = { id, ip, name: name.trim(), secret: await this.encrypt(result.subarray(6).toString("base64")) };
      const records = loadRecords(this.file).filter((item) => item.id !== id);
      this.save([...records, record]);
      return this.snapshot();
    } finally {
      result?.fill(0);
      this.operation = null;
    }
  }

  forget(id) {
    if (this.operation || this.state.id === id && this.child) throw new Error("Önce PS5 işlemini durdurun.");
    this.save(loadRecords(this.file).filter((record) => record.id !== id));
    return this.snapshot();
  }

  async start(id, manualIp) {
    if (!this.snapshot().available) throw new Error("Remote Play bileşeni bulunamadı.");
    if (this.operation || this.child) throw new Error("Bir PS5 işlemi veya oturumu zaten açık.");
    if (manualIp && !validAddress(manualIp)) throw new Error("Geçerli bir PS5 IPv4 adresi girin.");
    this.operation = "start";
    let material;
    try {
      this.state = { stage: "discovering", id };
      const discovered = manualIp ? [] : await this.discover().catch(() => []);
      const record = loadRecords(this.file).find((item) => item.id === id);
      if (!record) throw new Error("Önce bir PS5 eşleştirin.");
      const seen = discovered.find((console) => console.id === id);
      if (seen?.standby) throw new Error("PS5 dinlenme modunda. Konsolu açıp yeniden deneyin.");
      const ip = manualIp || record.ip;
      material = Buffer.from(await this.decrypt(record.secret), "base64");
      if (material.length !== 32) throw new Error("PS5 anahtarları okunamadı. Konsolu yeniden eşleştirin.");
      const child = this.spawn(this.helper, ["stream", ip], { windowsHide: true });
      this.child = child;
      this.state = { stage: "connecting", id, ip };
      let stopping = false;
      const deadline = setTimeout(() => {
        if (this.state.stage !== "video") {
          this.state = { stage: "error", id, ip, error: "PS5 belirtilen adreste görüntü akışı başlatmadı." };
          child.stdin.end();
          setTimeout(() => child.kill(), 2000).unref();
        }
      }, 45000);
      const events = createInterface({ input: child.stderr });
      events.on("line", (line) => {
        if (stopping || this.child !== child) return;
        if (line === "connected" && this.state.stage !== "video") this.state = { stage: "connected", id, ip };
        if (line.startsWith("login-pin-")) this.state = { stage: "pin", id, ip, error: line.endsWith("incorrect") ? "PS5 giriş PIN’i yanlış." : null };
        if (line.startsWith("error:") || line.startsWith("quit:")) {
          this.state = { stage: "error", id, ip, error: line.split(":").slice(1).join(":").slice(0, 160) };
        }
      });
      child.stdout.on("data", (bytes) => {
        if (stopping || this.child !== child) return;
        if (this.state.stage !== "video") this.state = { stage: "video", id, ip };
        clearTimeout(deadline);
        this.onVideo?.(bytes, child.stdout);
      });
      child.on("error", () => { this.state = { stage: "error", id, ip, error: "Remote Play bileşeni çalıştırılamadı." }; });
      child.stdin.on("error", () => {});
      child.on("close", () => {
        clearTimeout(deadline);
        if (this.child !== child) return;
        this.child = null;
        this.end = null;
        if (stopping) this.state = { stage: "idle" };
        else if (this.state.stage !== "error") this.state = { stage: "error", id, ip, error: "Remote Play oturumu sona erdi." };
        this.onEnd?.();
      });
      this.end = () => {
        stopping = true;
        this.state = { stage: "stopping", id, ip };
        child.stdin.end();
        setTimeout(() => { if (this.child === child) child.kill(); }, 3000).unref();
      };
      const copy = material;
      child.stdin.write(copy, () => copy.fill(0));
      material = null;
      return this.snapshot();
    } catch (error) {
      this.state = { stage: "error", id, error: error.message };
      throw error;
    } finally {
      material?.fill(0);
      this.operation = null;
    }
  }

  login(pin) {
    if (this.state.stage !== "pin" || !this.child || typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
      throw new Error("PS5’in istediği 4 haneli kullanıcı giriş PIN’ini girin.");
    }
    this.child.stdin.write(pin + "\n");
  }

  stop() { this.end?.(); return this.snapshot(); }
}

module.exports = { Ps5, discover, parseDiscovery, validAddress, broadcastAddresses };
