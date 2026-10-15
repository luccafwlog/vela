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
  listPortalCeUnlockRequests: vi.fn(),
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
  await userEvent.click(await screen.findByRole("button", { name: "Baixar modelo do termo de devolução" }));
  expect(svc.downloadCeUnlockDocument).toHaveBeenCalledWith("model-1", expect.objectContaining({ mode: "client" }));
});

it("seleção e envio do rascunho funcionam só pelo teclado", async () => {
  svc.portalCeUnlockCommand.mockResolvedValue({ id: "req-1" });
  const user = userEvent.setup();
  mount();
  const box = await screen.findByLabelText("Selecionar BL BL-A");
  for (let i = 0; i < 40 && document.activeElement !== box; i++) await user.tab();
  expect(document.activeElement).toBe(box);
  await user.keyboard(" ");
  expect((box as HTMLInputElement).checked).toBe(true);
  const next = screen.getByRole("button", { name: "Continuar com 1 BL(s)" });
  for (let i = 0; i < 40 && document.activeElement !== next; i++) await user.tab({ shift: true });
  expect(document.activeElement).toBe(next);
  await user.keyboard("{Enter}");
  await waitFor(() => expect(commandCalls("draft")).toHaveLength(1));
  expect(commandCalls("draft")[0][2]).toMatchObject({ bl_ids: ["BL-A"] });
});

it("pagamento perdido entre seleção e envio: mostra o erro e a lista atualizada com taxas pendentes", async () => {
  svc.portalCeUnlockCommand.mockRejectedValue(new Error("B/L BL-A perdeu elegibilidade"));
  mount();
  await userEvent.click(await screen.findByLabelText("Selecionar BL BL-A"));
  svc.listPortalCeUnlockBls.mockResolvedValue({
    items: [bl({ paid: false, can_submit: false, reasons: ["Taxas locais pendentes"] })], total: 1,
  });
  await userEvent.click(screen.getByRole("button", { name: "Continuar com 1 BL(s)" }));
  expect(await screen.findByText("B/L BL-A perdeu elegibilidade")).toBeTruthy();
  expect(await screen.findByText("Pendentes")).toBeTruthy();
  expect(screen.getByText("Taxas locais pendentes")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Ver faturas" }).getAttribute("href")).toBe("/portal/billing");
  // O BL inelegível continua marcado, mas pode ser retirado da seleção.
  const box = screen.getByLabelText("Selecionar BL BL-A") as HTMLInputElement;
  expect(box.disabled).toBe(false);
  await userEvent.click(box);
  expect(box.checked).toBe(false);
  expect(screen.getByRole("button", { name: "Continuar com 0 BL(s)" }).hasAttribute("disabled")).toBe(true);
});

it("retry de rede do rascunho reaproveita a mesma chave idempotente", async () => {
  svc.portalCeUnlockCommand.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({ id: "req-1" });
  mount();
  await userEvent.click(await screen.findByLabelText("Selecionar BL BL-A"));
  await userEvent.click(screen.getByRole("button", { name: "Continuar com 1 BL(s)" }));
  expect(await screen.findByText("Failed to fetch")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Continuar com 1 BL(s)" }));
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
  expect(screen.getByText("Envie termo de devolução para continuar.")).toBeTruthy();
  expect(screen.getByText("Motivo: Assinatura ilegível")).toBeTruthy();
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

it("VIP com termo anual vencido fica pendente: bloqueia nova solicitação e mostra o vencido e a renovação em análise", async () => {
  svc.getPortalCeUnlockVip.mockResolvedValue({
    enabled: true, termo: false, procuracao: true,
    documents: [
      doc({ id: "renov", source: "vip_annual", status: "uploaded", file_name: "termo-2027.pdf", created_at: "2026-10-12T10:00:00Z" }),
      doc({ id: "old", source: "vip_annual", status: "approved", file_name: "termo-2025.pdf", valid_from: "2025-01-01", valid_until: "2025-12-31" }),
      doc({ id: "proc", type: "procuracao", source: "vip_annual", status: "approved", file_name: "proc.pdf", valid_from: "2026-01-01", valid_until: "2026-12-31" }),
    ],
  });
  mount();
  expect(await screen.findByText(/Documentos anuais VIP precisam de regularização/)).toBeTruthy();
  await userEvent.click(screen.getByLabelText("Selecionar BL BL-A"));
  expect(screen.getByRole("button", { name: "Continuar com 1 BL(s)" }).hasAttribute("disabled")).toBe(true);

  await userEvent.click(screen.getByRole("button", { name: "Abrir Documentos anuais" }));
  expect(await screen.findByText("Falta")).toBeTruthy();
  const expired = screen.getAllByText(/termo-2025\.pdf/)[0].closest("div.rounded-lg") as HTMLElement;
  expect(within(expired).getByText("Fora da vigência")).toBeTruthy();
  const renewal = screen.getAllByText("termo-2027.pdf")[0].closest("div.rounded-lg") as HTMLElement;
  expect(within(renewal).getByText("Aguardando análise")).toBeTruthy();
});

it("URL de inspeção carrega o Portal do Cliente em modo somente leitura", async () => {
  const scope: PortalScope = { mode: "inspect", customerId: 7, overview: null, basePath: "/clientes/portal/inspecao/7" };
  mount("/clientes/portal/inspecao/7/desbloqueio-ce", scope);
  const box = await screen.findByLabelText("Selecionar BL BL-A");
  expect(box.hasAttribute("disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: /Continuar com/ })).toBeNull();
  expect(screen.getByRole("link", { name: "Faturas" }).getAttribute("href")).toBe("/clientes/portal/inspecao/7/billing");
  expect(svc.listPortalCeUnlockBls).toHaveBeenCalledWith(expect.objectContaining({ mode: "inspect", customerId: 7 }), expect.anything(), 1);
});

it("pedido aberto em inspeção não oferece envio, cancelamento nem upload", async () => {
  const scope: PortalScope = { mode: "inspect", customerId: 7, overview: null, basePath: "/clientes/portal/inspecao/7" };
  mount("/clientes/portal/inspecao/7/desbloqueio-ce?pedido=req-1", scope);
  expect(await screen.findByText("termo.pdf")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Solicitar desbloqueio" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancelar solicitação" })).toBeNull();
  expect(screen.queryByLabelText(/Termo de devolução assinado/)).toBeNull();
});
