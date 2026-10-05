import { useState } from "react";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { useConfirm } from "../ui/ConfirmDialog";
import {
  downloadCeUnlockDocument,
  uploadCeUnlockDocument,
} from "../../services/ceUnlockService";
import { annualDocumentValid } from "../../services/ceUnlockRules";
import type { PortalScope } from "../../services/portalScope";
import type { CeDocumentType, CeUnlockDocument } from "../../types/ceUnlock";
import { ceStateLabel } from "../../lib/ceUnlockLabels";
export function CeUnlockDocumentList({
  documents,
  scope,
  onReview,
}: {
  documents: CeUnlockDocument[];
  scope?: PortalScope;
  onReview?: (
    doc: CeUnlockDocument,
    decision: "approved" | "changes_requested" | "revoked",
  ) => void;
}) {
  const [error, setError] = useState("");
  return (
    <div className="space-y-3">
      {error && <p role="alert">{error}</p>}
      {documents
        .filter((d) => d.status !== "uploading")
        .map((d) => (
          <div
            key={d.id}
            className="rounded-lg border border-[var(--app-border)] p-3"
          >
            <strong>
              {d.type === "termo"
                ? "Termo"
                : d.type === "model"
                  ? "Modelo do termo"
                  : "Procuração"}
            </strong>
            <p>
              {d.file_name} · {ceStateLabel(d.status)}
              {d.source === "vip_annual" &&
              d.status === "approved" &&
              !annualDocumentValid(d)
                ? " — fora da vigência"
                : ""}
            </p>
            {d.valid_until && (
              <p>
                Vigência: {d.valid_from?.split("-").reverse().join("/")} a{" "}
                {d.valid_until.split("-").reverse().join("/")}
              </p>
            )}
            {d.reason && <p>Motivo: {d.reason}</p>}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                onClick={() =>
                  void downloadCeUnlockDocument(d.id, scope).catch((e) =>
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Falha ao abrir documento",
                    ),
                  )
                }
              >
                Abrir documento
              </Button>
              {onReview && d.status !== "revoked" && (
                <>
                  <Button onClick={() => onReview(d, "approved")}>
                    Aprovar {d.type === "termo" ? "termo" : "procuração"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => onReview(d, "changes_requested")}
                  >
                    Solicitar correção
                  </Button>
                  {d.source === "vip_annual" && d.status === "approved" && (
                    <Button
                      variant="ghost"
                      onClick={() => onReview(d, "revoked")}
                    >
                      Revogar aprovação
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
    </div>
  );
}
export function CeUnlockDocumentUploader({
  source,
  requestId,
  customerId,
  scope,
  onUploaded,
  model = false,
}: {
  source: "request" | "vip_annual" | "model";
  requestId?: string;
  customerId?: number;
  scope?: PortalScope;
  onUploaded: () => Promise<unknown> | void;
  model?: boolean;
}) {
  const [files, setFiles] = useState<Partial<Record<CeDocumentType, File>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirm = useConfirm();
  async function upload(type: CeDocumentType) {
    const file = files[type];
    if (!file) return;
    if (
      !(await confirm({
        title: "Enviar documento",
        message: `Enviar ${file.name}?`,
        consequence:
          source === "model"
            ? "O modelo oficial ficará disponível para download no Portal."
            : "O documento ficará disponível para análise da agência.",
        reversibility: "Uma correção cria nova versão e preserva o histórico.",
      }))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await uploadCeUnlockDocument(
        { source, request_id: requestId, customer_id: customerId, type },
        file,
        scope,
      );
      await onUploaded();
      setFiles((prev) => ({ ...prev, [type]: undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao enviar documento");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {error && <p role="alert">{error}</p>}
      {(model ? ["model"] : (["termo", "procuracao"] as CeDocumentType[])).map(
        (type) => (
          <div key={type}>
            <Field
              label={
                type === "model"
                  ? "Modelo oficial do termo (PDF)"
                  : type === "termo"
                    ? "Termo assinado (PDF)"
                    : "Procuração (PDF)"
              }
              hint="PDF de até 10 MiB"
            >
              <Input
                type="file"
                accept="application/pdf,.pdf"
                disabled={busy}
                onChange={(e) =>
                  setFiles((prev) => ({ ...prev, [type]: e.target.files?.[0] }))
                }
              />
            </Field>
            <Button
              disabled={busy || !files[type as CeDocumentType]}
              onClick={() => void upload(type as CeDocumentType)}
            >
              {busy
                ? "Enviando..."
                : `Enviar ${type === "model" ? "modelo" : type === "termo" ? "termo" : "procuração"}`}
            </Button>
          </div>
        ),
      )}
    </div>
  );
}
