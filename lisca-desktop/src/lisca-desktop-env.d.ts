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
        readRegistration: (payload: {
          folder: string;
          pos: number;
        }) => Promise<
          | {
              ok: true;
              yaml: string;
            }
          | {
              ok: false;
              error: string;
              code: "not_found" | "read_error";
            }
        >;
        autoDetect: (payload: {
          folder: string;
          pos: number;
          channel: number;
          time: number;
          z: number;
          grid: "square" | "hex";
          w: number;
          h: number;
        }) => Promise<
          | {
              ok: true;
              params: {
                shape: "square" | "hex";
                a: number;
                alpha: number;
                b: number;
                beta: number;
                w: number;
                h: number;
                dx: number;
                dy: number;
              };
              diagnostics?: {
                detected_points: number;
                inlier_points: number;
                initial_mse: number;
                final_mse: number;
              };
            }
          | {
              ok: false;
              error: string;
              code?: "binary_not_found" | "exec_error" | "invalid_json" | "invalid_payload";
              stderr?: string;
            }
        >;
        saveBbox: (payload: {
          folder: string;
          pos: number;
          csv: string;
          registrationYaml?: string;
        }) => Promise<{ ok: true } | { ok: false; error: string }>;
      };
      tasks: {
        insertTask: (task: {
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
          progress_events: Array<{
            progress: number;
            message: string;
            timestamp: string;
          }>;
        }) => Promise<boolean>;
        updateTask: (
          id: string,
          updates: Partial<{
            status: "running" | "succeeded" | "failed";
            started_at: string | null;
            finished_at: string | null;
            result: Record<string, unknown> | null;
            error: string | null;
            logs: string[];
            progress_events: Array<{
              progress: number;
              message: string;
              timestamp: string;
            }>;
          }>,
        ) => Promise<boolean>;
        listTasks: () => Promise<
          Array<{
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
            progress_events: Array<{
              progress: number;
              message: string;
              timestamp: string;
            }>;
          }>
        >;
        deleteCompletedTasks: () => Promise<number>;
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
        }) => Promise<
          | {
              ok: true;
              params: {
                shape: "square" | "hex";
                a: number;
                alpha: number;
                b: number;
                beta: number;
                w: number;
                h: number;
                dx: number;
                dy: number;
              };
              diagnostics?: {
                detected_points: number;
                inlier_points: number;
                initial_mse: number;
                final_mse: number;
              };
            }
          | {
              ok: false;
              error: string;
              code?: "binary_not_found" | "exec_error" | "invalid_json" | "invalid_payload";
              stderr?: string;
            }
        >;
      };
    };
  }
}
