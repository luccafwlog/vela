import type {
  TablesInsert,
  VaziosBooking,
  VaziosExportOperation,
  VaziosExportServiceLine,
} from "../types/database";
import { supabase } from "./supabase";
import { normalizePortCode, portCodeVariants } from "./portCode";
import {
  armazenagemALancar,
  totaisDeArmazenagem,
  totalEmbarque,
  type CostServiceLine,
  type StorageCatalogService,
  type StorageDepot,
} from "./vaziosCusto";
import { deleteOneById } from "./deleteRecords";
import { calculateTeu } from "./containerTeu";
import { vazioManifestoNumero } from "./vaziosImportacaoImport";

const OPERATION_BOOKINGS_PAGE_SIZE = 1000;

export type VaziosExportServiceLineWithObservation = VaziosExportServiceLine & {
  observation: string | null;
  /** Migration 606; `database.ts` protegido ainda não a descreve. */
  free_time_days?: number | null;
};

export type ManualBookingInput = {
  operationId: string;
  voyageId: number;
  manifestId: string;
  containerNumber: string;
  containerType?: string | null;
  localId: string;
  condition: "vazio" | "material";
  handInDate?: string | null;
  handOutDate?: string | null;
  movementDate?: string | null;
  /** Porto de descarga (LOCODE), obrigatório desde a migration 606. */
  pod: string;
};

export function manualBookingPayload(input: ManualBookingInput) {
  const container_number = input.containerNumber
    .replace(/\s/g, "")
    .toUpperCase();
  if (!/^[A-Z]{4}\d{7}$/.test(container_number))
    throw new Error("Container inválido.");
  return {
    operation_id: input.operationId,
    voyage_id: input.voyageId,
    manifest_id: input.manifestId,
    container_number,
    container_type: input.containerType ?? null,
    local_id: input.localId,
    condition: input.condition,
    hand_in_date: input.handInDate ?? null,
    hand_out_date: input.handOutDate ?? null,
    movement_date: input.movementDate ?? null,
    pod: input.pod.trim().toUpperCase(),
  };
}

export async function createManualVaziosBooking(
  input: Omit<ManualBookingInput, "manifestId"> & {
    uploadedBy?: string | null;
  },
) {
  if (!input.uploadedBy) throw new Error("Usuário não autenticado.");
  const payload = manualBookingPayload({ ...input, manifestId: "manual" });
  const { error } = await supabase.rpc(
    "create_manual_vazios_booking" as never,
    {
      p_operation_id: payload.operation_id,
      p_voyage_id: payload.voyage_id,
      p_uploaded_by: input.uploadedBy,
      p_container_number: payload.container_number,
      p_container_type: payload.container_type,
      p_local_id: payload.local_id,
      p_condition: payload.condition,
      p_hand_in_date: payload.hand_in_date,
      p_hand_out_date: payload.hand_out_date,
      p_movement_date: payload.movement_date,
      p_pod: payload.pod,
    } as never,
  );
  if (error) throw error;
}

export async function updateManualVaziosBooking(
  id: string,
  input: Omit<ManualBookingInput, "operationId" | "voyageId" | "manifestId">,
) {
  const container_number = input.containerNumber
    .replace(/\s/g, "")
    .toUpperCase();
  if (!/^[A-Z]{4}\d{7}$/.test(container_number))
    throw new Error("Container inválido.");
  const { error } = await supabase.rpc(
    "update_manual_vazios_booking" as never,
    {
      p_booking_id: id,
      p_container_number: container_number,
      p_container_type: input.containerType ?? null,
      p_local_id: input.localId,
      p_condition: input.condition,
      p_hand_in_date: input.handInDate ?? null,
      p_hand_out_date: input.handOutDate ?? null,
      p_movement_date: input.movementDate ?? null,
      p_pod: input.pod.trim().toUpperCase(),
    } as never,
  );
  if (error) throw error;
}

/**
 * ADR 0095, decisão 22 (migration 398): com o ADR de Saída do porto de
 * embarque fechado, nada muda no Embarque de vazios; a tela desabilita as
 * ações e o banco recusa do mesmo jeito.
 */
export async function isVaziosExportLockedByAdr(voyageId: number, port: string): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "vazios_export_adr_locked" as never,
    { p_voyage_id: voyageId, p_port: port } as never,
  );
  if (error) throw error;
  return data === true;
}

/** B14 (migration 262): exclui com motivo; o banco recusa com o ADR de Saída fechado. */
export async function deleteManualVaziosBooking(id: string, reason: string) {
  const { error } = await supabase.rpc(
    "delete_manual_vazios_booking" as never,
    { p_booking_id: id, p_reason: reason } as never,
  );
  if (error) throw error;
}

/**
 * Migration 544: o Administrativo exclui, com motivo, o embarque sem unidade,
 * sem linha de serviço e com o ADR de Saída aberto. Recusa traz os motivos.
 */
export async function deleteVaziosExportOperation(operationId: string, reason: string) {
  const { data, error } = await supabase.rpc(
    "delete_vazios_export_operation" as never,
    { p_operation_id: operationId, p_dry_run: false, p_reason: reason } as never,
  );
  if (error) throw error;
  const result = data as unknown as { deleted: boolean; reasons: string[] };
  if (!result.deleted) throw new Error(`O embarque não pode ser excluído: ${result.reasons.join("; ")}.`);
}

export async function listVaziosBookingsForOperation(operationId: string) {
  const rows: VaziosBooking[] = [];
  let page = 1;
  let count = Number.POSITIVE_INFINITY;
  while (rows.length < count) {
    const from = (page - 1) * OPERATION_BOOKINGS_PAGE_SIZE;
    const {
      data,
      count: resultCount,
      error,
    } = await supabase
      .from("vazios_bookings")
      .select("*", { count: "exact" })
      .eq("operation_id", operationId)
      .order("container_number")
      .range(from, from + OPERATION_BOOKINGS_PAGE_SIZE - 1);
    if (error) throw error;
    const pageRows = (data ?? []) as VaziosBooking[];
    rows.push(...pageRows);
    count = resultCount ?? 0;
    if (pageRows.length === 0) break;
    page += 1;
  }
  return { rows, count: Number.isFinite(count) ? count : 0 };
}

/**
 * Storage do ADR: unidades com dia cobrável e os dias cobráveis, com o free
 * time congelado nas linhas de armazenagem (606). A unidade de Depot que ficou
 * dentro do free time não gerou armazenagem e não conta (C2), e a quantidade
 * informada à mão na linha vale, com o calculado pela lista ao lado (C4;
 * revisão de 2026-11-06). Regra em `totaisDeArmazenagem`.
 */
export function computeStorageTotals(
  rows: Array<
    Pick<
      VaziosBooking,
      "local_id" | "condition" | "hand_in_date" | "hand_out_date"
    > & { container_type?: string | null }
  >,
  depots: StorageDepot[] = [],
  lines: CostServiceLine[] = [],
): { containers: number; days: number; calculatedDays: number } {
  return totaisDeArmazenagem(rows, depots, lines);
}

export async function getVaziosExportOperation(
  voyageId: number,
  embarkPort: string,
) {
  const { data, error } = await supabase
    .from("vazios_export_operations")
    .select(
      "*, linhas:vazios_export_service_lines(*, service:depot_services(*), local:depots!vazios_export_service_lines_local_id_fkey(*), destino:depots!vazios_export_service_lines_destino_id_fkey(*))",
    )
    .eq("voyage_id", voyageId)
    .eq("embark_port", embarkPort)
    .maybeSingle();
  if (error) throw error;
  return data as
    | (VaziosExportOperation & {
        service_qty: Array<{
          depot_service_id: string;
          qty: number;
          service: { name: string } | null;
        }>;
        linhas: Array<
          VaziosExportServiceLineWithObservation & {
            service: unknown;
            local: unknown;
            destino: unknown;
          }
        >;
      })
    | null;
}

export async function upsertServiceLine(
  input: Omit<TablesInsert<"vazios_export_service_lines">, "id" | "created_at" | "updated_at"> & {
    id?: string;
  },
) {
  const payload = { ...input, updated_at: new Date().toISOString() };
  const query = input.id
    ? supabase
        .from("vazios_export_service_lines")
        .update(payload)
        .eq("id", input.id)
        .select("*")
        .single()
    : supabase
        .from("vazios_export_service_lines")
        .insert(payload)
        .select("*")
        .single();
  const { data, error } = await query;
  if (error) throw error;
  return data as VaziosExportServiceLine;
}

export async function deleteServiceLine(id: string, reason: string) {
  const { error } = await deleteOneById("vazios_export_service_lines", id, reason);
  if (error) throw error;
}

export async function updateServiceLineObservation(id: string, observation: string) {
  const { error } = await supabase
    .from("vazios_export_service_lines")
    .update({ observation: observation.trim() || null } as never)
    .eq("id", id);
  if (error) throw error;
}

/**
 * Portos brasileiros da viagem que já têm Embarque de Vazios registrado,
 * normalizados. É o que impede retirar a declaração de exportação de uma escala
 * que já opera vazios.
 */
export async function listVaziosExportEmbarkPorts(voyageId: number): Promise<string[]> {
  const { data, error } = await supabase
    .from("vazios_export_operations")
    .select("embark_port")
    .eq("voyage_id", voyageId);
  if (error) throw error;

  const ports = new Set<string>();
  for (const row of (data ?? []) as Array<{ embark_port: string | null }>) {
    const normalized = normalizePortCode(row.embark_port);
    if (normalized) ports.add(normalized);
  }
  return Array.from(ports);
}

/**
 * Abre o embarque da escala (Viagem + porto) ou o cria, com o terminal onde ele
 * opera (ADR 0113, migration 541). O terminal é da frente Vazios EXP da escala:
 * sem terminal nela, a RPC grava o escolhido pela gravação da escala (frente,
 * Atracação e ADR do terminal); com terminal, o embarque usa esse e `terminalId`
 * pode ir vazio. `created` diz se o embarque nasceu agora ou já existia (V4).
 */
export async function createVaziosExportOperation(input: {
  voyageId: number;
  embarkPort: string;
  terminalId: string | null;
}): Promise<{ id: string; created: boolean; terminalId: string | null }> {
  const { data, error } = await supabase.rpc(
    "create_vazios_export_operation" as never,
    { p_voyage_id: input.voyageId, p_port: input.embarkPort, p_terminal_id: input.terminalId } as never,
  );
  if (error) throw error;
  const result = (data ?? {}) as { id?: unknown; created?: unknown; terminal_id?: unknown };
  if (typeof result.id !== "string") throw new Error("Resposta inválida ao criar o embarque de vazios.");
  return {
    id: result.id,
    created: result.created === true,
    terminalId: typeof result.terminal_id === "string" ? result.terminal_id : null,
  };
}

export type VaziosExportTerminalOption = { id: string; code: string; name: string | null };

export type VaziosExportTerminalChoice = {
  /** Terminal da frente Vazios EXP da escala; null sem a frente ou com ela em TBC. */
  frontTerminal: VaziosExportTerminalOption | null;
  /** Terminais portuários ativos do porto, para escolher quando a frente não tem terminal. */
  options: VaziosExportTerminalOption[];
};

/**
 * Terminal do embarque de vazios de uma escala: o da frente Vazios EXP, e os
 * terminais portuários ativos do porto para a escolha (ADR 0113).
 */
export async function fetchVaziosExportTerminalChoice(voyageId: number, port: string): Promise<VaziosExportTerminalChoice> {
  const normalized = normalizePortCode(port) ?? port.trim().toUpperCase();
  const [fronts, ports] = await Promise.all([
    supabase
      .from("voyage_escala_operation_fronts")
      .select("terminal_id")
      .eq("voyage_id", voyageId)
      .in("port", portCodeVariants(normalized))
      .eq("sentido", "exportacao")
      .eq("modalidade", "vazio"),
    supabase.from("ports").select("id").eq("locode", normalized),
  ]);
  if (fronts.error) throw fronts.error;
  if (ports.error) throw ports.error;
  const frontTerminalId = ((fronts.data ?? []) as Array<{ terminal_id: string | null }>)
    .map((row) => row.terminal_id)
    .find((id): id is string => typeof id === "string") ?? null;
  const portIds = ((ports.data ?? []) as Array<{ id: number }>).map((row) => row.id);
  // O terminal da frente entra mesmo inativo ou de outro cadastro de porto, para
  // a tela dizer qual é.
  const filters = [
    ...(portIds.length > 0 ? [`port_id.in.(${portIds.join(",")})`] : []),
    ...(frontTerminalId ? [`id.eq.${frontTerminalId}`] : []),
  ];
  let terminals: Array<VaziosExportTerminalOption & { active: boolean; port_id: number | null }> = [];
  if (filters.length > 0) {
    const { data, error } = await supabase
      .from("depots")
      .select("id, code, name, active, port_id")
      .eq("tipo", "terminal_portuario")
      .or(filters.join(","))
      .order("code");
    if (error) throw error;
    terminals = (data ?? []) as typeof terminals;
  }
  const toOption = ({ id, code, name }: VaziosExportTerminalOption): VaziosExportTerminalOption => ({ id, code, name });
  const front = frontTerminalId ? terminals.find((item) => item.id === frontTerminalId) : undefined;
  return {
    frontTerminal: frontTerminalId ? (front ? toOption(front) : { id: frontTerminalId, code: frontTerminalId, name: null }) : null,
    options: terminals
      .filter((item) => item.active && item.port_id != null && portIds.includes(item.port_id))
      .map(toOption),
  };
}

export type VaziosOperationListRow = {
  id: string;
  voyage_id: number;
  embark_port: string;
  created_at: string;
  updated_at: string;
  voyage?: { vessel?: { name?: string | null } | null; voyage_number?: string | null } | null;
  linhas?: Array<{
    local_id: string;
    condition: string | null;
    container_type?: string | null;
    free_time_days?: number | null;
    quantidade: number | string;
    valor_unitario: number | string;
    quantidade_manual: boolean;
    updated_at?: string | null;
    service?: { natureza?: string | null } | null;
  }> | null;
};

export type VaziosOperationBookingRow = Pick<
  VaziosBooking,
  "operation_id" | "local_id" | "condition" | "hand_in_date" | "hand_out_date" | "created_at"
> & {
  /** O tamanho decide em que linha de armazenagem a unidade conta (606). */
  container_type?: string | null;
  /** Migration 332; vazia nas unidades anteriores a ela (`database.ts` protegido ainda não a descreve). */
  updated_at?: string | null;
};

/**
 * Todos os embarques com as linhas de serviço e as unidades, para a lista de
 * embarques (unidades, total dos serviços, armazenagem a lançar).
 * ponytail: lê todas as unidades de todos os embarques e soma no navegador;
 * com volume grande, o upgrade é uma RPC de resumo por embarque.
 */
export async function listVaziosExportOperationsWithUnits(): Promise<{
  operations: VaziosOperationListRow[];
  bookings: VaziosOperationBookingRow[];
}> {
  // O servidor corta cada leitura em max_rows (1.000): embarques e unidades vêm em páginas.
  const operations: VaziosOperationListRow[] = [];
  for (let from = 0; ; from += OPERATION_BOOKINGS_PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from("vazios_export_operations")
      .select(
        "id, voyage_id, embark_port, created_at, updated_at, voyage:voyages(voyage_number, vessel:vessels(name)), linhas:vazios_export_service_lines(local_id, condition, container_type, free_time_days, quantidade, valor_unitario, quantidade_manual, updated_at, service:depot_services(natureza))",
      )
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + OPERATION_BOOKINGS_PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (page ?? []) as unknown as VaziosOperationListRow[];
    operations.push(...rows);
    if (rows.length < OPERATION_BOOKINGS_PAGE_SIZE) break;
  }
  const bookings: VaziosOperationBookingRow[] = [];
  for (let from = 0; ; from += OPERATION_BOOKINGS_PAGE_SIZE) {
    const { data: page, error: pageError } = await supabase
      .from("vazios_bookings")
      .select("operation_id, container_type, local_id, condition, hand_in_date, hand_out_date, created_at, updated_at")
      .order("id")
      .range(from, from + OPERATION_BOOKINGS_PAGE_SIZE - 1);
    if (pageError) throw pageError;
    const rows = (page ?? []) as unknown as VaziosOperationBookingRow[];
    bookings.push(...rows);
    if (rows.length < OPERATION_BOOKINGS_PAGE_SIZE) break;
  }
  return { operations, bookings };
}

export type VaziosOperationSummary = {
  id: string;
  voyage_id: number;
  embark_port: string;
  voyage: VaziosOperationListRow["voyage"];
  unidades: number;
  servicos: number;
  /** Locais com armazenagem calculada e ainda sem linha (0 dia não conta). */
  armazenagemLocais: number;
  atualizadoEm: string;
};

/** Resumo de cada embarque para a lista, do mais recente para o mais antigo. */
export function summarizeVaziosOperations(
  operations: VaziosOperationListRow[],
  bookings: VaziosOperationBookingRow[],
  depots: StorageDepot[],
  /** Serviços de armazenagem do catálogo: dizem se a armazenagem se divide por tamanho (606). */
  catalogo: StorageCatalogService[] = [],
): VaziosOperationSummary[] {
  const byOperation = new Map<string, VaziosOperationBookingRow[]>();
  for (const booking of bookings) {
    const list = byOperation.get(booking.operation_id) ?? [];
    list.push(booking);
    byOperation.set(booking.operation_id, list);
  }
  return operations
    .map((operation) => {
      const unidades = byOperation.get(operation.id) ?? [];
      const linhas = (operation.linhas ?? []).map((line) => ({
        natureza: line.service?.natureza ?? "geral",
        local_id: line.local_id,
        condition: line.condition,
        container_type: line.container_type ?? null,
        free_time_days: line.free_time_days ?? null,
        quantidade: Number(line.quantidade),
        valor_unitario: Number(line.valor_unitario),
        quantidade_manual: line.quantidade_manual,
      }));
      const pendentes = armazenagemALancar(unidades, depots, linhas, catalogo);
      const dates = [
        ...(operation.linhas ?? []).map((line) => line.updated_at ?? null),
        // ponytail: unidade excluída some sem deixar data; o "Atualizado em"
        // só sobe com a inclusão ou a alteração (migration 332).
        ...unidades.map((unit) => unit.updated_at ?? unit.created_at ?? null),
      ].filter((value): value is string => Boolean(value));
      return {
        id: operation.id,
        voyage_id: operation.voyage_id,
        embark_port: operation.embark_port,
        voyage: operation.voyage ?? null,
        unidades: unidades.length,
        servicos: totalEmbarque({ unidades, linhas, depots }),
        armazenagemLocais: new Set(pendentes.map((item) => item.depot_id)).size,
        atualizadoEm: dates.reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest), operation.updated_at),
      };
    })
    .sort((a, b) => Date.parse(b.atualizadoEm) - Date.parse(a.atualizadoEm));
}

export type EmptyExportRoute = {
  /** Porto de descarga; vazio na unidade gravada antes da 606 sem POD. */
  pod: string
  unidades: number
  teu: number
  /** Nº do Manifesto Mercante da rota (porto do embarque → POD), quando informado. */
  manifesto: string | null
}

/**
 * Rotas de exportação dos vazios (porto do embarque → POD), com as unidades,
 * o TEU e o Nº do Manifesto Mercante da rota (606; decisão do dono de
 * 2026-11-06: os vazios embarcam já manifestados, o Vela registra o número).
 */
export function summarizeEmptyExportRoutes(
  units: ReadonlyArray<{ pod?: string | null; container_type?: string | null }>,
  embarkPort: string,
  voyageId: number,
  manifestos: ReadonlyArray<{ voyage_id: number; pol: string; pod: string; numero: string }>,
): EmptyExportRoute[] {
  const byPod = new Map<string, Array<string | null>>()
  for (const unit of units) {
    const pod = unit.pod ?? ''
    byPod.set(pod, [...(byPod.get(pod) ?? []), unit.container_type ?? null])
  }
  return [...byPod.entries()]
    .map(([pod, types]) => ({
      pod,
      unidades: types.length,
      teu: calculateTeu(types).teu,
      manifesto: pod ? vazioManifestoNumero({ pol: embarkPort, pod, manifest: { voyage_id: voyageId } }, manifestos) : null,
    }))
    .sort((a, b) => (a.pod || '~').localeCompare(b.pod || '~'))
}
