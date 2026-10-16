import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, History, SearchX, X } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useCeUnlock, useCeUnlockRequest, useCeUnlockReviewQueue, useCeUnlockSituationCounts } from "../hooks/useCeUnlock";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { Block } from "../components/ui/Block";
import { Button } from "../components/ui/Button";
import { EmptyState, InlineError, PageHeader } from "../components/ui/Card";
import { CopyValue } from "../components/ui/CopyValue";
import { FilterBar } from "../components/ui/FilterBar";
import { Field, Input, Select } from "../components/ui/Input";
import { MetricCard } from "../components/ui/MetricCard";
import { Modal } from "../components/ui/Modal";
import { NoValue } from "../components/ui/NoValue";
import { SkeletonTable } from "../components/ui/Skeleton";
import { StatusText } from "../components/ui/StatusText";
import { TabButton } from "../components/ui/TabButton";
import { TabList } from "../components/ui/TabList";
import { TableFooterPagination } from "../components/ui/TableFooterPagination";
import { useToast } from "../components/ui/Toast";
import { QueryStateGate } from "../components/shared/QueryStateGate";
import { VoyageCombobox } from "../components/shared/VoyageCombobox";
import { useConfirm, useConfirmWithReason } from "../components/ui/ConfirmDialog";
import { CeUnlockRequestDetail } from "../components/ce-unlock/CeUnlockRequestDetail";
import { CeUnlockDocumentList, CeUnlockDocumentUploader } from "../components/ce-unlock/CeUnlockDocuments";
import { CeUnlockReviewQueue } from "../components/ce-unlock/CeUnlockReviewQueue";
import { CeUnlockRequirementIcon, CeUnlockZptState } from "../components/ce-unlock/CeUnlockRequirements";
import { CeUnlockSla } from "../components/ce-unlock/CeUnlockSla";
import { CeUnlockZptImport } from "../components/ce-unlock/CeUnlockZptImport";
import { ceDateTime } from "../lib/ceUnlockLabels";
import {
  ceUnlockCommand,
  ceUnlockRead,
  downloadCeUnlockExport,
  fetchAllCeUnlockBls,
  listCeUnlockExports,
} from "../services/ceUnlockService";
import { exportCeUnlockWorkbook } from "../services/exports";
import { afterCeUnlockChanged } from "../services/cacheEffects";
import type { CeUnlockDocument, CeUnlockFilters, CeUnlockItem } from "../types/ceUnlock";

type Tab = "solicitacoes" | "controle";
type Panel = "model" | "zpt" | "exports" | null;
const PAGE_SIZE = 25;
const EXPORT_LIMIT = 100;
// A aba abre com todos os B/Ls com CE; "Aptos, não exportados" é a fila de exportação.
const DEFAULT_FILTERS: CeUnlockFilters = { situation: "" };
const SITUATIONS: Array<[string, string]> = [
  ["", "Todas"],
  ["ready_not_exported", "Aptos, não exportados"],
  ["exported", "Exportados, aguardando a ZPT"],
  ["divergent", "Divergentes na ZPT"],
  ["unlocked", "Desbloqueados"],
  ["no_request", "Sem solicitação"],
  ["submitted", "Enviado"],
  ["in_review", "Em análise"],
  ["changes_requested", "Correção solicitada"],
  ["ready", "Aptos (inclui exportados)"],
  ["completed", "Documentação validada"],
];
const CARDS: Array<[string, string]> = [
  ["ready_not_exported", "Aptos, não exportados"],
  ["exported", "Exportados, aguardando a ZPT"],
  ["divergent", "Divergentes na ZPT"],
  ["unlocked", "Desbloqueados"],
  ["", "B/Ls com CE"],
];
const COLUMNS = 11;

const bls = (n: number) => (n === 1 ? "1 B/L" : `${n} B/Ls`);
const aptos = (n: number) => (n === 1 ? "1 apto" : `${n} aptos`);

export function DesbloqueioCe() {
  const { can } = useAuth();
  const read = can("ce_unlock_read");
  const manage = can("ce_unlock_manage");
  const [params, setParams] = useSearchParams();
  const id = params.get("pedido");
  const tab: Tab = params.get("aba") === "controle" ? "controle" : "solicitacoes";
  const [filters, setFilters] = useState<CeUnlockFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  // A seleção guarda o B/L inteiro: atravessa páginas e ainda sabe se é apto e se tem a entrega.
  const [selection, setSelection] = useState<Map<string, CeUnlockItem>>(new Map());
  const [panel, setPanel] = useState<Panel>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const keys = useRef(new Map<string, string>());
  // Busca e POD só consultam depois da pausa na digitação: cada leitura recalcula a situação de todos os
  // B/Ls com CE, e os cartões fazem mais quatro.
  const search = useDebouncedValue(filters.search ?? "");
  const pod = useDebouncedValue(filters.pod ?? "");
  const queryFilters = useMemo(() => ({ ...filters, search, pod }), [filters, search, pod]);
  const { list, command } = useCeUnlock(queryFilters, page, read && tab === "controle");
  const queueCount = useCeUnlockReviewQueue(1, read);
  const counts = useCeUnlockSituationCounts(queryFilters, CARDS.map(([s]) => s), read && tab === "controle");
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
  const moreFilters = filters.pending_requirement ? 1 : 0;
  const openFilters =
    (["search", "pod", "voyage_id"] as const).filter((k) => !!filters[k]).length +
    (filters.situation !== DEFAULT_FILTERS.situation ? 1 : 0);
  const activeFilters = openFilters + moreFilters;
  // A linha da página atual é a versão mais recente do B/L selecionado; fora dela vale a cópia guardada,
  // que a entrega registrada ou desmarcada nesta tela renova com o B/L devolvido pelo comando.
  const current = new Map(items.map((i) => [i.bl_id, i]));
  const selected = [...selection.values()].map((i) => current.get(i.bl_id) ?? i);
  const selectedReady = selected.filter((i) => i.can_export);
  const selectedUndelivered = selected.filter((i) => !i.delivered);
  const allPageSelected = items.length > 0 && items.every((i) => selection.has(i.bl_id));

  function filter(key: keyof CeUnlockFilters, value: string | number | undefined) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }
  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }
  function toggle(i: CeUnlockItem, on: boolean) {
    setSelection((prev) => {
      const next = new Map(prev);
      if (on) next.set(i.bl_id, i);
      else next.delete(i.bl_id);
      return next;
    });
  }
  function togglePage() {
    setSelection((prev) => {
      const next = new Map(prev);
      for (const i of items) {
        if (allPageSelected) next.delete(i.bl_id);
        else next.set(i.bl_id, i);
      }
      return next;
    });
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
  function refreshSelected(i: CeUnlockItem, updated: unknown) {
    if (!updated || typeof updated !== "object") return;
    setSelection((prev) => (prev.has(i.bl_id) ? new Map(prev).set(i.bl_id, { ...i, ...(updated as Partial<CeUnlockItem>) }) : prev));
  }
  async function delivery(i: CeUnlockItem) {
    let reason: string | null = null;
    if (i.delivered) {
      reason = await reasonDialog({
        message: `Desmarcar a entrega do B/L original ${i.bl_id}?`,
        consequence: "O B/L deixa de atender o requisito B/L original e não pode ser exportado.",
        reversibility: "A entrega pode ser registrada novamente.",
        confirmLabel: "Desmarcar entrega",
        tone: "danger",
      });
      if (!reason) return;
    } else if (
      !(await confirm({
        message: `Registrar o recebimento do B/L original ${i.bl_id}?`,
        consequence: "O requisito B/L original passa a atendido e o prazo do cliente recomeça a partir de agora.",
        reversibility: "Uma marcação incorreta pode ser desfeita com motivo.",
        confirmLabel: "Registrar entrega",
      }))
    )
      return;
    try {
      const updated = await act("delivery", { bl_id: i.bl_id, delivered: !i.delivered, expected_version: i.delivery_version, reason });
      refreshSelected(i, updated);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao registrar entrega", "error");
    }
  }
  async function deliverSelected() {
    const targets = selectedUndelivered;
    if (
      !targets.length ||
      !(await confirm({
        message: `Registrar a entrega do B/L original de ${bls(targets.length)}?`,
        affected: { summary: bls(targets.length), items: targets.map((i) => i.bl_id) },
        consequence: "O requisito B/L original passa a atendido nestes B/Ls e o prazo do cliente recomeça a partir de agora. Os que já têm a entrega ficam de fora.",
        reversibility: "Uma marcação incorreta pode ser desfeita com motivo, um B/L por vez.",
        confirmLabel: `Registrar entrega de ${bls(targets.length)}`,
      }))
    )
      return;
    setDeliveryBusy(true);
    const failed: string[] = [];
    let saved = 0;
    // ponytail: um comando 'delivery' por B/L, em sequência; não é atômico (uma falha no meio
    // deixa os anteriores gravados, e o relatório diz quais falharam). Upgrade: uma ação em lote
    // no ce_unlock_command que grave todos na mesma transação.
    for (const i of targets) {
      const payload = { bl_id: i.bl_id, delivered: true, expected_version: i.delivery_version, reason: null };
      const k = keyFor("delivery", payload);
      try {
        await ceUnlockCommand("delivery", { ...payload, request_key: k.key });
        keys.current.delete(k.text);
        saved++;
      } catch (e) {
        failed.push(`${i.bl_id}: ${e instanceof Error ? e.message : "falha"}`);
      }
    }
    await afterCeUnlockChanged(client);
    setDeliveryBusy(false);
    if (saved) showToast(`Entrega registrada em ${bls(saved)}.`, "success");
    if (failed.length) showToast(`Não gravou em ${bls(failed.length)}: ${failed.join("; ")}`, "error");
    setSelection((prev) => {
      const next = new Map(prev);
      for (const i of targets) if (!failed.some((f) => f.startsWith(`${i.bl_id}:`))) next.delete(i.bl_id);
      return next;
    });
  }
  async function exportSelected(blIds = selectedReady.map((i) => i.bl_id), reexportOf?: string) {
    if (
      !(await confirm({
        message: `${reexportOf ? "Reexportar" : "Exportar"} ${bls(blIds.length)} para a ZPT?`,
        affected: { summary: bls(blIds.length), items: blIds },
        consequence: "A planilha é baixada e o envio fica registrado nestes B/Ls. O desbloqueio acontece quando ela for importada na ZPT.",
        reversibility: "B/L recusado pela ZPT aparece como divergente após a conciliação e pode ser reexportado.",
        confirmLabel: reexportOf ? "Reexportar" : "Exportar para a ZPT",
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
      if (!reexportOf)
        setSelection((prev) => {
          const next = new Map(prev);
          for (const b of blIds) next.delete(b);
          return next;
        });
      showToast(`Planilha gerada com ${bls(blIds.length)}. Importe-a na aba "Planilha desbloqueio" da ZPT.`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao exportar", "error");
    } finally {
      setExportBusy(false);
    }
  }
  async function exportSheet() {
    setSheetBusy(true);
    try {
      await exportCeUnlockWorkbook(await fetchAllCeUnlockBls(queryFilters));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao exportar a planilha", "error");
    } finally {
      setSheetBusy(false);
    }
  }
  if (!read) return <EmptyState title="Acesso não autorizado" description="Seu perfil não consulta o Desbloqueio de CE." />;
  return (
    <>
      <PageHeader title="Desbloqueio de CE" />
      <TabList label="Seções do Desbloqueio de CE">
        <TabButton
          active={tab === "solicitacoes"}
          label="Solicitações"
          count={queueCount.data?.total ?? null}
          countLabel={queueCount.data ? `${queueCount.data.total} aguardando análise` : undefined}
          onClick={() => openTab("solicitacoes")}
        />
        <TabButton active={tab === "controle"} label="Andamento dos B/Ls" onClick={() => openTab("controle")} />
      </TabList>
      {tab === "solicitacoes" ? (
        <CeUnlockReviewQueue enabled={read} onOpen={setRequest} onOpenModel={manage ? () => setPanel("model") : undefined} />
      ) : (
        <>
          <div className="app-metric-row" role="group" aria-label="Situação dos B/Ls do recorte">
            {CARDS.map(([value, label]) => {
              const count = counts[value];
              return (
                <MetricCard
                  key={value || "all"}
                  label={label}
                  value={count ?? <NoValue label="Carregando" />}
                  tone={value === "divergent" && (count ?? 0) > 0 ? "warning" : "secondary"}
                  selected={(filters.situation ?? "") === value}
                  onSelect={() => filter("situation", (filters.situation ?? "") === value ? "" : value)}
                />
              );
            })}
          </div>

          <div className="app-filter-grid">
            <Field label="Buscar">
              <Input
                placeholder="B/L, CE ou Cliente"
                value={filters.search ?? ""}
                onChange={(e) => filter("search", e.target.value)}
              />
            </Field>
            <Field label="Situação">
              <Select value={filters.situation ?? ""} onChange={(e) => filter("situation", e.target.value)}>
                {SITUATIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <VoyageCombobox
              clearable
              label="Viagem"
              selectedVoyageId={filters.voyage_id}
              onSelect={(next) => filter("voyage_id", next ?? undefined)}
            />
            <Field label="POD">
              <Input value={filters.pod ?? ""} onChange={(e) => filter("pod", e.target.value)} />
            </Field>
            {openFilters > 0 && moreFilters === 0 ? (
              <div><Button variant="ghost" onClick={clearFilters}>Limpar filtros</Button></div>
            ) : null}
          </div>
          <FilterBar title="Mais filtros" activeCount={moreFilters} onClear={clearFilters}>
            <div className="app-filter-grid">
              <Field label="Requisito pendente">
                <Select value={filters.pending_requirement ?? ""} onChange={(e) => filter("pending_requirement", e.target.value)}>
                  <option value="">Todos</option>
                  <option value="termo">Termo de devolução</option>
                  <option value="procuracao">Procuração</option>
                  <option value="taxas">Taxas locais</option>
                  <option value="bl_fisico">B/L original</option>
                </Select>
              </Field>
            </div>
          </FilterBar>

          <Block
            title="B/Ls com CE Mercante"
            flush
            aside={
              <>
                {list.data ? <span>{bls(total)}</span> : null}
                <Button
                  variant="secondary"
                  className="app-btn--sm"
                  loading={sheetBusy}
                  loadingLabel="Exportando…"
                  disabled={!list.data || total === 0}
                  onClick={() => void exportSheet()}
                >
                  <Download size={14} aria-hidden="true" />
                  Exportar planilha
                </Button>
                {manage && (
                  <>
                    <Button variant="secondary" className="app-btn--sm" onClick={() => setPanel("exports")}>
                      <History size={14} aria-hidden="true" />
                      Planilhas enviadas à ZPT
                    </Button>
                    <Button variant="secondary" className="app-btn--sm" onClick={() => setPanel("zpt")}>
                      <FileSpreadsheet size={14} aria-hidden="true" />
                      Conciliar com a ZPT
                    </Button>
                    <Button
                      className="app-btn--sm"
                      disabled={!selectedReady.length || selectedReady.length > EXPORT_LIMIT || command.isPending || deliveryBusy}
                      title={selectedReady.length ? undefined : "Selecione B/Ls aptos para exportar"}
                      loading={exportBusy}
                      loadingLabel="Exportando…"
                      onClick={() => void exportSelected()}
                    >
                      {selectedReady.length ? `Exportar ${aptos(selectedReady.length)} para a ZPT` : "Exportar aptos para a ZPT"}
                    </Button>
                  </>
                )}
              </>
            }
          >
            {manage && selected.length > 0 && (
              <div className="app-block__body">
                <div className="app-bulk-bar" role="region" aria-label="Seleção">
                  <span className="app-bulk-bar__count" aria-live="polite">
                    {selected.length === 1 ? "1 selecionado" : `${selected.length} selecionados`}
                    {" · "}
                    {selectedReady.length === 1 ? "1 apto" : `${selectedReady.length} aptos`} para a ZPT
                    {" · "}
                    {selectedUndelivered.length} sem a entrega do B/L original
                    {selectedReady.length > EXPORT_LIMIT ? (
                      <>
                        {" · "}
                        <StatusText tone="danger">máximo de {EXPORT_LIMIT} B/Ls por planilha</StatusText>
                      </>
                    ) : null}
                  </span>
                  <div className="app-bulk-bar__actions">
                    {selectedUndelivered.length > 0 && (
                      <Button
                        variant="secondary"
                        loading={deliveryBusy}
                        loadingLabel="Registrando…"
                        disabled={command.isPending || exportBusy}
                        onClick={() => void deliverSelected()}
                      >
                        Registrar entrega de {bls(selectedUndelivered.length)}
                      </Button>
                    )}
                    <Button variant="ghost" disabled={deliveryBusy} onClick={() => setSelection(new Map())}>
                      <X size={15} aria-hidden="true" />
                      Limpar seleção
                    </Button>
                  </div>
                </div>
              </div>
            )}
            <QueryStateGate
              isLoading={false}
              isError={Boolean(list.error)}
              hasData={list.data !== undefined}
              errorMessage="Falha ao consultar B/Ls."
              onRetry={() => void list.refetch?.()}
            >
              <div className="app-table-scroll app-table-scroll--sticky">
                <table className="app-table app-table--compact whitespace-nowrap text-sm">
                  <caption className="sr-only">Requisitos de desbloqueio de cada B/L</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="w-10">
                        <input
                          type="checkbox"
                          aria-label="Selecionar os B/Ls da página"
                          disabled={!manage || !items.length}
                          checked={allPageSelected}
                          onChange={togglePage}
                        />
                      </th>
                      <th scope="col">B/L</th>
                      <th scope="col">CE Mercante</th>
                      <th scope="col" className="app-table__text-head">Cliente</th>
                      <th scope="col">Solicitação</th>
                      <th scope="col">Termo de devolução</th>
                      <th scope="col">Procuração</th>
                      <th scope="col">Taxas locais</th>
                      <th scope="col">B/L original</th>
                      <th scope="col">Prazo</th>
                      <th scope="col" className="app-table__text-head">Na ZPT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.isLoading && (
                      <tr>
                        <td colSpan={COLUMNS} className="p-0">
                          <SkeletonTable rows={8} cols={COLUMNS} label="Carregando B/Ls" />
                        </td>
                      </tr>
                    )}
                    {list.data && total === 0 && (
                      <tr>
                        <td colSpan={COLUMNS} className="p-0">
                          <EmptyState
                            icon={SearchX}
                            title={activeFilters === 0 ? "Nenhum B/L com CE Mercante" : "Nenhum B/L encontrado para este filtro"}
                            description="B/Ls com CE aparecem aqui conforme os quatro requisitos são atendidos."
                            action={activeFilters > 0 ? (
                              <Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button>
                            ) : undefined}
                          />
                        </td>
                      </tr>
                    )}
                    {items.map((i) => (
                      <tr key={i.bl_id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Selecionar B/L ${i.bl_id}`}
                            disabled={!manage}
                            checked={selection.has(i.bl_id)}
                            onChange={(e) => toggle(i, e.target.checked)}
                          />
                        </td>
                        <td>
                          <CopyValue value={i.bl_id} label="número do B/L">
                            <Link className="app-link" to={`/bls/${encodeURIComponent(i.bl_id)}`}>{i.bl_id}</Link>
                          </CopyValue>
                        </td>
                        <td>{i.ce_mercante ? <CopyValue value={i.ce_mercante} label="CE Mercante" /> : <NoValue label="Sem CE Mercante" />}</td>
                        <td className="app-table__text">
                          {i.customer_name ? (
                            <Link
                              className="app-link app-table__truncate max-w-[110px]"
                              title={i.customer_name}
                              to={`/clientes/${i.cnpj_cpf}?tab=desbloqueio-ce`}
                            >
                              {i.customer_name}
                            </Link>
                          ) : (
                            <NoValue label="Sem Cliente" />
                          )}
                          {i.vip && <span className="app-table__cell-meta" title="Documentos anuais VIP"> VIP</span>}
                        </td>
                        <td>
                          {i.request_id ? (
                            <button
                              type="button"
                              className="app-link"
                              aria-label={`Abrir solicitação ${i.protocol}`}
                              onClick={() => setRequest(i.request_id)}
                            >
                              {i.protocol}
                            </button>
                          ) : (
                            <StatusText tone="muted">Sem solicitação</StatusText>
                          )}
                        </td>
                        <td><CeUnlockRequirementIcon label="Termo de devolução" subject={i.bl_id} ok={i.termo} /></td>
                        <td><CeUnlockRequirementIcon label="Procuração" subject={i.bl_id} ok={i.procuracao} /></td>
                        <td><CeUnlockRequirementIcon label="Taxas locais" subject={i.bl_id} ok={i.paid} /></td>
                        <td>
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer accent-[var(--app-green)] disabled:cursor-default"
                            aria-label={`B/L original: ${i.bl_id}`}
                            title={manage ? (i.delivered ? "Desmarcar entrega do B/L original" : "Registrar entrega do B/L original") : undefined}
                            checked={i.delivered}
                            disabled={!manage || command.isPending || deliveryBusy}
                            onChange={() => void delivery(i)}
                          />
                        </td>
                        <td><CeUnlockSla start={i.sla_started_at} doneAt={i.exported_at} /></td>
                        <td className="app-table__text"><span className="app-table__truncate max-w-[100px]"><CeUnlockZptState item={i} /></span></td>
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
          </Block>
        </>
      )}

      <Modal open={manage && panel === "model"} title="Modelo do termo de devolução" onClose={() => setPanel(null)}>
        <div className="space-y-4">
          <p className="text-sm text-[var(--app-muted)]">
            O DOCX publicado aqui fica disponível para download no Portal, na tela de solicitação de desbloqueio. O cliente preenche, assina e anexa o termo em PDF.
          </p>
          {model.data && <CeUnlockDocumentList documents={[model.data]} />}
          {model.isSuccess && !model.data && (
            <p className="text-sm">
              <StatusText tone="warning">Nenhum modelo publicado: o Portal informa que o modelo ainda não está disponível.</StatusText>
            </p>
          )}
          <CeUnlockDocumentUploader source="model" model onUploaded={() => afterCeUnlockChanged(client)} />
        </div>
      </Modal>

      <Modal open={manage && panel === "zpt"} title="Conciliar com a ZPT" onClose={() => setPanel(null)}>
        <CeUnlockZptImport />
      </Modal>

      <Modal open={manage && panel === "exports"} title="Planilhas enviadas à ZPT" onClose={() => setPanel(null)}>
        <div className="space-y-4">
          <p className="text-sm text-[var(--app-muted)]">
            Baixar lote devolve o arquivo como foi gerado. Reexportar gera uma nova planilha com os requisitos atuais.
          </p>
          {exports.isLoading && <p className="text-sm text-[var(--app-muted)]">Carregando lotes…</p>}
          {exports.error && <InlineError message="Falha ao consultar lotes." />}
          {exports.data?.length === 0 && <EmptyState icon={History} title="Nenhuma planilha exportada ainda" />}
          {!!exports.data?.length && (
            <div className="app-table-scroll rounded-lg border border-[var(--app-border)]">
              <table className="app-table app-table--compact min-w-[560px] text-sm">
                <caption className="sr-only">Planilhas enviadas à ZPT</caption>
                <thead>
                  <tr>
                    <th scope="col">Gerada em</th>
                    <th scope="col" className="app-table__text-head">B/Ls</th>
                    <th scope="col"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {exports.data.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap">{ceDateTime(e.created_at)}</td>
                      <td className="app-table__text">
                        <span className="app-table__cell-stack">
                          <span>{bls(e.rows.length)}</span>
                          <span className="app-table__cell-meta app-table__truncate app-table__truncate--md" title={e.rows.map((r) => r.bl_id).join(", ")}>
                            {e.rows.map((r) => r.bl_id).join(", ")}
                          </span>
                        </span>
                      </td>
                      <td>
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
