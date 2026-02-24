import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppContainer } from "@/components/layout/AppContainer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { DEFAULT_REGISTER, parseAssayYaml, stringifyAssayYaml } from "@/lib/assay-yaml";
import { cn } from "@/lib/utils";
import type { AssayChannelName, AssayListItem, AssaySample, AssayType } from "@/lib/types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type AddTab = "type" | "channel" | "info";

export default function SetupPage() {
  const navigate = useNavigate();

  const [assays, setAssays] = useState<AssayListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<AddTab>("type");
  const [editingAssayId, setEditingAssayId] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayIso());
  const [type, setType] = useState<AssayType>("killing");
  const [folder, setFolder] = useState("");
  const [samples, setSamples] = useState<AssaySample[]>([]);
  const [sampleName, setSampleName] = useState("");
  const [sampleSlice, setSampleSlice] = useState("");
  const [editingSampleIndex, setEditingSampleIndex] = useState<number | null>(null);
  const [channelNames, setChannelNames] = useState<AssayChannelName[]>([]);
  const [channelInput, setChannelInput] = useState("");
  const [channelNameInput, setChannelNameInput] = useState("");
  const [editingChannelIndex, setEditingChannelIndex] = useState<number | null>(null);

  const loadAssays = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.assays.list();
      setAssays(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAssays();
  }, [loadAssays]);

  const canSave = useMemo(() => {
    return (
      name.trim().length > 0 &&
      date.trim().length > 0 &&
      folder.trim().length > 0
    );
  }, [name, date, folder]);

  const resetAddForm = useCallback(() => {
    setAddTab("type");
    setEditingAssayId(null);
    setModalLoading(false);
    setName("");
    setDate(todayIso());
    setType("killing");
    setFolder("");
    setSamples([]);
    setSampleName("");
    setSampleSlice("");
    setEditingSampleIndex(null);
    setChannelNames([]);
    setChannelInput("");
    setChannelNameInput("");
    setEditingChannelIndex(null);
    setAddError(null);
  }, []);

  const openAddModal = useCallback(() => {
    resetAddForm();
    setAddOpen(true);
  }, [resetAddForm]);

  const handleEditAssay = useCallback(async (assay: AssayListItem) => {
    setAddOpen(true);
    setModalLoading(true);
    setEditingAssayId(assay.id);
    setAddTab("info");
    setAddError(null);

    setName(assay.name);
    setDate(assay.time);
    setType(assay.type);
    setFolder(assay.folder);
    setSamples([]);
    setSampleName("");
    setSampleSlice("");
    setEditingSampleIndex(null);
    setChannelNames([]);
    setChannelInput("");
    setChannelNameInput("");
    setEditingChannelIndex(null);

    try {
      if (!assay.has_assay_yaml) return;
      const read = await api.assays.readYaml(assay.folder);
      if (!read.ok) {
        setAddError(read.error);
        return;
      }
      const parsed = parseAssayYaml(read.yaml);
      setName(parsed.name);
      setDate(parsed.date);
      setType(parsed.type);
      setFolder(parsed.data_folder);
      setSamples(parsed.samples);
      setChannelNames(parsed.channel_names ?? []);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setModalLoading(false);
    }
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      await api.assays.remove(id);
      await loadAssays();
    },
    [loadAssays],
  );

  const handleImportAssay = useCallback(async () => {
    setImporting(true);
    setError(null);
    try {
      const picked = await api.assays.pickAssayYaml();
      if (!picked) return;

      const read = await api.assays.readYaml(picked.folder);
      if (!read.ok) {
        setError(read.error);
        return;
      }

      const parsed = parseAssayYaml(read.yaml);
      const saved = await api.assays.upsert({
        name: parsed.name,
        time: parsed.date,
        type: parsed.type,
        folder: picked.folder,
      });
      await loadAssays();
      navigate(`/work/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }, [loadAssays, navigate]);

  const handleBrowseFolder = useCallback(async () => {
    const picked = await api.assays.pickDataFolder();
    if (!picked) return;
    setFolder(picked.path);
  }, []);

  const handleAddOrUpdateSample = useCallback(() => {
    const nextName = sampleName.trim();
    const nextSlice = sampleSlice.trim();
    if (!nextName || !nextSlice) {
      setAddError("sample name and position slice are required.");
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
    setAddError(null);
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

  const handleAddOrUpdateChannel = useCallback(() => {
    const nextChannel = Number.parseInt(channelInput, 10);
    const nextName = channelNameInput.trim();
    if (!Number.isFinite(nextChannel) || nextChannel < 0) {
      setAddError("channel must be a non-negative integer.");
      return;
    }
    if (!nextName) {
      setAddError("channel name is required.");
      return;
    }

    setChannelNames((prev) => {
      const next = [...prev];
      const record = { channel: nextChannel, name: nextName };
      if (editingChannelIndex != null && next[editingChannelIndex]) {
        next[editingChannelIndex] = record;
      } else {
        const existing = next.findIndex((entry) => entry.channel === nextChannel);
        if (existing >= 0) next[existing] = record;
        else next.push(record);
      }
      return next.sort((a, b) => a.channel - b.channel);
    });

    setEditingChannelIndex(null);
    setChannelInput("");
    setChannelNameInput("");
    setAddError(null);
  }, [channelInput, channelNameInput, editingChannelIndex]);

  const beginEditChannel = useCallback(
    (index: number) => {
      const entry = channelNames[index];
      if (!entry) return;
      setEditingChannelIndex(index);
      setChannelInput(String(entry.channel));
      setChannelNameInput(entry.name);
    },
    [channelNames],
  );

  const removeChannel = useCallback(
    (index: number) => {
      setChannelNames((prev) => prev.filter((_, i) => i !== index));
      if (editingChannelIndex === index) {
        setEditingChannelIndex(null);
        setChannelInput("");
        setChannelNameInput("");
      }
    },
    [editingChannelIndex],
  );

  const handleSave = useCallback(async () => {
    if (!canSave) {
      setAddError("name, date, and data folder are required.");
      return;
    }

    setSaving(true);
    setAddError(null);

    const folderPath = folder.trim();
    const scan = await api.register.scan(folderPath);
    const tifChannels = [...new Set(scan.channels.filter((value) => Number.isFinite(value)))].sort((a, b) => a - b);
    if (tifChannels.length === 0) {
      setAddError("no tiff channels found in selected data folder.");
      setSaving(false);
      return;
    }

    const normalizedChannelNames = channelNames
      .filter((entry) => Number.isFinite(entry.channel) && entry.channel >= 0 && entry.name.trim().length > 0)
      .map((entry) => ({ channel: Math.floor(entry.channel), name: entry.name.trim() }))
      .sort((a, b) => a.channel - b.channel);

    const assigned = [...new Set(normalizedChannelNames.map((entry) => entry.channel))].sort((a, b) => a - b);
    const invalidAssigned = assigned.filter((channel) => !tifChannels.includes(channel));
    if (invalidAssigned.length > 0) {
      setAddError(`assigned channels not found in tiff names: ${invalidAssigned.join(", ")}.`);
      setSaving(false);
      return;
    }

    const missingAssignments = tifChannels.filter((channel) => !assigned.includes(channel));
    if (missingAssignments.length > 0) {
      setAddError(`missing channel assignment for tiff channels: ${missingAssignments.join(", ")}.`);
      setSaving(false);
      return;
    }

    const brightfield = tifChannels.includes(0) ? 0 : (tifChannels[0] ?? 0);

    const nextYaml = {
      version: 1 as const,
      name: name.trim(),
      date: date.trim(),
      type,
      data_folder: folderPath,
      brightfield_channel: brightfield,
      channel_names: normalizedChannelNames,
      samples,
      register: { ...DEFAULT_REGISTER },
    };

    try {
      const yaml = stringifyAssayYaml(nextYaml);
      const write = await api.assays.writeYaml(folderPath, yaml);
      if (!write.ok) {
        setAddError(write.error);
        return;
      }

      const saved = await api.assays.upsert({
        id: editingAssayId ?? undefined,
        name: name.trim(),
        time: date.trim(),
        type,
        folder: folderPath,
      });

      await loadAssays();
      setAddOpen(false);
      navigate(`/work/${saved.id}`);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [canSave, channelNames, date, editingAssayId, folder, loadAssays, name, navigate, samples, type]);

  return (
    <AppContainer className="max-w-4xl">
      <div className="space-y-5 rounded-lg border bg-background/90 p-6 shadow-sm backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-4xl tracking-tight">LISCA ASSAYS</h1>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void handleImportAssay();
              }}
              disabled={importing}
              title="import"
            >
              {importing ? "importing..." : "import"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={openAddModal}
              title="add"
            >
              add
            </Button>
          </div>
        </div>
        <div className="border-t border-border/70" />

        {loading && <p className="py-8 text-sm text-muted-foreground">loading assays...</p>}

        {!loading && assays.length === 0 && (
          <p className="py-8 text-sm text-muted-foreground">no assays yet. add one to get started.</p>
        )}

        {!loading && assays.length > 0 && (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[30%]" />
                <col className="w-[30%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead>
                <tr className="border-b bg-muted/25 text-sm font-medium text-muted-foreground">
                  <th className="px-4 py-2 text-left">name</th>
                  <th className="px-3 py-2 text-left">time</th>
                  <th className="px-3 py-2 text-left">type</th>
                  <th className="px-2 py-2 text-right">
                    <span className="sr-only">action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {assays.map((assay) => {
                  const blocked = !assay.has_assay_yaml;
                  return (
                    <tr
                      key={assay.id}
                      role={blocked ? undefined : "button"}
                      tabIndex={blocked ? -1 : 0}
                      aria-disabled={blocked}
                      className={cn(
                        "border-b align-middle last:border-b-0",
                        blocked
                          ? "bg-muted/55 text-muted-foreground"
                          : "cursor-pointer bg-background hover:bg-accent/40",
                      )}
                      onClick={() => {
                        if (!blocked) navigate(`/work/${assay.id}?tab=dashboard`);
                      }}
                      onKeyDown={(event) => {
                        if (blocked) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate(`/work/${assay.id}?tab=dashboard`);
                        }
                      }}
                      title={blocked ? assay.missing_reason ?? "assay.yaml missing" : "open dashboard"}
                    >
                      <td className="px-4 py-2.5 align-middle">
                        <div className="min-w-0">
                          <p className={cn("truncate text-sm", blocked ? "text-muted-foreground" : "text-foreground")}>
                            {assay.name}
                          </p>
                          {blocked && (
                            <p className="truncate text-xs text-destructive/80">
                              {assay.missing_reason ?? "assay.yaml not found"}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-middle text-sm">{assay.time}</td>
                      <td className="px-3 py-2.5 align-middle text-sm">{assay.type}</td>
                      <td className="px-2 py-2.5 text-right align-middle">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="xs"
                            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                            title="edit assay"
                            aria-label="edit assay"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleEditAssay(assay);
                            }}
                          >
                            edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                            title="delete assay"
                            aria-label="delete assay"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDelete(assay.id);
                            }}
                          >
                            delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) {
            setEditingAssayId(null);
            setModalLoading(false);
            setAddError(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <Tabs value={addTab} onValueChange={(value) => setAddTab(value as AddTab)} className="w-full">
            <TabsList>
              <TabsTrigger value="type">type</TabsTrigger>
              <TabsTrigger value="info">info</TabsTrigger>
              <TabsTrigger value="channel">channel</TabsTrigger>
            </TabsList>

            <TabsContent value="type" className="mt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  className={cn(
                    "flex h-32 flex-col items-start justify-center gap-2 rounded-lg border bg-background p-4 text-left text-sm transition-colors hover:bg-accent/40",
                    type === "killing" && "border-ring bg-accent/20",
                  )}
                  onClick={() => setType("killing")}
                >
                  <p className="font-medium">killing</p>
                  <p className="text-xs text-muted-foreground">
                    car-t cell killing of target cells seeded on patterns.
                  </p>
                </button>
                <button
                  type="button"
                  className={cn(
                    "flex h-32 flex-col items-start justify-center gap-2 rounded-lg border bg-background p-4 text-left text-sm transition-colors hover:bg-accent/40",
                    type === "expression" && "border-ring bg-accent/20",
                  )}
                  onClick={() => setType("expression")}
                >
                  <p className="font-medium">expression</p>
                  <p className="text-xs text-muted-foreground">
                    lnp-mediated egfp-mrna expression to cells seeded on patterns.
                  </p>
                </button>
              </div>
            </TabsContent>

            <TabsContent value="channel" className="mt-4">
              <div className="rounded-md border bg-muted/25 p-3">
                <div className="mb-3 grid gap-2 md:grid-cols-[120px_1fr_auto]">
                  <Input
                    type="number"
                    min={0}
                    placeholder="channel"
                    value={channelInput}
                    onChange={(event) => setChannelInput(event.target.value)}
                  />
                  <Input
                    placeholder="name"
                    value={channelNameInput}
                    onChange={(event) => setChannelNameInput(event.target.value)}
                  />
                  <Button variant="outline" onClick={handleAddOrUpdateChannel}>
                    {editingChannelIndex == null ? "add" : "update"}
                  </Button>
                </div>

                <div className="flex min-h-8 flex-wrap gap-1.5">
                  {channelNames.map((entry, index) => (
                    <button
                      key={`${entry.channel}-${entry.name}-${index}`}
                      type="button"
                      onClick={() => beginEditChannel(index)}
                      className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs transition-colors hover:bg-accent/50"
                    >
                      <span className="font-medium">ch {entry.channel}</span>
                      <span className="text-muted-foreground">{entry.name}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        className="rounded px-1 text-muted-foreground hover:text-foreground"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeChannel(index);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            removeChannel(index);
                          }
                        }}
                      >
                        x
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="info" className="mt-4">
              <div className="grid gap-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm tracking-wider text-muted-foreground">name</Label>
                    <Input value={name} onChange={(event) => setName(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm tracking-wider text-muted-foreground">date</Label>
                    <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm tracking-wider text-muted-foreground">data folder</Label>
                  <div className="flex gap-2">
                    <Input value={folder} onChange={(event) => setFolder(event.target.value)} />
                    <Button variant="outline" onClick={() => void handleBrowseFolder()}>
                      browse
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border bg-muted/25 p-3">
                  <div className="mb-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                    <Input
                      placeholder="sample name"
                      value={sampleName}
                      onChange={(event) => setSampleName(event.target.value)}
                    />
                    <Input
                      placeholder="position slice"
                      value={sampleSlice}
                      onChange={(event) => setSampleSlice(event.target.value)}
                    />
                    <Button variant="outline" onClick={handleAddOrUpdateSample}>
                      {editingSampleIndex == null ? "add" : "update"}
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
              </div>
            </TabsContent>
          </Tabs>

          {addError && <p className="text-sm text-destructive">{addError}</p>}
          {modalLoading && <p className="text-sm text-muted-foreground">loading assay...</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              cancel
            </Button>
            <Button disabled={!canSave || saving || modalLoading} onClick={() => void handleSave()}>
              {saving ? "saving..." : "save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppContainer>
  );
}
