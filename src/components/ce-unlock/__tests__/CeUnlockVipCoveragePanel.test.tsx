// @vitest-environment jsdom
// Documentos anuais VIP, a peça comum: na ficha do Cliente (o Vela analisa) e no Portal (o Cliente envia).
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { CeUnlockVipCoveragePanel } from "../CeUnlockVipCoveragePanel";
import type { CeUnlockDocument } from "../../../types/ceUnlock";

const svc = vi.hoisted(() => ({
  getCeUnlockVip: vi.fn(),
  getPortalCeUnlockVip: vi.fn(),
  ceUnlockCommand: vi.fn(async () => ({})),
  uploadCeUnlockDocument: vi.fn(async () => ({})),
  downloadCeUnlockDocument: vi.fn(async () => {}),
}));
vi.mock("../../../services/ceUnlockService", () => svc);
vi.mock("../../ui/ConfirmDialog", () => ({
  useConfirm: () => async () => true,
  useConfirmWithReason: () => async () => "Documento vencido",
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const year = Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 4));
const doc = (over: Partial<CeUnlockDocument>): CeUnlockDocument => ({
  id: "d", version: 1, customer_id: 101, request_id: null, type: "procuracao", source: "vip_annual", status: "uploaded",
  file_name: "doc.pdf", size_bytes: 10, valid_from: null, valid_until: null, coverage_year: null, reason: null,
  created_at: "2026-10-16T13:00:00Z", ...over,
});
const coverage = (documents: CeUnlockDocument[], enabled = true) => ({
  customer_id: 101, enabled, version: 1, documents, termo: true, procuracao: false,
});
const docs = [
  doc({ id: "proc-v2", file_name: "Procuracao v2.pdf" }),
  doc({ id: "termo", type: "termo", status: "approved", file_name: "Termo anual.pdf", valid_from: `${year}-01-01`, valid_until: `${year}-12-31`, coverage_year: year, created_at: "2026-10-01T13:00:00Z" }),
  doc({ id: "proc-v1", status: "changes_requested", reason: "A procuração anual venceu em 30/09/2026; envie a renovada.", file_name: "Procuracao v1.pdf", created_at: "2026-10-02T13:00:00Z" }),
];
const mount = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

it("ficha do Cliente sem VIP mostra só o bloco Condição VIP", async () => {
  svc.getCeUnlockVip.mockResolvedValue(coverage([], false));
  mount(<CeUnlockVipCoveragePanel customerId={101} manage />);
  expect(await screen.findByText("Sem condição VIP")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Documentos anuais" })).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
});

it("Vela: uma tabela; Analisar só onde há decisão; versão anterior recusada em cinza; revogar no ⋮", async () => {
  svc.getCeUnlockVip.mockResolvedValue(coverage(docs));
  mount(<CeUnlockVipCoveragePanel customerId={101} manage />);
  const block = await screen.findByRole("region", { name: "Documentos anuais" });
  expect(block.textContent).toContain(`Coberto até 31/12/${year}`);
  expect(within(block).getByText("Falta")).toBeTruthy();
  const rows = within(block).getAllByRole("row").slice(1);
  expect(rows.map((r) => within(r).getAllByRole("button")[0].textContent)).toEqual([
    "Procuracao v2.pdf", "Termo anual.pdf", "Procuracao v1.pdf",
  ]);
  expect(rows[0].textContent).toContain("Aguardando análise");
  expect(rows[1].textContent).toContain(`01/01/${year} a 31/12/${year}`);
  // Versão anterior: linha em cinza, só a situação, o motivo inteiro no title.
  expect(rows[2].className).toContain("app-table__row--muted");
  expect(within(rows[2]).getByTitle(/venceu em 30\/09\/2026; envie a renovada/).textContent).toBe("Correção pedida");
  expect(within(block).getAllByRole("button", { name: /^Analisar/ })).toHaveLength(1);

  await userEvent.click(within(rows[1]).getByRole("button", { name: "Ações de termo de devolução" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Revogar aprovação" }));
  expect(svc.ceUnlockCommand).toHaveBeenCalledWith("review", expect.objectContaining({ document_id: "termo", decision: "revoked", reason: "Documento vencido" }));
});

it("Vela: Analisar abre ano, início e fim (31/12, só leitura) e aprova com a vigência", async () => {
  svc.getCeUnlockVip.mockResolvedValue(coverage(docs));
  mount(<CeUnlockVipCoveragePanel customerId={101} manage />);
  await userEvent.click(await screen.findByRole("button", { name: "Analisar procuração" }));
  const analysis = screen.getByRole("region", { name: "Analisar procuração" });
  expect(within(analysis).getByText("Procuracao v2.pdf")).toBeTruthy();
  expect((within(analysis).getByLabelText("Fim da vigência") as HTMLInputElement).readOnly).toBe(true);
  expect((within(analysis).getByLabelText("Início da vigência") as HTMLInputElement).value).toBe("2026-10-16");
  expect(within(analysis).getByRole("button", { name: "Solicitar correção" })).toBeTruthy();
  await userEvent.click(within(analysis).getByRole("button", { name: "Aprovar procuração" }));
  expect(svc.ceUnlockCommand).toHaveBeenCalledWith("review", expect.objectContaining({
    document_id: "proc-v2", decision: "approved", coverage_year: year, valid_from: "2026-10-16", valid_until: `${year}-12-31`,
  }));
});

it("Portal: correção pedida com o motivo curto em âmbar; envio por botões, sem análise", async () => {
  svc.getPortalCeUnlockVip.mockResolvedValue(coverage([docs[1], docs[2]]));
  const scope = { mode: "client" as const, customerId: null, overview: null, basePath: "/portal" };
  mount(<CeUnlockVipCoveragePanel scope={scope} />);
  const block = await screen.findByRole("region", { name: "Documentos anuais VIP" });
  expect(within(block).getByText("Correção pedida: venceu em 30/09/2026")).toBeTruthy();
  expect(within(block).queryByRole("button", { name: /Analisar|Ações de/ })).toBeNull();
  expect(within(block).getByRole("button", { name: "Enviar procuração" }).className).toContain("app-btn--primary");
  const pdf = new File(["%PDF"], "nova.pdf", { type: "application/pdf" });
  await userEvent.upload(within(block).getByLabelText("Arquivo da procuração anual (PDF)"), pdf);
  expect(svc.uploadCeUnlockDocument).toHaveBeenCalledWith({ source: "vip_annual", customer_id: undefined, type: "procuracao" }, pdf, scope);
});
