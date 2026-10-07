import { useState } from "react";
import { Button } from "../ui/Button";
import { useConfirm, useConfirmWithReason } from "../ui/ConfirmDialog";
import { CeUnlockDocumentList } from "./CeUnlockDocuments";
import { CeUnlockRequirements } from "./CeUnlockRequirements";
import { ceStateLabel, ceActionLabel } from "../../lib/ceUnlockLabels";
import type { CeUnlockDocument, CeUnlockRequest } from "../../types/ceUnlock";

const DOCUMENT_NAME = { termo: "Termo de devolução", procuracao: "Procuração" } as const;

export function CeUnlockRequestDetail({
  request,
  manage,
  onAction,
  busy,
}: {
  request: CeUnlockRequest;
  manage: boolean;
  onAction: (
    action: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  busy: boolean;
}) {
  const confirm = useConfirm();
  const reasonDialog = useConfirmWithReason();
  const [error, setError] = useState("");
  const blIds = request.items.map((i) => i.bl_id);
  async function act(
    action: string,
    payload: Record<string, unknown>,
    message: string,
    reasonRequired = false,
  ) {
    let reason: string | null = null;
    if (reasonRequired) {
      reason = await reasonDialog({
        message,
        consequence:
          "O andamento deste pedido mudará no Vela e no Portal, com histórico.",
        reversibility:
          "Uma decisão pode ser revista; o histórico é preservado.",
      });
      if (!reason) return;
    } else if (
      !(await confirm({
        message,
        affected: { summary: `${blIds.length} BL(s) do pedido`, items: blIds },
        consequence: "O resultado ficará visível no pedido e no Portal.",
        reversibility: "O histórico será preservado.",
      }))
    )
      return;
    setError("");
    try {
      await onAction(action, {
        ...payload,
        request_id: request.id,
        expected_version: request.version,
        reason,
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível concluir a ação",
      );
    }
  }
  // A análise vale para a solicitação inteira: o documento é aprovado ou recusado para todos os BLs.
  function review(
    d: CeUnlockDocument,
    decision: "approved" | "changes_requested" | "revoked",
  ) {
    const name = DOCUMENT_NAME[d.type as keyof typeof DOCUMENT_NAME] ?? "Documento";
    void act(
      "review",
      { document_id: d.id, expected_document_version: d.version, decision },
      decision === "approved"
        ? `Aprovar ${name} para todos os BLs desta solicitação?`
        : `Recusar ${name}? Informe o que o cliente precisa corrigir.`,
      decision !== "approved",
    );
  }
  const latestDocuments = request.documents.filter(
    (d) =>
      d.source === "request" && d.status !== "uploading" &&
      !request.documents.some(
        (other) => other.type === d.type && other.status !== "uploading" && other.created_at > d.created_at,
      ),
  );
  const approvedFor = (type: string) =>
    request.items.every((i) => (type === "termo" ? i.termo : i.procuracao));
  const canReview = (
    d: CeUnlockDocument,
    decision: "approved" | "changes_requested" | "revoked",
  ) =>
    decision === "approved"
      ? !approvedFor(d.type)
      : decision === "changes_requested" && d.status !== "changes_requested";
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">
        {request.protocol} · {ceStateLabel(request.state)}
      </h2>
      {request.customer_name && <p>{request.customer_name}</p>}
      {error && <p role="alert">{error}</p>}
      <CeUnlockDocumentList
        documents={
          manage && request.source === "request"
            ? latestDocuments
            : request.documents
        }
        canReview={canReview}
        onReview={
          manage &&
          request.source === "request" &&
          !busy &&
          ["submitted", "in_review", "changes_requested", "completed"].includes(
            request.state,
          )
            ? review
            : undefined
        }
      />
      <h3 className="font-semibold">BLs da solicitação</h3>
      {request.items.map((i) => (
        <article
          className="rounded-lg border border-[var(--app-border)] p-3"
          key={i.bl_id}
        >
          <strong>
            {i.bl_id} · CE {i.ce_mercante}
          </strong>
          <CeUnlockRequirements item={i} />
          <p>
            {i.confirmed
              ? "Confirmação externa registrada (histórico anterior)"
              : i.can_export
                ? "Apto para envio à ZPT"
                : i.reasons.join("; ")}
          </p>
          {manage && i.reasons.some((r) => r.includes("CE alterado")) && (
            <Button
              disabled={busy}
              onClick={() =>
                void act(
                  "reconfirm_ce",
                  { bl_id: i.bl_id },
                  `Reconferir o CE atual de ${i.bl_id}?`,
                  true,
                )
              }
            >
              Reconferir CE
            </Button>
          )}
        </article>
      ))}
      {manage &&
        request.source === "vip_annual" &&
        !["cancelled", "completed", "draft"].includes(request.state) && (
          <Button
            disabled={busy}
            onClick={() =>
              void act(
                "apply_vip",
                {},
                "Aplicar a cobertura anual VIP vigente aos BLs pendentes deste pedido?",
              )
            }
          >
            Aplicar renovação VIP
          </Button>
        )}
      {manage && request.state !== "cancelled" && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void act("cancel", {}, "Cancelar este pedido de desbloqueio?", true)
          }
        >
          Cancelar pedido
        </Button>
      )}
      {!!request.confirmation_records?.length && (
        <section>
          <h3 className="font-semibold">Confirmações externas (histórico anterior)</h3>
          {request.confirmation_records.map((record) => (
            <p key={record.bl_id}>
              {record.bl_id} · CE {record.ce_mercante} ·{" "}
              {new Date(record.confirmed_at).toLocaleString("pt-BR")} · Referência: {record.reference}
            </p>
          ))}
        </section>
      )}
      <h3 className="font-semibold">Histórico</h3>
      {request.events.map((e) => (
        <p key={e.id}>
          {new Date(e.created_at).toLocaleString("pt-BR")} ·{" "}
          {ceActionLabel(e.action)}
          {e.reason ? ` · ${e.reason}` : ""}
        </p>
      ))}
    </section>
  );
}
