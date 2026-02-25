import { useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import type { KillPredictionRow, TaskRecord } from "@/lib/types";

const CLEAN_THRESHOLD = 0.8;
const HIST_BIN_WIDTH = 5;

function computeDeathTimes(rows: KillPredictionRow[]): Map<string, number> {
  const byCrop = new Map<string, KillPredictionRow[]>();
  for (const row of rows) {
    const current = byCrop.get(row.crop) ?? [];
    current.push(row);
    byCrop.set(row.crop, current);
  }

  const deathTimes = new Map<string, number>();
  byCrop.forEach((cropRows, crop) => {
    cropRows.sort((a, b) => a.t - b.t);
    const tMin = cropRows[0]?.t ?? 0;
    const trueTimes = [...new Set(cropRows.filter((item) => item.label).map((item) => item.t))].sort(
      (a, b) => a - b,
    );
    if (trueTimes.length === 0) {
      deathTimes.set(crop, 0);
      return;
    }

    let chosenEnd = -1;
    for (let i = trueTimes.length - 1; i >= 0; i -= 1) {
      const end = trueTimes[i] ?? 0;
      const span = cropRows.filter((item) => item.t >= tMin && item.t <= end);
      const trueCount = span.filter((item) => item.label).length;
      if (span.length > 0 && trueCount / span.length >= CLEAN_THRESHOLD) {
        chosenEnd = end;
        break;
      }
    }
    if (chosenEnd < 0) chosenEnd = trueTimes[0] ?? 0;
    const spanDuration = chosenEnd - tMin + 1;
    deathTimes.set(crop, spanDuration === 1 ? 0 : chosenEnd);
  });

  return deathTimes;
}

function rowsFromTaskResult(task: TaskRecord, pos: number): KillPredictionRow[] | null {
  const taskPos = task.request["pos"];
  if (typeof taskPos !== "number" || taskPos !== pos) return null;
  const rowsValue = task.result?.["rows"];
  if (!Array.isArray(rowsValue)) return null;
  const rows: KillPredictionRow[] = [];
  for (const item of rowsValue) {
    if (!item || typeof item !== "object") continue;
    const row = item as { t?: unknown; crop?: unknown; label?: unknown };
    if (typeof row.t !== "number" || typeof row.crop !== "string" || typeof row.label !== "boolean") continue;
    rows.push({
      t: row.t,
      crop: row.crop,
      label: row.label,
    });
  }
  return rows.length > 0 ? rows : null;
}

export default function AnalyzeTab({
  folder,
  pos,
  tasks,
  hasPrediction,
}: {
  folder: string;
  pos: number;
  tasks: TaskRecord[];
  hasPrediction: boolean;
}) {
  const [rows, setRows] = useState<KillPredictionRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (folder && hasPrediction) {
          const response = await api.application.loadPredictionCsv({ folder, pos });
          if (!cancelled && response.ok && response.rows.length > 0) {
            setRows(response.rows);
            return;
          }
        }

        const fallbackRows = tasks
          .filter((task) => task.kind === "killing.predict" && task.status === "succeeded")
          .map((task) => rowsFromTaskResult(task, pos))
          .find((value): value is KillPredictionRow[] => Array.isArray(value) && value.length > 0);
        if (!cancelled) {
          setRows(fallbackRows ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setRows(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [folder, hasPrediction, pos, tasks]);

  const { curveData, deathTimes, cropCount } = useMemo(() => {
    if (!rows || rows.length === 0) {
      return {
        curveData: [] as Array<{ t: number; n: number }>,
        deathTimes: [] as number[],
        cropCount: 0,
      };
    }
    const dt = computeDeathTimes(rows);
    const deaths = [...dt.values()];
    const maxT = Math.max(...rows.map((row) => row.t), ...deaths, 0);
    const byT = new Map<number, number>();
    for (let t = 0; t <= maxT; t += 1) {
      const alive = [...dt.values()].filter((d) => d > 0 && d >= t).length;
      byT.set(t, alive);
    }
    let data = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, n]) => ({ t, n }));
    if (data.length === 1) {
      data = [{ t: Math.max(0, data[0]?.t ?? 0) - 1, n: 0 }, data[0] ?? { t: 0, n: 0 }];
    }
    return {
      curveData: data,
      deathTimes: deaths,
      cropCount: dt.size,
    };
  }, [rows]);

  const histData = useMemo(() => {
    const filtered = deathTimes.filter((value) => value > 0);
    if (filtered.length === 0) return [];
    const maxT = Math.max(...filtered, 1);
    const binEdges: number[] = [];
    for (let edge = 1; edge <= maxT + 1; edge += HIST_BIN_WIDTH) {
      binEdges.push(edge);
    }
    if ((binEdges[binEdges.length - 1] ?? 0) <= maxT) {
      binEdges.push(maxT + 1);
    }
    const out: Array<{ t: number; n: number }> = [];
    for (let i = 0; i < binEdges.length - 1; i += 1) {
      const lo = binEdges[i] ?? 0;
      const hi = binEdges[i + 1] ?? lo + 1;
      const center = (lo + hi - 1) / 2;
      const count = filtered.filter((d) => d >= lo && d < hi).length;
      out.push({ t: center, n: count });
    }
    return out;
  }, [deathTimes]);

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">loading predictions...</div>;
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        run killing inference from dashboard to populate analysis.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <span className="text-sm text-muted-foreground">{cropCount} patterns</span>
      <div className="min-h-0 flex-1 space-y-6 overflow-auto pr-1">
        <div className="rounded-lg border border-border bg-background/70 p-3">
          <h3 className="mb-2 text-sm font-medium">kill curve (n alive)</h3>
          <div className="h-[24rem] w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={curveData} margin={{ top: 5, right: 5, left: 5, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="t" tick={{ fontSize: 12 }} label={{ value: "frame", position: "bottom", offset: -5 }} />
                <YAxis tick={{ fontSize: 12 }} domain={[0, "auto"]} label={{ value: "n alive", angle: -90, position: "insideLeft" }} />
                <Area type="monotone" dataKey="n" fill="var(--primary)" fillOpacity={0.25} stroke="none" isAnimationActive={false} />
                <Line type="monotone" dataKey="n" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-background/70 p-3">
          <h3 className="mb-2 text-sm font-medium">survival time distribution</h3>
          <div className="h-[24rem] w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={histData} margin={{ top: 5, right: 5, left: 5, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="t" tick={{ fontSize: 12 }} label={{ value: "frame at death", position: "bottom", offset: -5 }} />
                <YAxis tick={{ fontSize: 12 }} label={{ value: "frequency", angle: -90, position: "insideLeft" }} />
                <Bar dataKey="n" fill="var(--primary)" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
