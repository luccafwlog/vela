// Prazo (SLA) de desbloqueio de CE. Ver docs/archive/specs/2026-10-07-desbloqueio-ce-revisao-fluxo-design.md (D15–D19).
//
// Janela da manhã (início antes das 12:00): vence às 17:00 do mesmo dia útil.
// Janela da tarde (início a partir das 12:00): vence às 12:30 do próximo dia útil.
// Sábado e domingo vencem às 12:00 de segunda.
// ponytail: só dias úteis (seg–sex), sem calendário de feriados; e fuso fixo -03:00
// porque America/Sao_Paulo não tem horário de verão desde 2019. Se um dos dois mudar,
// trocar por Intl com timeZone e uma tabela de feriados.
const OFFSET_MS = -3 * 3_600_000;
const MORNING_CUTOFF_HOUR = 12;
const MORNING_DEADLINE = { hour: 17, minute: 0 };
const AFTERNOON_DEADLINE = { hour: 12, minute: 30 };
const WEEKEND_DEADLINE = { hour: 12, minute: 0 };

export type CeUnlockSlaState = "none" | "ok" | "today" | "overdue";

const isBusinessDay = (local: Date) => ![0, 6].includes(local.getUTCDay());

function nextBusinessDay(local: Date): Date {
  const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  do day.setUTCDate(day.getUTCDate() + 1);
  while (!isBusinessDay(day));
  return day;
}

/** Instante-limite para desbloquear um pedido cujo prazo começou em `start`. */
export function ceUnlockDeadline(start: Date | string): Date {
  const local = new Date(new Date(start).getTime() + OFFSET_MS);
  let day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  let slot = MORNING_DEADLINE;
  if (!isBusinessDay(local)) {
    day = nextBusinessDay(local);
    slot = WEEKEND_DEADLINE;
  }
  else if (local.getUTCHours() >= MORNING_CUTOFF_HOUR) {
    day = nextBusinessDay(local);
    slot = AFTERNOON_DEADLINE;
  }
  day.setUTCHours(slot.hour, slot.minute, 0, 0);
  return new Date(day.getTime() - OFFSET_MS);
}

const localDay = (instant: Date) => new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 10);

export function ceUnlockSlaState(
  start: string | null | undefined,
  now: Date = new Date(),
): { deadline: Date | null; state: CeUnlockSlaState } {
  if (!start) return { deadline: null, state: "none" };
  const deadline = ceUnlockDeadline(start);
  if (now > deadline) return { deadline, state: "overdue" };
  return { deadline, state: localDay(deadline) === localDay(now) ? "today" : "ok" };
}

export const formatCeUnlockDeadline = (deadline: Date) =>
  deadline.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Início de prazo mais recente entre os BLs: o prazo final do pedido parte da última pendência resolvida. */
export const latestSlaStart = (items: Array<{ sla_started_at?: string | null }>) =>
  items.reduce<string | null>(
    (latest, i) => (i.sla_started_at && (!latest || i.sla_started_at > latest) ? i.sla_started_at : latest),
    null,
  );
