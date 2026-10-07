import { ceUnlockSlaState, formatCeUnlockDeadline } from "../../services/ceUnlockSla";

const LABEL = { overdue: "Vencido", today: "Vence hoje", ok: "No prazo", none: "" } as const;

/**
 * Prazo (SLA) de desbloqueio: data limite e se está vencido, vence hoje ou no prazo.
 * Com `doneAt` (data da exportação) mostra se o prazo foi cumprido — é a data da exportação que mede o SLA.
 */
export function CeUnlockSla({
  start,
  doneAt,
  now,
}: {
  start: string | null | undefined;
  doneAt?: string | null;
  now?: Date;
}) {
  const { deadline, state } = ceUnlockSlaState(start, doneAt ? new Date(doneAt) : now);
  if (!deadline) return <span className="text-[var(--app-muted)]">—</span>;
  const missed = state === "overdue";
  const tone = missed
    ? "text-[var(--app-red)]"
    : !doneAt && state === "today"
      ? "text-[#a85309] dark:text-[var(--app-gold-strong)]"
      : "text-[var(--app-muted)]";
  return (
    <span data-sla={doneAt ? (missed ? "late" : "met") : state} className="app-table__cell-stack">
      <span className="app-table__cell-value whitespace-nowrap">{formatCeUnlockDeadline(deadline)}</span>
      <small className={`whitespace-normal text-xs font-semibold ${tone}`}>
        {doneAt ? (missed ? "Exportado fora do prazo" : "Exportado no prazo") : LABEL[state]}
      </small>
    </span>
  );
}
