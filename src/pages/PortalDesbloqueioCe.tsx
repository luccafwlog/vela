import { useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { CircleCheck, Download, FileSignature, FileText, Inbox, PackageCheck, Receipt, SearchX } from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, EmptyState, InlineError, PageHeader } from "../components/ui/Card";
import { Field, Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { SkeletonTable } from "../components/ui/Skeleton";
import { TabButton } from "../components/ui/TabButton";
import { TableFooterPagination } from "../components/ui/TableFooterPagination";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { QueryStateGate } from "../components/shared/QueryStateGate";
import { CeUnlockDocumentList, CeUnlockDocumentUploader } from "../components/ce-unlock/CeUnlockDocuments";
import { CeUnlockHistory } from "../components/ce-unlock/CeUnlockHistory";
import { CeUnlockRequirementIcon } from "../components/ce-unlock/CeUnlockRequirements";
import { CeUnlockVipCoveragePanel } from "../components/ce-unlock/CeUnlockVipCoveragePanel";
import { ceDocumentName, ceStateLabel, ceStateTone } from "../lib/ceUnlockLabels";
import { ceUnlockDeadline, formatCeUnlockDeadline, latestSlaStart } from "../services/ceUnlockSla";
import { usePortalCeUnlock } from "../hooks/usePortalCeUnlock";
import { downloadCeUnlockDocument } from "../services/ceUnlockService";
import { portalPath } from "../services/portalScope";

type Tab = "new" | "requests" | "annual";
const PAGE_SIZE = 25;
const SELECTION_LIMIT = 100;

/** Próximo passo do cliente em cada estado; o Portal nunca fala de envio à ZPT. */
const NEXT_STEP: Record<string, string> = {
  draft: "Anexe o termo de devolução e a procuração e clique em Solicitar desbloqueio.",
  submitted: "Recebemos sua solicitação. A agência vai analisar os documentos.",
  in_review: "A agência está analisando os documentos. Lembre-se de entregar o BL original.",
  changes_requested: "A agência pediu correção de um documento. Veja o motivo, envie o arquivo corrigido e reenvie a solicitação.",
  cancelled: "Solicitação cancelada. Os BLs estão livres para uma nova solicitação.",
};

function Requirement({ icon: Icon, title, children }: { icon: typeof Receipt; title: string; children?: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 rounded-lg bg-[var(--app-blue-soft)] p-2 text-[var(--app-blue-btn)]" aria-hidden="true">
        <Icon size={16} />
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-[var(--app-text-strong)]">{title}</p>
        {children && <div className="mt-0.5 text-xs text-[var(--app-muted)]">{children}</div>}
      </div>
    </li>
  );
}

export function PortalDesbloqueioCe() {
  const [params, setParams] = useSearchParams();
  const id = params.get("pedido");
  const [tab, setTab] = useState<Tab>("new");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const draftKey = useRef(crypto.randomUUID());
  const submitKey = useRef(crypto.randomUUID());
  const cancelKey = useRef(crypto.randomUUID());
  const flow = usePortalCeUnlock({ search }, page, id);
  const confirm = useConfirm();
  const readOnly = flow.scope.mode === "inspect";
  const vip = flow.vip.data;
  const vipPending = !!vip?.enabled && (!vip.termo || !vip.procuracao);
  const detail = flow.detail.data;
  // Documento do pedido ainda não apresentado, ou recusado e sem nova versão.
  const missingDocs = ["termo", "procuracao"].filter((type) => {
    const latest = detail?.documents.find((d) => d.type === type && d.source === "request" && d.status !== "uploading");
    return !latest || !["uploaded", "approved"].includes(latest.status);
  });
  const documentsReady =
    detail?.source === "vip_annual" ? !!(vip?.enabled && vip.termo && vip.procuracao) : missingDocs.length === 0;
  const pendingItems = detail?.items.filter((i) => !i.confirmed) ?? [];
  const unpaid = pendingItems.some((i) => !i.paid);
  const submitReady = documentsReady && pendingItems.length > 0 && !unpaid;
  // Com os quatro requisitos atendidos em todos os BLs: o prazo final parte da pendência resolvida mais recente.
  const allReady = !!detail && detail.items.length > 0 && detail.items.every((i) => i.can_export);
  const latestStart = detail ? latestSlaStart(detail.items) : null;
  const editable = !!detail && !readOnly && ["draft", "changes_requested"].includes(detail.state);
  const listItems = flow.list.data?.items ?? [];
  const pageSelectable = listItems.filter((i) => i.can_submit).map((i) => i.bl_id);
  const allPageSelected = pageSelectable.length > 0 && pageSelectable.every((b) => selected.includes(b));

  const open = (next: string | null) => {
    setParams((p) => {
      if (next) p.set("pedido", next);
      else p.delete("pedido");
      return p;
    });
    submitKey.current = crypto.randomUUID();
    setError("");
  };
  function changeTab(next: Tab) {
    setTab(next);
    setPage(1);
  }
  function toggle(blIds: string[], on: boolean) {
    setSelected((prev) => (on ? [...new Set([...prev, ...blIds])] : prev.filter((b) => !blIds.includes(b))));
    draftKey.current = crypto.randomUUID();
  }
  // O rascunho só reserva os BLs e o próprio cliente pode cancelá-lo: não pede confirmação.
  async function create() {
    setError("");
    try {
      const r = await flow.command.mutateAsync({
        action: "draft",
        payload: { bl_ids: selected, request_key: draftKey.current },
      });
      if (!r) throw new Error("Resposta incompleta da solicitação");
      open(r.id);
      setSelected([]);
      draftKey.current = crypto.randomUUID();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível preparar a solicitação");
    }
  }
  async function submit() {
    if (!detail) return;
    const resend = detail.state !== "draft";
    if (
      !(await confirm({
        message: resend
          ? `Reenviar a solicitação ${detail.protocol}?`
          : `Solicitar o desbloqueio dos BLs do protocolo ${detail.protocol}?`,
        affected: { summary: `${detail.items.length} BL(s)`, items: detail.items.map((i) => i.bl_id) },
        consequence: "A agência recebe os documentos para análise. A entrega do BL original continua necessária.",
        reversibility: "A agência pode pedir correção de um documento antes de concluir.",
        confirmLabel: resend ? "Reenviar solicitação" : "Solicitar desbloqueio",
      }))
    )
      return;
    setError("");
    try {
      await flow.command.mutateAsync({
        action: "submit",
        payload: { request_id: detail.id, expected_version: detail.version, request_key: submitKey.current },
      });
      submitKey.current = crypto.randomUUID();
      setTab("requests");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível enviar o pedido");
    }
  }
  async function cancel() {
    if (!detail) return;
    if (
      !(await confirm({
        message: `Cancelar a solicitação ${detail.protocol}?`,
        affected: { summary: `${detail.items.length} BL(s)`, items: detail.items.map((i) => i.bl_id) },
        consequence: "Os BLs ficam livres para uma nova solicitação.",
        reversibility: "Não pode ser desfeito. Para pedir o desbloqueio de novo, abra uma nova solicitação.",
        confirmLabel: "Cancelar solicitação",
        tone: "danger",
      }))
    )
      return;
    setError("");
    try {
      await flow.command.mutateAsync({
        action: "cancel",
        payload: { request_id: detail.id, expected_version: detail.version, request_key: cancelKey.current },
      });
      cancelKey.current = crypto.randomUUID();
      open(null);
      setTab("requests");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível cancelar a solicitação");
    }
  }
  const total = (tab === "new" ? flow.list.data?.total : flow.requests.data?.total) ?? 0;
  const pagination =
    total > PAGE_SIZE ? (
      <TableFooterPagination
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={total}
        totalPages={Math.ceil(total / PAGE_SIZE)}
        onPageChange={setPage}
      />
    ) : null;
  return (
    <>
      <PageHeader title="Desbloqueio de CE" description="Solicite e acompanhe o desbloqueio do CE Mercante dos seus BLs." />
      <div role="tablist" className="mb-4 flex gap-2 border-b border-[var(--app-border)]">
        <TabButton active={tab === "new"} label="Nova solicitação" onClick={() => changeTab("new")} />
        <TabButton active={tab === "requests"} label="Minhas solicitações" onClick={() => changeTab("requests")} />
        {vip?.enabled && (
          <TabButton active={tab === "annual"} label="Documentos anuais" onClick={() => changeTab("annual")} />
        )}
      </div>
      {error && !id && (
        <div className="mb-4">
          <InlineError message={error} />
        </div>
      )}

      {tab === "annual" && (
        <Card>
          <CeUnlockVipCoveragePanel scope={flow.scope} />
        </Card>
      )}

      {tab === "new" && (
        <div className="space-y-4">
          <section className="app-soft-panel">
            <h2 className="app-soft-panel__title">O que é necessário para o desbloqueio</h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Requirement icon={Receipt} title="Taxas locais pagas">
                Confira em{" "}
                <a className="font-semibold text-[var(--app-link)] hover:underline" href={portalPath(flow.scope, "/billing")}>
                  Faturas
                </a>
                .
              </Requirement>
              <Requirement icon={FileSignature} title="Termo de devolução assinado">
                {vip?.enabled ? (
                  "Coberto pelo termo anual VIP."
                ) : flow.model.data ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-semibold text-[var(--app-link)] hover:underline"
                    onClick={() =>
                      void downloadCeUnlockDocument(flow.model.data!.id, flow.scope).catch((e) => setError(e.message))
                    }
                  >
                    <Download size={12} aria-hidden="true" />
                    Baixar modelo do termo de devolução
                  </button>
                ) : (
                  "Modelo ainda não disponibilizado pela agência."
                )}
              </Requirement>
              <Requirement icon={FileText} title="Procuração">
                {vip?.enabled ? "Coberta pela procuração anual VIP." : "Em PDF, anexada à solicitação."}
              </Requirement>
              <Requirement icon={PackageCheck} title="BL original entregue">
                Entregue o BL original na agência.
              </Requirement>
            </ul>
            {/* ponytail: modelo estático do frontend, fora do requisito e do versionamento do termo;
                trocar o texto exige deploy. Se a agência precisar atualizá-lo sozinha, migrar para
                um documento gerenciado como o modelo do termo. */}
            <p className="mt-4 border-t border-[var(--app-border)] pt-3 text-xs text-[var(--app-muted)]">
              Para retirar documentos na agência, leve o memorando preenchido em papel timbrado e assinado.{" "}
              <a
                className="inline-flex items-center gap-1 font-semibold text-[var(--app-link)] hover:underline"
                href="/templates/memorando-liberacao-documentos-modelo.docx"
                download="memorando-liberacao-documentos.docx"
              >
                <Download size={12} aria-hidden="true" />
                Baixar memorando de liberação de documentos
              </a>
            </p>
          </section>

          {vip?.enabled &&
            (vipPending ? (
              <div className="app-callout app-callout--warning">
                Documentos anuais VIP precisam de regularização antes de uma nova solicitação.{" "}
                <button type="button" className="underline" onClick={() => changeTab("annual")}>
                  Abrir Documentos anuais
                </button>
              </div>
            ) : (
              <p className="app-panel app-panel--padded flex items-center gap-2 text-sm">
                <CircleCheck size={16} aria-hidden="true" className="text-[var(--app-green)]" />
                Cobertura VIP vigente — termo e procuração anuais já aprovados.
              </p>
            ))}

          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--app-border)] px-4 py-3">
              <div className="w-full max-w-sm">
                <Field label="Buscar BL ou CE">
                  <Input
                    placeholder="Número do BL ou do CE"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                </Field>
              </div>
              {!readOnly && (
                <div className="flex flex-wrap items-center gap-3">
                  {selected.length > SELECTION_LIMIT && (
                    <span className="text-xs font-semibold text-[var(--app-red)]">
                      Máximo de {SELECTION_LIMIT} BLs por solicitação
                    </span>
                  )}
                  <Button
                    disabled={!selected.length || selected.length > SELECTION_LIMIT || flow.command.isPending || vipPending}
                    onClick={() => void create()}
                  >
                    Continuar com {selected.length} BL(s)
                  </Button>
                </div>
              )}
            </div>
            <QueryStateGate
              isLoading={false}
              isError={Boolean(flow.list.error)}
              hasData={flow.list.data !== undefined}
              errorMessage="Falha ao consultar BLs."
              onRetry={() => void flow.list.refetch?.()}
            >
              <div className="app-table-scroll">
                <table className="app-table app-table--compact min-w-[760px] text-left text-sm">
                  <caption className="sr-only">BLs com CE Mercante</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="w-10 px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label="Selecionar os BLs disponíveis da página"
                          disabled={readOnly || !pageSelectable.length}
                          checked={allPageSelected}
                          onChange={() => toggle(pageSelectable, !allPageSelected)}
                        />
                      </th>
                      <th scope="col" className="px-3 py-3">BL / CE</th>
                      <th scope="col" className="px-3 py-3">Navio / Viagem</th>
                      <th scope="col" className="px-3 py-3">POD</th>
                      <th scope="col" className="px-3 py-3">Taxas locais</th>
                      <th scope="col" className="px-3 py-3">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flow.list.isLoading && (
                      <tr>
                        <td colSpan={6} className="p-0">
                          <SkeletonTable rows={5} cols={6} label="Carregando BLs" />
                        </td>
                      </tr>
                    )}
                    {flow.list.data?.total === 0 && (
                      <tr>
                        <td colSpan={6} className="p-0">
                          <EmptyState
                            icon={SearchX}
                            title={search ? "Nenhum BL encontrado" : "Nenhum BL com CE Mercante"}
                            description={
                              search
                                ? "Confira o número digitado."
                                : "Os BLs aparecem aqui assim que o CE Mercante for registrado."
                            }
                          />
                        </td>
                      </tr>
                    )}
                    {listItems.map((i) => {
                      const checked = selected.includes(i.bl_id);
                      return (
                        <tr key={i.bl_id} className={checked ? "bg-[var(--app-blue-soft)]" : undefined}>
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              aria-label={`Selecionar BL ${i.bl_id}`}
                              disabled={readOnly || (!i.can_submit && !checked)}
                              checked={checked}
                              onChange={(e) => toggle([i.bl_id], e.target.checked)}
                            />
                          </td>
                          <td className="px-3 py-3">
                            <span className="app-table__cell-stack">
                              <span className="app-table__cell-value font-semibold">{i.bl_id}</span>
                              <span className="app-table__cell-meta whitespace-nowrap">CE {i.ce_mercante ?? "—"}</span>
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            {[i.vessel_name, i.voyage_number].filter(Boolean).join(" · ") || "—"}
                          </td>
                          <td className="px-3 py-3">{i.pod ?? "—"}</td>
                          <td className="px-3 py-3">
                            <span className="app-table__cell-stack">
                              <span>
                                <Badge tone={i.paid ? "green" : "yellow"}>{i.paid ? "Pagas" : "Pendentes"}</Badge>
                              </span>
                              {!i.paid && (
                                <a
                                  className="app-table__cell-meta font-semibold text-[var(--app-link)] hover:underline"
                                  href={portalPath(flow.scope, "/billing")}
                                >
                                  Ver faturas
                                </a>
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            {i.request_id ? (
                              <span className="flex flex-wrap items-center gap-2">
                                <Badge tone={ceStateTone(i.state)}>{ceStateLabel(i.state)}</Badge>
                                <Button variant="ghost" className="app-btn--sm" onClick={() => open(i.request_id)}>
                                  Abrir solicitação
                                </Button>
                              </span>
                            ) : i.can_submit ? (
                              <span className="app-table__cell-meta">Disponível para solicitar</span>
                            ) : (
                              <ul className="app-table__cell-meta list-none space-y-0.5">
                                {i.reasons.map((r) => (
                                  <li key={r}>{r}</li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </QueryStateGate>
            {pagination}
          </Card>
        </div>
      )}

      {tab === "requests" && (
        <Card className="overflow-hidden p-0">
          <QueryStateGate
            isLoading={false}
            isError={Boolean(flow.requests.error)}
            hasData={flow.requests.data !== undefined}
            errorMessage="Falha ao consultar solicitações."
            onRetry={() => void flow.requests.refetch?.()}
          >
            {flow.requests.isLoading ? (
              <SkeletonTable rows={4} cols={4} label="Carregando solicitações" />
            ) : flow.requests.data?.total === 0 ? (
              <EmptyState
                icon={Inbox}
                title="Nenhuma solicitação ainda"
                description="Selecione os BLs em Nova solicitação para pedir o desbloqueio."
                action={
                  <Button variant="secondary" onClick={() => changeTab("new")}>
                    Nova solicitação
                  </Button>
                }
              />
            ) : (
              <div className="app-table-scroll">
                <table className="app-table app-table--compact min-w-[520px] text-left text-sm">
                  <caption className="sr-only">Minhas solicitações de desbloqueio</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-3">Protocolo</th>
                      <th scope="col" className="px-3 py-3">Situação</th>
                      <th scope="col" className="px-3 py-3">Documentos</th>
                      <th scope="col" className="px-3 py-3">
                        <span className="sr-only">Ação</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {flow.requests.data?.items.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-3 font-semibold text-[var(--app-text-strong)]">{r.protocol}</td>
                        <td className="px-3 py-3">
                          <Badge tone={ceStateTone(r.state)}>{ceStateLabel(r.state)}</Badge>
                        </td>
                        <td className="px-3 py-3 text-[var(--app-muted)]">
                          {r.source === "vip_annual" ? "Anuais VIP" : "Anexados à solicitação"}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Button
                            variant="secondary"
                            className="app-btn--sm"
                            aria-label={`Abrir ${r.protocol}`}
                            onClick={() => open(r.id)}
                          >
                            Abrir
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryStateGate>
          {pagination}
        </Card>
      )}

      <Modal
        open={!!id}
        title={detail ? `Solicitação ${detail.protocol}` : "Solicitação de desbloqueio"}
        onClose={() => open(null)}
      >
        {flow.detail.isLoading ? (
          <p className="text-sm text-[var(--app-muted)]">Carregando solicitação…</p>
        ) : flow.detail.error ? (
          <InlineError message="Não foi possível consultar a solicitação." />
        ) : (
          detail && (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  {!(allReady && latestStart) && <Badge tone={ceStateTone(detail.state)}>{ceStateLabel(detail.state)}</Badge>}
                  <span className="text-[var(--app-muted)]">{detail.items.length} BL(s)</span>
                  {latestStart && !allReady && (
                    <span className="text-[var(--app-muted)]">
                      {/* Só a data: o cliente não vê se o prazo da agência venceu. */}
                      Prazo: até{" "}
                      <strong className="text-[var(--app-text-strong)]">
                        {formatCeUnlockDeadline(ceUnlockDeadline(latestStart))}
                      </strong>
                    </span>
                  )}
                </div>
                {allReady && latestStart ? (
                  <p
                    role="status"
                    className="flex items-start gap-2 rounded-lg bg-[var(--app-green-soft)] p-3 text-sm font-semibold text-[#157a45] dark:text-[#bbf7d0]"
                  >
                    <CircleCheck size={18} aria-hidden="true" className="shrink-0" />
                    <span>
                      Documentação validada. Prazo para o desbloqueio: até{" "}
                      {formatCeUnlockDeadline(ceUnlockDeadline(latestStart))}. Consulte o Mercante para verificar o
                      desbloqueio.
                    </span>
                  </p>
                ) : (
                  NEXT_STEP[detail.state] && <p className="text-sm text-[var(--app-muted)]">{NEXT_STEP[detail.state]}</p>
                )}
                {latestStart && !allReady && (
                  <p className="text-xs text-[var(--app-muted)]">
                    O prazo recomeça quando uma pendência é regularizada: reenvio de documento, entrega do BL original ou
                    pagamento das taxas.
                  </p>
                )}
              </div>
              {error && <InlineError message={error} />}

              <div className="space-y-3">
                <h3 className="app-panel__title">Documentos</h3>
                {detail.source === "vip_annual" ? (
                  <p className="text-sm text-[var(--app-muted)]">Esta solicitação usa seus documentos anuais VIP.</p>
                ) : editable ? (
                  <CeUnlockDocumentUploader
                    source="request"
                    requestId={detail.id}
                    scope={flow.scope}
                    onUploaded={flow.refresh}
                    current={detail.documents.filter((d) => d.source === "request")}
                  />
                ) : (
                  <CeUnlockDocumentList documents={detail.documents} scope={flow.scope} />
                )}
              </div>

              <div className="space-y-3">
                <h3 className="app-panel__title">BLs da solicitação</h3>
                <div className="app-table-scroll rounded-lg border border-[var(--app-border)]">
                  <table className="app-table app-table--compact min-w-[560px] text-left text-sm">
                    <caption className="sr-only">Requisitos de cada BL</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="px-3 py-2">BL / CE</th>
                        <th scope="col" className="px-2 py-2 text-center">Termo</th>
                        <th scope="col" className="px-2 py-2 text-center">Procuração</th>
                        <th scope="col" className="px-2 py-2 text-center">Taxas locais</th>
                        <th scope="col" className="px-2 py-2 text-center">BL original</th>
                        <th scope="col" className="px-3 py-2">Pendências</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map((i) => (
                        <tr key={i.bl_id}>
                          <td className="px-3 py-2">
                            <span className="app-table__cell-stack">
                              <span className="app-table__cell-value font-semibold">{i.bl_id}</span>
                              <span className="app-table__cell-meta whitespace-nowrap">CE {i.ce_mercante ?? "—"}</span>
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <CeUnlockRequirementIcon ok={!!i.termo} label="Termo de devolução" />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <CeUnlockRequirementIcon ok={!!i.procuracao} label="Procuração" />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <CeUnlockRequirementIcon ok={!!i.paid} label="Taxas locais" />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <CeUnlockRequirementIcon ok={!!i.delivered} label="BL original" />
                          </td>
                          <td className="px-3 py-2">
                            {i.can_export ? (
                              <span className="app-table__cell-meta">Requisitos atendidos</span>
                            ) : (
                              <ul className="app-table__cell-meta list-none space-y-0.5">
                                {i.reasons.map((r) => (
                                  <li key={r}>{r}</li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <CeUnlockHistory events={detail.events} />

              {editable && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-border)] pt-4">
                  <Button variant="ghost" disabled={flow.command.isPending} onClick={() => void cancel()}>
                    Cancelar solicitação
                  </Button>
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    {!submitReady && (
                      <span className="text-xs text-[var(--app-muted)]">
                        {!documentsReady
                          ? detail.source === "vip_annual"
                            ? "Regularize os documentos anuais VIP para enviar."
                            : `Envie ${missingDocs.map((t) => ceDocumentName(t).toLowerCase()).join(" e ")} para continuar.`
                          : unpaid
                            ? "Há BL com taxas locais pendentes."
                            : null}
                      </span>
                    )}
                    <Button disabled={flow.command.isPending || !submitReady} onClick={() => void submit()}>
                      {detail.state === "draft" ? "Solicitar desbloqueio" : "Reenviar solicitação"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </Modal>
    </>
  );
}
