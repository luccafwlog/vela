// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { PortalDesbloqueioCe } from "../PortalDesbloqueioCe";
const fixtures = vi.hoisted(() => ({
  readonly: false,
  vip: false,
  vipProcuracao: true,
  canSubmit: true,
  draft: false,
  documentsReady: false,
  confirmedUnpaid: false,
  ready: false,
  listRequest: false,
  state: "draft",
  extraItems: [] as Record<string, unknown>[],
  requests: [] as Record<string, unknown>[],
  allRequests: [] as { id: string; bl_ids: string[] }[],
  mutate: vi.fn(async (): Promise<unknown> => ({})),
}));
vi.mock("../../hooks/usePortalCeUnlock", () => ({
  usePortalCeUnlock: () => ({
    scope: {
      mode: fixtures.readonly ? "inspect" : "client",
      basePath: "/portal",
    },
    list: {
      data: [
        {
          bl_id: "BL-A",
          ce_mercante: "123",
          paid: true,
          can_submit: fixtures.canSubmit,
          state: fixtures.listRequest ? "in_review" : "no_request",
          ...(fixtures.listRequest ? { request_id: "req-1", protocol: "CE-REQ1" } : {}),
          reasons: [],
        },
        ...fixtures.extraItems,
      ],
    },
    requests: { data: { items: fixtures.requests, total: fixtures.requests.length } },
    allRequests: { data: fixtures.allRequests },
    correctionDetails: new Map(),
    vip: { data: { enabled: fixtures.vip, termo: true, procuracao: fixtures.vipProcuracao, documents: [] } },
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
  fixtures.vipProcuracao = true;
  fixtures.canSubmit = true;
  fixtures.draft = false;
  fixtures.documentsReady = false;
  fixtures.confirmedUnpaid = false;
  fixtures.ready = false;
  fixtures.listRequest = false;
  fixtures.state = "draft";
  fixtures.extraItems = [];
  fixtures.requests = [];
  fixtures.allRequests = [];
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
it("mostra B/L pago e permite seleção para pedir o desbloqueio", async () => {
  mount();
  expect(screen.getByRole("button", { name: "Pedir desbloqueio de 0 B/Ls" }).hasAttribute("disabled")).toBe(true);
  await userEvent.click(screen.getByLabelText("Selecionar B/L BL-A"));
  expect(screen.getByRole("button", { name: "Pedir desbloqueio de 1 B/L" }).hasAttribute("disabled")).toBe(false);
});
it("VIP coberto: requisitos dizem a cobertura anual, com a marca VIP e a aba anual", () => {
  fixtures.vip = true;
  mount();
  const block = screen.getByRole("region", { name: "O que o desbloqueio pede" });
  expect(block.textContent).toContain("Coberto pelo termo anual");
  expect(block.textContent).toContain("Coberta pela procuração anual");
  expect(within(block).getByText("VIP")).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Documentos anuais" })).toBeTruthy();
});
// Decisão do dono de 2026-11-03 (migration 581, ADR 0119): o VIP coberto pelos anuais não pede.
it("VIP coberto: diz que não precisa pedir e mostra, por B/L, o que falta ou a documentação validada com o prazo", async () => {
  fixtures.vip = true;
  fixtures.extraItems = [
    { bl_id: "BL-VIP-FALTA", ce_mercante: "456", paid: false, delivered: false, can_submit: false, direct: true, vip_direct: true, vip_covered: true, state: "no_request", reasons: [] },
    { bl_id: "BL-VIP-OK", ce_mercante: "789", paid: true, delivered: true, can_submit: false, direct: true, vip_direct: true, vip_covered: true, state: "no_request", sla_started_at: "2026-11-03T10:00:00-03:00", reasons: [] },
  ];
  mount();
  const block = screen.getByRole("region", { name: "O que o desbloqueio pede" });
  expect(within(block).getByRole("note").textContent).toContain("Pela condição VIP, você não precisa pedir o desbloqueio.");
  expect(within(block).getByRole("note").textContent).toContain("avisamos aqui e por e-mail");
  expect(screen.getByRole("region", { name: "Prazo para desbloqueio" }).textContent).toContain("na condição VIP, sem solicitação, B/L a B/L");
  const row = (bl: string) => screen.getByLabelText(`Selecionar B/L ${bl}`).closest("tr")!;
  expect(row("BL-VIP-FALTA").textContent).toContain("Não precisa (VIP) · Falta pagar as taxas locais e entregar o B/L original");
  expect(row("BL-VIP-OK").textContent).toContain("Não precisa (VIP) · Documentação validada · prazo até 03/11");
  expect(screen.getByLabelText("Selecionar B/L BL-VIP-OK").hasAttribute("disabled")).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: /Não precisam de solicitação\s*2/ }));
  expect(screen.queryByLabelText("Selecionar B/L BL-A")).toBeNull();
});
it("Cliente sem VIP e sem B/L dispensado: sem o aviso VIP nem o cartão dos que não precisam de solicitação", () => {
  mount();
  expect(screen.queryByText(/Pela condição VIP/)).toBeNull();
  expect(screen.queryByRole("button", { name: /Não precisam de solicitação/ })).toBeNull();
});
// O pedido é inteiro VIP ou inteiro comum: com só o termo anual válido, a procuração
// falta e os dois vão anexados; nenhum dos dois pode aparecer como "coberto".
it("VIP só com o termo anual: requisitos dizem que os dois vão anexados", () => {
  fixtures.vip = true;
  fixtures.vipProcuracao = false;
  mount();
  const block = screen.getByRole("region", { name: "O que o desbloqueio pede" });
  expect(block.textContent).toContain("Falta a procuração anual");
  expect(block.textContent).toContain("Termo anual válido");
  expect(block.textContent).toContain("Enquanto falta a procuração anual, assinado, em PDF, anexado à solicitação");
  expect(block.textContent).not.toContain("Coberto pelo termo anual");
});
// Reunião de testes de 2026-10-26: o prazo combinado com o mercado fica logo abaixo das quatro exigências;
// desde 2026-11-02, num bloco próprio, para o bloco dos requisitos não ter texto demais.
it("o bloco Prazo para desbloqueio diz as janelas de 12h e 17h, fora do bloco dos requisitos", () => {
  mount();
  expect(screen.getByRole("region", { name: "O que o desbloqueio pede" }).textContent).not.toContain("Cumpridos antes das 12h");
  const block = screen.getByRole("region", { name: "Prazo para desbloqueio" });
  // 12:00 em ponto já é a janela da tarde (`l::time >= 12:00` na 466): "antes" e "a partir", não "até".
  expect(block.textContent).toContain("Cumpridos antes das 12h, o desbloqueio é feito até as 17h do mesmo dia útil");
  expect(block.textContent).toContain("a partir das 12h, até as 12h do próximo dia útil");
  expect(block.textContent).not.toContain("Cumpridos até as 12h");
  expect(block.textContent).toContain("Cumpridos no sábado ou no domingo, até as 12h de segunda-feira");
});
it("Cliente sem VIP: nenhuma menção a documento anual", () => {
  const { container } = mount();
  const block = screen.getByRole("region", { name: "O que o desbloqueio pede" });
  expect(block.textContent).toContain("Assinado, em PDF, anexado à solicitação");
  expect(block.textContent).toContain("Em PDF, anexada à solicitação");
  expect(container.textContent).not.toMatch(/anua|VIP/i);
  expect(screen.queryByRole("tab", { name: /Documentos anuais/ })).toBeNull();
});
it("cartões contam e filtram; taxa aguardando fatura não conta como em aberto nem tem Ver faturas", async () => {
  fixtures.extraItems = [
    { bl_id: "BL-OPEN", paid: false, can_submit: false, state: "no_request", reasons: [] },
    { bl_id: "BL-WAIT", paid: false, local_charges_awaiting_invoice: true, can_submit: false, state: "no_request", reasons: [] },
  ];
  mount();
  const cards = screen.getByRole("group", { name: "Situação dos B/Ls" });
  const card = (name: RegExp) => within(cards).getByRole("button", { name });
  expect(card(/Com taxas locais em aberto/).textContent).toContain("1");
  expect(screen.getByText("Aguardando fatura")).toBeTruthy();
  const openLinks = screen.getAllByRole("link", { name: /^Em aberto: ver faturas em aberto do B\/L / });
  expect(openLinks).toHaveLength(1);
  // Desde 2026-11-02 o próprio "Em aberto" é o link: texto âmbar, sem borda de botão nem ícone.
  expect(openLinks[0].textContent).toBe("Em aberto");
  expect(openLinks[0].querySelector("svg")).toBeNull();
  expect(openLinks[0].className).toContain("app-status-text--warning");
  expect(openLinks[0].className).not.toContain("app-btn");
  expect(screen.queryByText(/Taxas locais sem liquidação/)).toBeNull();
  await userEvent.click(card(/Com taxas locais em aberto/));
  expect(screen.getByLabelText("Selecionar B/L BL-OPEN")).toBeTruthy();
  expect(screen.queryByLabelText("Selecionar B/L BL-A")).toBeNull();
  await userEvent.click(card(/Com taxas locais em aberto/));
  expect(screen.getByLabelText("Selecionar B/L BL-A")).toBeTruthy();
});
// Pedido do dono de 2026-11-02: filtros de Navio e Viagem, recolhidos como no resto do Portal.
it("filtra por Navio e Viagem, com a barra recolhida e os cartões contando o recorte", async () => {
  fixtures.extraItems = [
    { bl_id: "BL-GG", vessel_name: "GREEN GUANGZHOU", voyage_number: "6", paid: true, can_submit: true, state: "no_request", reasons: [] },
    { bl_id: "BL-GG2", vessel_name: "GREEN GUANGZHOU", voyage_number: "7", paid: true, can_submit: true, state: "no_request", reasons: [] },
  ];
  mount();
  const toggle = screen.getByRole("button", { name: /^Filtros/ });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await userEvent.click(toggle);
  await userEvent.type(screen.getByLabelText("Navio"), "guangzhou");
  expect(screen.queryByLabelText("Selecionar B/L BL-A")).toBeNull();
  expect(screen.getByLabelText("Selecionar B/L BL-GG")).toBeTruthy();
  expect(screen.getByLabelText("Selecionar B/L BL-GG2")).toBeTruthy();
  await userEvent.type(screen.getByLabelText("Viagem"), "6");
  expect(screen.queryByLabelText("Selecionar B/L BL-GG2")).toBeNull();
  const cards = screen.getByRole("group", { name: "Situação dos B/Ls" });
  expect(within(cards).getByRole("button", { name: /Podem ser pedidos/ }).textContent).toContain("1");
  await userEvent.click(screen.getByRole("button", { name: "Limpar" }));
  expect(screen.getByLabelText("Selecionar B/L BL-A")).toBeTruthy();
  expect(screen.getByLabelText("Selecionar B/L BL-GG2")).toBeTruthy();
});
it("B/L de solicitação ainda não validada: confirma de qual protocolo sai e o que acontece com a antiga", async () => {
  fixtures.listRequest = true;
  fixtures.extraItems = [
    { bl_id: "BL-B", paid: true, can_submit: true, state: "changes_requested", request_id: "req-2", protocol: "CE-REQ2", reasons: [] },
    { bl_id: "BL-C", paid: true, can_submit: true, state: "changes_requested", request_id: "req-2", protocol: "CE-REQ2", reasons: [] },
  ];
  fixtures.mutate.mockResolvedValueOnce({ id: "novo" });
  mount();
  await userEvent.click(screen.getByLabelText("Selecionar B/L BL-A"));
  await userEvent.click(screen.getByLabelText("Selecionar B/L BL-B"));
  await userEvent.click(screen.getByRole("button", { name: "Pedir desbloqueio de 2 B/Ls" }));
  expect(fixtures.mutate).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog", { name: "Pedir desbloqueio de 2 B/Ls" });
  const rows = within(dialog).getAllByRole("row").slice(1).map((r) => r.textContent);
  expect(rows).toEqual([
    "BL-ACE-REQ1 · Em análiseFica sem B/L e é cancelada",
    "BL-BCE-REQ2 · Correção pedidaContinua aberta com os outros B/Ls",
  ]);
  expect(dialog.textContent).toContain("termo e procuração são enviados de novo nesta");
  expect(dialog.textContent).toContain("Não dá para desfazer");
  await userEvent.click(within(dialog).getByRole("button", { name: "Mudar 2 B/Ls e continuar" }));
  expect(fixtures.mutate).toHaveBeenCalledWith({ action: "draft", payload: expect.objectContaining({ bl_ids: ["BL-A", "BL-B"] }) });
});
it("prévia conta B/L ativo que o Portal não lista: a antiga continua aberta", async () => {
  fixtures.listRequest = true;
  fixtures.allRequests = [{ id: "req-1", bl_ids: ["BL-A", "BL-SEM-CE"] }];
  mount();
  await userEvent.click(screen.getByLabelText("Selecionar B/L BL-A"));
  await userEvent.click(screen.getByRole("button", { name: "Pedir desbloqueio de 1 B/L" }));
  const dialog = screen.getByRole("dialog", { name: "Pedir desbloqueio de 1 B/L" });
  expect(dialog.textContent).toContain("Continua aberta com os outros B/Ls");
});
it("Cliente VIP: a confirmação de mudança não fala de termo e procuração", async () => {
  fixtures.vip = true;
  fixtures.listRequest = true;
  mount();
  await userEvent.click(screen.getByLabelText("Selecionar B/L BL-A"));
  await userEvent.click(screen.getByRole("button", { name: "Pedir desbloqueio de 1 B/L" }));
  const dialog = screen.getByRole("dialog", { name: "Pedir desbloqueio de 1 B/L" });
  expect(dialog.textContent).toContain("Um B/L está em outra solicitação");
  expect(dialog.textContent).not.toMatch(/termo|procuração/);
  expect(within(dialog).getByRole("button", { name: "Mudar 1 B/L e continuar" })).toBeTruthy();
});
it("Minhas solicitações: protocolo abre, B/Ls com +N, prazo para desbloqueio e situação em texto", () => {
  fixtures.requests = [
    { id: "r1", protocol: "CE-R1", state: "draft", source: "request", version: 0, created_at: "2026-10-16T14:00:00Z", bl_ids: ["BL-1", "BL-2", "BL-3"], sla_started_at: null },
    { id: "r2", protocol: "CE-R2", state: "in_review", source: "request", version: 2, created_at: "2026-10-11T14:00:00Z", bl_ids: ["BL-4"], sla_started_at: "2026-10-17T14:13:00Z" },
    { id: "r3", protocol: "CE-R3", state: "cancelled", source: "request", version: 1, created_at: "2026-09-27T14:00:00Z", bl_ids: ["BL-5"], sla_started_at: null },
  ];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/portal/desbloqueio-ce?aba=solicitacoes"]}>
        <PortalDesbloqueioCe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const rows = screen.getAllByRole("row").slice(1);
  expect(rows[0].textContent).toMatch(/^CE-R116\/10\/2026BL-1 \+2.*Rascunho · falta enviar$/);
  expect(rows[1].textContent).toBe("CE-R211/10/2026BL-4Da solicitação19/10, 12:00Em análise");
  expect(rows[2].className).toContain("app-table__row--muted");
  expect(rows[2].textContent).toContain("Cancelada");
  expect(screen.queryByRole("button", { name: /^Abrir/ })).toBeNull();
  expect(screen.getByRole("button", { name: "CE-R2" })).toBeTruthy();
});
it("inspeção não permite selecionar nem preparar pedido", () => {
  fixtures.readonly = true;
  mount();
  expect(screen.getByLabelText("Selecionar B/L BL-A").hasAttribute("disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: /Pedir desbloqueio/ })).toBeNull();
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
 await userEvent.click(screen.getByLabelText("Selecionar B/L BL-A"));
 fixtures.canSubmit = false;
 view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PortalDesbloqueioCe /></MemoryRouter></QueryClientProvider>);
 expect(screen.getByLabelText("Selecionar B/L BL-A").hasAttribute("disabled")).toBe(false);
 await userEvent.click(screen.getByLabelText("Selecionar B/L BL-A"));
 expect((screen.getByLabelText("Selecionar B/L BL-A") as HTMLInputElement).checked).toBe(false);
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
  const block = screen.getByRole("region", { name: "Solicitação" });
  expect(block.textContent).toContain("Documentação validada");
  expect(block.textContent).toContain("consulte o SISCARGA para verificar o desbloqueio");
  expect(block.textContent).toContain("Prazo para desbloqueio07/10, 17:00");
  expect(container.textContent).not.toMatch(/ZPT/i);
  expect(container.textContent).not.toMatch(/Desbloqueio confirmado/i);
  // Prazo já passou (07/10 17:00): o cliente vê só a data, nunca se a agência atrasou.
  expect(container.textContent).not.toMatch(/Vencido|Vence hoje|No prazo/);
});

it("sem todos os requisitos não diz documentação validada", () => {
  fixtures.draft = true;
  fixtures.state = "in_review";
  mount();
  const block = screen.getByRole("region", { name: "Solicitação" });
  expect(block.textContent).toContain("Em análise");
  expect(block.textContent).not.toContain("Documentação validada");
  // Ponto 10 de 2026-10-23: sem os quatro requisitos não há prazo, e a tela diz quando ele começa.
  expect(block.textContent).toContain("Prazo para desbloqueio—Sem prazo");
  expect(block.textContent).toContain("O prazo para desbloqueio começa a contar quando os quatro requisitos estiverem cumpridos");
  expect(block.textContent).not.toContain("recomeça");
});

it("BL com solicitação em andamento não fala em desbloqueio confirmado", () => {
  fixtures.canSubmit = false;
  fixtures.listRequest = true;
  const { container } = mount();
  expect(screen.getByLabelText("Selecionar B/L BL-A").closest("tr")!.textContent).toContain("CE-REQ1 · Em análise");
  expect(screen.getByRole("button", { name: "Abrir solicitação CE-REQ1" }).textContent).toBe("CE-REQ1");
  expect(container.textContent).not.toMatch(/desbloqueio confirmado/i);
});

it("rascunho sem anexos diz quais documentos faltam para enviar", () => {
  fixtures.draft = true;
  mount();
  expect(screen.getByText("Anexe o termo de devolução e a procuração para solicitar.")).toBeTruthy();
});
it("oferece o memorando de retirada a clientes comuns e VIP, apontando para um arquivo publicado", async () => {
  const { existsSync } = await import("node:fs");
  for (const vip of [false, true]) {
    fixtures.vip = vip;
    mount();
    const link = screen.getByRole("link", { name: "Baixar memorando de liberação" });
    const href = link.getAttribute("href")!;
    expect(existsSync(`public${href}`)).toBe(true);
    cleanup();
  }
});

// Revisão de 2026-10-22 (G1): o cabeçalho marca os disponíveis do filtro
// inteiro, não só os 25 da página.
it("o cabeçalho seleciona os B/Ls disponíveis de todas as páginas do filtro", async () => {
  fixtures.extraItems = [
    ...Array.from({ length: 29 }, (_, index) => ({ bl_id: `BL-${index + 1}`, ce_mercante: `9${index}`, paid: true, can_submit: true, state: "no_request", reasons: [] })),
    { bl_id: "BL-PENDENTE", ce_mercante: "999", paid: false, can_submit: false, state: "no_request", reasons: ["Taxas locais em aberto"] },
  ];
  mount();
  await userEvent.click(screen.getByLabelText("Selecionar todos os B/Ls disponíveis do filtro (30)"));
  expect(screen.getByRole("button", { name: "Pedir desbloqueio de 30 B/Ls" }).hasAttribute("disabled")).toBe(false);
  await userEvent.click(screen.getByLabelText("Desmarcar todos os B/Ls disponíveis do filtro (30)"));
  expect(screen.getByRole("button", { name: "Pedir desbloqueio de 0 B/Ls" })).toBeTruthy();
});

it("acima do teto, o cabeçalho não seleciona e pede para refinar a busca", async () => {
  fixtures.extraItems = Array.from({ length: 10_000 }, (_, index) => ({ bl_id: `BL-T${index}`, ce_mercante: `8${index}`, paid: true, can_submit: true, state: "no_request", reasons: [] }));
  mount();
  await userEvent.click(screen.getByLabelText("Selecionar todos os B/Ls disponíveis do filtro (10.001)"));
  expect(screen.getByText(/Refine o filtro/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Pedir desbloqueio de 0 B/Ls" })).toBeTruthy();
});
