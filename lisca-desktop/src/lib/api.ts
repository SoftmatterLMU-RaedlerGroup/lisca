import type {
  AssayListItem,
  AssayMeta,
  FolderScan,
  ReadRegistrationResponse,
  ReadImageResponse,
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
    saveBbox: (payload: {
      folder: string;
      pos: number;
      csv: string;
      registrationYaml?: string;
    }) => window.liscaDesktop.register.saveBbox(payload),
  },
};

export type { AssayListItem, AssayMeta, FolderScan, ReadImageResponse, ReadRegistrationResponse };
