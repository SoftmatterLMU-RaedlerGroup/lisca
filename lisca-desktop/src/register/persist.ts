import type { RegisterShape } from "@/lib/bbox";

const STORAGE_KEY = "lisca-register-state-v1";

export interface RegisterPersistEntry {
  registerParams: RegisterShape;
  selectedPos: number;
  selectedChannel: number;
  selectedTime: number;
  selectedZ: number;
  selectedSampleIndex: number;
  showSidebars: boolean;
}

interface RegisterPersistStore {
  assays: Record<string, RegisterPersistEntry>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRegisterShape(value: unknown): value is RegisterShape {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.shape === "square" || candidate.shape === "hex") &&
    isFiniteNumber(candidate.a) &&
    isFiniteNumber(candidate.alpha) &&
    isFiniteNumber(candidate.b) &&
    isFiniteNumber(candidate.beta) &&
    isFiniteNumber(candidate.w) &&
    isFiniteNumber(candidate.h) &&
    isFiniteNumber(candidate.dx) &&
    isFiniteNumber(candidate.dy)
  );
}

function normalizeEntry(value: unknown): RegisterPersistEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!isRegisterShape(candidate.registerParams)) return null;
  if (
    !isFiniteNumber(candidate.selectedPos) ||
    !isFiniteNumber(candidate.selectedChannel) ||
    !isFiniteNumber(candidate.selectedTime) ||
    !isFiniteNumber(candidate.selectedZ) ||
    !isFiniteNumber(candidate.selectedSampleIndex) ||
    typeof candidate.showSidebars !== "boolean"
  ) {
    return null;
  }
  return {
    registerParams: candidate.registerParams,
    selectedPos: Math.floor(candidate.selectedPos),
    selectedChannel: Math.floor(candidate.selectedChannel),
    selectedTime: Math.floor(candidate.selectedTime),
    selectedZ: Math.floor(candidate.selectedZ),
    selectedSampleIndex: Math.floor(candidate.selectedSampleIndex),
    showSidebars: candidate.showSidebars,
  };
}

function loadStore(): RegisterPersistStore {
  if (typeof window === "undefined") return { assays: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { assays: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { assays: {} };
    const assaysRaw = (parsed as { assays?: unknown }).assays;
    if (!assaysRaw || typeof assaysRaw !== "object") return { assays: {} };

    const assays: Record<string, RegisterPersistEntry> = {};
    for (const [assayId, value] of Object.entries(assaysRaw as Record<string, unknown>)) {
      const normalized = normalizeEntry(value);
      if (normalized) assays[assayId] = normalized;
    }
    return { assays };
  } catch {
    return { assays: {} };
  }
}

function saveStore(store: RegisterPersistStore): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function loadRegisterPersistEntry(assayId: string): RegisterPersistEntry | null {
  const store = loadStore();
  return store.assays[assayId] ?? null;
}

export function saveRegisterPersistEntry(assayId: string, entry: RegisterPersistEntry): void {
  const store = loadStore();
  store.assays[assayId] = entry;
  saveStore(store);
}

