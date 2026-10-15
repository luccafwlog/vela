import { describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock("../supabase", () => ({ supabase: { rpc: rpcMock } }));

import { createManualVaziosBooking, deleteManualVaziosBooking, updateManualVaziosBooking } from "../vaziosExportOperations";

describe("createManualVaziosBooking", () => {
  it("cria manifesto e unidade na mesma RPC", async () => {
    rpcMock.mockResolvedValue({ error: null });

    await createManualVaziosBooking({
      operationId: "operation-1",
      voyageId: 39,
      uploadedBy: "user-1",
      containerNumber: "MSCU1234567",
      localId: "depot-1",
      condition: "vazio",
      handInDate: "2026-07-02",
      handOutDate: "2026-07-03",
    });

    expect(rpcMock).toHaveBeenCalledWith(
      "create_manual_vazios_booking",
      expect.objectContaining({
        p_operation_id: "operation-1",
        p_voyage_id: 39,
        p_uploaded_by: "user-1",
        p_container_number: "MSCU1234567",
      }),
    );
  });

  it("exclui pela RPC que tambem limpa manifesto manual vazio", async () => {
    rpcMock.mockResolvedValue({ error: null });

    await deleteManualVaziosBooking("booking-1", "lançada por engano");

    expect(rpcMock).toHaveBeenCalledWith(
      "delete_manual_vazios_booking",
      { p_booking_id: "booking-1", p_reason: "lançada por engano" },
    );
  });

  it("edita pela RPC que preserva as validacoes do CRUD manual", async () => {
    rpcMock.mockResolvedValue({ error: null });

    await updateManualVaziosBooking("booking-1", {
      containerNumber: "MSCU1234567",
      localId: "depot-1",
      condition: "vazio",
      handInDate: "2026-07-02",
      handOutDate: "2026-07-03",
    });

    expect(rpcMock).toHaveBeenCalledWith("update_manual_vazios_booking", expect.objectContaining({
      p_booking_id: "booking-1",
      p_container_number: "MSCU1234567",
      p_local_id: "depot-1",
    }));
  });
});
