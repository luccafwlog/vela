// @vitest-environment jsdom
// Fluxo do Portal com o hook real (usePortalCeUnlock) e o serviço simulado: cobre
// invalidação após erro, chave idempotente em retry e a rota de inspeção.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PortalDesbloqueioCe } from "../PortalDesbloqueioCe";
import { PortalScopeProvider } from "../../hooks/usePortalScope";
import type { PortalScope } from "../../services/portalScope";

const svc = vi.hoisted(() => ({
  listPortalCeUnlockBls: vi.fn(),
  fetchAllPortalCeUnlockBls: vi.fn(),
  listPortalCeUnlockRequests: vi.fn(),
  fetchAllPortalCeUnlockRequests: vi.fn(async () => []),
  getPortalCeUnlockVip: vi.fn(),
  getPortalCeUnlockModel: vi.fn(),
  getPortalCeUnlockRequest: vi.fn(),
  portalCeUnlockCommand: vi.fn(),
  downloadCeUnlockDocument: vi.fn(),
  uploadCeUnlockDocument: vi.fn(),
  getCeUnlockVip: vi.fn(),
  ceUnlockCommand: vi.fn(),
  confirm: vi.fn(async () => true),
}));
vi.mock("../../services/ceUnlockService", () => svc);

// Central de Informações do Portal: os endereços de entrega do B/L original (migration 447).
const information = vi.hoisted(() => ({
  state: { isLoading: false, isError: false, data: { contacts: [] as Array<Record<string, unknown>> } as { contacts: Array<Record<string, unknown>> } | undefined },
  refetch: vi.fn(),
}));
vi.mock("../../hooks/usePortalInformation", () => ({
  usePortalInformation: () => ({ ...information.state, refetch: information.refetch }),
}));
vi.mock("../../components/ui/ConfirmDialog", () => ({
  useConfirm: () => svc.confirm,
  useConfirmWithReason: () => async () => "motivo",
}));

const bl = (over: Record<string, unknown> = {}) => ({
  bl_id: "BL-A", ce_mercante: "123", paid: true, can_submit: true, state: "no_request", request_id: null, reasons: [], ...over,
});
const doc = (over: Record<string, unknown>) => ({
  id: "d", version: 1, type: "termo", source: "request", status: "uploaded", file_name: "termo.pdf",
  valid_from: null, valid_until: null, reason: null, created_at: "2026-10-10T10:00:00Z", ...over,
});
const request = (over: Record<string, unknown> = {}) => ({
  id: "req-1", protocol: "CE-1", state: "draft", version: 3, source: "request", events: [],
  items: [{ bl_id: "BL-A", paid: true, termo: false, procuracao: false, reasons: [], source: "request" }],
  documents: [doc({ id: "t1" }), doc({ id: "p1", type: "procuracao", file_name: "proc.pdf" })],
  ...over,
});

beforeEach(() => {
  svc.listPortalCeUnlockBls.mockResolvedValue({ items: [bl()], total: 1 });
  // A tela lê a lista inteira; aqui, a primeira página simulada.
  svc.fetchAllPortalCeUnlockBls.mockImplementation(async (scope: PortalScope, filters: unknown) =>
    (await svc.listPortalCeUnlockBls(scope, filters, 1)).items);
  svc.listPortalCeUnlockRequests.mockResolvedValue({ items: [], total: 0 });
  svc.getPortalCeUnlockVip.mockResolvedValue({ enabled: false, termo: false, procuracao: false, documents: [] });
  svc.getPortalCeUnlockModel.mockResolvedValue(null);
  svc.getPortalCeUnlockRequest.mockResolvedValue(request());
  svc.downloadCeUnlockDocument.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  svc.confirm.mockImplementation(async () => true);
});

function mount(path = "/portal/desbloqueio-ce", scope?: PortalScope) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <PortalScopeProvider scope={scope}>
          <Routes>
            <Route path="/portal/desbloqueio-ce" element={<PortalDesbloqueioCe />} />
            <Route path="/clientes/portal/inspecao/:customerId/desbloqueio-ce" element={<PortalDesbloqueioCe />} />
          </Routes>
        </PortalScopeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const commandCalls = (action: string) => svc.portalCeUnlockCommand.mock.calls.filter((c) => c[1] === action);

it("com modelo disponível, o botão baixa o termo publicado pela agência", async () => {
  svc.getPortalCeUnlockModel.mockResolvedValue({ id: "model-1" });
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Baixar modelo do termo" }));
  expect(svc.downloadCeUnlockDocument).toHaveBeenCalledWith("model-1", expect.objectContaining({ mode: "client" }));
});

it("seleção e envio do rascunho funcionam só pelo teclado", async () => {
  svc.portalCeUnlockCommand.mockResolvedValue({ id: "req-1" });
  const user = userEvent.setup();
  mount();
  const box = await screen.findByLabelText("Selecionar B/L BL-A");
  for (let i = 0; i < 40 && document.activeElement !== box; i++) await user.tab();
  expect(document.activeElement).toBe(box);
  await user.keyboard(" ");
  expect((box as HTMLInputElement).checked).toBe(true);
  const next = screen.getByRole("button", { name: "Pedir desbloqueio de 1 B/L" });
  for (let i = 0; i < 40 && document.activeElement !== next; i++) await user.tab();
  expect(document.activeElement).toBe(next);
  await user.keyboard("{Enter}");
  await waitFor(() => expect(commandCalls("draft")).toHaveLength(1));
  expect(commandCalls("draft")[0][2]).toMatchObject({ bl_ids: ["BL-A"] });
});

it("pagamento perdido entre seleção e envio: mostra o erro e a lista atualizada com taxas pendentes", async () => {
  svc.portalCeUnlockCommand.mockRejectedValue(new Error("B/L BL-A perdeu elegibilidade"));
  mount();
  await userEvent.click(await screen.findByLabelText("Selecionar B/L BL-A"));
  svc.listPortalCeUnlockBls.mockResolvedValue({
    items: [bl({ paid: false, can_submit: false, reasons: ["Taxas locais sem liquidação integral confirmada"] })], total: 1,
  });
  await userEvent.click(screen.getByRole("button", { name: "Pedir desbloqueio de 1 B/L" }));
  expect(await screen.findByText("B/L BL-A perdeu elegibilidade")).toBeTruthy();
  expect(await screen.findByText("Em aberto")).toBeTruthy();
  // O motivo longo não se repete na linha: a coluna Taxas locais já diz.
  expect(screen.queryByText(/sem liquidação integral/)).toBeNull();
  expect(screen.getByRole("link", { name: /^Ver faturas do B\/L / }).getAttribute("href")).toBe("/portal/billing");
  // O BL inelegível continua marcado, mas pode ser retirado da seleção.
  const box = screen.getByLabelText("Selecionar B/L BL-A") as HTMLInputElement;
  expect(box.disabled).toBe(false);
  await userEvent.click(box);
  expect(box.checked).toBe(false);
  expect(screen.getByRole("button", { name: "Pedir desbloqueio de 0 B/Ls" }).hasAttribute("disabled")).toBe(true);
});

it("retry de rede do rascunho reaproveita a mesma chave idempotente", async () => {
  svc.portalCeUnlockCommand.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({ id: "req-1" });
  mount();
  await userEvent.click(await screen.findByLabelText("Selecionar B/L BL-A"));
  await userEvent.click(screen.getByRole("button", { name: "Pedir desbloqueio de 1 B/L" }));
  expect(await screen.findByText("Failed to fetch")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Pedir desbloqueio de 1 B/L" }));
  await waitFor(() => expect(commandCalls("draft")).toHaveLength(2));
  const [first, second] = commandCalls("draft").map((c) => c[2].request_key);
  expect(first).toBeTruthy();
  expect(second).toBe(first);
});

it("envio pede confirmação: recusar não envia; retry de rede após confirmar mantém a chave", async () => {
  mount("/portal/desbloqueio-ce?pedido=req-1");
  const send = await screen.findByRole("button", { name: "Solicitar desbloqueio" });
  svc.confirm.mockImplementationOnce(async () => false);
  await userEvent.click(send);
  expect(svc.confirm).toHaveBeenCalledTimes(1);
  expect(commandCalls("submit")).toHaveLength(0);

  svc.portalCeUnlockCommand.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({ id: "req-1" });
  await userEvent.click(send);
  expect(await screen.findByText("Failed to fetch")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Solicitar desbloqueio" }));
  await waitFor(() => expect(commandCalls("submit")).toHaveLength(2));
  const [a, b] = commandCalls("submit").map((c) => c[2]);
  expect(a).toMatchObject({ request_id: "req-1", expected_version: 3 });
  expect(b.request_key).toBe(a.request_key);
});

it("correção completa: com a nova versão do documento recusado, a solicitação pode ser reenviada", async () => {
  const refused = doc({ id: "t0", status: "changes_requested", reason: "Assinatura ilegível", created_at: "2026-10-09T10:00:00Z" });
  const proc = doc({ id: "p1", type: "procuracao", status: "approved", file_name: "proc.pdf" });
  svc.getPortalCeUnlockRequest.mockResolvedValue(request({ state: "changes_requested", documents: [proc, refused] }));
  const view = mount("/portal/desbloqueio-ce?pedido=req-1");
  const resend = await screen.findByRole("button", { name: "Reenviar solicitação" });
  expect(resend.hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("Envie o termo de devolução corrigido para reenviar.")).toBeTruthy();
  const refusedRow = screen.getByRole("button", { name: "termo.pdf" }).closest("tr") as HTMLElement;
  expect(within(refusedRow).getByText("Correção pedida")).toBeTruthy();
  expect(within(refusedRow).getByText("Assinatura ilegível")).toBeTruthy();
  expect(within(refusedRow).getByRole("button", { name: "Enviar nova versão: termo de devolução" })).toBeTruthy();
  // Só o documento recusado oferece nova versão.
  expect(screen.getAllByRole("button", { name: /Enviar nova versão/ })).toHaveLength(1);
  view.unmount();

  svc.getPortalCeUnlockRequest.mockResolvedValue(
    request({ state: "changes_requested", documents: [doc({ id: "t1", file_name: "termo-corrigido.pdf", created_at: "2026-10-11T10:00:00Z" }), proc, refused] }),
  );
  svc.portalCeUnlockCommand.mockResolvedValue({ id: "req-1" });
  mount("/portal/desbloqueio-ce?pedido=req-1");
  const ready = await screen.findByRole("button", { name: "Reenviar solicitação" });
  await waitFor(() => expect(ready.hasAttribute("disabled")).toBe(false));
  await userEvent.click(ready);
  await waitFor(() => expect(commandCalls("submit")).toHaveLength(1));
  expect(commandCalls("submit")[0][2]).toMatchObject({ request_id: "req-1", expected_version: 3 });
});

it("VIP com termo anual vencido: pede com os anexos comuns enquanto isso e mostra o vencido e a renovação em análise", async () => {
  svc.getPortalCeUnlockVip.mockResolvedValue({
    enabled: true, termo: false, procuracao: true,
    documents: [
      doc({ id: "renov", source: "vip_annual", status: "uploaded", file_name: "termo-2027.pdf", created_at: "2026-10-12T10:00:00Z" }),
      doc({ id: "old", source: "vip_annual", status: "approved", file_name: "termo-2025.pdf", valid_from: "2025-01-01", valid_until: "2025-12-31" }),
      doc({ id: "proc", type: "procuracao", source: "vip_annual", status: "approved", file_name: "proc.pdf", valid_from: "2026-01-01", valid_until: "2026-12-31" }),
    ],
  });
  mount();
  expect(await screen.findByText("O termo de devolução anual está em análise: os pedidos voltam a usar os documentos anuais quando a análise terminar. Até lá, as solicitações de B/Ls que os documentos anuais não cobrem seguem com termo de devolução e procuração anexados a elas.")).toBeTruthy();
  expect(screen.getByText("Falta o termo anual")).toBeTruthy();
  expect(screen.getByText("Até lá, assinado, em PDF, anexado à solicitação")).toBeTruthy();
  await userEvent.click(screen.getByLabelText("Selecionar B/L BL-A"));
  // Ponto 13 de 2026-10-23: o VIP sem anual vigente pede mesmo assim, como pedido comum.
  expect(screen.getByRole("button", { name: "Pedir desbloqueio de 1 B/L" }).hasAttribute("disabled")).toBe(false);
  expect(screen.getByText(/os documentos anuais não cobrem esta seleção: a solicitação seguirá com termo e procuração anexados/)).toBeTruthy();

  await userEvent.click(screen.getByRole("button", { name: "Abrir Documentos anuais" }));
  expect(await screen.findByText("Falta")).toBeTruthy();
  const rows = screen.getAllByRole("row").slice(1);
  // A renovação em análise vem antes; a versão vencida fica no fim, em cinza.
  expect(rows.map((r) => within(r).getAllByRole("button")[0].textContent)).toEqual(["termo-2027.pdf", "proc.pdf", "termo-2025.pdf"]);
  expect(within(rows[0]).getByText("Aguardando análise")).toBeTruthy();
  expect(rows[2].className).toContain("app-table__row--muted");
  expect(rows[2].textContent).toContain("Fora da vigência");
  expect(rows[1].textContent).toContain("01/01/2026 a 31/12/2026");
});

it("URL de inspeção carrega o Portal do Cliente em modo somente leitura", async () => {
  svc.listPortalCeUnlockBls.mockResolvedValue({ items: [bl({ paid: false, can_submit: false })], total: 1 });
  const scope: PortalScope = { mode: "inspect", customerId: 7, overview: null, basePath: "/clientes/portal/inspecao/7" };
  mount("/clientes/portal/inspecao/7/desbloqueio-ce", scope);
  const box = await screen.findByLabelText("Selecionar B/L BL-A");
  expect(box.hasAttribute("disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: /Pedir desbloqueio/ })).toBeNull();
  expect(screen.getByRole("link", { name: /^Ver faturas do B\/L / }).getAttribute("href")).toBe("/clientes/portal/inspecao/7/billing");
  expect(svc.listPortalCeUnlockBls).toHaveBeenCalledWith(expect.objectContaining({ mode: "inspect", customerId: 7 }), expect.anything(), 1);
});

it("pedido aberto em inspeção não oferece envio, cancelamento nem upload", async () => {
  const scope: PortalScope = { mode: "inspect", customerId: 7, overview: null, basePath: "/clientes/portal/inspecao/7" };
  mount("/clientes/portal/inspecao/7/desbloqueio-ce?pedido=req-1", scope);
  expect(await screen.findByText("termo.pdf")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Solicitar desbloqueio" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancelar solicitação" })).toBeNull();
  expect(screen.queryByLabelText(/Arquivo do termo/)).toBeNull();
  expect(screen.queryByRole("button", { name: /Anexar|Enviar nova versão|Trocar arquivo/ })).toBeNull();
});

it("anexar não envia: Solicitar desbloqueio sobe termo e procuração e envia com a versão relida", async () => {
  const pdf = (name: string) => new File(["%PDF-1.7"], name, { type: "application/pdf" });
  svc.getPortalCeUnlockRequest.mockResolvedValue(request({ documents: [] }));
  svc.uploadCeUnlockDocument.mockResolvedValue({});
  svc.portalCeUnlockCommand.mockResolvedValue({ id: "req-1" });
  mount("/portal/desbloqueio-ce?pedido=req-1");
  const send = await screen.findByRole("button", { name: "Solicitar desbloqueio" });
  expect(send.hasAttribute("disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: /Enviar termo|Enviar procuração/ })).toBeNull();

  expect(screen.getAllByText("Falta anexar")).toHaveLength(2);
  await userEvent.upload(screen.getByLabelText("Arquivo do termo de devolução (PDF)"), pdf("termo.pdf"));
  expect(screen.getByText("Anexe a procuração para solicitar.")).toBeTruthy();
  // O arquivo escolhido aparece na tabela e só sobe ao solicitar.
  expect(screen.getByText("termo.pdf").closest("tr")!.textContent).toContain("Sobe ao solicitar o desbloqueio");
  await userEvent.upload(screen.getByLabelText("Arquivo da procuração (PDF)"), pdf("proc.pdf"));
  expect(svc.uploadCeUnlockDocument).not.toHaveBeenCalled();

  // Depois dos anexos o pedido relido tem versão nova; o envio usa essa versão.
  svc.getPortalCeUnlockRequest.mockResolvedValue(request({ version: 5 }));
  await waitFor(() => expect(send.hasAttribute("disabled")).toBe(false));
  await userEvent.click(send);
  await waitFor(() => expect(commandCalls("submit")).toHaveLength(1));
  expect(svc.uploadCeUnlockDocument.mock.calls.map((c) => [c[0], c[1].name])).toEqual([
    [{ source: "request", request_id: "req-1", type: "termo" }, "termo.pdf"],
    [{ source: "request", request_id: "req-1", type: "procuracao" }, "proc.pdf"],
  ]);
  expect(commandCalls("submit")[0][2]).toMatchObject({ request_id: "req-1", expected_version: 5 });
});

it("anexo recusado no envio mostra o motivo e não envia a solicitação", async () => {
  const file = new File(["PK"], "termo.pdf", { type: "application/pdf" });
  svc.getPortalCeUnlockRequest.mockResolvedValue(request({ documents: [doc({ id: "p1", type: "procuracao", file_name: "proc.pdf" })] }));
  svc.uploadCeUnlockDocument.mockRejectedValue(new Error("O arquivo não é um PDF."));
  mount("/portal/desbloqueio-ce?pedido=req-1");
  await userEvent.upload(await screen.findByLabelText("Arquivo do termo de devolução (PDF)"), file);
  await userEvent.click(screen.getByRole("button", { name: "Solicitar desbloqueio" }));
  expect(await screen.findByText("O arquivo não é um PDF.")).toBeTruthy();
  expect(commandCalls("submit")).toHaveLength(0);
  // O anexo recusado precisa ser escolhido de novo.
  expect(screen.getByText("Anexe o termo de devolução para solicitar.")).toBeTruthy();
});

it("B/L isento aparece como Isentas, não como taxas pagas", async () => {
  svc.listPortalCeUnlockBls.mockResolvedValue({ items: [bl({ paid_exempt: true })], total: 1 });
  mount();
  expect(await screen.findByText("Isentas")).toBeTruthy();
  expect(screen.queryByText("Pagas")).toBeNull();
});

// Ponto 5 de 2026-10-23: o motivo da recusa que o operador do Vela escreveu
// aparece inteiro no Portal, com as quebras de linha, na solicitação e na
// lista de protocolos; antes o Portal cortava em 40 letras.
const LONG_REASON = [
  "A procuração não tem o reconhecimento de firma do representante legal; o cartório precisa reconhecer a assinatura por autenticidade.",
  "Envie também o contrato social atualizado, com a cláusula de administração que dá poderes ao signatário.",
].join("\n");

it("motivo da recusa inteiro, com as quebras de linha, no detalhe da solicitação", async () => {
  const refused = doc({ id: "p0", type: "procuracao", status: "changes_requested", reason: LONG_REASON, file_name: "proc.pdf" });
  svc.getPortalCeUnlockRequest.mockResolvedValue(request({ state: "changes_requested", documents: [doc({ id: "t1", status: "approved" }), refused] }));
  mount("/portal/desbloqueio-ce?pedido=req-1");
  const row = (await screen.findByRole("button", { name: "proc.pdf" })).closest("tr") as HTMLElement;
  const reason = within(row).getByText((_, node) => node?.textContent === LONG_REASON && node.tagName === "SPAN");
  expect(reason.className).toContain("whitespace-pre-line");
  expect(reason.closest("td")?.className).toContain("app-table__text--wrap");
  expect(row.textContent).not.toContain("…");
});

it("lista Minhas solicitações mostra o motivo inteiro de cada documento recusado", async () => {
  svc.listPortalCeUnlockRequests.mockResolvedValue({
    items: [{ id: "req-1", protocol: "CE-1", state: "changes_requested", version: 4, source: "request", created_at: "2026-10-10T10:00:00Z", bl_ids: ["BL-A"], sla_started_at: null }],
    total: 1,
  });
  svc.getPortalCeUnlockRequest.mockResolvedValue(request({
    state: "changes_requested",
    documents: [doc({ id: "t0", status: "changes_requested", reason: "Assinatura ilegível." }), doc({ id: "p0", type: "procuracao", status: "changes_requested", reason: LONG_REASON, file_name: "proc.pdf" })],
  }));
  mount("/portal/desbloqueio-ce?aba=solicitacoes");
  const table = await screen.findByRole("table", { name: "Minhas solicitações de desbloqueio" });
  await waitFor(() => expect(table.textContent).toContain("Motivo (termo de devolução): Assinatura ilegível."));
  const proc = within(table).getByText((_, node) => node?.tagName === "SPAN" && node.textContent === `Motivo (procuração): ${LONG_REASON}`);
  expect(proc.className).toContain("whitespace-pre-line");
});

// Ponto 6 de 2026-10-23: abaixo do B/L original, os endereços das agências que o recebem.
const contact = (key: string, address: string, extra: Record<string, unknown> = {}) => ({
  key, title: key, description: "", emails: [], phones: [], whatsapp: null, address, active: true, ...extra,
});

it("botão abaixo do B/L original abre os endereços de entrega de Vitória, Salvador e Suape", async () => {
  information.state = {
    isLoading: false,
    isError: false,
    data: { contacts: [
      contact("entrega_bl_vitoria", "Rua Desembargador Ferreira Coelho, 330\nSala 813", { phones: ["(27) 2124-1652"] }),
      contact("entrega_bl_salvador", "Endereço a definir"),
      // Suape ainda sem cadastro: o Portal não inventa endereço.
    ] },
  };
  mount();
  const requirements = await screen.findByRole("region", { name: "O que o desbloqueio pede" });
  const toggle = within(requirements).getByRole("button", { name: "Endereços de entrega do B/L" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(within(requirements).queryByText("Vitória")).toBeNull();

  await userEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "") as HTMLElement;
  expect(within(panel).getByText("Vitória")).toBeTruthy();
  expect(within(panel).getByText((_, node) => node?.textContent === "Rua Desembargador Ferreira Coelho, 330\nSala 813" && node.tagName === "SPAN")).toBeTruthy();
  expect(within(panel).getByText("(27) 2124-1652")).toBeTruthy();
  expect(within(panel).getAllByText("Endereço a definir")).toHaveLength(2);
  expect(within(panel).getByText("Suape")).toBeTruthy();

  await userEvent.click(within(requirements).getByRole("button", { name: "Ocultar endereços de entrega" }));
  expect(within(requirements).queryByText("Vitória")).toBeNull();
});

it("falha ao ler os endereços de entrega mostra o erro com Tentar novamente", async () => {
  information.state = { isLoading: false, isError: true, data: undefined };
  mount();
  const requirements = await screen.findByRole("region", { name: "O que o desbloqueio pede" });
  await userEvent.click(within(requirements).getByRole("button", { name: "Endereços de entrega do B/L" }));
  expect(within(requirements).getByRole("alert").textContent).toContain("Não foi possível carregar os endereços de entrega.");
  await userEvent.click(within(requirements).getByRole("button", { name: "Tentar novamente" }));
  expect(information.refetch).toHaveBeenCalled();
});

// Ponto 13 de 2026-10-23: VIP com a procuração anual vencida, recusada ou faltando
// abre a solicitação comum, que explica o motivo e aceita o termo e a procuração comuns.
it("VIP com procuração anual recusada: a solicitação explica o motivo e aceita os anexos comuns", async () => {
  svc.getPortalCeUnlockVip.mockResolvedValue({
    enabled: true, termo: true, procuracao: false,
    documents: [doc({ id: "proc-old", type: "procuracao", source: "vip_annual", status: "changes_requested", reason: "Assinatura ilegível", file_name: "proc-anual.pdf" })],
  });
  svc.getPortalCeUnlockModel.mockResolvedValue({ id: "model-1" });
  svc.portalCeUnlockCommand.mockResolvedValue({ id: "req-1" });
  svc.getPortalCeUnlockRequest.mockResolvedValue(request({ documents: [] }));
  mount();
  // O modelo do termo comum volta a aparecer para quem vai anexar.
  expect(await screen.findByRole("button", { name: "Baixar modelo do termo" })).toBeTruthy();
  await userEvent.click(screen.getByLabelText("Selecionar B/L BL-A"));
  await userEvent.click(screen.getByRole("button", { name: "Pedir desbloqueio de 1 B/L" }));
  await waitFor(() => expect(commandCalls("draft")).toHaveLength(1));
  const block = await screen.findByRole("region", { name: "Solicitação" });
  expect(block.textContent).toContain("Sua condição VIP não cobre esta solicitação: a procuração anual foi recusada");
  expect(block.textContent).toContain("com o termo de devolução e a procuração anexados a ela");
  expect(screen.getAllByRole("button", { name: /Anexar PDF/ }).length).toBeGreaterThanOrEqual(2);
});

// Migration 456 (decisão de 2026-10-25): em janeiro, sem o anual do ano novo, o B/L com o CE
// vinculado no ano que acabou continua coberto pelo anual dele; a faixa segue o banco, B/L a B/L.
it("VIP sem o anual do ano novo: B/L coberto pelo anual do ano anterior segue VIP na seleção", async () => {
  svc.getPortalCeUnlockVip.mockResolvedValue({ enabled: true, termo: false, procuracao: false, documents: [] });
  svc.listPortalCeUnlockBls.mockResolvedValue({ items: [bl({ vip_covered: true })], total: 1 });
  mount();
  await userEvent.click(await screen.findByLabelText("Selecionar B/L BL-A"));
  expect(screen.queryByText(/os documentos anuais não cobrem esta seleção/)).toBeNull();
  expect(screen.getByText("a seleção abre a solicitação com os documentos")).toBeTruthy();
});

// O envio confere a cobertura de cada B/L (migration 456), não o anual vigente hoje: o pedido VIP
// aberto com o anual do ano anterior segue em janeiro, sem esperar o anual novo.
it("VIP sem o anual do ano novo: o pedido VIP coberto pelo anual anterior pode ser enviado", async () => {
  svc.getPortalCeUnlockVip.mockResolvedValue({ enabled: true, termo: false, procuracao: false, documents: [] });
  svc.listPortalCeUnlockBls.mockResolvedValue({ items: [bl({ vip_covered: true, request_id: "req-1", state: "draft" })], total: 1 });
  svc.getPortalCeUnlockRequest.mockResolvedValue(request({
    source: "vip_annual", documents: [],
    items: [{ bl_id: "BL-A", paid: true, termo: false, procuracao: false, reasons: [], source: "vip_annual", vip_covered: true }],
  }));
  svc.portalCeUnlockCommand.mockResolvedValue({ id: "req-1" });
  mount("/portal/desbloqueio-ce?pedido=req-1");
  const send = await screen.findByRole("button", { name: "Solicitar desbloqueio" });
  expect(send.hasAttribute("disabled")).toBe(false);
  expect(screen.queryByText("Regularize os documentos anuais VIP para enviar.")).toBeNull();
  await userEvent.click(send);
  await waitFor(() => expect(commandCalls("submit")).toHaveLength(1));
});

it("pedido VIP com B/L que o anual deixou de cobrir diz como seguir", async () => {
  svc.getPortalCeUnlockVip.mockResolvedValue({ enabled: true, termo: true, procuracao: true, documents: [] });
  svc.getPortalCeUnlockRequest.mockResolvedValue(request({
    source: "vip_annual", documents: [],
    items: [{ bl_id: "BL-A", paid: true, termo: false, procuracao: false, reasons: [], source: "vip_annual", vip_covered: false }],
  }));
  mount("/portal/desbloqueio-ce?pedido=req-1");
  const send = await screen.findByRole("button", { name: "Solicitar desbloqueio" });
  expect(send.hasAttribute("disabled")).toBe(true);
  expect(screen.getByText(/não cobrem todos os B\/Ls desta solicitação: cancele e peça de novo/)).toBeTruthy();
});

it("VIP coberto com B/L de CE vinculado antes da vigência: a solicitação diz que a vigência não retroage", async () => {
  svc.getPortalCeUnlockVip.mockResolvedValue({ enabled: true, termo: true, procuracao: true, documents: [] });
  svc.listPortalCeUnlockBls.mockResolvedValue({ items: [bl({ vip_covered: false })], total: 1 });
  svc.getPortalCeUnlockRequest.mockResolvedValue(request({ items: [{ bl_id: "BL-A", paid: true, termo: false, procuracao: false, reasons: [], source: "request", vip_covered: false }] }));
  svc.getPortalCeUnlockModel.mockResolvedValue({ id: "model-1" });
  mount();
  // Esse B/L pede o termo comum: o modelo fica disponível para baixar.
  expect(await screen.findByRole("button", { name: "Baixar modelo do termo" })).toBeTruthy();
  await userEvent.click(await screen.findByLabelText("Selecionar B/L BL-A"));
  expect(screen.getByText(/os documentos anuais não cobrem esta seleção/)).toBeTruthy();
  cleanup();
  mount("/portal/desbloqueio-ce?pedido=req-1");
  const block = await screen.findByRole("region", { name: "Solicitação" });
  expect(block.textContent).toContain("há B/L com o CE Mercante vinculado antes da vigência dos documentos anuais, que não retroage");
});
