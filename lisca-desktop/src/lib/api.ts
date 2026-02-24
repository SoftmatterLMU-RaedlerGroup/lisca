import type {
  AssayListItem,
  AssayMeta,
  AutoRegisterResponse,
  FolderScan,
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
  },
};

export type { AssayListItem, AssayMeta, FolderScan, ReadImageResponse, ReadRegistrationResponse };
