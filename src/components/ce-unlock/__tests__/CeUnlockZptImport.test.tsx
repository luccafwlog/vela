// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WINDOWS_1252_WARNING } from "../../../services/importCore";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  parse: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("../../ui/ConfirmDialog", () => ({ useConfirm: () => mocks.confirm }));
vi.mock("../../../services/cacheEffects", () => ({ afterCeUnlockChanged: vi.fn() }));
vi.mock("../../../services/ceUnlockZptReconcile", () => ({
  parseCeUnlockZptFile: mocks.parse,
  reconcileCeUnlockZpt: mocks.reconcile,
}));

import { CeUnlockZptImport } from "../CeUnlockZptImport";

afterEach(cleanup);

// Revisão da PR 929: o aviso de CSV em Windows-1252 não é dado deixado de fora;
// "Fora da conciliação" lista só o que de fato ficou fora.
it("mostra o aviso de Windows-1252 à parte, fora da lista do que ficou fora", async () => {
  mocks.parse.mockResolvedValue({
    rows: [{ ce: "1", status: "x" }],
    rowErrors: [],
    warnings: [WINDOWS_1252_WARNING, "1 linha oculta ignorada: o filtro da planilha indica importar só o visível."],
  });
  mocks.confirm.mockResolvedValue(false);
  const { container } = render(<CeUnlockZptImport />);

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(["CE;Status"], "zpt.csv")] },
  });
  fireEvent.click(screen.getByRole("button", { name: /Conciliar arquivo/ }));

  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
  const options = mocks.confirm.mock.calls[0][0];
  expect(options.message).toBe(`${WINDOWS_1252_WARNING} Conciliar 1 carga(s) do arquivo da ZPT?`);
  expect(options.affected).toEqual({
    summary: "Fora da conciliação",
    items: ["1 linha oculta ignorada: o filtro da planilha indica importar só o visível."],
  });
});

it("só o aviso de Windows-1252: nada aparece como fora da conciliação", async () => {
  mocks.parse.mockResolvedValue({ rows: [{ ce: "1", status: "x" }], rowErrors: [], warnings: [WINDOWS_1252_WARNING] });
  mocks.confirm.mockResolvedValue(false);
  const { container } = render(<CeUnlockZptImport />);

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(["CE;Status"], "zpt.csv")] },
  });
  fireEvent.click(screen.getByRole("button", { name: /Conciliar arquivo/ }));

  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
  expect(mocks.confirm.mock.calls.at(-1)?.[0].affected).toBeUndefined();
});
