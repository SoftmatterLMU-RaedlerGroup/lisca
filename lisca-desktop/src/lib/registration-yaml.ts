import YAML from "yaml";
import type { RegisterShape } from "@/lib/bbox";

export type GridShape = "square" | "hex";

export interface PositionRegistrationYaml {
  version: 1;
  position: number;
  grid_shape: GridShape;
  register: RegisterShape;
  overlay_opacity: number;
}

const DEFAULT_REGISTER: RegisterShape = {
  shape: "square",
  a: 75,
  alpha: 0,
  b: 75,
  beta: 90,
  w: 50,
  h: 50,
  dx: 0,
  dy: 0,
};

function finiteOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampOpacity(value: unknown, fallback = 0.35): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizeGridShape(value: unknown): GridShape {
  return value === "hex" ? "hex" : "square";
}

export function normalizePositionRegistrationYaml(input: Partial<PositionRegistrationYaml>): PositionRegistrationYaml {
  const inferredGridShape = normalizeGridShape(input.grid_shape ?? input.register?.shape);
  return {
    version: 1,
    position:
      typeof input.position === "number" && Number.isFinite(input.position)
        ? Math.max(0, Math.floor(input.position))
        : 0,
    grid_shape: inferredGridShape,
    register: {
      shape: inferredGridShape,
      a: finiteOrDefault(input.register?.a, DEFAULT_REGISTER.a),
      alpha: finiteOrDefault(input.register?.alpha, DEFAULT_REGISTER.alpha),
      b: finiteOrDefault(input.register?.b, DEFAULT_REGISTER.b),
      beta: finiteOrDefault(input.register?.beta, DEFAULT_REGISTER.beta),
      w: finiteOrDefault(input.register?.w, DEFAULT_REGISTER.w),
      h: finiteOrDefault(input.register?.h, DEFAULT_REGISTER.h),
      dx: finiteOrDefault(input.register?.dx, DEFAULT_REGISTER.dx),
      dy: finiteOrDefault(input.register?.dy, DEFAULT_REGISTER.dy),
    },
    overlay_opacity: clampOpacity(input.overlay_opacity, 0.35),
  };
}

export function parsePositionRegistrationYaml(text: string): PositionRegistrationYaml {
  const parsed = YAML.parse(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("invalid registration yaml: expected object root");
  }
  return normalizePositionRegistrationYaml(parsed as Partial<PositionRegistrationYaml>);
}

export function stringifyPositionRegistrationYaml(config: PositionRegistrationYaml): string {
  return YAML.stringify(normalizePositionRegistrationYaml(config));
}

