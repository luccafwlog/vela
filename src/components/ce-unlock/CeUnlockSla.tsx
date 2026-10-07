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
  if (!deadline) return <span>—</span>;
  const missed = state === "overdue";
  return (
    <span
      data-sla={doneAt ? (missed ? "late" : "met") : state}
      className={missed ? "font-semibold text-red-600" : !doneAt && state === "today" ? "font-semibold text-amber-600" : undefined}
    >
      {formatCeUnlockDeadline(deadline)}
      <small className="block">{doneAt ? (missed ? "Exportado fora do prazo" : "Exportado no prazo") : LABEL[state]}</small>
    </span>
  );
}
