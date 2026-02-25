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

export const api = {
  assays: {
    list: () => window.liscaDesktop.assays.list(),
    remove: (id: string) => window.liscaDesktop.assays.remove(id),
    upsert: (meta: AssayMeta) => window.liscaDesktop.assays.upsert(meta),
    pickDataFolder: () => window.liscaDesktop.assays.pickDataFolder(),
    pickAssayYaml: () => window.liscaDesktop.assays.pickAssayYaml(),
    readYaml: (folder: string) => window.liscaDesktop.assays.readYaml(folder),
    writeYaml: (folder: string, yaml: string) => window.liscaDesktop.assays.writeYaml(folder, yaml),
  },
  register: {
    scan: (folder: string): Promise<FolderScan> => window.liscaDesktop.register.scan(folder),
    readImage: (payload: {
      folder: string;
      pos: number;
      channel: number;
      time: number;
      z: number;
    }): Promise<ReadImageResponse> => window.liscaDesktop.register.readImage(payload),
    readRegistration: (payload: {
      folder: string;
      pos: number;
    }): Promise<ReadRegistrationResponse> => window.liscaDesktop.register.readRegistration(payload),
    autoDetect: (payload: {
      folder: string;
      pos: number;
      channel: number;
      time: number;
      z: number;
      grid: "square" | "hex";
      w: number;
      h: number;
    }): Promise<AutoRegisterResponse> => window.liscaDesktop.register.autoDetect(payload),
    saveBbox: (payload: {
      folder: string;
      pos: number;
      csv: string;
      registrationYaml?: string;
    }) => window.liscaDesktop.register.saveBbox(payload),
  },
  roi: {
    discover: (payload: { folder: string; pos: number }): Promise<DiscoverRoiResponse> =>
      window.liscaDesktop.roi.discover(payload),
    loadFrame: (payload: {
      folder: string;
      pos: number;
      cropId: string;
      t: number;
      c: number;
      z: number;
    }): Promise<LoadRoiFrameResponse> => window.liscaDesktop.roi.loadFrame(payload),
  },
  tasks: {
    insert: (task: TaskRecord): Promise<boolean> => window.liscaDesktop.tasks.insertTask(task),
    update: (
      id: string,
      updates: Partial<
        Pick<TaskRecord, "status" | "started_at" | "finished_at" | "result" | "error" | "logs" | "progress_events">
      >,
    ): Promise<boolean> => window.liscaDesktop.tasks.updateTask(id, updates),
    list: (): Promise<TaskRecord[]> => window.liscaDesktop.tasks.listTasks(),
    deleteCompleted: (): Promise<number> => window.liscaDesktop.tasks.deleteCompletedTasks(),
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
    }): Promise<AutoRegisterResponse> => window.liscaDesktop.tasks.runRegisterAutoDetect(payload),
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
    > => window.liscaDesktop.tasks.runCrop(payload),
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
    > => window.liscaDesktop.tasks.runKillingPredict(payload),
  },
  application: {
    loadPredictionCsv: (payload: {
      folder: string;
      pos: number;
    }): Promise<{ ok: true; rows: KillPredictionRow[] } | { ok: false; error: string }> =>
      window.liscaDesktop.application.loadPredictionCsv(payload),
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
    > => window.liscaDesktop.settings.downloadAssets(),
    onDownloadAssetsProgress: (callback: (event: DownloadAssetsProgress) => void): (() => void) =>
      window.liscaDesktop.settings.onDownloadAssetsProgress(callback),
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
    > => window.liscaDesktop.settings.getAssetStatus(),
  },
};

export type { AssayListItem, AssayMeta, FolderScan, ReadImageResponse, ReadRegistrationResponse };
