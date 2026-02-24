import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectAxesFromFilenames, parsePosDirName, scanFolder } from "../electron/lib/scan-utils.cts";

describe("scan parser", () => {
  test("parses position directory names", () => {
    expect(parsePosDirName("Pos0")).toBe(0);
    expect(parsePosDirName("Pos058")).toBe(58);
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
      await writeFile(path.join(dir, "Pos2", "img_channel002_position002_time000000003_z005.tif"), "");
      await writeFile(path.join(dir, "Pos2", "img_channel001_position002_time000000000_z000.tif"), "");

      const scan = await scanFolder(dir);
      expect(scan.positions).toEqual([2, 9]);
      expect(scan.channels).toEqual([1, 2]);
      expect(scan.times).toEqual([0, 3]);
      expect(scan.zSlices).toEqual([0, 5]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
