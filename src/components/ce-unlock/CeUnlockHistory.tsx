import { Block } from "../ui/Block";
import { NoValue } from "../ui/NoValue";
import { ceActionLabel, ceDateTime } from "../../lib/ceUnlockLabels";
import type { CeUnlockRequest } from "../../types/ceUnlock";

/** Histórico do pedido no Portal, recolhido por padrão: é consulta, não ação. O interno usa `CeUnlockHistoryTable`. */
export function CeUnlockHistory({ events }: { events: CeUnlockRequest["events"] }) {
  if (!events.length) return null;
  return (
    <details className="group">
      <summary className="app-panel__title cursor-pointer select-none">Histórico ({events.length})</summary>
      <ol className="mt-3 space-y-2 border-l border-[var(--app-border)] pl-4">
        {events.map((e) => (
          <li key={e.id} className="text-sm">
            <span className="block text-xs text-[var(--app-muted)]">{ceDateTime(e.created_at)}</span>
            <span className="text-[var(--app-text-strong)]">{ceActionLabel(e.action)}</span>
            {e.reason ? <span className="text-[var(--app-muted)]"> · {e.reason}</span> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}


/** Histórico do pedido em tabela aberta (lote 3 da identidade): quando, o que aconteceu, por quem e o motivo. */
export function CeUnlockHistoryTable({ events }: { events: CeUnlockRequest["events"] }) {
  if (!events.length) return null;
  return (
    <Block title="Histórico" headingLevel={3} flush aside={events.length === 1 ? "1 registro" : `${events.length} registros`}>
      <div className="app-table-scroll">
        <table className="app-table app-table--compact text-sm">
          <caption className="sr-only">Histórico da solicitação</caption>
          <thead>
            <tr>
              <th scope="col">Quando</th>
              <th scope="col" className="app-table__text-head">O que aconteceu</th>
              <th scope="col" className="app-table__text-head">Por</th>
              <th scope="col" className="app-table__text-head">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap tabular-nums">{ceDateTime(e.created_at)}</td>
                <td className="app-table__text">{ceActionLabel(e.action)}</td>
                <td className="app-table__text">{e.actor || <NoValue label="Autor não registrado" />}</td>
                <td className="app-table__text">{e.reason || <NoValue label="Sem motivo" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}
