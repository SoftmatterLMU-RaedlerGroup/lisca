import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectAxesFromFilenames, parsePosDirName, scanFolder } from "../src/lib/scan-utils";

describe("scan parser", () => {
  test("parses position directory names", () => {
    expect(parsePosDirName("Pos0")).toBe(0);
    expect(parsePosDirName("Pos001")).toBe(1);
    expect(parsePosDirName("Position001")).toBe(1);
    expect(parsePosDirName("position 058")).toBe(58);
    expect(parsePosDirName("Pos-058")).toBe(58);
    expect(parsePosDirName("Pos058")).toBe(58);
    expect(parsePosDirName("  123  ")).toBe(123);
    expect(parsePosDirName("foo")).toBeNull();
  });

  test("collects sorted channel/time/z axes", () => {
    const axes = collectAxesFromFilenames([
      "img_channel001_position058_time000000000_z000.tif",
      "img_channel002_position058_time000000003_z005.tif",
      "img_channel001_position058_time000000003_z005.tif",
      "invalid-name.tif",
    ]);

    expect(axes.channels).toEqual([1, 2]);
    expect(axes.times).toEqual([0, 3]);
    expect(axes.zSlices).toEqual([0, 5]);
  });

  test("scans folder into sorted positions and axes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lisca-desktop-scan-"));
    try {
      await mkdir(path.join(dir, "Pos9"));
      await mkdir(path.join(dir, "Pos2"));
      await mkdir(path.join(dir, "Pos001"));
      await writeFile(path.join(dir, "Pos2", "img_channel002_position002_time000000003_z005.tif"), "");
      await writeFile(path.join(dir, "Pos2", "img_channel001_position002_time000000000_z000.tif"), "");
      await writeFile(path.join(dir, "Pos001", "img_channel001_position001_time000000000_z000.tiff"), "");
      await writeFile(path.join(dir, "Pos2_bbox.csv"), "");
      await mkdir(path.join(dir, "Pos9_roi.zarr"));
      await writeFile(path.join(dir, "Pos1_prediction.csv"), "");

      const scan = await scanFolder(dir);
      expect(scan.positions).toEqual([1, 2, 9]);
      expect(scan.channels).toEqual([1, 2]);
      expect(scan.times).toEqual([0, 3]);
      expect(scan.zSlices).toEqual([0, 5]);
      expect(scan.registrationPositions).toEqual([2]);
      expect(scan.roiPositions).toEqual([9]);
      expect(scan.predictionPositions).toEqual([1]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("scans nested TIFF files inside position folders", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lisca-desktop-scan-nested-"));
    try {
      await mkdir(path.join(dir, "Pos156"));
      await mkdir(path.join(dir, "Pos156", "images"));
      await writeFile(
        path.join(dir, "Pos156", "images", "img_channel001_position156_time000000001_z000.tif"),
        "",
      );

      const scan = await scanFolder(dir);
      expect(scan.positions).toEqual([156]);
      expect(scan.channels).toEqual([1]);
      expect(scan.times).toEqual([1]);
      expect(scan.zSlices).toEqual([0]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("falls back to top-level TIFFs when no position directories exist", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lisca-desktop-scan-fallback-"));
    try {
      await writeFile(
        path.join(dir, "img_channel000_position156_time000000000_z000.tif"),
        "",
      );
      await writeFile(path.join(dir, "img_channel001_position200_time000000002_z003.tif"), "");

      const scan = await scanFolder(dir);
      expect(scan.positions).toEqual([156, 200]);
      expect(scan.channels).toEqual([0, 1]);
      expect(scan.times).toEqual([0, 2]);
      expect(scan.zSlices).toEqual([0, 3]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
