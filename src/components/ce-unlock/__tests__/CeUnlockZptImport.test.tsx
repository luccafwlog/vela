// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  reconcile: vi.fn(),
  after: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("../../../services/cacheEffects", () => ({ afterCeUnlockChanged: mocks.after }));
vi.mock("../../../services/ceUnlockZptReconcile", () => ({
  parseCeUnlockZptFile: mocks.parse,
  reconcileCeUnlockZpt: mocks.reconcile,
}));

import { CeUnlockZptImport } from "../CeUnlockZptImport";

afterEach(cleanup);
beforeEach(() => {
  mocks.parse.mockReset();
  mocks.reconcile.mockReset();
  mocks.after.mockClear();
});

const row = (ce: string, status = "Bloqueado") => ({ ce, status, description: null, updated_at: null, pending: [] });

function chooseFile(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(["CE;Status"], "zpt.csv")] },
  });
}

it("usa a área de arquivo do molde, sem campo de arquivo cru visível", () => {
  const { container } = render(<CeUnlockZptImport onClose={vi.fn()} />);
  expect(container.querySelector(".app-import-drop")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Baixar modelo .xlsx" }).getAttribute("href")).toBe("/templates/zpt-exportar-tela-exemplo.xlsx");
});

it("prévia mostra o que será conciliado e a contagem das linhas sem CE ignoradas (D3)", async () => {
  mocks.parse.mockResolvedValue({
    rows: [row("122605325622422", "Desbloqueado"), row("122605331512625")],
    rowErrors: [],
    skippedRows: [4, 7],
    warnings: [],
  });
  mocks.reconcile.mockResolvedValue({ rows: 2, unlocked: 1, divergent: 1, stale: 0, ignored: 0, unknown_ce: 0 });
  const { container } = render(<CeUnlockZptImport onClose={vi.fn()} />);

  chooseFile(container);
  expect(await screen.findByText("122605325622422")).toBeTruthy();
  expect(screen.getByText("2 linhas sem CE ou sem situação ignoradas")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Conciliar 2 CEs" }));

  await waitFor(() => expect(screen.getByRole("status", { name: "Resultado da conciliação" })).toBeTruthy());
  expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  expect(mocks.reconcile.mock.calls[0][0]).toHaveLength(2);
  expect(mocks.after).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Concluir" })).toBeTruthy();
});

it("CE ilegível recusa o arquivo inteiro: nada é conciliado", async () => {
  mocks.parse.mockResolvedValue({
    rows: [row("122605325622422")],
    rowErrors: [{ row: 3, message: 'CE "ABC" ilegível: o CE Mercante tem 15 dígitos.' }],
    skippedRows: [],
    warnings: [],
  });
  const { container } = render(<CeUnlockZptImport onClose={vi.fn()} />);

  chooseFile(container);
  expect(await screen.findByText('CE "ABC" ilegível: o CE Mercante tem 15 dígitos.')).toBeTruthy();
  const button = screen.getByRole("button", { name: "Conciliar 1 CE" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});

it("recusa do banco: a prévia fica e a tela diz que nada foi gravado", async () => {
  mocks.parse.mockResolvedValue({ rows: [row("122605325622422")], rowErrors: [], skippedRows: [], warnings: [] });
  mocks.reconcile.mockRejectedValue(Object.assign(new Error("Acesso negado."), { code: "42501" }));
  const { container } = render(<CeUnlockZptImport onClose={vi.fn()} />);

  chooseFile(container);
  fireEvent.click(await screen.findByRole("button", { name: "Conciliar 1 CE" }));

  expect(await screen.findByText("A conciliação não foi concluída")).toBeTruthy();
  expect(screen.getByText(/^Nada foi gravado:/)).toBeTruthy();
  expect(mocks.after).not.toHaveBeenCalled();
});
