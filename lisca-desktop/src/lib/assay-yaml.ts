import YAML from "yaml";
import type { AssayYaml } from "@/lib/types";

export const DEFAULT_REGISTER = {
  shape: "square" as const,
  a: 75,
  alpha: 0,
  b: 75,
  beta: 90,
  w: 50,
  h: 50,
  dx: 0,
  dy: 0,
};

export function normalizeAssayYaml(input: Partial<AssayYaml>): AssayYaml {
  return {
    version: 1,
    name: String(input.name ?? "").trim(),
    date: String(input.date ?? "").trim(),
    type: input.type === "expression" ? "expression" : "killing",
    data_folder: String(input.data_folder ?? "").trim(),
    brightfield_channel:
      typeof input.brightfield_channel === "number" && Number.isFinite(input.brightfield_channel)
        ? Math.max(0, Math.floor(input.brightfield_channel))
        : 0,
    samples: Array.isArray(input.samples)
      ? input.samples
          .map((sample) => ({
            name: String(sample.name ?? "").trim(),
            position_slice: String(sample.position_slice ?? "").trim(),
          }))
          .filter((sample) => sample.name.length > 0 && sample.position_slice.length > 0)
      : [],
    register: {
      shape: input.register?.shape === "hex" ? "hex" : "square",
      a: finiteOrDefault(input.register?.a, DEFAULT_REGISTER.a),
      alpha: finiteOrDefault(input.register?.alpha, DEFAULT_REGISTER.alpha),
      b: finiteOrDefault(input.register?.b, DEFAULT_REGISTER.b),
      beta: finiteOrDefault(input.register?.beta, DEFAULT_REGISTER.beta),
      w: finiteOrDefault(input.register?.w, DEFAULT_REGISTER.w),
      h: finiteOrDefault(input.register?.h, DEFAULT_REGISTER.h),
      dx: finiteOrDefault(input.register?.dx, DEFAULT_REGISTER.dx),
      dy: finiteOrDefault(input.register?.dy, DEFAULT_REGISTER.dy),
    },
  };
}

function finiteOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function parseAssayYaml(text: string): AssayYaml {
  const parsed = YAML.parse(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid assay.yaml: expected object root");
  }
  return normalizeAssayYaml(parsed as Partial<AssayYaml>);
}

export function stringifyAssayYaml(config: AssayYaml): string {
  const normalized = normalizeAssayYaml(config);
  return YAML.stringify(normalized);
}
