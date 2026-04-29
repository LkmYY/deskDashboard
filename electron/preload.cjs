const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("deskDashboard", {
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  scanWorkspace: (rootPath) => ipcRenderer.invoke("workspace:scan", rootPath),
  loadState: () => ipcRenderer.invoke("state:load"),
  saveState: (state) => ipcRenderer.invoke("state:save", state),
  openProject: (projectPath) => ipcRenderer.invoke("project:open", projectPath)
});
