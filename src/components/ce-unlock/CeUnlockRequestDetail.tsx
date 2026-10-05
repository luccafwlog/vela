import { useState } from "react";
import { Button } from "../ui/Button";
import { useConfirm, useConfirmWithReason } from "../ui/ConfirmDialog";
import { CeUnlockDocumentList } from "./CeUnlockDocuments";
import { CeUnlockRequirements } from "./CeUnlockRequirements";
import { ceStateLabel, ceActionLabel } from "../../lib/ceUnlockLabels";
import type { CeUnlockDocument, CeUnlockRequest } from "../../types/ceUnlock";
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
  const [selected, setSelected] = useState<string[]>([]);
  const confirm = useConfirm();
  const reasonDialog = useConfirmWithReason();
  const [error, setError] = useState("");
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
          "Correções exigem nova análise; fatos externos não são desfeitos automaticamente.",
      });
      if (!reason) return;
    } else if (
      !(await confirm({
        message,
        affected: {
          summary: `${selected.length} BL(s) selecionados`,
          items: selected,
        },
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
        reason: action === "confirm" ? null : reason,
        ...(action === "confirm" ? { reference: reason } : {}),
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível concluir a ação",
      );
    }
  }
  function review(
    d: CeUnlockDocument,
    decision: "approved" | "changes_requested" | "revoked",
  ) {
    if (!selected.length) {
      setError("Selecione os BLs abrangidos pela análise.");
      return;
    }
    void act(
      "review",
      {
        document_id: d.id,
        expected_document_version: d.version,
        bl_ids: selected,
        decision,
      },
      decision === "approved"
        ? "Aprovar documento para os BLs selecionados?"
        : "Solicitar correção para os BLs selecionados?",
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
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">
        {request.protocol} · {ceStateLabel(request.state)}
      </h2>
      {error && <p role="alert">{error}</p>}
      {request.items.map((i) => (
        <article
          className="rounded-lg border border-[var(--app-border)] p-3"
          key={i.bl_id}
        >
          <label className="flex gap-2">
            {manage && (
              <input
                type="checkbox"
                aria-label={`Analisar BL ${i.bl_id}`}
                disabled={i.confirmed || busy}
                checked={selected.includes(i.bl_id)}
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked
                      ? [...prev, i.bl_id]
                      : prev.filter((id) => id !== i.bl_id),
                  )
                }
              />
            )}
            <strong>
              {i.bl_id} · CE {i.ce_mercante}
            </strong>
          </label>
          <CeUnlockRequirements item={i} />
          <p>
            {i.confirmed
              ? "Desbloqueio confirmado"
              : i.can_export
                ? "Apto para desbloqueio"
                : i.reasons.join("; ")}
          </p>
          {manage && i.can_export && (
            <Button
              disabled={busy}
              onClick={() =>
                void act(
                  "confirm",
                  { bl_id: i.bl_id, ce_mercante: i.ce_mercante },
                  `Confirmar desbloqueio do CE ${i.ce_mercante}? Informe a referência da evidência externa.`,
                  true,
                )
              }
            >
              Confirmar desbloqueio
            </Button>
          )}
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
      <CeUnlockDocumentList
        documents={
          manage && request.source === "request"
            ? latestDocuments
            : request.documents
        }
        onReview={
          manage &&
          request.source === "request" &&
          !busy &&
          ["submitted", "in_review", "changes_requested"].includes(
            request.state,
          )
            ? review
            : undefined
        }
      />
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
      {manage && !["cancelled", "completed"].includes(request.state) && (
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
      {!!request.confirmation_records?.length && <section>
        <h3 className="font-semibold">Confirmações externas</h3>
        {request.confirmation_records.map(record => <p key={record.bl_id}>
          {record.bl_id} · CE {record.ce_mercante} · {new Date(record.confirmed_at).toLocaleString("pt-BR")} · Referência: {record.reference}
        </p>)}
      </section>}
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
