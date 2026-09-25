import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Download, Upload, Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Card, InlineError, PageHeader } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { Field, Input, Select } from "../components/ui/Input";
import { VoyageCombobox } from "../components/shared/VoyageCombobox";
import { Combobox, type ComboOption } from "../components/ui/Combobox";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import {
  getVaziosExportOperation,
  upsertServiceLine,
  upsertVaziosExportOperation,
  deleteServiceLine,
  updateServiceLineObservation,
  listVaziosBookingsForOperation,
  createManualVaziosBooking,
  updateManualVaziosBooking,
  deleteManualVaziosBooking,
} from "../services/vaziosExportOperations";
import {
  importVaziosManifest,
  parseVaziosManifestFile,
} from "../services/vaziosImport";
import {
  listArmazenagemServices,
  listDepotServices,
  listDepots,
  valorSugerido,
} from "../services/depots";
import { supabase } from "../services/supabase";
import { listVoyageRoutePorts } from "../services/operationalLists";
import { normalizePortCode } from "../services/portCode";
import {
  armazenagemPorDepotCondicao,
  quantidadeEfetiva,
  totalEmbarque,
  veto,
} from "../services/vaziosCusto";
import type { DepotService, VaziosExportServiceLine } from "../types/database";
import { formatBRL, formatDate, normalizeText, voyageLabel } from "../lib/utils";
import { classifyDbError } from "../lib/errors";
import { invalidateAgencyReportForVoyage } from "../services/agencyReportInvalidation";

type Tab = "unidades" | "servicos";

type OperationRow = {
  id: string;
  voyage_id: number;
  embark_port: string;
  voyage?: { vessel?: { name?: string | null } | null; voyage_number?: string | null } | null;
};

function operationLabel(item: OperationRow): string {
  return voyageLabel(item.voyage?.vessel?.name, item.voyage?.voyage_number, item.voyage_id);
}

function countByField<T>(rows: T[], keyOf: (row: T) => string): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

// ponytail: escala do Embarque de Vazios montada aqui unindo POD e POL dos
// B/Ls da viagem à mão (duas fontes unidas manualmente, sem projeção comum).
// Teto: não enxerga escala planejada sem B/L ainda lançado. Upgrade: trocar
// pela projeção unificada de escalas quando
// docs/plans/2026-07-31-escala-unificada-pol-pod.md for entregue.
async function fetchVoyageEscalaPorts(voyageId: number): Promise<string[]> {
  const ports = new Set<string>();
  for (const raw of await listVoyageRoutePorts(voyageId)) {
    const code = normalizePortCode(raw);
    if (code && code.startsWith("BR")) ports.add(code);
  }
  return [...ports].sort();
}

function TotalsCard({ title, totals }: { title: string; totals: Array<{ label: string; count: number }> }) {
  return (
    <div className="rounded-lg border border-[var(--app-border)] p-3">
      <h3 className="app-panel__title text-sm">{title}</h3>
      <ul className="mt-2 grid gap-1 text-sm">
        {totals.map((item) => (
          <li key={item.label} className="flex items-center justify-between gap-2">
            <span className="text-[var(--app-muted)]">{item.label}</span>
            <span className="font-semibold">{item.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EmbarqueVazios() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const canEdit = Boolean(profile || user);
  const [searchParams] = useSearchParams();
  const queryVoyageId = Number(searchParams.get("voyage"));
  const lockedVoyageId = Number.isInteger(queryVoyageId) && queryVoyageId > 0 ? queryVoyageId : null;
  const voyageLocked = lockedVoyageId !== null;
  const [voyageId, setVoyageId] = useState<number | null>(() => lockedVoyageId);
  const [port, setPort] = useState("");
  const [selectedOperation, setSelectedOperation] = useState<{
    id: string;
    voyage_id: number;
    embark_port: string;
  } | null>(null);
  const [tab, setTab] = useState<Tab>("unidades");
  const [serviceNature, setServiceNature] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [editingServiceObservation, setEditingServiceObservation] = useState<string | null>(null);
  const [serviceObservationDraft, setServiceObservationDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [line, setLine] = useState({
    serviceId: "",
    localId: "",
    destinoId: "",
    containerType: "",
    condition: "",
    quantidade: 0,
    valor: 0,
    valorSugerido: null as number | null,
    quantidadeManual: false,
  });
  const [unit, setUnit] = useState({
    id: "",
    containerNumber: "",
    containerType: "",
    localId: "",
    condition: "vazio" as "vazio" | "material",
    handInDate: "",
    handOutDate: "",
    movementDate: "",
  });
  const voyagePorts = useQuery({
    queryKey: ["embarque-vazios-voyage-ports", voyageId],
    queryFn: () => fetchVoyageEscalaPorts(voyageId!),
    enabled: Boolean(voyageId),
  });
  const voyagePortOptions = Array.isArray(voyagePorts.data) ? voyagePorts.data : [];
  const operations = useQuery({
    queryKey: ["vazios-export-operations", voyageId ?? null],
    queryFn: async () => {
      let query = supabase
        .from("vazios_export_operations")
        .select("id, voyage_id, embark_port, voyage:voyages(id, voyage_number, vessel:vessels(name))")
        .order("created_at", { ascending: false });
      if (voyageId) query = query.eq("voyage_id", voyageId);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
  const units = useQuery({
    queryKey: ["embarque-vazios-units", selectedOperation?.id],
    queryFn: () => listVaziosBookingsForOperation(selectedOperation!.id),
    enabled: Boolean(selectedOperation),
  });
  const operation = useQuery({
    queryKey: ["embarque-vazios-operation", selectedOperation?.id],
    queryFn: () =>
      getVaziosExportOperation(
        selectedOperation!.voyage_id,
        selectedOperation!.embark_port,
      ),
    enabled: Boolean(selectedOperation),
  });
  const depots = useQuery({ queryKey: ["depots"], queryFn: listDepots });
  const services = useQuery({
    queryKey: ["depot-services", line.localId],
    queryFn: () => listDepotServices(line.localId),
    enabled: Boolean(line.localId),
  });
  const armazenagemServices = useQuery({
    queryKey: ["armazenagem-services"],
    queryFn: listArmazenagemServices,
    enabled: Boolean(selectedOperation),
  });
  const depotRows = Array.isArray(depots.data) ? depots.data : [];
  const unitRows = units.data?.rows ?? [];
  const unitTotals = countByField(unitRows, (item) => item.container_type ?? "—");
  const depotTotals = countByField(
    unitRows,
    (item) => depotRows.find((depot) => depot.id === item.local_id)?.code ?? item.local_id,
  );
  const conditionTotals = countByField(unitRows, (item) =>
    item.condition === "material" ? "Material" : "Vazio",
  );
  const serviceRows = Array.isArray(services.data) ? services.data : [];
  const armazenagemServiceRows = Array.isArray(armazenagemServices.data)
    ? armazenagemServices.data
    : [];
  const offeredServices = serviceRows.filter(
    (item) => !serviceNature || item.natureza === serviceNature,
  );
  const operationRows: OperationRow[] = (Array.isArray(operations.data)
    ? operations.data
    : []).filter((item) => !voyageLocked || item.voyage_id === voyageId);
  const operationOptions: ComboOption[] = operationRows.map((item) => ({
    value: item.id,
    label: operationLabel(item),
    meta: item.embark_port,
  }));
  async function fetchOperationOptions(query: string) {
    const term = normalizeText(query);
    if (!term) return operationOptions;
    return operationOptions.filter((option) =>
      normalizeText(`${option.label} ${option.meta ?? ""}`).includes(term),
    );
  }
  function selectOperationOption(option: ComboOption) {
    const found = operationRows.find((item) => item.id === option.value);
    if (found) {
      setSelectedOperation({
        id: found.id,
        voyage_id: found.voyage_id,
        embark_port: found.embark_port,
      });
    }
  }
  const local = depotRows.find((item) => item.id === line.localId);
  const selectedService = serviceRows.find(
    (item) => item.id === line.serviceId,
  );
  // Combinações (depot, condição) com dias de armazenagem calculados a partir
  // da Lista de Unidades que ainda não têm Linha de Serviço lançada — ADR 0033
  // mantém o lançamento manual, mas o sistema já sabe a resposta, então aponta
  // o que falta em vez de deixar o usuário procurar.
  const existingArmazenagemPairs = new Set(
    (operation.data?.linhas ?? [])
      .filter(
        (item) =>
          ((item.service as { natureza?: string } | null)?.natureza ??
            "geral") === "armazenagem",
      )
      .map((item) => `${item.local_id}:${item.condition}`),
  );
  const missingArmazenagem = armazenagemPorDepotCondicao(
    units.data?.rows ?? [],
    depotRows,
  ).filter((item) => !existingArmazenagemPairs.has(`${item.depot_id}:${item.condition}`));
  const shipmentTotal = operation.data
    ? totalEmbarque({
        unidades: units.data?.rows ?? [],
        linhas: (operation.data.linhas ?? []).map(
          (item: VaziosExportServiceLine & { service: unknown }) => ({
            ...item,
            natureza:
              (item.service as { natureza?: string } | null)?.natureza ??
              "geral",
            local_id: item.local_id,
            quantidade: Number(item.quantidade),
            valor_unitario: Number(item.valor_unitario),
          }),
        ),
        depots: depotRows,
      })
    : 0;

  async function refreshOperationData(options: { operation?: boolean } = {}) {
    const refreshes: Array<Promise<unknown>> = [units.refetch()];
    if (options.operation !== false) refreshes.push(operation.refetch());
    refreshes.push(
      selectedOperation
        ? invalidateAgencyReportForVoyage(queryClient, selectedOperation.voyage_id)
        : Promise.resolve(),
    );
    await Promise.all(refreshes);
  }
  async function notify(action: () => Promise<void>, success: string) {
    try {
      await action();
      showToast(success, "success");
    } catch (error) {
      showToast(classifyDbError(error).message, "error");
    }
  }
  async function createOperation() {
    // Gravar sempre normalizado, mesmo vindo do dropdown de escalas já
    // normalizadas, para o caminho de escrita ficar comprovadamente seguro.
    const embarkPort = normalizePortCode(port);
    if (!voyageId || !embarkPort) return;
    await notify(async () => {
      const created = await upsertVaziosExportOperation({
        voyageId,
        embarkPort,
      });
      setSelectedOperation({
        id: created.id,
        voyage_id: voyageId,
        embark_port: embarkPort,
      });
      setPort("");
      await operations.refetch();
    }, "Embarque criado.");
  }
  async function importUnits() {
    if (!file || !selectedOperation || !user?.id) return;
    await notify(async () => {
      const parsed = await parseVaziosManifestFile(file, depotRows);
      await importVaziosManifest({
        filename: file.name,
        voyageId: selectedOperation.voyage_id,
        port: selectedOperation.embark_port,
        uploadedBy: user.id,
        manifest: parsed,
      });
      setFile(null);
      await refreshOperationData();
      setImportOpen(false);
    }, "Lista de unidades substituída.");
  }
  function clearUnit() {
    setUnit({
      id: "",
      containerNumber: "",
      containerType: "",
      localId: "",
      condition: "vazio",
      handInDate: "",
      handOutDate: "",
      movementDate: "",
    });
  }
  async function saveUnit() {
    if (!selectedOperation || !unit.localId) return;
    await notify(
      async () => {
        const payload = {
          containerNumber: unit.containerNumber,
          containerType: unit.containerType || null,
          localId: unit.localId,
          condition: unit.condition,
          handInDate: unit.handInDate || null,
          handOutDate: unit.handOutDate || null,
          movementDate: unit.movementDate || null,
        };
        if (unit.id) await updateManualVaziosBooking(unit.id, payload);
        else
          await createManualVaziosBooking({
            operationId: selectedOperation.id,
            voyageId: selectedOperation.voyage_id,
            uploadedBy: user?.id,
            ...payload,
          });
        clearUnit();
        await refreshOperationData();
      },
      unit.id ? "Unidade atualizada." : "Unidade incluída.",
    );
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
    if (!selectedOperation) return;
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
    const issue = veto(draft, {
      depots: depotRows,
      lines: (operation.data?.linhas ?? []).map((item) => ({
        ...item,
        natureza:
          (item.service as { natureza?: string } | null)?.natureza ?? "geral",
        quantidade: Number(item.quantidade),
        valor_unitario: Number(item.valor_unitario),
      })),
    });
    if (issue) throw new Error(issue);
    const savedLine = await upsertServiceLine({
      operation_id: selectedOperation.id,
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
    const operationQueryKey = ["embarque-vazios-operation", selectedOperation.id] as const;
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
    if (!selectedOperation || !selectedService || !local) return;
    await notify(async () => {
      if (selectedService.natureza === "transporte" && !selectedService.route_destino_id) {
        throw new Error("Serviço de transporte sem destino cadastrado.");
      }
      await persistServiceLine({
        serviceId: selectedService.id,
        service: selectedService,
        localId: local.id,
        local,
        destinoId:
          selectedService.natureza === "transporte"
            ? selectedService.route_destino_id ?? null
            : null,
        containerType:
          selectedService.natureza === "armazenagem"
            ? null
            : line.containerType || null,
        condition:
          selectedService.natureza === "armazenagem"
            ? selectedService.condition ?? null
            : null,
        quantidade: line.quantidade,
        valorUnitario: line.valor,
        valorSugerido: line.valorSugerido,
        quantidadeManual:
          selectedService.natureza === "armazenagem" && line.quantidadeManual,
      });
    }, "Linha de serviço lançada.");
  }

  async function saveServiceObservation(id: string) {
    await notify(async () => {
      await updateServiceLineObservation(id, serviceObservationDraft);
      setEditingServiceObservation(null);
      await refreshOperationData();
    }, "Observação da linha atualizada.");
  }
  async function addSuggestedArmazenagemLine(
    need: { depot_id: string; condition: string; quantidade: number },
    service: DepotService,
  ) {
    const depot = depotRows.find((item) => item.id === need.depot_id);
    if (!selectedOperation || !depot) return;
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
  function chooseService(serviceId: string) {
    const service = serviceRows.find((item) => item.id === serviceId);
    const serviceRoute =
      service?.natureza === "transporte" ? service.route_destino_id ?? "" : "";
    const serviceCondition =
      service?.natureza === "armazenagem" ? service.condition ?? "" : "";
    const suggestion =
      service && local
        ? valorSugerido({
            local,
            servico: service,
            tipo: line.containerType,
            rota: serviceRoute,
            condicao: serviceCondition,
            catalogo: serviceRows,
          })
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
  return (
    <div className="grid gap-5">
      <PageHeader
        title="Embarque de Vazios"
        description="Um embarque por escala: unidades importadas como fato e serviços lançados manualmente."
        action={
          <Link className="app-table__action" to="/embarquevazios/depots">
            Cadastro de Terminais
          </Link>
        }
      />
      <Card className="grid gap-3">
        <h2 className="app-panel__title">Novo Embarque de Vazios</h2>
        <div className="grid gap-3 md:grid-cols-[1fr_12rem_auto]">
          <VoyageCombobox
            required
            selectedVoyageId={voyageId}
            disabled={voyageLocked}
            onSelect={(id) => {
              if (voyageLocked) return;
              setVoyageId(id);
              setPort("");
            }}
          />
          <Field
            label="Porto de embarque"
            error={
              voyageId && !voyagePorts.isLoading && voyagePortOptions.length === 0
                ? "Nenhuma escala encontrada — importe os B/Ls da viagem antes de criar o Embarque."
                : undefined
            }
          >
            <Select
              value={port}
              onChange={(event) => setPort(event.target.value)}
              disabled={!voyageId}
            >
              <option value="">Selecione</option>
              {voyagePortOptions.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            className="self-end"
            disabled={!canEdit || !voyageId || !port}
            onClick={() => void createOperation()}
          >
            <Plus size={16} /> Criar
          </Button>
        </div>
      </Card>
      <Card className="grid gap-3">
        <h2 className="app-panel__title">Embarques por escala</h2>
        {operations.error ? (
          <InlineError message="Erro ao carregar embarques." />
        ) : null}
        <Combobox
          key={selectedOperation?.id ?? ""}
          label="Buscar embarque"
          initialValue={
            selectedOperation
              ? (operationRows.find((item) => item.id === selectedOperation.id)
                  ? `${operationLabel(operationRows.find((item) => item.id === selectedOperation.id)!)} · ${selectedOperation.embark_port}`
                  : "")
              : ""
          }
          placeholder="Busque por navio ou viagem"
          onValueChange={() => {}}
          fetchOptions={fetchOperationOptions}
          onSelectOption={selectOperationOption}
          minChars={1}
          refreshKey={operationRows.length}
        />
      </Card>
      {selectedOperation ? (
        <div className="grid gap-5">
          <div className="flex gap-2 border-b border-[var(--app-border)]">
            <Button
              variant={tab === "unidades" ? "primary" : "ghost"}
              onClick={() => setTab("unidades")}
            >
              Unidades Embarcadas
            </Button>
            <Button
              variant={tab === "servicos" ? "primary" : "ghost"}
              onClick={() => setTab("servicos")}
            >
              Serviços · {formatBRL(shipmentTotal)}
            </Button>
          </div>
          {tab === "unidades" ? (
            <Card className="grid gap-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="app-panel__title">
                    Lista de Unidades Embarcadas
                  </h2>
                  <p className="text-sm text-[var(--app-muted)]">
                    Reimportar substitui toda a lista da escala e pode alterar a
                    armazenagem.
                  </p>
                  <p className="text-xs text-[var(--app-muted)]">
                    Use o modelo: container, tipo, local, condição (vazio ou
                    material), entrada, saída e embarque.
                  </p>
                </div>
                <span className="flex gap-2">
                  <Button
                    disabled={!canEdit}
                    onClick={() => setImportOpen(true)}
                  >
                    <Upload size={16} /> Importar planilha
                  </Button>
                </span>
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                <Field label="Container">
                  <Input
                    value={unit.containerNumber}
                    onChange={(event) =>
                      setUnit((current) => ({
                        ...current,
                        containerNumber: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Tipo">
                  <Input
                    value={unit.containerType}
                    onChange={(event) =>
                      setUnit((current) => ({
                        ...current,
                        containerType: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Local">
                  <Select
                    value={unit.localId}
                    onChange={(event) =>
                      setUnit((current) => ({
                        ...current,
                        localId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Selecione</option>
                    {depotRows.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} · {item.name ?? item.tipo}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Condição">
                  <Select
                    value={unit.condition}
                    onChange={(event) =>
                      setUnit((current) => ({
                        ...current,
                        condition: event.target.value as "vazio" | "material",
                      }))
                    }
                  >
                    <option value="vazio">Vazio</option>
                    <option value="material">Material</option>
                  </Select>
                </Field>
                <Field label="Entrada">
                  <Input
                    type="date"
                    value={unit.handInDate}
                    onChange={(event) =>
                      setUnit((current) => ({
                        ...current,
                        handInDate: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Saída">
                  <Input
                    type="date"
                    value={unit.handOutDate}
                    onChange={(event) =>
                      setUnit((current) => ({
                        ...current,
                        handOutDate: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Embarque">
                  <Input
                    type="date"
                    value={unit.movementDate}
                    onChange={(event) =>
                      setUnit((current) => ({
                        ...current,
                        movementDate: event.target.value,
                      }))
                    }
                  />
                </Field>
                <div className="flex items-end gap-2">
                  <Button
                    disabled={
                      !canEdit || !unit.containerNumber || !unit.localId
                    }
                    onClick={() => void saveUnit()}
                  >
                    <Plus size={16} /> {unit.id ? "Salvar" : "Adicionar"}
                  </Button>
                  {unit.id ? (
                    <Button variant="ghost" onClick={clearUnit}>
                      Voltar
                    </Button>
                  ) : null}
                </div>
              </div>
              {unitRows.length > 0 ? (
                <div className="grid gap-3">
                  <p className="text-sm">
                    Total geral:{" "}
                    <span className="font-semibold">
                      {unitRows.length} container{unitRows.length === 1 ? "" : "s"}
                    </span>
                  </p>
                  <div className="grid gap-3 md:grid-cols-3">
                    <TotalsCard title="Por Tipo" totals={unitTotals} />
                    <TotalsCard title="Por Depot" totals={depotTotals} />
                    <TotalsCard title="Por Condição" totals={conditionTotals} />
                  </div>
                </div>
              ) : null}
              <div className="app-table-scroll">
                <table className="app-table app-table--compact min-w-[760px] text-left text-sm whitespace-nowrap">
                  <thead>
                    <tr>
                      <th>Container</th>
                      <th>Tipo</th>
                      <th>Local</th>
                      <th>Condição</th>
                      <th>Entrada</th>
                      <th>Saída</th>
                      <th>Embarque</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(units.data?.rows ?? []).map((item) => (
                      <tr key={item.id}>
                        <td>{item.container_number}</td>
                        <td>{item.container_type ?? "—"}</td>
                        <td>
                          {depotRows.find((depot) => depot.id === item.local_id)
                            ?.code ?? item.local_id}
                        </td>
                        <td>{item.condition}</td>
                        <td>{formatDate(item.hand_in_date)}</td>
                        <td>{formatDate(item.hand_out_date)}</td>
                        <td>{formatDate(item.movement_date)}</td>
                        <td className="flex gap-1">
                          <Button
                            variant="ghost"
                            disabled={!canEdit}
                            onClick={() =>
                              setUnit({
                                id: item.id,
                                containerNumber: item.container_number,
                                containerType: item.container_type ?? "",
                                localId: item.local_id,
                                condition: item.condition as
                                  "vazio" | "material",
                                handInDate: item.hand_in_date ?? "",
                                handOutDate: item.hand_out_date ?? "",
                                movementDate: item.movement_date ?? "",
                              })
                            }
                          >
                            <Pencil size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={!canEdit}
                            aria-label={`Excluir unidade ${item.container_number}`}
                            onClick={async () => {
                              const confirmed = await confirm({
                                title: "Excluir unidade",
                                message: `Excluir a unidade ${item.container_number} deste embarque?`,
                                consequence:
                                  "A unidade sai do embarque, da contagem de vazios e do ADR de Saída desta escala.",
                                reversibility: "Inclua a unidade de novo se precisar.",
                                confirmLabel: "Excluir",
                                tone: "danger",
                              });
                              if (!confirmed) return;
                              void notify(async () => {
                                await deleteManualVaziosBooking(item.id);
                                clearUnit();
                                await refreshOperationData();
                              }, "Unidade excluída.");
                            }}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <>
              {missingArmazenagem.length > 0 ? (
                <Card className="grid gap-2">
                  <h2 className="app-panel__title">
                    Armazenagem pendente de lançamento
                  </h2>
                  <p className="text-xs text-[var(--app-muted)]">
                    Estas combinações de depot e condição têm dias de
                    armazenagem calculados a partir da Lista de Unidades, mas
                    ainda não têm Linha de Serviço lançada.
                  </p>
                  <ul className="grid gap-2">
                    {missingArmazenagem.map((need) => {
                      const depot = depotRows.find(
                        (item) => item.id === need.depot_id,
                      );
                      const suggestedService = armazenagemServiceRows.find(
                        (item) =>
                          item.depot_id === need.depot_id &&
                          item.condition === need.condition,
                      );
                      return (
                        <li
                          key={`${need.depot_id}:${need.condition}`}
                          className="flex flex-wrap items-center justify-between gap-3"
                        >
                          <span>
                            {depot?.code ?? need.depot_id} ·{" "}
                            {need.condition === "material"
                              ? "com material"
                              : "vazio"}{" "}
                            · {need.quantidade} dia(s)
                            {suggestedService ? null : (
                              <span className="ml-2 text-xs text-[var(--app-danger,#b91c1c)]">
                                sem serviço de armazenagem cadastrado para esta
                                condição
                              </span>
                            )}
                          </span>
                          {suggestedService ? (
                            <Button
                              variant="secondary"
                              disabled={!canEdit}
                              onClick={() =>
                                void addSuggestedArmazenagemLine(
                                  need,
                                  suggestedService,
                                )
                              }
                            >
                              <Plus size={14} /> Lançar
                            </Button>
                          ) : (
                            <Link
                              className="app-table__action"
                              to="/embarquevazios/depots"
                            >
                              Cadastrar
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              ) : null}
              <Card className="grid gap-3">
                <h2 className="app-panel__title">Linhas de Serviço</h2>
                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="Local">
                    <Select
                      value={line.localId}
                      onChange={(event) => {
                        setServiceNature("");
                        setLine((current) => ({
                          ...current,
                          localId: event.target.value,
                          serviceId: "",
                        }));
                      }}
                    >
                      <option value="">Selecione</option>
                      {depotRows.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.code} · {item.tipo}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Natureza">
                    <Select
                      value={serviceNature}
                      onChange={(event) => {
                        setServiceNature(event.target.value);
                        setLine((current) => ({
                          ...current,
                          serviceId: "",
                          destinoId: "",
                          condition: "",
                        }));
                      }}
                      disabled={!line.localId}
                    >
                      <option value="">Selecione</option>
                      <option value="armazenagem">Armazenagem</option>
                      <option value="transporte">Transporte</option>
                      <option value="geral">Geral</option>
                    </Select>
                  </Field>
                  <Field label="Serviço">
                    <Select
                      value={line.serviceId}
                      onChange={(event) => chooseService(event.target.value)}
                      disabled={!line.localId || !serviceNature}
                    >
                      <option value="">Selecione</option>
                      {offeredServices.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.natureza}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {selectedService?.natureza === "transporte" && selectedService.route_destino_id ? (
                    <Field label="Destino da rota">
                      <Select
                        value={line.destinoId}
                        onChange={(event) =>
                          setLine((current) => ({
                            ...current,
                            destinoId: event.target.value,
                          }))
                        }
                      >
                        <option value="">Selecione
                        </option>
                        {depotRows
                          .filter((item) => item.id === selectedService.route_destino_id)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.code} · {item.name ?? item.tipo}
                            </option>
                          ))}
                      </Select>
                    </Field>
                  ) : null}
                  {selectedService?.natureza === "armazenagem" && selectedService.condition ? (
                    <Field label="Condição">
                      <Select value={line.condition} disabled>
                        <option value={selectedService.condition}>
                          {selectedService.condition === "material" ? "EMPTY W/ MATERIAL" : "EMPTY"}
                        </option>
                      </Select>
                    </Field>
                  ) : null}
                  <Field label="Quantidade">
                    <Input
                      type="number"
                      min={0}
                      value={line.quantidade}
                      disabled={
                        selectedService?.natureza === "armazenagem" &&
                        !line.quantidadeManual
                      }
                      onChange={(event) =>
                        setLine((current) => ({
                          ...current,
                          quantidade: Number(event.target.value),
                        }))
                      }
                    />
                    {selectedService?.natureza === "armazenagem" ? (
                      <>
                        <label className="mt-1 flex gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={line.quantidadeManual}
                            onChange={(event) =>
                              setLine((current) => ({
                                ...current,
                                quantidadeManual: event.target.checked,
                              }))
                            }
                          />{" "}
                          Sobrescrever cálculo
                        </label>
                        <p className="mt-1 text-xs text-[var(--app-muted)]">
                          Calculada:{" "}
                          {quantidadeEfetiva(
                            {
                              natureza: "armazenagem",
                              local_id: local?.id ?? "",
                              condition: line.condition || null,
                              quantidade: line.quantidade,
                              valor_unitario: line.valor,
                              quantidade_manual: false,
                            },
                            units.data?.rows ?? [],
                            depotRows,
                          )}
                        </p>
                      </>
                    ) : null}
                  </Field>
                  <Field label="Valor unitário">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.valor}
                      onChange={(event) =>
                        setLine((current) => ({
                          ...current,
                          valor: Number(event.target.value),
                        }))
                      }
                    />
                  </Field>
                  <div className="self-end">
                    <Button
                      disabled={!canEdit || !line.serviceId || !line.localId}
                      onClick={() => void saveLine()}
                    >
                      <Plus size={16} /> Lançar linha
                    </Button>
                    {line.valorSugerido != null ? (
                      <p className="mt-1 text-xs text-[var(--app-muted)]">
                        Sugerido: {formatBRL(line.valorSugerido)}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact min-w-[900px] text-left text-sm whitespace-nowrap">
                    <thead>
                      <tr>
                        <th>Serviço</th>
                        <th>Local</th>
                        <th>Rota</th>
                        <th>Tipo</th>
                        <th>Quantidade</th>
                        <th>Unitário</th>
                        <th>Total</th>
                        <th>Observação</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {(operation.data?.linhas ?? []).map((item) => {
                        const natureza =
                          (item.service as { natureza?: string } | null)
                            ?.natureza ?? "geral";
                        const calculated = quantidadeEfetiva(
                          {
                            ...item,
                            natureza,
                            quantidade: Number(item.quantidade),
                            valor_unitario: Number(item.valor_unitario),
                          },
                          units.data?.rows ?? [],
                          depotRows,
                        );
                        return (
                          <tr key={item.id}>
                            <td>
                              {(item.service as { name?: string } | null)?.name ??
                                item.service_id}
                            </td>
                            <td>{depotRows.find((depot) => depot.id === item.local_id)?.code ?? item.local_id}</td>
                            <td>{depotRows.find((depot) => depot.id === item.destino_id)?.code ?? "—"}</td>
                            <td>{item.container_type ?? "—"}</td>
                            <td>
                              {calculated}
                              {item.quantidade_manual &&
                              natureza === "armazenagem" ? (
                                <span className="block text-xs text-[var(--app-muted)]">
                                  Calculada:{" "}
                                  {quantidadeEfetiva(
                                    {
                                      ...item,
                                      natureza,
                                      quantidade: Number(item.quantidade),
                                      valor_unitario: Number(item.valor_unitario),
                                      quantidade_manual: false,
                                    },
                                    units.data?.rows ?? [],
                                    depotRows,
                                  )}
                                </span>
                              ) : null}
                            </td>
                            <td>{formatBRL(Number(item.valor_unitario))}</td>
                            <td>
                              {formatBRL(
                                calculated *
                                  Number(item.valor_unitario) *
                                  (item.percentual == null
                                    ? 1
                                    : Number(item.percentual) / 100),
                              )}
                            </td>
                            <td className="min-w-64 whitespace-normal">
                              {editingServiceObservation === item.id ? (
                                <div className="grid gap-2">
                                  <textarea
                                    aria-label={`Observação — ${(item.service as { name?: string } | null)?.name ?? item.service_id}`}
                                    value={serviceObservationDraft}
                                    onChange={(event) => setServiceObservationDraft(event.target.value)}
                                    autoFocus
                                    className="min-h-16 rounded border border-[var(--app-border)] bg-transparent p-2 text-sm"
                                  />
                                  <div className="flex gap-2">
                                    <Button variant="secondary" className="app-btn--sm" onClick={() => setEditingServiceObservation(null)}>Voltar</Button>
                                    <Button className="app-btn--sm" onClick={() => void saveServiceObservation(item.id)}>Salvar</Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="grid gap-1">
                                  {item.observation ? <span className="whitespace-pre-line text-sm">{item.observation}</span> : <span className="text-sm text-[var(--app-muted)]">Sem observação</span>}
                                  <button type="button" className="justify-self-start text-xs font-semibold text-[var(--app-muted)] underline underline-offset-4 hover:text-[var(--app-text)]" onClick={() => { setServiceObservationDraft(item.observation ?? ""); setEditingServiceObservation(item.id); }}>
                                    {item.observation ? "Editar observação" : "Adicionar observação"}
                                  </button>
                                </div>
                              )}
                            </td>
                            <td>
                              <Button
                                variant="ghost"
                                aria-label="Excluir linha de serviço"
                                onClick={async () => {
                                  const confirmed = await confirm({
                                    title: "Excluir linha de serviço",
                                    message: `Excluir a linha de serviço ${(item.service as { name?: string } | null)?.name ?? item.service_id}?`,
                                    consequence:
                                      "O custo desta linha sai do embarque e do ADR de Saída desta escala.",
                                    reversibility: "Lance a linha de novo se precisar.",
                                    confirmLabel: "Excluir",
                                    tone: "danger",
                                  });
                                  if (!confirmed) return;
                                  void notify(async () => {
                                    await deleteServiceLine(item.id);
                                    await refreshOperationData();
                                  }, "Linha excluída.");
                                }}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
          <Modal
            open={importOpen}
            onClose={() => {
              setImportOpen(false);
              setFile(null);
            }}
            title="Importar Unidades Embarcadas"
          >
            <div className="grid gap-5">
              <div className="app-panel app-panel--padded text-sm">
                <div className="app-panel__title">Estrutura obrigatória da planilha</div>
                <div className="mt-2">CONTAINER, TIPO, LOCAL, CONDIÇÃO, ENTRADA, SAÍDA, EMBARQUE.</div>
                <div className="app-panel__meta mt-2">
                  O local deve usar o código cadastrado. Condição: vazio ou material.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    className="app-btn app-btn--secondary"
                    href="/templates/unidades-embarcadas-modelo.xlsx"
                    download="unidades-embarcadas-modelo.xlsx"
                  >
                    <Download size={16} /> Baixar modelo .xlsx
                  </a>
                </div>
              </div>
              <Field label="Arquivo .xlsx, .xls ou .csv">
                <Input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(event) =>
                    setFile(event.target.files?.[0] ?? null)
                  }
                />
              </Field>
              {file ? <div className="app-panel__meta">Arquivo selecionado: {file.name}</div> : null}
              <div className="app-modal__actions">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setImportOpen(false);
                    setFile(null);
                  }}
                >
                  Fechar
                </Button>
                <Button
                  disabled={!file || !canEdit}
                  onClick={() => void importUnits()}
                >
                  <Upload size={16} /> Importar
                </Button>
              </div>
            </div>
          </Modal>
        </div>
      ) : null}
    </div>
  );
}
