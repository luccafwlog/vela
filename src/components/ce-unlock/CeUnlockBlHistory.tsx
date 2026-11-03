import { InlineError } from "../ui/Card";
import { NoValue } from "../ui/NoValue";
import { useCeUnlockBlHistory } from "../../hooks/useCeUnlock";
import { ceBlHistoryText, ceDateTime } from "../../lib/ceUnlockLabels";
import { CeUnlockRequirementIcon } from "./CeUnlockRequirements";

/**
 * Histórico de um B/L na aba Andamento dos B/Ls (pedido do dono de 2026-11-03,
 * migration 577): quando e por quem cada requisito foi cumprido ou desfeito, com
 * ou sem solicitação, mais o andamento das solicitações e o envio à ZPT. O mais
 * recente primeiro.
 */
export function CeUnlockBlHistory({ blId }: { blId: string }) {
  const history = useCeUnlockBlHistory(blId);
  if (history.isLoading) return <p className="text-sm text-[var(--app-muted)]">Carregando histórico…</p>;
  if (history.error || !history.data) return <InlineError message="Falha ao consultar o histórico do B/L." />;
  const { item, events } = history.data;
  const vipAnnual = !item.request_id && !!item.vip_covered;
  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Requisitos hoje">
        <li className="inline-flex items-center gap-2">
          <CeUnlockRequirementIcon label="Termo de devolução" ok={item.termo} dispensed={item.documents_dispensed} vipAnnual={vipAnnual} />
          Termo de devolução
        </li>
        <li className="inline-flex items-center gap-2">
          <CeUnlockRequirementIcon label="Procuração" ok={item.procuracao} dispensed={item.documents_dispensed} vipAnnual={vipAnnual} />
          Procuração
        </li>
        <li className="inline-flex items-center gap-2">
          <CeUnlockRequirementIcon label="Taxas locais" ok={item.paid} />
          Taxas locais
        </li>
        <li className="inline-flex items-center gap-2">
          <CeUnlockRequirementIcon label="B/L original" ok={item.delivered} />
          B/L original
        </li>
      </ul>
      {events.length === 0 ? (
        <p className="text-sm text-[var(--app-muted)]">Nenhum registro de requisito para este B/L ainda.</p>
      ) : (
        <div className="app-table-scroll">
          <table className="app-table app-table--compact text-sm">
            <caption className="sr-only">Histórico do B/L {blId}</caption>
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col" className="app-table__text-head">Requisito</th>
                <th scope="col" className="app-table__text-head">O que aconteceu</th>
                <th scope="col" className="app-table__text-head">Por</th>
                <th scope="col" className="app-table__text-head">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, n) => {
                const { requirement, text } = ceBlHistoryText(e);
                return (
                  <tr key={`${e.at}-${e.event}-${n}`}>
                    <td className="whitespace-nowrap tabular-nums">{ceDateTime(e.at)}</td>
                    <td className="app-table__text">{requirement}</td>
                    <td className="app-table__text">{text}</td>
                    <td className="app-table__text">{e.actor || <NoValue label="Autor não registrado" />}</td>
                    <td className="app-table__text">{e.reason || <NoValue label="Sem motivo" />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
