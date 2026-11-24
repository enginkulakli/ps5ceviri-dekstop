const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ps5Desktop", {
  ps5: {
    status: () => ipcRenderer.invoke("ps5:status"),
    discover: () => ipcRenderer.invoke("ps5:discover"),
    pair: (ip, account, pin, name) => ipcRenderer.invoke("ps5:pair", ip, account, pin, name),
    forget: (id) => ipcRenderer.invoke("ps5:forget", id),
    start: (id, ip) => ipcRenderer.invoke("ps5:start", id, ip),
    stop: () => ipcRenderer.invoke("ps5:stop"),
    login: (pin) => ipcRenderer.invoke("ps5:login", pin),
  },
  getLanAddresses: () => ipcRenderer.invoke("desktop:lan-addresses"),
});
