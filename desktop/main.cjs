const { app, BrowserWindow, ipcMain } = require("electron");
const { networkInterfaces } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rendererPath = path.join(__dirname, "../dist/index.html");
const rendererUrl = pathToFileURL(rendererPath).href;

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
    ipcMain.handle("desktop:lan-addresses", (event) => {
      const frame = event.senderFrame;
      if (!frame || frame.parent || frame.url !== rendererUrl) {
        throw new Error("Yetkisiz ağ adresi isteği.");
      }
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
