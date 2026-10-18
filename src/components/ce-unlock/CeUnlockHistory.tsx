import { useId, useState } from "react";
import { Block } from "../ui/Block";
import { Button } from "../ui/Button";
import { NoValue } from "../ui/NoValue";
import { ceActionLabel, ceDateTime } from "../../lib/ceUnlockLabels";
import type { CeUnlockRequest } from "../../types/ceUnlock";

/**
 * Histórico da solicitação no Portal (lote 4 da identidade): bloco fechado por
 * padrão, porque é consulta e não ação; aberto, uma tabela com quando, o que
 * aconteceu e o motivo. O interno usa `CeUnlockHistoryTable`, com quem fez.
 */
export function CeUnlockHistory({ events }: { events: CeUnlockRequest["events"] }) {
  const [open, setOpen] = useState(false);
  const tableId = useId();
  if (!events.length) return null;
  return (
    <Block
      title="Histórico"
      headingLevel={3}
      flush
      aside={
        <>
          <span>{events.length === 1 ? "1 registro" : `${events.length} registros`}</span>
          <Button variant="ghost" className="app-btn--sm" aria-expanded={open} aria-controls={tableId} onClick={() => setOpen((v) => !v)}>
            {open ? "Ocultar" : "Mostrar"}
          </Button>
        </>
      }
    >
      {open ? (
        <div className="app-table-scroll" id={tableId}>
          <table className="app-table app-table--compact text-sm">
            <caption className="sr-only">Histórico da solicitação</caption>
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col" className="app-table__text-head">O que aconteceu</th>
                <th scope="col" className="app-table__text-head">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap tabular-nums">{ceDateTime(e.created_at)}</td>
                  <td className="app-table__text">{ceActionLabel(e.action)}</td>
                  <td className="app-table__text app-table__text--wrap">{e.reason || <NoValue label="Sem motivo" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Block>
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
