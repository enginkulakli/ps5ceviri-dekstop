const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require("electron");
const { mkdirSync, renameSync, rmSync, readFileSync, statSync, writeFileSync, existsSync } = require("node:fs");
const { Ps5, validAddress } = require("./ps5.cjs");
const { Archive } = require("./archive.cjs");
const { V3Runtime } = require("./v3.cjs");
const { Translator } = require("./translation.cjs");
const { Live, optionsFrom, archiveKey } = require("./live.cjs");
const { networkInterfaces } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rendererPath = path.join(__dirname, "../dist/index.html");
const rendererUrl = pathToFileURL(rendererPath).href;

function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    const frame = event.senderFrame;
    if (!frame || frame.parent || frame.url !== rendererUrl) throw new Error("Yetkisiz masaüstü isteği.");
    return callback(...args);
  });
}

function remoteHelper() {
  if (process.env.PS5_REMOTE_HELPER) return path.resolve(process.env.PS5_REMOTE_HELPER);
  const name = process.platform === "win32" ? "ps5-remote.exe" : "ps5-remote";
  return app.isPackaged ? path.join(process.resourcesPath, "native", name)
    : path.join(__dirname, "../native-bin", name);
}

async function seal(secret) {
  if (!(await safeStorage.isAsyncEncryptionAvailable()) ||
      (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) {
    throw new Error("İşletim sisteminin güvenli anahtar deposu kullanılamıyor.");
  }
  return (await safeStorage.encryptStringAsync(secret)).toString("base64");
}

async function unseal(value) {
  return (await safeStorage.decryptStringAsync(Buffer.from(value, "base64"))).result;
}

let ps5;
let live;
let v3;

function setupServices(directory) {
  const runtime = app.isPackaged ? path.join(process.resourcesPath, "runtime") : path.join(__dirname, "../runtime-bin");
  const windows = process.platform === "win32";
  const bundledJava = path.join(runtime, "jre", "bin", windows ? "java.exe" : "java");
  const bundledDecoder = path.join(runtime, windows ? "ffmpeg.exe" : "ffmpeg");
  const required = windows || app.isPackaged;
  const java = required || existsSync(bundledJava) ? bundledJava : "java";
  const ffmpeg = required || existsSync(bundledDecoder) ? bundledDecoder : "ffmpeg";
  v3 = new V3Runtime(runtime, java);
  const archive = new Archive(path.join(directory, "translation-archive.db"));
  const keyFile = (engine) => {
    if (!["google_cloud", "ai"].includes(engine)) throw new Error("Geçersiz API sağlayıcısı.");
    return path.join(directory, engine + ".encrypted");
  };
  const readKey = async (engine) => {
    try { return await unseal(readFileSync(keyFile(engine), "utf8")); }
    catch (error) {
      if (error.code === "ENOENT") return null;
      throw new Error("API anahtarı okunamadı. Anahtarı yeniden girin.");
    }
  };

  const translator = new Translator({ directory, archive, v3, readKey });
  live = new Live({ ffmpeg, v3, archive, translator });
  ps5 = new Ps5({ directory, helper: remoteHelper(), encrypt: seal, decrypt: unseal,
    onVideo: (video, source) => live.feed(video, source),
    onEnd: () => live.stop(),
  });

  handle("live:status", () => live.snapshot());
  handle("live:configure", (options) => live.configure(options));
  handle("live:offline", async () => { await translator.prepareOffline(); return live.snapshot(); });
  handle("live:translate", async (input, settings) => {
    if (typeof input !== "string" || !input.trim() || input.length > 1200) throw new Error("İngilizce metin 1–1200 karakter olmalıdır.");
    const options = optionsFrom(settings);
    const source = input.trim();
    const [normalized] = await v3.call("normalize", { values: [source] });
    const key = archiveKey(options, source, normalized);
    const stored = archive.lookup(key, options);
    if (stored) return { text: stored, cached: true };
    const text = await translator.translate(source, options);
    archive.store(key, text);
    return { text, cached: false };
  });
  handle("live:keys", () => ({ google_cloud: existsSync(keyFile("google_cloud")), ai: existsSync(keyFile("ai")) }));
  handle("live:key", async (engine, value) => {
    const file = keyFile(engine);
    if (typeof value !== "string" || value.length > 300 || /[^\x21-\x7e]/.test(value)) {
      throw new Error("Geçerli bir API anahtarı girin.");
    }
    if (!value) rmSync(file, { force: true });
    else {
      const temp = file + ".new";
      writeFileSync(temp, await seal(value), { mode: 0o600 });
      renameSync(temp, file);
    }
  });
  handle("live:usage", (engine) => { keyFile(engine); return archive.usage(engine); });
  handle("tv:status", async () => v3.available
    ? { available: true, ...await v3.call("tvStatus") }
    : { available: false, running: false, clients: [], overlayClients: 0, sentCount: 0, rejectedCount: 0 });
  handle("tv:start", (port, allowedIp) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535 || allowedIp && !validAddress(allowedIp)) {
      throw new Error("TV IPv4 adresini ve portu kontrol edin.");
    }
    return v3.call("tvStart", { port, allowedIp: allowedIp || "" });
  });
  handle("tv:stop", () => v3.call("tvStop"));
  handle("tv:test", async () => {
    const current = await v3.call("tvStatus");
    if (!current.running || !current.clients.length) throw new Error("Önce TV istemcisini sunucuya bağlayın.");
    return v3.call("tvTest");
  });
  handle("archive:games", () => archive.games());
  handle("archive:create", (name) => archive.createGame(name));
  handle("archive:page", (...args) => archive.records(...args));
  handle("archive:edit", (...args) => archive.edit(...args));
  handle("archive:delete", (id) => archive.delete(id));
  handle("archive:export", async (game) => {
    const result = await dialog.showSaveDialog({ defaultPath: "ps5ceviri-arsiv.json", filters: [{ name: "PS5 Çevirmen arşivi", extensions: ["json"] }] });
    if (result.canceled || !result.filePath) return false;
    writeFileSync(result.filePath, JSON.stringify(archive.export(game || null)));
    return true;
  });
  handle("archive:import", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "PS5 Çevirmen arşivi", extensions: ["json"] }] });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if (statSync(file).size > 24 * 1024 * 1024) throw new Error("Arşiv dosyası 24 MB sınırını aşıyor.");
    return archive.import(JSON.parse(readFileSync(file, "utf8")), v3);
  });
}

function createWindow() {
  const window = new BrowserWindow({
    title: "PS5 Çevirmen",
    width: 1120,
    height: 780,
    minWidth: 680,
    minHeight: 500,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  void window.loadFile(rendererPath);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) {
      if (app.isReady()) createWindow();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(() => {
    const directory = app.getPath("userData");
    mkdirSync(directory, { recursive: true });
    setupServices(directory);
    handle("ps5:status", () => ps5.snapshot());
    handle("ps5:discover", () => ps5.discover());
    handle("ps5:pair", (...args) => ps5.pair(...args));
    handle("ps5:forget", (id) => ps5.forget(id));
    handle("ps5:start", async (id, ip, options) => {
      if (ps5.child || ps5.operation || live.state.active) throw new Error("Bir PS5 işlemi veya oturumu zaten açık.");
      try {
        await live.start(options);
        return await ps5.start(id, ip);
      } catch (error) {
        live.stop();
        throw error;
      }
    });
    handle("ps5:stop", () => ps5.stop());
    handle("ps5:login", (pin) => ps5.login(pin));
    handle("desktop:lan-addresses", () => {
      return [...new Set(Object.values(networkInterfaces()).flatMap((entries) =>
        (entries ?? [])
          .filter(({ family, internal, address }) =>
            family === "IPv4" && !internal && !address.startsWith("169.254."))
          .map(({ address }) => address)))].sort();
    });

    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  live?.stop();
  v3?.stop();
  ps5?.stop();
});
