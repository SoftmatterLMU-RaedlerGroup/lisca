import type {
  AssayListItem,
  AssayMeta,
  FolderScan,
  ReadImageResponse,
} from "@/lib/types";

export const api = {
  assays: {
    list: () => window.liscaDesktop.assays.list(),
    remove: (id: string) => window.liscaDesktop.assays.remove(id),
    upsert: (meta: AssayMeta) => window.liscaDesktop.assays.upsert(meta),
    pickDataFolder: () => window.liscaDesktop.assays.pickDataFolder(),
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
    saveBbox: (payload: {
      folder: string;
      pos: number;
      csv: string;
    }) => window.liscaDesktop.register.saveBbox(payload),
  },
};

export type { AssayListItem, AssayMeta, FolderScan, ReadImageResponse };
