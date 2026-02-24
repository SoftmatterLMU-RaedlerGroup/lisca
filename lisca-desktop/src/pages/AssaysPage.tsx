import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { AppContainer } from "@/components/layout/AppContainer";
import { Button } from "@/components/ui/button";
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
    <AppContainer className="max-w-4xl">
      <div className="space-y-5 rounded-lg border bg-background/90 p-6 shadow-sm backdrop-blur-sm">
        <div className="text-center">
          <h1 className="text-4xl tracking-tight">LISCA</h1>
          <div className="mt-3 border-t border-border/70" />
        </div>

        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Assays</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate("/assays/new/actions")}
            title="Add assay"
          >
            <Plus className="size-4" />
            Add assay
          </Button>
        </div>

        {loading && <p className="py-8 text-sm text-muted-foreground">Loading assays...</p>}

        {!loading && assays.length === 0 && (
          <p className="py-8 text-sm text-muted-foreground">No assays yet. Add one to get started.</p>
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
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-2 py-2 text-right">
                    <span className="sr-only">Action</span>
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
                        if (!blocked) navigate(`/register/${assay.id}`);
                      }}
                      onKeyDown={(event) => {
                        if (blocked) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate(`/register/${assay.id}`);
                        }
                      }}
                      title={blocked ? assay.missing_reason ?? "assay.yaml missing" : "Open register"}
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
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="ml-auto flex size-6 items-center justify-center text-muted-foreground hover:text-foreground"
                          title="Delete assay"
                          aria-label="Delete assay"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDelete(assay.id);
                          }}
                        >
                          <X className="size-3.5" />
                        </Button>
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
    </AppContainer>
  );
}
