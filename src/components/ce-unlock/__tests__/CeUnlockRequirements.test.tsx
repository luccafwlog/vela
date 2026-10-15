// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CeUnlockRequirements } from "../CeUnlockRequirements";
it("cobertura VIP satisfaz documentos e mantém entrega física pendente", () => {
  render(
    <CeUnlockRequirements
      item={{
        source: "vip_annual",
        termo: true,
        procuracao: true,
        paid: true,
        delivered: false,
      }}
    />,
  );
  expect(screen.getAllByText("Aprovado — anual VIP")).toHaveLength(2);
  expect(screen.getByText("Aguardando entrega")).toBeTruthy();
  expect(screen.getByText("Pagamento confirmado")).toBeTruthy();
});

it("B/L isento diz Isento, não Pagamento confirmado", () => {
  render(<CeUnlockRequirements item={{ source: "request", termo: false, procuracao: false, paid: true, paid_exempt: true, delivered: false }} />);
  expect(screen.getByText("Isento")).toBeTruthy();
  expect(screen.queryByText("Pagamento confirmado")).toBeNull();
});
