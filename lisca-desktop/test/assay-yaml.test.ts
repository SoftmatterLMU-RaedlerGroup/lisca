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
      annotations: {
        classification_options: ["Alive", "Dead", "Alive", "  Late  "],
      },
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
    expect(parsed.annotations?.classification_options).toEqual(["Alive", "Dead", "Late"]);
  });

  test("normalizes classification options by trimming and de-duplicating", () => {
    const cfg = normalizeAssayYaml({
      version: 1,
      name: "A2",
      date: "2026-02-24",
      type: "killing",
      data_folder: "C:/data",
      brightfield_channel: 0,
      annotations: {
        classification_options: ["  Alive ", "", "Alive", "Dead", "  Dead  ", "Late"],
      },
      samples: [],
      register: {
        shape: "square",
        a: 75,
        alpha: 0,
        b: 75,
        beta: 90,
        w: 50,
        h: 50,
        dx: 0,
        dy: 0,
      },
    });

    expect(cfg.annotations?.classification_options).toEqual(["Alive", "Dead", "Late"]);
  });

  test("missing annotation config leaves classification options unset", () => {
    const parsed = parseAssayYaml(`
version: 1
name: A3
date: 2026-02-24
type: killing
data_folder: C:/data
brightfield_channel: 0
samples:
  - name: sample-a
    position_slice: all
register:
  shape: square
  a: 75
  alpha: 0
  b: 75
  beta: 90
  w: 50
  h: 50
  dx: 0
  dy: 0
`);

    expect(parsed.annotations?.classification_options).toBeUndefined();
  });
});
