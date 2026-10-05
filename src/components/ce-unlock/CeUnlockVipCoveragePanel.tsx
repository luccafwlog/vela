import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ceUnlockCommand,
  getCeUnlockVip,
  getPortalCeUnlockVip,
} from "../../services/ceUnlockService";
import type { PortalScope } from "../../services/portalScope";
import { queryKeys } from "../../services/queryKeys";
import { afterCeUnlockChanged } from "../../services/cacheEffects";
import type { CeUnlockDocument } from "../../types/ceUnlock";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { useConfirm, useConfirmWithReason } from "../ui/ConfirmDialog";
import {
  CeUnlockDocumentList,
  CeUnlockDocumentUploader,
} from "./CeUnlockDocuments";
export function CeUnlockVipCoveragePanel({
  customerId,
  scope,
  manage = false,
}: {
  customerId?: number;
  scope?: PortalScope;
  manage?: boolean;
}) {
  const client = useQueryClient();
  const identity = scope
    ? {
        mode: scope.mode,
        customerId: scope.customerId,
        authCustomer: scope.overview?.customer_id,
      }
    : { customerId };
  const query = useQuery({
    queryKey: queryKeys.ceUnlock.vip(identity),
    queryFn: () =>
      scope ? getPortalCeUnlockVip(scope) : getCeUnlockVip(customerId!),
    enabled: !!scope || !!customerId,
    refetchOnWindowFocus: "always",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const confirm = useConfirm();
  const reasonDialog = useConfirmWithReason();
  const refresh = () => afterCeUnlockChanged(client);
  async function toggle() {
    const reason = await reasonDialog({
      message: query.data?.enabled
        ? "Revogar a condição VIP deste CNPJ?"
        : "Habilitar a condição VIP deste CNPJ?",
      consequence:
        "A condição será exibida no Portal; documentos anuais precisam de aprovação e vigência para cobrir pedidos.",
      reversibility: "A condição pode ser alterada novamente, com histórico.",
    });
    if (!reason) return;
    setBusy(true);
    try {
      await ceUnlockCommand("set_vip", {
        customer_id: customerId,
        enabled: !query.data?.enabled,
        expected_version: query.data?.version ?? 0,
        reason,
        request_key: crypto.randomUUID(),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao alterar VIP");
    } finally {
      setBusy(false);
    }
  }
  async function review(
    d: CeUnlockDocument,
    decision: "approved" | "changes_requested" | "revoked",
  ) {
    let reason: string | null = null;
    if (decision === "approved") {
      if (
        !(await confirm({
          message: `Aprovar ${d.type === "termo" ? "termo" : "procuração"} anual até 31/12/${year}?`,
          consequence:
            "O documento poderá atender os pedidos VIP do mesmo CNPJ durante a vigência.",
          reversibility: "A aprovação pode ser revogada com motivo.",
        }))
      )
        return;
    } else {
      reason = await reasonDialog({
        message:
          decision === "revoked"
            ? "Revogar aprovação anual?"
            : "Solicitar correção do documento anual?",
        consequence: "Pedidos ainda não desbloqueados poderão perder aptidão.",
        reversibility: "Uma nova aprovação regulariza a cobertura.",
      });
      if (!reason) return;
    }
    setBusy(true);
    setError("");
    try {
      await ceUnlockCommand("review", {
        document_id: d.id,
        expected_document_version: d.version,
        decision,
        coverage_year: year,
        valid_from: from,
        valid_until: `${year}-12-31`,
        reason,
        request_key: crypto.randomUUID(),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na análise");
    } finally {
      setBusy(false);
    }
  }
  if (query.isLoading) return <p>Carregando documentos anuais...</p>;
  if (query.error)
    return (
      <p role="alert">
        Falha ao consultar cobertura VIP.{" "}
        <Button onClick={() => void query.refetch()}>Tentar novamente</Button>
      </p>
    );
  const vip = query.data;
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">
        Desbloqueio de CE — VIP e documentos anuais
      </h2>
      {error && <p role="alert">{error}</p>}
      <p>
        {vip?.enabled ? "Condição VIP habilitada" : "Cliente sem condição VIP"}
      </p>
      {manage && (
        <Button disabled={busy} onClick={() => void toggle()}>
          {vip?.enabled ? "Revogar condição VIP" : "Habilitar condição VIP"}
        </Button>
      )}
      {vip?.enabled && (
        <>
          <p>
            Termo: {vip.termo ? "Vigente" : "Regularização necessária"} ·
            Procuração:{" "}
            {vip.procuracao ? "Vigente" : "Regularização necessária"}. Validade
            até 31 de dezembro de cada ano.
          </p>
          {manage && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ano da cobertura">
                <Input
                  type="number"
                  min={2020}
                  max={2100}
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                />
              </Field>
              <Field label="Início de vigência">
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
            </div>
          )}
          <CeUnlockDocumentList
            documents={vip.documents}
            scope={scope}
            onReview={
              manage && !busy
                ? (d, decision) => void review(d, decision)
                : undefined
            }
          />
          {(manage || scope?.mode === "client") && (
            <CeUnlockDocumentUploader
              source="vip_annual"
              customerId={customerId}
              scope={scope}
              onUploaded={refresh}
            />
          )}
        </>
      )}
    </section>
  );
}
