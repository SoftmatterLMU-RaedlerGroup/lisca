import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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

type RegisterMainTab = "dashboard" | "register" | "view" | "analyze";
type DragMode = "none" | "pan" | "rotate" | "resize";

function drawPatternGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: RegisterShape,
  overlayOpacity: number,
): void {
  const alpha = (params.alpha * Math.PI) / 180;
  const beta = (params.beta * Math.PI) / 180;

  const v1 = { x: params.a * Math.cos(alpha), y: params.a * Math.sin(alpha) };
  const v2 = { x: params.b * Math.cos(beta), y: params.b * Math.sin(beta) };

  const center = { x: width / 2 + params.dx, y: height / 2 + params.dy };

  const minLen = Math.max(1, Math.min(Math.hypot(v1.x, v1.y), Math.hypot(v2.x, v2.y)));
  const maxRange = Math.ceil((Math.max(width, height) * 2) / minLen) + 2;

  const safeOpacity = Math.max(0, Math.min(1, overlayOpacity));
  ctx.lineWidth = 0.9;
  ctx.fillStyle = `rgba(59, 130, 246, ${safeOpacity})`;
  ctx.strokeStyle = `rgba(37, 99, 235, ${Math.min(1, safeOpacity + 0.2)})`;

  for (let i = -maxRange; i <= maxRange; i += 1) {
    for (let j = -maxRange; j <= maxRange; j += 1) {
      const cx = center.x + i * v1.x + j * v2.x;
      const cy = center.y + i * v1.y + j * v2.y;
      const x = cx - params.w / 2;
      const y = cy - params.h / 2;
      if (x < 0 || y < 0 || x + params.w > width || y + params.h > height) continue;
      ctx.fillRect(x, y, params.w, params.h);
      ctx.strokeRect(x, y, params.w, params.h);
    }
  }

  // Match mupattern register affordance: origin + vector 1 (red) + vector 2 (green).
  const drawArrow = (toX: number, toY: number, color: string): void => {
    const angle = Math.atan2(toY - center.y, toX - center.x);
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    const head = 60;
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - head * Math.cos(angle - 0.3), toY - head * Math.sin(angle - 0.3));
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - head * Math.cos(angle + 0.3), toY - head * Math.sin(angle + 0.3));
    ctx.stroke();
  };

  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.beginPath();
  ctx.arc(center.x, center.y, 12, 0, Math.PI * 2);
  ctx.fill();

  drawArrow(center.x + v1.x, center.y + v1.y, "rgba(255, 100, 100, 0.9)");
  drawArrow(center.x + v2.x, center.y + v2.y, "rgba(100, 255, 100, 0.9)");
}

function normalizeAngleDeg(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Number.isFinite(normalized) ? normalized : 0;
}

function scaleRegisterShapeToImageSpace(
  params: RegisterShape,
  fromSize: { width: number; height: number },
  toSize: { width: number; height: number },
): RegisterShape {
  if (
    fromSize.width <= 0 ||
    fromSize.height <= 0 ||
    toSize.width <= 0 ||
    toSize.height <= 0
  ) {
    return params;
  }

  const sx = toSize.width / fromSize.width;
  const sy = toSize.height / fromSize.height;

  const scaleVector = (length: number, angleDeg: number): { length: number; angleDeg: number } => {
    const angleRad = (angleDeg * Math.PI) / 180;
    const x = length * Math.cos(angleRad) * sx;
    const y = length * Math.sin(angleRad) * sy;
    return {
      length: Math.hypot(x, y),
      angleDeg: normalizeAngleDeg((Math.atan2(y, x) * 180) / Math.PI),
    };
  };

  const v1 = scaleVector(params.a, params.alpha);
  const v2 = scaleVector(params.b, params.beta);

  return {
    ...params,
    a: v1.length,
    alpha: v1.angleDeg,
    b: v2.length,
    beta: v2.angleDeg,
    w: params.w * sx,
    h: params.h * sy,
    dx: params.dx * sx,
    dy: params.dy * sy,
  };
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
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <span className="text-sm text-muted-foreground">
          {Math.round(value * 100) / 100} {unit}
        </span>
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

function DiscreteSliderRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: number[];
  value: number;
  onChange: (value: number) => void;
}) {
  const values = options.length > 0 ? options : [0];
  const valueIndex = Math.max(0, values.indexOf(value));
  const sliderMax = Math.max(values.length - 1, 1);
  const [draftIndex, setDraftIndex] = useState(valueIndex);

  useEffect(() => {
    setDraftIndex(valueIndex);
  }, [valueIndex, values.length]);

  const clampToIndex = (raw: number) => Math.max(0, Math.min(values.length - 1, Math.round(raw)));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <span className="text-sm text-muted-foreground">{values[draftIndex] ?? values[0]}</span>
      </div>
      <Slider
        min={0}
        max={sliderMax}
        step={1}
        value={[draftIndex]}
        disabled={options.length <= 1}
        onValueChange={(next) => {
          const raw = next[0];
          if (typeof raw === "number" && Number.isFinite(raw)) {
            setDraftIndex(clampToIndex(raw));
          }
        }}
        onValueCommit={(next) => {
          if (options.length === 0) return;
          const raw = next[0];
          if (typeof raw !== "number" || !Number.isFinite(raw)) return;
          const index = clampToIndex(raw);
          onChange(values[index] ?? values[0]);
        }}
      />
    </div>
  );
}

export default function WorkPage() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const assayId = params.id ?? "";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragModeRef = useRef<DragMode>("none");
  const activePointerIdRef = useRef<number | null>(null);
  const lastPointerRef = useRef({ x: 0, y: 0 });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assay, setAssay] = useState<AssayListItem | null>(null);
  const [assayYaml, setAssayYaml] = useState<AssayYaml | null>(null);
  const [scan, setScan] = useState<FolderScan | null>(null);
  const [image, setImage] = useState<ImageFrame | null>(null);
  const [modelImageSize, setModelImageSize] = useState<{ width: number; height: number } | null>(null);
  const [showSidebars, setShowSidebars] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const taskMenuRef = useRef<HTMLDivElement>(null);
  const [hydratedPersist, setHydratedPersist] = useState(false);
  const [activeTab, setActiveTab] = useState<RegisterMainTab>(
    searchParams.get("tab") === "register" ? "register" : "dashboard",
  );
  const [selectedSampleFilters, setSelectedSampleFilters] = useState<string[]>([]);

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
  const [overlayOpacity, setOverlayOpacity] = useState(0.35);

  const refreshScan = useCallback(async () => {
    if (!assay) return;
    try {
      const nextScan = await api.register.scan(assay.folder);
      setScan(nextScan);
    } catch {
      // Keep current scan state if background refresh fails.
    }
  }, [assay]);

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
        setModelImageSize(null);
        setRegisterParams(resolvedParams);
        initialRegisterParamsRef.current = resolvedParams;
        setSelectedPos(resolvedPos);
        setSelectedChannel(resolvedChannel);
        setSelectedTime(resolvedTime);
        setSelectedZ(resolvedZ);
        setSelectedSampleIndex(resolvedSampleIndex);
        setShowSidebars(false);
        setOverlayOpacity(persisted?.overlayOpacity ?? 0.35);
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

  const allPositions = useMemo(() => scan?.positions ?? [], [scan]);

  const positionSampleMap = useMemo(() => {
    const mapping = new Map<number, string[]>();
    const positions = scan?.positions ?? [];
    if (!assayYaml || positions.length === 0) return mapping;

    for (const sample of assayYaml.samples) {
      try {
        const indices = parseSliceStringOverValues(sample.position_slice, positions);
        for (const index of indices) {
          const pos = positions[index];
          if (typeof pos !== "number") continue;
          const labels = mapping.get(pos) ?? [];
          if (!labels.includes(sample.name)) labels.push(sample.name);
          mapping.set(pos, labels);
        }
      } catch {
        // Skip invalid sample slice in dashboard mapping view.
      }
    }
    return mapping;
  }, [assayYaml, scan]);

  const dashboardSampleOptions = useMemo(() => {
    const names = assayYaml?.samples.map((sample) => sample.name).filter((name) => name.trim().length > 0) ?? [];
    return [...new Set(names)];
  }, [assayYaml]);

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "dashboard" || tab === "register") {
      setActiveTab(tab);
    }
  }, [searchParams]);

  useEffect(() => {
    if (dashboardSampleOptions.length === 0) {
      setSelectedSampleFilters([]);
      return;
    }
    setSelectedSampleFilters((prev) => prev.filter((name) => dashboardSampleOptions.includes(name)));
  }, [dashboardSampleOptions]);

  const dashboardPositions = useMemo(() => {
    if (!scan) return [];
    if (selectedSampleFilters.length === 0) return scan.positions;
    return scan.positions.filter((pos) => {
      const labels = positionSampleMap.get(pos) ?? [];
      return selectedSampleFilters.every((sampleName) => labels.includes(sampleName));
    });
  }, [scan, selectedSampleFilters, positionSampleMap]);

  const filterButtonIsActive = useCallback(
    (sampleName: string) => selectedSampleFilters.includes(sampleName),
    [selectedSampleFilters],
  );

  const toggleSampleFilter = useCallback((sampleName: string) => {
    setSelectedSampleFilters((prev) =>
      prev.includes(sampleName) ? prev.filter((value) => value !== sampleName) : [...prev, sampleName],
    );
  }, []);

  useEffect(() => {
    if (allPositions.length === 0) return;
    if (!allPositions.includes(selectedPos)) {
      setSelectedPos(allPositions[0]);
    }
  }, [allPositions, selectedPos]);

  useEffect(() => {
    if (activeTab !== "dashboard") return;
    void refreshScan();
  }, [activeTab, refreshScan]);

  useEffect(() => {
    if (activeTab !== "dashboard") return;
    if (dashboardPositions.length === 0) return;
    if (!dashboardPositions.includes(selectedPos)) {
      setSelectedPos(dashboardPositions[0]);
    }
  }, [activeTab, dashboardPositions, selectedPos]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!assay) return;
      const request = {
        folder: assay.folder,
        pos: selectedPos,
        channel: selectedChannel,
        time: selectedTime,
        z: selectedZ,
      };
      const response = await api.register.readImage({
        folder: request.folder,
        pos: request.pos,
        channel: request.channel,
        time: request.time,
        z: request.z,
      });
      if (cancelled) return;
      if (response.ok) {
        setModelImageSize((prev) => {
          if (!prev) return { width: response.width, height: response.height };
          return {
            width: Math.max(prev.width, response.width),
            height: Math.max(prev.height, response.height),
          };
        });
        setError(null);
        setImage({
          width: response.width,
          height: response.height,
          rgba: new Uint8ClampedArray(response.rgba.slice(0)),
        });
        return;
      }
      setImage(null);
      setError(response.error || "Failed to load image.");
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [assay, selectedPos, selectedChannel, selectedTime, selectedZ]);

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
        overlayOpacity,
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
    overlayOpacity,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = image?.width ?? 2048;
    const height = image?.height ?? 2048;
    const drawSize = { width, height };
    const modelSize = modelImageSize ?? drawSize;
    const drawParams = scaleRegisterShapeToImageSpace(registerParams, modelSize, drawSize);

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

    drawPatternGrid(ctx, width, height, drawParams, overlayOpacity);
  }, [activeTab, image, modelImageSize, overlayOpacity, registerParams]);

  const currentPosIndex = allPositions.indexOf(selectedPos);
  const canMovePrev = currentPosIndex > 0;
  const canMoveNext = currentPosIndex >= 0 && currentPosIndex < allPositions.length - 1;
  const registeredPosSet = useMemo(
    () => new Set((scan?.registeredPositions ?? []).filter((value) => Number.isFinite(value))),
    [scan],
  );

  const movePosition = useCallback(
    (direction: -1 | 1) => {
      const idx = allPositions.indexOf(selectedPos);
      if (idx < 0) {
        if (allPositions[0] != null) setSelectedPos(allPositions[0]);
        return;
      }
      const next = idx + direction;
      if (next < 0 || next >= allPositions.length) return;
      setSelectedPos(allPositions[next]);
    },
    [allPositions, selectedPos],
  );

  const handleCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== null) return;
    if (event.button === 2) {
      dragModeRef.current = "rotate";
    } else if (event.button === 1) {
      dragModeRef.current = "resize";
    } else if (event.button === 0) {
      dragModeRef.current = "pan";
    } else {
      return;
    }
    activePointerIdRef.current = event.pointerId;
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, []);

  const handleCanvasPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    if (dragModeRef.current === "none") return;

    const dx = event.clientX - lastPointerRef.current.x;
    const dy = event.clientY - lastPointerRef.current.y;
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    const displaySize = {
      width: image?.width ?? 2048,
      height: image?.height ?? 2048,
    };
    const modelSize = modelImageSize ?? displaySize;
    const sx = displaySize.width > 0 ? displaySize.width / modelSize.width : 1;
    const sy = displaySize.height > 0 ? displaySize.height / modelSize.height : 1;
    const invSx = sx > 0 ? 1 / sx : 1;
    const invSy = sy > 0 ? 1 / sy : 1;

    if (dragModeRef.current === "pan") {
      setRegisterParams((prev) => ({
        ...prev,
        dx: prev.dx + dx * invSx,
        dy: prev.dy + dy * invSy,
      }));
      return;
    }

    if (dragModeRef.current === "rotate") {
      const deltaDeg = (dx / Math.max(1, displaySize.width)) * 220;
      setRegisterParams((prev) => ({
        ...prev,
        alpha: normalizeAngleDeg(prev.alpha + deltaDeg),
        beta: normalizeAngleDeg(prev.beta + deltaDeg),
      }));
      return;
    }

    const factor = Math.max(0.01, 1 + (dx / Math.max(1, displaySize.width)) * 2.5);
    setRegisterParams((prev) => ({
      ...prev,
      a: Math.max(5, prev.a * factor),
      b: Math.max(5, prev.b * factor),
    }));
  }, [image, modelImageSize]);

  const handleCanvasPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointerIdRef.current = null;
    dragModeRef.current = "none";
  }, []);

  const handleCanvasPointerCancel = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointerIdRef.current = null;
    dragModeRef.current = "none";
  }, []);

  const handleCanvasWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();

    let deltaY = event.deltaY;
    if (event.deltaMode === 1) deltaY *= 16;
    if (event.deltaMode === 2) deltaY *= 320;

    const factor = Math.exp(-deltaY * 0.0015);
    setRegisterParams((prev) => ({
      ...prev,
      w: Math.max(5, Math.min(200, prev.w * factor)),
      h: Math.max(5, Math.min(200, prev.h * factor)),
    }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!assay) return;
    if (!image) {
      setError("No image loaded for current selection.");
      return;
    }
    const modelSize = modelImageSize ?? {
      width: image.width,
      height: image.height,
    };
    const imageSize = {
      width: image.width,
      height: image.height,
    };
    const imageSpaceParams = scaleRegisterShapeToImageSpace(registerParams, modelSize, imageSize);
    const csv = buildBboxCsv(imageSize, imageSpaceParams);
    const result = await api.register.saveBbox({
      folder: assay.folder,
      pos: selectedPos,
      csv,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    await refreshScan();
  }, [assay, image, modelImageSize, refreshScan, registerParams, selectedPos]);

  useEffect(() => {
    if (!showTaskModal) return;

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (taskMenuRef.current && taskMenuRef.current.contains(target)) {
        return;
      }
      setShowTaskModal(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowTaskModal(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleDocumentClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showTaskModal]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading work page...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="border-b border-border bg-background">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as RegisterMainTab)} className="w-auto">
            <TabsList>
              <TabsTrigger value="dashboard">
                dashboard
              </TabsTrigger>
              <TabsTrigger value="register">
                register
              </TabsTrigger>
              <TabsTrigger value="view" disabled>
                view
              </TabsTrigger>
            <TabsTrigger value="analyze" disabled>
                analyze
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/80 px-2 py-1.5 backdrop-blur-sm">
            <Button
              variant={showSidebars ? "destructive" : "outline"}
              size="sm"
              className="h-7 text-sm"
              onClick={() => setShowSidebars((prev) => !prev)}
              aria-label="Toggle expert mode"
            >
              expert
            </Button>
              <div className="relative" ref={taskMenuRef}>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-sm"
                  onClick={() => setShowTaskModal((prev) => !prev)}
                  aria-label="Open task"
                >
                  task
                </Button>
                {showTaskModal && (
                  <div
                    className="absolute right-0 top-full z-50 mt-2 w-64 rounded-md border border-border bg-background p-3 shadow-lg"
                  >
                    <div className="h-24" />
                  </div>
                )}
            </div>
            <Button variant="outline" size="sm" className="h-7 text-sm" onClick={() => navigate("/setup")} aria-label="Go to setup">
              home
            </Button>
          </div>
        </div>
      </header>

      {error && <div className="border-b border-border bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>}

      <div className="flex min-h-0 flex-1">
        {showSidebars && (
          <aside className="w-72 flex-shrink-0 overflow-y-auto border-r border-border bg-background/80 p-4 backdrop-blur-sm">
            {activeTab !== "dashboard" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">image</h2>
                  <Separator className="mt-2" />
                </div>

                <div className="space-y-4">
                  <DiscreteSliderRow
                    label="channel"
                    options={scan?.channels ?? []}
                    value={selectedChannel}
                    onChange={setSelectedChannel}
                  />

                  <DiscreteSliderRow
                    label="time"
                    options={scan?.times ?? []}
                    value={selectedTime}
                    onChange={setSelectedTime}
                  />

                  <DiscreteSliderRow
                    label="z"
                    options={scan?.zSlices ?? []}
                    value={selectedZ}
                    onChange={setSelectedZ}
                  />
                </div>
              </div>
            )}
          </aside>
        )}

        <section
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-3 p-4",
            !showSidebars && "mx-auto w-full max-w-[1100px]",
          )}
        >
          {activeTab === "dashboard" ? (
            <>
              <div className="flex justify-center">
                <div className="inline-flex w-fit flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-background/80 px-3 py-2">
                  {dashboardSampleOptions.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No samples loaded</span>
                  ) : (
                    dashboardSampleOptions.map((sampleName) => (
                      <Button
                        key={sampleName}
                        size="sm"
                        variant={filterButtonIsActive(sampleName) ? "secondary" : "outline"}
                        onClick={() => toggleSampleFilter(sampleName)}
                        className="h-7"
                      >
                        {sampleName}
                      </Button>
                    ))
                  )}
                </div>
              </div>
              <div className="flex flex-1 overflow-auto rounded-md border border-border bg-background">
                <div className="w-full">
                  <div className="grid h-10 grid-cols-3 items-center border-b bg-muted/40 px-4 text-sm font-medium">
                    <span>Position</span>
                    <span>Sample</span>
                    <span>Registered</span>
                  </div>
                  {(dashboardPositions ?? []).length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">No positions found.</div>
                  ) : (
                    (dashboardPositions ?? []).map((pos) => {
                      if (!Number.isFinite(pos)) return null;
                      const selected = pos === selectedPos;
                      const labels = positionSampleMap.get(pos) ?? [];
                      return (
                        <button
                          key={pos}
                          type="button"
                          className={cn(
                            "grid w-full grid-cols-3 items-center border-b px-4 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/70",
                            selected &&
                              "bg-muted/70",
                          )}
                          onClick={() => {
                            setSelectedPos(pos);
                            if (assayYaml?.samples?.length) {
                              const firstMatch = assayYaml.samples.findIndex((sample) =>
                                labels.includes(sample.name),
                              );
                              if (firstMatch >= 0) setSelectedSampleIndex(firstMatch);
                            }
                          }}
                        >
                          <span className="font-medium">{pos}</span>
                          <span className="flex flex-wrap gap-1">
                            {labels.length === 0 ? (
                              <span className="h-4" />
                            ) : (
                              labels.map((label) => (
                                <span
                                  key={`${pos}-${label}`}
                                  className="inline-flex items-center rounded-full border bg-background px-2 py-0.5 text-xs"
                                >
                                  {label}
                                </span>
                              ))
                            )}
                          </span>
                          <span className="text-xs">
                            {registeredPosSet.has(pos) ? (
                              <Check className="size-4 text-foreground" />
                            ) : (
                              <X className="size-4 text-muted-foreground" />
                            )}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-center">
                <div className="inline-flex w-fit items-center gap-2 rounded-xl border border-border bg-background/80 px-2 py-2 text-sm">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => movePosition(-1)}
                    disabled={!canMovePrev}
                    aria-label="Previous position"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <span className="min-w-24 px-2 text-center font-medium tabular-nums">
                    position {selectedPos}
                  </span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => movePosition(1)}
                    disabled={!canMoveNext}
                    aria-label="Next position"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-1 items-center justify-center overflow-auto">
                <div className="flex aspect-square h-full w-auto max-h-full max-w-full items-center justify-center rounded-lg border border-border bg-muted/30 p-3">
                  <canvas
                    ref={canvasRef}
                    className="max-h-full max-w-full cursor-move object-contain"
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerUp={handleCanvasPointerUp}
                    onPointerCancel={handleCanvasPointerCancel}
                    onWheel={handleCanvasWheel}
                    onContextMenu={(event) => event.preventDefault()}
                  />
                </div>
              </div>

              <div className="flex justify-center pt-3">
                <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-xl border border-border bg-background/80 px-2 py-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-sm"
                    onClick={() =>
                      setRegisterParams((prev) => ({ ...prev, shape: "square", b: prev.a, alpha: 0, beta: 90 }))
                    }
                  >
                    auto square
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-sm"
                    onClick={() =>
                      setRegisterParams((prev) => ({ ...prev, shape: "hex", b: prev.a, alpha: 0, beta: 60 }))
                    }
                  >
                    auto hex
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-sm"
                    onClick={() => {
                      setRegisterParams((prev) => ({
                        ...prev,
                        a: 75,
                        alpha: 0,
                        b: 75,
                        beta: 90,
                        w: 50,
                        h: 50,
                        dx: 0,
                        dy: 0,
                      }));
                      setOverlayOpacity(0.35);
                    }}
                  >
                    reset
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-sm" onClick={() => void handleSave()}>
                    save
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>

        {showSidebars && (
          <aside className="w-72 flex-shrink-0 overflow-y-auto border-l border-border bg-background/80 p-4 backdrop-blur-sm">
            {activeTab !== "dashboard" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Pattern</h2>
                  <Separator />
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-sm"
                      variant="outline"
                      onClick={() =>
                        setRegisterParams((prev) => ({
                          ...prev,
                          shape: "square",
                          beta: normalizeAngleDeg(prev.alpha + 90),
                        }))
                      }
                    >
                      square
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-sm"
                      variant="outline"
                      onClick={() =>
                        setRegisterParams((prev) => ({
                          ...prev,
                          shape: "hex",
                          beta: normalizeAngleDeg(prev.alpha + 60),
                        }))
                      }
                    >
                      hex
                    </Button>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">opacity</Label>
                      <span className="text-sm text-muted-foreground">{Math.round(overlayOpacity * 100)}%</span>
                    </div>
                    <Slider
                      min={0}
                      max={1}
                      step={0.01}
                      value={[overlayOpacity]}
                      onValueChange={(next) => {
                        const value = next[0];
                        if (typeof value === "number" && Number.isFinite(value)) {
                          setOverlayOpacity(Math.max(0, Math.min(1, value)));
                        }
                      }}
                    />
                  </div>
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
              </div>
            )}
          </aside>
        )}
      </div>

    </div>
  );
}
