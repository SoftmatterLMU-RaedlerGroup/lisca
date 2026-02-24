import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("liscaDesktop", {
  platform: process.platform,
  assays: {
    list: () => ipcRenderer.invoke("assays:list"),
    remove: (id: string) => ipcRenderer.invoke("assays:remove", id) as Promise<boolean>,
    upsert: (meta: unknown) => ipcRenderer.invoke("assays:upsert", meta) as Promise<{ id: string }>,
    pickDataFolder: () =>
      ipcRenderer.invoke("assays:pick-data-folder") as Promise<{ path: string } | null>,
    readYaml: (folder: string) =>
      ipcRenderer.invoke("assays:read-yaml", folder) as Promise<
        { ok: true; yaml: string } | { ok: false; error: string }
      >,
    writeYaml: (folder: string, yaml: string) =>
      ipcRenderer.invoke("assays:write-yaml", folder, yaml) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    pathExists: (folder: string) => ipcRenderer.invoke("assays:path-exists", folder) as Promise<boolean>,
  },
  register: {
    scan: (folder: string) => ipcRenderer.invoke("register:scan", folder),
    readImage: (payload: unknown) => ipcRenderer.invoke("register:read-image", payload),
    saveBbox: (payload: unknown) => ipcRenderer.invoke("register:save-bbox", payload),
  },
});
