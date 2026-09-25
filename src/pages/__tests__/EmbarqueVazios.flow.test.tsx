// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  voyagePortsData: [] as string[],
  upsertVaziosExportOperation: vi.fn(() => Promise.resolve({ id: "operation-new" })),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries, getQueryData: mocks.getQueryData, setQueryData: mocks.setQueryData }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey[0];
    const data = key === "vazios-export-operations"
      ? [{
          id: "operation-1",
          voyage_id: 179,
          embark_port: "BRVIX",
          voyage: { voyage_number: "123N", vessel: { name: "NAVIO VERDE" } },
        }]
      : key === "embarque-vazios-units"
        ? mocks.unitsData
        : key === "embarque-vazios-operation"
          ? mocks.operationData
          : key === "depots"
            ? [
                { id: "depot-1", code: "VBR", name: "Depot Vitória", tipo: "depot" },
                { id: "terminal-1", code: "TVV", name: "Terminal Vitória", tipo: "terminal_portuario" },
              ]
            : key === "depot-services"
              ? [
                  { id: "general-1", name: "Handling", natureza: "geral", route_destino_id: null },
                  { id: "transport-1", name: "Transporte", natureza: "transporte", route_destino_id: "terminal-1" },
                ]
              : key === "armazenagem-services"
                ? mocks.armazenagemServicesData
                : key === "embarque-vazios-voyage-ports"
                  ? mocks.voyagePortsData
                  : [];
    return {
      data,
      isLoading: false,
      error: null,
      refetch: key === "embarque-vazios-operation" ? mocks.operationRefetch : mocks.refetch,
    };
  },
}));

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, can: () => true }),
}));
vi.mock("../../components/ui/Toast", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../components/ui/ConfirmDialog", () => ({ useConfirm: () => mocks.confirm }));
vi.mock("../../components/shared/VoyageCombobox", () => ({
  VoyageCombobox: ({ onSelect }: { onSelect: (voyageId: number | null) => void }) => (
    <button type="button" onClick={() => onSelect(179)}>
      Selecionar viagem
    </button>
  ),
}));
vi.mock("../../services/supabase", () => ({ supabase: {} }));
vi.mock("../../services/depots", () => ({
  listDepots: vi.fn(),
  listDepotServices: vi.fn(),
  listArmazenagemServices: vi.fn(),
  valorSugerido: vi.fn(() => 0),
}));
vi.mock("../../services/vaziosImport", () => ({ importVaziosManifest: vi.fn(), parseVaziosManifestFile: vi.fn() }));
vi.mock("../../services/vaziosExportOperations", () => ({
  createManualVaziosBooking: mocks.createManualVaziosBooking,
  deleteManualVaziosBooking: mocks.deleteManualVaziosBooking,
  deleteServiceLine: vi.fn(),
  getVaziosExportOperation: vi.fn(),
  listVaziosBookingsForOperation: vi.fn(),
  updateManualVaziosBooking: vi.fn(),
  upsertServiceLine: mocks.upsertServiceLine,
  upsertVaziosExportOperation: mocks.upsertVaziosExportOperation,
}));

import { EmbarqueVazios } from "../EmbarqueVazios";

afterEach(cleanup);
beforeEach(() => {
  mocks.operationRefetch.mockClear();
  mocks.getQueryData.mockReset().mockReturnValue(undefined);
  mocks.setQueryData.mockClear();
  mocks.operationData = { linhas: [] };
  mocks.unitsData = { rows: [], count: 0 };
  mocks.armazenagemServicesData = [];
  mocks.voyagePortsData = [];
  mocks.upsertVaziosExportOperation.mockClear();
});

async function selectOperation() {
  fireEvent.change(screen.getByPlaceholderText("Busque por navio ou viagem"), { target: { value: "NAVIO" } });
  const option = await screen.findByText("NAVIO VERDE / 123N");
  fireEvent.mouseDown(option);
}

describe("EmbarqueVazios", () => {
  it("busca o embarque por navio/viagem, sem expor o ID interno", async () => {
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText("Busque por navio ou viagem"), { target: { value: "NAVIO" } });

    expect(await screen.findByText("NAVIO VERDE / 123N")).toBeTruthy();
    expect(screen.queryByText(/179/)).toBeNull();
  });

  it("inclui uma Unidade Embarcada e invalida o ADR da escala selecionada", async () => {
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);

    await selectOperation();
    fireEvent.change(screen.getByLabelText("Container"), { target: { value: "MSCU1234567" } });
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "depot-1" } });
    fireEvent.change(screen.getByLabelText("Entrada"), { target: { value: "2026-07-02" } });
    fireEvent.change(screen.getByLabelText("Saída"), { target: { value: "2026-07-03" } });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar/i }));

    await waitFor(() => expect(mocks.createManualVaziosBooking).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "operation-1",
      voyageId: 179,
      localId: "depot-1",
      containerNumber: "MSCU1234567",
    })));
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["agency-report", 179] }));
  });

  it("exibe a mensagem da RPC quando a inclusao da Unidade Embarcada falha", async () => {
    mocks.createManualVaziosBooking.mockRejectedValueOnce({
      code: "42501",
      message: "Usuario sem permissao para criar unidade embarcada.",
    });
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);

    await selectOperation();
    fireEvent.change(screen.getByLabelText("Container"), { target: { value: "MSCU1234567" } });
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "depot-1" } });
    fireEvent.change(screen.getByLabelText("Entrada"), { target: { value: "2026-07-02" } });
    fireEvent.change(screen.getByLabelText("Saída"), { target: { value: "2026-07-03" } });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar/i }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(
      "Usuario sem permissao para criar unidade embarcada.",
      "error",
    ));
  });

  it("oferece somente o destino vinculado ao serviço de transporte", async () => {
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);

    await selectOperation();
    fireEvent.click(screen.getByRole("button", { name: /Serviços/i }));
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "depot-1" } });
    fireEvent.change(screen.getByLabelText("Serviço"), { target: { value: "transport-1" } });

    const destination = screen.getByLabelText("Destino da rota") as HTMLSelectElement;
    expect(destination.disabled).toBe(false);
    expect([...destination.options].map((option) => option.text)).toEqual([
      "Selecione",
      "TVV · Terminal Vitória",
    ]);
  });

  it("oculta destino, condição e percentual quando o serviço não os prevê", async () => {
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);
    await selectOperation();
    fireEvent.click(screen.getByRole("button", { name: /Serviços/i }));
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "depot-1" } });
    fireEvent.change(screen.getByLabelText("Serviço"), { target: { value: "transport-1" } });

    expect(screen.queryByLabelText("Condição")).toBeNull();
    expect(screen.queryByLabelText("Percentual")).toBeNull();
  });

  it("seleciona a natureza antes de ofertar os serviços", async () => {
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);
    await selectOperation();
    fireEvent.click(screen.getByRole("button", { name: /Serviços/i }));
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "depot-1" } });

    expect(screen.getByLabelText("Natureza")).toBeTruthy();
    expect((screen.getByLabelText("Serviço") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Natureza"), { target: { value: "transporte" } });
    expect((screen.getByLabelText("Serviço") as HTMLSelectElement).disabled).toBe(false);
  });

  it("envia a linha e o destino vinculado ao serviço de transporte", async () => {
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);
    await selectOperation();
    fireEvent.click(screen.getByRole("button", { name: /Serviços/i }));
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "depot-1" } });
    fireEvent.change(screen.getByLabelText("Natureza"), { target: { value: "transporte" } });
    fireEvent.change(screen.getByLabelText("Serviço"), { target: { value: "transport-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Lançar linha/i }));

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
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);
    await selectOperation();
    fireEvent.click(screen.getByRole("button", { name: /Serviços/i }));
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "depot-1" } });
    fireEvent.change(screen.getByLabelText("Natureza"), { target: { value: "transporte" } });
    fireEvent.change(screen.getByLabelText("Serviço"), { target: { value: "transport-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Lançar linha/i }));

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
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);
    await selectOperation();
    fireEvent.click(screen.getByRole("button", { name: /Serviços/i }));
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "depot-1" } });
    fireEvent.change(screen.getByLabelText("Natureza"), { target: { value: "transporte" } });
    fireEvent.change(screen.getByLabelText("Serviço"), { target: { value: "transport-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Lançar linha/i }));

    await waitFor(() => expect(mocks.operationRefetch).toHaveBeenCalledTimes(1));
    expect(mocks.setQueryData).not.toHaveBeenCalled();
  });

  it("só exclui a unidade depois da confirmação (ADR 0072)", async () => {
    mocks.unitsData = {
      rows: [{ id: "u1", container_number: "MSCU7654321", local_id: "depot-1", condition: "vazio", hand_in_date: "2026-01-01", hand_out_date: "2026-01-05" }],
      count: 1,
    };
    mocks.deleteManualVaziosBooking.mockClear();
    mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);
    await selectOperation();

    fireEvent.click(screen.getByRole("button", { name: "Excluir unidade MSCU7654321" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.deleteManualVaziosBooking).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Excluir unidade MSCU7654321" }));
    await waitFor(() => expect(mocks.deleteManualVaziosBooking).toHaveBeenCalledWith("u1"));
    expect(mocks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ confirmLabel: "Excluir", consequence: expect.any(String) }));
  });

  it("aponta a armazenagem calculada sem linha lançada e lança com 1 clique", async () => {
    mocks.unitsData = {
      rows: [{ id: "u1", local_id: "depot-1", condition: "vazio", hand_in_date: "2026-01-01", hand_out_date: "2026-01-05" }],
      count: 1,
    };
    mocks.armazenagemServicesData = [
      { id: "armaz-1", depot_id: "depot-1", condition: "vazio", natureza: "armazenagem", rate_brl: 25, active: true, name: "Armazenagem" },
    ];
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);
    await selectOperation();
    fireEvent.click(screen.getByRole("button", { name: /Serviços/i }));

    expect(screen.getByText(/Armazenagem pendente de lançamento/i)).toBeTruthy();
    expect(screen.getByText(/VBR · vazio · 5 dia\(s\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Lançar$/i }));

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

  it("aponta quando falta cadastrar o serviço de armazenagem para a condição", async () => {
    mocks.unitsData = {
      rows: [{ id: "u1", local_id: "depot-1", condition: "vazio", hand_in_date: "2026-01-01", hand_out_date: "2026-01-05" }],
      count: 1,
    };
    mocks.armazenagemServicesData = [];
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);
    await selectOperation();
    fireEvent.click(screen.getByRole("button", { name: /Serviços/i }));

    expect(screen.getByText(/sem serviço de armazenagem cadastrado/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Lançar$/i })).toBeNull();
  });

  it("não aponta armazenagem pendente quando a linha já foi lançada", async () => {
    mocks.unitsData = {
      rows: [{ id: "u1", local_id: "depot-1", condition: "vazio", hand_in_date: "2026-01-01", hand_out_date: "2026-01-05" }],
      count: 1,
    };
    mocks.operationData = {
      linhas: [{ id: "line-armaz", local_id: "depot-1", condition: "vazio", quantidade: "4", valor_unitario: "25", service: { natureza: "armazenagem" } }],
    };
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);
    await selectOperation();
    fireEvent.click(screen.getByRole("button", { name: /Serviços/i }));

    expect(screen.queryByText(/Armazenagem pendente de lançamento/i)).toBeNull();
  });

  it("lista as escalas brasileiras da viagem escolhida e grava o código normalizado ao criar", async () => {
    mocks.voyagePortsData = ["BRSSA", "BRVIX"];
    render(<MemoryRouter><EmbarqueVazios /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: /Selecionar viagem/i }));

    const portSelect = (await screen.findByLabelText("Porto de embarque")) as HTMLSelectElement;
    expect([...portSelect.options].map((option) => option.value)).toEqual(["", "BRSSA", "BRVIX"]);

    fireEvent.change(portSelect, { target: { value: "BRVIX" } });
    fireEvent.click(screen.getByRole("button", { name: /^Criar$/i }));

    await waitFor(() =>
      expect(mocks.upsertVaziosExportOperation).toHaveBeenCalledWith({
        voyageId: 179,
        embarkPort: "BRVIX",
      }),
    );
  });
});
