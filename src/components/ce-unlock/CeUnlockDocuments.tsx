import { useId, useRef, useState, type ReactNode } from "react";
import { ExternalLink, FileText, Upload, type LucideIcon } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { RowActionButton } from "../ui/RowActionButton";
import { InlineError } from "../ui/Card";
import { Input } from "../ui/Input";
import { NoValue } from "../ui/NoValue";
import { StatusText } from "../ui/StatusText";
import { useConfirm } from "../ui/ConfirmDialog";
import {
  downloadCeUnlockDocument,
  uploadCeUnlockDocument,
} from "../../services/ceUnlockService";
import { annualDocumentValid } from "../../services/ceUnlockRules";
import type { PortalScope } from "../../services/portalScope";
import type { CeDocumentType, CeUnlockDocument } from "../../types/ceUnlock";
import { cn, formatDate } from "../../lib/utils";
import { ceDate, ceDocumentName, ceDocumentStatusText, ceShortReason, ceStateLabel, ceStateTone } from "../../lib/ceUnlockLabels";

const PDF_ACCEPT = "application/pdf,.pdf";
const DOCX_ACCEPT = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Nome do arquivo que abre o documento (regra 9): o link substitui o botão
 * "Abrir documento". Arquivo expurgado ou em expurgo fica em texto.
 */
export function CeUnlockFileLink({
  doc,
  scope,
  onError,
}: {
  doc: CeUnlockDocument;
  scope?: PortalScope;
  onError: (message: string) => void;
}) {
  if (doc.purged) return <span title="Arquivo removido pela regra de retenção">{doc.file_name} (arquivo removido pela regra de retenção)</span>;
  if (doc.cleanup_pending) return <span title="Arquivo em remoção pela regra de retenção">{doc.file_name} (arquivo em remoção pela regra de retenção)</span>;
  return (
    <button
      type="button"
      className="app-link max-w-full truncate align-bottom"
      title={doc.file_name}
      onClick={() =>
        void downloadCeUnlockDocument(doc.id, scope).catch((e) => onError(e instanceof Error ? e.message : "Falha ao abrir documento"))
      }
    >
      {doc.file_name}
    </button>
  );
}

/**
 * Botão que escolhe um arquivo (lote 4 da identidade): substitui o campo de
 * arquivo do navegador, que aparecia em inglês. O campo nativo continua no
 * DOM, oculto, e é ele que recebe o arquivo.
 */
export function CeUnlockFileButton({
  children,
  inputLabel,
  onFile,
  accept = PDF_ACCEPT,
  variant = "secondary",
  className,
  disabled,
  loading,
  loadingLabel,
  ariaLabel,
  icon,
}: {
  children: ReactNode;
  /** Nome do campo oculto (leitor de tela e testes). */
  inputLabel: string;
  onFile: (file: File) => void;
  accept?: string;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  ariaLabel?: string;
  /** Em linha de tabela, só o ícone (regra 9); `ariaLabel` vira o nome e o `title`. */
  icon?: LucideIcon;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      {icon && ariaLabel ? (
        <RowActionButton
          variant={variant}
          className={className}
          label={ariaLabel}
          icon={icon}
          disabled={disabled}
          loading={loading}
          onClick={() => input.current?.click()}
        />
      ) : (
        <Button
          variant={variant}
          className={className}
          disabled={disabled}
          loading={loading}
          loadingLabel={loadingLabel}
          aria-label={ariaLabel}
          onClick={() => input.current?.click()}
        >
          {children}
        </Button>
      )}
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        aria-label={inputLabel}
        disabled={disabled || loading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Limpo a cada escolha: escolher de novo o mesmo arquivo corrigido também conta.
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </>
  );
}

/**
 * Situação de um documento em texto (regra 5): "✓ Aprovado"; "Aguardando
 * análise" e "Correção pedida: <motivo curto>" em âmbar, com o motivo inteiro
 * ao passar o mouse. Na versão anterior (`muted`, linha em cinza) só o nome
 * da situação.
 */
export function CeUnlockDocumentSituation({ doc, muted = false }: { doc: CeUnlockDocument; muted?: boolean }) {
  const expired = doc.source === "vip_annual" && doc.status === "approved" && !annualDocumentValid(doc);
  const reason = doc.reason?.trim() || null;
  let label: string;
  let tone: "default" | "warning" | "paid" = "warning";
  if (expired) label = "Fora da vigência";
  else if (doc.status === "changes_requested") label = "Correção pedida";
  else if (doc.status === "revoked") label = "Aprovação revogada";
  else ({ label, tone } = ceDocumentStatusText(doc.type, doc.status));
  const withReason = !muted && reason && ["changes_requested", "revoked"].includes(doc.status);
  const text = withReason ? `${label}: ${ceShortReason(reason)}` : label;
  // Pilha de uma linha: a célula fica à esquerda sem o corte com "…" do texto longo (situação é dado curto).
  return (
    <span className="app-table__cell-stack" title={reason && doc.status !== "approved" ? reason : undefined}>
      <span>{muted ? text : <StatusText tone={tone}>{text}</StatusText>}</span>
    </span>
  );
}

type AnnualRow = { doc: CeUnlockDocument; current: boolean; muted: boolean };

/**
 * Ordem da tabela de anuais: a versão mais recente de cada documento primeiro,
 * o que pede ação antes; depois as versões anteriores. A anterior aprovada e
 * ainda vigente continua valendo (a nova está em análise) e não fica cinza.
 */
function annualDocumentRows(documents: CeUnlockDocument[]): AnnualRow[] {
  const visible = documents.filter((d) => d.status !== "uploading" && (d.type === "termo" || d.type === "procuracao"));
  const latest = new Map<string, CeUnlockDocument>();
  for (const d of visible) {
    const seen = latest.get(d.type);
    if (!seen || d.created_at > seen.created_at) latest.set(d.type, d);
  }
  const needsAction = (d: CeUnlockDocument) => !annualDocumentValid(d);
  const typeOrder = (d: CeUnlockDocument) => (d.type === "termo" ? 0 : 1);
  return visible
    .map((doc) => {
      const current = latest.get(doc.type) === doc;
      return { doc, current, muted: !current && !annualDocumentValid(doc) };
    })
    .sort(
      (a, b) =>
        Number(a.muted) - Number(b.muted) ||
        Number(b.current) - Number(a.current) ||
        Number(needsAction(b.doc)) - Number(needsAction(a.doc)) ||
        typeOrder(a.doc) - typeOrder(b.doc) ||
        b.doc.created_at.localeCompare(a.doc.created_at),
    );
}

/**
 * Documentos anuais VIP numa tabela (lote 4 da identidade): a mesma peça no
 * Portal (o Cliente envia), na ficha do Cliente (o Vela analisa) e na análise
 * do pedido VIP. O nome do arquivo abre o documento.
 */
export function CeUnlockAnnualDocumentTable({
  documents,
  scope,
  onError,
  actions,
}: {
  documents: CeUnlockDocument[];
  scope?: PortalScope;
  onError: (message: string) => void;
  /** Coluna de ações do Vela: "Analisar" ou o menu ⋮ da linha. */
  actions?: (doc: CeUnlockDocument, current: boolean) => ReactNode;
}) {
  const rows = annualDocumentRows(documents);
  const columns = actions ? 6 : 5;
  return (
    <div className="app-table-scroll">
      <table className="app-table app-table--compact text-sm">
        <caption className="sr-only">Documentos anuais VIP</caption>
        <thead>
          <tr>
            <th scope="col" className="app-table__text-head">Documento</th>
            <th scope="col" className="app-table__text-head">Arquivo</th>
            <th scope="col">Enviado em</th>
            <th scope="col">Vigência</th>
            <th scope="col" className="app-table__text-head">Situação</th>
            {actions ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns} className="app-table__text">Nenhum documento anual enviado.</td>
            </tr>
          )}
          {rows.map(({ doc, current, muted }) => (
            <tr key={doc.id} className={cn(muted && "app-table__row--muted")}>
              <td className="app-table__text">{ceDocumentName(doc.type)}</td>
              <td className="app-table__text"><CeUnlockFileLink doc={doc} scope={scope} onError={onError} /></td>
              <td className="whitespace-nowrap tabular-nums">{ceDate(doc.created_at)}</td>
              <td className="whitespace-nowrap tabular-nums">
                {doc.valid_from && doc.valid_until ? (
                  `${formatDate(doc.valid_from)} a ${formatDate(doc.valid_until)}`
                ) : (
                  <NoValue label="Sem vigência" />
                )}
              </td>
              <td className="whitespace-nowrap"><CeUnlockDocumentSituation doc={doc} muted={muted} /></td>
              {actions ? <td className="whitespace-nowrap text-right">{actions(doc, current)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Uma versão de documento num cartão: nome, situação e abrir (modelo do termo no Vela). */
function DocumentRow({
  doc,
  onError,
}: {
  doc: CeUnlockDocument;
  onError: (message: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3">
      <div className="flex min-w-0 items-start gap-3">
        <FileText size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--app-muted)]" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm text-[var(--app-text-strong)]">{ceDocumentName(doc.type)}</strong>
            <Badge tone={ceStateTone(doc.status)}>{ceStateLabel(doc.status)}</Badge>
          </div>
          <p className="truncate text-xs text-[var(--app-muted)]" title={doc.file_name}>
            {doc.file_name}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {doc.purged ? (
          <span className="text-xs text-[var(--app-muted)]">Arquivo removido pela regra de retenção</span>
        ) : doc.cleanup_pending ? (
          <span className="text-xs text-[var(--app-muted)]">Arquivo em remoção pela regra de retenção</span>
        ) : (
          <Button
            variant="ghost"
            className="app-btn--sm"
            onClick={() =>
              void downloadCeUnlockDocument(doc.id).catch((e) =>
                onError(e instanceof Error ? e.message : "Falha ao abrir documento"),
              )
            }
          >
            <ExternalLink size={14} aria-hidden="true" />
            Abrir documento
          </Button>
        )}
      </div>
    </div>
  );
}

/** Lista de documentos em cartões; hoje só o modelo do termo publicado no Vela. */
export function CeUnlockDocumentList({
  documents,
  emptyText = "Nenhum documento apresentado.",
}: {
  documents: CeUnlockDocument[];
  emptyText?: string;
}) {
  const [error, setError] = useState("");
  const visible = documents.filter((d) => d.status !== "uploading");
  return (
    <div className="space-y-2">
      {error && <InlineError message={error} />}
      {visible.length === 0 && <p className="text-sm text-[var(--app-muted)]">{emptyText}</p>}
      {visible.map((d) => (
        <DocumentRow key={d.id} doc={d} onError={setError} />
      ))}
    </div>
  );
}

/** Publicação do modelo do termo de devolução (DOCX) no Vela, com confirmação. */
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
  const [inputKeys, setInputKeys] = useState<Partial<Record<CeDocumentType, number>>>({});
  const [busy, setBusy] = useState<CeDocumentType | null>(null);
  const [error, setError] = useState("");
  const confirm = useConfirm();
  const fieldId = useId();
  const types: CeDocumentType[] = model ? ["model"] : ["termo", "procuracao"];
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
      {types.map((type) => (
        <div key={type} className="app-field">
          <label htmlFor={`${fieldId}-${type}`} className="app-field__label">
            {type === "model" ? "Modelo oficial do termo de devolução (DOCX)" : `${ceDocumentName(type)} (PDF)`}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={`${fieldId}-${type}`}
              key={inputKeys[type] ?? 0}
              type="file"
              accept={type === "model" ? DOCX_ACCEPT : PDF_ACCEPT}
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
              {`Enviar ${type === "model" ? "modelo" : ceDocumentName(type).toLowerCase()}`}
            </Button>
          </div>
          <span className="app-field__hint">{type === "model" ? "DOCX de até 10 MiB" : "PDF de até 10 MiB"}</span>
        </div>
      ))}
    </div>
  );
}
