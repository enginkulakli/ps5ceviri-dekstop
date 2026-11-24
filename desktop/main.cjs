const { app, BrowserWindow, ipcMain, safeStorage } = require("electron");
const { mkdirSync } = require("node:fs");
const { Ps5 } = require("./ps5.cjs");
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
    ps5 = new Ps5({ directory, helper: remoteHelper(), encrypt: seal, decrypt: unseal });
    handle("ps5:status", () => ps5.snapshot());
    handle("ps5:discover", () => ps5.discover());
    handle("ps5:pair", (...args) => ps5.pair(...args));
    handle("ps5:forget", (id) => ps5.forget(id));
    handle("ps5:start", (id, ip) => ps5.start(id, ip));
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

app.on("before-quit", () => ps5?.stop());
