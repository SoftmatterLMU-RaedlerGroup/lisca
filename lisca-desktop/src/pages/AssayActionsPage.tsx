import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileUp, FlaskConical, Activity } from "lucide-react";
import { AppContainer } from "@/components/layout/AppContainer";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { parseAssayYaml } from "@/lib/assay-yaml";
import type { AssayListItem } from "@/lib/types";

export default function AssayActionsPage() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const assayId = params.id;
  const [assays, setAssays] = useState<AssayListItem[]>([]);
  const [loading, setLoading] = useState(!!assayId);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assayId) return;
    const run = async () => {
      setLoading(true);
      try {
        const rows = await api.assays.list();
        setAssays(rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [assayId]);

  const assay = useMemo(
    () => (assayId ? assays.find((row) => row.id === assayId) ?? null : null),
    [assayId, assays],
  );

  const goInfo = useCallback(
    (type: "killing" | "expression") => {
      if (assayId) {
        navigate(`/assays/${assayId}/info?type=${type}`);
        return;
      }
      navigate(`/assays/new/info?type=${type}`);
    },
    [assayId, navigate],
  );

  const handleImportYaml = useCallback(async () => {
    setImporting(true);
    setError(null);
    try {
      if (assay) {
        const result = await api.assays.readYaml(assay.folder);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        try {
          parseAssayYaml(result.yaml);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          return;
        }
        navigate(`/register/${assay.id}`);
        return;
      }

      const picked = await api.assays.pickAssayYaml();
      if (!picked) {
        setError("Please select an assay.yaml file.");
        return;
      }

      const result = await api.assays.readYaml(picked.folder);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const parsed = parseAssayYaml(result.yaml);
      const saved = await api.assays.upsert({
        name: parsed.name,
        time: parsed.date,
        type: parsed.type,
        folder: picked.folder,
      });
      navigate(`/register/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }, [assay, navigate]);

  const importDisabled = assayId ? !assay || !assay.has_assay_yaml || importing : importing;

  return (
    <AppContainer className="max-w-3xl">
      <div className="space-y-5 rounded-lg border bg-background/90 p-6 shadow-sm backdrop-blur-sm">
        <div className="relative flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-4xl tracking-tight">Assay type</h1>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute right-0 top-1/2 -translate-y-1/2"
            onClick={() => navigate("/assays")}
            title="Back"
          >
            <ArrowLeft className="size-4" />
          </Button>
        </div>

        <div className="border-t border-border/70 pt-5">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading assay...</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <button
                type="button"
                className="flex h-32 flex-col items-start justify-between rounded-lg border bg-background p-4 text-left text-sm transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  void handleImportYaml();
                }}
                disabled={importDisabled}
              >
                <FileUp className="size-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Import assay</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {importing
                      ? "Importing..."
                      : "Load existing assay.yaml from a data folder."}
                  </p>
                </div>
              </button>
              <button
                type="button"
                className="flex h-32 flex-col items-start justify-between rounded-lg border bg-background p-4 text-left text-sm transition-colors hover:bg-accent/40"
                onClick={() => goInfo("killing")}
              >
                <FlaskConical className="size-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Killing</p>
                  <p className="mt-1 text-xs text-muted-foreground">Open info form with killing assay type.</p>
                </div>
              </button>
              <button
                type="button"
                className="flex h-32 flex-col items-start justify-between rounded-lg border bg-background p-4 text-left text-sm transition-colors hover:bg-accent/40"
                onClick={() => goInfo("expression")}
              >
                <Activity className="size-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Expression</p>
                  <p className="mt-1 text-xs text-muted-foreground">Open info form with expression assay type.</p>
                </div>
              </button>
            </div>
          )}

          {!loading && assay && importDisabled && (
            <p className="mt-4 text-sm text-muted-foreground">
              Import YAML is disabled because assay.yaml is missing in this data folder.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </AppContainer>
  );
}
