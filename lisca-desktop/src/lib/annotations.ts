import type {
  AnnotationClassificationRow,
  AnnotationFrameKey,
  AnnotationLoadResponse,
  AnnotationSegmentationRow,
  AnnotationSpotRow,
} from "@/lib/types";

export interface AnnotationPoint {
  x: number;
  y: number;
}

export interface FrameAnnotationDraft {
  classification: string | null;
  spots: AnnotationPoint[];
  segmentations: AnnotationPoint[][];
}

export interface PositionAnnotationData extends AnnotationLoadResponse {}

export function createEmptyPositionAnnotationData(): PositionAnnotationData {
  return {
    classifications: [],
    spots: [],
    segmentations: [],
  };
}

export function frameKeyId(key: AnnotationFrameKey): string {
  return [key.roi, key.t, key.c, key.z].join("\u0000");
}

export function getFrameAnnotationDraft(
  data: PositionAnnotationData,
  key: AnnotationFrameKey,
): FrameAnnotationDraft {
  const id = frameKeyId(key);
  const classification =
    data.classifications.find((row) => frameKeyId(row) === id)?.className ?? null;

  const spots = data.spots
    .filter((row) => frameKeyId(row) === id)
    .sort((a, b) => a.spotIdx - b.spotIdx)
    .map((row) => ({ x: row.x, y: row.y }));

  const contourMap = new Map<number, AnnotationPoint[]>();
  data.segmentations
    .filter((row) => frameKeyId(row) === id)
    .sort((a, b) => {
      if (a.contourIdx !== b.contourIdx) return a.contourIdx - b.contourIdx;
      return a.nodeIdx - b.nodeIdx;
    })
    .forEach((row) => {
      const contour = contourMap.get(row.contourIdx) ?? [];
      contour.push({ x: row.x, y: row.y });
      contourMap.set(row.contourIdx, contour);
    });

  return {
    classification,
    spots,
    segmentations: [...contourMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map((entry) => entry[1]),
  };
}

export function replaceFrameAnnotations(
  data: PositionAnnotationData,
  key: AnnotationFrameKey,
  draft: FrameAnnotationDraft,
): PositionAnnotationData {
  const id = frameKeyId(key);

  const classifications = data.classifications.filter((row) => frameKeyId(row) !== id);
  const spots = data.spots.filter((row) => frameKeyId(row) !== id);
  const segmentations = data.segmentations.filter((row) => frameKeyId(row) !== id);

  const nextClassifications: AnnotationClassificationRow[] = draft.classification
    ? [
        {
          ...key,
          className: draft.classification,
        },
      ]
    : [];

  const nextSpots: AnnotationSpotRow[] = draft.spots.map((spot, index) => ({
    ...key,
    spotIdx: index,
    x: spot.x,
    y: spot.y,
  }));

  const nextSegmentations: AnnotationSegmentationRow[] = draft.segmentations.flatMap(
    (contour, contourIdx) =>
      contour.map((node, nodeIdx) => ({
        ...key,
        contourIdx,
        nodeIdx,
        x: node.x,
        y: node.y,
      })),
  );

  return {
    classifications: [...classifications, ...nextClassifications],
    spots: [...spots, ...nextSpots],
    segmentations: [...segmentations, ...nextSegmentations],
  };
}
