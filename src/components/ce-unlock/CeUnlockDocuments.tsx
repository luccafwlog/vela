import { useId, useState, type ReactNode } from "react";
import { ExternalLink, FileText, Upload } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { InlineError } from "../ui/Card";
import { Input } from "../ui/Input";
import { useConfirm } from "../ui/ConfirmDialog";
import {
  downloadCeUnlockDocument,
  uploadCeUnlockDocument,
} from "../../services/ceUnlockService";
import { annualDocumentValid } from "../../services/ceUnlockRules";
import type { PortalScope } from "../../services/portalScope";
import type { CeDocumentType, CeUnlockDocument } from "../../types/ceUnlock";
import { ceDocumentName, ceStateLabel, ceStateTone } from "../../lib/ceUnlockLabels";

type Decision = "approved" | "changes_requested" | "revoked";

const brDate = (value: string | null) => value?.split("-").reverse().join("/");

/** Uma versão de documento: nome, situação, vigência, motivo da recusa e ações. */
function DocumentRow({
  doc,
  scope,
  title,
  onError,
  children,
}: {
  doc: CeUnlockDocument;
  scope?: PortalScope;
  title?: string;
  onError: (message: string) => void;
  children?: ReactNode;
}) {
  const expired = doc.source === "vip_annual" && doc.status === "approved" && !annualDocumentValid(doc);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3">
      <div className="flex min-w-0 items-start gap-3">
        <FileText size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--app-muted)]" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm text-[var(--app-text-strong)]">{title ?? ceDocumentName(doc.type)}</strong>
            <Badge tone={expired ? "red" : ceStateTone(doc.status)}>
              {expired ? "Fora da vigência" : ceStateLabel(doc.status)}
            </Badge>
          </div>
          <p className="truncate text-xs text-[var(--app-muted)]" title={doc.file_name}>
            {doc.file_name}
            {doc.valid_until ? ` · Vigência ${brDate(doc.valid_from)} a ${brDate(doc.valid_until)}` : ""}
          </p>
          {doc.reason && doc.status !== "approved" ? (
            <p className="text-xs font-semibold text-[var(--app-red)]">Motivo: {doc.reason}</p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          className="app-btn--sm"
          onClick={() =>
            void downloadCeUnlockDocument(doc.id, scope).catch((e) =>
              onError(e instanceof Error ? e.message : "Falha ao abrir documento"),
            )
          }
        >
          <ExternalLink size={14} aria-hidden="true" />
          Abrir documento
        </Button>
        {children}
      </div>
    </div>
  );
}

export function CeUnlockDocumentList({
  documents,
  scope,
  onReview,
  canReview,
  emptyText = "Nenhum documento apresentado.",
}: {
  documents: CeUnlockDocument[];
  scope?: PortalScope;
  onReview?: (doc: CeUnlockDocument, decision: Decision) => void;
  /** Esconde decisões que não fazem sentido agora (ex.: aprovar o que já está aprovado). */
  canReview?: (doc: CeUnlockDocument, decision: Decision) => boolean;
  emptyText?: string;
}) {
  const allowed = (d: CeUnlockDocument, decision: Decision) => !canReview || canReview(d, decision);
  const [error, setError] = useState("");
  const visible = documents.filter((d) => d.status !== "uploading");
  return (
    <div className="space-y-2">
      {error && <InlineError message={error} />}
      {visible.length === 0 && <p className="text-sm text-[var(--app-muted)]">{emptyText}</p>}
      {visible.map((d) => (
        <DocumentRow key={d.id} doc={d} scope={scope} onError={setError}>
          {onReview && d.status !== "revoked" && (
            <>
              {allowed(d, "approved") && (
                <Button className="app-btn--sm" onClick={() => onReview(d, "approved")}>
                  Aprovar {d.type === "termo" ? "termo de devolução" : "procuração"}
                </Button>
              )}
              {allowed(d, "changes_requested") && (
                <Button variant="secondary" className="app-btn--sm" onClick={() => onReview(d, "changes_requested")}>
                  {d.source === "request" ? "Recusar" : "Solicitar correção"}
                </Button>
              )}
              {d.source === "vip_annual" && d.status === "approved" && (
                <Button variant="ghost" className="app-btn--sm" onClick={() => onReview(d, "revoked")}>
                  Revogar aprovação
                </Button>
              )}
            </>
          )}
        </DocumentRow>
      ))}
    </div>
  );
}

const UPLOAD_LABEL: Record<CeDocumentType, string> = {
  model: "Modelo oficial do termo de devolução (PDF)",
  termo: "Termo de devolução assinado (PDF)",
  procuracao: "Procuração (PDF)",
};

/**
 * Um campo por documento. Com `current`, mostra a versão vigente de cada tipo no próprio campo,
 * para o cliente ver o que já enviou (e o motivo de uma recusa) antes de substituir.
 */
export function CeUnlockDocumentUploader({
  source,
  requestId,
  customerId,
  scope,
  onUploaded,
  model = false,
  current,
}: {
  source: "request" | "vip_annual" | "model";
  requestId?: string;
  customerId?: number;
  scope?: PortalScope;
  onUploaded: () => Promise<unknown> | void;
  model?: boolean;
  current?: CeUnlockDocument[];
}) {
  const [files, setFiles] = useState<Partial<Record<CeDocumentType, File>>>({});
  const [inputKeys, setInputKeys] = useState<Partial<Record<CeDocumentType, number>>>({});
  const [busy, setBusy] = useState<CeDocumentType | null>(null);
  const [error, setError] = useState("");
  const confirm = useConfirm();
  const fieldId = useId();
  const types: CeDocumentType[] = model ? ["model"] : ["termo", "procuracao"];
  const latest = (type: CeDocumentType) =>
    current
      ?.filter((d) => d.type === type && d.status !== "uploading")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  async function upload(type: CeDocumentType) {
    const file = files[type];
    if (!file) return;
    // Só o modelo pede confirmação: ele vai para todos os clientes. Os demais geram nova versão sem apagar a anterior.
    if (
      source === "model" &&
      !(await confirm({
        title: "Publicar modelo",
        message: `Publicar ${file.name} como modelo oficial do termo de devolução?`,
        consequence: "O modelo fica disponível para download no Portal de todos os clientes.",
        reversibility: "Enviar outro arquivo substitui o modelo; o histórico é preservado.",
        confirmLabel: "Publicar modelo",
      }))
    )
      return;
    setBusy(type);
    setError("");
    try {
      await uploadCeUnlockDocument({ source, request_id: requestId, customer_id: customerId, type }, file, scope);
      await onUploaded();
      setFiles((prev) => ({ ...prev, [type]: undefined }));
      setInputKeys((prev) => ({ ...prev, [type]: (prev[type] ?? 0) + 1 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao enviar documento");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-3">
      {error && <InlineError message={error} />}
      {types.map((type) => {
        const doc = latest(type);
        return (
          <div key={type} className="space-y-2">
            {doc && <DocumentRow doc={doc} scope={scope} onError={setError} />}
            <div className="app-field">
              <label htmlFor={`${fieldId}-${type}`} className="app-field__label">
                {doc ? `Substituir ${ceDocumentName(type).toLowerCase()} (PDF)` : UPLOAD_LABEL[type]}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id={`${fieldId}-${type}`}
                  key={inputKeys[type] ?? 0}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="min-w-0 flex-1"
                  disabled={!!busy}
                  onChange={(e) => setFiles((prev) => ({ ...prev, [type]: e.target.files?.[0] }))}
                />
                <Button
                  variant="secondary"
                  disabled={!!busy || !files[type]}
                  loading={busy === type}
                  loadingLabel="Enviando…"
                  onClick={() => void upload(type)}
                >
                  <Upload size={14} aria-hidden="true" />
                  {`Enviar ${type === "model" ? "modelo" : type === "termo" ? "termo de devolução" : "procuração"}`}
                </Button>
              </div>
              <span className="app-field__hint">PDF de até 10 MiB</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
