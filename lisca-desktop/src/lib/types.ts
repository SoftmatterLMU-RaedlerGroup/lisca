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
  registeredPositions: number[];
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
