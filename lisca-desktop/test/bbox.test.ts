import { describe, expect, test } from "bun:test";
import { buildBboxCsv } from "../src/lib/bbox";

describe("bbox csv", () => {
  test("builds deterministic csv with header", () => {
    const csv = buildBboxCsv(
      { width: 300, height: 300 },
      {
        shape: "square",
        a: 60,
        alpha: 0,
        b: 60,
        beta: 90,
        w: 30,
        h: 30,
        dx: 0,
        dy: 0,
      },
    );

    const lines = csv.split("\n");
    expect(lines[0]).toBe("crop,x,y,w,h");
    expect(lines.length).toBeGreaterThan(1);
  });
});
