import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { api } from "@/lib/api";
import type { CropInfo } from "@/lib/types";

interface RoiFrame {
  width: number;
  height: number;
  data: Uint16Array;
}

const PAGE_SIZE = 9;

function percentile(sorted: Uint16Array, q: number): number {
  if (sorted.length === 0) return 0;
  const clamped = Math.max(0, Math.min(1, q));
  const index = Math.min(sorted.length - 1, Math.floor(clamped * (sorted.length - 1)));
  return sorted[index] ?? 0;
}

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

function canvasKey(pos: number, cropId: string): string {
  return `${pos}:${cropId}`;
}

export default function ViewTab({
  folder,
  pos,
  times,
  selectedTime,
  onSelectTime,
  channels,
  selectedChannel,
  zSlices,
  selectedZ,
}: {
  folder: string;
  pos: number;
  times: number[];
  selectedTime: number;
  onSelectTime: (time: number) => void;
  channels: number[];
  selectedChannel: number;
  zSlices: number[];
  selectedZ: number;
}) {
  const [crops, setCrops] = useState<CropInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [contrastMin, setContrastMin] = useState(0);
  const [contrastMax, setContrastMax] = useState(65535);
  const [autoContrastPending, setAutoContrastPending] = useState(true);
  const [frameByCropId, setFrameByCropId] = useState<Map<string, RoiFrame>>(new Map());

  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tIndex = useMemo(() => {
    const idx = times.indexOf(selectedTime);
    return idx >= 0 ? idx : 0;
  }, [selectedTime, times]);
  const cIndex = useMemo(() => {
    const idx = channels.indexOf(selectedChannel);
    return idx >= 0 ? idx : 0;
  }, [channels, selectedChannel]);
  const zIndex = useMemo(() => {
    const idx = zSlices.indexOf(selectedZ);
    return idx >= 0 ? idx : 0;
  }, [selectedZ, zSlices]);

  const maxT = Math.max(0, (crops[0]?.shape[0] ?? 1) - 1);
  const totalPages = Math.max(1, Math.ceil(crops.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageCrops = crops.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  useEffect(() => {
    if (tIndex > maxT) {
      const fallback = times[Math.min(maxT, Math.max(0, times.length - 1))];
      if (fallback != null) onSelectTime(fallback);
    }
  }, [maxT, onSelectTime, tIndex, times]);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages - 1));
  }, [totalPages]);

  useEffect(() => {
    let cancelled = false;
    if (!folder) {
      setCrops([]);
      return;
    }

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.roi.discover({ folder, pos });
        if (cancelled) return;
        setCrops(response.crops);
        setAutoContrastPending(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setCrops([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [folder, pos]);

  useEffect(() => {
    if (playing && maxT > 0 && times.length > 0) {
      playIntervalRef.current = setInterval(() => {
        const current = times.indexOf(selectedTime);
        const index = current >= 0 ? current : 0;
        const nextIndex = index >= maxT ? 0 : index + 1;
        const next = times[nextIndex];
        if (next != null) onSelectTime(next);
      }, 500);
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    };
  }, [maxT, onSelectTime, playing, selectedTime, times]);

  useEffect(() => {
    let cancelled = false;
    if (!folder || pageCrops.length === 0) {
      setFrameByCropId(new Map());
      return;
    }

    const run = async () => {
      const responses = await Promise.all(
        pageCrops.map((crop) =>
          api.roi.loadFrame({
            folder,
            pos,
            cropId: crop.cropId,
            t: Math.min(tIndex, maxT),
            c: cIndex,
            z: zIndex,
          }),
        ),
      );
      if (cancelled) return;

      const next = new Map<string, RoiFrame>();
      for (let i = 0; i < responses.length; i += 1) {
        const response = responses[i];
        const crop = pageCrops[i];
        if (!crop || !response.ok) continue;
        next.set(crop.cropId, {
          width: response.width,
          height: response.height,
          data: new Uint16Array(response.data),
        });
      }
      setFrameByCropId(next);

      if (autoContrastPending && next.size > 0) {
        const merged: number[] = [];
        next.forEach((frame) => {
          for (let i = 0; i < frame.data.length; i += 1) {
            merged.push(frame.data[i] ?? 0);
          }
        });
        if (merged.length > 0) {
          const sorted = Uint16Array.from(merged).sort();
          const lo = percentile(sorted, 0.001);
          const hi = Math.max(lo + 1, percentile(sorted, 0.999));
          setContrastMin(lo);
          setContrastMax(hi);
        }
        setAutoContrastPending(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [autoContrastPending, cIndex, folder, maxT, pageCrops, pos, tIndex, zIndex]);

  useEffect(() => {
    pageCrops.forEach((crop) => {
      const frame = frameByCropId.get(crop.cropId);
      const canvas = canvasRefs.current.get(canvasKey(pos, crop.cropId));
      if (!frame || !canvas) return;
      renderFrameToCanvas(canvas, frame, contrastMin, contrastMax);
    });
  }, [contrastMax, contrastMin, frameByCropId, pageCrops, pos]);

  const setCanvasRef = useCallback(
    (key: string) => (canvas: HTMLCanvasElement | null) => {
      if (canvas) {
        canvasRefs.current.set(key, canvas);
      } else {
        canvasRefs.current.delete(key);
      }
    },
    [],
  );

  const timeSliderMax = Math.max(maxT, 1);
  const noCrops = !loading && crops.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="grid grid-cols-3 items-center gap-2 rounded-lg border border-border bg-background/70 px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={clampedPage === 0}
            onClick={() => setPage((prev) => Math.max(0, prev - 1))}
          >
            <ChevronLeft className="size-3" />
          </Button>
          <span className="min-w-[4rem] text-center text-sm tabular-nums">
            {clampedPage + 1}/{totalPages}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={clampedPage >= totalPages - 1}
            onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
          >
            <ChevronRight className="size-3" />
          </Button>
        </div>
        <div className="flex items-center justify-center gap-2 text-sm">
          <span className="text-muted-foreground">contrast</span>
          <input
            type="number"
            value={contrastMin}
            onChange={(event) => setContrastMin(Number(event.target.value))}
            className="h-7 w-20 rounded border bg-background px-1 text-center text-xs"
          />
          <span>-</span>
          <input
            type="number"
            value={contrastMax}
            onChange={(event) => setContrastMax(Number(event.target.value))}
            className="h-7 w-20 rounded border bg-background px-1 text-center text-xs"
          />
          <Button variant="outline" size="xs" onClick={() => setAutoContrastPending(true)}>
            auto
          </Button>
        </div>
        <div className="justify-self-end text-sm tabular-nums">
          t {Math.min(tIndex, maxT)}/{maxT}
        </div>
      </div>

      <div className="flex items-center justify-center gap-1 rounded-lg border border-border bg-background/70 px-3 py-2">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            const next = times[0];
            if (next != null) onSelectTime(next);
          }}
          disabled={times.length === 0 || tIndex === 0}
        >
          <SkipBack className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            const next = times[Math.max(0, tIndex - 10)];
            if (next != null) onSelectTime(next);
          }}
          disabled={times.length === 0 || tIndex === 0}
        >
          <ChevronsLeft className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            const next = times[Math.max(0, tIndex - 1)];
            if (next != null) onSelectTime(next);
          }}
          disabled={times.length === 0 || tIndex === 0}
        >
          <ChevronLeft className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setPlaying((prev) => !prev)}
          disabled={times.length <= 1}
        >
          {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            const next = times[Math.min(maxT, tIndex + 1)];
            if (next != null) onSelectTime(next);
          }}
          disabled={times.length === 0 || tIndex >= maxT}
        >
          <ChevronRight className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            const next = times[Math.min(maxT, tIndex + 10)];
            if (next != null) onSelectTime(next);
          }}
          disabled={times.length === 0 || tIndex >= maxT}
        >
          <ChevronsRight className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            const next = times[Math.min(maxT, times.length - 1)];
            if (next != null) onSelectTime(next);
          }}
          disabled={times.length === 0 || tIndex >= maxT}
        >
          <SkipForward className="size-3" />
        </Button>
      </div>
      <Slider
        min={0}
        max={timeSliderMax}
        value={[Math.min(tIndex, maxT)]}
        onValueChange={(next) => {
          const raw = next[0];
          if (typeof raw !== "number" || !Number.isFinite(raw)) return;
          const idx = Math.max(0, Math.min(maxT, Math.round(raw)));
          const value = times[idx];
          if (value != null) onSelectTime(value);
        }}
      />

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-muted/20 p-2">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">loading ROI crops...</div>
        ) : noCrops ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {`no Pos${pos}_roi.zarr crops found for this position.`}
          </div>
        ) : (
          <div className="grid h-full grid-cols-3 grid-rows-3 gap-2">
            {pageCrops.map((crop) => (
              <div key={crop.cropId} className="relative overflow-hidden rounded border border-border bg-background">
                <canvas
                  ref={setCanvasRef(canvasKey(pos, crop.cropId))}
                  className="block h-full w-full object-contain"
                  style={{ imageRendering: "pixelated" }}
                />
                <div className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
                  {crop.cropId}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
