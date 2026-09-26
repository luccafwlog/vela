import type {
  TablesInsert,
  VaziosBooking,
  VaziosExportOperation,
  VaziosExportServiceLine,
} from "../types/database";
import { supabase } from "./supabase";
import { normalizePortCode } from "./portCode";
import { diasCobraveis } from "./vaziosCusto";
import { deleteOneById } from "./deleteRecords";

const OPERATION_BOOKINGS_PAGE_SIZE = 1000;

export type VaziosExportServiceLineWithObservation = VaziosExportServiceLine & {
  observation: string | null;
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
    } as never,
  );
  if (error) throw error;
}

export async function deleteManualVaziosBooking(id: string) {
  const { error } = await supabase.rpc(
    "delete_manual_vazios_booking" as never,
    { p_booking_id: id } as never,
  );
  if (error) throw error;
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

export function computeStorageTotals(
  rows: Array<
    Pick<
      VaziosBooking,
      "local_id" | "condition" | "hand_in_date" | "hand_out_date"
    >
  >,
  depots: Array<{
    id: string;
    tipo?: string;
    free_time_vazio_days?: number;
    free_time_material_days?: number;
  }> = [],
): { containers: number; days: number } {
  let containers = 0;
  let days = 0;
  for (const row of rows) {
    const depot = depots.find((item) => item.id === row.local_id);
    const chargeable = diasCobraveis(row, depot);
    if (chargeable <= 0 && (!row.hand_in_date || !row.hand_out_date)) continue;
    if (
      row.hand_in_date &&
      row.hand_out_date &&
      Date.parse(row.hand_out_date) >= Date.parse(row.hand_in_date)
    )
      containers += 1;
    days += chargeable;
  }
  return { containers, days };
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

export async function upsertVaziosExportOperation(input: {
  voyageId: number;
  embarkPort: string;
  osNumber?: string | null;
}) {
  const { data, error } = await supabase
    .from("vazios_export_operations")
    .upsert(
      {
        voyage_id: input.voyageId,
        embark_port: input.embarkPort,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "voyage_id,embark_port" },
    )
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
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

export async function updateVaziosBooking(
  id: string,
  patch: Partial<VaziosBooking> & Record<string, unknown>,
) {
  const { error } = await supabase
    .from("vazios_bookings")
    .update(patch as never)
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
