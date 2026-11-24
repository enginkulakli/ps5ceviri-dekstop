const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ps5Desktop", {
  getLanAddresses: () => ipcRenderer.invoke("desktop:lan-addresses"),
});
