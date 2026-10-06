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
            state: "no_request",
            reasons: [],
          },
        ],
        total: 1,
      },
    },
    requests: { data: { items: [], total: 0 } },
    vip: { data: { enabled: fixtures.vip, termo: true, procuracao: true } },
    model: { data: null },
    detail: { data: fixtures.draft ? { id: "draft-id", protocol: "CE-DRAFT", state: "draft", source: "request", version: 0, items: [{ bl_id: "BL-A", paid: true, reasons: [], source: "request" }, ...(fixtures.confirmedUnpaid ? [{ bl_id: "BL-DONE", paid: false, confirmed: true, reasons: [], source: "request" }] : [])], documents: fixtures.documentsReady ? [{ id: "term", type: "termo", source: "request", status: "uploaded", file_name: "termo.pdf" }, { id: "proc", type: "procuracao", source: "request", status: "uploaded", file_name: "procuracao.pdf" }] : [], events: [] } : null },
    command: { isPending: false },
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
