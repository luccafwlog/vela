import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, FileText, History, SearchX } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useCeUnlock, useCeUnlockRequest } from "../hooks/useCeUnlock";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, EmptyState, InlineError, PageHeader } from "../components/ui/Card";
import { FilterBar } from "../components/ui/FilterBar";
import { Field, Input, Select } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { SkeletonTable } from "../components/ui/Skeleton";
import { TabButton } from "../components/ui/TabButton";
import { TableFooterPagination } from "../components/ui/TableFooterPagination";
import { useToast } from "../components/ui/Toast";
import { QueryStateGate } from "../components/shared/QueryStateGate";
import { VoyageCombobox } from "../components/shared/VoyageCombobox";
import { useConfirm, useConfirmWithReason } from "../components/ui/ConfirmDialog";
import { CeUnlockRequestDetail } from "../components/ce-unlock/CeUnlockRequestDetail";
import { CeUnlockDocumentList, CeUnlockDocumentUploader } from "../components/ce-unlock/CeUnlockDocuments";
import { CeUnlockReviewQueue } from "../components/ce-unlock/CeUnlockReviewQueue";
import { CeUnlockRequirementIcon } from "../components/ce-unlock/CeUnlockRequirements";
import { CeUnlockSla } from "../components/ce-unlock/CeUnlockSla";
import { CeUnlockZptImport } from "../components/ce-unlock/CeUnlockZptImport";
import { ceDateTime, ceStateLabel, ceStateTone } from "../lib/ceUnlockLabels";
import { ceUnlockRead, downloadCeUnlockExport, listCeUnlockExports } from "../services/ceUnlockService";
import { afterCeUnlockChanged } from "../services/cacheEffects";
import type { CeUnlockDocument, CeUnlockFilters, CeUnlockItem } from "../types/ceUnlock";

type Tab = "solicitacoes" | "controle";
type Panel = "model" | "zpt" | "exports" | null;
const PAGE_SIZE = 25;
const EXPORT_LIMIT = 100;
// Fila de trabalho do dia: BLs prontos que ainda não foram à ZPT.
const DEFAULT_FILTERS: CeUnlockFilters = { situation: "ready_not_exported" };
const SITUATIONS: Array<[string, string]> = [
  ["ready_not_exported", "Aptos — não exportados"],
  ["", "Todas as situações"],
  ["divergent", "Divergentes na ZPT"],
  ["no_request", "Sem solicitação"],
  ["submitted", "Enviado"],
  ["in_review", "Em análise"],
  ["changes_requested", "Correção solicitada"],
  ["ready", "Aptos (inclui exportados)"],
  ["completed", "Documentação validada"],
];
const COLUMNS = 11;

function ZptCell({ i }: { i: CeUnlockItem }) {
  if (i.zpt_status === "divergent")
    return (
      <span className="app-table__cell-stack max-w-[200px] whitespace-normal">
        <span><Badge tone="red">{ceStateLabel("divergent")}</Badge></span>
        {i.zpt_description && <span className="app-table__cell-meta">{i.zpt_description}</span>}
        {!!i.zpt_pending?.length && <span className="app-table__cell-meta">Pendente na ZPT: {i.zpt_pending.join(", ")}</span>}
      </span>
    );
  if (i.zpt_status === "unlocked")
    return (
      <span className="app-table__cell-stack">
        <span><Badge tone="green">{ceStateLabel("unlocked")}</Badge></span>
        {i.zpt_without_export && <span className="app-table__cell-meta">Sem exportação pelo Vela</span>}
      </span>
    );
  if (i.can_export) {
    const state = i.export_state ?? "not_exported";
    return (
      <span className="app-table__cell-stack">
        <span><Badge tone={state === "not_exported" ? "yellow" : ceStateTone(state)}>{ceStateLabel(state)}</Badge></span>
        {i.exported_at && <span className="app-table__cell-meta">{ceDateTime(i.exported_at)}</span>}
      </span>
    );
  }
  return (
    <ul className="app-table__cell-meta max-w-[200px] list-none space-y-0.5 whitespace-normal">
      {i.reasons.map((r) => <li key={r}>{r}</li>)}
    </ul>
  );
}

export function DesbloqueioCe() {
  const { can } = useAuth();
  const manage = can("ce_unlock_manage");
  const [params, setParams] = useSearchParams();
  const id = params.get("pedido");
  const tab: Tab = params.get("aba") === "controle" ? "controle" : "solicitacoes";
  const [filters, setFilters] = useState<CeUnlockFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const keys = useRef(new Map<string, string>());
  const { list, command } = useCeUnlock(filters, page, can("ce_unlock_read") && tab === "controle");
  const request = useCeUnlockRequest(id);
  const client = useQueryClient();
  const confirm = useConfirm();
  const reasonDialog = useConfirmWithReason();
  const { showToast } = useToast();
  const exports = useQuery({
    queryKey: ["ce-unlock", "exports"],
    queryFn: listCeUnlockExports,
    enabled: manage && panel === "exports",
  });
  const model = useQuery({
    queryKey: ["ce-unlock", "model", "internal"],
    queryFn: () => ceUnlockRead<CeUnlockDocument | null>("model"),
    enabled: manage && panel === "model",
  });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const activeFilters =
    (["search", "pending_requirement", "pod", "voyage_id"] as const).filter((k) => !!filters[k]).length +
    (filters.situation !== DEFAULT_FILTERS.situation ? 1 : 0);
  const situationLabel = SITUATIONS.find(([v]) => v === (filters.situation ?? ""))?.[1] ?? "";
  const pageExportable = items.filter((i) => i.can_export).map((i) => i.bl_id);
  const allPageSelected = pageExportable.length > 0 && pageExportable.every((b) => selected.includes(b));

  function filter(key: keyof CeUnlockFilters, value: string | number | undefined) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }
  function setRequest(next: string | null) {
    setParams((p) => {
      if (next) p.set("pedido", next);
      else p.delete("pedido");
      return p;
    });
  }
  function openTab(next: Tab) {
    setParams((p) => {
      p.set("aba", next);
      return p;
    });
  }
  function keyFor(action: string, payload: Record<string, unknown>) {
    const text = JSON.stringify({ action, payload });
    if (!keys.current.has(text)) keys.current.set(text, crypto.randomUUID());
    return { text, key: keys.current.get(text)! };
  }
  async function act(action: string, payload: Record<string, unknown>) {
    const k = keyFor(action, payload);
    const result = await command.mutateAsync({ action, payload: { ...payload, request_key: k.key } });
    keys.current.delete(k.text);
    return result;
  }
  async function delivery(i: CeUnlockItem) {
    let reason: string | null = null;
    if (i.delivered) {
      reason = await reasonDialog({
        message: `Desmarcar a entrega do BL original ${i.bl_id}?`,
        consequence: "O BL deixa de atender o requisito BL de Entrega e não pode ser exportado.",
        reversibility: "A entrega pode ser registrada novamente.",
        confirmLabel: "Desmarcar entrega",
        tone: "danger",
      });
      if (!reason) return;
    } else if (
      !(await confirm({
        message: `Registrar o recebimento do BL original ${i.bl_id}?`,
        consequence: "O requisito BL de Entrega passa a atendido e o prazo do cliente recomeça a partir de agora.",
        reversibility: "Uma marcação incorreta pode ser desfeita com motivo.",
        confirmLabel: "Registrar entrega",
      }))
    )
      return;
    try {
      await act("delivery", { bl_id: i.bl_id, delivered: !i.delivered, expected_version: i.delivery_version, reason });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao registrar entrega", "error");
    }
  }
  async function exportSelected(blIds = selected, reexportOf?: string) {
    if (
      !(await confirm({
        message: `${reexportOf ? "Reexportar" : "Exportar"} ${blIds.length} BL(s) para a ZPT?`,
        affected: { summary: `${blIds.length} BL(s)`, items: blIds },
        consequence: "A planilha é baixada e o envio fica registrado nestes BLs. O desbloqueio acontece quando ela for importada na ZPT.",
        reversibility: "BL recusado pela ZPT aparece como divergente após a conciliação e pode ser reexportado.",
        confirmLabel: reexportOf ? "Reexportar" : "Exportar planilha",
      }))
    )
      return;
    const payload = { bl_ids: blIds, ...(reexportOf ? { reexport_of: reexportOf } : {}) };
    const k = keyFor("export", payload);
    setExportBusy(true);
    try {
      await downloadCeUnlockExport({ ...payload, request_key: k.key });
      keys.current.delete(k.text);
      await afterCeUnlockChanged(client);
      if (!reexportOf) setSelected([]);
      showToast(`Planilha gerada com ${blIds.length} BL(s). Importe-a na aba "Planilha desbloqueio" da ZPT.`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao exportar", "error");
    } finally {
      setExportBusy(false);
    }
  }
  if (!can("ce_unlock_read"))
    return <EmptyState title="Acesso não autorizado" description="Seu perfil não consulta o Desbloqueio de CE." />;
  return (
    <>
      <PageHeader
        title="Desbloqueio de CE"
        description="Valide os documentos das solicitações do Portal e prepare os BLs aptos para a ZPT."
        action={
          manage ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setPanel("model")}>
                <FileText size={16} aria-hidden="true" />
                Modelo do termo de devolução
              </Button>
              <Button variant="secondary" onClick={() => setPanel("exports")}>
                <History size={16} aria-hidden="true" />
                Histórico ZPT
              </Button>
              <Button variant="secondary" onClick={() => setPanel("zpt")}>
                <FileSpreadsheet size={16} aria-hidden="true" />
                Conciliar com a ZPT
              </Button>
            </div>
          ) : undefined
        }
      />
      <div role="tablist" className="mb-4 flex gap-2 border-b border-[var(--app-border)]">
        <TabButton active={tab === "solicitacoes"} label="Solicitações" onClick={() => openTab("solicitacoes")} />
        <TabButton active={tab === "controle"} label="Controle ZPT" onClick={() => openTab("controle")} />
      </div>
      {tab === "solicitacoes" ? (
        <CeUnlockReviewQueue enabled={can("ce_unlock_read")} onOpen={setRequest} />
      ) : (
        <>
          <FilterBar
            defaultOpen
            activeCount={activeFilters}
            appliedDefaults={situationLabel ? [situationLabel] : undefined}
            onClear={() => {
              setFilters(DEFAULT_FILTERS);
              setPage(1);
            }}
          >
            <div className="app-filter-grid">
              <Field label="Buscar BL, CE ou cliente">
                <Input
                  placeholder="Número do BL, CE ou nome do cliente"
                  value={filters.search ?? ""}
                  onChange={(e) => filter("search", e.target.value)}
                />
              </Field>
              <Field label="Situação">
                <Select value={filters.situation ?? ""} onChange={(e) => filter("situation", e.target.value)}>
                  {SITUATIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </Field>
              <Field label="Requisito pendente">
                <Select value={filters.pending_requirement ?? ""} onChange={(e) => filter("pending_requirement", e.target.value)}>
                  <option value="">Todos</option>
                  <option value="termo">Termo de devolução</option>
                  <option value="procuracao">Procuração</option>
                  <option value="taxas">Financeiro (taxas locais)</option>
                  <option value="bl_fisico">BL de Entrega</option>
                </Select>
              </Field>
              <Field label="POD">
                <Input value={filters.pod ?? ""} onChange={(e) => filter("pod", e.target.value)} />
              </Field>
              <VoyageCombobox
                clearable
                label="Viagem"
                selectedVoyageId={filters.voyage_id}
                onSelect={(next) => filter("voyage_id", next ?? undefined)}
              />
            </div>
          </FilterBar>
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--app-border)] px-4 py-3 text-sm">
              <span className="font-semibold text-[var(--app-text-strong)]">{total} BL(s)</span>
              {manage && (
                <div className="flex flex-wrap items-center gap-3">
                  {selected.length > 0 && (
                    <>
                      <span className="text-[var(--app-muted)]">{selected.length} selecionado(s)</span>
                      <Button variant="ghost" className="app-btn--sm" onClick={() => setSelected([])}>Limpar seleção</Button>
                    </>
                  )}
                  {selected.length > EXPORT_LIMIT && (
                    <span className="text-xs font-semibold text-[var(--app-red)]">Máximo de {EXPORT_LIMIT} BLs por planilha</span>
                  )}
                  <Button
                    disabled={!selected.length || selected.length > EXPORT_LIMIT || command.isPending}
                    loading={exportBusy}
                    loadingLabel="Exportando…"
                    onClick={() => void exportSelected()}
                  >
                    <Download size={16} aria-hidden="true" />
                    Exportar {selected.length} apto(s) para ZPT
                  </Button>
                </div>
              )}
            </div>
            <QueryStateGate
              isLoading={false}
              isError={Boolean(list.error)}
              hasData={list.data !== undefined}
              errorMessage="Falha ao consultar BLs."
              onRetry={() => void list.refetch?.()}
            >
              <div className="app-table-scroll app-table-scroll--sticky">
                <table className="app-table app-table--compact min-w-[1240px] whitespace-nowrap text-left text-sm">
                  <caption className="sr-only">Requisitos de desbloqueio de cada BL</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="w-10 px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label="Selecionar os BLs aptos da página"
                          disabled={!manage || !pageExportable.length}
                          checked={allPageSelected}
                          onChange={() =>
                            setSelected((prev) =>
                              allPageSelected
                                ? prev.filter((b) => !pageExportable.includes(b))
                                : [...new Set([...prev, ...pageExportable])],
                            )
                          }
                        />
                      </th>
                      <th scope="col" className="px-3 py-3">BL / CE</th>
                      <th scope="col" className="px-3 py-3">Cliente</th>
                      <th scope="col" className="px-3 py-3">Viagem / POD</th>
                      <th scope="col" className="px-3 py-3">Solicitação</th>
                      <th scope="col" className="w-[92px] whitespace-normal px-2 py-3 text-center">T. de Devolução</th>
                      <th scope="col" className="w-[92px] whitespace-normal px-2 py-3 text-center">Procuração</th>
                      <th scope="col" className="w-[92px] whitespace-normal px-2 py-3 text-center">Financeiro</th>
                      <th scope="col" className="w-[92px] whitespace-normal px-2 py-3 text-center">BL de Entrega</th>
                      <th scope="col" className="px-3 py-3">Prazo</th>
                      <th scope="col" className="px-3 py-3">ZPT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.isLoading && (
                      <tr>
                        <td colSpan={COLUMNS} className="p-0">
                          <SkeletonTable rows={8} cols={COLUMNS} label="Carregando BLs" />
                        </td>
                      </tr>
                    )}
                    {list.data && total === 0 && (
                      <tr>
                        <td colSpan={COLUMNS} className="p-0">
                          <EmptyState
                            icon={SearchX}
                            title={filters.situation === DEFAULT_FILTERS.situation && activeFilters === 0 ? "Nenhum BL apto aguardando exportação" : "Nenhum BL encontrado para este filtro"}
                            description="BLs com CE aparecem aqui conforme os quatro requisitos são atendidos."
                            action={activeFilters > 0 ? (
                              <Button variant="secondary" onClick={() => { setFilters(DEFAULT_FILTERS); setPage(1); }}>
                                Limpar filtros
                              </Button>
                            ) : undefined}
                          />
                        </td>
                      </tr>
                    )}
                    {items.map((i) => (
                      <tr key={i.bl_id} className={selected.includes(i.bl_id) ? "bg-[var(--app-blue-soft)]" : undefined}>
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Exportar BL ${i.bl_id}`}
                            disabled={!manage || (!i.can_export && !selected.includes(i.bl_id))}
                            checked={selected.includes(i.bl_id)}
                            onChange={(e) =>
                              setSelected((prev) => (e.target.checked ? [...prev, i.bl_id] : prev.filter((b) => b !== i.bl_id)))
                            }
                          />
                        </td>
                        <td className="px-3 py-3">
                          <span className="app-table__cell-stack">
                            <Link className="font-semibold text-[var(--app-link)] hover:underline" to={`/bls/${encodeURIComponent(i.bl_id)}`}>
                              {i.bl_id}
                            </Link>
                            <span className="app-table__cell-meta whitespace-nowrap">CE {i.ce_mercante ?? "—"}</span>
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="app-table__cell-stack">
                            <Link
                              className="app-table__truncate app-table__truncate--sm text-[var(--app-link)] hover:underline"
                              title={i.customer_name}
                              to={`/clientes/${i.cnpj_cpf}?tab=desbloqueio-ce`}
                            >
                              {i.customer_name}
                            </Link>
                            <span className="app-table__cell-meta flex items-center gap-1.5">
                              {i.cnpj_cpf}
                              {i.vip && <Badge tone="blue">VIP</Badge>}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="app-table__cell-stack">
                            <span className="app-table__truncate app-table__truncate--sm" title={`${i.vessel_name} · ${i.voyage_number}`}>
                              {i.vessel_name} · {i.voyage_number}
                            </span>
                            <span className="app-table__cell-meta">{i.pod ?? "—"}</span>
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="app-table__cell-stack">
                            {i.request_id ? (
                              <button
                                type="button"
                                className="text-left font-semibold text-[var(--app-link)] hover:underline"
                                onClick={() => setRequest(i.request_id)}
                              >
                                {i.protocol}
                              </button>
                            ) : null}
                            <span><Badge tone={ceStateTone(i.state)}>{ceStateLabel(i.state)}</Badge></span>
                            {i.requested_at && <span className="app-table__cell-meta">{ceDateTime(i.requested_at)}</span>}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center"><CeUnlockRequirementIcon label="T. de Devolução" subject={i.bl_id} ok={i.termo} /></td>
                        <td className="px-2 py-3 text-center"><CeUnlockRequirementIcon label="Procuração" subject={i.bl_id} ok={i.procuracao} /></td>
                        <td className="px-2 py-3 text-center"><CeUnlockRequirementIcon label="Financeiro" subject={i.bl_id} ok={i.paid} /></td>
                        <td className="px-2 py-3 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer accent-[var(--app-green)] disabled:cursor-default"
                            aria-label={`BL de Entrega: ${i.bl_id}`}
                            title={manage ? (i.delivered ? "Desmarcar entrega do BL original" : "Registrar entrega do BL original") : undefined}
                            checked={i.delivered}
                            disabled={!manage || command.isPending}
                            onChange={() => void delivery(i)}
                          />
                        </td>
                        <td className="px-3 py-3"><CeUnlockSla start={i.sla_started_at} doneAt={i.exported_at} /></td>
                        <td className="px-3 py-3"><ZptCell i={i} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </QueryStateGate>
            {total > PAGE_SIZE && (
              <TableFooterPagination
                page={page}
                pageSize={PAGE_SIZE}
                totalCount={total}
                totalPages={Math.ceil(total / PAGE_SIZE)}
                onPageChange={setPage}
              />
            )}
          </Card>
        </>
      )}

      <Modal open={manage && panel === "model"} title="Modelo do termo de devolução" onClose={() => setPanel(null)}>
        <div className="space-y-4">
          <p className="text-sm text-[var(--app-muted)]">
            O PDF publicado aqui fica disponível para download no Portal, na tela de solicitação de desbloqueio.
          </p>
          {model.data && <CeUnlockDocumentList documents={[model.data]} />}
          {model.isSuccess && !model.data && (
            <p className="text-sm font-semibold text-[#a85309] dark:text-[var(--app-gold-strong)]">Nenhum modelo publicado: o Portal informa que o modelo ainda não está disponível.</p>
          )}
          <CeUnlockDocumentUploader source="model" model onUploaded={() => afterCeUnlockChanged(client)} />
        </div>
      </Modal>

      <Modal open={manage && panel === "zpt"} title="Conciliar com a ZPT" onClose={() => setPanel(null)}>
        <CeUnlockZptImport />
      </Modal>

      <Modal open={manage && panel === "exports"} title="Histórico ZPT" onClose={() => setPanel(null)}>
        <div className="space-y-4">
          <p className="text-sm text-[var(--app-muted)]">
            Baixar lote devolve o arquivo como foi gerado. Reexportar gera uma nova planilha com os requisitos atuais.
          </p>
          {exports.isLoading && <p className="text-sm text-[var(--app-muted)]">Carregando lotes…</p>}
          {exports.error && <InlineError message="Falha ao consultar lotes." />}
          {exports.data?.length === 0 && <EmptyState icon={History} title="Nenhuma planilha exportada ainda" />}
          {!!exports.data?.length && (
            <div className="app-table-scroll rounded-lg border border-[var(--app-border)]">
              <table className="app-table app-table--compact min-w-[560px] text-left text-sm">
                <caption className="sr-only">Planilhas exportadas para a ZPT</caption>
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">Gerada em</th>
                    <th scope="col" className="px-3 py-2">BLs</th>
                    <th scope="col" className="px-3 py-2"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {exports.data.map((e) => (
                    <tr key={e.id}>
                      <td className="px-3 py-2">{ceDateTime(e.created_at)}</td>
                      <td className="px-3 py-2">
                        <span className="app-table__cell-stack">
                          <span>{e.rows.length} BL(s)</span>
                          <span className="app-table__cell-meta app-table__truncate app-table__truncate--md" title={e.rows.map((r) => r.bl_id).join(", ")}>
                            {e.rows.map((r) => r.bl_id).join(", ")}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            className="app-btn--sm"
                            onClick={() => void downloadCeUnlockExport({ export_id: e.id }).catch((err) => showToast(err instanceof Error ? err.message : "Falha ao baixar lote", "error"))}
                          >
                            <Download size={14} aria-hidden="true" />
                            Baixar lote
                          </Button>
                          <Button
                            variant="ghost"
                            className="app-btn--sm"
                            disabled={exportBusy}
                            onClick={() => void exportSelected(e.rows.map((r) => r.bl_id), e.id)}
                          >
                            Reexportar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={!!id}
        title={request.data ? `Solicitação ${request.data.protocol}` : "Solicitação de desbloqueio"}
        onClose={() => setRequest(null)}
      >
        {request.isLoading ? (
          <p className="text-sm text-[var(--app-muted)]">Carregando solicitação…</p>
        ) : request.error ? (
          <InlineError message="Falha ao consultar a solicitação." />
        ) : (
          request.data && (
            <CeUnlockRequestDetail request={request.data} manage={manage} onAction={act} busy={command.isPending} />
          )
        )}
      </Modal>
    </>
  );
}
