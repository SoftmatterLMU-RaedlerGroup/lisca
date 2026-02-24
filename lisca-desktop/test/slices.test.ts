import { describe, expect, test } from "bun:test";
import { parseSliceString, parseSliceStringOverValues } from "../src/lib/slices";

describe("slice parser", () => {
  test("parses common slices", () => {
    expect(parseSliceString("all", 4)).toEqual([0, 1, 2, 3]);
    expect(parseSliceString("0:6:2", 8)).toEqual([0, 2, 4]);
    expect(parseSliceString("1,3", 5)).toEqual([1, 3]);
  });

  test("supports values projection", () => {
    expect(parseSliceStringOverValues("10:16:2", [8, 10, 12, 14, 16])).toEqual([1, 2, 3]);
  });

  test("rejects invalid segment", () => {
    expect(() => parseSliceString("bad", 5)).toThrow();
  });
});
