import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Home, PanelsTopLeft, ListTodo, ChevronLeft, ChevronRight } from "lucide-react";
import { AppContainer } from "@/components/layout/AppContainer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { parseAssayYaml } from "@/lib/assay-yaml";
import { buildBboxCsv, type RegisterShape } from "@/lib/bbox";
import { parseSliceStringOverValues } from "@/lib/slices";
import { cn } from "@/lib/utils";
import { loadRegisterPersistEntry, saveRegisterPersistEntry } from "@/register/persist";
import type { AssayListItem, AssayYaml, FolderScan } from "@/lib/types";

interface ImageFrame {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

const selectClassName =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px]";

function drawPatternGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: RegisterShape,
): void {
  const alpha = (params.alpha * Math.PI) / 180;
  const beta = (params.beta * Math.PI) / 180;

  const v1 = { x: params.a * Math.cos(alpha), y: params.a * Math.sin(alpha) };
  const v2 = { x: params.b * Math.cos(beta), y: params.b * Math.sin(beta) };

  const center = { x: width / 2 + params.dx, y: height / 2 + params.dy };

  const minLen = Math.max(1, Math.min(Math.hypot(v1.x, v1.y), Math.hypot(v2.x, v2.y)));
  const maxRange = Math.ceil((Math.max(width, height) * 2) / minLen) + 2;

  ctx.lineWidth = 1.1;
  ctx.strokeStyle = "rgba(10, 10, 10, 0.9)";

  for (let i = -maxRange; i <= maxRange; i += 1) {
    for (let j = -maxRange; j <= maxRange; j += 1) {
      const cx = center.x + i * v1.x + j * v2.x;
      const cy = center.y + i * v1.y + j * v2.y;
      const x = cx - params.w / 2;
      const y = cy - params.h / 2;
      if (x < 0 || y < 0 || x + params.w > width || y + params.h > height) continue;

      if (params.shape === "hex") {
        const hw = params.w / 2;
        const hh = params.h / 2;
        ctx.beginPath();
        ctx.moveTo(cx - hw * 0.5, cy - hh);
        ctx.lineTo(cx + hw * 0.5, cy - hh);
        ctx.lineTo(cx + hw, cy);
        ctx.lineTo(cx + hw * 0.5, cy + hh);
        ctx.lineTo(cx - hw * 0.5, cy + hh);
        ctx.lineTo(cx - hw, cy);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.strokeRect(x, y, params.w, params.h);
      }
    }
  }
}

function RangeRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  unit = "px",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  unit?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
        <span className="text-muted-foreground">{Math.round(value * 100) / 100} {unit}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(next) => {
          const valueFromSlider = next[0];
          if (typeof valueFromSlider === "number" && Number.isFinite(valueFromSlider)) {
            onChange(valueFromSlider);
          }
        }}
      />
    </div>
  );
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const assayId = params.id ?? "";

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assay, setAssay] = useState<AssayListItem | null>(null);
  const [assayYaml, setAssayYaml] = useState<AssayYaml | null>(null);
  const [scan, setScan] = useState<FolderScan | null>(null);
  const [image, setImage] = useState<ImageFrame | null>(null);
  const [showSidebars, setShowSidebars] = useState(true);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [hydratedPersist, setHydratedPersist] = useState(false);

  const [registerParams, setRegisterParams] = useState<RegisterShape>({
    shape: "square",
    a: 75,
    alpha: 0,
    b: 75,
    beta: 90,
    w: 50,
    h: 50,
    dx: 0,
    dy: 0,
  });
  const initialRegisterParamsRef = useRef<RegisterShape>(registerParams);

  const [selectedPos, setSelectedPos] = useState(0);
  const [selectedChannel, setSelectedChannel] = useState(0);
  const [selectedTime, setSelectedTime] = useState(0);
  const [selectedZ, setSelectedZ] = useState(0);
  const [selectedSampleIndex, setSelectedSampleIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setHydratedPersist(false);
      setLoading(true);
      setError(null);
      try {
        const rows = await api.assays.list();
        const row = rows.find((item) => item.id === assayId) ?? null;
        if (!row) {
          if (!cancelled) setError("Assay not found.");
          return;
        }
        if (!row.has_assay_yaml) {
          if (!cancelled) setError("assay.yaml is missing for this assay.");
          return;
        }

        const yamlRead = await api.assays.readYaml(row.folder);
        if (!yamlRead.ok) {
          if (!cancelled) setError(yamlRead.error);
          return;
        }

        const parsed = parseAssayYaml(yamlRead.yaml);
        const folderScan = await api.register.scan(row.folder);

        if (cancelled) return;

        const nextParams: RegisterShape = {
          shape: parsed.register.shape,
          a: parsed.register.a,
          alpha: parsed.register.alpha,
          b: parsed.register.b,
          beta: parsed.register.beta,
          w: parsed.register.w,
          h: parsed.register.h,
          dx: parsed.register.dx,
          dy: parsed.register.dy,
        };
        const persisted = loadRegisterPersistEntry(row.id);

        const validPos = persisted && folderScan.positions.includes(persisted.selectedPos);
        const validChannel = persisted && folderScan.channels.includes(persisted.selectedChannel);
        const validTime = persisted && folderScan.times.includes(persisted.selectedTime);
        const validZ = persisted && folderScan.zSlices.includes(persisted.selectedZ);
        const validSampleIndex =
          persisted &&
          persisted.selectedSampleIndex >= 0 &&
          persisted.selectedSampleIndex < parsed.samples.length;

        const resolvedParams = persisted?.registerParams ?? nextParams;
        const resolvedPos = validPos && persisted ? persisted.selectedPos : (folderScan.positions[0] ?? 0);
        const resolvedChannel = validChannel && persisted
          ? persisted.selectedChannel
          : (folderScan.channels.includes(parsed.brightfield_channel)
            ? parsed.brightfield_channel
            : (folderScan.channels[0] ?? 0));
        const resolvedTime = validTime && persisted ? persisted.selectedTime : (folderScan.times[0] ?? 0);
        const resolvedZ = validZ && persisted ? persisted.selectedZ : (folderScan.zSlices[0] ?? 0);
        const resolvedSampleIndex = validSampleIndex && persisted ? persisted.selectedSampleIndex : 0;

        setAssay(row);
        setAssayYaml(parsed);
        setScan(folderScan);
        setRegisterParams(resolvedParams);
        initialRegisterParamsRef.current = resolvedParams;
        setSelectedPos(resolvedPos);
        setSelectedChannel(resolvedChannel);
        setSelectedTime(resolvedTime);
        setSelectedZ(resolvedZ);
        setSelectedSampleIndex(resolvedSampleIndex);
        setShowSidebars(persisted?.showSidebars ?? true);
        setHydratedPersist(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [assayId]);

  const samplePositions = useMemo(() => {
    if (!scan || !assayYaml || assayYaml.samples.length === 0) return scan?.positions ?? [];
    const sample = assayYaml.samples[selectedSampleIndex] ?? assayYaml.samples[0];
    if (!sample) return scan.positions;
    try {
      const indices = parseSliceStringOverValues(sample.position_slice, scan.positions);
      return indices
        .map((index) => scan.positions[index])
        .filter((value): value is number => typeof value === "number");
    } catch {
      return scan.positions;
    }
  }, [assayYaml, scan, selectedSampleIndex]);

  useEffect(() => {
    if (samplePositions.length === 0) return;
    if (!samplePositions.includes(selectedPos)) {
      setSelectedPos(samplePositions[0]);
    }
  }, [samplePositions, selectedPos]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!assay || !scan || scan.positions.length === 0) return;
      const response = await api.register.readImage({
        folder: assay.folder,
        pos: selectedPos,
        channel: selectedChannel,
        time: selectedTime,
        z: selectedZ,
      });

      if (cancelled) return;
      if (!response.ok) {
        setImage(null);
        setError(response.error);
        return;
      }

      const rgbaBuffer = response.rgba.slice(0);
      setError(null);
      setImage({
        width: response.width,
        height: response.height,
        rgba: new Uint8ClampedArray(rgbaBuffer),
      });
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [assay, scan, selectedPos, selectedChannel, selectedTime, selectedZ]);

  useEffect(() => {
    if (!assay || !hydratedPersist) return;
    const timer = window.setTimeout(() => {
      saveRegisterPersistEntry(assay.id, {
        registerParams,
        selectedPos,
        selectedChannel,
        selectedTime,
        selectedZ,
        selectedSampleIndex,
        showSidebars,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    assay,
    hydratedPersist,
    registerParams,
    selectedPos,
    selectedChannel,
    selectedTime,
    selectedZ,
    selectedSampleIndex,
    showSidebars,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = image?.width ?? 2048;
    const height = image?.height ?? 2048;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    if (image) {
      const frame = new ImageData(Uint8ClampedArray.from(image.rgba), image.width, image.height);
      ctx.putImageData(frame, 0, 0);
    } else {
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, 0, width, height);
    }

    drawPatternGrid(ctx, width, height, registerParams);
  }, [image, registerParams]);

  const currentSample = assayYaml?.samples[selectedSampleIndex] ?? null;

  const movePosition = useCallback(
    (direction: -1 | 1) => {
      const idx = samplePositions.indexOf(selectedPos);
      if (idx < 0) {
        if (samplePositions[0] != null) setSelectedPos(samplePositions[0]);
        return;
      }
      const next = idx + direction;
      if (next < 0 || next >= samplePositions.length) return;
      setSelectedPos(samplePositions[next]);
    },
    [samplePositions, selectedPos],
  );

  const handleSave = useCallback(async () => {
    if (!assay) return;
    const size = {
      width: image?.width ?? 2048,
      height: image?.height ?? 2048,
    };
    const csv = buildBboxCsv(size, registerParams);
    const result = await api.register.saveBbox({
      folder: assay.folder,
      pos: selectedPos,
      csv,
    });
    if (!result.ok) {
      setError(result.error);
    }
  }, [assay, image, registerParams, selectedPos]);

  if (loading) {
    return (
      <AppContainer className="max-w-[1240px]">
        <Card className="items-center py-16">
          <p className="text-sm text-muted-foreground">Loading register...</p>
        </Card>
      </AppContainer>
    );
  }

  return (
    <AppContainer className="max-w-[1240px]">
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <Tabs value="register" className="w-auto">
            <TabsList className="h-10 rounded-md">
              <TabsTrigger value="register" className="capitalize">register</TabsTrigger>
              <TabsTrigger value="view" disabled className="capitalize">view</TabsTrigger>
              <TabsTrigger value="analyze" disabled className="capitalize">analyze</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowSidebars((prev) => !prev)}>
              <PanelsTopLeft className="size-4" />
              expert
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowTaskModal(true)}>
              <ListTodo className="size-4" />
              task
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/assays")}>
              <Home className="size-4" />
              home
            </Button>
          </div>
        </div>

        <Separator />

        <div
          className={cn(
            "min-h-[620px]",
            showSidebars ? "grid grid-cols-[220px_minmax(0,1fr)_300px]" : "grid grid-cols-[minmax(0,1fr)]",
          )}
        >
          {showSidebars && (
            <aside className="space-y-4 border-r p-4">
              <div className="space-y-2">
                <Label>Channel</Label>
                <select
                  className={selectClassName}
                  value={selectedChannel}
                  onChange={(event) => setSelectedChannel(Number(event.target.value))}
                >
                  {(scan?.channels ?? []).map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label>Time</Label>
                <select
                  className={selectClassName}
                  value={selectedTime}
                  onChange={(event) => setSelectedTime(Number(event.target.value))}
                >
                  {(scan?.times ?? []).map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label>Z</Label>
                <select
                  className={selectClassName}
                  value={selectedZ}
                  onChange={(event) => setSelectedZ(Number(event.target.value))}
                >
                  {(scan?.zSlices ?? []).map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>
            </aside>
          )}

          <section className="flex min-w-0 flex-col gap-3 p-4">
            <div className="flex items-center justify-center gap-3 rounded-md border px-3 py-2 text-sm">
              <span className="font-medium">position {selectedPos}</span>
              <span className="text-muted-foreground">|</span>
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={selectedSampleIndex}
                onChange={(event) => setSelectedSampleIndex(Number(event.target.value))}
                disabled={!assayYaml || assayYaml.samples.length === 0}
              >
                {!assayYaml || assayYaml.samples.length === 0 ? (
                  <option value={0}>sample</option>
                ) : (
                  assayYaml.samples.map((sample, index) => (
                    <option key={`${sample.name}-${index}`} value={index}>
                      {sample.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="flex-1 overflow-auto rounded-lg border bg-muted/20 p-2">
              <canvas ref={canvasRef} className="mx-auto block max-h-full max-w-full" />
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setRegisterParams((prev) => ({ ...prev, shape: "square", b: prev.a, alpha: 0, beta: 90 }))
                }
              >
                Auto square
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setRegisterParams((prev) => ({ ...prev, shape: "hex", b: prev.a, alpha: 0, beta: 60 }))
                }
              >
                Auto hex
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRegisterParams(initialRegisterParamsRef.current)}
              >
                reset
              </Button>
              <Button size="sm" onClick={() => void handleSave()}>
                save
              </Button>
              <Button variant="outline" size="icon-sm" onClick={() => movePosition(-1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" size="icon-sm" onClick={() => movePosition(1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>

            {currentSample && (
              <p className="text-xs text-muted-foreground">sample slice: {currentSample.position_slice}</p>
            )}
          </section>

          {showSidebars && (
            <aside className="space-y-4 border-l p-4">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant={registerParams.shape === "square" ? "default" : "outline"}
                  onClick={() => setRegisterParams((prev) => ({ ...prev, shape: "square" }))}
                >
                  square
                </Button>
                <Button
                  size="sm"
                  variant={registerParams.shape === "hex" ? "default" : "outline"}
                  onClick={() => setRegisterParams((prev) => ({ ...prev, shape: "hex" }))}
                >
                  hex
                </Button>
              </div>

              <RangeRow
                label="a"
                value={registerParams.a}
                min={5}
                max={300}
                step={1}
                onChange={(value) => setRegisterParams((prev) => ({ ...prev, a: value }))}
              />
              <RangeRow
                label="alpha"
                value={registerParams.alpha}
                min={-180}
                max={180}
                step={1}
                unit="deg"
                onChange={(value) => setRegisterParams((prev) => ({ ...prev, alpha: value }))}
              />
              <RangeRow
                label="b"
                value={registerParams.b}
                min={5}
                max={300}
                step={1}
                onChange={(value) => setRegisterParams((prev) => ({ ...prev, b: value }))}
              />
              <RangeRow
                label="beta"
                value={registerParams.beta}
                min={-180}
                max={180}
                step={1}
                unit="deg"
                onChange={(value) => setRegisterParams((prev) => ({ ...prev, beta: value }))}
              />
              <RangeRow
                label="w"
                value={registerParams.w}
                min={5}
                max={200}
                step={1}
                onChange={(value) => setRegisterParams((prev) => ({ ...prev, w: value }))}
              />
              <RangeRow
                label="h"
                value={registerParams.h}
                min={5}
                max={200}
                step={1}
                onChange={(value) => setRegisterParams((prev) => ({ ...prev, h: value }))}
              />
              <RangeRow
                label="dx"
                value={registerParams.dx}
                min={-500}
                max={500}
                step={1}
                onChange={(value) => setRegisterParams((prev) => ({ ...prev, dx: value }))}
              />
              <RangeRow
                label="dy"
                value={registerParams.dy}
                min={-500}
                max={500}
                step={1}
                onChange={(value) => setRegisterParams((prev) => ({ ...prev, dy: value }))}
              />
            </aside>
          )}
        </div>
      </Card>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <Dialog open={showTaskModal} onOpenChange={setShowTaskModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Task</DialogTitle>
            <DialogDescription>Placeholder modal.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTaskModal(false)}>
              close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppContainer>
  );
}
