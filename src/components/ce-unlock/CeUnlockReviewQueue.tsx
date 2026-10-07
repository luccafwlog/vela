import { useState } from "react";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { CeUnlockSla } from "./CeUnlockSla";
import { useCeUnlockReviewQueue } from "../../hooks/useCeUnlock";
import { ceStateLabel } from "../../lib/ceUnlockLabels";
import type { CeUnlockReviewRow } from "../../types/ceUnlock";

const DOCUMENT_STATUS: Record<string, string> = {
  uploaded: "Aguardando análise",
  approved: "Aprovado",
  changes_requested: "Recusado — aguardando cliente",
  revoked: "Revogado",
};
const documentLabel = (status: CeUnlockReviewRow["termo_status"]) =>
  status ? (DOCUMENT_STATUS[status] ?? status) : "Não enviado";

/** Aba Solicitações: uma linha por pedido; termo de devolução e procuração valem para todos os BLs dele. */
export function CeUnlockReviewQueue({
  enabled,
  onOpen,
}: {
  enabled: boolean;
  onOpen: (id: string) => void;
}) {
  const [page, setPage] = useState(1);
  const queue = useCeUnlockReviewQueue(page, enabled);
  return (
    <Card>
      {queue.isLoading ? (
        <p>Carregando solicitações...</p>
      ) : queue.error ? (
        <p role="alert">
          Falha ao consultar solicitações.{" "}
          <Button onClick={() => void queue.refetch()}>Tentar novamente</Button>
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {["Solicitação", "Cliente", "BLs", "Termo de devolução", "Procuração", "Prazo", "Ação"].map((c) => (
                  <th className="p-2" key={c}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queue.data?.items.map((r) => (
                <tr className="border-t border-[var(--app-border)]" key={r.id}>
                  <td className="p-2">
                    {r.protocol}
                    <p>{ceStateLabel(r.state)}</p>
                  </td>
                  <td className="p-2">
                    {r.customer_name}
                    <p>{r.cnpj_cpf}</p>
                  </td>
                  <td className="p-2">
                    {r.bl_ids.length} BL(s)
                    <p>{r.bl_ids.slice(0, 3).join(", ")}{r.bl_ids.length > 3 ? "…" : ""}</p>
                  </td>
                  <td className="p-2">{documentLabel(r.termo_status)}</td>
                  <td className="p-2">{documentLabel(r.procuracao_status)}</td>
                  <td className="p-2">
                    <CeUnlockSla start={r.sla_started_at} />
                  </td>
                  <td className="p-2">
                    <Button variant="ghost" onClick={() => onOpen(r.id)}>
                      Analisar {r.protocol}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {queue.data?.total === 0 && <p>Nenhuma solicitação aguardando validação de documentos.</p>}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>
          Anterior
        </Button>
        <span>
          Página {page} · {queue.data?.total ?? 0} solicitação(ões)
        </span>
        <Button variant="ghost" disabled={page * 25 >= (queue.data?.total ?? 0)} onClick={() => setPage(page + 1)}>
          Próxima
        </Button>
      </div>
    </Card>
  );
}
