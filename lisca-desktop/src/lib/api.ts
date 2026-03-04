import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AssayListItem,
  AssayMeta,
  AutoRegisterResponse,
  DownloadAssetsProgress,
  DiscoverRoiResponse,
  FolderScan,
  KillPredictionRow,
  LoadRoiFrameResponse,
  ReadRegistrationResponse,
  ReadImageResponse,
  TaskRecord,
} from "@/lib/types";

async function invokeCommand<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, payload);
}

function invokePayloadCommand<T>(
  command: string,
  payload: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(command, { payload });
}

function safeListenProgress(
  callback: (event: DownloadAssetsProgress) => void,
): () => void {
  let unlisten: UnlistenFn = () => {};
  void (async () => {
    const fnA = await listen<DownloadAssetsProgress>("download-assets-progress", (event) => {
      callback(event.payload);
    });
    const fnB = await listen<DownloadAssetsProgress>("settings:download-assets-progress", (event) => {
      callback(event.payload);
    });
    unlisten = () => {
      fnA();
      fnB();
    };
  })();
  return () => unlisten();
}

export const api = {
  assays: {
    list: (): Promise<AssayListItem[]> => invokeCommand<AssayListItem[]>("assays_list"),
    remove: (id: string): Promise<boolean> => invokeCommand<boolean>("assays_remove", { id }),
    upsert: (meta: AssayMeta): Promise<{ id: string }> =>
      invokePayloadCommand<{ id: string }>("assays_upsert", { meta }),
    pickDataFolder: (): Promise<{ path: string } | null> =>
      invokeCommand<{ path: string } | null>("assays_pick_data_folder"),
    pickAssayYaml: (): Promise<{ file: string; folder: string } | null> =>
      invokeCommand<{ file: string; folder: string } | null>("assays_pick_assay_yaml"),
    readYaml: (folder: string): Promise<{ ok: true; yaml: string } | { ok: false; error: string }> =>
      invokeCommand<{ ok: true; yaml: string } | { ok: false; error: string }>("assays_read_yaml", { folder }),
    writeYaml: (folder: string, yaml: string): Promise<{ ok: true } | { ok: false; error: string }> =>
      invokePayloadCommand<{ ok: true } | { ok: false; error: string }>(
        "assays_write_yaml",
        { folder, yaml },
      ),
    pathExists: (folder: string): Promise<boolean> =>
      invokePayloadCommand<boolean>("assays_path_exists", { folder }),
  },
  register: {
    scan: (folder: string): Promise<FolderScan> =>
      invokePayloadCommand<FolderScan>("register_scan", { folder }),
    readImage: (
      payload: {
        folder: string;
        pos: number;
        channel: number;
        time: number;
        z: number;
      },
    ): Promise<ReadImageResponse> => invokePayloadCommand<ReadImageResponse>("register_read_image", payload),
    readRegistration: (payload: { folder: string; pos: number }): Promise<ReadRegistrationResponse> =>
      invokePayloadCommand<ReadRegistrationResponse>("register_read_registration", payload),
    autoDetect: (payload: {
      folder: string;
      pos: number;
      channel: number;
      time: number;
      z: number;
      grid: "square" | "hex";
      w: number;
      h: number;
    }): Promise<AutoRegisterResponse> =>
      invokePayloadCommand<AutoRegisterResponse>("register_auto_detect", payload),
    saveBbox: (payload: {
      folder: string;
      pos: number;
      csv: string;
      registrationYaml?: string;
    }): Promise<{ ok: true } | { ok: false; error: string }> =>
      invokePayloadCommand<{ ok: true } | { ok: false; error: string }>("register_save_bbox", payload),
  },
  roi: {
    discover: (payload: { folder: string; pos: number }): Promise<DiscoverRoiResponse> =>
      invokePayloadCommand<DiscoverRoiResponse>("roi_discover", payload),
    loadFrame: (payload: {
      folder: string;
      pos: number;
      cropId: string;
      t: number;
      c: number;
      z: number;
    }): Promise<LoadRoiFrameResponse> =>
      invokePayloadCommand<LoadRoiFrameResponse>("roi_load_frame", payload),
  },
  tasks: {
    insert: (task: TaskRecord): Promise<boolean> => invokeCommand<boolean>("tasks_insert", { task }),
    update: (
      id: string,
      updates: Partial<
        Pick<
          TaskRecord,
          "status" | "started_at" | "finished_at" | "result" | "error" | "logs" | "progress_events"
        >
      >,
    ): Promise<boolean> => invokeCommand<boolean>("tasks_update", { id, updates }),
    list: (): Promise<TaskRecord[]> => invokeCommand<TaskRecord[]>("tasks_list"),
    deleteCompleted: (): Promise<number> => invokeCommand<number>("tasks_delete_completed"),
    runRegisterAutoDetect: (payload: {
      taskId: string;
      folder: string;
      pos: number;
      channel: number;
      time: number;
      z: number;
      grid: "square" | "hex";
      w: number;
      h: number;
    }): Promise<AutoRegisterResponse> =>
      invokePayloadCommand<AutoRegisterResponse>("tasks_run_register_auto_detect", payload),
    runCrop: (payload: {
      taskId: string;
      folder: string;
      pos: number;
      background: boolean;
    }): Promise<
      | {
          ok: true;
          output: string;
        }
      | {
          ok: false;
          error: string;
          code?: "binary_not_found" | "exec_error";
        }
    > => invokePayloadCommand("tasks_run_crop", payload),
    runKillingPredict: (payload: {
      taskId: string;
      folder: string;
      pos: number;
      batchSize?: number;
      cpu?: boolean;
    }): Promise<
      | {
          ok: true;
          output: string;
          rows: KillPredictionRow[];
        }
      | {
          ok: false;
          error: string;
          code?: "binary_not_found" | "exec_error";
        }
    > => invokePayloadCommand("tasks_run_killing_predict", payload),
  },
  application: {
    loadPredictionCsv: (payload: {
      folder: string;
      pos: number;
    }): Promise<{ ok: true; rows: KillPredictionRow[] } | { ok: false; error: string }> =>
      invokePayloadCommand<{ ok: true; rows: KillPredictionRow[] } | { ok: false; error: string }>(
        "application_load_prediction_csv",
        payload,
      ),
  },
  settings: {
    downloadAssets: (): Promise<
      | {
          ok: true;
          modelDir: string;
          ffmpegPath: string;
          downloadedFiles: string[];
        }
      | {
          ok: false;
          error: string;
        }
    > => invokeCommand("settings_download_assets"),
    onDownloadAssetsProgress: (callback: (event: DownloadAssetsProgress) => void): (() => void) =>
      safeListenProgress(callback),
    getAssetStatus: (): Promise<
      | {
          ok: true;
          modelPath: string;
          ffmpegPath: string;
          missing: string[];
          allPresent: boolean;
        }
      | {
          ok: false;
          error: string;
        }
    > => invokeCommand("settings_get_asset_status"),
  },
};

export type { AssayListItem, AssayMeta, FolderScan, ReadImageResponse, ReadRegistrationResponse };
