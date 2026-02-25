import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { computeAssayYamlHealth } from "../electron/lib/scan-utils.cts";

describe("assay list health", () => {
  test("marks has_assay_yaml false when yaml missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lisca-desktop-assay-"));
    try {
      const missing = await computeAssayYamlHealth(dir);
      expect(missing.has_assay_yaml).toBe(false);

      await writeFile(path.join(dir, "assay.yaml"), "version: 1\n", "utf8");
      const present = await computeAssayYamlHealth(dir);
      expect(present.has_assay_yaml).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
