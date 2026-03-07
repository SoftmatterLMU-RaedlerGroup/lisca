import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AnnotationFrameKey } from "@/lib/types";
import type { AnnotationPoint, FrameAnnotationDraft } from "@/lib/annotations";
import { cn } from "@/lib/utils";

interface RoiFrame {
  width: number;
  height: number;
  data: Uint16Array;
}

type AnnotationTool = "segmentation" | "spots" | "classification";

function renderFrameToCanvas(
  canvas: HTMLCanvasElement,
  frame: RoiFrame,
  contrastMin: number,
  contrastMax: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = frame.width;
  canvas.height = frame.height;
  const range = Math.max(1, contrastMax - contrastMin);
  const rgba = new Uint8ClampedArray(frame.width * frame.height * 4);
  for (let i = 0; i < frame.data.length; i += 1) {
    const value = frame.data[i] ?? 0;
    const normalized = Math.max(0, Math.min(1, (value - contrastMin) / range));
    const pixel = Math.round(normalized * 255);
    const offset = i * 4;
    rgba[offset] = pixel;
    rgba[offset + 1] = pixel;
    rgba[offset + 2] = pixel;
    rgba[offset + 3] = 255;
  }

  ctx.putImageData(new ImageData(rgba, frame.width, frame.height), 0, 0);
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function pointFromEvent(
  event: React.MouseEvent<SVGSVGElement>,
  frame: RoiFrame,
): AnnotationPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = rect.width > 0 ? ((event.clientX - rect.left) / rect.width) * frame.width : 0;
  const y = rect.height > 0 ? ((event.clientY - rect.top) / rect.height) * frame.height : 0;
  return {
    x: roundCoordinate(Math.max(0, Math.min(frame.width, x))),
    y: roundCoordinate(Math.max(0, Math.min(frame.height, y))),
  };
}

export default function AnnotationDialog({
  open,
  frameKey,
  frame,
  contrastMin,
  contrastMax,
  classificationOptions,
  initialDraft,
  onClose,
  onSave,
}: {
  open: boolean;
  frameKey: AnnotationFrameKey | null;
  frame: RoiFrame | null;
  contrastMin: number;
  contrastMax: number;
  classificationOptions: string[];
  initialDraft: FrameAnnotationDraft;
  onClose: () => void;
  onSave: (draft: FrameAnnotationDraft) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<AnnotationTool>("segmentation");
  const [draft, setDraft] = useState<FrameAnnotationDraft>(initialDraft);
  const [activeContour, setActiveContour] = useState<AnnotationPoint[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTool("segmentation");
    setDraft(initialDraft);
    setActiveContour([]);
    setSaveError(null);
  }, [initialDraft, open]);

  useEffect(() => {
    if (!frame || !canvasRef.current) return;
    renderFrameToCanvas(canvasRef.current, frame, contrastMin, contrastMax);
  }, [contrastMax, contrastMin, frame]);

  const closeActiveContour = useCallback(() => {
    if (activeContour.length < 3) return;
    setDraft((prev) => ({
      ...prev,
      segmentations: [...prev.segmentations, activeContour],
    }));
    setActiveContour([]);
  }, [activeContour]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && activeContour.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        setActiveContour([]);
        return;
      }
      if (event.key === "Enter" && activeContour.length >= 3) {
        event.preventDefault();
        closeActiveContour();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [activeContour.length, closeActiveContour, open]);

  const handleOverlayClick = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (!frame) return;
      const point = pointFromEvent(event, frame);

      if (tool === "spots") {
        setDraft((prev) => ({
          ...prev,
          spots: [...prev.spots, point],
        }));
        return;
      }

      if (tool === "segmentation") {
        if (event.detail >= 2) {
          closeActiveContour();
          return;
        }
        setActiveContour((prev) => [...prev, point]);
      }
    },
    [closeActiveContour, frame, tool],
  );

  const handleSave = useCallback(async () => {
    if (activeContour.length > 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [activeContour.length, draft, onClose, onSave]);

  const summary = useMemo(
    () => ({
      spots: draft.spots.length,
      contours: draft.segmentations.length,
      classification: draft.classification,
    }),
    [draft],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="max-w-[min(96vw,80rem)] gap-3"
        onEscapeKeyDown={(event) => {
          if (activeContour.length > 0) {
            event.preventDefault();
            setActiveContour([]);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            annotate {frameKey?.roi ?? "roi"}
          </DialogTitle>
          <DialogDescription>
            {frameKey
              ? `t ${frameKey.t} | c ${frameKey.c} | z ${frameKey.z}`
              : "annotation frame"}
          </DialogDescription>
        </DialogHeader>

        {!frame ? (
          <div className="rounded-lg border bg-muted/20 p-6 text-sm text-muted-foreground">
            ROI frame unavailable.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/20 p-3">
                <div
                  className="relative mx-auto w-full overflow-hidden rounded border border-border bg-black"
                  style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
                >
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 h-full w-full"
                    style={{ imageRendering: "pixelated" }}
                  />
                  <svg
                    viewBox={`0 0 ${frame.width} ${frame.height}`}
                    className={cn(
                      "absolute inset-0 h-full w-full touch-none",
                      tool === "classification" ? "cursor-default" : "cursor-crosshair",
                    )}
                    onClick={handleOverlayClick}
                  >
                    {draft.segmentations.map((contour, index) => (
                      <polygon
                        key={`contour-${index}`}
                        points={contour.map((point) => `${point.x},${point.y}`).join(" ")}
                        fill="rgba(59, 130, 246, 0.18)"
                        stroke="rgba(59, 130, 246, 0.95)"
                        strokeWidth={2}
                      />
                    ))}
                    {activeContour.length > 0 && (
                      <polyline
                        points={activeContour.map((point) => `${point.x},${point.y}`).join(" ")}
                        fill="none"
                        stroke="rgba(250, 204, 21, 0.95)"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                      />
                    )}
                    {activeContour.map((point, index) => (
                      <circle
                        key={`active-node-${index}`}
                        cx={point.x}
                        cy={point.y}
                        r={3}
                        fill="rgba(250, 204, 21, 1)"
                      />
                    ))}
                    {draft.spots.map((spot, index) => (
                      <circle
                        key={`spot-${index}`}
                        cx={spot.x}
                        cy={spot.y}
                        r={4}
                        fill="rgba(239, 68, 68, 0.9)"
                        stroke="white"
                        strokeWidth={1.5}
                      />
                    ))}
                  </svg>
                </div>
              </div>

              <div className="grid gap-2 rounded-lg border bg-background/70 p-3 text-xs text-muted-foreground sm:grid-cols-3">
                <div>classification: {summary.classification ?? "none"}</div>
                <div>spots: {summary.spots}</div>
                <div>contours: {summary.contours}</div>
              </div>
            </div>

            <div className="space-y-4 rounded-lg border bg-background/70 p-3">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">tool</p>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant={tool === "segmentation" ? "default" : "outline"}
                    size="xs"
                    onClick={() => setTool("segmentation")}
                  >
                    segmentation
                  </Button>
                  <Button
                    variant={tool === "spots" ? "default" : "outline"}
                    size="xs"
                    onClick={() => setTool("spots")}
                  >
                    spots
                  </Button>
                  <Button
                    variant={tool === "classification" ? "default" : "outline"}
                    size="xs"
                    onClick={() => setTool("classification")}
                  >
                    classification
                  </Button>
                </div>
              </div>

              {tool === "segmentation" && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Click to add contour nodes. Double-click or press Enter to close. Press Esc to cancel the active contour.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={activeContour.length < 3}
                      onClick={() => closeActiveContour()}
                    >
                      finish contour
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={activeContour.length === 0}
                      onClick={() => setActiveContour([])}
                    >
                      cancel contour
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={draft.segmentations.length === 0}
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          segmentations: prev.segmentations.slice(0, -1),
                        }))
                      }
                    >
                      remove last
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={draft.segmentations.length === 0}
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          segmentations: [],
                        }))
                      }
                    >
                      clear all
                    </Button>
                  </div>
                </div>
              )}

              {tool === "spots" && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Click inside the ROI image to add a spot.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={draft.spots.length === 0}
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          spots: prev.spots.slice(0, -1),
                        }))
                      }
                    >
                      remove last
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={draft.spots.length === 0}
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          spots: [],
                        }))
                      }
                    >
                      clear all
                    </Button>
                  </div>
                </div>
              )}

              {tool === "classification" && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {classificationOptions.length > 0
                      ? "Select one predefined class for this ROI frame."
                      : "No classification options configured in assay.yaml."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {classificationOptions.map((option) => (
                      <Button
                        key={option}
                        variant={draft.classification === option ? "default" : "outline"}
                        size="xs"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            classification: option,
                          }))
                        }
                      >
                        {option}
                      </Button>
                    ))}
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          classification: null,
                        }))
                      }
                    >
                      clear
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {saveError && <p className="text-sm text-destructive">{saveError}</p>}

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            cancel
          </Button>
          <Button disabled={saving || activeContour.length > 0 || !frame} onClick={() => void handleSave()}>
            {saving ? "saving..." : "save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
