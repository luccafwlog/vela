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
import { CeUnlockReviewQueue } from "../components/ce-unlock/CeUnlockReviewQueue";
import { CeUnlockSla } from "../components/ce-unlock/CeUnlockSla";
import { CeUnlockZptImport } from "../components/ce-unlock/CeUnlockZptImport";
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

type Tab = "solicitacoes" | "controle";
// Fila de trabalho do dia: BLs prontos que ainda não foram à ZPT.
const DEFAULT_FILTERS: CeUnlockFilters = { situation: "ready_not_exported" };

/** Caixa de requisito no estilo da tela da ZPT: marcada = requisito atendido. */
function RequirementBox({ label, bl, checked }: { label: string; bl: string; checked: boolean }) {
  return (
    <input
      type="checkbox"
      readOnly
      disabled
      checked={checked}
      aria-label={`${label}: ${bl}`}
    />
  );
}

export function DesbloqueioCe() {
  const { can } = useAuth();
  const manage = can("ce_unlock_manage");
  const [params, setParams] = useSearchParams();
  const id = params.get("pedido");
  const tab: Tab = params.get("aba") === "controle" ? "controle" : "solicitacoes";
  const [filters, setFilters] = useState<CeUnlockFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [showExports, setShowExports] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const [showZpt, setShowZpt] = useState(false);
  const keys = useRef(new Map<string, string>());
  const { list, command } = useCeUnlock(
    filters,
    page,
    can("ce_unlock_read") && tab === "controle",
  );
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
  function openTab(next: Tab) {
    setParams((p) => {
      p.set("aba", next);
      return p;
    });
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
        message: `Desmarcar a entrega do BL original ${i.bl_id}?`,
        consequence: "O BL deixará de atender o requisito BL de Entrega.",
        reversibility: "A entrega poderá ser registrada novamente.",
      });
      if (!reason) return;
    } else if (
      !(await confirm({
        message: `Registrar recebimento do BL original ${i.bl_id}?`,
        consequence:
          "O requisito BL de Entrega passa a atendido e o prazo do cliente recomeça a partir de agora.",
        reversibility: "Uma marcação incorreta pode ser desfeita com motivo.",
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
        message: `Exportar ${blIds.length} BL(s) para a ZPT?`,
        affected: { summary: `${blIds.length} BL(s)`, items: blIds },
        consequence:
          "Exportar registra o envio destes BLs à ZPT. Suba a planilha na ZPT: o desbloqueio só acontece lá.",
        reversibility:
          "Se a ZPT recusar algum BL, ele aparece como divergente após a conciliação e pode ser reexportado.",
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
        description="Valide os documentos das solicitações do Portal e controle os requisitos de cada BL para a ZPT."
        action={
          manage ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setShowModel(!showModel)}>
                Modelo do termo de devolução
              </Button>
              <Button variant="ghost" onClick={() => setShowZpt(!showZpt)}>
                Conciliar com a ZPT
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
      <div role="tablist" className="mb-4 flex gap-2">
        <Button
          role="tab"
          aria-selected={tab === "solicitacoes"}
          variant={tab === "solicitacoes" ? "primary" : "ghost"}
          onClick={() => openTab("solicitacoes")}
        >
          Solicitações
        </Button>
        <Button
          role="tab"
          aria-selected={tab === "controle"}
          variant={tab === "controle" ? "primary" : "ghost"}
          onClick={() => openTab("controle")}
        >
          Controle ZPT
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {showModel && manage && (
        <Card className="mb-4">
          <h2>Modelo oficial do termo de devolução</h2>
          <p>{model.data?.file_name ?? "Nenhum modelo oficial cadastrado."}</p>
          <CeUnlockDocumentUploader
            source="model"
            model
            onUploaded={() => afterCeUnlockChanged(client)}
          />
        </Card>
      )}
      {showZpt && manage && <CeUnlockZptImport />}
      {tab === "solicitacoes" ? (
        <CeUnlockReviewQueue
          enabled={can("ce_unlock_read")}
          onOpen={(requestId) =>
            setParams((p) => {
              p.set("pedido", requestId);
              return p;
            })
          }
        />
      ) : (
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
                <option value="ready_not_exported">Aptos — não exportados</option>
                <option value="">Todos</option>
                <option value="divergent">Divergentes na ZPT</option>
                <option value="no_request">Sem solicitação</option>
                <option value="submitted">Enviado</option>
                <option value="in_review">Em análise</option>
                <option value="changes_requested">Correção solicitada</option>
                <option value="ready">Aptos (inclui exportados)</option>
                <option value="completed">Documentação validada</option>
              </Select>
            </Field>
            <Field label="Requisito pendente">
              <Select
                value={filters.pending_requirement ?? ""}
                onChange={(e) => filter("pending_requirement", e.target.value)}
              >
                <option value="">Todos</option>
                <option value="termo">Termo de devolução</option>
                <option value="procuracao">Procuração</option>
                <option value="taxas">Financeiro (taxas locais)</option>
                <option value="bl_fisico">BL de Entrega</option>
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
                      "Exportar",
                      "BL / CE",
                      "Cliente",
                      "Viagem / POD",
                      "Solicitação",
                      "T. de Devolução",
                      "Procuração",
                      "Financeiro",
                      "BL de Entrega",
                      "Prazo",
                      "ZPT",
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
                            onClick={() =>
                              setParams((p) => {
                                p.set("pedido", i.request_id!);
                                return p;
                              })
                            }
                          >
                            {i.protocol}
                          </Button>
                        ) : (
                          "Sem solicitação"
                        )}
                        <p>{ceStateLabel(i.state)}</p>
                        {i.requested_at && <p>{new Date(i.requested_at).toLocaleString("pt-BR")}</p>}
                      </td>
                      <td className="p-2">
                        <RequirementBox label="T. de Devolução" bl={i.bl_id} checked={i.termo} />
                      </td>
                      <td className="p-2">
                        <RequirementBox label="Procuração" bl={i.bl_id} checked={i.procuracao} />
                      </td>
                      <td className="p-2">
                        <RequirementBox label="Financeiro" bl={i.bl_id} checked={i.paid} />
                      </td>
                      <td className="p-2">
                        <input
                          type="checkbox"
                          aria-label={`BL de Entrega: ${i.bl_id}`}
                          checked={i.delivered}
                          disabled={!manage || command.isPending}
                          onChange={() => void delivery(i)}
                        />
                      </td>
                      <td className="p-2">
                        <CeUnlockSla start={i.sla_started_at} doneAt={i.exported_at} />
                      </td>
                      <td className="p-2">
                        {i.zpt_status === "divergent" ? (
                          <>
                            <strong>{ceStateLabel("divergent")}</strong>
                            <p>{i.zpt_description}</p>
                            {!!i.zpt_pending?.length && <p>Pendente na ZPT: {i.zpt_pending.join(", ")}</p>}
                          </>
                        ) : i.zpt_status === "unlocked" ? (
                          <>
                            <strong>{ceStateLabel("unlocked")}</strong>
                            {i.zpt_without_export && <p>Sem exportação pelo Vela</p>}
                          </>
                        ) : i.can_export ? (
                          <>
                            {ceStateLabel(i.export_state ?? "not_exported")}
                            {i.exported_at && <p>{new Date(i.exported_at).toLocaleString("pt-BR")}</p>}
                          </>
                        ) : (
                          <p>{i.reasons.join("; ")}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {list.data?.total === 0 && <p>Nenhum BL encontrado para este filtro.</p>}
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
      )}
      {showExports && manage && (
        <Card className="mt-4">
          <h2>Histórico ZPT</h2>
          {exports.error && <p role="alert">Falha ao consultar lotes.</p>}
          {exports.data?.map((e) => (
            <div key={e.id} className="mb-3">
              <p>
                {new Date(e.created_at).toLocaleString("pt-BR")} ·{" "}
                {e.rows.length} BL(s) · Exportado
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
            </div>
          ))}
        </Card>
      )}
      <Modal
        open={!!id}
        title="Solicitação de desbloqueio"
        onClose={() =>
          setParams((p) => {
            p.delete("pedido");
            return p;
          })
        }
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
