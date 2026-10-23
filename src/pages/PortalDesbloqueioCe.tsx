import { useId, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, Inbox, MapPin, Receipt, RefreshCw, SearchX, Upload, X } from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Block, Fact, FactList, LeadValue } from "../components/ui/Block";
import { Button } from "../components/ui/Button";
import { EmptyState, InlineError, PageHeader } from "../components/ui/Card";
import { CopyValue } from "../components/ui/CopyValue";
import { Input } from "../components/ui/Input";
import { MetricCard } from "../components/ui/MetricCard";
import { Modal } from "../components/ui/Modal";
import { NoValue } from "../components/ui/NoValue";
import { RowActionLink } from "../components/ui/RowActionLink";
import { SkeletonTable } from "../components/ui/Skeleton";
import { StatusText } from "../components/ui/StatusText";
import { TabButton } from "../components/ui/TabButton";
import { TabList } from "../components/ui/TabList";
import { TableFooterPagination } from "../components/ui/TableFooterPagination";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { QueryStateGate } from "../components/shared/QueryStateGate";
import { SelectAllFilteredCheckbox } from "../components/shared/SelectAllFilteredCheckbox";
import { capMessage, SELECT_ALL_CAP } from "../hooks/useFilteredSelection";
import {
  CeUnlockAnnualDocumentTable,
  CeUnlockDocumentSituation,
  CeUnlockFileButton,
  CeUnlockFileLink,
} from "../components/ce-unlock/CeUnlockDocuments";
import { CeUnlockDeliveryAddresses } from "../components/ce-unlock/CeUnlockDeliveryAddresses";
import { CeUnlockHistory } from "../components/ce-unlock/CeUnlockHistory";
import { CeUnlockRequirementIcon } from "../components/ce-unlock/CeUnlockRequirements";
import { CeUnlockVipCoveragePanel } from "../components/ce-unlock/CeUnlockVipCoveragePanel";
import { ceDate, ceDocumentName, ceDocumentStatusText, cePortalRequestState, ceRequestOpenForMove } from "../lib/ceUnlockLabels";
import { coveredUntil } from "../lib/ceUnlockCoverage";
import { formatDate } from "../lib/utils";
import { ceUnlockDeadline, formatCeUnlockDeadline, latestSlaStart } from "../services/ceUnlockSla";
import { usePortalCeUnlock } from "../hooks/usePortalCeUnlock";
import { downloadCeUnlockDocument, uploadCeUnlockDocument } from "../services/ceUnlockService";
import type { CeUnlockDocument, CeUnlockItem, CeUnlockRequest, CeUnlockVipCoverage } from "../types/ceUnlock";
import { portalPath, type PortalScope } from "../services/portalScope";

type Tab = "new" | "requests" | "annual";
type DocType = "termo" | "procuracao";
type CardFilter = "can_submit" | "open_charges" | "in_request";
const PAGE_SIZE = 25;
const SELECTION_LIMIT = 100;
const DOC_TYPES = ["termo", "procuracao"] as const;
const TAB_PARAM: Record<Tab, string | null> = { new: null, requests: "solicitacoes", annual: "anuais" };
const NUMBER_WORDS = ["Nenhum", "Um", "Dois", "Três", "Quatro", "Cinco", "Seis", "Sete", "Oito", "Nove", "Dez"];

const bls = (n: number) => (n === 1 ? "1 B/L" : `${n} B/Ls`);
/** "o termo de devolução", "a procuração", com o artigo do documento. */
const withArticle = (type: DocType) => (type === "termo" ? "o termo de devolução" : "a procuração");
const joinDocs = (types: DocType[]) => types.map(withArticle).join(" e ");
/** "o termo de devolução corrigido", "o termo de devolução e a procuração corrigidos". */
const correctedDocs = (types: DocType[]) =>
  types.length > 1 ? `${joinDocs(types)} corrigidos` : types[0] === "termo" ? "o termo de devolução corrigido" : "a procuração corrigida";

/** Versão mais recente de cada documento anexado à solicitação. */
const latestRequestDoc = (documents: CeUnlockDocument[], type: DocType) =>
  documents
    .filter((d) => d.type === type && d.source === "request" && d.status !== "uploading")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
/** Documentos cuja versão mais recente teve correção pedida ou aprovação revogada. */
const refusedTypes = (documents: CeUnlockDocument[]) =>
  DOC_TYPES.filter((type) => ["changes_requested", "revoked"].includes(latestRequestDoc(documents, type)?.status ?? ""));

/** B/L numa solicitação ativa (a cancelada não prende o B/L). */
const inRequest = (i: CeUnlockItem) => !!i.request_id && i.state !== "cancelled";
/** Taxas locais com fatura em aberto; "aguardando fatura" não pede ação do Cliente. */
const openCharges = (i: CeUnlockItem) => !i.paid && !i.local_charges_awaiting_invoice;

/** O que falta nos documentos anuais VIP, em fatos ("a procuração anual venceu"). */
function annualGaps(vip: CeUnlockVipCoverage) {
  return DOC_TYPES.filter((type) => !vip[type]).map((type) => {
    const doc = vip.documents
      .filter((d) => d.type === type && d.status !== "uploading")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const a = type === "termo" ? "o" : "a";
    const name = type === "termo" ? "o termo de devolução anual" : "a procuração anual";
    const fact = !doc
      ? `ainda não foi enviad${a}`
      : doc.status === "uploaded"
        ? "está em análise"
        : doc.status === "changes_requested"
          ? `foi recusad${a}`
          : doc.status === "revoked"
            ? "teve a aprovação revogada"
            : "venceu";
    return { type, sent: !!doc, waiting: doc?.status === "uploaded", text: `${name} ${fact}` };
  });
}

/**
 * O que falta nos documentos anuais VIP e o que acontece com os pedidos, uma
 * frase (ponto 13 de 2026-10-23: o Cliente VIP pede mesmo assim, com termo e
 * procuração anexados). Ex.: "A procuração anual foi recusada: envie a nova em
 * Documentos anuais. Até lá, as solicitações seguem com termo de devolução e
 * procuração anexados a elas."
 */
function annualGapMessage(vip: CeUnlockVipCoverage): string | null {
  const gaps = annualGaps(vip);
  if (!gaps.length) return null;
  const actionable = gaps.filter((g) => !g.waiting);
  const action = !actionable.length
    ? "os pedidos voltam a usar os documentos anuais quando a análise terminar"
    : actionable.length > 1
      ? "envie os novos em Documentos anuais"
      : !actionable[0].sent
        ? `envie ${actionable[0].type === "termo" ? "o termo" : "a procuração"} em Documentos anuais`
        : `envie ${actionable[0].type === "termo" ? "o novo" : "a nova"} em Documentos anuais`;
  const sentence = gaps.map((g) => g.text).join(" e ");
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}: ${action}. Até lá, as solicitações seguem com termo de devolução e procuração anexados a elas.`;
}

/**
 * Por que a solicitação de um Cliente VIP pede termo e procuração (ponto 13 de
 * 2026-10-23): o anual faltando, vencido, recusado ou revogado, ou B/L importado
 * antes da vigência dele (migration 449).
 */
function vipFallbackReason(vip: CeUnlockVipCoverage, items: CeUnlockItem[]): string {
  const gaps = annualGaps(vip);
  if (gaps.length) return gaps.map((g) => g.text).join(" e ");
  if (items.some((i) => i.vip_covered === false)) return "há B/L importado antes da vigência dos documentos anuais, que não retroage";
  return "os documentos anuais não cobriam os B/Ls quando a solicitação foi aberta";
}

/** Próximo passo do Cliente em cada situação; o Portal nunca fala de envio à ZPT. */
function nextStep(detail: CeUnlockRequest, validated: boolean): string | null {
  if (validated) return "consulte o Mercante para verificar o desbloqueio";
  const vipSource = detail.source === "vip_annual";
  switch (detail.state) {
    case "draft":
      return vipSource
        ? "os documentos anuais VIP cobrem esta solicitação; clique em Solicitar desbloqueio"
        : "anexe o termo de devolução e a procuração e clique em Solicitar desbloqueio";
    case "submitted":
      return "a agência vai analisar os documentos";
    case "in_review":
      return detail.items.some((i) => !i.delivered)
        ? "a agência está analisando os documentos; entregue o B/L original na agência"
        : "a agência está analisando os documentos";
    case "changes_requested": {
      const refused = refusedTypes(detail.documents);
      return refused.length ? `envie ${correctedDocs(refused)} e reenvie a solicitação` : "reenvie a solicitação";
    }
    case "completed":
      return "consulte o Mercante para verificar o desbloqueio";
    case "cancelled":
      return [...detail.events].reverse().find((e) => e.action === "cancel")?.reason ?? null;
    default:
      return null;
  }
}

export function PortalDesbloqueioCe() {
  const [params, setParams] = useSearchParams();
  const id = params.get("pedido");
  const tabParam = params.get("aba");
  const tab: Tab = tabParam === TAB_PARAM.requests ? "requests" : tabParam === TAB_PARAM.annual ? "annual" : "new";
  const [search, setSearch] = useState("");
  const [card, setCard] = useState<CardFilter | null>(null);
  const [listPage, setListPage] = useState(1);
  const [requestsPage, setRequestsPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  // Endereços das agências que recebem o B/L original, abertos por botão (ponto 6 de 2026-10-23).
  const [showDelivery, setShowDelivery] = useState(false);
  const deliveryId = useId();
  // Termo e procuração escolhidos e ainda não enviados: sobem ao clicar em Solicitar desbloqueio.
  const [pendingFiles, setPendingFiles] = useState<Partial<Record<DocType, File>>>({});
  const [sending, setSending] = useState(false);
  const draftKey = useRef(crypto.randomUUID());
  const submitKey = useRef(crypto.randomUUID());
  const cancelKey = useRef(crypto.randomUUID());
  const flow = usePortalCeUnlock(requestsPage, id);
  const confirm = useConfirm();
  const readOnly = flow.scope.mode === "inspect";
  const vip = flow.vip.data;
  const vipEnabled = !!vip?.enabled;
  const vipPending = vipEnabled && (!vip.termo || !vip.procuracao);
  // B/L importado antes da vigência dos anuais pede o termo comum: o modelo
  // precisa estar à mão também nesse caso.
  const vipHasUncoveredBl = vipEnabled && (flow.list.data ?? []).some((item) => item.vip_covered === false);
  const detail = flow.detail.data;

  // Nova solicitação: a lista inteira do Cliente; busca, cartões e paginação aqui.
  const allItems = flow.list.data ?? [];
  const needle = search.trim().toLowerCase();
  const searched = needle
    ? allItems.filter((i) => i.bl_id.toLowerCase().includes(needle) || (i.ce_mercante ?? "").toLowerCase().includes(needle))
    : allItems;
  // Com documento anual faltando o VIP pede mesmo assim: a solicitação nasce comum, com termo e
  // procuração anexados (migration 449, ponto 13 de 2026-10-23).
  const canRequest = (i: CeUnlockItem) => i.can_submit;
  const cardFilters: Record<CardFilter, (i: CeUnlockItem) => boolean> = {
    can_submit: canRequest,
    open_charges: openCharges,
    in_request: inRequest,
  };
  const filtered = card ? searched.filter(cardFilters[card]) : searched;
  const pageItems = filtered.slice((listPage - 1) * PAGE_SIZE, listPage * PAGE_SIZE);
  // "Selecionar todos" marca os disponíveis do filtro inteiro, em todas as páginas (revisão de
  // 2026-10-22, G1). A seleção continua entre buscas, como um carrinho do pedido.
  const filteredSelectable = filtered.filter((i) => i.can_submit).map((i) => i.bl_id);
  const allFilteredSelected = filteredSelectable.length > 0 && filteredSelectable.every((b) => selected.includes(b));
  const selectAllFiltered = {
    allSelected: allFilteredSelected,
    someSelected: !allFilteredSelected && filteredSelectable.some((b) => selected.includes(b)),
    loadingAll: false,
    totalCount: filteredSelectable.length,
    toggleAll: async () => {
      // Mesmo teto das telas internas: acima dele, pede para refinar a busca.
      if (!allFilteredSelected && filteredSelectable.length > SELECT_ALL_CAP) {
        setError(capMessage(filteredSelectable.length));
        return;
      }
      toggle(filteredSelectable, !allFilteredSelected);
    },
  };
  const byBl = new Map(allItems.map((i) => [i.bl_id, i]));
  // A seleção nasce VIP só se os anuais cobrem todos os B/Ls (vigentes e com o B/L importado na vigência).
  const vipCoversSelection = vipEnabled && !vipPending && selected.every((b) => byBl.get(b)?.vip_covered !== false);
  const moves = selected.flatMap((b) => {
    const item = byBl.get(b);
    return item?.request_id && ceRequestOpenForMove(item.state) ? [item] : [];
  });
  // A antiga é cancelada quando todos os B/Ls ativos dela vão para a nova: conta
  // pelos `bl_ids` da solicitação, que incluem B/L que o Portal deixou de listar.
  const sourceBls = (requestId: string) =>
    flow.allRequests.data?.find((r) => r.id === requestId)?.bl_ids
    ?? allItems.filter((i) => i.request_id === requestId && inRequest(i)).map((i) => i.bl_id);
  const emptied = (requestId: string) => sourceBls(requestId).every((b) => selected.includes(b));
  const movedFrom = new Set(moves.map((i) => i.request_id));

  // Detalhe: documento do pedido ainda não apresentado, ou recusado e sem nova versão.
  const missingDocs = DOC_TYPES.filter((type) => {
    if (pendingFiles[type]) return false;
    const latest = detail ? latestRequestDoc(detail.documents, type) : undefined;
    return !latest || !["uploaded", "approved"].includes(latest.status);
  });
  const vipSource = detail?.source === "vip_annual";
  const documentsReady = vipSource ? !!(vip?.enabled && vip.termo && vip.procuracao) : missingDocs.length === 0;
  const pendingItems = detail?.items.filter((i) => !i.confirmed) ?? [];
  const unpaid = pendingItems.some((i) => !i.paid);
  const submitReady = documentsReady && pendingItems.length > 0 && !unpaid;
  // Com os quatro requisitos atendidos em todos os B/Ls: o prazo final parte da pendência resolvida mais recente.
  const allReady = !!detail && detail.items.length > 0 && detail.items.every((i) => i.can_export);
  const latestStart = detail ? latestSlaStart(detail.items) : null;
  const validated = allReady && !!latestStart;
  const editable = !!detail && !readOnly && ["draft", "changes_requested"].includes(detail.state);
  const openedAt = detail
    ? (detail.events.find((e) => e.action === "draft" || e.action === "submit") ?? detail.events[0])?.created_at
    : undefined;

  const open = (next: string | null) => {
    setParams((p) => {
      if (next) p.set("pedido", next);
      else p.delete("pedido");
      return p;
    });
    submitKey.current = crypto.randomUUID();
    setPendingFiles({});
    setError("");
  };
  function changeTab(next: Tab) {
    setParams((p) => {
      const value = TAB_PARAM[next];
      if (value) p.set("aba", value);
      else p.delete("aba");
      return p;
    });
    setRequestsPage(1);
  }
  function toggle(blIds: string[], on: boolean) {
    setSelected((prev) => (on ? [...new Set([...prev, ...blIds])] : prev.filter((b) => !blIds.includes(b))));
    draftKey.current = crypto.randomUUID();
  }
  // O rascunho só reserva os B/Ls e o próprio Cliente pode cancelá-lo: só pede
  // confirmação quando algum B/L sai de outra solicitação (migration 299).
  function request() {
    if (moves.length) setMoving(true);
    else void create();
  }
  async function create() {
    setError("");
    try {
      const r = await flow.command.mutateAsync({
        action: "draft",
        payload: { bl_ids: selected, request_key: draftKey.current },
      });
      if (!r) throw new Error("Resposta incompleta da solicitação");
      setMoving(false);
      open(r.id);
      setSelected([]);
      draftKey.current = crypto.randomUUID();
    } catch (e) {
      setMoving(false);
      setError(e instanceof Error ? e.message : "Não foi possível preparar a solicitação");
    }
  }
  async function submit() {
    if (!detail) return;
    const resend = detail.state !== "draft";
    if (
      !(await confirm({
        message: resend
          ? `Reenviar a solicitação ${detail.protocol}?`
          : `Solicitar o desbloqueio dos B/Ls do protocolo ${detail.protocol}?`,
        affected: { summary: bls(detail.items.length), items: detail.items.map((i) => i.bl_id) },
        consequence: "A agência recebe os documentos para análise. A entrega do B/L original continua necessária.",
        reversibility: "A agência pode pedir correção de um documento antes de concluir.",
        confirmLabel: resend ? "Reenviar solicitação" : "Solicitar desbloqueio",
      }))
    )
      return;
    setError("");
    setSending(true);
    try {
      // Cada anexo vira nova versão do documento e incrementa a versão do pedido;
      // o envio usa a versão relida depois deles. Anexo já enviado sai da lista,
      // então uma nova tentativa só reenvia o que faltou.
      let version = detail.version;
      const queued = DOC_TYPES.filter((type) => pendingFiles[type]);
      for (const type of queued) {
        await uploadCeUnlockDocument({ source: "request", request_id: detail.id, type }, pendingFiles[type]!, flow.scope);
        setPendingFiles((prev) => ({ ...prev, [type]: undefined }));
      }
      if (queued.length) {
        await flow.refresh();
        const fresh = await flow.detail.refetch();
        version = fresh.data?.version ?? version;
      }
      await flow.command.mutateAsync({
        action: "submit",
        payload: { request_id: detail.id, expected_version: version, request_key: submitKey.current },
      });
      submitKey.current = crypto.randomUUID();
      changeTab("requests");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível enviar o pedido");
      // Anexo recusado (ex.: não é PDF) precisa ser escolhido de novo; o que já subiu aparece acima.
      setPendingFiles({});
    } finally {
      setSending(false);
    }
  }
  async function cancel() {
    if (!detail) return;
    if (
      !(await confirm({
        message: `Cancelar a solicitação ${detail.protocol}?`,
        affected: { summary: bls(detail.items.length), items: detail.items.map((i) => i.bl_id) },
        consequence: "Os B/Ls ficam livres para uma nova solicitação.",
        reversibility: "Não pode ser desfeito. Para pedir o desbloqueio de novo, abra uma nova solicitação.",
        confirmLabel: "Cancelar solicitação",
        tone: "danger",
      }))
    )
      return;
    setError("");
    try {
      await flow.command.mutateAsync({
        action: "cancel",
        payload: { request_id: detail.id, expected_version: detail.version, request_key: cancelKey.current },
      });
      cancelKey.current = crypto.randomUUID();
      open(null);
      changeTab("requests");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível cancelar a solicitação");
    }
  }
  const requestsTotal = flow.requests.data?.total ?? 0;
  const annualMissing = vipEnabled ? DOC_TYPES.filter((type) => !vip?.[type]).length : 0;
  const gap = vipPending && vip ? annualGapMessage(vip) : null;
  const termoUntil = vip ? coveredUntil(vip.documents, "termo") : null;
  const procuracaoUntil = vip ? coveredUntil(vip.documents, "procuracao") : null;
  const filterCard = (next: CardFilter) => {
    setCard((current) => (current === next ? null : next));
    setListPage(1);
  };
  return (
    <>
      <PageHeader title="Desbloqueio de CE" />
      <TabList label="Seções do Desbloqueio de CE">
        <TabButton active={tab === "new"} label="Nova solicitação" onClick={() => changeTab("new")} />
        <TabButton active={tab === "requests"} label="Minhas solicitações" onClick={() => changeTab("requests")} />
        {vipEnabled && (
          <TabButton
            active={tab === "annual"}
            label="Documentos anuais"
            count={annualMissing || null}
            countLabel={annualMissing === 1 ? "1 documento a regularizar" : `${annualMissing} documentos a regularizar`}
            onClick={() => changeTab("annual")}
          />
        )}
      </TabList>
      {error && !id && (
        <div className="mb-4">
          <InlineError message={error} />
        </div>
      )}

      {tab === "annual" && <CeUnlockVipCoveragePanel scope={flow.scope} />}

      {tab === "new" && (
        <div className="space-y-4">
          <Block
            title="O que o desbloqueio pede"
            aside={
              <>
                <span>para cada B/L</span>
                {vipEnabled && <Badge tone="slate" title="Condição VIP: documentos anuais">VIP</Badge>}
                {(!vipEnabled || vipPending || vipHasUncoveredBl) && flow.model.data && (
                  <Button
                    variant="secondary"
                    className="app-btn--sm"
                    onClick={() =>
                      void downloadCeUnlockDocument(flow.model.data!.id, flow.scope).catch((e) => setError(e.message))
                    }
                  >
                    <Download size={14} aria-hidden="true" />
                    Baixar modelo do termo
                  </Button>
                )}
                {/* ponytail: modelo estático do frontend, fora do requisito e do versionamento do termo;
                    trocar o texto exige deploy. Se a agência precisar atualizá-lo sozinha, migrar para
                    um documento gerenciado como o modelo do termo. */}
                <a
                  className="app-btn app-btn--secondary app-btn--sm"
                  href="/templates/memorando-liberacao-documentos-modelo.docx"
                  download="memorando-liberacao-documentos.docx"
                  title="Para retirar documentos na agência: preencha em papel timbrado e assine."
                >
                  <Download size={14} aria-hidden="true" />
                  Baixar memorando de liberação
                </a>
              </>
            }
          >
            <FactList columns={4}>
              <Fact label="Taxas locais">Pagas, B/L a B/L (na tabela)</Fact>
              <Fact
                label="Termo de devolução"
                detail={!vipEnabled && flow.model.isSuccess && !flow.model.data ? "Modelo ainda não disponibilizado pela agência." : null}
              >
                {!vipEnabled ? (
                  "Assinado, em PDF, anexado à solicitação"
                ) : vip?.termo ? (
                  `Coberto pelo termo anual${termoUntil ? ` até ${formatDate(termoUntil)}` : ""}`
                ) : (
                  <>
                    <StatusText tone="warning">Falta o termo anual</StatusText>
                    <span className="block">Até lá, assinado, em PDF, anexado à solicitação</span>
                  </>
                )}
              </Fact>
              <Fact label="Procuração">
                {!vipEnabled ? (
                  "Em PDF, anexada à solicitação"
                ) : vip?.procuracao ? (
                  `Coberta pela procuração anual${procuracaoUntil ? ` até ${formatDate(procuracaoUntil)}` : ""}`
                ) : (
                  <>
                    <StatusText tone="warning">Falta a procuração anual</StatusText>
                    <span className="block">Até lá, em PDF, anexada à solicitação</span>
                  </>
                )}
              </Fact>
              <Fact
                label="B/L original"
                detail={
                  <Button
                    variant="secondary"
                    className="app-btn--sm"
                    aria-expanded={showDelivery}
                    aria-controls={deliveryId}
                    onClick={() => setShowDelivery((open) => !open)}
                  >
                    <MapPin size={14} aria-hidden="true" />
                    {showDelivery ? "Ocultar endereços de entrega" : "Endereços de entrega do B/L"}
                  </Button>
                }
              >
                Entregue na agência
              </Fact>
            </FactList>
            {showDelivery ? <CeUnlockDeliveryAddresses id={deliveryId} /> : null}
            {gap && (
              <div className="app-callout app-callout--warning flex flex-wrap items-center gap-3">
                <span>{gap}</span>
                <Button variant="secondary" className="app-btn--sm ml-auto" onClick={() => changeTab("annual")}>
                  Abrir Documentos anuais
                </Button>
              </div>
            )}
          </Block>

          <div className="app-metric-row" role="group" aria-label="Situação dos B/Ls">
            <MetricCard
              label="Podem ser pedidos"
              value={flow.list.data ? searched.filter(canRequest).length : <NoValue label="Carregando" />}
              selected={card === "can_submit"}
              onSelect={() => filterCard("can_submit")}
            />
            <MetricCard
              label="Com taxas locais em aberto"
              value={flow.list.data ? searched.filter(openCharges).length : <NoValue label="Carregando" />}
              tone={searched.some(openCharges) ? "warning" : "secondary"}
              selected={card === "open_charges"}
              onSelect={() => filterCard("open_charges")}
            />
            <MetricCard
              label="Já em solicitação"
              value={flow.list.data ? searched.filter(inRequest).length : <NoValue label="Carregando" />}
              selected={card === "in_request"}
              onSelect={() => filterCard("in_request")}
            />
          </div>

          <Block
            title="B/Ls com CE Mercante"
            flush
            aside={
              <>
                {flow.list.data ? <span>{filtered.length}</span> : null}
                <Input
                  type="search"
                  aria-label="Buscar B/L ou CE"
                  placeholder="Buscar B/L ou CE"
                  className="w-full sm:w-[260px]"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setListPage(1);
                  }}
                />
              </>
            }
          >
            <QueryStateGate
              isLoading={false}
              isError={Boolean(flow.list.error)}
              hasData={flow.list.data !== undefined}
              errorMessage="Falha ao consultar B/Ls."
              onRetry={() => void flow.list.refetch?.()}
            >
              <div className="app-table-scroll">
                <table className="app-table app-table--compact whitespace-nowrap text-sm">
                  <caption className="sr-only">B/Ls com CE Mercante</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="w-10">
                        <SelectAllFilteredCheckbox selection={selectAllFiltered} noun="B/Ls disponíveis" disabled={readOnly} />
                      </th>
                      <th scope="col">B/L</th>
                      <th scope="col">CE Mercante</th>
                      <th scope="col" className="app-table__text-head">Navio / Viagem</th>
                      <th scope="col">POD</th>
                      <th scope="col">Taxas locais</th>
                      <th scope="col">Solicitação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flow.list.isLoading && (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <SkeletonTable rows={5} cols={7} label="Carregando B/Ls" />
                        </td>
                      </tr>
                    )}
                    {flow.list.data && filtered.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <EmptyState
                            icon={SearchX}
                            title={
                              search
                                ? "Nenhum B/L encontrado"
                                : card
                                  ? "Nenhum B/L nesta situação"
                                  : "Nenhum B/L com CE Mercante"
                            }
                            description={
                              search
                                ? "Confira o número digitado."
                                : card
                                  ? "Escolha outro cartão ou clique de novo neste para ver todos."
                                  : "Os B/Ls aparecem aqui assim que o CE Mercante for registrado."
                            }
                          />
                        </td>
                      </tr>
                    )}
                    {pageItems.map((i) => {
                      const checked = selected.includes(i.bl_id);
                      const state = cePortalRequestState(i.state);
                      return (
                        <tr key={i.bl_id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Selecionar B/L ${i.bl_id}`}
                              disabled={readOnly || (!i.can_submit && !checked)}
                              checked={checked}
                              onChange={(e) => toggle([i.bl_id], e.target.checked)}
                            />
                          </td>
                          <td className="font-semibold">
                            <CopyValue value={i.bl_id} label="número do B/L" />
                          </td>
                          <td>
                            {i.ce_mercante ? <CopyValue value={i.ce_mercante} label="CE Mercante" /> : <NoValue label="Sem CE Mercante" />}
                          </td>
                          <td className="app-table__text">
                            {[i.vessel_name, i.voyage_number].filter(Boolean).join(" / ") || <NoValue label="Sem navio/viagem" />}
                          </td>
                          <td>{i.pod ?? <NoValue label="Sem POD" />}</td>
                          <td>
                            {i.paid ? (
                              i.paid_exempt ? <StatusText tone="muted">Isentas</StatusText> : <StatusText tone="paid">Pagas</StatusText>
                            ) : i.local_charges_awaiting_invoice ? (
                              "Aguardando fatura"
                            ) : (
                              <span className="inline-flex items-center gap-2">
                                <StatusText tone="warning">Em aberto</StatusText>
                                <RowActionLink to={portalPath(flow.scope, "/billing")} label={`Ver faturas do B/L ${i.bl_id}`} title="Ver faturas" icon={Receipt} />
                              </span>
                            )}
                          </td>
                          <td>
                            {inRequest(i) ? (
                              <>
                                <button
                                  type="button"
                                  className="app-link"
                                  aria-label={`Abrir solicitação ${i.protocol ?? ""}`.trim()}
                                  onClick={() => open(i.request_id)}
                                >
                                  {i.protocol}
                                </button>
                                {" · "}
                                {state.tone === "default" ? state.label : <StatusText tone={state.tone}>{state.label}</StatusText>}
                              </>
                            ) : (
                              <NoValue label="Sem solicitação" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </QueryStateGate>
            {filtered.length > PAGE_SIZE ? (
              <TableFooterPagination
                page={listPage}
                pageSize={PAGE_SIZE}
                totalCount={filtered.length}
                totalPages={Math.ceil(filtered.length / PAGE_SIZE)}
                onPageChange={setListPage}
              />
            ) : null}
          </Block>

          {!readOnly && (
            <div className="app-bulk-bar" role="region" aria-label="Seleção">
              <span className="app-bulk-bar__count" aria-live="polite">
                {selected.length ? `${bls(selected.length)} selecionado${selected.length === 1 ? "" : "s"}` : "Selecione os B/Ls"}
                {" · "}
                {selected.length > SELECTION_LIMIT ? (
                  <StatusText tone="danger">máximo de {SELECTION_LIMIT} B/Ls por solicitação</StatusText>
                ) : (
                  <span className="app-table__cell-meta">
                    {vipEnabled && !vipCoversSelection && selected.length > 0
                      ? "os documentos anuais não cobrem esta seleção: a solicitação seguirá com termo e procuração anexados"
                      : "a seleção abre a solicitação com os documentos"}
                  </span>
                )}
              </span>
              <div className="app-bulk-bar__actions">
                {selected.length > 0 && (
                  <Button variant="ghost" onClick={() => toggle(selected, false)}>
                    <X size={15} aria-hidden="true" />
                    Limpar seleção
                  </Button>
                )}
                <Button
                  disabled={!selected.length || selected.length > SELECTION_LIMIT || flow.command.isPending}
                  onClick={request}
                >
                  Pedir desbloqueio de {bls(selected.length)}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "requests" && (
        <Block title="Minhas solicitações" flush aside={flow.requests.data ? String(requestsTotal) : undefined}>
          <QueryStateGate
            isLoading={false}
            isError={Boolean(flow.requests.error)}
            hasData={flow.requests.data !== undefined}
            errorMessage="Falha ao consultar solicitações."
            onRetry={() => void flow.requests.refetch?.()}
          >
            {flow.requests.isLoading ? (
              <SkeletonTable rows={4} cols={6} label="Carregando solicitações" />
            ) : requestsTotal === 0 ? (
              <EmptyState
                icon={Inbox}
                title="Nenhuma solicitação ainda"
                description="Selecione os B/Ls em Nova solicitação para pedir o desbloqueio."
                action={
                  <Button variant="secondary" onClick={() => changeTab("new")}>
                    Nova solicitação
                  </Button>
                }
              />
            ) : (
              <div className="app-table-scroll">
                <table className="app-table app-table--compact whitespace-nowrap text-sm">
                  <caption className="sr-only">Minhas solicitações de desbloqueio</caption>
                  <thead>
                    <tr>
                      <th scope="col">Protocolo</th>
                      <th scope="col">Aberta em</th>
                      <th scope="col">B/Ls</th>
                      <th scope="col">Documentos</th>
                      <th scope="col">Prazo para desbloqueio</th>
                      <th scope="col" className="app-table__text-head">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flow.requests.data?.items.map((r) => {
                      const state = cePortalRequestState(r.state);
                      const blIds = r.bl_ids ?? [];
                      const correction = flow.correctionDetails.get(r.id);
                      const refused = correction ? refusedTypes(correction.documents) : [];
                      const situation =
                        r.state === "draft"
                          ? "Rascunho · falta enviar"
                          : r.state === "changes_requested" && correction
                            ? `Correção pedida · reenvie ${refused.length ? joinDocs(refused) : "a solicitação"}`
                            : state.label;
                      return (
                        <tr key={r.id} className={r.state === "cancelled" ? "app-table__row--muted" : undefined}>
                          <td>
                            <button type="button" className="app-link" onClick={() => open(r.id)}>
                              {r.protocol}
                            </button>
                          </td>
                          <td className="tabular-nums">{r.created_at ? ceDate(r.created_at) : <NoValue label="Sem data" />}</td>
                          <td title={blIds.join(", ") || undefined}>
                            {blIds.length ? `${blIds[0]}${blIds.length > 1 ? ` +${blIds.length - 1}` : ""}` : <NoValue label="Sem B/L" />}
                          </td>
                          <td>
                            {r.state === "draft" ? (
                              <NoValue label="Ainda não enviados" />
                            ) : r.source === "vip_annual" ? (
                              "Anuais VIP"
                            ) : (
                              "Da solicitação"
                            )}
                          </td>
                          <td className="tabular-nums">
                            {r.sla_started_at ? formatCeUnlockDeadline(ceUnlockDeadline(r.sla_started_at)) : <NoValue label="Sem prazo" />}
                          </td>
                          <td>
                            <span className="app-table__cell-stack">
                              {state.tone === "default" ? situation : <StatusText tone={state.tone}>{situation}</StatusText>}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </QueryStateGate>
          {requestsTotal > PAGE_SIZE ? (
            <TableFooterPagination
              page={requestsPage}
              pageSize={PAGE_SIZE}
              totalCount={requestsTotal}
              totalPages={Math.ceil(requestsTotal / PAGE_SIZE)}
              onPageChange={setRequestsPage}
            />
          ) : null}
        </Block>
      )}

      <Modal
        open={moving}
        size="md"
        title={`Pedir desbloqueio de ${bls(selected.length)}`}
        onClose={() => setMoving(false)}
      >
        <div className="space-y-4">
          <p>
            {moves.length === 1
              ? "Um B/L está em outra solicitação e passa para esta:"
              : `${NUMBER_WORDS[moves.length] ?? moves.length} B/Ls estão em outras solicitações e passam para esta:`}
          </p>
          <div className="app-table-scroll">
            <table className="app-table app-table--compact whitespace-nowrap text-sm">
              <caption className="sr-only">B/Ls que mudam de solicitação</caption>
              <thead>
                <tr>
                  <th scope="col">B/L</th>
                  <th scope="col" className="app-table__text-head">Sai de</th>
                  <th scope="col" className="app-table__text-head">O que acontece com a antiga</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((i) => (
                  <tr key={i.bl_id}>
                    <td>{i.bl_id}</td>
                    <td className="app-table__text">
                      {i.protocol} · {cePortalRequestState(i.state).label}
                    </td>
                    <td className="app-table__text">
                      {emptied(i.request_id!) ? "Fica sem B/L e é cancelada" : "Continua aberta com os outros B/Ls"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="app-table__cell-meta">
            {/* Cliente VIP: os anuais cobrem a nova; a frase sobre termo e procuração não aparece. */}
            {vipCoversSelection
              ? ""
              : movedFrom.size > 1
                ? "Os documentos e a análise das solicitações antigas não passam para a nova: termo e procuração são enviados de novo nesta. "
                : "Os documentos e a análise da solicitação antiga não passam para a nova: termo e procuração são enviados de novo nesta. "}
            Não dá para desfazer; para voltar, crie outra solicitação.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setMoving(false)}>
              Voltar
            </Button>
            {/* Espera os B/Ls de cada solicitação antiga: a tabela acima precisa estar certa. */}
            <Button disabled={!flow.allRequests.data} loading={flow.command.isPending} loadingLabel="Preparando…" onClick={() => void create()}>
              Mudar {bls(moves.length)} e continuar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!id}
        title={detail ? `Solicitação ${detail.protocol}` : "Solicitação de desbloqueio"}
        onClose={() => open(null)}
      >
        {flow.detail.isLoading ? (
          <p className="text-sm text-[var(--app-muted)]">Carregando solicitação…</p>
        ) : flow.detail.error ? (
          <InlineError message="Não foi possível consultar a solicitação." />
        ) : (
          detail && (
            <div className="space-y-4">
              {editable && (
                <div className="flex justify-end">
                  <Button variant="danger" disabled={sending || flow.command.isPending} onClick={() => void cancel()}>
                    Cancelar solicitação
                  </Button>
                </div>
              )}
              {error && <InlineError message={error} />}

              <Block title="Solicitação" headingLevel={3} aside={openedAt ? `aberta em ${ceDate(openedAt)}` : undefined}>
                <LeadValue
                  tone={validated ? "default" : cePortalRequestState(detail.state).tone}
                  detail={nextStep(detail, validated)}
                >
                  {validated ? "Documentação validada" : cePortalRequestState(detail.state).label}
                </LeadValue>
                <FactList columns={4}>
                  <Fact label="B/Ls">{detail.items.length}</Fact>
                  {/* Só a data: o Cliente não vê se o prazo da agência venceu. */}
                  <Fact label="Prazo para desbloqueio">
                    {latestStart ? formatCeUnlockDeadline(ceUnlockDeadline(latestStart)) : <NoValue label="Sem prazo" />}
                  </Fact>
                  <Fact label="Documentos">{vipSource ? "Anuais VIP" : "Da solicitação"}</Fact>
                </FactList>
                {vipEnabled && !vipSource && vip && detail.state !== "cancelled" && (
                  <div className="app-callout app-callout--warning">
                    Sua condição VIP não cobre esta solicitação: {vipFallbackReason(vip, detail.items)}. Por isso ela segue
                    como as comuns, com o termo de devolução e a procuração anexados a ela.
                  </div>
                )}
                {!latestStart && detail.state !== "cancelled" && (
                  <p className="app-table__cell-meta">
                    O prazo para desbloqueio começa a contar quando os quatro requisitos estiverem cumpridos em todos os
                    B/Ls: taxas locais pagas, termo de devolução e procuração aprovados e B/L original entregue na agência.
                  </p>
                )}
              </Block>

              <Block
                title="Documentos"
                headingLevel={3}
                flush
                aside={vipSource ? "cobertos pelos documentos anuais VIP" : "valem para todos os B/Ls da solicitação"}
              >
                {vipSource ? (
                  detail.documents.some((d) => d.source === "vip_annual") ? (
                    <CeUnlockAnnualDocumentTable
                      documents={detail.documents.filter((d) => d.source === "vip_annual")}
                      scope={flow.scope}
                      onError={setError}
                    />
                  ) : (
                    <div className="app-block__body">
                      <p>Os documentos anuais VIP entram na solicitação quando ela é enviada.</p>
                    </div>
                  )
                ) : (
                  <RequestDocuments
                    request={detail}
                    scope={flow.scope}
                    editable={editable}
                    pending={pendingFiles}
                    busy={sending}
                    onPick={(type, file) => setPendingFiles((prev) => ({ ...prev, [type]: file }))}
                    onError={setError}
                  />
                )}
              </Block>

              <Block title="B/Ls da solicitação" headingLevel={3} flush>
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact whitespace-nowrap text-sm">
                    <caption className="sr-only">Requisitos de cada B/L da solicitação</caption>
                    <thead>
                      <tr>
                        <th scope="col">B/L</th>
                        <th scope="col">CE Mercante</th>
                        <th scope="col">Termo de devolução</th>
                        <th scope="col">Procuração</th>
                        <th scope="col">Taxas locais</th>
                        <th scope="col">B/L original</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map((i) => (
                        <tr key={i.bl_id}>
                          <td><CopyValue value={i.bl_id} label="número do B/L" /></td>
                          <td>{i.ce_mercante ? <CopyValue value={i.ce_mercante} label="CE Mercante" /> : <NoValue label="Sem CE Mercante" />}</td>
                          <td><CeUnlockRequirementIcon ok={!!i.termo} label="Termo de devolução" subject={i.bl_id} /></td>
                          <td><CeUnlockRequirementIcon ok={!!i.procuracao} label="Procuração" subject={i.bl_id} /></td>
                          <td><CeUnlockRequirementIcon ok={!!i.paid} label="Taxas locais" subject={i.bl_id} /></td>
                          <td><CeUnlockRequirementIcon ok={!!i.delivered} label="B/L original" subject={i.bl_id} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Block>

              <CeUnlockHistory events={detail.events} />

              {editable && (
                <div className="flex flex-wrap items-center gap-3 border-t border-[var(--app-border)] pt-4">
                  {!submitReady && (
                    <span className="app-table__cell-meta">
                      {!documentsReady
                        ? vipSource
                          ? "Regularize os documentos anuais VIP para enviar."
                          : detail.state === "draft"
                            ? `Anexe ${joinDocs(missingDocs)} para solicitar.`
                            : `Envie ${correctedDocs(missingDocs)} para reenviar.`
                        : unpaid
                          ? "Há B/L com taxas locais em aberto."
                          : null}
                    </span>
                  )}
                  <Button
                    className="ml-auto"
                    disabled={sending || flow.command.isPending || !submitReady}
                    loading={sending}
                    loadingLabel="Enviando…"
                    onClick={() => void submit()}
                  >
                    {detail.state === "draft" ? "Solicitar desbloqueio" : "Reenviar solicitação"}
                  </Button>
                </div>
              )}
            </div>
          )
        )}
      </Modal>
    </>
  );
}

/**
 * Documentos da solicitação em tabela (lote 4 da identidade): a versão mais
 * recente de cada documento; o arquivo escolhido e ainda não enviado aparece
 * numa linha própria e sobe ao solicitar (ou reenviar). Com correção pedida,
 * "Enviar nova versão" só na linha do documento recusado.
 */
function RequestDocuments({
  request,
  scope,
  editable,
  pending,
  busy,
  onPick,
  onError,
}: {
  request: CeUnlockRequest;
  scope: PortalScope;
  editable: boolean;
  pending: Partial<Record<DocType, File>>;
  busy: boolean;
  onPick: (type: DocType, file: File) => void;
  onError: (message: string) => void;
}) {
  const draft = request.state === "draft";
  const when = draft ? "Sobe ao solicitar o desbloqueio" : "Sobe ao reenviar a solicitação";
  const fileButton = (type: DocType, label: string, variant: "primary" | "secondary") => (
    <CeUnlockFileButton
      variant={variant}
      inputLabel={`Arquivo ${type === "termo" ? "do termo de devolução" : "da procuração"} (PDF)`}
      ariaLabel={`${label}: ${ceDocumentName(type).toLowerCase()}`}
      icon={label === "Anexar PDF" ? Upload : RefreshCw}
      disabled={busy}
      onFile={(file) => onPick(type, file)}
    >
      {label}
    </CeUnlockFileButton>
  );
  return (
    <div className="app-table-scroll">
      <table className="app-table app-table--compact text-sm">
        <caption className="sr-only">Documentos da solicitação</caption>
        <thead>
          <tr>
            <th scope="col" className="app-table__text-head">Documento</th>
            <th scope="col" className="app-table__text-head">Arquivo</th>
            <th scope="col">Enviado em</th>
            <th scope="col" className="app-table__text-head">Situação</th>
            {editable ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {DOC_TYPES.map((type) => {
            const doc = latestRequestDoc(request.documents, type);
            const file = pending[type];
            const refused = !!doc && ["changes_requested", "revoked"].includes(doc.status);
            // Rascunho: anexa ou troca qualquer um; com correção pedida, só o recusado (ou o que falta).
            const replaceable = editable && !file && (draft || !doc || refused);
            const label = !doc ? "Anexar PDF" : draft ? "Trocar arquivo" : "Enviar nova versão";
            return [
              doc || !file ? (
                <tr key={`${type}-doc`}>
                  <td className="app-table__text">{ceDocumentName(type)}</td>
                  <td className="app-table__text">
                    {doc ? <CeUnlockFileLink doc={doc} scope={scope} onError={onError} /> : <NoValue label="Sem arquivo" />}
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{doc ? ceDate(doc.created_at) : <NoValue label="Não enviado" />}</td>
                  <td className="whitespace-nowrap">
                    {doc ? (
                      <CeUnlockDocumentSituation doc={doc} />
                    ) : (
                      <span className="app-table__cell-stack">
                        {editable ? <StatusText tone="warning">Falta anexar</StatusText> : ceDocumentStatusText(type, null).label}
                      </span>
                    )}
                  </td>
                  {editable ? (
                    <td className="whitespace-nowrap text-right">
                      {replaceable ? fileButton(type, label, doc && !refused ? "secondary" : "primary") : null}
                    </td>
                  ) : null}
                </tr>
              ) : null,
              file ? (
                <tr key={`${type}-pending`}>
                  <td className="app-table__text">{ceDocumentName(type)}</td>
                  <td className="app-table__text" title={file.name}>{file.name}</td>
                  <td><NoValue label="Ainda não enviado" /></td>
                  <td className="whitespace-nowrap"><span className="app-table__cell-stack">{when}</span></td>
                  <td className="whitespace-nowrap text-right">{fileButton(type, "Trocar arquivo", "secondary")}</td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
