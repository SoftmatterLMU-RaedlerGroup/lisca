import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileUp, FlaskConical, Activity } from "lucide-react";
import { AppContainer } from "@/components/layout/AppContainer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { parseAssayYaml } from "@/lib/assay-yaml";
import type { AssayListItem } from "@/lib/types";

export default function AssayActionsPage() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const assayId = params.id;
  const [assays, setAssays] = useState<AssayListItem[]>([]);
  const [loading, setLoading] = useState(!!assayId);
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
    if (!assay) return;
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
  }, [assay, navigate]);

  const importDisabled = !assay || !assay.has_assay_yaml;

  return (
    <AppContainer className="max-w-3xl">
      <Card className="py-0">
        <CardHeader className="py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-2xl">Assay</CardTitle>
              <CardDescription className="mt-1">
                Choose how to continue for {assay ? assay.name : "a new assay"}.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate("/assays")}>
              <ArrowLeft className="size-4" />
              Back
            </Button>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="py-8">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading assay...</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <Button
                variant="outline"
                className="h-28 rounded-xl text-base"
                onClick={() => void handleImportYaml()}
                disabled={importDisabled}
              >
                <FileUp className="size-4" />
                Import YAML
              </Button>
              <Button variant="outline" className="h-28 rounded-xl text-base" onClick={() => goInfo("killing")}>
                <FlaskConical className="size-4" />
                Killing
              </Button>
              <Button
                variant="outline"
                className="h-28 rounded-xl text-base"
                onClick={() => goInfo("expression")}
              >
                <Activity className="size-4" />
                Expression
              </Button>
            </div>
          )}

          {!loading && !assayId && (
            <p className="mt-4 text-sm text-muted-foreground">
              New assay: choose Killing or Expression to configure assay info.
            </p>
          )}
          {!loading && assay && importDisabled && (
            <p className="mt-4 text-sm text-muted-foreground">
              Import YAML is disabled because assay.yaml is missing in this data folder.
            </p>
          )}
        </CardContent>
      </Card>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </AppContainer>
  );
}
