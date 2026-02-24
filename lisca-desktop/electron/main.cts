import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import initSqlJs, { type Database } from "sql.js";
import * as UTIF from "utif2";
import {
  computeAssayYamlHealth,
  findMatchingTiffFilename,
  scanFolder,
  type FolderScan,
} from "./lib/scan-utils.cjs";

const DEV_SERVER_URL = "http://localhost:5173";
const DB_FILENAME = "lisca-desktop.sqlite";

type AssayType = "killing" | "expression";

interface AssayRow {
  id: string;
  name: string;
  time: string;
  type: AssayType;
  folder: string;
  created_at: number;
  updated_at: number;
}

interface AssayListItem {
  id: string;
  name: string;
  time: string;
  type: AssayType;
  folder: string;
  has_assay_yaml: boolean;
  missing_reason?: string;
}

interface AssayMeta {
  id?: string;
  name: string;
  time: string;
  type: AssayType;
  folder: string;
}

interface ReadImageRequest {
  folder: string;
  pos: number;
  channel: number;
  time: number;
  z: number;
}

interface ReadImageSuccess {
  ok: true;
  baseName: string;
  width: number;
  height: number;
  rgba: ArrayBuffer;
}

interface ReadImageFailure {
  ok: false;
  error: string;
}

type ReadImageResponse = ReadImageSuccess | ReadImageFailure;

let dbRef: Database | null = null;

function getDbPath(): string {
  return path.join(app.getPath("userData"), DB_FILENAME);
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

async function persistDb(db: Database): Promise<void> {
  const targetPath = getDbPath();
  const dir = path.dirname(targetPath);
  const tempPath = path.join(dir, `${DB_FILENAME}.${process.pid}-${Date.now()}.tmp`);
  await mkdir(dir, { recursive: true });
  await writeFile(tempPath, Buffer.from(db.export()));
  await copyFile(tempPath, targetPath);
  await unlink(tempPath);
}

async function ensureDb(): Promise<Database> {
  if (dbRef) return dbRef;

  const SQL = await initSqlJs({
    locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
  });

  let db: Database;
  try {
    const bytes = await readFile(getDbPath());
    db = new SQL.Database(new Uint8Array(bytes));
  } catch {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS assays (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      time TEXT NOT NULL,
      type TEXT NOT NULL,
      folder TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  dbRef = db;
  return dbRef;
}

function normalizeAssayType(value: unknown): AssayType {
  return value === "expression" ? "expression" : "killing";
}

function rowFromObject(row: Record<string, unknown>): AssayRow {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    time: String(row.time ?? ""),
    type: normalizeAssayType(row.type),
    folder: String(row.folder ?? ""),
    created_at: Number(row.created_at ?? 0),
    updated_at: Number(row.updated_at ?? 0),
  };
}

async function listAssays(): Promise<AssayListItem[]> {
  const db = await ensureDb();
  const stmt = db.prepare(
    "SELECT id, name, time, type, folder, created_at, updated_at FROM assays ORDER BY updated_at DESC",
  );

  const rows: AssayRow[] = [];
  while (stmt.step()) {
    rows.push(rowFromObject(stmt.getAsObject() as Record<string, unknown>));
  }
  stmt.free();

  const out: AssayListItem[] = [];
  for (const row of rows) {
    const health = await computeAssayYamlHealth(row.folder);
    out.push({
      id: row.id,
      name: row.name,
      time: row.time,
      type: row.type,
      folder: row.folder,
      has_assay_yaml: health.has_assay_yaml,
      missing_reason: health.missing_reason,
    });
  }
  return out;
}

async function removeAssay(id: string): Promise<boolean> {
  const db = await ensureDb();
  db.run("DELETE FROM assays WHERE id = ?", [id]);
  await persistDb(db);
  return true;
}

async function upsertAssay(meta: AssayMeta): Promise<{ id: string }> {
  const name = String(meta.name ?? "").trim();
  const time = String(meta.time ?? "").trim();
  const folder = String(meta.folder ?? "").trim();
  const type = normalizeAssayType(meta.type);

  if (!name || !time || !folder) {
    throw new Error("name, time, and folder are required");
  }

  const db = await ensureDb();
  const now = Date.now();

  let id = meta.id?.trim() || "";
  if (!id) {
    const byFolder = db.prepare("SELECT id FROM assays WHERE folder = ?");
    byFolder.bind([folder]);
    if (byFolder.step()) {
      const row = byFolder.getAsObject() as { id?: unknown };
      id = String(row.id ?? "");
    }
    byFolder.free();
  }
  if (!id) id = crypto.randomUUID();

  db.run(
    `
    INSERT INTO assays (id, name, time, type, folder, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(folder) DO UPDATE SET
      name = excluded.name,
      time = excluded.time,
      type = excluded.type,
      updated_at = excluded.updated_at
    `,
    [id, name, time, type, folder, now, now],
  );

  const confirm = db.prepare("SELECT id FROM assays WHERE folder = ?");
  confirm.bind([folder]);
  let resolvedId = id;
  if (confirm.step()) {
    const row = confirm.getAsObject() as { id?: unknown };
    resolvedId = String(row.id ?? id);
  }
  confirm.free();

  await persistDb(db);
  return { id: resolvedId };
}

function normalizeRgbaInPlace(rgba: Uint8Array, width: number, height: number): void {
  const n = width * height;
  let min = 255;
  let max = 0;

  for (let i = 0; i < n; i += 1) {
    const j = i * 4;
    const lum = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }

  if (max <= min) return;

  const scale = 255 / (max - min);
  for (let i = 0; i < n; i += 1) {
    const j = i * 4;
    const lum = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    const newLum = (lum - min) * scale;
    const factor = lum > 0 ? newLum / lum : 0;
    rgba[j] = Math.max(0, Math.min(255, Math.round(rgba[j] * factor)));
    rgba[j + 1] = Math.max(0, Math.min(255, Math.round(rgba[j + 1] * factor)));
    rgba[j + 2] = Math.max(0, Math.min(255, Math.round(rgba[j + 2] * factor)));
  }
}

async function readPositionImage(request: ReadImageRequest): Promise<ReadImageResponse> {
  try {
    const posDir = path.join(request.folder, `Pos${request.pos}`);
    const entries = await readdir(posDir, { withFileTypes: true });
    const filename = findMatchingTiffFilename(
      entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
      request,
    );

    if (!filename) {
      return { ok: false, error: "Requested TIFF was not found in position folder." };
    }

    const filePath = path.join(posDir, filename);
    const fileBytes = await readFile(filePath);
    const buffer = toArrayBuffer(fileBytes);
    const ifds = UTIF.decode(buffer);
    if (ifds.length === 0) {
      return { ok: false, error: "Could not decode TIFF file." };
    }

    UTIF.decodeImage(buffer, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const width = ifds[0].width;
    const height = ifds[0].height;
    normalizeRgbaInPlace(rgba, width, height);

    const copy = new Uint8Array(rgba.length);
    copy.set(rgba);

    return {
      ok: true,
      baseName: path.parse(filename).name,
      width,
      height,
      rgba: toArrayBuffer(copy),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || "Failed to read image." };
  }
}

async function saveBbox(payload: { folder: string; pos: number; csv: string }): Promise<{
  ok: true;
} | {
  ok: false;
  error: string;
}> {
  try {
    const filePath = path.join(payload.folder, `Pos${payload.pos}_bbox.csv`);
    await writeFile(filePath, payload.csv.endsWith("\n") ? payload.csv : `${payload.csv}\n`, "utf8");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || "Failed to save bbox." };
  }
}

function registerIpc(): void {
  ipcMain.handle("assays:list", async () => listAssays());
  ipcMain.handle("assays:remove", async (_event, id: string) => removeAssay(id));
  ipcMain.handle("assays:upsert", async (_event, meta: AssayMeta) => upsertAssay(meta));

  ipcMain.handle("assays:pick-data-folder", async (): Promise<{ path: string } | null> => {
    const result = await dialog.showOpenDialog({
      title: "Select data folder",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return { path: result.filePaths[0] };
  });

  ipcMain.handle(
    "assays:read-yaml",
    async (_event, folder: string): Promise<{ ok: true; yaml: string } | { ok: false; error: string }> => {
      try {
        const assayPath = path.join(folder, "assay.yaml");
        const yaml = await readFile(assayPath, "utf8");
        return { ok: true, yaml };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message || "Failed to read assay.yaml" };
      }
    },
  );

  ipcMain.handle(
    "assays:write-yaml",
    async (
      _event,
      folder: string,
      yaml: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const assayPath = path.join(folder, "assay.yaml");
        await writeFile(assayPath, yaml.endsWith("\n") ? yaml : `${yaml}\n`, "utf8");
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message || "Failed to write assay.yaml" };
      }
    },
  );

  ipcMain.handle("register:scan", async (_event, folder: string): Promise<FolderScan> => scanFolder(folder));

  ipcMain.handle("register:read-image", async (_event, payload: ReadImageRequest) =>
    readPositionImage(payload),
  );

  ipcMain.handle("register:save-bbox", async (_event, payload: { folder: string; pos: number; csv: string }) =>
    saveBbox(payload),
  );

  ipcMain.handle("assays:path-exists", async (_event, folder: string): Promise<boolean> => {
    try {
      await access(folder, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (!app.isPackaged) {
    win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
    return;
  }

  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (dbRef) {
    dbRef.close();
    dbRef = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
