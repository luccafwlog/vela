import { useState } from "react";
import { Link } from "react-router-dom";
import { FileCheck2, FileText } from "lucide-react";
import { Block } from "../ui/Block";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/Card";
import { NoValue } from "../ui/NoValue";
import { SkeletonTable } from "../ui/Skeleton";
import { StatusText } from "../ui/StatusText";
import { TableFooterPagination } from "../ui/TableFooterPagination";
import { QueryStateGate } from "../shared/QueryStateGate";
import { useCeUnlockReviewQueue } from "../../hooks/useCeUnlock";
import { ceDateTime, ceDocumentStatusText, ceStateLabel } from "../../lib/ceUnlockLabels";

const PAGE_SIZE = 25;
const COLUMNS = 7;

/** Situação de um documento em texto: âmbar no que pede ação, "✓ Aprovado". */
export function CeUnlockDocumentStatus({ type, status }: { type: "termo" | "procuracao"; status: string | null | undefined }) {
  const { label, tone } = ceDocumentStatusText(type, status);
  return <StatusText tone={tone}>{label}</StatusText>;
}

/** Primeiro B/L e "+n", como nas Faturas. */
export function CeUnlockBlList({ blIds }: { blIds: string[] }) {
  if (!blIds.length) return <NoValue label="Sem B/L" />;
  const [first, ...rest] = blIds;
  return (
    <span className="whitespace-nowrap">
      <Link className="app-link" to={`/bls/${encodeURIComponent(first)}`}>{first}</Link>
      {rest.length > 0 ? <span className="app-table__cell-meta" title={blIds.join(", ")}> +{rest.length}</span> : null}
    </span>
  );
}

/** Aba Solicitações: uma linha por pedido; termo de devolução e procuração valem para todos os B/Ls dele. */
export function CeUnlockReviewQueue({
  enabled,
  onOpen,
  onOpenModel,
}: {
  enabled: boolean;
  onOpen: (id: string) => void;
  /** Só para quem analisa (manage): abre o modelo do termo de devolução. */
  onOpenModel?: () => void;
}) {
  const [page, setPage] = useState(1);
  const queue = useCeUnlockReviewQueue(page, enabled);
  const total = queue.data?.total ?? 0;
  return (
    <Block
      title="Solicitações aguardando análise"
      flush
      aside={
        <>
          {queue.data ? <span>{total} · até o termo de devolução e a procuração serem aprovados</span> : null}
          {onOpenModel ? (
            <Button variant="secondary" className="app-btn--sm" onClick={onOpenModel}>
              <FileText size={14} aria-hidden="true" />
              Modelo do termo de devolução
            </Button>
          ) : null}
        </>
      }
    >
      <QueryStateGate
        isLoading={false}
        isError={Boolean(queue.error)}
        hasData={queue.data !== undefined}
        errorMessage="Falha ao consultar solicitações."
        onRetry={() => void queue.refetch()}
      >
        <div className="app-table-scroll">
          <table className="app-table app-table--compact text-sm">
            <caption className="sr-only">Solicitações com documentos a analisar</caption>
            <thead>
              <tr>
                <th scope="col">Solicitação</th>
                <th scope="col" className="app-table__text-head">Cliente</th>
                <th scope="col">B/Ls</th>
                <th scope="col">Termo de devolução</th>
                <th scope="col">Procuração</th>
                <th scope="col">Situação</th>
                <th scope="col">Enviada em</th>
              </tr>
            </thead>
            <tbody>
              {queue.isLoading && (
                <tr>
                  <td colSpan={COLUMNS} className="p-0">
                    <SkeletonTable rows={5} cols={COLUMNS} label="Carregando solicitações" />
                  </td>
                </tr>
              )}
              {queue.data && total === 0 && (
                <tr>
                  <td colSpan={COLUMNS} className="p-0">
                    <EmptyState
                      icon={FileCheck2}
                      title="Nenhuma solicitação aguardando análise"
                      description="Pedidos enviados pelo Portal aparecem aqui até o termo de devolução e a procuração serem aprovados."
                    />
                  </td>
                </tr>
              )}
              {queue.data?.items.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">
                    <button type="button" className="app-link font-[var(--app-font-mono)]" aria-label={`Abrir solicitação ${r.protocol}`} onClick={() => onOpen(r.id)}>
                      {r.protocol}
                    </button>
                  </td>
                  <td className="app-table__text" title={r.customer_name}>
                    {r.cnpj_cpf ? (
                      <Link className="app-link" to={`/clientes/${r.cnpj_cpf}?tab=desbloqueio-ce`}>{r.customer_name}</Link>
                    ) : (
                      r.customer_name
                    )}
                  </td>
                  <td><CeUnlockBlList blIds={r.bl_ids} /></td>
                  <td className="whitespace-nowrap"><CeUnlockDocumentStatus type="termo" status={r.termo_status} /></td>
                  <td className="whitespace-nowrap"><CeUnlockDocumentStatus type="procuracao" status={r.procuracao_status} /></td>
                  <td className="whitespace-nowrap">{ceStateLabel(r.state)}</td>
                  {/* Ponto 10 de 2026-10-23: aqui os documentos ainda não foram aprovados, então não há prazo. */}
                  <td className="whitespace-nowrap tabular-nums">{r.submitted_at ? ceDateTime(r.submitted_at) : <NoValue label="Sem envio" />}</td>
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
    </Block>
  );
}
