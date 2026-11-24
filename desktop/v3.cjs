const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { createInterface } = require("node:readline");
const path = require("node:path");

const mainClass = "expo.modules.ps5translator.core.DesktopCoreKt";

class V3Runtime {
  constructor(directory, java) {
    this.directory = directory;
    this.java = java;
    this.pending = new Map();
    this.sequence = 0;
  }

  get available() {
    return ["ps5-v3.jar", "kotlin-stdlib.jar", "json.jar", "websocket.jar", "slf4j.jar"]
      .every((jar) => existsSync(path.join(this.directory, jar))) &&
      (this.java === "java" || existsSync(this.java));
  }

  start() {
    if (this.child) return this.child;
    if (!this.available) throw new Error("Windows V3 çalışma zamanı bulunamadı.");
    const classpath = ["ps5-v3.jar", "kotlin-stdlib.jar", "json.jar", "websocket.jar", "slf4j.jar"]
      .map((file) => path.join(this.directory, file)).join(path.delimiter);
    const child = spawn(this.java, ["-Dfile.encoding=UTF-8", "-cp", classpath, mainClass], { windowsHide: true });
    this.child = child;
    child.stderr.resume();
    child.stdin.on("error", () => {});
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (this.child !== child) return;
      try {
        const result = JSON.parse(line);
        const pending = this.pending.get(result.id);
        if (!pending) return;
        this.pending.delete(result.id);
        clearTimeout(pending.timeout);
        if (result.error) pending.reject(new Error(result.error));
        else pending.resolve(result.data);
      } catch { this.failed(child, "V3 çalışma zamanı geçersiz yanıt verdi."); }
    });
    child.on("error", () => this.failed(child, "V3 çalışma zamanı başlatılamadı."));
    child.on("close", () => this.failed(child, "V3 çalışma zamanı kapandı."));
    return child;
  }

  call(type, payload = {}) {
    if (this.pending.size >= 32) return Promise.reject(new Error("V3 işlem kuyruğu dolu."));
    return new Promise((resolve, reject) => {
      const child = this.start();
      const id = ++this.sequence;
      const timeout = setTimeout(() => this.failed(child, "V3 çalışma zamanı yanıt vermedi."), 8000);
      this.pending.set(id, { resolve, reject, timeout });
      child.stdin.write(JSON.stringify({ ...payload, type, id }) + "\n");
    });
  }

  failed(child, message) {
    if (this.child !== child) return;
    this.child = null;
    child.kill();
    for (const item of this.pending.values()) {
      clearTimeout(item.timeout);
      item.reject(new Error(message));
    }
    this.pending.clear();
  }

  stop() {
    const child = this.child;
    if (!child) return;
    child.stdin.end();
    setTimeout(() => { if (this.child === child) child.kill(); }, 1500).unref();
  }
}

module.exports = { V3Runtime };
