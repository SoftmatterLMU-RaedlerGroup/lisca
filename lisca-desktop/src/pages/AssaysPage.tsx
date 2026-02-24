import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { AppContainer } from "@/components/layout/AppContainer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AssayListItem } from "@/lib/types";

export default function AssaysPage() {
  const navigate = useNavigate();
  const [assays, setAssays] = useState<AssayListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const handleDelete = useCallback(
    async (id: string) => {
      await api.assays.remove(id);
      await loadAssays();
    },
    [loadAssays],
  );

  return (
    <AppContainer className="max-w-5xl">
      <Card className="py-0">
        <CardHeader className="py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-2xl">Assays</CardTitle>
              <CardDescription className="mt-1">Manage assay folders and registration entry points.</CardDescription>
            </div>
            <Button variant="outline" size="icon-sm" onClick={() => navigate("/assays/new/actions")} title="Add assay">
              <Plus className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="px-0 py-0">
          <div className="grid grid-cols-[1.2fr_0.9fr_0.8fr_0.8fr] items-center gap-3 px-6 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Name</span>
            <span>Time</span>
            <span>Type</span>
            <span className="text-right">Action</span>
          </div>
          <Separator />

          <div className="min-h-[420px] divide-y">
            {loading && <div className="px-6 py-10 text-sm text-muted-foreground">Loading assays...</div>}

            {!loading && assays.length === 0 && (
              <div className="px-6 py-10 text-sm text-muted-foreground">No assays yet. Click + to add.</div>
            )}

            {!loading &&
              assays.map((assay) => {
                const blocked = !assay.has_assay_yaml;
                return (
                  <div
                    key={assay.id}
                    className={cn(
                      "grid grid-cols-[1.2fr_0.9fr_0.8fr_0.8fr] items-center gap-3 px-6 py-3 transition-colors",
                      blocked ? "bg-muted/50 text-muted-foreground" : "cursor-pointer hover:bg-accent/50",
                    )}
                    role={blocked ? undefined : "button"}
                    tabIndex={blocked ? -1 : 0}
                    onClick={() => {
                      if (!blocked) navigate(`/assays/${assay.id}/actions`);
                    }}
                    onKeyDown={(event) => {
                      if (blocked) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(`/assays/${assay.id}/actions`);
                      }
                    }}
                    title={blocked ? assay.missing_reason ?? "assay.yaml missing" : "Open assay"}
                    aria-disabled={blocked}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{assay.name}</p>
                      {blocked && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {assay.missing_reason ?? "assay.yaml not found"}
                        </p>
                      )}
                    </div>
                    <span className="text-sm">{assay.time}</span>
                    <span className="capitalize text-sm">{assay.type}</span>
                    <span className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-destructive hover:text-destructive"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDelete(assay.id);
                        }}
                      >
                        <Trash2 className="size-3" />
                        Delete
                      </Button>
                    </span>
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </AppContainer>
  );
}
