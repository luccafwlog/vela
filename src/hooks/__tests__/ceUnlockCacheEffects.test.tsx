// @vitest-environment jsdom
// Mutação do Desbloqueio (desk ou Portal), com sucesso ou erro, invalida fila interna,
// ficha do Cliente (VIP e solicitações) e as consultas do Portal.
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCeUnlock } from "../useCeUnlock";
import { usePortalCeUnlock } from "../usePortalCeUnlock";
import { afterCeUnlockChanged } from "../../services/cacheEffects";
import { queryKeys } from "../../services/queryKeys";

const svc = vi.hoisted(() => ({ ceUnlockCommand: vi.fn(), portalCeUnlockCommand: vi.fn() }));
vi.mock("../../services/ceUnlockService", () => ({
  ...svc,
  listCeUnlockBls: vi.fn(async () => ({ items: [], total: 0 })),
  listCeUnlockReviewQueue: vi.fn(), listCustomerCeUnlockRequests: vi.fn(), getCeUnlockRequest: vi.fn(),
  listPortalCeUnlockBls: vi.fn(async () => ({ items: [], total: 0 })),
  listPortalCeUnlockRequests: vi.fn(async () => ({ items: [], total: 0 })),
  getPortalCeUnlockVip: vi.fn(async () => null), getPortalCeUnlockModel: vi.fn(async () => null), getPortalCeUnlockRequest: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

// Consultas que telas distintas mantêm no mesmo cache.
const watched = {
  filaInterna: [...queryKeys.ceUnlock.all(), "review-queue", 1],
  fichaVip: queryKeys.ceUnlock.vip({ customerId: 7 }),
  fichaSolicitacoes: [...queryKeys.ceUnlock.all(), "customer-requests", 7, "", 1],
  fichaCliente: ["customer-ficha", 7],
  detalheCliente: ["customer-detail", 7],
  portalLista: queryKeys.ceUnlock.list({ mode: "client" }, {}, 1),
  portalVip: queryKeys.ceUnlock.vip({ mode: "client" }),
  portalPedido: queryKeys.ceUnlock.request({ mode: "client" }, "req-1"),
};
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const key of Object.values(watched)) client.setQueryData(key, { ok: true });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const stale = () => Object.entries(watched).filter(([, key]) => client.getQueryState(key)?.isInvalidated).map(([name]) => name);
  return { client, wrapper, stale };
}

describe("invalidação do Desbloqueio de CE", () => {
  it("afterCeUnlockChanged marca fila, ficha e Portal como desatualizados", async () => {
    const { client, stale } = setup();
    await afterCeUnlockChanged(client);
    expect(stale().sort()).toEqual(Object.keys(watched).sort());
  });

  it("comando do desk invalida também quando o banco recusa", async () => {
    svc.ceUnlockCommand.mockRejectedValueOnce(new Error("Versão desatualizada"));
    const { wrapper, stale } = setup();
    const { result } = renderHook(() => useCeUnlock({}, 1, false), { wrapper });
    await result.current.command.mutateAsync({ action: "review", payload: {} }).catch(() => undefined);
    await waitFor(() => expect(stale().sort()).toEqual(Object.keys(watched).sort()));
  });

  it("comando do Portal invalida fila interna e ficha do Cliente", async () => {
    svc.portalCeUnlockCommand.mockResolvedValueOnce({ id: "req-1" });
    const { wrapper, stale } = setup();
    const { result } = renderHook(() => usePortalCeUnlock({}, 1, null), { wrapper });
    await result.current.command.mutateAsync({ action: "submit", payload: {} });
    await waitFor(() => expect(stale()).toEqual(expect.arrayContaining(["filaInterna", "fichaVip", "fichaSolicitacoes", "fichaCliente"])));
  });
});
