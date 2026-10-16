import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, MoreVertical, RefreshCw } from "lucide-react";
import { ActionMenu } from "../ui/ActionMenu";
import { Block, Fact, FactList, LeadValue } from "../ui/Block";
import { Button } from "../ui/Button";
import { InlineError } from "../ui/Card";
import { CopyValue } from "../ui/CopyValue";
import { NoValue } from "../ui/NoValue";
import { StatusText } from "../ui/StatusText";
import { useConfirm, useConfirmWithReason } from "../ui/ConfirmDialog";
import { CeUnlockRequirementIcon, CeUnlockZptState } from "./CeUnlockRequirements";
import { CeUnlockHistoryTable } from "./CeUnlockHistory";
import { latestSlaStart } from "../../services/ceUnlockSla";
import { annualDocumentValid } from "../../services/ceUnlockRules";
import { downloadCeUnlockDocument } from "../../services/ceUnlockService";
import { CeUnlockSla } from "./CeUnlockSla";
import { ceDate, ceDateTime, ceDocumentName, ceDocumentStatusText, ceStateLabel, ceUnlockMissing } from "../../lib/ceUnlockLabels";
import type { CeUnlockDocument, CeUnlockRequest } from "../../types/ceUnlock";

type Decision = "approved" | "changes_requested" | "revoked";
type ActOptions = {
  message: string;
  consequence: string;
  reversibility?: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  reasonLabel?: string;
};

const lower = (type: string) => ceDocumentName(type).toLowerCase();

function OpenDocument({ doc, onError, children }: { doc: CeUnlockDocument; onError: (m: string) => void; children?: ReactNode }) {
  if (doc.purged) return <span title="Arquivo removido pela regra de retenção">{doc.file_name} (arquivo removido pela regra de retenção)</span>;
  if (doc.cleanup_pending) return <span title="Arquivo em remoção pela regra de retenção">{doc.file_name} (arquivo em remoção pela regra de retenção)</span>;
  return (
    <button
      type="button"
      className="app-link"
      onClick={() =>
        void downloadCeUnlockDocument(doc.id).catch((e) => onError(e instanceof Error ? e.message : "Falha ao abrir documento"))
      }
    >
      {children ?? doc.file_name}
    </button>
  );
}

function DocumentSituation({ doc }: { doc: CeUnlockDocument }) {
  if (doc.source === "vip_annual" && doc.status === "approved" && !annualDocumentValid(doc))
    return <StatusText tone="warning">Fora da vigência</StatusText>;
  const { label, tone } = ceDocumentStatusText(doc.type, doc.status);
  return (
    <span className="app-table__cell-stack">
      <StatusText tone={tone}>{label}</StatusText>
      {doc.reason && doc.status !== "approved" ? <span className="app-table__cell-meta">Motivo: {doc.reason}</span> : null}
    </span>
  );
}

export function CeUnlockRequestDetail({
  request,
  manage,
  onAction,
  busy,
}: {
  request: CeUnlockRequest;
  manage: boolean;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
  busy: boolean;
}) {
  const confirm = useConfirm();
  const reasonDialog = useConfirmWithReason();
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const blIds = request.items.map((i) => i.bl_id);
  const affected = { summary: blIds.length === 1 ? "1 B/L da solicitação" : `${blIds.length} B/Ls da solicitação`, items: blIds };
  async function act(action: string, payload: Record<string, unknown>, options: ActOptions, reasonRequired = false) {
    let reason: string | null = null;
    if (reasonRequired) {
      reason = await reasonDialog({ ...options, affected });
      if (!reason) return false;
    } else if (!(await confirm({ ...options, affected }))) return false;
    setError("");
    try {
      await onAction(action, { ...payload, request_id: request.id, expected_version: request.version, reason });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir a ação");
      return false;
    }
  }
  // A análise vale para a solicitação inteira: o documento é aprovado ou recusado para todos os B/Ls.
  async function review(d: CeUnlockDocument, decision: Decision) {
    const name = lower(d.type);
    const payload = { document_id: d.id, expected_document_version: d.version, decision };
    const done =
      decision === "approved"
        ? await act("review", payload, {
            message: `Aprovar ${name} para todos os B/Ls desta solicitação?`,
            consequence: "O requisito passa a atendido em todos os B/Ls do pedido.",
            reversibility: "A aprovação pode ser revista com uma recusa, com histórico.",
            confirmLabel: "Aprovar",
          })
        : decision === "revoked"
          ? await act(
              "review",
              payload,
              {
                message: `Revogar a aprovação de ${name}?`,
                consequence: "O requisito volta a pendente nos B/Ls cobertos por este documento.",
                confirmLabel: "Revogar aprovação",
                tone: "danger",
                reasonLabel: "Motivo da revogação",
              },
              true,
            )
          : await act(
              "review",
              payload,
              {
                message: `Recusar ${name}?`,
                consequence: "O cliente recebe o motivo no Portal e por e-mail e precisa enviar um documento corrigido.",
                confirmLabel: "Recusar documento",
                tone: "danger",
                reasonLabel: "O que o cliente precisa corrigir",
              },
              true,
            );
    if (done) setAnalyzing(null);
  }
  const latestDocuments = request.documents.filter(
    (d) =>
      d.source === "request" &&
      d.status !== "uploading" &&
      !request.documents.some(
        (other) => other.type === d.type && other.status !== "uploading" && other.created_at > d.created_at,
      ),
  );
  // Versões substituídas continuam persistidas e auditáveis (request_json devolve todas); a análise usa só a atual.
  const previousDocuments = request.documents
    .filter((d) => d.source === "request" && d.status !== "uploading" && !latestDocuments.includes(d))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const approvedFor = (type: string) => request.items.every((i) => (type === "termo" ? i.termo : i.procuracao));
  const vip = request.source === "vip_annual";
  const open = !["cancelled", "completed"].includes(request.state);
  const reviewable =
    manage && !vip && !busy && ["submitted", "in_review", "changes_requested", "completed"].includes(request.state);
  const documents = (manage && !vip ? latestDocuments : request.documents).filter((d) => d.status !== "uploading");
  const canApprove = (d: CeUnlockDocument) => !approvedFor(d.type) && !["changes_requested", "revoked"].includes(d.status);
  const analyzed = documents.find((d) => d.id === analyzing) ?? null;
  const cnpj = request.items[0]?.cnpj_cpf;
  const openedAt = request.events[0]?.created_at;
  const missing = open ? ceUnlockMissing(request) : null;
  return (
    <section className="space-y-4">
      {manage && open && (
        <div className="flex flex-wrap justify-end gap-2">
          {vip && request.state !== "draft" && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act("apply_vip", {}, {
                  message: "Aplicar a cobertura anual VIP vigente aos B/Ls pendentes deste pedido?",
                  consequence: "Os B/Ls pendentes passam a usar o termo e a procuração anuais vigentes.",
                  reversibility: "O histórico é preservado.",
                  confirmLabel: "Aplicar renovação",
                })
              }
            >
              Aplicar renovação VIP
            </Button>
          )}
          {/* Documentação validada não se cancela mais. */}
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              void act(
                "cancel",
                {},
                {
                  message: `Cancelar a solicitação ${request.protocol}?`,
                  consequence: "Os B/Ls ficam livres para uma nova solicitação e o cliente vê o pedido como cancelado.",
                  reversibility: "Não pode ser desfeito; o cliente precisará abrir uma nova solicitação.",
                  confirmLabel: "Cancelar pedido",
                  tone: "danger",
                  reasonLabel: "Motivo do cancelamento",
                },
                true,
              )
            }
          >
            Cancelar pedido
          </Button>
        </div>
      )}
      {error && <InlineError message={error} />}

      <Block title="Solicitação" headingLevel={3} aside={openedAt ? `aberta em ${ceDateTime(openedAt)}` : undefined}>
        <LeadValue
          tone={request.state === "changes_requested" ? "warning" : request.state === "cancelled" ? "muted" : "default"}
          detail={missing}
        >
          {ceStateLabel(request.state)}
        </LeadValue>
        <FactList columns={4}>
          <Fact label="Cliente">
            {request.customer_name ? (
              cnpj ? (
                <Link className="app-link" to={`/clientes/${cnpj}?tab=desbloqueio-ce`}>{request.customer_name}</Link>
              ) : (
                request.customer_name
              )
            ) : (
              <NoValue label="Cliente não identificado" />
            )}
          </Fact>
          <Fact label="B/Ls">{blIds.length}</Fact>
          <Fact label="Prazo"><CeUnlockSla start={open ? latestSlaStart(request.items) : null} /></Fact>
          <Fact label="Documentos">{vip ? "Anuais VIP" : "Da solicitação"}</Fact>
        </FactList>
      </Block>

      <Block
        title="Documentos"
        headingLevel={3}
        flush
        aside={
          vip
            ? "cobertos pelos documentos anuais VIP aprovados na ficha do Cliente"
            : "a análise vale para todos os B/Ls da solicitação"
        }
      >
        {documents.length === 0 && vip ? (
          <div className="app-block__body">
            <p className="app-table__cell-meta">Nenhum documento apresentado.</p>
          </div>
        ) : (
          <div className="app-table-scroll">
            <table className="app-table app-table--compact text-sm">
              <caption className="sr-only">Documentos da solicitação</caption>
              <thead>
                <tr>
                  <th scope="col" className="app-table__text-head">Documento</th>
                  <th scope="col" className="app-table__text-head">Arquivo</th>
                  <th scope="col">Enviado em</th>
                  <th scope="col" className="app-table__text-head">Situação</th>
                  {reviewable ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td className="app-table__text">{ceDocumentName(d.type)}</td>
                    <td className="app-table__text" title={d.file_name}>
                      <OpenDocument doc={d} onError={setError} />
                      {d.valid_until ? (
                        <span className="app-table__cell-meta"> · vigência {ceDate(d.valid_from)} a {ceDate(d.valid_until)}</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap tabular-nums">{ceDate(d.created_at)}</td>
                    <td className="app-table__text"><DocumentSituation doc={d} /></td>
                    {reviewable ? (
                      <td className="whitespace-nowrap text-right">
                        {canApprove(d) ? (
                          <Button
                            className="app-btn--sm"
                            aria-label={`Analisar ${lower(d.type)}`}
                            aria-expanded={analyzing === d.id}
                            onClick={() => setAnalyzing(d.id)}
                          >
                            Analisar
                          </Button>
                        ) : d.status === "approved" ? (
                          <ActionMenu
                            label={`Ações de ${lower(d.type)}`}
                            triggerClassName="app-btn app-btn--ghost app-btn--sm"
                            trigger={<MoreVertical size={16} aria-hidden="true" />}
                            items={[
                              { key: "refuse", label: "Recusar aprovação", onSelect: () => void review(d, "changes_requested") },
                            ]}
                          />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
                {!vip &&
                  (["termo", "procuracao"] as const)
                    .filter((type) => !documents.some((d) => d.type === type))
                    .map((type) => (
                      <tr key={`missing-${type}`}>
                        <td className="app-table__text">{ceDocumentName(type)}</td>
                        <td><NoValue label="Sem arquivo" /></td>
                        <td><NoValue label="Não enviado" /></td>
                        <td className="app-table__text">{ceDocumentStatusText(type, null).label}</td>
                        {reviewable ? <td /> : null}
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
        {manage && !vip && previousDocuments.length > 0 && (
          <div className="app-block__body" role="region" aria-label="Versões anteriores dos documentos">
            {previousDocuments.map((d) => {
              const { label } = ceDocumentStatusText(d.type, d.status);
              return (
                <p key={d.id} className="app-table__cell-meta">
                  Versão anterior de {lower(d.type)}: <OpenDocument doc={d} onError={setError} />, enviada em {ceDate(d.created_at)},{" "}
                  {label.toLowerCase()}
                  {d.reason ? ` (${d.reason})` : ""}.
                </p>
              );
            })}
          </div>
        )}
      </Block>

      {analyzed && reviewable ? (
        <Block title={`Analisar ${lower(analyzed.type)}`} headingLevel={3}>
          <div className="flex flex-wrap items-center gap-2">
            {!analyzed.purged && !analyzed.cleanup_pending ? (
              <Button
                variant="secondary"
                onClick={() =>
                  void downloadCeUnlockDocument(analyzed.id).catch((e) =>
                    setError(e instanceof Error ? e.message : "Falha ao abrir documento"),
                  )
                }
              >
                <ExternalLink size={14} aria-hidden="true" />
                Abrir {analyzed.file_name}
              </Button>
            ) : null}
            <span className="app-table__cell-meta">Confira o documento e decida.</span>
            <span className="ml-auto flex flex-wrap gap-2">
              <Button onClick={() => void review(analyzed, "approved")}>Aprovar {lower(analyzed.type)}</Button>
              <Button variant="secondary" onClick={() => void review(analyzed, "changes_requested")}>Recusar…</Button>
              <Button variant="ghost" onClick={() => setAnalyzing(null)}>Voltar</Button>
            </span>
          </div>
        </Block>
      ) : null}

      <Block title="B/Ls da solicitação" headingLevel={3} flush>
        <div className="app-table-scroll">
          <table className="app-table app-table--compact text-sm">
            <caption className="sr-only">Requisitos de cada B/L da solicitação</caption>
            <thead>
              <tr>
                <th scope="col">B/L</th>
                <th scope="col">CE Mercante</th>
                <th scope="col">Termo de devolução</th>
                <th scope="col">Procuração</th>
                <th scope="col">Taxas locais</th>
                <th scope="col">B/L original</th>
                <th scope="col" className="app-table__text-head">Na ZPT</th>
              </tr>
            </thead>
            <tbody>
              {request.items.map((i) => (
                <tr key={i.bl_id}>
                  <td className="whitespace-nowrap">
                    <CopyValue value={i.bl_id} label="número do B/L">
                      <Link className="app-link" to={`/bls/${encodeURIComponent(i.bl_id)}`}>{i.bl_id}</Link>
                    </CopyValue>
                  </td>
                  <td className="whitespace-nowrap">
                    {i.ce_mercante ? <CopyValue value={i.ce_mercante} label="CE Mercante" /> : <NoValue label="Sem CE Mercante" />}
                  </td>
                  <td><CeUnlockRequirementIcon ok={i.termo} label="Termo de devolução" subject={i.bl_id} /></td>
                  <td><CeUnlockRequirementIcon ok={i.procuracao} label="Procuração" subject={i.bl_id} /></td>
                  <td><CeUnlockRequirementIcon ok={i.paid} label="Taxas locais" subject={i.bl_id} /></td>
                  <td><CeUnlockRequirementIcon ok={i.delivered} label="B/L original" subject={i.bl_id} /></td>
                  <td className="app-table__text">
                    <CeUnlockZptState item={i} />
                    {manage && (i.reasons ?? []).some((r) => r.includes("CE alterado")) && (
                      <Button
                        variant="secondary"
                        className="app-btn--sm ml-2"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            "reconfirm_ce",
                            { bl_id: i.bl_id },
                            {
                              message: `Reconferir o CE atual de ${i.bl_id}?`,
                              consequence: "O CE atual passa a valer para este pedido e o B/L volta a ser avaliado.",
                              confirmLabel: "Reconferir CE",
                              reasonLabel: "Como o CE foi conferido",
                            },
                            true,
                          )
                        }
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                        Reconferir CE
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      <CeUnlockHistoryTable events={request.events} />

      {!!request.confirmation_records?.length && (
        <Block title="Confirmações externas" headingLevel={3} flush aside="histórico anterior">
          <div className="app-table-scroll">
            <table className="app-table app-table--compact text-sm">
              <caption className="sr-only">Confirmações externas registradas antes da conciliação com a ZPT</caption>
              <thead>
                <tr>
                  <th scope="col">B/L</th>
                  <th scope="col">CE Mercante</th>
                  <th scope="col">Quando</th>
                  <th scope="col" className="app-table__text-head">Referência</th>
                </tr>
              </thead>
              <tbody>
                {request.confirmation_records.map((record) => (
                  <tr key={record.bl_id}>
                    <td className="whitespace-nowrap">{record.bl_id}</td>
                    <td className="whitespace-nowrap">{record.ce_mercante}</td>
                    <td className="whitespace-nowrap tabular-nums">{ceDateTime(record.confirmed_at)}</td>
                    <td className="app-table__text">{record.reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
      )}
    </section>
  );
}
