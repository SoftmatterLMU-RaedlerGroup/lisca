import { describe, expect, test } from "bun:test";
import {
  createEmptyPositionAnnotationData,
  getFrameAnnotationDraft,
  replaceFrameAnnotations,
} from "../src/lib/annotations";

describe("annotations", () => {
  test("saving one frame replaces only that frame", () => {
    const base = {
      classifications: [
        { roi: "roi-a", t: 0, c: 0, z: 0, className: "alive" },
        { roi: "roi-b", t: 0, c: 0, z: 0, className: "dead" },
      ],
      spots: [
        { roi: "roi-a", t: 0, c: 0, z: 0, spotIdx: 0, x: 1, y: 2 },
        { roi: "roi-b", t: 0, c: 0, z: 0, spotIdx: 0, x: 3, y: 4 },
      ],
      segmentations: [
        { roi: "roi-a", t: 0, c: 0, z: 0, contourIdx: 0, nodeIdx: 0, x: 1, y: 1 },
        { roi: "roi-b", t: 0, c: 0, z: 0, contourIdx: 0, nodeIdx: 0, x: 2, y: 2 },
      ],
    };

    const next = replaceFrameAnnotations(
      base,
      { roi: "roi-a", t: 0, c: 0, z: 0 },
      {
        classification: "late",
        spots: [{ x: 9, y: 10 }],
        segmentations: [[{ x: 11, y: 12 }]],
      },
    );

    expect(next.classifications).toEqual([
      { roi: "roi-b", t: 0, c: 0, z: 0, className: "dead" },
      { roi: "roi-a", t: 0, c: 0, z: 0, className: "late" },
    ]);
    expect(next.spots).toEqual([
      { roi: "roi-b", t: 0, c: 0, z: 0, spotIdx: 0, x: 3, y: 4 },
      { roi: "roi-a", t: 0, c: 0, z: 0, spotIdx: 0, x: 9, y: 10 },
    ]);
    expect(next.segmentations).toEqual([
      { roi: "roi-b", t: 0, c: 0, z: 0, contourIdx: 0, nodeIdx: 0, x: 2, y: 2 },
      { roi: "roi-a", t: 0, c: 0, z: 0, contourIdx: 0, nodeIdx: 0, x: 11, y: 12 },
    ]);
  });

  test("spots and contours are reindexed densely on save", () => {
    const next = replaceFrameAnnotations(
      createEmptyPositionAnnotationData(),
      { roi: "roi-a", t: 1, c: 2, z: 3 },
      {
        classification: null,
        spots: [
          { x: 10, y: 10 },
          { x: 20, y: 20 },
        ],
        segmentations: [
          [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
          [
            { x: 3, y: 3 },
          ],
        ],
      },
    );

    expect(next.spots).toEqual([
      { roi: "roi-a", t: 1, c: 2, z: 3, spotIdx: 0, x: 10, y: 10 },
      { roi: "roi-a", t: 1, c: 2, z: 3, spotIdx: 1, x: 20, y: 20 },
    ]);
    expect(next.segmentations).toEqual([
      { roi: "roi-a", t: 1, c: 2, z: 3, contourIdx: 0, nodeIdx: 0, x: 1, y: 1 },
      { roi: "roi-a", t: 1, c: 2, z: 3, contourIdx: 0, nodeIdx: 1, x: 2, y: 2 },
      { roi: "roi-a", t: 1, c: 2, z: 3, contourIdx: 1, nodeIdx: 0, x: 3, y: 3 },
    ]);
  });

  test("clearing classification removes only that frame classification row", () => {
    const base = {
      classifications: [
        { roi: "roi-a", t: 0, c: 0, z: 0, className: "alive" },
        { roi: "roi-a", t: 1, c: 0, z: 0, className: "dead" },
      ],
      spots: [],
      segmentations: [],
    };

    const next = replaceFrameAnnotations(
      base,
      { roi: "roi-a", t: 0, c: 0, z: 0 },
      { classification: null, spots: [], segmentations: [] },
    );

    expect(next.classifications).toEqual([
      { roi: "roi-a", t: 1, c: 0, z: 0, className: "dead" },
    ]);
  });

  test("frame draft groups saved spot and contour rows", () => {
    const draft = getFrameAnnotationDraft(
      {
        classifications: [{ roi: "roi-a", t: 0, c: 0, z: 0, className: "alive" }],
        spots: [{ roi: "roi-a", t: 0, c: 0, z: 0, spotIdx: 0, x: 5, y: 6 }],
        segmentations: [
          { roi: "roi-a", t: 0, c: 0, z: 0, contourIdx: 0, nodeIdx: 0, x: 1, y: 2 },
          { roi: "roi-a", t: 0, c: 0, z: 0, contourIdx: 0, nodeIdx: 1, x: 3, y: 4 },
        ],
      },
      { roi: "roi-a", t: 0, c: 0, z: 0 },
    );

    expect(draft).toEqual({
      classification: "alive",
      spots: [{ x: 5, y: 6 }],
      segmentations: [[{ x: 1, y: 2 }, { x: 3, y: 4 }]],
    });
  });
});
