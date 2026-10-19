import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, FileSearch, MoreVertical } from "lucide-react";
import {
  ceUnlockCommand,
  getCeUnlockVip,
  getPortalCeUnlockVip,
  uploadCeUnlockDocument,
} from "../../services/ceUnlockService";
import type { PortalScope } from "../../services/portalScope";
import { queryKeys } from "../../services/queryKeys";
import { afterCeUnlockChanged } from "../../services/cacheEffects";
import { annualDocumentValid } from "../../services/ceUnlockRules";
import type { CeUnlockDocument } from "../../types/ceUnlock";
import { ActionMenu } from "../ui/ActionMenu";
import { Block, Fact, FactList, LeadValue } from "../ui/Block";
import { StatusText } from "../ui/StatusText";
import { formatDate } from "../../lib/utils";
import { coveredUntil } from "../../lib/ceUnlockCoverage";
import { ceDocumentName } from "../../lib/ceUnlockLabels";
import { Button } from "../ui/Button";
import { RowActionButton } from "../ui/RowActionButton";
import { InlineError } from "../ui/Card";
import { Field, Input } from "../ui/Input";
import { useConfirm, useConfirmWithReason } from "../ui/ConfirmDialog";
import { CeUnlockAnnualDocumentTable, CeUnlockFileButton } from "./CeUnlockDocuments";

type AnnualType = "termo" | "procuracao";
type Decision = "approved" | "changes_requested" | "revoked";

const lower = (type: string) => ceDocumentName(type).toLowerCase();
/** Data de hoje (aaaa-mm-dd) no fuso da operação. */
const localDay = (value: Date | string = new Date()) =>
  new Date(value).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

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
  const [uploading, setUploading] = useState<AnnualType | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [year, setYear] = useState(() => Number(localDay().slice(0, 4)));
  const [from, setFrom] = useState(() => localDay());
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
  // Ano e início da vigência começam no ano corrente e no dia do envio; o fim é sempre 31/12 do ano.
  function analyze(d: CeUnlockDocument) {
    setAnalyzing(d.id);
    setYear(Number(localDay().slice(0, 4)));
    setFrom(localDay(d.created_at));
  }
  async function review(d: CeUnlockDocument, decision: Decision) {
    let reason: string | null = null;
    const name = lower(d.type);
    if (decision === "approved") {
      if (
        !(await confirm({
          message: `Aprovar ${name} anual de ${formatDate(from)} a 31/12/${year}?`,
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
      setAnalyzing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na análise");
    } finally {
      setBusy(false);
    }
  }
  async function upload(type: AnnualType, file: File) {
    setUploading(type);
    setError("");
    try {
      await uploadCeUnlockDocument({ source: "vip_annual", customer_id: customerId, type }, file, scope);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao enviar documento");
    } finally {
      setUploading(null);
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
  const documents = vip?.documents ?? [];
  const latest = (type: AnnualType) =>
    documents
      .filter((d) => d.type === type && d.status !== "uploading")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  // Um botão principal por região: o primeiro documento sem cobertura e sem versão nova em análise.
  const primary = (["termo", "procuracao"] as const).find((type) => !vip?.[type] && latest(type)?.status !== "uploaded");
  const canUpload = manage || scope?.mode === "client";
  const analyzed = manage ? documents.find((d) => d.id === analyzing) ?? null : null;
  const actions = (d: CeUnlockDocument, current: boolean) => {
    if (current && (d.status === "uploaded" || d.status === "changes_requested"))
      return (
        <RowActionButton
          variant="primary"
          label={`Analisar ${lower(d.type)}`}
          icon={FileSearch}
          disabled={busy}
          aria-expanded={analyzing === d.id}
          onClick={() => analyze(d)}
        />
      );
    if (annualDocumentValid(d))
      return (
        <ActionMenu
          label={`Ações de ${lower(d.type)}`}
          triggerClassName="app-btn app-btn--ghost app-btn--sm"
          trigger={<MoreVertical size={16} aria-hidden="true" />}
          items={[{ key: "revoke", label: "Revogar aprovação", danger: true, disabled: busy, onSelect: () => void review(d, "revoked") }]}
        />
      );
    return null;
  };
  const docsBlock = vip?.enabled ? (
    <>
      <Block
        title={scope ? "Documentos anuais VIP" : "Documentos anuais"}
        headingLevel={scope ? 2 : 3}
        flush
        aside={scope ? "cobrem todos os pedidos até 31/12 do ano aprovado" : "VIP habilitado"}
      >
        <div className="app-block__body">
          <FactList columns={4}>
            <Fact label="Termo de devolução"><CoverageText covered={vip.termo} until={coveredUntil(documents, "termo")} /></Fact>
            <Fact label="Procuração"><CoverageText covered={vip.procuracao} until={coveredUntil(documents, "procuracao")} /></Fact>
          </FactList>
          {error && <InlineError message={error} />}
        </div>
        <CeUnlockAnnualDocumentTable documents={documents} scope={scope} onError={setError} actions={manage ? actions : undefined} />
        {canUpload && (
          <div className="app-block__body border-t border-[var(--app-border-soft)]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="app-table__cell-meta">PDF de até 10 MiB.</span>
              <span className="ml-auto flex flex-wrap gap-2">
                {(["termo", "procuracao"] as const).map((type) => (
                  <CeUnlockFileButton
                    key={type}
                    variant={primary === type ? "primary" : "secondary"}
                    inputLabel={type === "termo" ? "Arquivo do termo de devolução anual (PDF)" : "Arquivo da procuração anual (PDF)"}
                    disabled={!!uploading || busy}
                    loading={uploading === type}
                    loadingLabel="Enviando…"
                    onFile={(file) => void upload(type, file)}
                  >
                    Enviar {lower(type)}
                  </CeUnlockFileButton>
                ))}
              </span>
            </div>
          </div>
        )}
      </Block>
      {analyzed ? (
        <Block title={`Analisar ${lower(analyzed.type)}`} headingLevel={3} aside={analyzed.file_name}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Ano da cobertura">
              <Input type="number" min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} />
            </Field>
            <Field label="Início da vigência">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Fim da vigência">
              <Input value={`31/12/${year}`} readOnly />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy} onClick={() => void review(analyzed, "approved")}>Aprovar {lower(analyzed.type)}</Button>
            {analyzed.status !== "changes_requested" ? (
              <Button variant="secondary" disabled={busy} onClick={() => void review(analyzed, "changes_requested")}>
                Solicitar correção
              </Button>
            ) : null}
            <Button variant="ghost" className="ml-auto" onClick={() => setAnalyzing(null)}>Voltar</Button>
          </div>
        </Block>
      ) : null}
    </>
  ) : null;

  // Portal: a mesma peça de documentos anuais, sem o bloco de condição (quem
  // habilita é a Fwlog).
  if (scope) {
    return docsBlock ? <div className="grid gap-4">{docsBlock}</div> : (
      <Block title="Documentos anuais VIP">
        <LeadValue tone="muted" detail="Sem a condição VIP, cada solicitação exige termo de devolução e procuração próprios.">
          Sem condição VIP
        </LeadValue>
      </Block>
    );
  }

  return (
    <div className="grid gap-4">
      <Block
        title="Condição VIP"
        aside={manage ? (
          <Button variant={vip?.enabled ? "secondary" : "primary"} className="app-btn--sm" disabled={busy} onClick={() => void toggle()}>
            {!vip?.enabled && <BadgeCheck size={16} aria-hidden="true" />}
            {vip?.enabled ? "Revogar condição VIP" : "Habilitar condição VIP"}
          </Button>
        ) : null}
      >
        <LeadValue
          tone={vip?.enabled ? "default" : "muted"}
          detail={vip?.enabled
            ? "Termo de devolução e procuração anuais cobrem todos os pedidos deste CNPJ até 31/12 do ano aprovado."
            : "Sem a condição VIP, cada solicitação exige termo de devolução e procuração próprios."}
        >
          {vip?.enabled ? "VIP habilitado" : "Sem condição VIP"}
        </LeadValue>
        {error && !vip?.enabled && <InlineError message={error} />}
      </Block>
      {docsBlock}
    </div>
  );
}

/**
 * Cobertura de um documento anual (lote 1 da identidade, 2026-10-14). O banco
 * decide se está coberto (`ce_unlock_private.annual`); a data vem do documento
 * aprovado e vigente mais recente daquele tipo na lista.
 */
function CoverageText({ covered, until }: { covered: boolean; until: string | null }) {
  if (!covered) return <StatusText tone="warning">Falta</StatusText>;
  return <>{until ? `Coberto até ${formatDate(until)}` : "Coberto"}</>;
}
