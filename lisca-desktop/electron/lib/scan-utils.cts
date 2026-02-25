import path from "node:path";
import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";

export const TIFF_RE = /^img_channel(\d+)_position(\d+)_time(\d+)_z(\d+)\.tiff?$/i;

export const TIFF_FILE_RE = /\.tiff?$/i;

export interface FolderScan {
  path: string;
  name: string;
  positions: number[];
  channels: number[];
  times: number[];
  zSlices: number[];
  registrationPositions: number[];
  roiPositions: number[];
  predictionPositions: number[];
}

export function parsePosDirName(name: string): number | null {
  const normalized = name.trim().replace(/\s+/g, "");
  const match = normalized.match(/^(?:Pos|Position|position|pos)[-_]?(\d+)$/i);
  if (match) {
    return Number.parseInt(match[1], 10);
  }
const bare = normalized.match(/^(?:\d+)$/);
  return bare ? Number.parseInt(bare[0], 10) : null;
}

interface FilenameCandidate {
  filename: string;
}

async function collectTiffFilenames(
  folderPath: string,
  maxDepth = 6,
  depth = 0,
): Promise<FilenameCandidate[]> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const out: FilenameCandidate[] = [];

  for (const entry of entries) {
    if (entry.isFile() && TIFF_FILE_RE.test(entry.name)) {
      out.push({ filename: entry.name });
      continue;
    }

    if (entry.isDirectory() && depth < maxDepth) {
      try {
        const nested = await collectTiffFilenames(path.join(folderPath, entry.name), maxDepth, depth + 1);
        out.push(...nested);
      } catch {
        // Ignore unreadable directories.
      }
    }
  }

  return out;
}

export interface NamedPosition {
  position: number;
  directory: string;
}

export function collectPosDirectories(folderEntries: Array<{ name: string }>): NamedPosition[] {
  return folderEntries
    .map((entry) => {
      const position = parsePosDirName(entry.name);
      if (position == null) return null;
      return { position, directory: entry.name };
    })
    .filter((value): value is NamedPosition => value != null)
    .sort((a, b) => a.position - b.position);
}

function collectAxesFromFilenamesInternal(
  filenames: string[],
): { channels: number[]; times: number[]; zSlices: number[]; positions: number[] } {
  const channels = new Set<number>();
  const times = new Set<number>();
  const zSlices = new Set<number>();
  const positions = new Set<number>();

  for (const name of filenames) {
    const match = name.match(TIFF_RE);
    if (!match) continue;
    channels.add(Number.parseInt(match[1], 10));
    positions.add(Number.parseInt(match[2], 10));
    times.add(Number.parseInt(match[3], 10));
    zSlices.add(Number.parseInt(match[4], 10));
  }

  return {
    channels: [...channels].sort((a, b) => a - b),
    times: [...times].sort((a, b) => a - b),
    zSlices: [...zSlices].sort((a, b) => a - b),
    positions: [...positions].sort((a, b) => a - b),
  };
}

export function collectAxesFromFilenames(
  filenames: string[],
): { channels: number[]; times: number[]; zSlices: number[] } {
  const parsed = collectAxesFromFilenamesInternal(filenames);
  return {
    channels: parsed.channels,
    times: parsed.times,
    zSlices: parsed.zSlices,
  };
}

export async function scanFolder(folderPath: string): Promise<FolderScan> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const positionDirectories = collectPosDirectories(entries.filter((entry) => entry.isDirectory()));
  const positions = positionDirectories.map((entry) => entry.position);

  let channels: number[] = [];
  let times: number[] = [];
  let zSlices: number[] = [];
  let fallbackPositions: number[] = [];
  let fallbackChannels: number[] = [];
  let fallbackTimes: number[] = [];
  let fallbackZSlices: number[] = [];

  if (positionDirectories.length > 0) {
    const channelSet = new Set<number>();
    const timeSet = new Set<number>();
    const zSet = new Set<number>();

    for (const posDir of positionDirectories) {
      const posPath = path.join(folderPath, posDir.directory);
      try {
        const posEntries = await collectTiffFilenames(posPath);
        const axes = collectAxesFromFilenames(posEntries.map((entry) => entry.filename));
        for (const value of axes.channels) channelSet.add(value);
        for (const value of axes.times) timeSet.add(value);
        for (const value of axes.zSlices) zSet.add(value);
      } catch {
        // Ignore unreadable position directories; scan should still provide best-effort results.
      }
    }

    channels = [...channelSet].sort((a, b) => a - b);
    times = [...timeSet].sort((a, b) => a - b);
    zSlices = [...zSet].sort((a, b) => a - b);
  } else {
    const parsed = collectAxesFromFilenamesInternal(
      entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    );
    fallbackPositions = parsed.positions;
    fallbackChannels = parsed.channels;
    fallbackTimes = parsed.times;
    fallbackZSlices = parsed.zSlices;
  }

  const registrationCandidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .map((name) => name.match(/^Pos(\d+)_bbox\.csv$/i))
    .filter((match): match is RegExpMatchArray => match != null)
    .map((match) => Number.parseInt(match[1], 10));

  const registrationPositions = registrationCandidates
    .filter((value, index, arr) => Number.isFinite(value) && arr.indexOf(value) === index)
    .sort((a, b) => a - b);

  const roiCandidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .map((name) => name.match(/^Pos(\d+)_roi\.zarr$/i))
    .filter((match): match is RegExpMatchArray => match != null)
    .map((match) => Number.parseInt(match[1], 10));

  const roiPositions = roiCandidates
    .filter((value, index, arr) => Number.isFinite(value) && arr.indexOf(value) === index)
    .sort((a, b) => a - b);

  const predictionCandidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .map((name) => name.match(/^Pos(\d+)_prediction\.csv$/i))
    .filter((match): match is RegExpMatchArray => match != null)
    .map((match) => Number.parseInt(match[1], 10));

  const predictionPositions = predictionCandidates
    .filter((value, index, arr) => Number.isFinite(value) && arr.indexOf(value) === index)
    .sort((a, b) => a - b);

  return {
    path: folderPath,
    name: path.basename(folderPath),
    positions: positions.length > 0 ? positions : fallbackPositions,
    channels: channels.length > 0 ? channels : fallbackChannels,
    times: times.length > 0 ? times : fallbackTimes,
    zSlices: zSlices.length > 0 ? zSlices : fallbackZSlices,
    registrationPositions,
    roiPositions,
    predictionPositions,
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

export function findAnyTiffFilename(filenames: string[]): string | null {
  return filenames.find((name) => TIFF_FILE_RE.test(name)) ?? null;
}

export function findFallbackTiffFilename(
  filenames: string[],
  pos: number,
): string | null {
  for (const name of filenames) {
    const match = name.match(TIFF_RE);
    if (!match) continue;
    const parsedPos = Number.parseInt(match[2], 10);
    if (parsedPos === pos) {
      return name;
    }
  }
  return null;
}
