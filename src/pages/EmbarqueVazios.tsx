import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Download, MessageSquare, Pencil, Plus, Settings, Trash2, Upload } from "lucide-react";
import { Block, Fact, FactList } from "../components/ui/Block";
import { Button } from "../components/ui/Button";
import { CopyValue } from "../components/ui/CopyValue";
import { NoValue } from "../components/ui/NoValue";
import { EmptyState, PageHeader } from "../components/ui/Card";
import { IdentityBand } from "../components/ui/IdentityBand";
import { Modal } from "../components/ui/Modal";
import { RowActionButton } from "../components/ui/RowActionButton";
import { SkeletonTable } from "../components/ui/Skeleton";
import { StatusText } from "../components/ui/StatusText";
import { TabButton } from "../components/ui/TabButton";
import { TabList } from "../components/ui/TabList";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { QueryStateGate } from "../components/shared/QueryStateGate";
import { VoyageCombobox } from "../components/shared/VoyageCombobox";
import { ImportFilePicker, ImportNotice } from "../components/shared/ImportParts";
import { PreviousImportCheck } from "../components/shared/PreviousImportCheck";
import { importFilesSha256 } from "../services/importFileReceipt";
import { useAuth } from "../hooks/useAuth";
import { useDepots } from "../hooks/useDepots";
import { useToast } from "../components/ui/Toast";
import { useConfirm, useConfirmWithReason } from "../components/ui/ConfirmDialog";
import {
  getVaziosExportOperation,
  upsertServiceLine,
  openOrCreateVaziosExportOperation,
  deleteServiceLine,
  updateServiceLineObservation,
  listVaziosBookingsForOperation,
  listVaziosExportOperationsWithUnits,
  summarizeVaziosOperations,
  createManualVaziosBooking,
  updateManualVaziosBooking,
  deleteManualVaziosBooking,
  isVaziosExportLockedByAdr,
  type VaziosOperationSummary,
} from "../services/vaziosExportOperations";
import { queryKeys } from "../services/queryKeys";
import {
  importVaziosManifest,
  parseVaziosManifestFile,
  type ParsedVaziosManifest,
} from "../services/vaziosImport";
import {
  listArmazenagemServices,
  listCurrentDepotServices,
  valorSugerido,
  type DepotWithPort,
} from "../services/depots";
import { listVoyageRoutePorts } from "../services/operationalLists";
import { listVoyageEscalaSchedulesByVoyageIds } from "../services/voyageRouteSchedules";
import { normalizePortCode } from "../services/portCode";
import {
  armazenagemALancar,
  quantidadeEfetiva,
  totalEmbarque,
  veto,
} from "../services/vaziosCusto";
import type { DepotService, VaziosBooking, VaziosExportServiceLine } from "../types/database";
import { formatBRL, formatDate, normalizeText, voyageLabel } from "../lib/utils";
import { condicaoLabel, diasLabel, naturezaServicoLabel } from "../lib/vaziosLabels";
import { classifyDbError, importErrorMessage } from "../lib/errors";
import { invalidateAgencyReportForVoyage } from "../services/agencyReportInvalidation";

type Tab = "unidades" | "servicos";

type OperationRef = { id: string; voyage_id: number; embark_port: string };

type UnitForm = {
  id: string;
  containerNumber: string;
  containerType: string;
  localId: string;
  condition: "vazio" | "material";
  handInDate: string;
  handOutDate: string;
  movementDate: string;
};

const EMPTY_UNIT: UnitForm = {
  id: "",
  containerNumber: "",
  containerType: "",
  localId: "",
  condition: "vazio",
  handInDate: "",
  handOutDate: "",
  movementDate: "",
};

const EMPTY_LINE = {
  serviceId: "",
  localId: "",
  destinoId: "",
  condition: "",
  quantidade: 0,
  valor: 0,
  valorSugerido: null as number | null,
  quantidadeManual: false,
};

const OPERATIONS_KEY = ["vazios-export-operations"] as const;

function operationLabel(item: Pick<VaziosOperationSummary, "voyage" | "voyage_id">): string {
  return voyageLabel(item.voyage?.vessel?.name, item.voyage?.voyage_number, item.voyage_id);
}

/**
 * Pergunta da confirmação quando a planilha tem linhas ou abas ocultas: o
 * leitor as ignora (ADR 0078, item 22; a planilha filtrada por depot é o caso
 * comum) e a importação substitui a lista da escala, então as unidades delas
 * saem do Embarque. `null` quando nada ficou oculto.
 */
function hiddenUnitsQuestion(hidden: ParsedVaziosManifest["hidden"]): string | null {
  const parts: string[] = [];
  if (hidden.rows > 0) {
    parts.push(
      hidden.rows === 1
        ? "1 linha oculta foi ignorada e as unidades dela sairão do Embarque."
        : `${hidden.rows} linhas ocultas foram ignoradas e as unidades delas sairão do Embarque.`,
    );
  }
  if (hidden.sheets.length) {
    const names = hidden.sheets.map((name) => `"${name}"`).join(", ");
    parts.push(
      hidden.sheets.length === 1
        ? `A aba oculta ${names} foi ignorada; se ela tiver unidades, elas sairão do Embarque.`
        : `As abas ocultas ${names} foram ignoradas; se elas tiverem unidades, elas sairão do Embarque.`,
    );
  }
  return parts.length ? `${parts.join(" ")} Continuar?` : null;
}

/** "40HC 4 · 40FR 2", do mais frequente para o menos. */
function countText<T>(rows: T[], keyOf: (row: T) => string): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .map(([label, count]) => `${label} ${count}`)
    .join(" · ");
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count.toLocaleString("pt-BR")} ${count === 1 ? singular : pluralForm}`;
}

// B10 (ADR 0035): o Porto de embarque é escolhido entre as escalas da viagem
// (a mesma projeção da aba Escalas), inclusive escala planejada sem B/L —
// viagem só de embarque de vazios não tem B/L. Os portos dos B/Ls entram como
// complemento, para escala de B/L ainda não materializada na projeção.
async function fetchVoyageEscalaPorts(voyageId: number): Promise<string[]> {
  const [escalas, blPorts] = await Promise.all([
    listVoyageEscalaSchedulesByVoyageIds([voyageId]),
    listVoyageRoutePorts(voyageId),
  ]);
  const ports = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const code = normalizePortCode(raw);
    if (code && code.startsWith("BR")) ports.add(code);
  };
  // Porto só de escala omitida/excluída não volta pelos portos dos B/Ls.
  const removed = new Set<string>();
  for (const escala of escalas.get(voyageId) ?? []) {
    if (!escala.deleted && !escala.omitted) add(escala.port);
    else {
      const code = normalizePortCode(escala.port);
      if (code) removed.add(code);
    }
  }
  for (const raw of blPorts) {
    const code = normalizePortCode(raw);
    if (code && removed.has(code) && !ports.has(code)) continue;
    add(raw);
  }
  return [...ports].sort();
}

export function EmbarqueVazios() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const canEdit = Boolean(profile || user);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("embarque");
  const queryVoyageId = Number(searchParams.get("voyage"));
  // B26 (ADR 0018, decisão 2): aberto pela viagem, a lista e o "Novo embarque" vêm com ela; ambos editáveis.
  const contextVoyageId = Number.isInteger(queryVoyageId) && queryVoyageId > 0 ? queryVoyageId : null;

  const operations = useQuery({ queryKey: OPERATIONS_KEY, queryFn: listVaziosExportOperationsWithUnits });
  const depots = useDepots();
  const depotRows = useMemo(() => (Array.isArray(depots.data) ? depots.data : []), [depots.data]);
  const summaries = useMemo(
    () => (operations.data ? summarizeVaziosOperations(operations.data.operations, operations.data.bookings, depotRows) : []),
    [operations.data, depotRows],
  );

  function withParams(current: URLSearchParams, changes: Record<string, string | null>) {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) {
      if (value == null) next.delete(key);
      else next.set(key, value);
    }
    return next;
  }

  function updateParams(changes: Record<string, string | null>) {
    setSearchParams((current) => withParams(current, changes));
  }

  // Sem os Locais, a armazenagem a lançar, o total de Serviços e o local de
  // cada unidade sairiam incompletos ("Local removido") sem aviso: lista e
  // detalhe esperam as duas leituras e mostram a falha de qualquer uma.
  const readState = {
    isLoading: operations.isLoading || depots.isLoading,
    error: operations.error ?? depots.error,
    fetchStatus: operations.fetchStatus === "paused" || depots.fetchStatus === "paused" ? "paused" : "idle",
    data: operations.data !== undefined && depots.data !== undefined ? operations.data : undefined,
    errorMessage: operations.error ? undefined : "Não foi possível carregar os locais (depots e terminais): sem eles a armazenagem e o local das unidades não aparecem.",
    refetch: () => {
      if (operations.error || operations.data === undefined) void operations.refetch();
      if (depots.error || depots.data === undefined) void depots.refetch();
    },
  };

  const selected = selectedId && depots.data !== undefined ? summaries.find((item) => item.id === selectedId) ?? null : null;

  if (selectedId) {
    if (selected) {
      return (
        <EmbarqueDetalhe
          key={selected.id}
          operation={selected}
          depotRows={depotRows}
          canEdit={canEdit}
          tab={searchParams.get("aba") === "servicos" ? "servicos" : "unidades"}
          onTab={(tab) => updateParams({ aba: tab === "servicos" ? "servicos" : null })}
          onBack={() => updateParams({ embarque: null, aba: null })}
          onChanged={() => queryClient.invalidateQueries({ queryKey: OPERATIONS_KEY })}
        />
      );
    }
    return (
      <div className="grid gap-5">
        <PageHeader title="Embarque de vazios" />
        <QueryStateGate
          isLoading={readState.isLoading}
          isError={Boolean(readState.error)}
          isPaused={readState.fetchStatus === "paused"}
          hasData={readState.data !== undefined}
          errorMessage={readState.errorMessage ?? "Não foi possível carregar o embarque."}
          onRetry={readState.refetch}
          loadingFallback={<SkeletonTable rows={4} cols={4} label="Carregando o embarque" />}
        >
          <EmptyState
            title="Embarque não encontrado"
            description="O embarque deste endereço não existe mais ou foi removido com a viagem."
            action={<Button variant="secondary" onClick={() => updateParams({ embarque: null, aba: null })}>Todos os embarques</Button>}
          />
        </QueryStateGate>
      </div>
    );
  }

  return (
    <EmbarquesLista
      summaries={summaries}
      operations={readState}
      canEdit={canEdit}
      contextVoyageId={contextVoyageId}
      onClearVoyage={() => updateParams({ voyage: null })}
      onOpen={(id) => updateParams({ embarque: id, aba: null })}
      openHref={(id) => `/embarquevazios?${withParams(searchParams, { embarque: id, aba: null }).toString()}`}
      onCreated={() => queryClient.invalidateQueries({ queryKey: OPERATIONS_KEY })}
    />
  );
}

function EmbarquesLista({
  summaries,
  operations,
  canEdit,
  contextVoyageId,
  onClearVoyage,
  onOpen,
  openHref,
  onCreated,
}: {
  summaries: VaziosOperationSummary[];
  operations: { isLoading: boolean; error: unknown; fetchStatus: string; data: unknown; errorMessage?: string; refetch: () => unknown };
  canEdit: boolean;
  contextVoyageId: number | null;
  onClearVoyage: () => void;
  onOpen: (id: string) => void;
  /** Endereço do detalhe, com os mesmos parâmetros que `onOpen` mantém (?voyage=). */
  openHref: (id: string) => string;
  onCreated: () => Promise<unknown>;
}) {
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [portFilter, setPortFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [voyageId, setVoyageId] = useState<number | null>(contextVoyageId);
  const [port, setPort] = useState("");
  const [creating, setCreating] = useState(false);

  const voyagePorts = useQuery({
    queryKey: ["embarque-vazios-voyage-ports", voyageId],
    queryFn: () => fetchVoyageEscalaPorts(voyageId!),
    enabled: Boolean(voyageId && newOpen),
  });
  const voyagePortOptions = Array.isArray(voyagePorts.data) ? voyagePorts.data : [];

  const portOptions = [...new Set(summaries.map((item) => item.embark_port))].sort();
  const term = normalizeText(search);
  const visible = summaries.filter((item) =>
    (!contextVoyageId || item.voyage_id === contextVoyageId)
    && (!portFilter || item.embark_port === portFilter)
    && (!term || normalizeText(operationLabel(item)).includes(term)),
  );
  const contextLabel = contextVoyageId
    ? (summaries.find((item) => item.voyage_id === contextVoyageId)
      ? operationLabel(summaries.find((item) => item.voyage_id === contextVoyageId)!)
      : "escolhida")
    : null;
  const hasFilters = Boolean(term || portFilter || contextVoyageId);

  function clearFilters() {
    setSearch("");
    setPortFilter("");
    if (contextVoyageId) onClearVoyage();
  }

  // Cada abertura começa da Viagem do endereço naquele momento, sem o porto
  // escolhido numa abertura anterior.
  function openNew() {
    setVoyageId(contextVoyageId);
    setPort("");
    setNewOpen(true);
  }

  function closeNew() {
    setNewOpen(false);
    setPort("");
  }

  async function createOperation() {
    // Gravar sempre normalizado, mesmo vindo da lista de escalas já normalizadas.
    const embarkPort = normalizePortCode(port);
    if (!voyageId || !embarkPort) return;
    setCreating(true);
    try {
      const result = await openOrCreateVaziosExportOperation({ voyageId, embarkPort });
      await onCreated();
      closeNew();
      // V4: o embarque que já existia é aberto, com a mensagem certa.
      showToast(result.created ? "Embarque criado." : "Este embarque já existia e foi aberto.", result.created ? "success" : "info");
      onOpen(result.id);
    } catch (error) {
      showToast(classifyDbError(error).message, "error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Embarque de vazios"
        description="Um embarque por escala: unidades importadas como fato e serviços lançados manualmente."
        action={
          <div className="flex flex-wrap gap-2">
            <Link className="app-btn app-btn--secondary" to="/embarquevazios/depots">
              Locais (depots e terminais)
            </Link>
            {canEdit ? (
              <Button onClick={openNew}>
                <Plus size={16} aria-hidden="true" /> Novo embarque
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="app-filter-grid">
        <Field label="Busca">
          <Input type="search" placeholder="Navio ou viagem" value={search} onChange={(event) => setSearch(event.target.value)} />
        </Field>
        <Field label="Porto de embarque">
          <Select value={portFilter} onChange={(event) => setPortFilter(event.target.value)}>
            <option value="">Todos</option>
            {portOptions.map((code) => <option key={code} value={code}>{code}</option>)}
          </Select>
        </Field>
        {hasFilters ? <div><Button variant="ghost" onClick={clearFilters}>Limpar filtros</Button></div> : null}
      </div>
      {contextLabel ? <p className="text-xs text-[var(--app-muted)]">Filtros ativos: Viagem {contextLabel}</p> : null}

      <Block
        title="Embarques"
        aside={operations.data !== undefined && !operations.error ? `${plural(visible.length, "embarque", "embarques")} · mais recente primeiro` : null}
        flush
      >
        <QueryStateGate
          isLoading={operations.isLoading}
          isError={Boolean(operations.error)}
          isPaused={operations.fetchStatus === "paused"}
          hasData={operations.data !== undefined}
          errorMessage={operations.errorMessage ?? "Não foi possível carregar os embarques."}
          onRetry={() => void operations.refetch()}
          loadingFallback={<SkeletonTable rows={5} cols={6} label="Carregando embarques" />}
        >
          {visible.length === 0 ? (
            hasFilters ? (
              <EmptyState
                title="Nenhum embarque neste recorte"
                description="Nenhum embarque atende aos filtros aplicados."
                action={<Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button>}
              />
            ) : (
              <EmptyState
                title="Nenhum embarque de vazios"
                description="Crie o embarque da escala em Novo embarque, escolhendo a viagem e o porto."
              />
            )
          ) : (
            <div className="app-table-scroll">
              <table className="app-table app-table--compact">
                <caption className="sr-only">Embarques de vazios</caption>
                <thead>
                  <tr>
                    <th scope="col" className="app-table__text-head">Navio / Viagem</th>
                    <th scope="col">Porto de embarque</th>
                    <th scope="col">Unidades</th>
                    <th scope="col">Serviços</th>
                    <th scope="col">Armazenagem a lançar</th>
                    <th scope="col">Atualizado em</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.id}>
                      <td className="app-table__text">
                        <Link className="app-link" to={openHref(item.id)}>{operationLabel(item)}</Link>
                      </td>
                      <td>{item.embark_port}</td>
                      <td className="tabular-nums">{item.unidades.toLocaleString("pt-BR")}</td>
                      <td className="tabular-nums">{formatBRL(item.servicos)}</td>
                      <td>
                        {item.armazenagemLocais > 0
                          ? <StatusText tone="warning">{plural(item.armazenagemLocais, "local", "locais")}</StatusText>
                          : "Nenhuma"}
                      </td>
                      <td className="tabular-nums">{formatDate(item.atualizadoEm)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryStateGate>
      </Block>

      <Modal open={newOpen} onClose={closeNew} title="Novo embarque" size="md">
        <div className="grid gap-4">
          <VoyageCombobox
            required
            label="Viagem"
            selectedVoyageId={voyageId}
            onSelect={(id) => {
              setVoyageId(id);
              setPort("");
            }}
          />
          <Field
            label="Porto de embarque"
            required
            hint="Um embarque por escala e porto; se ele já existir, abre o existente."
            error={
              !voyageId || voyagePorts.isLoading
                ? undefined
                : voyagePorts.error
                  // Falha de leitura não é "viagem sem escala": não manda cadastrar.
                  ? "Não foi possível carregar as escalas da viagem. Tente de novo; isto não significa que a viagem esteja sem escala."
                  : voyagePortOptions.length === 0
                    ? "Nenhuma escala brasileira na viagem: cadastre a escala na aba Escalas da viagem antes de criar o embarque."
                    : undefined
            }
          >
            <Select value={port} onChange={(event) => setPort(event.target.value)} disabled={!voyageId}>
              <option value="">Selecione</option>
              {voyagePortOptions.map((code) => <option key={code} value={code}>{code}</option>)}
            </Select>
          </Field>
          <div className="app-modal__actions">
            <Button variant="secondary" onClick={closeNew}>Voltar</Button>
            <Button loading={creating} disabled={!canEdit || !voyageId || !port} onClick={() => void createOperation()}>
              Criar embarque
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function EmbarqueDetalhe({
  operation: selectedOperation,
  depotRows,
  canEdit: canEditProfile,
  tab,
  onTab,
  onBack,
  onChanged,
}: {
  operation: VaziosOperationSummary;
  depotRows: DepotWithPort[];
  canEdit: boolean;
  tab: Tab;
  onTab: (tab: Tab) => void;
  onBack: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const confirmWithReason = useConfirmWithReason();
  const [serviceNature, setServiceNature] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [unitOpen, setUnitOpen] = useState(false);
  const [unit, setUnit] = useState<UnitForm>(EMPTY_UNIT);
  const [lineOpen, setLineOpen] = useState(false);
  const [line, setLine] = useState(EMPTY_LINE);
  const [observationLine, setObservationLine] = useState<{ id: string; name: string } | null>(null);
  const [observationDraft, setObservationDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const ref: OperationRef = selectedOperation;
  // ADR 0095, decisão 22: com o ADR de Saída fechado, nada muda no Embarque
  // de vazios. O banco recusa (migration 398); a tela tira as ações.
  const adrLock = useQuery({
    queryKey: queryKeys.agencyReports.vaziosExportLock(ref.voyage_id, ref.embark_port),
    queryFn: () => isVaziosExportLockedByAdr(ref.voyage_id, ref.embark_port),
  });
  const adrLocked = adrLock.data === true;
  // Enquanto a trava carrega ou se a leitura falhar, as ações ficam fora:
  // só o "não travado" explícito do banco libera a edição.
  const canEdit = canEditProfile && adrLock.data === false;
  const units = useQuery({
    queryKey: ["embarque-vazios-units", ref.id],
    queryFn: () => listVaziosBookingsForOperation(ref.id),
  });
  const operation = useQuery({
    queryKey: ["embarque-vazios-operation", ref.id],
    queryFn: () => getVaziosExportOperation(ref.voyage_id, ref.embark_port),
  });
  const services = useQuery({
    queryKey: ["depot-services", "ativos", line.localId],
    queryFn: () => listCurrentDepotServices(line.localId),
    enabled: Boolean(line.localId),
  });
  const armazenagemServices = useQuery({
    queryKey: ["armazenagem-services"],
    queryFn: listArmazenagemServices,
  });

  // V1: lançamento novo só em local e serviço ativos (o banco também recusa, migration 326).
  const activeDepots = depotRows.filter((item) => item.active !== false);
  const depotCode = (id: string | null | undefined) => depotRows.find((depot) => depot.id === id)?.code ?? null;
  const unitRows = units.data?.rows ?? [];
  const serviceRows = (Array.isArray(services.data) ? services.data : []).filter((item) => item.active !== false);
  const armazenagemServiceRows = Array.isArray(armazenagemServices.data) ? armazenagemServices.data : [];
  // Transporte para destino inativo não entra em lançamento novo (o banco
  // também recusa, migration 331).
  const offeredServices = serviceRows.filter((item) =>
    (!serviceNature || item.natureza === serviceNature)
    && (item.natureza !== "transporte" || activeDepots.some((depot) => depot.id === item.route_destino_id)));
  const local = activeDepots.find((item) => item.id === line.localId);
  const selectedService = serviceRows.find((item) => item.id === line.serviceId);
  const operationLines = operation.data?.linhas ?? [];
  const costLines = operationLines.map((item: VaziosExportServiceLine & { service: unknown }) => ({
    ...item,
    natureza: (item.service as { natureza?: string } | null)?.natureza ?? "geral",
    local_id: item.local_id,
    quantidade: Number(item.quantidade),
    valor_unitario: Number(item.valor_unitario),
  }));
  // Combinações (depot, condição) com dias calculados pela lista de unidades e
  // sem linha lançada (ADR 0033 mantém o lançamento manual); 0 dia fica fora.
  const missingArmazenagem = armazenagemALancar(unitRows, depotRows, costLines);
  const shipmentTotal = operation.data
    ? totalEmbarque({ unidades: unitRows, linhas: costLines, depots: depotRows })
    : selectedOperation.servicos;
  const unitCount = units.data ? unitRows.length : selectedOperation.unidades;

  async function refreshOperationData(options: { operation?: boolean } = {}) {
    const refreshes: Array<Promise<unknown>> = [units.refetch()];
    if (options.operation !== false) refreshes.push(operation.refetch());
    refreshes.push(invalidateAgencyReportForVoyage(queryClient, ref.voyage_id));
    refreshes.push(onChanged());
    await Promise.all(refreshes);
  }
  async function notify(action: () => Promise<void>, success: string, errorMessage = (error: unknown) => classifyDbError(error).message) {
    setSaving(true);
    try {
      await action();
      showToast(success, "success");
      return true;
    } catch (error) {
      showToast(errorMessage(error), "error");
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function importUnits() {
    if (!file || !user?.id) return;
    let parsed: ParsedVaziosManifest;
    try {
      parsed = await parseVaziosManifestFile(file, depotRows);
    } catch (error) {
      showToast(classifyDbError(error).message, "error");
      return;
    }
    // Com divergência nada é gravado (importVaziosManifest recusa o lote), e a
    // mensagem das linhas vem pelo aviso de erro; a pergunta só vale quando a
    // gravação vai acontecer.
    const hiddenQuestion = parsed.rowErrors.length ? null : hiddenUnitsQuestion(parsed.hidden);
    if (hiddenQuestion) {
      const proceed = await confirm({
        title: "Planilha com dados ocultos",
        message: hiddenQuestion,
        consequence:
          "Só as linhas visíveis entram na lista de unidades embarcadas da escala. Para importar as ocultas, reexiba-as na planilha e escolha o arquivo de novo.",
        reversibility: "Importar de novo a planilha com as linhas reexibidas devolve as unidades à lista.",
        confirmLabel: "Importar sem as ocultas",
        tone: "danger",
      });
      if (!proceed) return;
    }
    await notify(async () => {
      await importVaziosManifest({
        filename: file.name,
        voyageId: ref.voyage_id,
        port: ref.embark_port,
        uploadedBy: user.id,
        manifest: parsed,
        fileHash: await importFilesSha256([file]).catch(() => null),
      });
      setFile(null);
      await refreshOperationData();
      setImportOpen(false);
    }, "Lista de unidades substituída.", (error) => importErrorMessage(error, "Não foi possível importar a lista de unidades."));
  }
  function openUnit(item?: VaziosBooking) {
    setUnit(item
      ? {
          id: item.id,
          containerNumber: item.container_number,
          containerType: item.container_type ?? "",
          localId: item.local_id,
          condition: item.condition as "vazio" | "material",
          handInDate: item.hand_in_date ?? "",
          handOutDate: item.hand_out_date ?? "",
          movementDate: item.movement_date ?? "",
        }
      : EMPTY_UNIT);
    setUnitOpen(true);
  }
  async function saveUnit() {
    if (!unit.localId) return;
    const unitLocal = depotRows.find((item) => item.id === unit.localId);
    const terminal = unitLocal?.tipo === "terminal_portuario";
    await notify(
      async () => {
        const payload = {
          containerNumber: unit.containerNumber,
          containerType: unit.containerType || null,
          localId: unit.localId,
          condition: unit.condition,
          // Terminal portuário não tem entrada nem saída de depot.
          handInDate: terminal ? null : unit.handInDate || null,
          handOutDate: terminal ? null : unit.handOutDate || null,
          movementDate: unit.movementDate || null,
        };
        if (unit.id) await updateManualVaziosBooking(unit.id, payload);
        else
          await createManualVaziosBooking({
            operationId: ref.id,
            voyageId: ref.voyage_id,
            uploadedBy: user?.id,
            ...payload,
          });
        setUnitOpen(false);
        setUnit(EMPTY_UNIT);
        await refreshOperationData();
      },
      unit.id ? "Unidade atualizada." : "Unidade incluída.",
    );
  }
  async function removeUnit(item: VaziosBooking) {
    // B14: Excluir pede motivo (ADR 0072); o banco recusa com o ADR de Saída fechado.
    const reason = await confirmWithReason({
      title: "Excluir unidade",
      message: `Excluir a unidade ${item.container_number} deste embarque?`,
      consequence:
        "A unidade sai do embarque, da contagem de vazios e do ADR de Saída desta escala. Com o ADR de Saída fechado, o banco recusa: reabra o ADR antes.",
      reversibility: "Inclua a unidade de novo se precisar.",
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (reason === null) return;
    await notify(async () => {
      await deleteManualVaziosBooking(item.id, reason);
      await refreshOperationData();
    }, "Unidade excluída.");
  }
  async function persistServiceLine(params: {
    serviceId: string;
    service: { natureza: string };
    localId: string;
    local: { id: string };
    destinoId: string | null;
    containerType: string | null;
    condition: string | null;
    quantidade: number;
    valorUnitario: number;
    valorSugerido: number | null;
    quantidadeManual: boolean;
  }) {
    const draft = {
      natureza: params.service.natureza,
      local_id: params.localId,
      destino_id: params.destinoId,
      condition: params.condition,
      quantidade: params.quantidade,
      percentual: null,
      valor_unitario: params.valorUnitario,
      quantidade_manual: params.quantidadeManual,
    };
    const issue = veto(draft, { depots: depotRows, lines: costLines });
    if (issue) throw new Error(issue);
    const savedLine = await upsertServiceLine({
      operation_id: ref.id,
      service_id: params.serviceId,
      local_id: params.localId,
      destino_id: params.destinoId,
      container_type: params.containerType,
      condition: params.condition,
      quantidade: params.quantidade,
      percentual: null,
      valor_unitario: params.valorUnitario,
      valor_sugerido: params.valorSugerido,
      quantidade_manual: params.quantidadeManual,
    });
    const operationQueryKey = ["embarque-vazios-operation", ref.id] as const;
    const currentOperation =
      queryClient.getQueryData<typeof operation.data>(operationQueryKey) ?? operation.data;
    if (currentOperation) {
      queryClient.setQueryData(operationQueryKey, {
        ...currentOperation,
        linhas: [
          ...(currentOperation.linhas ?? []).filter((item) => item.id !== savedLine.id),
          {
            ...savedLine,
            service: params.service,
            local: params.local,
            destino: depotRows.find((item) => item.id === savedLine.destino_id) ?? null,
          },
        ],
      });
    }
    // A refetch immediately after the insert can briefly return the previous
    // read model and overwrite the line already confirmed by the insert; skip
    // it only when the optimistic write above already applied. Without cached
    // data to merge into, the refetch is the only way the new line reaches the UI.
    await refreshOperationData({ operation: !currentOperation });
  }
  async function saveLine() {
    if (!selectedService || !local) return;
    await notify(async () => {
      if (selectedService.natureza === "transporte" && !selectedService.route_destino_id) {
        throw new Error("Serviço de transporte sem destino cadastrado.");
      }
      if (selectedService.natureza === "armazenagem" && !selectedService.condition && !line.condition) {
        throw new Error("Escolha a condição da linha de armazenagem.");
      }
      await persistServiceLine({
        serviceId: selectedService.id,
        service: selectedService,
        localId: local.id,
        local,
        destinoId: selectedService.natureza === "transporte" ? selectedService.route_destino_id ?? null : null,
        containerType: null,
        // B12 (ADR 0033): o serviço genérico leva a condição escolhida na linha.
        condition: selectedService.natureza === "armazenagem" ? selectedService.condition ?? (line.condition || null) : null,
        quantidade: line.quantidade,
        valorUnitario: line.valor,
        valorSugerido: line.valorSugerido,
        quantidadeManual: selectedService.natureza === "armazenagem" && line.quantidadeManual,
      });
      setLineOpen(false);
      setLine(EMPTY_LINE);
      setServiceNature("");
    }, "Linha de serviço lançada.");
  }
  async function saveServiceObservation() {
    if (!observationLine) return;
    await notify(async () => {
      await updateServiceLineObservation(observationLine.id, observationDraft);
      setObservationLine(null);
      await refreshOperationData();
    }, "Observação da linha atualizada.");
  }
  async function removeLine(id: string, name: string) {
    const reason = await confirmWithReason({
      title: "Excluir linha de serviço",
      message: `Excluir a linha de serviço ${name}?`,
      consequence: "O custo desta linha sai do embarque e do ADR de Saída desta escala.",
      reversibility: "Lance a linha de novo se precisar.",
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (reason === null) return;
    await notify(async () => {
      await deleteServiceLine(id, reason);
      await refreshOperationData();
    }, "Linha excluída.");
  }
  async function addSuggestedArmazenagemLine(
    need: { depot_id: string; condition: string; quantidade: number },
    service: DepotService,
  ) {
    const depot = depotRows.find((item) => item.id === need.depot_id);
    if (!depot) return;
    await notify(async () => {
      await persistServiceLine({
        serviceId: service.id,
        service,
        localId: need.depot_id,
        local: depot,
        destinoId: null,
        containerType: null,
        condition: need.condition,
        quantidade: need.quantidade,
        valorUnitario: Number(service.rate_brl),
        valorSugerido: Number(service.rate_brl),
        quantidadeManual: false,
      });
    }, "Linha de armazenagem lançada.");
  }
  function chooseCondition(condition: string) {
    const suggestion =
      selectedService && local && condition
        ? valorSugerido({ local, servico: selectedService, tipo: "", rota: "", condicao: condition, catalogo: serviceRows })
        : null;
    setLine((current) => ({ ...current, condition, valor: suggestion ?? current.valor, valorSugerido: suggestion }));
  }
  function chooseService(serviceId: string) {
    const service = serviceRows.find((item) => item.id === serviceId);
    const serviceRoute = service?.natureza === "transporte" ? service.route_destino_id ?? "" : "";
    const serviceCondition = service?.natureza === "armazenagem" ? service.condition ?? "" : "";
    const suggestion =
      service && local
        ? valorSugerido({ local, servico: service, tipo: "", rota: serviceRoute, condicao: serviceCondition, catalogo: serviceRows })
        : null;
    setLine((current) => ({
      ...current,
      serviceId,
      destinoId: serviceRoute,
      condition: serviceCondition,
      valor: suggestion ?? 0,
      valorSugerido: suggestion,
      quantidadeManual: service?.natureza !== "armazenagem",
    }));
  }

  const unitLocal = depotRows.find((item) => item.id === unit.localId);
  const unitTerminal = unitLocal?.tipo === "terminal_portuario";
  // A unidade já lançada num local depois desativado continua editável nele.
  const unitLocalOptions = unit.id && unitLocal && unitLocal.active === false ? [...activeDepots, unitLocal] : activeDepots;
  const calculatedQuantity = selectedService?.natureza === "armazenagem"
    ? quantidadeEfetiva(
        { natureza: "armazenagem", local_id: local?.id ?? "", condition: line.condition || null, quantidade: line.quantidade, valor_unitario: line.valor, quantidade_manual: false },
        unitRows,
        depotRows,
      )
    : null;

  return (
    <div className="grid gap-5">
      <IdentityBand
        kind="Embarque de vazios"
        title={operationLabel(selectedOperation)}
        facts={[
          { label: "Porto", value: ref.embark_port },
          { label: "Unidades", value: unitCount.toLocaleString("pt-BR") },
          { label: "Serviços", value: formatBRL(shipmentTotal) },
        ]}
        actions={<Button variant="ghost" onClick={onBack}>Todos os embarques</Button>}
      />

      {adrLocked ? (
        <ImportNotice tone="warning" role="status" title="ADR de Saída fechado">
          <p>O Embarque de vazios de {ref.embark_port} não muda com o ADR de Saída fechado: incluir, editar, excluir ou importar unidades e lançar serviços ficam travados. Reabra o ADR de Saída para mudar.</p>
        </ImportNotice>
      ) : adrLock.error && adrLock.data === undefined ? (
        <ImportNotice tone="warning" role="alert" title="Não foi possível conferir o ADR de Saída">
          <p>As ações do Embarque de vazios ficam travadas até conferir se o ADR de Saída de {ref.embark_port} está fechado.</p>
          <Button variant="secondary" onClick={() => void adrLock.refetch()}>Tentar de novo</Button>
        </ImportNotice>
      ) : null}

      <TabList label="Embarque de vazios">
        <TabButton id="embarque-tab-unidades" controls="embarque-panel" active={tab === "unidades"} label={`Unidades embarcadas · ${unitCount.toLocaleString("pt-BR")}`} onClick={() => onTab("unidades")} />
        <TabButton id="embarque-tab-servicos" controls="embarque-panel" active={tab === "servicos"} label={`Serviços · ${formatBRL(shipmentTotal)}`} onClick={() => onTab("servicos")} />
      </TabList>

      <div id="embarque-panel" role="tabpanel" aria-labelledby={`embarque-tab-${tab}`} className="grid gap-5">
        {tab === "unidades" ? (
          <>
            {unitRows.length > 0 ? (
              <Block title="Resumo">
                <FactList columns={3}>
                  <Fact label="Por tipo">{countText(unitRows, (item) => item.container_type ?? "Sem tipo")}</Fact>
                  <Fact label="Por local">{countText(unitRows, (item) => depotCode(item.local_id) ?? "Local removido")}</Fact>
                  <Fact label="Por condição">{countText(unitRows, (item) => condicaoLabel(item.condition))}</Fact>
                </FactList>
              </Block>
            ) : null}
            <Block
              title="Unidades embarcadas"
              flush
              aside={
                <div className="flex flex-wrap items-center gap-2">
                  {units.data ? <span className="tabular-nums">{plural(unitRows.length, "container", "containers")}</span> : null}
                  {canEdit ? (
                    <>
                      <Button variant="secondary" onClick={() => setImportOpen(true)}>
                        <Upload size={16} aria-hidden="true" /> Importar planilha
                      </Button>
                      <Button onClick={() => openUnit()}>
                        <Plus size={16} aria-hidden="true" /> Adicionar unidade
                      </Button>
                    </>
                  ) : null}
                </div>
              }
            >
              <QueryStateGate
                isLoading={units.isLoading}
                isError={Boolean(units.error)}
                isPaused={units.fetchStatus === "paused"}
                hasData={units.data !== undefined}
                errorMessage="Não foi possível carregar as unidades embarcadas."
                onRetry={() => void units.refetch()}
                loadingFallback={<SkeletonTable rows={5} cols={8} label="Carregando unidades" />}
              >
                {unitRows.length === 0 ? (
                  <EmptyState
                    title="Nenhuma unidade embarcada"
                    description="Importe a planilha de unidades da escala ou adicione uma unidade."
                  />
                ) : (
                  <div className="app-table-scroll">
                    <table className="app-table app-table--compact">
                      <caption className="sr-only">Unidades embarcadas da escala</caption>
                      <thead>
                        <tr>
                          <th scope="col">Container</th>
                          <th scope="col">Tipo</th>
                          <th scope="col">Local</th>
                          <th scope="col">Condição</th>
                          <th scope="col">Entrada</th>
                          <th scope="col">Saída</th>
                          <th scope="col">Embarque</th>
                          {canEdit ? <th scope="col">Ações</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {unitRows.map((item) => (
                          <tr key={item.id}>
                            <td className="font-[var(--app-font-mono)]"><CopyValue value={item.container_number} label="número do contêiner" /></td>
                            <td>{item.container_type ?? <NoValue label="Sem tipo" />}</td>
                            <td>{depotCode(item.local_id) ?? <NoValue label="Local removido" />}</td>
                            <td>{condicaoLabel(item.condition)}</td>
                            <td className="tabular-nums">{item.hand_in_date ? formatDate(item.hand_in_date) : <NoValue label="Sem entrada" />}</td>
                            <td className="tabular-nums">{item.hand_out_date ? formatDate(item.hand_out_date) : <NoValue label="Sem saída" />}</td>
                            <td className="tabular-nums">{item.movement_date ? formatDate(item.movement_date) : <NoValue label="Sem data de embarque" />}</td>
                            {canEdit ? (
                              <td>
                                <div className="flex justify-center gap-1">
                                  <RowActionButton icon={Pencil} label={`Editar unidade ${item.container_number}`} onClick={() => openUnit(item)} />
                                  <RowActionButton icon={Trash2} variant="danger" label={`Excluir unidade ${item.container_number}`} onClick={() => void removeUnit(item)} />
                                </div>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </QueryStateGate>
            </Block>
          </>
        ) : (
          <>
            {missingArmazenagem.length > 0 ? (
              <Block title="Armazenagem a lançar" aside="dias calculados pela lista de unidades, ainda sem linha de serviço" flush>
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact">
                    <caption className="sr-only">Armazenagem calculada ainda sem linha de serviço</caption>
                    <thead>
                      <tr>
                        <th scope="col">Local</th>
                        <th scope="col">Condição</th>
                        <th scope="col">Dias de armazenagem</th>
                        <th scope="col" className="app-table__text-head">Serviço</th>
                        {canEdit ? <th scope="col">Ações</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {missingArmazenagem.map((need) => {
                        const depot = depotRows.find((item) => item.id === need.depot_id);
                        // B12 (ADR 0033): o serviço da mesma condição vence; sem ele, o serviço sem condição (genérico) serve.
                        const suggestedService =
                          armazenagemServiceRows.find((item) => item.depot_id === need.depot_id && item.condition === need.condition)
                          ?? armazenagemServiceRows.find((item) => item.depot_id === need.depot_id && item.condition == null);
                        const inactiveDepot = depot?.active === false;
                        return (
                          <tr key={`${need.depot_id}:${need.condition}`}>
                            <td>{depot?.code ?? <NoValue label="Local removido" />}</td>
                            <td>{condicaoLabel(need.condition)}</td>
                            <td className="tabular-nums">{diasLabel(need.quantidade)}</td>
                            <td className="app-table__text">
                              {inactiveDepot
                                ? <StatusText tone="warning">Local inativo</StatusText>
                                : suggestedService
                                  ? suggestedService.name
                                  : <StatusText tone="warning">Sem serviço de armazenagem cadastrado</StatusText>}
                            </td>
                            {canEdit ? (
                              <td>
                                <div className="flex justify-center gap-1">
                                  {suggestedService && !inactiveDepot ? (
                                    <RowActionButton
                                      icon={Plus}
                                      label={`Lançar armazenagem de ${depot?.code ?? "local"} (${condicaoLabel(need.condition)})`}
                                      disabled={saving}
                                      onClick={() => void addSuggestedArmazenagemLine(need, suggestedService)}
                                    />
                                  ) : (
                                    <RowActionButton
                                      icon={Settings}
                                      label={`Abrir o cadastro de ${depot?.code ?? "local"}`}
                                      onClick={() => navigate(`/embarquevazios/depots?local=${need.depot_id}`)}
                                    />
                                  )}
                                </div>
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Block>
            ) : null}
            <Block
              title="Linhas de serviço"
              flush
              aside={
                <div className="flex flex-wrap items-center gap-2">
                  {operation.data !== undefined ? (
                    <span className="tabular-nums">{`${plural(operationLines.length, "linha", "linhas")} · ${formatBRL(shipmentTotal)}`}</span>
                  ) : null}
                  {canEdit ? (
                    <Button onClick={() => { setLine(EMPTY_LINE); setServiceNature(""); setLineOpen(true); }}>
                      <Plus size={16} aria-hidden="true" /> Lançar linha
                    </Button>
                  ) : null}
                </div>
              }
            >
              <QueryStateGate
                isLoading={operation.isLoading}
                isError={Boolean(operation.error)}
                isPaused={operation.fetchStatus === "paused"}
                hasData={operation.data !== undefined}
                errorMessage="Não foi possível carregar as linhas de serviço."
                onRetry={() => void operation.refetch()}
                loadingFallback={<SkeletonTable rows={5} cols={10} label="Carregando linhas de serviço" />}
              >
                {operationLines.length === 0 ? (
                  <EmptyState title="Nenhuma linha de serviço" description="Lance as linhas de armazenagem, transporte e serviços gerais desta escala." />
                ) : (
                  <div className="app-table-scroll">
                    <table className="app-table app-table--compact">
                      <caption className="sr-only">Linhas de serviço do embarque</caption>
                      <thead>
                        <tr>
                          <th scope="col" className="app-table__text-head">Serviço</th>
                          <th scope="col">Local</th>
                          <th scope="col">Natureza</th>
                          <th scope="col">Rota</th>
                          <th scope="col">Tipo</th>
                          <th scope="col">Qtd.</th>
                          <th scope="col">Unitário</th>
                          <th scope="col">Total</th>
                          <th scope="col" className="app-table__text-head">Observação</th>
                          {canEdit ? <th scope="col">Ações</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {operationLines.map((item) => {
                          const natureza = (item.service as { natureza?: string } | null)?.natureza ?? "geral";
                          const name = (item.service as { name?: string } | null)?.name ?? "Serviço";
                          const costLine = { ...item, natureza, quantidade: Number(item.quantidade), valor_unitario: Number(item.valor_unitario) };
                          const quantity = quantidadeEfetiva(costLine, unitRows, depotRows);
                          const manualStorage = item.quantidade_manual && natureza === "armazenagem";
                          const calculated = manualStorage
                            ? quantidadeEfetiva({ ...costLine, quantidade_manual: false }, unitRows, depotRows)
                            : null;
                          return (
                            <tr key={item.id}>
                              <td className="app-table__text" title={name}>{name}</td>
                              <td>{depotCode(item.local_id) ?? <NoValue label="Local removido" />}</td>
                              <td>{naturezaServicoLabel(natureza)}</td>
                              <td>{depotCode(item.destino_id) ?? <NoValue label="Sem rota" />}</td>
                              <td>{item.container_type ?? <NoValue label="Sem tipo" />}</td>
                              <td className="tabular-nums" title={calculated !== null ? `Informada à mão; calculada pela lista de unidades: ${calculated}` : undefined}>
                                {quantity.toLocaleString("pt-BR")}
                              </td>
                              <td className="tabular-nums">{formatBRL(Number(item.valor_unitario))}</td>
                              {/* B11 (ADR 0033): quantidade × valor unitário, como o total do Embarque e o ADR; o percentual legado não entra. */}
                              <td className="tabular-nums">{formatBRL(quantity * Number(item.valor_unitario))}</td>
                              <td className="app-table__text app-table__text--wrap">{item.observation || <NoValue label="Sem observação" />}</td>
                              {canEdit ? (
                                <td>
                                  <div className="flex justify-center gap-1">
                                    <RowActionButton
                                      icon={MessageSquare}
                                      label={`Observação da linha ${name}`}
                                      onClick={() => { setObservationDraft(item.observation ?? ""); setObservationLine({ id: item.id, name }); }}
                                    />
                                    <RowActionButton icon={Trash2} variant="danger" label={`Excluir linha ${name}`} onClick={() => void removeLine(item.id, name)} />
                                  </div>
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </QueryStateGate>
            </Block>
          </>
        )}
      </div>

      <Modal open={unitOpen} onClose={() => setUnitOpen(false)} title={unit.id ? "Editar unidade" : "Adicionar unidade"} size="md">
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Container" required>
              <Input value={unit.containerNumber} onChange={(event) => setUnit((current) => ({ ...current, containerNumber: event.target.value }))} />
            </Field>
            <Field label="Tipo">
              <Input value={unit.containerType} placeholder="Ex.: 40HC" onChange={(event) => setUnit((current) => ({ ...current, containerType: event.target.value }))} />
            </Field>
            <Field label="Local" required>
              <Select value={unit.localId} onChange={(event) => setUnit((current) => ({ ...current, localId: event.target.value }))}>
                <option value="">Selecione</option>
                {unitLocalOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.name ?? (item.tipo === "terminal_portuario" ? "Terminal portuário" : "Depot")}{item.active === false ? " (inativo)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Condição" required>
              <Select value={unit.condition} onChange={(event) => setUnit((current) => ({ ...current, condition: event.target.value as "vazio" | "material" }))}>
                <option value="vazio">Vazio</option>
                <option value="material">Com material</option>
              </Select>
            </Field>
            {unitTerminal ? null : (
              <>
                <Field label="Entrada" required={unitLocal?.tipo === "depot"}>
                  <Input type="date" value={unit.handInDate} onChange={(event) => setUnit((current) => ({ ...current, handInDate: event.target.value }))} />
                </Field>
                <Field label="Saída" required={unitLocal?.tipo === "depot"}>
                  <Input type="date" value={unit.handOutDate} onChange={(event) => setUnit((current) => ({ ...current, handOutDate: event.target.value }))} />
                </Field>
              </>
            )}
            <Field label="Embarque">
              <Input type="date" value={unit.movementDate} onChange={(event) => setUnit((current) => ({ ...current, movementDate: event.target.value }))} />
            </Field>
          </div>
          {unitTerminal ? <p className="text-sm text-[var(--app-muted)]">Terminal portuário não tem entrada nem saída de depot.</p> : null}
          <div className="app-modal__actions">
            <Button variant="secondary" onClick={() => setUnitOpen(false)}>Voltar</Button>
            <Button loading={saving} disabled={!canEdit || !unit.containerNumber || !unit.localId} onClick={() => void saveUnit()}>
              {unit.id ? "Salvar unidade" : "Adicionar unidade"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={lineOpen} onClose={() => setLineOpen(false)} title="Lançar linha" size="md">
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Local" required>
              <Select
                value={line.localId}
                onChange={(event) => {
                  setServiceNature("");
                  setLine({ ...EMPTY_LINE, localId: event.target.value });
                }}
              >
                <option value="">Selecione</option>
                {activeDepots.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.tipo === "terminal_portuario" ? "Terminal portuário" : "Depot"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Natureza" required>
              <Select
                value={serviceNature}
                disabled={!line.localId}
                onChange={(event) => {
                  setServiceNature(event.target.value);
                  setLine((current) => ({ ...current, serviceId: "", destinoId: "", condition: "" }));
                }}
              >
                <option value="">Selecione</option>
                <option value="armazenagem">Armazenagem</option>
                <option value="transporte">Transporte</option>
                <option value="geral">Geral</option>
              </Select>
            </Field>
            <Field label="Serviço" required>
              <Select value={line.serviceId} onChange={(event) => chooseService(event.target.value)} disabled={!line.localId || !serviceNature}>
                <option value="">Selecione</option>
                {offeredServices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {naturezaServicoLabel(item.natureza)}
                  </option>
                ))}
              </Select>
            </Field>
            {selectedService?.natureza === "transporte" && selectedService.route_destino_id ? (
              <Field label="Destino da rota">
                <Select value={line.destinoId} onChange={(event) => setLine((current) => ({ ...current, destinoId: event.target.value }))}>
                  <option value="">Selecione</option>
                  {depotRows
                    .filter((item) => item.id === selectedService.route_destino_id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} · {item.name ?? (item.tipo === "terminal_portuario" ? "Terminal portuário" : "Depot")}
                      </option>
                    ))}
                </Select>
              </Field>
            ) : null}
            {selectedService?.natureza === "armazenagem" && selectedService.condition ? (
              <Field label="Condição">
                <Select value={line.condition} disabled>
                  <option value={selectedService.condition}>{condicaoLabel(selectedService.condition)}</option>
                </Select>
              </Field>
            ) : selectedService?.natureza === "armazenagem" ? (
              // B12 (ADR 0033): serviço sem condição vale para as duas; a linha escolhe.
              <Field label="Condição" required>
                <Select value={line.condition} onChange={(event) => chooseCondition(event.target.value)}>
                  <option value="">Selecione</option>
                  <option value="vazio">Vazio</option>
                  <option value="material">Com material</option>
                </Select>
              </Field>
            ) : null}
            <Field
              label="Quantidade"
              hint={calculatedQuantity !== null ? `Calculada pela lista de unidades: ${diasLabel(calculatedQuantity)}.` : undefined}
            >
              <Input
                type="number"
                min={0}
                value={selectedService?.natureza === "armazenagem" && !line.quantidadeManual ? calculatedQuantity ?? 0 : line.quantidade}
                disabled={selectedService?.natureza === "armazenagem" && !line.quantidadeManual}
                onChange={(event) => setLine((current) => ({ ...current, quantidade: Number(event.target.value) }))}
              />
            </Field>
            <Field label="Valor unitário" hint={line.valorSugerido != null ? `Sugerido: ${formatBRL(line.valorSugerido)}.` : undefined}>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={line.valor}
                onChange={(event) => setLine((current) => ({ ...current, valor: Number(event.target.value) }))}
              />
            </Field>
          </div>
          {selectedService?.natureza === "armazenagem" ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={line.quantidadeManual}
                onChange={(event) => setLine((current) => ({ ...current, quantidadeManual: event.target.checked }))}
              />
              Informar a quantidade à mão, no lugar do cálculo
            </label>
          ) : null}
          <div className="app-modal__actions">
            <Button variant="secondary" onClick={() => setLineOpen(false)}>Voltar</Button>
            <Button loading={saving} disabled={!canEdit || !line.serviceId || !line.localId} onClick={() => void saveLine()}>
              Lançar linha
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={observationLine !== null} onClose={() => setObservationLine(null)} title="Observação da linha" size="sm">
        <div className="grid gap-4">
          <Field label={`Observação — ${observationLine?.name ?? ""}`}>
            <Textarea value={observationDraft} rows={4} onChange={(event) => setObservationDraft(event.target.value)} />
          </Field>
          <div className="app-modal__actions">
            <Button variant="secondary" onClick={() => setObservationLine(null)}>Voltar</Button>
            <Button loading={saving} disabled={!canEdit} onClick={() => void saveServiceObservation()}>Salvar observação</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setFile(null);
        }}
        title="Importar unidades embarcadas"
        size="md"
      >
        <div className="grid gap-5">
          <div className="app-panel app-panel--padded text-sm">
            <p className="font-semibold">Colunas da planilha</p>
            <p className="mt-2">Container, Tipo, Local, Condição, Entrada, Saída e Embarque.</p>
            <p className="mt-2 text-[var(--app-muted)]">
              O local usa o código do cadastro de Locais (só ativos). Condição: Vazio ou Com material.
              Reimportar substitui toda a lista desta escala e pode mudar a armazenagem; as unidades incluídas à mão ficam.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="app-btn app-btn--secondary" href="/templates/unidades-embarcadas-modelo.xlsx" download="unidades-embarcadas-modelo.xlsx">
                <Download size={16} aria-hidden="true" /> Baixar modelo .xlsx
              </a>
            </div>
          </div>
          {/* O seletor comum mostra os avisos de leitura (linhas e abas
              ocultas, CSV Windows-1252) assim que o arquivo é escolhido. */}
          <ImportFilePicker accept=".xlsx,.xls,.csv" files={file ? [file] : []} onFiles={(files) => setFile(files[0] ?? null)} disabled={!canEdit} />
          {file ? <PreviousImportCheck kind="vazios_exportacao" voyageId={ref.voyage_id} files={[file]} /> : null}
          <div className="app-modal__actions">
            <Button
              variant="secondary"
              onClick={() => {
                setImportOpen(false);
                setFile(null);
              }}
            >
              Voltar
            </Button>
            <Button loading={saving} disabled={!file || !canEdit} onClick={() => void importUnits()}>
              <Upload size={16} aria-hidden="true" /> Importar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
