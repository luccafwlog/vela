import { ceUnlockSlaState, formatCeUnlockDeadline } from "../../services/ceUnlockSla";
import { NoValue } from "../ui/NoValue";
import { StatusText } from "../ui/StatusText";

const timeOf = (deadline: Date) =>
  deadline.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

/**
 * Prazo (SLA) de desbloqueio numa célula (lote 3 da identidade): a data limite;
 * "Hoje, HH:MM" em âmbar quando vence hoje; "Venceu dd/mm, HH:MM" em vermelho
 * quando passou sem exportação. Com `doneAt` (data da exportação) o prazo já
 * foi medido: mostra só a data, e o title diz se foi cumprido.
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
  if (!deadline) return <NoValue label="Sem prazo" />;
  const text = formatCeUnlockDeadline(deadline);
  if (doneAt)
    return (
      <span data-sla={state === "overdue" ? "late" : "met"} className="whitespace-nowrap" title={state === "overdue" ? "Exportado fora do prazo" : "Exportado no prazo"}>
        {text}
      </span>
    );
  return (
    <span data-sla={state} className="whitespace-nowrap">
      {state === "overdue" ? (
        <StatusText tone="danger">Venceu {text}</StatusText>
      ) : state === "today" ? (
        <StatusText tone="warning">Hoje, {timeOf(deadline)}</StatusText>
      ) : (
        text
      )}
    </span>
  );
}
