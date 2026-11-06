import { describe, expect, it } from "vitest";
import { manualBookingPayload } from "../vaziosExportOperations";

describe("manualBookingPayload", () => {
  it("normaliza o container e mantém o vínculo imutável com a operação", () => {
    expect(
      manualBookingPayload({
        operationId: "operation-1",
        voyageId: 39,
        manifestId: "manifest-1",
        containerNumber: " ms cu 1234567 ",
        containerType: "40HC",
        localId: "depot-1",
        condition: "vazio",
        handInDate: "2026-07-02",
        handOutDate: "2026-07-03",
        movementDate: "2026-07-04",
        pod: " cnsha ",
      }),
    ).toEqual({
      operation_id: "operation-1",
      voyage_id: 39,
      manifest_id: "manifest-1",
      container_number: "MSCU1234567",
      container_type: "40HC",
      local_id: "depot-1",
      condition: "vazio",
      hand_in_date: "2026-07-02",
      hand_out_date: "2026-07-03",
      movement_date: "2026-07-04",
      pod: "CNSHA",
    });
  });

  it("rejeita container inválido antes de gravar", () => {
    expect(() =>
      manualBookingPayload({
        operationId: "o",
        voyageId: 1,
        manifestId: "m",
        containerNumber: "invalido",
        localId: "d",
        condition: "vazio",
        pod: "CNSHA",
      }),
    ).toThrow("Container inválido");
  });
});
