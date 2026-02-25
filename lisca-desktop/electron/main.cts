import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import initSqlJs, { type Database } from "sql.js";
import * as UTIF from "utif2";
import type { Array as ZarritaArray, DataType, Location } from "zarrita";
import type { Readable } from "@zarrita/storage";
import type FileSystemStore from "@zarrita/storage/fs";
import {
  computeAssayYamlHealth,
  TIFF_RE,
  parsePosDirName,
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

interface ReadRegistrationRequest {
  folder: string;
  pos: number;
}

interface ReadRegistrationSuccess {
  ok: true;
  yaml: string;
}

interface ReadRegistrationFailure {
  ok: false;
  error: string;
  code: "not_found" | "read_error";
}

type ReadRegistrationResponse = ReadRegistrationSuccess | ReadRegistrationFailure;

interface AutoRegisterRequest {
  folder: string;
  pos: number;
  channel: number;
  time: number;
  z: number;
  grid: "square" | "hex";
  w: number;
  h: number;
}

interface AutoRegisterParams {
  shape: "square" | "hex";
  a: number;
  alpha: number;
  b: number;
  beta: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
}

interface AutoRegisterDiagnostics {
  detected_points: number;
  inlier_points: number;
  initial_mse: number;
  final_mse: number;
}

interface AutoRegisterSuccess {
  ok: true;
  params: AutoRegisterParams;
  diagnostics?: AutoRegisterDiagnostics;
}

interface AutoRegisterFailure {
  ok: false;
  error: string;
  code?: "binary_not_found" | "exec_error" | "invalid_json" | "invalid_payload";
  stderr?: string;
}

type AutoRegisterResponse = AutoRegisterSuccess | AutoRegisterFailure;

interface TaskProgressEvent {
  progress: number;
  message: string;
  timestamp: string;
}

interface TaskRecord {
  id: string;
  kind: string;
  status: "running" | "succeeded" | "failed";
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  logs: string[];
  progress_events: TaskProgressEvent[];
}

type TaskUpdate = Partial<
  Pick<TaskRecord, "status" | "started_at" | "finished_at" | "result" | "error" | "logs" | "progress_events">
>;

interface RunRegisterAutoDetectRequest extends AutoRegisterRequest {
  taskId: string;
}

interface DiscoverRoiRequest {
  folder: string;
  pos: number;
}

interface DiscoverRoiResponse {
  crops: Array<{ cropId: string; shape: number[] }>;
}

interface LoadRoiFrameRequest {
  folder: string;
  pos: number;
  cropId: string;
  t: number;
  c: number;
  z: number;
}

interface LoadRoiFrameSuccess {
  ok: true;
  width: number;
  height: number;
  data: ArrayBuffer;
}

interface LoadRoiFrameFailure {
  ok: false;
  error: string;
}

type LoadRoiFrameResponse = LoadRoiFrameSuccess | LoadRoiFrameFailure;

interface RunCropTaskRequest {
  taskId: string;
  folder: string;
  pos: number;
  background: boolean;
}

interface RunCropTaskSuccess {
  ok: true;
  output: string;
}

interface RunCropTaskFailure {
  ok: false;
  error: string;
  code?: "binary_not_found" | "exec_error";
}

type RunCropTaskResponse = RunCropTaskSuccess | RunCropTaskFailure;

interface RunKillingPredictRequest {
  taskId: string;
  folder: string;
  pos: number;
  batchSize?: number;
  cpu?: boolean;
}

interface KillPredictionRow {
  t: number;
  crop: string;
  label: boolean;
}

interface RunKillingPredictSuccess {
  ok: true;
  output: string;
  rows: KillPredictionRow[];
}

interface RunKillingPredictFailure {
  ok: false;
  error: string;
  code?: "binary_not_found" | "exec_error";
}

type RunKillingPredictResponse = RunKillingPredictSuccess | RunKillingPredictFailure;

interface DownloadAssetsSuccess {
  ok: true;
  modelDir: string;
  ffmpegPath: string;
  downloadedFiles: string[];
}

interface DownloadAssetsFailure {
  ok: false;
  error: string;
}

type DownloadAssetsResponse = DownloadAssetsSuccess | DownloadAssetsFailure;

type DownloadAssetsProgressPhase =
  | "start"
  | "model"
  | "ffmpeg"
  | "extract"
  | "finalize"
  | "done"
  | "error";

interface DownloadAssetsProgress {
  phase: DownloadAssetsProgressPhase;
  progress: number;
  message: string;
}

interface AssetStatusSuccess {
  ok: true;
  modelPath: string;
  ffmpegPath: string;
  missing: string[];
  allPresent: boolean;
}

interface AssetStatusFailure {
  ok: false;
  error: string;
}

type AssetStatusResponse = AssetStatusSuccess | AssetStatusFailure;

let dbRef: Database | null = null;
const TIFF_INDEX_CACHE_TTL_MS = 2500;

interface ParsedTiffMeta {
  strict: boolean;
  channel: number | null;
  position: number | null;
  time: number | null;
  z: number | null;
}

interface TiffCandidate {
  filename: string;
  filePath: string;
  meta: ParsedTiffMeta;
}

interface TiffCacheEntry {
  expiresAt: number;
  candidates: TiffCandidate[];
}

const tiffCache = new Map<string, TiffCacheEntry>();

type ZarrArrayHandle = ZarritaArray<DataType, Readable>;
type ZarrChunk = Awaited<ReturnType<ZarrArrayHandle["getChunk"]>>;
type ZarrLocation = Location<Readable>;

interface RoiZarrContext {
  root: ZarrLocation;
  arrays: Map<string, Promise<ZarrArrayHandle>>;
}

let zarrModulePromise: Promise<typeof import("zarrita")> | null = null;
let fsStoreCtorPromise: Promise<typeof FileSystemStore> | null = null;
const roiZarrContextByStorePath = new Map<string, RoiZarrContext>();

const MODEL_DOWNLOADS = [
  {
    name: "model.onnx",
    url: "https://huggingface.co/keejkrej/resnet18/resolve/main/model.onnx",
  },
  {
    name: "config.json",
    url: "https://huggingface.co/keejkrej/resnet18/resolve/main/config.json",
  },
  {
    name: "preprocessor_config.json",
    url: "https://huggingface.co/keejkrej/resnet18/resolve/main/preprocessor_config.json",
  },
] as const;

const FFMPEG_ZIP_URL =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
const SETTINGS_DOWNLOAD_PROGRESS_CHANNEL = "settings:download-assets-progress";

function getDbPath(): string {
  return path.join(app.getPath("userData"), DB_FILENAME);
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

function roiStorePath(folder: string, pos: number): string {
  return path.join(folder, `Pos${pos}_roi.zarr`);
}

function bboxCsvPath(folder: string, pos: number): string {
  return path.join(folder, `Pos${pos}_bbox.csv`);
}

function killPredictionCsvPath(folder: string, pos: number): string {
  return path.join(folder, `Pos${pos}_prediction.csv`);
}

function defaultKillModelDir(): string {
  return path.join(os.homedir(), ".lisca", "models", "resnet18");
}

function defaultLiscaBinDir(): string {
  return path.join(os.homedir(), ".lisca", "bin");
}

function defaultKillModelPath(): string {
  return path.join(defaultKillModelDir(), "model.onnx");
}

function defaultFfmpegPath(): string {
  return path.join(defaultLiscaBinDir(), "ffmpeg.exe");
}

async function isReadable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

interface DownloadFileOptions {
  onProgress?: (downloadedBytes: number, totalBytes: number | null) => void;
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function emitDownloadAssetsProgress(
  onProgress: ((event: DownloadAssetsProgress) => void) | undefined,
  event: DownloadAssetsProgress,
): void {
  if (!onProgress) return;
  onProgress({
    ...event,
    progress: clampProgress(event.progress),
  });
}

async function downloadFile(url: string, outputPath: string, options?: DownloadFileOptions): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }

  const tempPath = `${outputPath}.tmp-${Date.now()}`;
  await mkdir(path.dirname(outputPath), { recursive: true });

  const contentLengthHeader = response.headers.get("content-length");
  const parsedLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : NaN;
  const totalBytes = Number.isFinite(parsedLength) && parsedLength > 0 ? parsedLength : null;

  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    options?.onProgress?.(bytes.byteLength, totalBytes ?? bytes.byteLength);
    await writeFile(tempPath, bytes);
    await rename(tempPath, outputPath);
    return;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let downloadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    chunks.push(chunk);
    downloadedBytes += chunk.byteLength;
    options?.onProgress?.(downloadedBytes, totalBytes);
  }

  const bytes = Buffer.concat(chunks);
  options?.onProgress?.(bytes.byteLength, totalBytes ?? bytes.byteLength);
  await writeFile(tempPath, bytes);
  await rename(tempPath, outputPath);
}

async function extractZipOnWindows(zipPath: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  const runProcess = async (binary: string, args: string[]): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      execFile(
        binary,
        args,
        { windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error((stderr || stdout || error.message).toString().trim()));
            return;
          }
          resolve(String(stdout ?? "").trim());
        },
      );
    });
  };

  const errors: string[] = [];

  // Strategy 1: bsdtar on modern Windows images.
  try {
    await runProcess("tar.exe", ["-xf", zipPath, "-C", destination]);
    return;
  } catch (error) {
    errors.push(`tar.exe failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Strategy 2: .NET ZipFile API (does not depend on PowerShell Archive module autoload).
  try {
    const escapedZipPath = zipPath.replace(/'/g, "''");
    const escapedDestination = destination.replace(/'/g, "''");
    const script =
      `$ErrorActionPreference='Stop'; ` +
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
      `[System.IO.Compression.ZipFile]::ExtractToDirectory('${escapedZipPath}','${escapedDestination}',$true)`;
    await runProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return;
  } catch (error) {
    errors.push(`ZipFile extract failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(`Failed to extract ffmpeg archive. ${errors.join(" | ")}`);
}

async function findFirstFileRecursive(
  root: string,
  filename: string,
  maxDepth = 8,
  depth = 0,
): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
      return fullPath;
    }
  }
  if (depth >= maxDepth) return null;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nestedPath = path.join(root, entry.name);
    try {
      const found = await findFirstFileRecursive(nestedPath, filename, maxDepth, depth + 1);
      if (found) return found;
    } catch {
      // Ignore unreadable nested folders.
    }
  }
  return null;
}

async function downloadDefaultAssets(
  onProgress?: (event: DownloadAssetsProgress) => void,
): Promise<DownloadAssetsResponse> {
  let lastProgress = 0;
  const reportProgress = (event: DownloadAssetsProgress): void => {
    lastProgress = clampProgress(event.progress);
    emitDownloadAssetsProgress(onProgress, event);
  };

  const reportRangedDownload = (
    phase: DownloadAssetsProgressPhase,
    message: string,
    start: number,
    end: number,
  ): ((downloadedBytes: number, totalBytes: number | null) => void) => {
    let lastBucket = -1;
    return (downloadedBytes: number, totalBytes: number | null) => {
      const rawProgress =
        totalBytes && totalBytes > 0 ? downloadedBytes / totalBytes : downloadedBytes > 0 ? 0.95 : 0;
      const normalized = clampProgress(rawProgress);
      const progress = start + (end - start) * normalized;
      const bucket = Math.floor(progress * 100);
      if (bucket === lastBucket && normalized < 1) return;
      lastBucket = bucket;
      reportProgress({
        phase,
        progress,
        message,
      });
    };
  };

  try {
    reportProgress({
      phase: "start",
      progress: 0,
      message: "Starting asset download...",
    });

    const modelDir = defaultKillModelDir();
    const binDir = defaultLiscaBinDir();
    const downloadedFiles: string[] = [];
    const modelRangeStart = 0.02;
    const modelRangeEnd = 0.62;
    const modelSpan = modelRangeEnd - modelRangeStart;
    const modelStep = modelSpan / MODEL_DOWNLOADS.length;

    for (const [index, item] of MODEL_DOWNLOADS.entries()) {
      const outputPath = path.join(modelDir, item.name);
      const stepStart = modelRangeStart + modelStep * index;
      const stepEnd = stepStart + modelStep;
      reportProgress({
        phase: "model",
        progress: stepStart,
        message: `Checking ${item.name}...`,
      });
      if (await isReadable(outputPath)) {
        reportProgress({
          phase: "model",
          progress: stepEnd,
          message: `${item.name} already present, skipping.`,
        });
        continue;
      }
      reportProgress({
        phase: "model",
        progress: stepStart,
        message: `Downloading ${item.name}...`,
      });
      await downloadFile(item.url, outputPath, {
        onProgress: reportRangedDownload("model", `Downloading ${item.name}...`, stepStart, stepEnd),
      });
      reportProgress({
        phase: "model",
        progress: stepEnd,
        message: `Downloaded ${item.name}.`,
      });
      downloadedFiles.push(outputPath);
    }

    const ffmpegPath = defaultFfmpegPath();
    const ffmpegExists = await isReadable(ffmpegPath);

    if (!ffmpegExists && process.platform !== "win32") {
      reportProgress({
        phase: "error",
        progress: lastProgress,
        message: "ffmpeg.exe download is only supported on Windows.",
      });
      return {
        ok: false,
        error: "ffmpeg.exe download is only supported on Windows.",
      };
    }

    reportProgress({
      phase: "ffmpeg",
      progress: 0.62,
      message: "Checking ffmpeg.exe...",
    });
    if (ffmpegExists) {
      reportProgress({
        phase: "finalize",
        progress: 0.96,
        message: "ffmpeg.exe already present, skipping.",
      });
    } else {
      const tempRoot = path.join(os.tmpdir(), `lisca-ffmpeg-${Date.now()}`);
      const zipPath = path.join(tempRoot, "ffmpeg.zip");
      const extractRoot = path.join(tempRoot, "extract");

      try {
        await mkdir(tempRoot, { recursive: true });
        reportProgress({
          phase: "ffmpeg",
          progress: 0.62,
          message: "Downloading ffmpeg archive...",
        });
        await downloadFile(FFMPEG_ZIP_URL, zipPath, {
          onProgress: reportRangedDownload("ffmpeg", "Downloading ffmpeg archive...", 0.62, 0.9),
        });
        reportProgress({
          phase: "extract",
          progress: 0.9,
          message: "Extracting ffmpeg archive...",
        });
        await extractZipOnWindows(zipPath, extractRoot);
        const discovered = await findFirstFileRecursive(extractRoot, "ffmpeg.exe");
        if (!discovered) {
          throw new Error("ffmpeg.exe not found in downloaded archive.");
        }
        reportProgress({
          phase: "finalize",
          progress: 0.96,
          message: "Installing ffmpeg.exe...",
        });
        await mkdir(binDir, { recursive: true });
        await copyFile(discovered, ffmpegPath);
        downloadedFiles.push(ffmpegPath);
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    }

    reportProgress({
      phase: "done",
      progress: 1,
      message:
        downloadedFiles.length > 0 ? "Assets downloaded successfully." : "All required assets are already present.",
    });

    return {
      ok: true,
      modelDir,
      ffmpegPath,
      downloadedFiles,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportProgress({
      phase: "error",
      progress: lastProgress,
      message: message || "Failed to download default assets.",
    });
    return {
      ok: false,
      error: message || "Failed to download default assets.",
    };
  }
}

async function getAssetStatus(): Promise<AssetStatusResponse> {
  try {
    const modelPath = defaultKillModelPath();
    const ffmpegPath = defaultFfmpegPath();
    const missing: string[] = [];

    try {
      await access(modelPath, constants.R_OK);
    } catch {
      missing.push(modelPath);
    }
    try {
      await access(ffmpegPath, constants.R_OK);
    } catch {
      missing.push(ffmpegPath);
    }

    return {
      ok: true,
      modelPath,
      ffmpegPath,
      missing,
      allPresent: missing.length === 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: message || "Failed to check asset status.",
    };
  }
}

async function getZarrDeps(): Promise<{
  zarr: typeof import("zarrita");
  FileSystemStore: typeof FileSystemStore;
}> {
  if (!zarrModulePromise) {
    zarrModulePromise = import("zarrita");
  }
  if (!fsStoreCtorPromise) {
    fsStoreCtorPromise = import("@zarrita/storage/fs").then((module) => module.default);
  }
  return {
    zarr: await zarrModulePromise,
    FileSystemStore: await fsStoreCtorPromise,
  };
}

async function getRoiZarrContext(storePath: string): Promise<RoiZarrContext> {
  const existing = roiZarrContextByStorePath.get(storePath);
  if (existing) return existing;

  const { zarr, FileSystemStore } = await getZarrDeps();
  const store = new FileSystemStore(storePath);
  const root: ZarrLocation = zarr.root(store);
  const context: RoiZarrContext = { root, arrays: new Map() };
  roiZarrContextByStorePath.set(storePath, context);
  return context;
}

async function getCachedRoiArray(storePath: string, cropId: string): Promise<ZarrArrayHandle> {
  const context = await getRoiZarrContext(storePath);
  const existing = context.arrays.get(cropId);
  if (existing) return existing;

  const { zarr } = await getZarrDeps();
  const created = zarr.open.v3(context.root.resolve(`roi/${cropId}/raw`), { kind: "array" });
  created.catch(() => {
    const current = context.arrays.get(cropId);
    if (current === created) context.arrays.delete(cropId);
  });
  context.arrays.set(cropId, created);
  return created;
}

async function discoverRoiCrops(payload: DiscoverRoiRequest): Promise<DiscoverRoiResponse> {
  const out: DiscoverRoiResponse = { crops: [] };
  const storePath = roiStorePath(payload.folder, payload.pos);
  const roiDir = path.join(storePath, "roi");

  let cropIds: string[] = [];
  try {
    const entries = await readdir(roiDir, { withFileTypes: true });
    cropIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    cropIds.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return out;
  }

  for (const cropId of cropIds) {
    try {
      const arr = await getCachedRoiArray(storePath, cropId);
      out.crops.push({ cropId, shape: [...arr.shape] });
    } catch {
      // Skip unreadable crops.
    }
  }

  return out;
}

async function loadRoiFrame(payload: LoadRoiFrameRequest): Promise<LoadRoiFrameResponse> {
  const storePath = roiStorePath(payload.folder, payload.pos);
  const key = payload.cropId;
  try {
    const context = await getRoiZarrContext(storePath);
    let arr = await getCachedRoiArray(storePath, payload.cropId);
    let chunk: ZarrChunk;
    try {
      chunk = await arr.getChunk([payload.t, payload.c, payload.z, 0, 0]);
    } catch {
      context.arrays.delete(key);
      arr = await getCachedRoiArray(storePath, payload.cropId);
      chunk = await arr.getChunk([payload.t, payload.c, payload.z, 0, 0]);
    }

    const source = chunk.data;
    const typed =
      source instanceof Uint16Array ? source : Uint16Array.from(source as ArrayLike<number>);
    const output = new Uint16Array(typed.length);
    output.set(typed);
    const height = chunk.shape[chunk.shape.length - 2];
    const width = chunk.shape[chunk.shape.length - 1];

    return {
      ok: true,
      width,
      height,
      data: toArrayBuffer(new Uint8Array(output.buffer)),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: message || "Failed to load ROI frame.",
    };
  }
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

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      request_json TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      logs_json TEXT NOT NULL,
      progress_events_json TEXT NOT NULL
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

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function insertTask(task: TaskRecord): Promise<void> {
  const db = await ensureDb();
  db.run(
    `INSERT INTO tasks (id, kind, status, created_at, started_at, finished_at, request_json, result_json, error, logs_json, progress_events_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.kind,
      task.status,
      task.created_at,
      task.started_at,
      task.finished_at,
      JSON.stringify(task.request ?? {}),
      task.result != null ? JSON.stringify(task.result) : null,
      task.error,
      JSON.stringify(task.logs ?? []),
      JSON.stringify(task.progress_events ?? []),
    ],
  );
  await persistDb(db);
}

async function updateTask(id: string, updates: TaskUpdate): Promise<void> {
  const db = await ensureDb();
  const sets: string[] = [];
  const values: Array<string | null> = [];

  if (updates.status !== undefined) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.started_at !== undefined) {
    sets.push("started_at = ?");
    values.push(updates.started_at);
  }
  if (updates.finished_at !== undefined) {
    sets.push("finished_at = ?");
    values.push(updates.finished_at);
  }
  if (updates.result !== undefined) {
    sets.push("result_json = ?");
    values.push(updates.result != null ? JSON.stringify(updates.result) : null);
  }
  if (updates.error !== undefined) {
    sets.push("error = ?");
    values.push(updates.error);
  }
  if (updates.logs !== undefined) {
    sets.push("logs_json = ?");
    values.push(JSON.stringify(updates.logs ?? []));
  }
  if (updates.progress_events !== undefined) {
    sets.push("progress_events_json = ?");
    values.push(JSON.stringify(updates.progress_events ?? []));
  }
  if (sets.length === 0) return;

  values.push(id);
  db.run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, values);
  await persistDb(db);
}

async function listTasks(): Promise<TaskRecord[]> {
  const db = await ensureDb();
  const stmt = db.prepare(
    "SELECT id, kind, status, created_at, started_at, finished_at, request_json, result_json, error, logs_json, progress_events_json FROM tasks ORDER BY created_at DESC",
  );

  const rows: TaskRecord[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    rows.push({
      id: String(row.id ?? ""),
      kind: String(row.kind ?? ""),
      status: row.status === "running" ? "running" : row.status === "failed" ? "failed" : "succeeded",
      created_at: String(row.created_at ?? ""),
      started_at: row.started_at == null ? null : String(row.started_at),
      finished_at: row.finished_at == null ? null : String(row.finished_at),
      request: parseJsonValue<Record<string, unknown>>(row.request_json, {}),
      result: parseJsonValue<Record<string, unknown> | null>(row.result_json, null),
      error: row.error == null ? null : String(row.error),
      logs: parseJsonValue<string[]>(row.logs_json, []),
      progress_events: parseJsonValue<TaskProgressEvent[]>(row.progress_events_json, []),
    });
  }
  stmt.free();
  return rows;
}

async function deleteCompletedTasks(): Promise<number> {
  const db = await ensureDb();
  const countStmt = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status IN ('succeeded', 'failed')");
  let count = 0;
  if (countStmt.step()) {
    const row = countStmt.getAsObject() as { count?: unknown };
    count = Number(row.count ?? 0);
  }
  countStmt.free();

  db.run("DELETE FROM tasks WHERE status IN ('succeeded', 'failed')");
  await persistDb(db);
  return Number.isFinite(count) ? count : 0;
}

async function parseKillPredictionCsv(csvPath: string): Promise<KillPredictionRow[]> {
  try {
    const content = await readFile(csvPath, "utf8");
    const lines = content.trim().split("\n");
    if (lines.length < 2) return [];
    const header = lines[0].split(",").map((col) => col.trim().toLowerCase());
    const tIndex = header.indexOf("t");
    const cropIndex = header.indexOf("crop");
    const labelIndex = header.indexOf("label");
    if (tIndex < 0 || cropIndex < 0 || labelIndex < 0) return [];

    const rows: KillPredictionRow[] = [];
    for (let i = 1; i < lines.length; i += 1) {
      const parts = lines[i].split(",");
      if (parts.length <= Math.max(tIndex, cropIndex, labelIndex)) continue;
      const t = Number.parseInt(parts[tIndex] ?? "", 10);
      const crop = String(parts[cropIndex] ?? "").trim();
      const labelValue = String(parts[labelIndex] ?? "").trim().toLowerCase();
      if (!Number.isFinite(t) || crop.length === 0) continue;
      rows.push({
        t,
        crop,
        label: labelValue === "true" || labelValue === "1",
      });
    }
    return rows;
  } catch {
    return [];
  }
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

function padInt(value: number, width: number): string {
  const safe = Math.max(0, Math.floor(value));
  return String(safe).padStart(width, "0");
}

function buildTiffCandidates(request: ReadImageRequest): string[] {
  const c = request.channel;
  const p = request.pos;
  const t = request.time;
  const z = request.z;
  return [
    `img_channel${c}_position${p}_time${t}_z${z}.tif`,
    `img_channel${c}_position${p}_time${t}_z${z}.tiff`,
    `img_channel${padInt(c, 3)}_position${padInt(p, 3)}_time${padInt(t, 9)}_z${padInt(
      z,
      3,
    )}.tif`,
    `img_channel${padInt(c, 3)}_position${padInt(p, 3)}_time${padInt(t, 9)}_z${padInt(
      z,
      3,
    )}.tiff`,
    `img_channel${padInt(c, 3)}_position${p}_time${t}_z${padInt(z, 3)}.tif`,
    `img_channel${padInt(c, 3)}_position${p}_time${t}_z${padInt(z, 3)}.tiff`,
    `img_channel${c}_position${padInt(p, 3)}_time${padInt(t, 9)}_z${z}.tif`,
    `img_channel${c}_position${padInt(p, 3)}_time${padInt(t, 9)}_z${z}.tiff`,
  ];
}

function parseTiffMeta(filename: string): ParsedTiffMeta {
  const strict = filename.match(TIFF_RE);
  if (strict) {
    return {
      strict: true,
      channel: Number.parseInt(strict[1], 10),
      position: Number.parseInt(strict[2], 10),
      time: Number.parseInt(strict[3], 10),
      z: Number.parseInt(strict[4], 10),
    };
  }

  const lower = filename.toLowerCase();
  const readAxis = (label: string): number | null => {
    const match = lower.match(new RegExp(`${label}[\\s_-]?(\\d+)`, "i"));
    return match ? Number.parseInt(match[1], 10) : null;
  };

  return {
    strict: false,
    channel: readAxis("channel") ?? readAxis("ch"),
    position: readAxis("position") ?? readAxis("pos"),
    time: readAxis("time"),
    z: readAxis("z"),
  };
}

async function collectTiffCandidates(
  directory: string,
  maxDepth = 8,
  depth = 0,
): Promise<TiffCandidate[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const out: TiffCandidate[] = [];

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isFile() && /\.tiff?$/i.test(entry.name)) {
      out.push({
        filename: entry.name,
        filePath,
        meta: parseTiffMeta(entry.name),
      });
      continue;
    }
    if (entry.isDirectory() && depth < maxDepth) {
      try {
        const nested = await collectTiffCandidates(filePath, maxDepth, depth + 1);
        out.push(...nested);
      } catch {
        // Ignore unreadable nested directories.
      }
    }
  }

  return out;
}

async function getCachedTiffCandidates(directory: string, maxDepth = 8): Promise<TiffCandidate[]> {
  const cacheKey = `${directory}|${maxDepth}`;
  const now = Date.now();
  const existing = tiffCache.get(cacheKey);
  if (existing && existing.expiresAt > now) {
    return existing.candidates;
  }
  const candidates = await collectTiffCandidates(directory, maxDepth);
  tiffCache.set(cacheKey, {
    expiresAt: now + TIFF_INDEX_CACHE_TTL_MS,
    candidates,
  });
  return candidates;
}

function rankTiffCandidates(
  candidates: TiffCandidate[],
  request: ReadImageRequest,
  preferRequestedPosition: boolean,
): TiffCandidate[] {
  const strictExact: TiffCandidate[] = [];
  const looseExact: TiffCandidate[] = [];
  const scored: Array<{ score: number; candidate: TiffCandidate }> = [];

  for (const candidate of candidates) {
    const meta = candidate.meta;
    const posExact = meta.position === request.pos;
    const channelExact = meta.channel === request.channel;
    const timeExact = meta.time === request.time;
    const zExact = meta.z === request.z;

    if (posExact && channelExact && timeExact && zExact && meta.strict) {
      strictExact.push(candidate);
      continue;
    }
    if (posExact && channelExact && timeExact && zExact) {
      looseExact.push(candidate);
      continue;
    }

    let score = 0;
    if (posExact) score += 1000;
    else if (preferRequestedPosition && meta.position != null) score -= 1000;
    if (channelExact) score += 100;
    if (timeExact) score += 10;
    if (zExact) score += 1;
    if (meta.strict) score += 3;
    if (meta.position == null) score -= 1;
    if (meta.channel == null) score -= 1;
    if (meta.time == null) score -= 1;
    if (meta.z == null) score -= 1;

    scored.push({ score, candidate });
  }

  scored.sort((a, b) => b.score - a.score);
  return [...strictExact, ...looseExact, ...scored.map((entry) => entry.candidate)];
}

async function decodeTiffCandidate(candidate: {
  filename: string;
  filePath: string;
}): Promise<ReadImageSuccess | null> {
  try {
    const fileBytes = await readFile(candidate.filePath);
    const buffer = toArrayBuffer(fileBytes);
    const ifds = UTIF.decode(buffer);
    if (ifds.length === 0) {
      return null;
    }

    UTIF.decodeImage(buffer, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const width = ifds[0].width;
    const height = ifds[0].height;
    normalizeRgbaInPlace(rgba, width, height);

    const rgbaCopy = new Uint8Array(rgba.length);
    rgbaCopy.set(rgba);

    return {
      ok: true,
      baseName: path.parse(candidate.filename).name,
      width,
      height,
      rgba: toArrayBuffer(rgbaCopy),
    };
  } catch {
    return null;
  }
}

async function tryDecodeCandidates(candidates: Array<{ filename: string; filePath: string }>): Promise<{
  decoded: ReadImageSuccess;
  candidate: { filename: string; filePath: string };
} | null> {
  const attempted = new Set<string>();
  for (const candidate of candidates) {
    if (attempted.has(candidate.filePath)) continue;
    attempted.add(candidate.filePath);
    const decoded = await decodeTiffCandidate(candidate);
    if (decoded) {
      return { decoded, candidate };
    }
  }
  return null;
}

async function readPositionImage(request: ReadImageRequest): Promise<ReadImageResponse> {
  try {
    const entries = await readdir(request.folder, { withFileTypes: true });
    const positionDirName = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .find((name) => parsePosDirName(name) === request.pos);
    const positionDirectory = positionDirName ? path.join(request.folder, positionDirName) : null;

    const directCandidates: Array<{ filename: string; filePath: string }> = [];
    const directRoots = [...new Set([...(positionDirectory ? [positionDirectory] : []), request.folder])];
    for (const root of directRoots) {
      for (const filename of buildTiffCandidates(request)) {
        directCandidates.push({ filename, filePath: path.join(root, filename) });
      }
    }

    const directHit = await tryDecodeCandidates(directCandidates);
    if (directHit) {
      return directHit.decoded;
    }

    if (positionDirectory) {
      const byPosition = await getCachedTiffCandidates(positionDirectory, 8);
      const rankedByPosition = rankTiffCandidates(byPosition, request, true);
      const positionHit = await tryDecodeCandidates(rankedByPosition);
      if (positionHit) {
        return positionHit.decoded;
      }
    }

    const byRoot = await getCachedTiffCandidates(request.folder, 8);
    if (byRoot.length > 0) {
      const rankedByRoot = rankTiffCandidates(byRoot, request, false);
      const rootHit = await tryDecodeCandidates(rankedByRoot);
      if (rootHit) {
        return rootHit.decoded;
      }
    }

    if (positionDirectory) {
      return { ok: false, error: "No readable TIFF found for requested position." };
    }
    return { ok: false, error: "No readable TIFF found in data folder." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || "Failed to read image." };
  }
}

async function saveBbox(payload: {
  folder: string;
  pos: number;
  csv: string;
  registrationYaml?: string;
}): Promise<{
  ok: true;
} | {
  ok: false;
  error: string;
}> {
  try {
    const bboxPath = path.join(payload.folder, `Pos${payload.pos}_bbox.csv`);
    await writeFile(bboxPath, payload.csv.endsWith("\n") ? payload.csv : `${payload.csv}\n`, "utf8");

    if (typeof payload.registrationYaml === "string") {
      const registrationPath = path.join(payload.folder, `Pos${payload.pos}_registration.yaml`);
      const yaml = payload.registrationYaml;
      await writeFile(registrationPath, yaml.endsWith("\n") ? yaml : `${yaml}\n`, "utf8");
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || "Failed to save bbox." };
  }
}

async function readRegistration(payload: ReadRegistrationRequest): Promise<ReadRegistrationResponse> {
  try {
    const registrationPath = path.join(payload.folder, `Pos${payload.pos}_registration.yaml`);
    const yaml = await readFile(registrationPath, "utf8");
    return { ok: true, yaml };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return { ok: false, code: "not_found", error: "registration yaml not found" };
    }
    return { ok: false, code: "read_error", error: message || "Failed to read registration yaml." };
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseAutoRegisterResult(payload: AutoRegisterRequest, parsed: unknown): AutoRegisterSuccess | null {
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const shape = record.shape === "hex" ? "hex" : record.shape === "square" ? "square" : null;
  if (!shape) return null;

  const readNumber = (key: string, fallback?: number): number | null => {
    const value = record[key];
    if (isFiniteNumber(value)) return value;
    if (typeof fallback === "number") return fallback;
    return null;
  };

  const a = readNumber("a");
  const alpha = readNumber("alpha");
  const b = readNumber("b");
  const beta = readNumber("beta");
  const w = readNumber("w", payload.w);
  const h = readNumber("h", payload.h);
  const dx = readNumber("dx", 0);
  const dy = readNumber("dy", 0);
  if (
    a == null ||
    alpha == null ||
    b == null ||
    beta == null ||
    w == null ||
    h == null ||
    dx == null ||
    dy == null
  ) {
    return null;
  }

  let diagnostics: AutoRegisterDiagnostics | undefined;
  const maybeDiagnostics = record.diagnostics;
  if (maybeDiagnostics && typeof maybeDiagnostics === "object") {
    const d = maybeDiagnostics as Record<string, unknown>;
    if (
      isFiniteNumber(d.detected_points) &&
      isFiniteNumber(d.inlier_points) &&
      isFiniteNumber(d.initial_mse) &&
      isFiniteNumber(d.final_mse)
    ) {
      diagnostics = {
        detected_points: d.detected_points,
        inlier_points: d.inlier_points,
        initial_mse: d.initial_mse,
        final_mse: d.final_mse,
      };
    }
  }

  return {
    ok: true,
    params: {
      shape,
      a,
      alpha,
      b,
      beta,
      w,
      h,
      dx,
      dy,
    },
    diagnostics,
  };
}

function candidateLiscaRsBinaries(): string[] {
  const exe = process.platform === "win32" ? "lisca-rs.exe" : "lisca-rs";
  const envPath = typeof process.env.LISCA_RS_BIN === "string" ? process.env.LISCA_RS_BIN.trim() : "";
  if (envPath.length > 0) return [envPath];
  return [path.resolve(process.cwd(), "..", "lisca-rs", "target", "release", exe)];
}

interface ExecFileErrorPayload {
  error: NodeJS.ErrnoException;
  stdout: string;
  stderr: string;
}

function execCommand(
  binary: string,
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject({
            error: error as NodeJS.ErrnoException,
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
          } satisfies ExecFileErrorPayload);
          return;
        }
        resolve({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}

function decodeAutoRegisterStdout(
  payload: AutoRegisterRequest,
  stdout: string,
  stderr: string,
): AutoRegisterResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      ok: false,
      code: "invalid_json",
      error: "lisca-rs register produced non-JSON stdout.",
      stderr: stderr.trim() || undefined,
    };
  }
  const normalized = parseAutoRegisterResult(payload, parsed);
  if (!normalized) {
    return {
      ok: false,
      code: "invalid_payload",
      error: "lisca-rs register JSON payload is missing required numeric fields.",
      stderr: stderr.trim() || undefined,
    };
  }
  return normalized;
}

async function autoDetectRegister(payload: AutoRegisterRequest): Promise<AutoRegisterResponse> {
  const args = [
    "register",
    "--input",
    payload.folder,
    "--pos",
    String(payload.pos),
    "--channel",
    String(payload.channel),
    "--time",
    String(payload.time),
    "--z",
    String(payload.z),
    "--grid",
    payload.grid,
    "--w",
    String(payload.w),
    "--h",
    String(payload.h),
    "--no-progress",
  ];

  const binaries = candidateLiscaRsBinaries();
  let sawBinary = false;
  for (const binary of binaries) {
    try {
      const result = await execCommand(binary, args);
      sawBinary = true;
      return decodeAutoRegisterStdout(payload, result.stdout, result.stderr);
    } catch (error) {
      const failure = error as ExecFileErrorPayload;
      if (failure?.error?.code === "ENOENT") {
        continue;
      }
      const stderr = typeof failure.stderr === "string" ? failure.stderr.trim() : "";
      const stdout = typeof failure.stdout === "string" ? failure.stdout.trim() : "";
      const fallback = failure.error instanceof Error ? failure.error.message : "Failed to run lisca-rs register.";
      return {
        ok: false,
        code: "exec_error",
        error: stderr || stdout || fallback,
        stderr: stderr || undefined,
      };
    }
  }

  if (!sawBinary) {
    const attempted = binaries.join(", ");
    return {
      ok: false,
      code: "binary_not_found",
      error:
        "lisca-rs release binary not found. Build --release and set LISCA_RS_BIN if needed. Tried: " +
        attempted,
    };
  }

  return { ok: false, code: "exec_error", error: "Failed to run lisca-rs register." };
}

async function runAutoDetectTask(payload: RunRegisterAutoDetectRequest): Promise<AutoRegisterResponse> {
  const startedAt = new Date().toISOString();
  const startProgress: TaskProgressEvent = {
    progress: 0,
    message: "Running auto-detect",
    timestamp: startedAt,
  };
  const finalProgress: TaskProgressEvent[] = [startProgress];

  await updateTask(payload.taskId, {
    status: "running",
    started_at: startedAt,
    finished_at: null,
    error: null,
    result: null,
    progress_events: finalProgress,
  });

  const result = await autoDetectRegister(payload);
  const finishedAt = new Date().toISOString();
  finalProgress.push({
    progress: result.ok ? 1 : 0,
    message: result.ok ? "Auto-detect completed" : `Auto-detect failed: ${result.error}`,
    timestamp: finishedAt,
  });

  await updateTask(payload.taskId, {
    status: result.ok ? "succeeded" : "failed",
    finished_at: finishedAt,
    error: result.ok ? null : result.error,
    result: result.ok
      ? {
          params: result.params,
          diagnostics: result.diagnostics ?? null,
        }
      : null,
    progress_events: finalProgress,
  });

  return result;
}

function decodeExecFailure(error: unknown, fallbackMessage: string): {
  code: "binary_not_found" | "exec_error";
  error: string;
} {
  const failure = error as ExecFileErrorPayload;
  if (failure?.error?.code === "ENOENT") {
    return {
      code: "binary_not_found",
      error: fallbackMessage,
    };
  }
  const stderr = typeof failure?.stderr === "string" ? failure.stderr.trim() : "";
  const stdout = typeof failure?.stdout === "string" ? failure.stdout.trim() : "";
  const fallback = failure?.error instanceof Error ? failure.error.message : fallbackMessage;
  return {
    code: "exec_error",
    error: stderr || stdout || fallback,
  };
}

async function runCropTask(payload: RunCropTaskRequest): Promise<RunCropTaskResponse> {
  const startedAt = new Date().toISOString();
  const progressEvents: TaskProgressEvent[] = [{
    progress: 0,
    message: "Running crop",
    timestamp: startedAt,
  }];
  await updateTask(payload.taskId, {
    status: "running",
    started_at: startedAt,
    finished_at: null,
    error: null,
    result: null,
    progress_events: progressEvents,
  });

  const bboxPath = bboxCsvPath(payload.folder, payload.pos);
  const output = payload.folder;
  const args = [
    "crop",
    "--input",
    payload.folder,
    "--pos",
    String(payload.pos),
    "--bbox",
    bboxPath,
    "--output",
    output,
    ...(payload.background ? ["--background"] : []),
  ];

  let result: RunCropTaskResponse;
  try {
    const binary = candidateLiscaRsBinaries()[0];
    await execCommand(binary, args);
    result = { ok: true, output };
  } catch (error) {
    const decoded = decodeExecFailure(error, "Failed to run lisca-rs crop.");
    result = { ok: false, code: decoded.code, error: decoded.error };
  }

  const finishedAt = new Date().toISOString();
  progressEvents.push({
    progress: result.ok ? 1 : 0,
    message: result.ok ? "Crop completed" : `Crop failed: ${result.error}`,
    timestamp: finishedAt,
  });
  await updateTask(payload.taskId, {
    status: result.ok ? "succeeded" : "failed",
    finished_at: finishedAt,
    error: result.ok ? null : result.error,
    result: result.ok ? { output: result.output } : null,
    progress_events: progressEvents,
  });

  return result;
}

async function runKillingPredictTask(payload: RunKillingPredictRequest): Promise<RunKillingPredictResponse> {
  const startedAt = new Date().toISOString();
  const progressEvents: TaskProgressEvent[] = [{
    progress: 0,
    message: "Running killing inference",
    timestamp: startedAt,
  }];
  await updateTask(payload.taskId, {
    status: "running",
    started_at: startedAt,
    finished_at: null,
    error: null,
    result: null,
    progress_events: progressEvents,
  });

  const output = killPredictionCsvPath(payload.folder, payload.pos);
  const modelDir = defaultKillModelDir();
  const modelPath = path.join(modelDir, "model.onnx");
  try {
    await access(modelPath, constants.R_OK);
  } catch {
    const finishedAt = new Date().toISOString();
    const error = `Model not found at ${modelPath}`;
    progressEvents.push({
      progress: 0,
      message: `Killing inference failed: ${error}`,
      timestamp: finishedAt,
    });
    await updateTask(payload.taskId, {
      status: "failed",
      finished_at: finishedAt,
      error,
      result: null,
      progress_events: progressEvents,
    });
    return { ok: false, code: "exec_error", error };
  }

  const args = [
    "killing",
    "--workspace",
    payload.folder,
    "--pos",
    String(payload.pos),
    "--model",
    modelDir,
    "--output",
    output,
    "--batch-size",
    String(payload.batchSize ?? 256),
    ...(payload.cpu ? ["--cpu"] : []),
  ];

  let result: RunKillingPredictResponse;
  try {
    const binary = candidateLiscaRsBinaries()[0];
    await execCommand(binary, args);
    const rows = await parseKillPredictionCsv(output);
    result = { ok: true, output, rows };
  } catch (error) {
    const decoded = decodeExecFailure(error, "Failed to run lisca-rs killing.");
    result = { ok: false, code: decoded.code, error: decoded.error };
  }

  const finishedAt = new Date().toISOString();
  progressEvents.push({
    progress: result.ok ? 1 : 0,
    message: result.ok ? "Killing inference completed" : `Killing inference failed: ${result.error}`,
    timestamp: finishedAt,
  });
  await updateTask(payload.taskId, {
    status: result.ok ? "succeeded" : "failed",
    finished_at: finishedAt,
    error: result.ok ? null : result.error,
    result: result.ok
      ? {
          output: result.output,
          rows: result.rows,
        }
      : null,
    progress_events: progressEvents,
  });

  return result;
}

async function loadPredictionCsv(
  folder: string,
  pos: number,
): Promise<{ ok: true; rows: KillPredictionRow[] } | { ok: false; error: string }> {
  try {
    const csvPath = killPredictionCsvPath(folder, pos);
    const rows = await parseKillPredictionCsv(csvPath);
    return { ok: true, rows };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || "Failed to load prediction CSV." };
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
    "assays:pick-assay-yaml",
    async (): Promise<{ file: string; folder: string } | null> => {
      const result = await dialog.showOpenDialog({
        title: "Select assay.yaml",
        properties: ["openFile"],
        filters: [
          { name: "Assay YAML", extensions: ["yaml", "yml"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const file = result.filePaths[0];
      if (path.basename(file).toLowerCase() !== "assay.yaml") {
        return null;
      }
      return { file, folder: path.dirname(file) };
    },
  );

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

  ipcMain.handle("register:read-registration", async (_event, payload: ReadRegistrationRequest) =>
    readRegistration(payload),
  );

  ipcMain.handle("register:auto-detect", async (_event, payload: AutoRegisterRequest) =>
    autoDetectRegister(payload),
  );

  ipcMain.handle("roi:discover", async (_event, payload: DiscoverRoiRequest): Promise<DiscoverRoiResponse> =>
    discoverRoiCrops(payload),
  );

  ipcMain.handle("roi:load-frame", async (_event, payload: LoadRoiFrameRequest): Promise<LoadRoiFrameResponse> =>
    loadRoiFrame(payload),
  );

  ipcMain.handle("tasks:insert-task", async (_event, task: TaskRecord): Promise<boolean> => {
    await insertTask(task);
    return true;
  });

  ipcMain.handle("tasks:update-task", async (_event, id: string, updates: TaskUpdate): Promise<boolean> => {
    await updateTask(id, updates);
    return true;
  });

  ipcMain.handle("tasks:list-tasks", async (): Promise<TaskRecord[]> => listTasks());
  ipcMain.handle("tasks:delete-completed-tasks", async (): Promise<number> => deleteCompletedTasks());

  ipcMain.handle(
    "tasks:run-register-auto-detect",
    async (_event, payload: RunRegisterAutoDetectRequest): Promise<AutoRegisterResponse> =>
      runAutoDetectTask(payload),
  );

  ipcMain.handle(
    "tasks:run-crop",
    async (_event, payload: RunCropTaskRequest): Promise<RunCropTaskResponse> =>
      runCropTask(payload),
  );

  ipcMain.handle(
    "tasks:run-killing-predict",
    async (_event, payload: RunKillingPredictRequest): Promise<RunKillingPredictResponse> =>
      runKillingPredictTask(payload),
  );

  ipcMain.handle(
    "register:save-bbox",
    async (
      _event,
      payload: { folder: string; pos: number; csv: string; registrationYaml?: string },
    ) =>
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

  ipcMain.handle(
    "application:load-prediction-csv",
    async (
      _event,
      payload: { folder: string; pos: number },
    ): Promise<{ ok: true; rows: KillPredictionRow[] } | { ok: false; error: string }> =>
      loadPredictionCsv(payload.folder, payload.pos),
  );

  ipcMain.handle(
    "settings:download-assets",
    async (event): Promise<DownloadAssetsResponse> =>
      downloadDefaultAssets((progress) => {
        event.sender.send(SETTINGS_DOWNLOAD_PROGRESS_CHANNEL, progress);
      }),
  );
  ipcMain.handle(
    "settings:asset-status",
    async (): Promise<AssetStatusResponse> => getAssetStatus(),
  );
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
