import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../hooks/useAuth";
import { useCeUnlock, useCeUnlockRequest } from "../hooks/useCeUnlock";
import { Button } from "../components/ui/Button";
import { Card, PageHeader } from "../components/ui/Card";
import { Field, Input, Select } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { VoyageCombobox } from "../components/shared/VoyageCombobox";
import {
  useConfirm,
  useConfirmWithReason,
} from "../components/ui/ConfirmDialog";
import { CeUnlockRequestDetail } from "../components/ce-unlock/CeUnlockRequestDetail";
import { CeUnlockDocumentUploader } from "../components/ce-unlock/CeUnlockDocuments";
import { ceStateLabel } from "../lib/ceUnlockLabels";
import {
  ceUnlockRead,
  downloadCeUnlockExport,
  listCeUnlockExports,
} from "../services/ceUnlockService";
import { afterCeUnlockChanged } from "../services/cacheEffects";
import type {
  CeUnlockDocument,
  CeUnlockFilters,
  CeUnlockItem,
} from "../types/ceUnlock";
export function DesbloqueioCe() {
  const { can } = useAuth();
  const manage = can("ce_unlock_manage");
  const [params, setParams] = useSearchParams();
  const id = params.get("pedido");
  const [filters, setFilters] = useState<CeUnlockFilters>({});
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [showExports, setShowExports] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const keys = useRef(new Map<string, string>());
  const { list, command } = useCeUnlock(filters, page, can("ce_unlock_read"));
  const request = useCeUnlockRequest(id);
  const client = useQueryClient();
  const confirm = useConfirm();
  const reasonDialog = useConfirmWithReason();
  const exports = useQuery({
    queryKey: ["ce-unlock", "exports"],
    queryFn: listCeUnlockExports,
    enabled: manage && showExports,
  });
  const model = useQuery({
    queryKey: ["ce-unlock", "model", "internal"],
    queryFn: () => ceUnlockRead<CeUnlockDocument | null>("model"),
    enabled: manage && showModel,
  });
  function filter(key: keyof CeUnlockFilters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }
  function keyFor(action: string, payload: Record<string, unknown>) {
    const text = JSON.stringify({ action, payload });
    if (!keys.current.has(text)) keys.current.set(text, crypto.randomUUID());
    return { text, key: keys.current.get(text)! };
  }
  async function act(action: string, payload: Record<string, unknown>) {
    const k = keyFor(action, payload);
    const result = await command.mutateAsync({
      action,
      payload: { ...payload, request_key: k.key },
    });
    keys.current.delete(k.text);
    return result;
  }
  async function delivery(i: CeUnlockItem) {
    let reason: string | null = null;
    if (i.delivered) {
      reason = await reasonDialog({
        message: `Reverter entrega física de ${i.bl_id}?`,
        consequence: "O BL deixará de atender o requisito de entrega física.",
        reversibility: "A entrega poderá ser registrada novamente.",
      });
      if (!reason) return;
    } else if (
      !(await confirm({
        message: `Registrar recebimento do BL original ${i.bl_id}?`,
        consequence:
          "O requisito de entrega física aparecerá como atendido no Vela e no Portal.",
        reversibility: "Uma marcação incorreta pode ser revertida com motivo.",
      }))
    )
      return;
    setError("");
    try {
      await act("delivery", {
        bl_id: i.bl_id,
        delivered: !i.delivered,
        expected_version: i.delivery_version,
        reason,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao registrar entrega");
    }
  }
  async function exportSelected(blIds = selected, reexportOf?: string) {
    if (
      !(await confirm({
        message: `Exportar ${blIds.length} BL(s) aptos para a ZPT?`,
        affected: { summary: `${blIds.length} BL(s)`, items: blIds },
        consequence:
          "A planilha terá BL e os quatro requisitos. O download não confirma envio nem desbloqueio.",
        reversibility:
          "O lote permanece no histórico; nova exportação gera novo lote.",
      }))
    )
      return;
    const payload = { bl_ids: blIds, ...(reexportOf ? { reexport_of: reexportOf } : {}) };
    const k = keyFor("export", payload);
    setError("");
    setExportBusy(true);
    try {
      await downloadCeUnlockExport({ ...payload, request_key: k.key });
      keys.current.delete(k.text);
      await afterCeUnlockChanged(client);
      setShowExports(true);
      if (!reexportOf) setSelected([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao exportar");
    } finally { setExportBusy(false); }
  }
  if (!can("ce_unlock_read")) return <p>Acesso não autorizado.</p>;
  return (
    <>
      <PageHeader
        title="Desbloqueio de CE"
        description="Gestão dos BLs com CE Mercante, solicitações do Portal e requisitos para ZPT."
        action={
          manage ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setShowModel(!showModel)}>
                Modelo do termo
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowExports(!showExports)}
              >
                Histórico ZPT
              </Button>
            </div>
          ) : undefined
        }
      />
      {error && <p role="alert">{error}</p>}
      {showModel && manage && (
        <Card className="mb-4">
          <h2>Modelo oficial do termo</h2>
          <p>{model.data?.file_name ?? "Nenhum modelo oficial cadastrado."}</p>
          <CeUnlockDocumentUploader
            source="model"
            model
            onUploaded={() => afterCeUnlockChanged(client)}
          />
        </Card>
      )}
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Field label="Buscar BL, CE ou cliente">
            <Input
              value={filters.search ?? ""}
              onChange={(e) => filter("search", e.target.value)}
            />
          </Field>
          <Field label="Situação">
            <Select
              value={filters.situation ?? ""}
              onChange={(e) => filter("situation", e.target.value)}
            >
              <option value="">Todas</option>
              <option value="no_request">Sem solicitação</option>
              <option value="submitted">Enviado</option>
              <option value="in_review">Em análise</option>
              <option value="changes_requested">Correção solicitada</option>
              <option value="ready">Apto</option>
              <option value="completed">Concluído</option>
            </Select>
          </Field>
          <Field label="Requisito pendente">
            <Select
              value={filters.pending_requirement ?? ""}
              onChange={(e) => filter("pending_requirement", e.target.value)}
            >
              <option value="">Todos</option>
              <option value="termo">Termo</option>
              <option value="procuracao">Procuração</option>
              <option value="taxas">Taxas locais</option>
              <option value="bl_fisico">Entrega física</option>
            </Select>
          </Field>
          <Field label="POD">
            <Input
              value={filters.pod ?? ""}
              onChange={(e) => filter("pod", e.target.value)}
            />
          </Field>
          <VoyageCombobox
            clearable
            selectedVoyageId={filters.voyage_id}
            onSelect={next => {
              setFilters(prev => ({ ...prev, voyage_id: next ?? undefined }));
              setPage(1);
            }}
          />
        </div>
        {list.isLoading ? (
          <p>Carregando BLs...</p>
        ) : list.error ? (
          <p role="alert">
            Falha ao consultar BLs.{" "}
            <Button onClick={() => void list.refetch()}>
              Tentar novamente
            </Button>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    "Seleção",
                    "BL / CE",
                    "Cliente",
                    "Viagem / POD",
                    "Solicitação",
                    "Termo",
                    "Procuração",
                    "Taxas locais",
                    "BL físico",
                    "Andamento",
                    "Ações",
                  ].map((c) => (
                    <th className="p-2" key={c}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data?.items.map((i) => (
                  <tr
                    className="border-t border-[var(--app-border)]"
                    key={i.bl_id}
                  >
                    <td className="p-2">
                      <input
                        type="checkbox"
                        aria-label={`Exportar BL ${i.bl_id}`}
                        disabled={!manage || (!i.can_export && !selected.includes(i.bl_id))}
                        checked={selected.includes(i.bl_id)}
                        onChange={(e) =>
                          setSelected((prev) =>
                            e.target.checked
                              ? [...prev, i.bl_id]
                              : prev.filter((b) => b !== i.bl_id),
                          )
                        }
                      />
                    </td>
                    <td className="p-2">
                      <Link to={`/bls/${encodeURIComponent(i.bl_id)}`}>
                        {i.bl_id}
                      </Link>
                      <p>{i.ce_mercante}</p>
                    </td>
                    <td className="p-2">
                      <Link to={`/clientes/${i.cnpj_cpf}?tab=desbloqueio-ce`}>
                        {i.customer_name}
                      </Link>
                      <p>
                        {i.cnpj_cpf}
                        {i.vip ? " · VIP" : ""}
                      </p>
                    </td>
                    <td className="p-2">
                      {i.vessel_name} · {i.voyage_number}
                      <p>{i.pod}</p>
                    </td>
                    <td className="p-2">
                      {i.request_id ? (
                        <Button
                          variant="ghost"
                          onClick={() => setParams({ pedido: i.request_id! })}
                        >
                          {i.protocol}
                        </Button>
                      ) : (
                        "Sem solicitação"
                      )}
                      <p>{ceStateLabel(i.state)}</p>
                      {i.requested_at && <p>{new Date(i.requested_at).toLocaleString("pt-BR")}</p>}
                    </td>
                    <td className="p-2">{i.termo ? "Aprovado" : "Pendente"}</td>
                    <td className="p-2">
                      {i.procuracao ? "Aprovada" : "Pendente"}
                    </td>
                    <td className="p-2">{i.paid ? "Pagas" : "Pendentes"}</td>
                    <td className="p-2">
                      {i.delivered ? "Entregue" : "Aguardando"}
                    </td>
                    <td className="p-2">
                      {i.confirmed ? "Concluído" : i.can_export ? "Apto" : "Não apto"}
                      <p>{ceStateLabel(i.export_state)}</p>
                      <p>{i.reasons.join("; ")}</p>
                    </td>
                    <td className="p-2">
                      {manage && (
                        <Button
                          variant="ghost"
                          disabled={command.isPending}
                          onClick={() => void delivery(i)}
                        >
                          {i.delivered
                            ? "Reverter entrega"
                            : "Registrar entrega"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.data?.total === 0 && <p>Nenhum BL com CE encontrado.</p>}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </Button>
          <span>
            Página {page} · {list.data?.total ?? 0} BL(s)
          </span>
          <Button
            variant="ghost"
            disabled={page * 25 >= (list.data?.total ?? 0)}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </Button>
          {manage && (
            <Button
              disabled={
                !selected.length || selected.length > 100 || command.isPending || exportBusy
              }
              onClick={() => void exportSelected()}
            >
              Exportar {selected.length} apto(s) para ZPT
            </Button>
          )}
        </div>
      </Card>
      {showExports && manage && (
        <Card className="mt-4">
          <h2>Histórico ZPT</h2>
          {exports.error && <p role="alert">Falha ao consultar lotes.</p>}
          {exports.data?.map((e) => (
            <div key={e.id} className="mb-3">
              <p>
                {new Date(e.created_at).toLocaleString("pt-BR")} ·{" "}
                {e.rows.length} BL(s) ·{" "}
                {e.sent_at ? "Envio registrado" : "Arquivo gerado"} ·{" "}
                {e.reference}
              </p>
              <Button
                variant="ghost"
                onClick={() =>
                  void downloadCeUnlockExport({ export_id: e.id }).catch(
                    (err) => setError(err.message),
                  )
                }
              >
                Baixar lote
              </Button>
              <Button variant="ghost" disabled={exportBusy} onClick={() => void exportSelected(e.rows.map(r => r.bl_id), e.id)}>
                Reexportar com requisitos atuais
              </Button>
              <p>Arquivo histórico: os requisitos podem ter mudado após a geração.</p>
              {!e.sent_at && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void (async () => {
                      const reference = await reasonDialog({
                        message:
                          "Registrar envio deste lote à ZPT? Informe a referência do envio.",
                        consequence:
                          "O lote ficará marcado como enviado; isso não confirma desbloqueio.",
                      });
                      if (!reference) return;
                      try {
                        await act("sent", { export_id: e.id, reference });
                      } catch (err) {
                        setError(
                          err instanceof Error
                            ? err.message
                            : "Falha ao registrar envio",
                        );
                      }
                    })()
                  }
                >
                  Registrar envio à ZPT
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
      <Modal
        open={!!id}
        title="Solicitação de desbloqueio"
        onClose={() => setParams({})}
      >
        {request.isLoading ? (
          <p>Carregando...</p>
        ) : request.error ? (
          <p role="alert">Falha ao consultar pedido.</p>
        ) : (
          request.data && (
            <CeUnlockRequestDetail
              request={request.data}
              manage={manage}
              onAction={act}
              busy={command.isPending}
            />
          )
        )}
      </Modal>
    </>
  );
}
