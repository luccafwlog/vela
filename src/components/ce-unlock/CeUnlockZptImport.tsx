import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Field, Input } from "../ui/Input";
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
            "BLs desbloqueados na ZPT serão marcados como conferidos; BLs exportados e ainda bloqueados ficam como divergentes. Nada é enviado ao cliente.",
          reversibility: "Uma nova conciliação atualiza o resultado.",
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
    <Card className="mb-4">
      <h2>Conciliar com a ZPT</h2>
      <p>
        Na ZPT, use “Exportar Tela” e envie aqui o arquivo. Só o status de cada CE é lido; dados do operador da ZPT
        são descartados.
      </p>
      <Field label="Arquivo da ZPT (.xls, .xlsx ou .csv)">
        <Input
          type="file"
          accept=".xls,.xlsx,.csv"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      <Button disabled={busy || !file} onClick={() => void run()}>
        {busy ? "Conciliando..." : "Conciliar arquivo"}
      </Button>
      {error && <p role="alert">{error}</p>}
      {summary && (
        <p role="status">
          {summary.rows} linha(s): {summary.unlocked} desbloqueada(s), {summary.divergent} divergente(s),{" "}
          {summary.stale} ainda sem atualização da ZPT após a exportação,{" "}
          {summary.ignored} bloqueada(s) não exportada(s) pelo Vela, {summary.unknown_ce} CE desconhecido(s).
        </p>
      )}
    </Card>
  );
}
