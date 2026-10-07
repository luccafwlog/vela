import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "../ui/Button";
import { InlineError } from "../ui/Card";
import { Field, Input } from "../ui/Input";
import { MetricCard } from "../ui/MetricCard";
import { useConfirm } from "../ui/ConfirmDialog";
import { assertUploadFile } from "../../lib/fileGuard";
import { afterCeUnlockChanged } from "../../services/cacheEffects";
import { parseCeUnlockZptFile, reconcileCeUnlockZpt } from "../../services/ceUnlockZptReconcile";
import type { CeUnlockReconcileSummary } from "../../types/ceUnlock";

/** Concilia o "Exportar Tela" da ZPT com o que o Vela exportou. Resultado só para o desk. */
export function CeUnlockZptImport() {
  const client = useQueryClient();
  const confirm = useConfirm();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<CeUnlockReconcileSummary | null>(null);
  async function run() {
    if (!file) return;
    setError("");
    setSummary(null);
    setBusy(true);
    try {
      assertUploadFile(file, [".xls", ".xlsx", ".csv"]);
      const parsed = await parseCeUnlockZptFile(await file.arrayBuffer());
      if (
        !(await confirm({
          message: `Conciliar ${parsed.rows.length} carga(s) do arquivo da ZPT?`,
          consequence:
            "BLs desbloqueados na ZPT ficam como conferidos; BLs exportados e ainda bloqueados ficam como divergentes. Nada é enviado ao cliente.",
          reversibility: "Uma nova conciliação atualiza o resultado.",
          confirmLabel: "Conciliar",
        }))
      )
        return;
      setSummary(await reconcileCeUnlockZpt(parsed.rows));
      await afterCeUnlockChanged(client);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao conciliar o arquivo da ZPT");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--app-muted)]">
        Na ZPT, use <strong>Exportar Tela</strong> e envie o arquivo aqui. Só o status de cada CE é lido; os dados do
        operador da ZPT são descartados.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Field label="Arquivo da ZPT (.xls, .xlsx ou .csv)">
            <Input
              type="file"
              accept=".xls,.xlsx,.csv"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
        </div>
        <Button disabled={!file} loading={busy} loadingLabel="Conciliando…" onClick={() => void run()}>
          <FileSpreadsheet size={16} aria-hidden="true" />
          Conciliar arquivo
        </Button>
      </div>
      {error && <InlineError message={error} />}
      {summary && (
        <div role="status" aria-label="Resultado da conciliação" className="space-y-2">
          <p className="app-panel__title">{summary.rows} linha(s) lida(s)</p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
            <MetricCard label="Desbloqueados" value={summary.unlocked} />
            <MetricCard label="Divergentes" value={summary.divergent} tone={summary.divergent ? "primary" : "secondary"} />
            <MetricCard label="ZPT ainda sem atualização" value={summary.stale} />
            <MetricCard label="Bloqueados não exportados" value={summary.ignored} />
            <MetricCard label="CE desconhecido" value={summary.unknown_ce} />
          </div>
        </div>
      )}
    </div>
  );
}
