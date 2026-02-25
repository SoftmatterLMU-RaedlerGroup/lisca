import { describe, expect, test } from "bun:test";
import { normalizeAssayYaml, parseAssayYaml, stringifyAssayYaml } from "../src/lib/assay-yaml";

describe("assay yaml", () => {
  test("round-trips required fields", () => {
    const cfg = normalizeAssayYaml({
      version: 1,
      name: "A1",
      date: "2026-02-24",
      type: "killing",
      data_folder: "C:/data",
      brightfield_channel: 0,
      samples: [
        { name: "sample-a", position_slice: "all" },
        { name: "sample-b", position_slice: "0:20:2" },
      ],
      register: {
        shape: "hex",
        a: 120,
        alpha: 5,
        b: 120,
        beta: 65,
        w: 30,
        h: 28,
        dx: 10,
        dy: -8,
      },
    });

    const text = stringifyAssayYaml(cfg);
    const parsed = parseAssayYaml(text);

    expect(parsed.name).toBe("A1");
    expect(parsed.date).toBe("2026-02-24");
    expect(parsed.type).toBe("killing");
    expect(parsed.samples).toHaveLength(2);
    expect(parsed.register.shape).toBe("hex");
    expect(parsed.register.a).toBe(120);
  });
});
