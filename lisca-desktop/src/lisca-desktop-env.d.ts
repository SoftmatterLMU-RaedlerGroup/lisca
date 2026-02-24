export {};

declare global {
  interface Window {
    liscaDesktop: {
      platform: string;
      assays: {
        list: () => Promise<
          Array<{
            id: string;
            name: string;
            time: string;
            type: "killing" | "expression";
            folder: string;
            has_assay_yaml: boolean;
            missing_reason?: string;
          }>
        >;
        remove: (id: string) => Promise<boolean>;
        upsert: (meta: {
          id?: string;
          name: string;
          time: string;
          type: "killing" | "expression";
          folder: string;
        }) => Promise<{ id: string }>;
        pickDataFolder: () => Promise<{ path: string } | null>;
        pickAssayYaml: () => Promise<{ file: string; folder: string } | null>;
        readYaml: (folder: string) => Promise<{ ok: true; yaml: string } | { ok: false; error: string }>;
        writeYaml: (
          folder: string,
          yaml: string,
        ) => Promise<{ ok: true } | { ok: false; error: string }>;
        pathExists: (folder: string) => Promise<boolean>;
      };
      register: {
        scan: (folder: string) => Promise<{
          path: string;
          name: string;
          positions: number[];
          channels: number[];
          times: number[];
          zSlices: number[];
          registeredPositions: number[];
        }>;
        readImage: (payload: {
          folder: string;
          pos: number;
          channel: number;
          time: number;
          z: number;
        }) => Promise<
          | {
              ok: true;
              baseName: string;
              width: number;
              height: number;
              rgba: ArrayBuffer;
            }
          | {
              ok: false;
              error: string;
            }
        >;
        saveBbox: (payload: {
          folder: string;
          pos: number;
          csv: string;
        }) => Promise<{ ok: true } | { ok: false; error: string }>;
      };
    };
  }
}
