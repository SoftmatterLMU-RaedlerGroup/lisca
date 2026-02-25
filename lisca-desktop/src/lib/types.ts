export type AssayType = "killing" | "expression";

export interface AssayMeta {
  id?: string;
  name: string;
  time: string;
  type: AssayType;
  folder: string;
}

export interface AssayListItem {
  id: string;
  name: string;
  time: string;
  type: AssayType;
  folder: string;
  has_assay_yaml: boolean;
  missing_reason?: string;
}

export interface FolderScan {
  path: string;
  name: string;
  positions: number[];
  channels: number[];
  times: number[];
  zSlices: number[];
  registrationPositions: number[];
  roiPositions: number[];
  predictionPositions: number[];
}

export interface ReadImageSuccess {
  ok: true;
  baseName: string;
  width: number;
  height: number;
  rgba: ArrayBuffer;
}

export interface ReadImageFailure {
  ok: false;
  error: string;
}

export type ReadImageResponse = ReadImageSuccess | ReadImageFailure;

export interface ReadRegistrationSuccess {
  ok: true;
  yaml: string;
}

export interface ReadRegistrationFailure {
  ok: false;
  error: string;
  code: "not_found" | "read_error";
}

export type ReadRegistrationResponse = ReadRegistrationSuccess | ReadRegistrationFailure;

export interface AutoRegisterParams {
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

export interface AutoRegisterDiagnostics {
  detected_points: number;
  inlier_points: number;
  initial_mse: number;
  final_mse: number;
}

export interface AutoRegisterSuccess {
  ok: true;
  params: AutoRegisterParams;
  diagnostics?: AutoRegisterDiagnostics;
}

export interface AutoRegisterFailure {
  ok: false;
  error: string;
  code?: "binary_not_found" | "exec_error" | "invalid_json" | "invalid_payload";
  stderr?: string;
}

export type AutoRegisterResponse = AutoRegisterSuccess | AutoRegisterFailure;

export type TaskStatus = "running" | "succeeded" | "failed";

export interface TaskProgressEvent {
  progress: number;
  message: string;
  timestamp: string;
}

export interface TaskRecord {
  id: string;
  kind: string;
  status: TaskStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  logs: string[];
  progress_events: TaskProgressEvent[];
}

export interface CropInfo {
  cropId: string;
  shape: number[];
}

export interface DiscoverRoiResponse {
  crops: CropInfo[];
}

export interface LoadRoiFrameSuccess {
  ok: true;
  width: number;
  height: number;
  data: ArrayBuffer;
}

export interface LoadRoiFrameFailure {
  ok: false;
  error: string;
}

export type LoadRoiFrameResponse = LoadRoiFrameSuccess | LoadRoiFrameFailure;

export interface KillPredictionRow {
  t: number;
  crop: string;
  label: boolean;
}

export type DownloadAssetsProgressPhase =
  | "start"
  | "model"
  | "ffmpeg"
  | "extract"
  | "finalize"
  | "done"
  | "error";

export interface DownloadAssetsProgress {
  phase: DownloadAssetsProgressPhase;
  progress: number;
  message: string;
}

export interface AssaySample {
  name: string;
  position_slice: string;
}

export interface AssayChannelName {
  channel: number;
  name: string;
}

export interface RegisterParams {
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

export interface AssayYaml {
  version: 1;
  name: string;
  date: string;
  type: AssayType;
  data_folder: string;
  brightfield_channel: number;
  channel_names?: AssayChannelName[];
  samples: AssaySample[];
  register: RegisterParams;
}
