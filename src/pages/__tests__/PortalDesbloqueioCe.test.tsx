// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { PortalDesbloqueioCe } from "../PortalDesbloqueioCe";
const fixtures = vi.hoisted(() => ({
  readonly: false,
  vip: false,
  canSubmit: true,
  draft: false,
  documentsReady: false,
  confirmedUnpaid: false,
  ready: false,
  listRequest: false,
  state: "draft",
  mutate: vi.fn(async () => ({})),
}));
vi.mock("../../hooks/usePortalCeUnlock", () => ({
  usePortalCeUnlock: () => ({
    scope: {
      mode: fixtures.readonly ? "inspect" : "client",
      basePath: "/portal",
    },
    list: {
      data: {
        items: [
          {
            bl_id: "BL-A",
            ce_mercante: "123",
            paid: true,
            can_submit: fixtures.canSubmit,
            state: fixtures.listRequest ? "in_review" : "no_request",
            ...(fixtures.listRequest ? { request_id: "req-1" } : {}),
            reasons: [],
          },
        ],
        total: 1,
      },
    },
    requests: { data: { items: [], total: 0 } },
    vip: { data: { enabled: fixtures.vip, termo: true, procuracao: true } },
    model: { data: null },
    detail: { data: fixtures.draft ? { id: "draft-id", protocol: "CE-DRAFT", state: fixtures.state, source: "request", version: 0, items: [{ bl_id: "BL-A", paid: true, reasons: [], source: "request", ...(fixtures.ready ? { can_export: true, sla_started_at: "2026-10-07T10:00:00-03:00" } : {}) }, ...(fixtures.confirmedUnpaid ? [{ bl_id: "BL-DONE", paid: false, confirmed: true, reasons: [], source: "request" }] : [])], documents: fixtures.documentsReady ? [{ id: "term", type: "termo", source: "request", status: "uploaded", file_name: "termo.pdf" }, { id: "proc", type: "procuracao", source: "request", status: "uploaded", file_name: "procuracao.pdf" }] : [], events: [] } : null },
    command: { isPending: false, mutateAsync: fixtures.mutate },
    refresh: async () => {},
  }),
}));
vi.mock("../../components/ui/ConfirmDialog", () => ({
  useConfirm: () => async () => true,
}));
afterEach(() => {
  cleanup();
  fixtures.readonly = false;
  fixtures.vip = false;
  fixtures.canSubmit = true;
  fixtures.draft = false;
  fixtures.documentsReady = false;
  fixtures.confirmedUnpaid = false;
  fixtures.ready = false;
  fixtures.listRequest = false;
  fixtures.state = "draft";
  fixtures.mutate.mockClear();
});
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[fixtures.draft ? "/portal/desbloqueio-ce?pedido=draft-id" : "/portal/desbloqueio-ce"]}>
        <PortalDesbloqueioCe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it("mostra BL pago e permite seleção para continuar", async () => {
  mount();
  await userEvent.click(screen.getByLabelText("Selecionar BL BL-A"));
  expect(
    screen
      .getByRole("button", { name: "Continuar com 1 BL(s)" })
      .hasAttribute("disabled"),
  ).toBe(false);
});
it("VIP mostra cobertura vigente e aba anual sem exigir anexos na seleção", () => {
  fixtures.vip = true;
  mount();
  expect(screen.getByText(/Cobertura VIP vigente/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Documentos anuais" }),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Termo assinado (PDF)")).toBeNull();
});
it("inspeção não permite selecionar nem preparar pedido", () => {
  fixtures.readonly = true;
  mount();
  expect(
    screen.getByLabelText("Selecionar BL BL-A").hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.queryByRole("button", { name: /Continuar com/ })).toBeNull();
});

it("rascunho comum impede envio enquanto os dois PDFs não foram apresentados", () => {
 fixtures.draft = true;
 mount();
 const buttons = screen.getAllByRole("button", { name: "Solicitar desbloqueio" });
 expect(buttons.at(-1)!.hasAttribute("disabled")).toBe(true);
});

it("documentos completos permitem envio dos pendentes sem bloquear BL já confirmado", () => {
 fixtures.draft = true; fixtures.documentsReady = true; fixtures.confirmedUnpaid = true;
 mount();
 expect(screen.getAllByRole("button", { name: "Solicitar desbloqueio" }).at(-1)!.hasAttribute("disabled")).toBe(false);
});

it("permite remover da seleção BL que perde elegibilidade após atualização", async () => {
 const view = mount();
 await userEvent.click(screen.getByLabelText("Selecionar BL BL-A"));
 fixtures.canSubmit = false;
 view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PortalDesbloqueioCe /></MemoryRouter></QueryClientProvider>);
 expect(screen.getByLabelText("Selecionar BL BL-A").hasAttribute("disabled")).toBe(false);
 await userEvent.click(screen.getByLabelText("Selecionar BL BL-A"));
 expect((screen.getByLabelText("Selecionar BL BL-A") as HTMLInputElement).checked).toBe(false);
});

it("cliente cancela rascunho: pede confirmação e envia a ação cancel com a versão atual", async () => {
  fixtures.draft = true;
  mount();
  await userEvent.click(screen.getByRole("button", { name: "Cancelar solicitação" }));
  expect(fixtures.mutate).toHaveBeenCalledWith({
    action: "cancel",
    payload: expect.objectContaining({ request_id: "draft-id", expected_version: 0 }),
  });
});

it("cancelar também é oferecido com correção solicitada, mas não em Modo Inspeção nem após o envio", () => {
  fixtures.draft = true;
  fixtures.state = "changes_requested";
  mount();
  expect(screen.getByRole("button", { name: "Cancelar solicitação" })).toBeTruthy();
  cleanup();
  fixtures.state = "submitted";
  mount();
  expect(screen.queryByRole("button", { name: "Cancelar solicitação" })).toBeNull();
  cleanup();
  fixtures.state = "draft";
  fixtures.readonly = true;
  mount();
  expect(screen.queryByRole("button", { name: "Cancelar solicitação" })).toBeNull();
});

it("com os requisitos atendidos mostra prazo e orienta consultar o Mercante, sem citar ZPT", () => {
  fixtures.draft = true;
  fixtures.state = "in_review";
  fixtures.ready = true;
  const { container } = mount();
  const banner = screen.getByRole("status");
  expect(banner.textContent).toContain("Documentação validada. Prazo para o desbloqueio: até 07/10, 17:00");
  expect(banner.textContent).toContain("Consulte o Mercante");
  expect(container.textContent).not.toMatch(/ZPT/i);
  expect(container.textContent).not.toMatch(/Desbloqueio confirmado/i);
  // Prazo já passou (07/10 17:00): o cliente vê só a data, nunca se a agência atrasou.
  expect(container.textContent).not.toMatch(/Vencido|Vence hoje|No prazo/);
});

it("sem todos os requisitos não mostra o aviso de documentação validada", () => {
  fixtures.draft = true;
  fixtures.state = "in_review";
  mount();
  expect(screen.queryByRole("status")).toBeNull();
});

it("BL com solicitação em andamento não fala em desbloqueio confirmado", () => {
  fixtures.canSubmit = false;
  fixtures.listRequest = true;
  const { container } = mount();
  expect(container.textContent).toContain("Já existe uma solicitação para este BL");
  expect(container.textContent).not.toMatch(/desbloqueio confirmado/i);
});
