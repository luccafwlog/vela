// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  deleteManualVaziosBooking: vi.fn(() => Promise.resolve()),
  createManualVaziosBooking: vi.fn(() => Promise.resolve()),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  refetch: vi.fn(() => Promise.resolve()),
  operationRefetch: vi.fn(() => Promise.resolve()),
  showToast: vi.fn(),
  upsertServiceLine: vi.fn(() => Promise.resolve({ id: "line-1" })),
  getQueryData: vi.fn((): unknown => undefined),
  setQueryData: vi.fn(),
  operationData: { linhas: [] } as Record<string, unknown> | undefined,
  unitsData: { rows: [] as unknown[], count: 0 },
  armazenagemServicesData: [] as unknown[],
  extraDepotServices: [] as unknown[],
  voyagePortsData: [] as string[],
  depotsData: [] as unknown[],
  // Estado de leitura forçado por chave (carregando ou falha), sem dado.
  queryOverrides: {} as Record<string, { isLoading?: boolean; error?: unknown }>,
  openOrCreate: vi.fn(() => Promise.resolve({ id: "operation-new", created: true })),
  adrLocked: false,
}));

const queryFns = new Map<string, (() => unknown) | undefined>();
const escalaMocks = vi.hoisted(() => ({ listEscalas: vi.fn(), listBlPorts: vi.fn() }));
const DEPOTS = [
  { id: "depot-1", code: "VBR", name: "Depot Vitória", tipo: "depot", active: true, free_time_vazio_days: 0, free_time_material_days: 0 },
  { id: "terminal-1", code: "TVV", name: "Terminal Vitória", tipo: "terminal_portuario", active: true, free_time_vazio_days: 0, free_time_material_days: 0 },
  { id: "depot-old", code: "ANTIGO", name: "Depot desativado", tipo: "depot", active: false, free_time_vazio_days: 0, free_time_material_days: 0 },
];

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries, getQueryData: mocks.getQueryData, setQueryData: mocks.setQueryData }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useQuery: ({ queryKey, queryFn }: { queryKey: unknown[]; queryFn?: () => unknown }) => {
    const key = queryKey[0];
    queryFns.set(String(key), queryFn);
    const data = key === "vazios-export-operations"
      ? {
          operations: [{
            id: "operation-1",
            voyage_id: 179,
            embark_port: "BRVIX",
            created_at: "2026-10-01T10:00:00Z",
            updated_at: "2026-10-01T10:00:00Z",
            voyage: { voyage_number: "123N", vessel: { name: "NAVIO VERDE" } },
            linhas: [],
          }, {
            id: "operation-2",
            voyage_id: 180,
            embark_port: "BRSSZ",
            created_at: "2026-09-01T10:00:00Z",
            updated_at: "2026-09-01T10:00:00Z",
            voyage: { voyage_number: "045S", vessel: { name: "NAVIO AZUL" } },
            linhas: [],
          }],
          bookings: (mocks.unitsData.rows as Array<Record<string, unknown>>).map((row) => ({ operation_id: "operation-1", ...row })),
        }
      : key === "embarque-vazios-units"
        ? mocks.unitsData
        : key === "embarque-vazios-operation"
          ? mocks.operationData
          : key === "depots"
            ? mocks.depotsData
            : key === "depot-services"
              ? [
                  { id: "general-1", name: "Handling", natureza: "geral", route_destino_id: null, active: true },
                  { id: "general-old", name: "Handling antigo", natureza: "geral", route_destino_id: null, active: false },
                  { id: "transport-1", name: "Transporte", natureza: "transporte", route_destino_id: "terminal-1", active: true },
                  ...mocks.extraDepotServices,
                ]
              : key === "armazenagem-services"
                ? mocks.armazenagemServicesData
                : key === "embarque-vazios-voyage-ports"
                  ? mocks.voyagePortsData
                  : key === "agency-report" && queryKey[3] === "vazios-lock"
                    ? mocks.adrLocked
                    : [];
    const override = mocks.queryOverrides[String(key)];
    if (override) {
      return { data: undefined, isLoading: Boolean(override.isLoading), error: override.error ?? null, fetchStatus: "idle", refetch: mocks.refetch };
    }
    return {
      data,
      isLoading: false,
      error: null,
      fetchStatus: "idle",
      refetch: key === "embarque-vazios-operation" ? mocks.operationRefetch : mocks.refetch,
    };
  },
}));

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, can: () => true }),
}));
vi.mock("../../components/ui/Toast", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../components/ui/ConfirmDialog", () => ({ useConfirm: () => mocks.confirm, useConfirmWithReason: () => async (o: unknown) => ((await mocks.confirm(o)) ? "motivo" : null) }));
vi.mock("../../components/shared/VoyageCombobox", () => ({
  VoyageCombobox: ({ onSelect, disabled, selectedVoyageId }: { onSelect: (voyageId: number | null) => void; disabled?: boolean; selectedVoyageId?: number | null }) => (
    <button type="button" disabled={disabled} data-voyage={selectedVoyageId ?? ""} onClick={() => onSelect(179)}>
      Selecionar viagem
    </button>
  ),
}));
vi.mock("../../services/supabase", () => ({ supabase: {} }));
vi.mock("../../services/voyageRouteSchedules", () => ({ listVoyageEscalaSchedulesByVoyageIds: escalaMocks.listEscalas }));
vi.mock("../../services/operationalLists", () => ({ listVoyageRoutePorts: escalaMocks.listBlPorts }));
vi.mock("../../services/depots", () => ({
  listDepots: vi.fn(),
  upsertDepot: vi.fn(),
  deleteDepot: vi.fn(),
  listCurrentDepotServices: vi.fn(),
  listArmazenagemServices: vi.fn(),
  valorSugerido: vi.fn(() => 0),
}));
vi.mock("../../services/vaziosImport", () => ({ importVaziosManifest: vi.fn(), parseVaziosManifestFile: vi.fn() }));
vi.mock("../../services/vaziosExportOperations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/vaziosExportOperations")>();
  return {
    summarizeVaziosOperations: actual.summarizeVaziosOperations,
    listVaziosExportOperationsWithUnits: vi.fn(),
    createManualVaziosBooking: mocks.createManualVaziosBooking,
    deleteManualVaziosBooking: mocks.deleteManualVaziosBooking,
    deleteServiceLine: vi.fn(),
    getVaziosExportOperation: vi.fn(),
    listVaziosBookingsForOperation: vi.fn(),
    updateManualVaziosBooking: vi.fn(),
    updateServiceLineObservation: vi.fn(),
    upsertServiceLine: mocks.upsertServiceLine,
    openOrCreateVaziosExportOperation: mocks.openOrCreate,
    isVaziosExportLockedByAdr: vi.fn(),
  };
});

import { EmbarqueVazios } from "../EmbarqueVazios";
import { importVaziosManifest, parseVaziosManifestFile } from "../../services/vaziosImport";

afterEach(cleanup);
beforeEach(() => {
  mocks.operationRefetch.mockClear();
  mocks.getQueryData.mockReset().mockReturnValue(undefined);
  mocks.setQueryData.mockClear();
  mocks.showToast.mockClear();
  mocks.invalidateQueries.mockClear();
  mocks.upsertServiceLine.mockClear();
  mocks.operationData = { linhas: [] };
  mocks.unitsData = { rows: [], count: 0 };
  mocks.armazenagemServicesData = [];
  mocks.extraDepotServices = [];
  mocks.voyagePortsData = [];
  mocks.depotsData = DEPOTS;
  mocks.queryOverrides = {};
  mocks.refetch.mockClear();
  mocks.openOrCreate.mockClear();
  mocks.adrLocked = false;
});

const OPENED = "/embarquevazios?embarque=operation-1";

function renderPage(entry = OPENED) {
  return render(<MemoryRouter initialEntries={[entry]}><EmbarqueVazios /></MemoryRouter>);
}

function openServicesTab() {
  fireEvent.click(screen.getByRole("tab", { name: /Serviços/i }));
}

function openLineModal() {
  openServicesTab();
  fireEvent.click(screen.getByRole("button", { name: /Lançar linha/i }));
  return screen.getByRole("dialog");
}

describe("EmbarqueVazios", () => {
  it("sem embarque escolhido, lista todos os embarques, o mais recente primeiro, sem o ID interno", () => {
    renderPage("/embarquevazios");

    const links = screen.getAllByRole("link", { name: /NAVIO/ });
    expect(links.map((link) => link.textContent)).toEqual(["NAVIO VERDE / 123N", "NAVIO AZUL / 045S"]);
    expect(screen.queryByText(/179/)).toBeNull();
    expect(screen.getByRole("link", { name: "Locais (depots e terminais)" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Busca"), { target: { value: "azul" } });
    expect(screen.queryByText("NAVIO VERDE / 123N")).toBeNull();
    expect(screen.getByText("NAVIO AZUL / 045S")).toBeTruthy();
  });

  // ADR 0095, decisão 22 (migration 398): com o ADR de Saída fechado, nada
  // muda no Embarque de vazios; a tela tira as ações e diz para reabrir o ADR.
  it("ADR de Saída fechado: sem incluir, importar, editar ou lançar, com o aviso de reabrir", () => {
    mocks.adrLocked = true;
    mocks.unitsData = { rows: [{ id: "unit-1", container_number: "MSCU1234567", container_type: "40HC", local_id: "depot-1", condition: "vazio", hand_in_date: "2026-10-01", hand_out_date: "2026-10-02", movement_date: null }], count: 1 };
    renderPage();
    expect(screen.getByText(/Reabra o ADR de Saída para mudar/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Adicionar unidade/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Importar planilha/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar/i })).toBeNull();
    openServicesTab();
    expect(screen.queryByRole("button", { name: /Lançar linha/i })).toBeNull();
  });

  it("com embarque escolhido, mostra a faixa de identidade e as abas", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "NAVIO VERDE / 123N" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Unidades embarcadas · 0" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^Serviços · R\$\s0,00$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Todos os embarques" })).toBeTruthy();
  });

  it("inclui uma Unidade Embarcada pela janela e invalida o ADR da escala selecionada", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Adicionar unidade/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Container/), { target: { value: "MSCU1234567" } });
    fireEvent.change(within(dialog).getByLabelText(/Local/), { target: { value: "depot-1" } });
    fireEvent.change(within(dialog).getByLabelText(/Entrada/), { target: { value: "2026-07-02" } });
    fireEvent.change(within(dialog).getByLabelText(/Saída/), { target: { value: "2026-07-03" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar unidade" }));

    await waitFor(() => expect(mocks.createManualVaziosBooking).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "operation-1",
      voyageId: 179,
      localId: "depot-1",
      containerNumber: "MSCU1234567",
      condition: "vazio",
    })));
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["agency-report", 179] }));
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["vazios-export-operations"] });
  });

  it("V1: a janela da unidade oferece só locais ativos, e a condição é Vazio ou Com material", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Adicionar unidade/i }));
    const dialog = screen.getByRole("dialog");
    const local = within(dialog).getByLabelText(/Local/) as HTMLSelectElement;
    expect([...local.options].map((option) => option.value)).toEqual(["", "depot-1", "terminal-1"]);
    const condition = within(dialog).getByLabelText(/Condição/) as HTMLSelectElement;
    expect([...condition.options].map((option) => option.text)).toEqual(["Vazio", "Com material"]);
  });

  it("exibe a mensagem da RPC quando a inclusão da Unidade Embarcada falha", async () => {
    mocks.createManualVaziosBooking.mockRejectedValueOnce({
      code: "22023",
      message: "Local inativo: escolha um local ativo ou reative o local no cadastro.",
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Adicionar unidade/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Container/), { target: { value: "MSCU1234567" } });
    fireEvent.change(within(dialog).getByLabelText(/Local/), { target: { value: "depot-1" } });
    fireEvent.change(within(dialog).getByLabelText(/Entrada/), { target: { value: "2026-07-02" } });
    fireEvent.change(within(dialog).getByLabelText(/Saída/), { target: { value: "2026-07-03" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar unidade" }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(
      "Local inativo: escolha um local ativo ou reative o local no cadastro.",
      "error",
    ));
  });

  it("V1: a janela da linha oferece só locais e serviços ativos", () => {
    renderPage();
    const dialog = openLineModal();
    const local = within(dialog).getByLabelText(/Local/) as HTMLSelectElement;
    expect([...local.options].map((option) => option.value)).toEqual(["", "depot-1", "terminal-1"]);
    fireEvent.change(local, { target: { value: "depot-1" } });
    fireEvent.change(within(dialog).getByLabelText(/Natureza/), { target: { value: "geral" } });
    const service = within(dialog).getByLabelText(/Serviço/) as HTMLSelectElement;
    expect([...service.options].map((option) => option.text)).toEqual(["Selecione", "Handling · Geral"]);
  });

  it("oferece somente o destino vinculado ao serviço de transporte", () => {
    renderPage();
    const dialog = openLineModal();
    fireEvent.change(within(dialog).getByLabelText(/Local/), { target: { value: "depot-1" } });
    fireEvent.change(within(dialog).getByLabelText(/Natureza/), { target: { value: "transporte" } });
    fireEvent.change(within(dialog).getByLabelText(/Serviço/), { target: { value: "transport-1" } });

    const destination = within(dialog).getByLabelText("Destino da rota") as HTMLSelectElement;
    expect(destination.disabled).toBe(false);
    expect([...destination.options].map((option) => option.text)).toEqual([
      "Selecione",
      "TVV · Terminal Vitória",
    ]);
    expect(within(dialog).queryByLabelText(/Condição/)).toBeNull();
    expect(within(dialog).queryByLabelText("Percentual")).toBeNull();
  });

  it("não oferece transporte para destino inativo (migration 331)", () => {
    mocks.extraDepotServices = [
      { id: "transport-old", name: "Transporte p/ antigo", natureza: "transporte", route_destino_id: "depot-old", active: true },
    ];
    renderPage();
    const dialog = openLineModal();
    fireEvent.change(within(dialog).getByLabelText(/Local/), { target: { value: "depot-1" } });
    fireEvent.change(within(dialog).getByLabelText(/Natureza/), { target: { value: "transporte" } });
    const service = within(dialog).getByLabelText(/Serviço/) as HTMLSelectElement;
    expect([...service.options].map((option) => option.text)).toEqual(["Selecione", "Transporte · Transporte"]);
  });

  it("seleciona a natureza antes de ofertar os serviços", () => {
    renderPage();
    const dialog = openLineModal();
    fireEvent.change(within(dialog).getByLabelText(/Local/), { target: { value: "depot-1" } });

    expect((within(dialog).getByLabelText(/Serviço/) as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Natureza/), { target: { value: "transporte" } });
    expect((within(dialog).getByLabelText(/Serviço/) as HTMLSelectElement).disabled).toBe(false);
  });

  it("envia a linha e o destino vinculado ao serviço de transporte", async () => {
    renderPage();
    const dialog = openLineModal();
    fireEvent.change(within(dialog).getByLabelText(/Local/), { target: { value: "depot-1" } });
    fireEvent.change(within(dialog).getByLabelText(/Natureza/), { target: { value: "transporte" } });
    fireEvent.change(within(dialog).getByLabelText(/Serviço/), { target: { value: "transport-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lançar linha" }));

    await waitFor(() => expect(mocks.upsertServiceLine).toHaveBeenCalledWith(expect.objectContaining({
      operation_id: "operation-1",
      service_id: "transport-1",
      destino_id: "terminal-1",
      percentual: null,
    })));
    expect(mocks.operationRefetch).toHaveBeenCalledTimes(0);
  });

  it("mescla a linha lançada no cache existente e evita duplicidade pelo ID", async () => {
    mocks.getQueryData.mockReturnValue({
      id: "operation-1",
      linhas: [{ id: "line-1", quantidade: "1", valor_unitario: "10" }],
    });
    renderPage();
    const dialog = openLineModal();
    fireEvent.change(within(dialog).getByLabelText(/Local/), { target: { value: "depot-1" } });
    fireEvent.change(within(dialog).getByLabelText(/Natureza/), { target: { value: "transporte" } });
    fireEvent.change(within(dialog).getByLabelText(/Serviço/), { target: { value: "transport-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lançar linha" }));

    await waitFor(() => expect(mocks.setQueryData).toHaveBeenCalled());
    const [queryKey, payload] = mocks.setQueryData.mock.calls[0];
    expect(queryKey).toEqual(["embarque-vazios-operation", "operation-1"]);
    expect(payload.id).toBe("operation-1");
    expect(payload.linhas).toHaveLength(1);
    expect(payload.linhas[0].id).toBe("line-1");
    expect(mocks.operationRefetch).toHaveBeenCalledTimes(0);
  });

  it("refaz o fetch da operação em vez de gravar um cache fabricado quando não há dado carregado", async () => {
    mocks.operationData = undefined;
    renderPage();
    const dialog = openLineModal();
    fireEvent.change(within(dialog).getByLabelText(/Local/), { target: { value: "depot-1" } });
    fireEvent.change(within(dialog).getByLabelText(/Natureza/), { target: { value: "transporte" } });
    fireEvent.change(within(dialog).getByLabelText(/Serviço/), { target: { value: "transport-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lançar linha" }));

    await waitFor(() => expect(mocks.operationRefetch).toHaveBeenCalledTimes(1));
    expect(mocks.setQueryData).not.toHaveBeenCalled();
  });

  it("só exclui a unidade depois da confirmação (ADR 0072)", async () => {
    mocks.unitsData = {
      rows: [{ id: "u1", container_number: "MSCU7654321", local_id: "depot-1", condition: "material", hand_in_date: "2026-01-01", hand_out_date: "2026-01-05" }],
      count: 1,
    };
    mocks.deleteManualVaziosBooking.mockClear();
    mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderPage();

    const row = screen.getByText("MSCU7654321").closest("tr") as HTMLElement;
    expect(within(row).getByText("Com material")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Excluir unidade MSCU7654321" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.deleteManualVaziosBooking).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Excluir unidade MSCU7654321" }));
    await waitFor(() => expect(mocks.deleteManualVaziosBooking).toHaveBeenCalledWith("u1", "motivo"));
    expect(mocks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ confirmLabel: "Excluir", consequence: expect.any(String) }));
  });

  it("Editar a unidade abre a mesma janela com os dados dela", () => {
    mocks.unitsData = {
      rows: [{ id: "u1", container_number: "MSCU7654321", container_type: "40HC", local_id: "depot-1", condition: "vazio", hand_in_date: "2026-01-01", hand_out_date: "2026-01-05" }],
      count: 1,
    };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Editar unidade MSCU7654321" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Editar unidade" })).toBeTruthy();
    expect((within(dialog).getByLabelText(/Container/) as HTMLInputElement).value).toBe("MSCU7654321");
    expect(within(dialog).getByRole("button", { name: "Salvar unidade" })).toBeTruthy();
  });

  it("mostra o resumo por tipo, local e condição", () => {
    mocks.unitsData = {
      rows: [
        { id: "u1", container_number: "MSCU0000001", container_type: "40HC", local_id: "depot-1", condition: "vazio" },
        { id: "u2", container_number: "MSCU0000002", container_type: "40HC", local_id: "depot-1", condition: "material" },
      ],
      count: 2,
    };
    renderPage();
    expect(screen.getByText("40HC 2")).toBeTruthy();
    expect(screen.getByText("VBR 2")).toBeTruthy();
    expect(screen.getByText("Com material 1 · Vazio 1")).toBeTruthy();
  });

  it("aponta a armazenagem calculada sem linha lançada e lança com 1 clique", async () => {
    mocks.unitsData = {
      rows: [{ id: "u1", local_id: "depot-1", condition: "vazio", hand_in_date: "2026-01-01", hand_out_date: "2026-01-05" }],
      count: 1,
    };
    mocks.armazenagemServicesData = [
      { id: "armaz-1", depot_id: "depot-1", condition: "vazio", natureza: "armazenagem", rate_brl: 25, active: true, name: "Armazenagem" },
    ];
    renderPage();
    openServicesTab();

    const block = screen.getByRole("region", { name: "Armazenagem a lançar" });
    const row = within(block).getByText("VBR").closest("tr") as HTMLElement;
    expect(within(row).getByText("Vazio")).toBeTruthy();
    expect(within(row).getByText("5 dias")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: /Lançar armazenagem/ }));

    await waitFor(() => expect(mocks.upsertServiceLine).toHaveBeenCalledWith(expect.objectContaining({
      operation_id: "operation-1",
      service_id: "armaz-1",
      local_id: "depot-1",
      condition: "vazio",
      quantidade: 5,
      valor_unitario: 25,
      valor_sugerido: 25,
      quantidade_manual: false,
    })));
  });

  it("esconde a armazenagem com 0 dia: as unidades ficaram dentro do free time", () => {
    mocks.depotsData = DEPOTS.map((depot) => depot.id === "depot-1" ? { ...depot, free_time_vazio_days: 30 } : depot);
    mocks.unitsData = {
      rows: [{ id: "u1", local_id: "depot-1", condition: "vazio", hand_in_date: "2026-01-01", hand_out_date: "2026-01-05" }],
      count: 1,
    };
    mocks.armazenagemServicesData = [
      { id: "armaz-1", depot_id: "depot-1", condition: "vazio", natureza: "armazenagem", rate_brl: 25, active: true, name: "Armazenagem" },
    ];
    renderPage();
    openServicesTab();
    expect(screen.queryByRole("region", { name: "Armazenagem a lançar" })).toBeNull();
  });

  it("B12: reconhece o serviço de armazenagem sem condição e lança a linha com a condição da unidade", async () => {
    mocks.unitsData = {
      rows: [{ id: "u1", local_id: "depot-1", condition: "vazio", hand_in_date: "2026-01-01", hand_out_date: "2026-01-05" }],
      count: 1,
    };
    mocks.armazenagemServicesData = [
      { id: "armaz-generico", depot_id: "depot-1", condition: null, natureza: "armazenagem", rate_brl: 30, active: true, name: "Armazenagem" },
    ];
    renderPage();
    openServicesTab();

    expect(screen.queryByText(/Sem serviço de armazenagem cadastrado/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Lançar armazenagem/ }));
    await waitFor(() => expect(mocks.upsertServiceLine).toHaveBeenCalledWith(expect.objectContaining({
      service_id: "armaz-generico",
      condition: "vazio",
      valor_unitario: 30,
    })));
  });

  it("B12: no lançamento manual, o serviço de armazenagem sem condição pede a condição da linha", async () => {
    mocks.extraDepotServices = [
      { id: "armaz-generico", depot_id: "depot-1", name: "Armazenagem", natureza: "armazenagem", condition: null, route_destino_id: null, rate_brl: 30, active: true },
    ];
    renderPage();
    const dialog = openLineModal();
    fireEvent.change(within(dialog).getByLabelText(/Local/), { target: { value: "depot-1" } });
    fireEvent.change(within(dialog).getByLabelText(/Natureza/), { target: { value: "armazenagem" } });
    fireEvent.change(within(dialog).getByLabelText(/Serviço/), { target: { value: "armaz-generico" } });

    const condition = within(dialog).getByLabelText(/Condição/) as HTMLSelectElement;
    expect(condition.disabled).toBe(false);
    expect([...condition.options].map((option) => option.text)).toEqual(["Selecione", "Vazio", "Com material"]);
    fireEvent.change(condition, { target: { value: "material" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lançar linha" }));

    await waitFor(() => expect(mocks.upsertServiceLine).toHaveBeenCalledWith(expect.objectContaining({
      service_id: "armaz-generico",
      condition: "material",
    })));
  });

  it("aponta quando falta cadastrar o serviço de armazenagem para a condição", () => {
    mocks.unitsData = {
      rows: [{ id: "u1", local_id: "depot-1", condition: "vazio", hand_in_date: "2026-01-01", hand_out_date: "2026-01-05" }],
      count: 1,
    };
    mocks.armazenagemServicesData = [];
    renderPage();
    openServicesTab();

    expect(screen.getByText(/Sem serviço de armazenagem cadastrado/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Lançar armazenagem/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Abrir o cadastro de VBR" })).toBeTruthy();
  });

  it("não aponta armazenagem pendente quando a linha já foi lançada", () => {
    mocks.unitsData = {
      rows: [{ id: "u1", local_id: "depot-1", condition: "vazio", hand_in_date: "2026-01-01", hand_out_date: "2026-01-05" }],
      count: 1,
    };
    mocks.operationData = {
      linhas: [{ id: "line-armaz", local_id: "depot-1", condition: "vazio", quantidade: "4", valor_unitario: "25", service: { natureza: "armazenagem", name: "Armazenagem" } }],
    };
    renderPage();
    openServicesTab();

    expect(screen.queryByRole("region", { name: "Armazenagem a lançar" })).toBeNull();
  });

  it("lista as escalas brasileiras da viagem escolhida e grava o código normalizado ao criar", async () => {
    mocks.voyagePortsData = ["BRSSA", "BRVIX"];
    renderPage("/embarquevazios");

    fireEvent.click(screen.getByRole("button", { name: "Novo embarque" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Selecionar viagem/i }));

    const portSelect = within(dialog).getByLabelText(/Porto de embarque/) as HTMLSelectElement;
    expect([...portSelect.options].map((option) => option.value)).toEqual(["", "BRSSA", "BRVIX"]);

    fireEvent.change(portSelect, { target: { value: "BRVIX" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar embarque" }));

    await waitFor(() => expect(mocks.openOrCreate).toHaveBeenCalledWith({ voyageId: 179, embarkPort: "BRVIX" }));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Embarque criado.", "success"));
  });

  it("V4: criar um embarque que já existe abre o existente e diz isso", async () => {
    mocks.voyagePortsData = ["BRVIX"];
    mocks.openOrCreate.mockResolvedValueOnce({ id: "operation-1", created: false });
    renderPage("/embarquevazios");

    fireEvent.click(screen.getByRole("button", { name: "Novo embarque" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Selecionar viagem/i }));
    fireEvent.change(within(dialog).getByLabelText(/Porto de embarque/), { target: { value: "BRVIX" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar embarque" }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Este embarque já existia e foi aberto.", "info"));
    expect(await screen.findByRole("heading", { name: "NAVIO VERDE / 123N" })).toBeTruthy();
  });

  it("V4: a viagem escolhida no Novo embarque não filtra a lista", () => {
    mocks.voyagePortsData = ["BRVIX"];
    renderPage("/embarquevazios");
    fireEvent.click(screen.getByRole("button", { name: "Novo embarque" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Selecionar viagem/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Voltar" }));
    expect(screen.getByText("NAVIO AZUL / 045S")).toBeTruthy();
  });

  it("B11: o Total da Linha de Serviço é quantidade × valor unitário, sem o percentual legado", async () => {
    mocks.operationData = {
      linhas: [{ id: "line-legacy", local_id: "depot-1", condition: null, quantidade: "4", valor_unitario: "25", percentual: "50", quantidade_manual: true, observation: "Conferido", service: { name: "Handling", natureza: "geral" } }],
    };
    renderPage();
    openServicesTab();
    const row = (await screen.findAllByText("Handling")).map((node) => node.closest("tr")).find(Boolean) as HTMLElement;
    expect(within(row).getByText("R$ 100,00")).toBeTruthy();
    expect(within(row).queryByText("R$ 50,00")).toBeNull();
    expect(within(row).getByText("Geral")).toBeTruthy();
    expect(within(row).getByText("Conferido")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Observação da linha Handling" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Excluir linha Handling" })).toBeTruthy();
  });

  it("B26: aberto pela viagem, a lista vem filtrada e o Novo embarque semeado, ambos editáveis", () => {
    renderPage("/embarquevazios?voyage=180");
    expect(screen.queryByText("NAVIO VERDE / 123N")).toBeNull();
    expect(screen.getByText("NAVIO AZUL / 045S")).toBeTruthy();
    expect(screen.getByText("Filtros ativos: Viagem NAVIO AZUL / 045S")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Novo embarque" }));
    const voyageButton = within(screen.getByRole("dialog")).getByRole("button", { name: /Selecionar viagem/i }) as HTMLButtonElement;
    expect(voyageButton.getAttribute("data-voyage")).toBe("180");
    expect(voyageButton.disabled).toBe(false);
    fireEvent.click(voyageButton);
    expect(voyageButton.getAttribute("data-voyage")).toBe("179");
  });

  it("B10: viagem só de embarque de vazios, sem B/L, oferece as escalas da viagem", async () => {
    escalaMocks.listEscalas.mockResolvedValue(new Map([[179, [
      { port: "BRVIX", deleted: false, omitted: false },
      { port: "BRSSZ", deleted: true, omitted: false },
      { port: "BRRIG", deleted: false, omitted: true },
      { port: "CNSHA", deleted: false, omitted: false },
    ]]]));
    escalaMocks.listBlPorts.mockResolvedValue([]);
    renderPage("/embarquevazios");
    fireEvent.click(screen.getByRole("button", { name: "Novo embarque" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Selecionar viagem/i }));
    await expect(Promise.resolve(queryFns.get("embarque-vazios-voyage-ports")?.())).resolves.toEqual(["BRVIX"]);
  });

  it("B10: porto de escala omitida/excluída não volta pelos portos dos B/Ls", async () => {
    escalaMocks.listEscalas.mockResolvedValue(new Map([[179, [
      { port: "BRVIX", deleted: false, omitted: false },
      { port: "BRSSZ", deleted: true, omitted: false },
      { port: "BRRIG", deleted: false, omitted: true },
    ]]]));
    escalaMocks.listBlPorts.mockResolvedValue(["BRRIG", "BRSSZ", "BRPNG", "BRVIX"]);
    renderPage("/embarquevazios");
    fireEvent.click(screen.getByRole("button", { name: "Novo embarque" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Selecionar viagem/i }));
    await expect(Promise.resolve(queryFns.get("embarque-vazios-voyage-ports")?.())).resolves.toEqual(["BRPNG", "BRVIX"]);
  });

  it("?embarque= desconhecido diz que o embarque não existe e volta para a lista", () => {
    renderPage("/embarquevazios?embarque=nao-existe&voyage=180");
    expect(screen.getByText("Embarque não encontrado")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Todos os embarques" }));
    // Volta à lista mantendo a viagem do endereço.
    expect(screen.getByText("NAVIO AZUL / 045S")).toBeTruthy();
    expect(screen.queryByText("NAVIO VERDE / 123N")).toBeNull();
  });

  describe("Locais (depots) ainda sem leitura", () => {
    it("carregando: lista e detalhe esperam, sem 'Local removido' nem armazenagem escondida", () => {
      mocks.queryOverrides = { depots: { isLoading: true } };
      renderPage("/embarquevazios");
      expect(screen.getByRole("status", { busy: true })).toBeTruthy();
      expect(screen.queryByText("NAVIO VERDE / 123N")).toBeNull();
      cleanup();

      renderPage();
      expect(screen.getByRole("status", { busy: true })).toBeTruthy();
      expect(screen.queryByText("Embarque não encontrado")).toBeNull();
      expect(screen.queryByRole("heading", { name: "NAVIO VERDE / 123N" })).toBeNull();
    });

    it("falha: diz que os Locais não carregaram e tenta de novo", () => {
      mocks.queryOverrides = { depots: { error: new Error("rede") } };
      renderPage();
      expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar os locais (depots e terminais)");
      expect(screen.queryByText("Embarque não encontrado")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
      expect(mocks.refetch).toHaveBeenCalled();
      cleanup();

      renderPage("/embarquevazios");
      expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar os locais");
      expect(screen.queryByText("NAVIO VERDE / 123N")).toBeNull();
    });
  });

  it("Novo embarque: falha ao ler as escalas não manda cadastrar escala", () => {
    mocks.queryOverrides = { "embarque-vazios-voyage-ports": { error: new Error("rede") } };
    renderPage("/embarquevazios");
    fireEvent.click(screen.getByRole("button", { name: "Novo embarque" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Selecionar viagem/i }));
    expect(within(dialog).getByText(/Não foi possível carregar as escalas da viagem/)).toBeTruthy();
    expect(within(dialog).queryByText(/Nenhuma escala brasileira/)).toBeNull();
  });

  it("Novo embarque: reabrir volta à viagem do endereço e sem o porto anterior", () => {
    mocks.voyagePortsData = ["BRVIX"];
    renderPage("/embarquevazios?voyage=180");
    fireEvent.click(screen.getByRole("button", { name: "Novo embarque" }));
    let dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Selecionar viagem/i }));
    fireEvent.change(within(dialog).getByLabelText(/Porto de embarque/), { target: { value: "BRVIX" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Voltar" }));

    fireEvent.click(screen.getByRole("button", { name: "Novo embarque" }));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /Selecionar viagem/i }).getAttribute("data-voyage")).toBe("180");
    expect((within(dialog).getByLabelText(/Porto de embarque/) as HTMLSelectElement).value).toBe("");
  });

  it("o link da lista para o embarque mantém a viagem do endereço", () => {
    renderPage("/embarquevazios?voyage=180");
    expect(screen.getByRole("link", { name: "NAVIO AZUL / 045S" }).getAttribute("href")).toBe("/embarquevazios?voyage=180&embarque=operation-2");
  });

  describe("Importar planilha de Unidades Embarcadas com linhas ocultas", () => {
    const parsedWith = (hidden: { rows: number; sheets: string[] }) => ({
      bookings: [{ rowNumber: 2, container_number: "MSCU1234567", container_type: "40HC", local_code: "VBR", condition: "vazio" as const, hand_in_date: null, hand_out_date: null, movement_date: null }],
      rowErrors: [],
      warnings: [],
      hidden,
    });

    async function chooseFileAndImport() {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: /Importar planilha/i }));
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [new File(["x"], "unidades.xlsx")] } });
      fireEvent.click(await screen.findByRole("button", { name: /^Importar$/i }));
    }

    beforeEach(() => {
      mocks.confirm.mockReset();
      vi.mocked(importVaziosManifest).mockReset().mockResolvedValue({ manifestId: "m1" });
      vi.mocked(parseVaziosManifestFile).mockReset();
    });

    // Revisão da PR 929 (E3-02): planilha filtrada por depot — as linhas
    // ocultas eram ignoradas sem aviso e a reimportação tirava as unidades
    // delas do Embarque.
    it("pergunta antes de gravar e não grava quando o operador volta", async () => {
      vi.mocked(parseVaziosManifestFile).mockResolvedValue(parsedWith({ rows: 2, sheets: [] }));
      mocks.confirm.mockResolvedValue(false);

      await chooseFileAndImport();

      await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
        message: "2 linhas ocultas foram ignoradas e as unidades delas sairão do Embarque. Continuar?",
      })));
      expect(importVaziosManifest).not.toHaveBeenCalled();
    });

    it("grava depois da confirmação explícita", async () => {
      vi.mocked(parseVaziosManifestFile).mockResolvedValue(parsedWith({ rows: 0, sheets: ["Rascunho"] }));
      mocks.confirm.mockResolvedValue(true);

      await chooseFileAndImport();

      await waitFor(() => expect(importVaziosManifest).toHaveBeenCalledTimes(1));
      expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
        message: 'A aba oculta "Rascunho" foi ignorada; se ela tiver unidades, elas sairão do Embarque. Continuar?',
      }));
    });

    it("sem nada oculto, grava sem perguntar", async () => {
      vi.mocked(parseVaziosManifestFile).mockResolvedValue(parsedWith({ rows: 0, sheets: [] }));

      await chooseFileAndImport();

      await waitFor(() => expect(importVaziosManifest).toHaveBeenCalledTimes(1));
      expect(mocks.confirm).not.toHaveBeenCalled();
    });
  });
});
