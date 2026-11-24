const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ps5Desktop", {
  ps5: {
    status: () => ipcRenderer.invoke("ps5:status"),
    discover: () => ipcRenderer.invoke("ps5:discover"),
    pair: (ip, account, pin, name) => ipcRenderer.invoke("ps5:pair", ip, account, pin, name),
    forget: (id) => ipcRenderer.invoke("ps5:forget", id),
    start: (id, ip, options) => ipcRenderer.invoke("ps5:start", id, ip, options),
    stop: () => ipcRenderer.invoke("ps5:stop"),
    login: (pin) => ipcRenderer.invoke("ps5:login", pin),
  },
  live: {
    status: () => ipcRenderer.invoke("live:status"),
    configure: (options) => ipcRenderer.invoke("live:configure", options),
    offline: () => ipcRenderer.invoke("live:offline"),
    translate: (input, options) => ipcRenderer.invoke("live:translate", input, options),
    keys: () => ipcRenderer.invoke("live:keys"),
    key: (engine, value) => ipcRenderer.invoke("live:key", engine, value),
    usage: (engine) => ipcRenderer.invoke("live:usage", engine),
  },
  tv: {
    status: () => ipcRenderer.invoke("tv:status"),
    start: (port, ip) => ipcRenderer.invoke("tv:start", port, ip),
    stop: () => ipcRenderer.invoke("tv:stop"),
    test: () => ipcRenderer.invoke("tv:test"),
  },
  archive: {
    games: () => ipcRenderer.invoke("archive:games"),
    create: (name) => ipcRenderer.invoke("archive:create", name),
    page: (game, search, before) => ipcRenderer.invoke("archive:page", game, search, before),
    edit: (id, text) => ipcRenderer.invoke("archive:edit", id, text),
    delete: (id) => ipcRenderer.invoke("archive:delete", id),
    export: (game) => ipcRenderer.invoke("archive:export", game),
    import: () => ipcRenderer.invoke("archive:import"),
  },
  getLanAddresses: () => ipcRenderer.invoke("desktop:lan-addresses"),
});
