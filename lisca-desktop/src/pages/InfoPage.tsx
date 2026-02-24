import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, FolderOpen } from "lucide-react";
import { AppContainer } from "@/components/layout/AppContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { DEFAULT_REGISTER, parseAssayYaml, stringifyAssayYaml } from "@/lib/assay-yaml";
import type { AssaySample, AssayType } from "@/lib/types";

const selectClassName =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px]";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function InfoPage() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const params = useParams<{ id: string }>();
  const assayId = params.id;

  const typeParam = search.get("type");
  const preferredType: AssayType | null =
    typeParam === "killing" || typeParam === "expression" ? typeParam : null;

  const [loading, setLoading] = useState(!!assayId);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayIso());
  const [type, setType] = useState<AssayType>(preferredType ?? "killing");
  const [folder, setFolder] = useState("");
  const [brightfieldChannel, setBrightfieldChannel] = useState("0");
  const [samples, setSamples] = useState<AssaySample[]>([]);
  const [sampleName, setSampleName] = useState("");
  const [sampleSlice, setSampleSlice] = useState("");
  const [editingSampleIndex, setEditingSampleIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (preferredType) setType(preferredType);
      if (!assayId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const rows = await api.assays.list();
        const assay = rows.find((row) => row.id === assayId);
        if (!assay) {
          if (!cancelled) setError("Assay not found.");
          return;
        }

        if (cancelled) return;
        setName(assay.name);
        setDate(assay.time);
        setType(preferredType ?? assay.type);
        setFolder(assay.folder);

        if (assay.has_assay_yaml) {
          const read = await api.assays.readYaml(assay.folder);
          if (!read.ok) {
            if (!cancelled) setError(read.error);
            return;
          }
          const parsed = parseAssayYaml(read.yaml);
          if (cancelled) return;
          setName(parsed.name);
          setDate(parsed.date);
          setType(preferredType ?? parsed.type);
          setFolder(parsed.data_folder);
          setBrightfieldChannel(String(parsed.brightfield_channel));
          setSamples(parsed.samples);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [assayId, preferredType]);

  const canSave = useMemo(() => {
    return (
      name.trim().length > 0 &&
      date.trim().length > 0 &&
      folder.trim().length > 0 &&
      brightfieldChannel.trim().length > 0
    );
  }, [name, date, folder, brightfieldChannel]);

  const handleBrowseFolder = useCallback(async () => {
    const picked = await api.assays.pickDataFolder();
    if (!picked) return;
    setFolder(picked.path);
  }, []);

  const handleAddOrUpdateSample = useCallback(() => {
    const nextName = sampleName.trim();
    const nextSlice = sampleSlice.trim();
    if (!nextName || !nextSlice) {
      setError("Sample name and position slice are required.");
      return;
    }

    setSamples((prev) => {
      const next = [...prev];
      const record = { name: nextName, position_slice: nextSlice };
      if (editingSampleIndex != null && next[editingSampleIndex]) {
        next[editingSampleIndex] = record;
      } else {
        next.push(record);
      }
      return next;
    });

    setEditingSampleIndex(null);
    setSampleName("");
    setSampleSlice("");
    setError(null);
  }, [editingSampleIndex, sampleName, sampleSlice]);

  const beginEditSample = useCallback(
    (index: number) => {
      const sample = samples[index];
      if (!sample) return;
      setEditingSampleIndex(index);
      setSampleName(sample.name);
      setSampleSlice(sample.position_slice);
    },
    [samples],
  );

  const removeSample = useCallback(
    (index: number) => {
      setSamples((prev) => prev.filter((_, i) => i !== index));
      if (editingSampleIndex === index) {
        setEditingSampleIndex(null);
        setSampleName("");
        setSampleSlice("");
      }
    },
    [editingSampleIndex],
  );

  const handleSaveAndOpenRegister = useCallback(async () => {
    if (!canSave) {
      setError("Name, date, data folder, and brightfield channel are required.");
      return;
    }

    const channel = Number.parseInt(brightfieldChannel, 10);
    if (!Number.isFinite(channel) || channel < 0) {
      setError("Brightfield channel must be a non-negative integer.");
      return;
    }

    const nextYaml = {
      version: 1 as const,
      name: name.trim(),
      date: date.trim(),
      type,
      data_folder: folder.trim(),
      brightfield_channel: channel,
      samples,
      register: { ...DEFAULT_REGISTER },
    };

    try {
      const yaml = stringifyAssayYaml(nextYaml);
      const write = await api.assays.writeYaml(folder.trim(), yaml);
      if (!write.ok) {
        setError(write.error);
        return;
      }

      const saved = await api.assays.upsert({
        id: assayId,
        name: name.trim(),
        time: date.trim(),
        type,
        folder: folder.trim(),
      });

      navigate(`/register/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [assayId, brightfieldChannel, canSave, date, folder, name, navigate, samples, type]);

  return (
    <AppContainer className="max-w-4xl">
      <div className="space-y-5 rounded-lg border bg-background/90 p-6 shadow-sm backdrop-blur-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl tracking-tight">Info</h1>
            <p className="mt-1 text-sm text-muted-foreground">Configure assay metadata and sample mapping.</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate(assayId ? `/assays/${assayId}/actions` : "/assays/new/actions")}
            title="Back"
          >
            <ArrowLeft className="size-4" />
          </Button>
        </div>

        <div className="border-t border-border/70 pt-5">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading info...</p>
          ) : (
            <div className="grid gap-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Name</Label>
                  <Input value={name} onChange={(event) => setName(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
                  <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Data folder</Label>
                <div className="flex gap-2">
                  <Input value={folder} onChange={(event) => setFolder(event.target.value)} />
                  <Button variant="outline" onClick={() => void handleBrowseFolder()}>
                    <FolderOpen className="size-4" />
                    Browse
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Brightfield channel
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={brightfieldChannel}
                    onChange={(event) => setBrightfieldChannel(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Type</Label>
                  <select
                    className={selectClassName}
                    value={type}
                    onChange={(event) => setType(event.target.value as AssayType)}
                  >
                    <option value="killing">killing</option>
                    <option value="expression">expression</option>
                  </select>
                </div>
              </div>

              <div className="rounded-md border bg-muted/25 p-3">
                <div className="mb-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <Input
                    placeholder="Sample name"
                    value={sampleName}
                    onChange={(event) => setSampleName(event.target.value)}
                  />
                  <Input
                    placeholder="Position slice"
                    value={sampleSlice}
                    onChange={(event) => setSampleSlice(event.target.value)}
                  />
                  <Button variant="outline" onClick={handleAddOrUpdateSample}>
                    {editingSampleIndex == null ? "Add" : "Update"}
                  </Button>
                </div>

                <div className="flex min-h-8 flex-wrap gap-1.5">
                  {samples.map((sample, index) => (
                    <button
                      key={`${sample.name}-${sample.position_slice}-${index}`}
                      type="button"
                      onClick={() => beginEditSample(index)}
                      className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs transition-colors hover:bg-accent/50"
                    >
                      <span className="font-medium">{sample.name}</span>
                      <span className="text-muted-foreground">{sample.position_slice}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        className="rounded px-1 text-muted-foreground hover:text-foreground"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeSample(index);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            removeSample(index);
                          }
                        }}
                      >
                        x
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <Button disabled={!canSave} onClick={() => void handleSaveAndOpenRegister()}>
                  Save and Open Register
                </Button>
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </AppContainer>
  );
}
