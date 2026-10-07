import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck } from "lucide-react";
import {
  ceUnlockCommand,
  getCeUnlockVip,
  getPortalCeUnlockVip,
} from "../../services/ceUnlockService";
import type { PortalScope } from "../../services/portalScope";
import { queryKeys } from "../../services/queryKeys";
import { afterCeUnlockChanged } from "../../services/cacheEffects";
import type { CeUnlockDocument } from "../../types/ceUnlock";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { InlineError } from "../ui/Card";
import { Field, Input } from "../ui/Input";
import { useConfirm, useConfirmWithReason } from "../ui/ConfirmDialog";
import { CeUnlockDocumentList, CeUnlockDocumentUploader } from "./CeUnlockDocuments";

function Coverage({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="app-panel app-panel--padded flex items-center justify-between gap-3">
      <span className="app-panel__title">{label}</span>
      <Badge tone={ok ? "green" : "yellow"}>{ok ? "Vigente" : "Regularização necessária"}</Badge>
    </div>
  );
}

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
    ? { mode: scope.mode, customerId: scope.customerId, authCustomer: scope.overview?.customer_id }
    : { customerId };
  const query = useQuery({
    queryKey: queryKeys.ceUnlock.vip(identity),
    queryFn: () => (scope ? getPortalCeUnlockVip(scope) : getCeUnlockVip(customerId!)),
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
    const enabling = !query.data?.enabled;
    const reason = await reasonDialog({
      message: enabling ? "Habilitar a condição VIP deste CNPJ?" : "Revogar a condição VIP deste CNPJ?",
      consequence: enabling
        ? "Os pedidos passam a usar termo e procuração anuais, que precisam estar aprovados e vigentes."
        : "Os próximos pedidos voltam a exigir termo e procuração anexados a cada solicitação.",
      reversibility: "A condição pode ser alterada novamente, com histórico.",
      confirmLabel: enabling ? "Habilitar VIP" : "Revogar VIP",
      tone: enabling ? "primary" : "danger",
    });
    if (!reason) return;
    setBusy(true);
    setError("");
    try {
      await ceUnlockCommand("set_vip", {
        customer_id: customerId,
        enabled: enabling,
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
  async function review(d: CeUnlockDocument, decision: "approved" | "changes_requested" | "revoked") {
    let reason: string | null = null;
    const name = d.type === "termo" ? "termo de devolução" : "procuração";
    if (decision === "approved") {
      if (
        !(await confirm({
          message: `Aprovar ${name} anual de ${from.split("-").reverse().join("/")} a 31/12/${year}?`,
          consequence: "O documento atende os pedidos VIP deste CNPJ durante a vigência.",
          reversibility: "A aprovação pode ser revogada com motivo.",
          confirmLabel: "Aprovar",
        }))
      )
        return;
    } else {
      reason = await reasonDialog({
        message: decision === "revoked" ? `Revogar a aprovação da ${name} anual?` : `Solicitar correção da ${name} anual?`,
        consequence: "Pedidos ainda não concluídos podem deixar de atender o requisito.",
        reversibility: "Uma nova aprovação regulariza a cobertura.",
        confirmLabel: decision === "revoked" ? "Revogar aprovação" : "Solicitar correção",
        tone: "danger",
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
  if (query.isLoading) return <p className="text-sm text-[var(--app-muted)]">Carregando documentos anuais…</p>;
  if (query.error)
    return (
      <div role="alert" className="app-panel app-panel--padded">
        <p className="text-sm font-semibold text-[var(--app-text-strong)]">Falha ao consultar cobertura VIP.</p>
        <Button variant="secondary" className="app-btn--sm mt-3" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  const vip = query.data;
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="app-soft-panel__title">{scope ? "Documentos anuais VIP" : "Desbloqueio de CE — VIP"}</h2>
            {!scope && <Badge tone={vip?.enabled ? "green" : "slate"}>{vip?.enabled ? "VIP habilitado" : "Sem condição VIP"}</Badge>}
          </div>
          <p className="app-soft-panel__description">
            {vip?.enabled
              ? "Termo de devolução e procuração anuais cobrem todos os pedidos deste CNPJ até 31/12 do ano aprovado."
              : "Sem a condição VIP, cada solicitação exige termo de devolução e procuração próprios."}
          </p>
        </div>
        {manage && (
          <Button variant={vip?.enabled ? "secondary" : "primary"} disabled={busy} onClick={() => void toggle()}>
            {!vip?.enabled && <BadgeCheck size={16} aria-hidden="true" />}
            {vip?.enabled ? "Revogar condição VIP" : "Habilitar condição VIP"}
          </Button>
        )}
      </div>
      {error && <InlineError message={error} />}
      {vip?.enabled && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Coverage label="Termo de devolução" ok={vip.termo} />
            <Coverage label="Procuração" ok={vip.procuracao} />
          </div>
          <div className="space-y-3">
            <div>
              <h3 className="app-panel__title">Documentos apresentados</h3>
              {manage && (
                <p className="app-panel__meta">Ao aprovar, a vigência vai do início informado até 31/12 do ano da cobertura.</p>
              )}
            </div>
            {manage && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Ano da cobertura">
                  <Input type="number" min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} />
                </Field>
                <Field label="Início de vigência">
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
              </div>
            )}
            <CeUnlockDocumentList
              documents={vip.documents}
              scope={scope}
              emptyText="Nenhum documento anual apresentado."
              onReview={manage && !busy ? (d, decision) => void review(d, decision) : undefined}
            />
          </div>
          {(manage || scope?.mode === "client") && (
            <div className="space-y-3">
              <h3 className="app-panel__title">Apresentar novo documento anual</h3>
              <CeUnlockDocumentUploader source="vip_annual" customerId={customerId} scope={scope} onUploaded={refresh} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
