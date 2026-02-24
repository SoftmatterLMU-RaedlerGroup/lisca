import path from "node:path";
import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";

export const TIFF_RE = /^img_channel(\d+)_position(\d+)_time(\d+)_z(\d+)\.tif$/i;

export interface FolderScan {
  path: string;
  name: string;
  positions: number[];
  channels: number[];
  times: number[];
  zSlices: number[];
}

export function parsePosDirName(name: string): number | null {
  const match = name.match(/^Pos(\d+)$/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function collectAxesFromFilenames(
  filenames: string[],
): { channels: number[]; times: number[]; zSlices: number[] } {
  const channels = new Set<number>();
  const times = new Set<number>();
  const zSlices = new Set<number>();
  for (const name of filenames) {
    const match = name.match(TIFF_RE);
    if (!match) continue;
    channels.add(Number.parseInt(match[1], 10));
    times.add(Number.parseInt(match[3], 10));
    zSlices.add(Number.parseInt(match[4], 10));
  }
  return {
    channels: [...channels].sort((a, b) => a - b),
    times: [...times].sort((a, b) => a - b),
    zSlices: [...zSlices].sort((a, b) => a - b),
  };
}

export async function scanFolder(folderPath: string): Promise<FolderScan> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const positions = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => parsePosDirName(entry.name))
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);

  let channels: number[] = [];
  let times: number[] = [];
  let zSlices: number[] = [];

  if (positions.length > 0) {
    const firstPosPath = path.join(folderPath, `Pos${positions[0]}`);
    const firstPosEntries = await readdir(firstPosPath, { withFileTypes: true });
    const axes = collectAxesFromFilenames(
      firstPosEntries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    );
    channels = axes.channels;
    times = axes.times;
    zSlices = axes.zSlices;
  }

  return {
    path: folderPath,
    name: path.basename(folderPath),
    positions,
    channels,
    times,
    zSlices,
  };
}

export async function computeAssayYamlHealth(folder: string): Promise<{
  has_assay_yaml: boolean;
  missing_reason?: string;
}> {
  const assayPath = path.join(folder, "assay.yaml");
  try {
    await access(assayPath, constants.R_OK);
    return { has_assay_yaml: true };
  } catch {
    try {
      await access(folder, constants.R_OK);
      return { has_assay_yaml: false, missing_reason: "assay.yaml not found" };
    } catch {
      return { has_assay_yaml: false, missing_reason: "folder not found" };
    }
  }
}

export function findMatchingTiffFilename(
  filenames: string[],
  request: { pos: number; channel: number; time: number; z: number },
): string | null {
  for (const name of filenames) {
    const match = name.match(TIFF_RE);
    if (!match) continue;
    const channel = Number.parseInt(match[1], 10);
    const pos = Number.parseInt(match[2], 10);
    const time = Number.parseInt(match[3], 10);
    const z = Number.parseInt(match[4], 10);
    if (
      channel === request.channel &&
      pos === request.pos &&
      time === request.time &&
      z === request.z
    ) {
      return name;
    }
  }
  return null;
}
