import { useState } from "react";
import { FileCheck2 } from "lucide-react";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card, EmptyState } from "../ui/Card";
import { SkeletonTable } from "../ui/Skeleton";
import { TableFooterPagination } from "../ui/TableFooterPagination";
import { QueryStateGate } from "../shared/QueryStateGate";
import { CeUnlockSla } from "./CeUnlockSla";
import { useCeUnlockReviewQueue } from "../../hooks/useCeUnlock";
import { ceStateLabel, ceStateTone } from "../../lib/ceUnlockLabels";
import type { CeUnlockReviewRow } from "../../types/ceUnlock";

const PAGE_SIZE = 25;
const DOCUMENT_STATUS: Record<string, [string, BadgeTone]> = {
  uploaded: ["Aguardando análise", "yellow"],
  approved: ["Aprovado", "green"],
  changes_requested: ["Recusado — aguardando cliente", "red"],
  revoked: ["Revogado", "red"],
};
function DocumentStatus({ status }: { status: CeUnlockReviewRow["termo_status"] }) {
  const [label, tone] = status ? (DOCUMENT_STATUS[status] ?? [status, "slate"]) : ["Não enviado", "slate" as BadgeTone];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Aba Solicitações: uma linha por pedido; termo de devolução e procuração valem para todos os BLs dele. */
export function CeUnlockReviewQueue({ enabled, onOpen }: { enabled: boolean; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const queue = useCeUnlockReviewQueue(page, enabled);
  const total = queue.data?.total ?? 0;
  return (
    <Card className="overflow-hidden p-0">
      <QueryStateGate
        isLoading={false}
        isError={Boolean(queue.error)}
        hasData={queue.data !== undefined}
        errorMessage="Falha ao consultar solicitações."
        onRetry={() => void queue.refetch()}
      >
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[860px] text-left text-sm">
            <caption className="sr-only">Solicitações com documentos a validar</caption>
            <thead>
              <tr>
                {["Solicitação", "Cliente", "BLs", "Termo de devolução", "Procuração", "Prazo", ""].map((c) => (
                  <th scope="col" className="px-3 py-3" key={c || "acao"}>
                    {c || <span className="sr-only">Ação</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queue.isLoading && (
                <tr>
                  <td colSpan={7} className="p-0">
                    <SkeletonTable rows={5} cols={7} label="Carregando solicitações" />
                  </td>
                </tr>
              )}
              {queue.data && total === 0 && (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState
                      icon={FileCheck2}
                      title="Nenhuma solicitação aguardando validação"
                      description="Pedidos enviados pelo Portal aparecem aqui até o termo de devolução e a procuração serem aprovados."
                    />
                  </td>
                </tr>
              )}
              {queue.data?.items.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-3">
                    <span className="app-table__cell-stack">
                      <span className="app-table__cell-value font-semibold">{r.protocol}</span>
                      <span><Badge tone={ceStateTone(r.state)}>{ceStateLabel(r.state)}</Badge></span>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="app-table__cell-stack">
                      <span className="app-table__cell-value">{r.customer_name}</span>
                      <span className="app-table__cell-meta">{r.cnpj_cpf}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="app-table__cell-stack">
                      <span className="app-table__cell-value">{r.bl_ids.length} BL(s)</span>
                      <span className="app-table__cell-meta app-table__truncate app-table__truncate--sm" title={r.bl_ids.join(", ")}>
                        {r.bl_ids.join(", ")}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3"><DocumentStatus status={r.termo_status} /></td>
                  <td className="px-3 py-3"><DocumentStatus status={r.procuracao_status} /></td>
                  <td className="px-3 py-3"><CeUnlockSla start={r.sla_started_at} /></td>
                  <td className="px-3 py-3 text-right">
                    <Button variant="secondary" className="app-btn--sm" aria-label={`Analisar ${r.protocol}`} onClick={() => onOpen(r.id)}>
                      Analisar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryStateGate>
      {total > PAGE_SIZE && (
        <TableFooterPagination
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={total}
          totalPages={Math.ceil(total / PAGE_SIZE)}
          onPageChange={setPage}
        />
      )}
    </Card>
  );
}
