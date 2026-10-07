import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { InlineError } from "../ui/Card";
import { useConfirm, useConfirmWithReason } from "../ui/ConfirmDialog";
import { CeUnlockDocumentList } from "./CeUnlockDocuments";
import { CeUnlockRequirementIcon } from "./CeUnlockRequirements";
import { CeUnlockHistory } from "./CeUnlockHistory";
import { latestSlaStart } from "../../services/ceUnlockSla";
import { CeUnlockSla } from "./CeUnlockSla";
import { ceDateTime, ceDocumentName, ceStateLabel, ceStateTone } from "../../lib/ceUnlockLabels";
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
  const blIds = request.items.map((i) => i.bl_id);
  const affected = { summary: `${blIds.length} BL(s) da solicitação`, items: blIds };
  async function act(action: string, payload: Record<string, unknown>, options: ActOptions, reasonRequired = false) {
    let reason: string | null = null;
    if (reasonRequired) {
      reason = await reasonDialog({ ...options, affected });
      if (!reason) return;
    } else if (!(await confirm({ ...options, affected }))) return;
    setError("");
    try {
      await onAction(action, { ...payload, request_id: request.id, expected_version: request.version, reason });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir a ação");
    }
  }
  // A análise vale para a solicitação inteira: o documento é aprovado ou recusado para todos os BLs.
  function review(d: CeUnlockDocument, decision: Decision) {
    const name = ceDocumentName(d.type);
    const payload = { document_id: d.id, expected_document_version: d.version, decision };
    if (decision === "approved")
      void act("review", payload, {
        message: `Aprovar ${name.toLowerCase()} para todos os BLs desta solicitação?`,
        consequence: "O requisito passa a atendido em todos os BLs do pedido.",
        reversibility: "A aprovação pode ser revista com uma recusa, com histórico.",
        confirmLabel: "Aprovar",
      });
    else
      void act(
        "review",
        payload,
        {
          message: `Recusar ${name.toLowerCase()}?`,
          consequence: "O cliente recebe o motivo no Portal e por e-mail e precisa enviar um documento corrigido.",
          confirmLabel: "Recusar documento",
          tone: "danger",
          reasonLabel: "O que o cliente precisa corrigir",
        },
        true,
      );
  }
  const latestDocuments = request.documents.filter(
    (d) =>
      d.source === "request" &&
      d.status !== "uploading" &&
      !request.documents.some(
        (other) => other.type === d.type && other.status !== "uploading" && other.created_at > d.created_at,
      ),
  );
  const approvedFor = (type: string) => request.items.every((i) => (type === "termo" ? i.termo : i.procuracao));
  const canReview = (d: CeUnlockDocument, decision: Decision) =>
    decision === "approved" ? !approvedFor(d.type) : decision === "changes_requested" && d.status !== "changes_requested";
  const vip = request.source === "vip_annual";
  const open = !["cancelled", "completed"].includes(request.state);
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Badge tone={ceStateTone(request.state)}>{ceStateLabel(request.state)}</Badge>
        {vip && <Badge tone="blue">Documentos anuais VIP</Badge>}
        {request.customer_name && <strong className="text-[var(--app-text-strong)]">{request.customer_name}</strong>}
        <span className="text-[var(--app-muted)]">{blIds.length} BL(s)</span>
        <span className="ml-auto flex items-center gap-2 text-[var(--app-muted)]">
          Prazo <CeUnlockSla start={latestSlaStart(request.items)} />
        </span>
      </div>
      {error && <InlineError message={error} />}

      <div className="space-y-3">
        <div>
          <h3 className="app-panel__title">Documentos</h3>
          <p className="app-panel__meta">
            {vip
              ? "Pedido coberto pelos documentos anuais VIP aprovados na ficha do cliente."
              : "A análise de cada documento vale para todos os BLs da solicitação."}
          </p>
        </div>
        <CeUnlockDocumentList
          documents={manage && !vip ? latestDocuments : request.documents}
          canReview={canReview}
          onReview={
            manage &&
            !vip &&
            !busy &&
            ["submitted", "in_review", "changes_requested", "completed"].includes(request.state)
              ? review
              : undefined
          }
        />
      </div>

      <div className="space-y-3">
        <h3 className="app-panel__title">BLs da solicitação</h3>
        <div className="app-table-scroll rounded-lg border border-[var(--app-border)]">
          <table className="app-table app-table--compact min-w-[640px] text-left text-sm">
            <caption className="sr-only">Requisitos de cada BL da solicitação</caption>
            <thead>
              <tr>
                <th scope="col" className="px-3 py-2">BL / CE</th>
                <th scope="col" className="px-2 py-2 text-center">Termo</th>
                <th scope="col" className="px-2 py-2 text-center">Procuração</th>
                <th scope="col" className="px-2 py-2 text-center">Taxas</th>
                <th scope="col" className="px-2 py-2 text-center">BL original</th>
                <th scope="col" className="px-3 py-2">Situação</th>
              </tr>
            </thead>
            <tbody>
              {request.items.map((i) => (
                <tr key={i.bl_id}>
                  <td className="px-3 py-2">
                    <span className="app-table__cell-stack">
                      <span className="app-table__cell-value font-semibold">{i.bl_id}</span>
                      <span className="app-table__cell-meta whitespace-nowrap">CE {i.ce_mercante ?? "—"}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center"><CeUnlockRequirementIcon ok={i.termo} label="Termo de devolução" /></td>
                  <td className="px-2 py-2 text-center"><CeUnlockRequirementIcon ok={i.procuracao} label="Procuração" /></td>
                  <td className="px-2 py-2 text-center"><CeUnlockRequirementIcon ok={i.paid} label="Taxas locais" /></td>
                  <td className="px-2 py-2 text-center"><CeUnlockRequirementIcon ok={i.delivered} label="BL original" /></td>
                  <td className="px-3 py-2">
                    {i.confirmed ? (
                      <span className="app-table__cell-meta">Confirmação externa registrada (histórico anterior)</span>
                    ) : i.can_export ? (
                      <Badge tone="green">Apto para envio à ZPT</Badge>
                    ) : (
                      <ul className="app-table__cell-meta list-none space-y-0.5">
                        {i.reasons.map((r) => <li key={r}>{r}</li>)}
                      </ul>
                    )}
                    {manage && i.reasons.some((r) => r.includes("CE alterado")) && (
                      <Button
                        variant="secondary"
                        className="app-btn--sm mt-2"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            "reconfirm_ce",
                            { bl_id: i.bl_id },
                            {
                              message: `Reconferir o CE atual de ${i.bl_id}?`,
                              consequence: "O CE atual passa a valer para este pedido e o BL volta a ser avaliado.",
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
      </div>

      {!!request.confirmation_records?.length && (
        <div className="space-y-2">
          <h3 className="app-panel__title">Confirmações externas (histórico anterior)</h3>
          <ul className="space-y-1 text-xs text-[var(--app-muted)]">
            {request.confirmation_records.map((record) => (
              <li key={record.bl_id}>
                {record.bl_id} · CE {record.ce_mercante} · {ceDateTime(record.confirmed_at)} · Referência:{" "}
                {record.reference}
              </li>
            ))}
          </ul>
        </div>
      )}

      <CeUnlockHistory events={request.events} />

      {manage && open && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--app-border)] pt-4">
          {vip && request.state !== "draft" && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act("apply_vip", {}, {
                  message: "Aplicar a cobertura anual VIP vigente aos BLs pendentes deste pedido?",
                  consequence: "Os BLs pendentes passam a usar o termo e a procuração anuais vigentes.",
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
                  consequence: "Os BLs ficam livres para uma nova solicitação e o cliente vê o pedido como cancelado.",
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
    </section>
  );
}
