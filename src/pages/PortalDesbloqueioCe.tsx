import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, PageHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Field, Input } from "../components/ui/Input";
import { useConfirm } from "../components/ui/ConfirmDialog";
import {
  CeUnlockDocumentList,
  CeUnlockDocumentUploader,
} from "../components/ce-unlock/CeUnlockDocuments";
import { CeUnlockRequirements } from "../components/ce-unlock/CeUnlockRequirements";
import { ceStateLabel, ceActionLabel } from "../lib/ceUnlockLabels";
import { CeUnlockVipCoveragePanel } from "../components/ce-unlock/CeUnlockVipCoveragePanel";
import { ceUnlockDeadline, formatCeUnlockDeadline } from "../services/ceUnlockSla";
import { usePortalCeUnlock } from "../hooks/usePortalCeUnlock";
import { downloadCeUnlockDocument } from "../services/ceUnlockService";
import { portalPath } from "../services/portalScope";
export function PortalDesbloqueioCe() {
  const [params, setParams] = useSearchParams();
  const id = params.get("pedido");
  const [tab, setTab] = useState<"new" | "requests" | "annual">("new");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const draftKey = useRef(crypto.randomUUID());
  const submitKey = useRef(crypto.randomUUID());
  const flow = usePortalCeUnlock({ search }, page, id);
  const confirm = useConfirm();
  const readOnly = flow.scope.mode === "inspect";
  const detail = flow.detail.data;
  const documentsReady = detail?.source === "vip_annual"
    ? !!(flow.vip.data?.enabled && flow.vip.data.termo && flow.vip.data.procuracao)
    : ["termo", "procuracao"].every(type => {
        const latest = detail?.documents.find(d => d.type === type && d.source === "request" && d.status !== "uploading");
        return latest && ["uploaded", "approved"].includes(latest.status);
      });
  const pendingItems = detail?.items.filter(i => !i.confirmed) ?? [];
  const submitReady = documentsReady && pendingItems.length > 0 && pendingItems.every(i => i.paid);
  // Com os quatro requisitos atendidos em todos os BLs: o prazo final parte da pendência resolvida mais recente.
  const allReady = !!detail && detail.items.length > 0 && detail.items.every(i => i.can_export);
  const latestStart = detail?.items.reduce<string | null>(
    (latest, i) => (i.sla_started_at && (!latest || i.sla_started_at > latest) ? i.sla_started_at : latest),
    null,
  );
  const cancelKey = useRef(crypto.randomUUID());
  const open = (next: string | null) => {
    setParams((p) => {
      if (next) p.set("pedido", next);
      else p.delete("pedido");
      return p;
    });
    submitKey.current = crypto.randomUUID();
  };
  async function create() {
    if (
      !(await confirm({
        message: `Preparar solicitação de ${selected.length} BL(s)?`,
        affected: { summary: `${selected.length} BL(s)`, items: selected },
        consequence:
          "O rascunho reserva estes BLs até envio ou cancelamento pela agência.",
        reversibility: "O desk pode cancelar o rascunho.",
      }))
    )
      return;
    setError("");
    try {
      const r = await flow.command.mutateAsync({
        action: "draft",
        payload: { bl_ids: selected, request_key: draftKey.current },
      });
      if (!r) throw new Error("Resposta incompleta da solicitação");
      open(r.id);
      setSelected([]);
      draftKey.current = crypto.randomUUID();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível preparar a solicitação",
      );
    }
  }
  async function submit() {
    if (!detail) return;
    if (
      !(await confirm({
        message: `Solicitar desbloqueio dos BLs do protocolo ${detail.protocol}?`,
        affected: {
          summary: `${detail.items.length} BL(s)`,
          items: detail.items.map((i) => i.bl_id),
        },
        consequence:
          "A agência receberá o pedido e os documentos para análise. A entrega dos originais continua necessária.",
        reversibility:
          "A agência pode solicitar correção ou cancelar com motivo.",
      }))
    )
      return;
    setError("");
    try {
      await flow.command.mutateAsync({
        action: "submit",
        payload: {
          request_id: detail.id,
          expected_version: detail.version,
          request_key: submitKey.current,
        },
      });
      submitKey.current = crypto.randomUUID();
      setTab("requests");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível enviar o pedido",
      );
    }
  }
  async function cancel() {
    if (!detail) return;
    if (
      !(await confirm({
        message: `Cancelar a solicitação ${detail.protocol}?`,
        affected: {
          summary: `${detail.items.length} BL(s)`,
          items: detail.items.map((i) => i.bl_id),
        },
        consequence: "Os BLs ficam livres para uma nova solicitação.",
        reversibility: "Para pedir o desbloqueio de novo, abra uma nova solicitação.",
      }))
    )
      return;
    setError("");
    try {
      await flow.command.mutateAsync({
        action: "cancel",
        payload: {
          request_id: detail.id,
          expected_version: detail.version,
          request_key: cancelKey.current,
        },
      });
      cancelKey.current = crypto.randomUUID();
      open(null);
      setTab("requests");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível cancelar a solicitação",
      );
    }
  }
  return (
    <>
      <PageHeader
        title="Desbloqueio de CE"
        description="Solicite e acompanhe o desbloqueio de CE Mercante. Taxas locais pagas, termo de devolução, procuração e entrega do BL original são obrigatórios."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          variant={tab === "new" ? "primary" : "ghost"}
          onClick={() => {
            setTab("new");
            setPage(1);
          }}
        >
          Solicitar desbloqueio
        </Button>
        <Button
          variant={tab === "requests" ? "primary" : "ghost"}
          onClick={() => {
            setTab("requests");
            setPage(1);
          }}
        >
          Minhas solicitações
        </Button>
        {flow.vip.data?.enabled && (
          <Button
            variant={tab === "annual" ? "primary" : "ghost"}
            onClick={() => setTab("annual")}
          >
            Documentos anuais
          </Button>
        )}
      </div>
      {readOnly && <p>Modo Inspeção — somente leitura.</p>}
      {error && <p role="alert">{error}</p>}
      {tab === "annual" ? (
        <Card>
          <CeUnlockVipCoveragePanel scope={flow.scope} />
        </Card>
      ) : (
        <>
          {tab === "new" && (
            <Card>
              <div className="mb-4 space-y-3">
                {flow.vip.data?.enabled && (
                  <p>
                    {flow.vip.data.termo && flow.vip.data.procuracao
                      ? "Cobertura VIP vigente — termo e procuração anuais já aprovados."
                      : "Documentos anuais VIP precisam de regularização. Acesse Documentos anuais."}
                  </p>
                )}
                {flow.model.data ? (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void downloadCeUnlockDocument(
                        flow.model.data!.id,
                        flow.scope,
                      ).catch((e) => setError(e.message))
                    }
                  >
                    Baixar modelo do termo de devolução
                  </Button>
                ) : (
                  <p>
                    Modelo oficial do termo de devolução ainda não disponibilizado pela
                    agência.
                  </p>
                )}
                <Field label="Buscar BL ou CE">
                  <Input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                </Field>
              </div>
              {flow.list.isLoading ? (
                <p>Carregando BLs...</p>
              ) : flow.list.error ? (
                <p role="alert">
                  Falha ao consultar BLs.{" "}
                  <Button onClick={() => void flow.list.refetch()}>
                    Tentar novamente
                  </Button>
                </p>
              ) : (
                <div className="space-y-3">
                  {flow.list.data?.items.map((i) => (
                    <article
                      key={i.bl_id}
                      className="rounded-lg border border-[var(--app-border)] p-3"
                    >
                      <label className="flex gap-2">
                        <input
                          type="checkbox"
                          aria-label={`Selecionar BL ${i.bl_id}`}
                          disabled={readOnly || (!i.can_submit && !selected.includes(i.bl_id))}
                          checked={selected.includes(i.bl_id)}
                          onChange={(e) => {
                            setSelected((prev) =>
                              e.target.checked
                                ? [...prev, i.bl_id]
                                : prev.filter((b) => b !== i.bl_id),
                            );
                            draftKey.current = crypto.randomUUID();
                          }}
                        />
                        <strong>
                          {i.bl_id} · CE {i.ce_mercante}
                        </strong>
                      </label>
                      <p>
                        {i.vessel_name} · {i.voyage_number} · POD {i.pod}
                      </p>
                      <p>
                        {i.paid
                          ? "Taxas locais pagas"
                          : "Taxas locais pendentes"}{" "}
                        · {ceStateLabel(i.state)}
                      </p>
                      {!i.can_submit && (
                        <p>
                          {i.request_id
                            ? "Solicitação já existente ou desbloqueio confirmado"
                            : i.reasons.join("; ")}
                        </p>
                      )}
                      {!i.paid && (
                        <a
                          className="text-[var(--app-link)]"
                          href={portalPath(flow.scope, "/billing")}
                        >
                          Consultar Faturas
                        </a>
                      )}
                      {i.request_id && (
                        <Button
                          variant="ghost"
                          onClick={() => open(i.request_id)}
                        >
                          Abrir solicitação
                        </Button>
                      )}
                    </article>
                  ))}
                  {flow.list.data?.total === 0 && (
                    <p>Nenhum BL com CE encontrado.</p>
                  )}
                </div>
              )}
              {!readOnly && (
                <Button
                  className="mt-4"
                  disabled={
                    !selected.length ||
                    selected.length > 100 ||
                    flow.command.isPending ||
                    (flow.vip.data?.enabled &&
                      (!flow.vip.data.termo || !flow.vip.data.procuracao))
                  }
                  onClick={() => void create()}
                >
                  Continuar com {selected.length} BL(s)
                </Button>
              )}
            </Card>
          )}
          {tab === "requests" && (
            <Card>
              {flow.requests.isLoading ? (
                <p>Carregando solicitações...</p>
              ) : flow.requests.error ? (
                <p role="alert">Falha ao consultar solicitações.</p>
              ) : (
                flow.requests.data?.items.map((r) => (
                  <div key={r.id} className="mb-3">
                    <Button variant="ghost" onClick={() => open(r.id)}>
                      {r.protocol} · {ceStateLabel(r.state)}
                    </Button>
                  </div>
                ))
              )}
              {flow.requests.data?.total === 0 && (
                <p>Nenhuma solicitação enviada.</p>
              )}
            </Card>
          )}
          <div className="my-4 flex items-center gap-3">
            <Button
              variant="ghost"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </Button>
            <span>Página {page}</span>
            <Button
              variant="ghost"
              disabled={
                page * 25 >=
                (tab === "new"
                  ? (flow.list.data?.total ?? 0)
                  : (flow.requests.data?.total ?? 0))
              }
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </Button>
          </div>
        </>
      )}
      {id && (
        <Card className="mt-4">
          {flow.detail.isLoading ? (
            <p>Carregando pedido...</p>
          ) : flow.detail.error ? (
            <p role="alert">Não foi possível consultar o pedido.</p>
          ) : (
            detail && (
              <>
                <div className="flex justify-between">
                  <h2 className="text-lg font-semibold">
                    {detail.protocol} · {ceStateLabel(detail.state)}
                  </h2>
                  <Button variant="ghost" onClick={() => open(null)}>
                    Fechar pedido
                  </Button>
                </div>
                {detail.items.map((i) => (
                  <article
                    key={i.bl_id}
                    className="my-4 border-b border-[var(--app-border)] pb-3"
                  >
                    <h3>
                      {i.bl_id} · CE {i.ce_mercante}
                    </h3>
                    <CeUnlockRequirements item={i} />
                    <p>{i.can_export ? "Requisitos atendidos" : i.reasons.join("; ")}</p>
                    {i.sla_started_at && (
                      <p>
                        {/* Só a data: o cliente não vê se o prazo da agência venceu. */}
                        Prazo: até {formatCeUnlockDeadline(ceUnlockDeadline(i.sla_started_at))}
                      </p>
                    )}
                  </article>
                ))}
                {allReady && latestStart && (
                  <p role="status" className="font-semibold">
                    Documentação validada. Prazo para o desbloqueio: até{" "}
                    {formatCeUnlockDeadline(ceUnlockDeadline(latestStart))}. Consulte o Mercante para verificar o
                    desbloqueio.
                  </p>
                )}
                {detail.items.some(i => i.sla_started_at) && (
                  <p>
                    O prazo é contado a partir da última pendência regularizada: envio da solicitação, reenvio de
                    documentos, entrega do BL original ou nova liquidação das taxas.
                  </p>
                )}
                <CeUnlockDocumentList
                  documents={detail.documents}
                  scope={flow.scope}
                />
                {!readOnly &&
                  ["draft", "changes_requested"].includes(detail.state) && (
                    <>
                      {detail.source === "request" ? (
                        <CeUnlockDocumentUploader
                          source="request"
                          requestId={detail.id}
                          scope={flow.scope}
                          onUploaded={flow.refresh}
                        />
                      ) : (
                        <p>Este pedido utiliza documentos anuais VIP.</p>
                      )}
                      <Button
                        disabled={flow.command.isPending || !submitReady}
                        onClick={() => void submit()}
                      >
                        {detail.state === "draft"
                          ? "Solicitar desbloqueio"
                          : "Reenviar solicitação"}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={flow.command.isPending}
                        onClick={() => void cancel()}
                      >
                        Cancelar solicitação
                      </Button>
                    </>
                  )}
                <h3 className="mt-4 font-semibold">Histórico</h3>
                {detail.events.map((e) => (
                  <p key={e.id}>
                    {new Date(e.created_at).toLocaleString("pt-BR")} ·{" "}
                    {ceActionLabel(e.action)}
                    {e.reason ? ` · ${e.reason}` : ""}
                  </p>
                ))}
              </>
            )
          )}
        </Card>
      )}
    </>
  );
}
