// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AgencyReportDocument, buildAgencyReportPrintFilename } from "../AgencyReportDocument";
import { formatBRL } from "../../../lib/utils";
import { DOC_ACCENT, DOC_NAVY, DOC_ZEBRA } from "../../shared/invoiceFormat";

afterEach(cleanup);

it("imprime o snapshot fechado nos blocos e matrizes do modelo real", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: {
          carrierName: "Armador teste",
          voyageLabel: "NAVIO TESTE / 01E",
          port: "BRVIX",
          terminal: "TVV",
          schedule: {
            ata: "2026-07-19",
            atb: "2026-07-19",
            atd: "2026-07-20",
            rtw: 2,
          },
        },
        sections: {
          cargaSolta: {
            bls: 2,
            machines: 3,
            packages: 12,
            weightTon: 6,
            cbm: 20,
          },
          granito: { bls: 2, blocks: 14, weightTon: 35.5 },
          cargaDescarregada: {
            rows: { "40HC": { carga_geral: 3, imo: 1 } },
            totals: { carga_geral: 3, imo: 1 },
          },
          vaziosDescarregados: {
            rows: { "20DC": { vazio_cama: 2 } },
            totals: { vazio_cama: 2 },
          },
          veiculos: [{ brand: "BYD", blCount: 2, vinCount: 3 }],
          vehicleLocations: { BYD: ["Pátio Alfa"] },
          vaziosEmbarcados: [
            { type: "40HC", condition: "EMPTY", localLabel: "VBR", quantity: 4 },
          ],
          directEmbarkCount: 1,
          depots: ["VBR"],
          operation: {},
          signoffs: [
            { section: "operacao_patio", observation: "Storage conferido com o depot." },
          ],
          costs: {
            total: 250,
            serviceLines: [
              {
                id: "line-1",
                service: { name: "Bundle Composition" },
                local: { name: "VBR" },
                destino: null,
                local_id: "d1",
                service_id: "s1",
                quantidade: 2,
                percentual: 100,
                valor_unitario: 125,
              },
            ],
          },
          vaziosUnidades: [
            {
              id: "unit-1",
              container_number: "ABCD1234567",
              container_type: "40HC",
              local_id: "d1",
              local: { name: "VBR" },
              condition: "vazio",
              hand_in_date: "2026-07-01",
              hand_out_date: "2026-07-05",
            },
          ],
          storage: { containers: 4, days: 8 },
        },
        occurrences: [
          {
            id: "occ-1",
            body: "Atracação concluída.",
            department: "operacoes",
            created_at: "2026-07-20",
          },
        ],
      }}
    />,
  );

  for (const heading of [
    "Carga solta",
    "Carga carregada",
    "Matriz de descarga",
    "Vazios descarregados",
    "Container com veículo",
    "Embarque de vazios",
    "Linhas de serviço do embarque",
    "Anexo — unidades que geraram armazenagem",
    "Storage",
    "Observações por seção",
  ])
    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();

  expect(
    screen.getByRole("table", { name: "Matriz de descarga" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("table", { name: "Vazios descarregados" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("table", { name: "Embarque de vazios" }),
  ).toBeTruthy();
  expect(screen.getByText("Pátio Alfa")).toBeTruthy();
  expect(
    screen.getByRole("table", { name: "Operação de vazios" }).textContent,
  ).toContain("Embarque direto1");
  expect(
    screen.getByRole("table", { name: "Operação de vazios" }).textContent,
  ).toContain("Embarque direto1");
  expect(screen.getByText("35,5 ton")).toBeTruthy();
  expect(screen.getByText("ATB")).toBeTruthy();
  expect(
    screen.getByRole("table", { name: "Unidades que geraram armazenagem" })
      .textContent,
  ).toContain("VBR");
  expect(screen.getByText("Restow")).toBeTruthy();
  expect(screen.getByText("Storage conferido com o depot.")).toBeTruthy();
  expect(screen.queryByText("OS")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Overtime" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Ocorrências" })).toBeNull();
});

// Task 8 do ADR 2026-07-31: o total impresso da linha vem de `total`
// (calculado por totalLinha em agencyDepartureReport.ts), não mais de uma
// fórmula reimplementada que aplicava o percentual legado mesmo em
// armazenagem. Um snapshot pós-Task 8 já traz o campo pronto.
it("imprime o total pronto (`total`) da linha de serviço, ignorando o percentual legado de uma linha de armazenagem", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
        sections: {
          costs: {
            total: 1000,
            serviceLines: [
              {
                id: "line-1",
                service: { name: "Armazenagem" },
                local: { name: "VBR" },
                destino: null,
                local_id: "d1",
                service_id: "s1",
                quantidade: 10,
                percentual: 50,
                valor_unitario: 100,
                total: 1000,
              },
            ],
          },
        },
        occurrences: [],
      }}
    />,
  );

  const table = screen.getByRole("table", { name: "Linhas de serviço" });
  expect(table.textContent).toContain(formatBRL(1000));
  expect(table.textContent).not.toContain(formatBRL(500));
});

// Snapshot fechado ANTES da Task 8: sem o campo `total`, cai na fórmula
// antiga (registro histórico, sem recálculo sobre dado já congelado).
it("cai na fórmula antiga quando o snapshot fechado é anterior à Task 8 (sem o campo `total`)", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
        sections: {
          costs: {
            total: 250,
            serviceLines: [
              {
                id: "line-1",
                service: { name: "Bundle Composition" },
                local: { name: "VBR" },
                destino: null,
                local_id: "d1",
                service_id: "s1",
                quantidade: 2,
                percentual: 100,
                valor_unitario: 125,
              },
            ],
          },
        },
        occurrences: [],
      }}
    />,
  );

  const table = screen.getByRole("table", { name: "Linhas de serviço" });
  expect(table.textContent).toContain(formatBRL(250));
});

// O snapshot gravado por VoyageAgencyReportTab põe os sign-offs na chave de
// topo, não dentro de `sections`: é dessa forma que a Observação precisa sair
// impressa.
it("imprime a Observação da seção com os sign-offs na chave de topo do snapshot", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
        sections: {},
        occurrences: [],
        signoffs: [
          { section: "datas", state: "confirmed", observation: "Atracação com 4h de espera." },
          { section: "veiculos", state: "nothing_to_declare", observation: null },
        ],
      }}
    />,
  );

  expect(screen.getByText("Atracação com 4h de espera.")).toBeTruthy();
});

// Task 5 do ADR 2026-07-31: cada seção impressa mostra estado + autor + data
// da resolução; um bloco sem dado (aqui, Vazios descarregados) não é
// impresso, mas a seção continua saindo com a resolução; o documento fecha
// com os três sign-offs departamentais.
it("imprime resolução de seção com autor e data, omite bloco sem dado e fecha com os três sign-offs departamentais", () => {
  const { container } = render(
    <AgencyReportDocument
      actorNames={{ "user-doc": "Ana Documentação", "user-ops": "Beto Operações", "user-eqp": "Carla Equipamentos" }}
      snapshot={{
        header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
        sections: {
          cargaDescarregada: {
            rows: { "40HC": { carga_geral: 3 } },
            totals: { carga_geral: 3 },
          },
          // Vazios descarregados sem nenhum item: o bloco não deve sair
          // impresso, só a resolução da seção.
          vaziosDescarregados: { rows: {}, totals: {} },
        },
        occurrences: [],
        signoffs: [
          { section: "carga_descarregada", state: "confirmed", signed_by: "user-doc", signed_at: "2026-07-20" },
          { section: "vazios_descarregados", state: "nothing_to_declare", signed_by: "user-doc", signed_at: "2026-07-20" },
        ],
        departmentSignoffs: [
          { department: "documentacao", signed_by: "user-doc", signed_at: "2026-07-20" },
          { department: "operacoes", signed_by: "user-ops", signed_at: "2026-07-21" },
          { department: "equipamentos", signed_by: "user-eqp", signed_at: "2026-07-21" },
        ],
      }}
    />,
  );

  expect(
    screen.getByRole("table", { name: "Matriz de descarga" }).textContent,
  ).toContain("40HC");
  expect(screen.queryByRole("table", { name: "Vazios descarregados" })).toBeNull();
  const resolutions = [...container.querySelectorAll(".agency-report-document__resolution")].map(
    (node) => node.textContent,
  );
  // 'carga_descarregada' é a `section` de dois blocos impressos (Carga solta
  // e Matriz de descarga) — a resolução some do segundo para não repetir a
  // mesma linha duas vezes seguidas no papel.
  expect(resolutions.filter((text) => text?.match(/Confirmado — Ana Documentação em/)).length).toBe(1);
  expect(resolutions.some((text) => text?.match(/Nada a declarar — Ana Documentação em/))).toBe(true);

  const signoffTable = screen.getByRole("table", { name: "Assinaturas departamentais" });
  expect(signoffTable.textContent).toContain("Ana Documentação");
  expect(signoffTable.textContent).toContain("Beto Operações");
  expect(signoffTable.textContent).toContain("Carla Equipamentos");
});

// 'vazios_embarcados' é a `section` de cinco blocos impressos (Embarque de
// vazios, Operação de vazios, Linhas de serviço, Anexo, Storage) desde a fusão
// da ADR 0036 — sem a deduplicação, a mesma resolução sairia repetida cinco
// vezes seguidas.
it("imprime a resolução de 'vazios_embarcados' uma única vez, mesmo aparecendo em cinco blocos", () => {
  const { container } = render(
    <AgencyReportDocument
      actorNames={{ "user-eqp": "Carla Equipamentos" }}
      snapshot={{
        header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
        sections: {},
        occurrences: [],
        signoffs: [
          { section: "vazios_embarcados", state: "confirmed", signed_by: "user-eqp", signed_at: "2026-07-22" },
        ],
      }}
    />,
  );

  const resolutions = [...container.querySelectorAll(".agency-report-document__resolution")].map(
    (node) => node.textContent,
  );
  expect(resolutions.filter((text) => text?.match(/Confirmado — Carla Equipamentos em/)).length).toBe(1);
  // Sem linha de 'operacao_patio' no snapshot, o bloco de registro histórico
  // não aparece — nada a preservar.
  expect(screen.queryByText(/resolução registrada no fechamento/)).toBeNull();
});

// Snapshot fechado ANTES da ADR 0036 guarda uma resolução própria de
// 'operacao_patio'. Ela não é reescrita nem descartada: sai como registro do
// fechamento, em vez de o impresso atribuir a assinatura de uma parte à outra.
it("imprime a resolução legada de 'operacao_patio' como registro do fechamento", () => {
  render(
    <AgencyReportDocument
      actorNames={{ "user-eqp": "Carla Equipamentos", "user-doc": "Ana Documentação" }}
      snapshot={{
        header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
        sections: {},
        occurrences: [],
        signoffs: [
          { section: "vazios_embarcados", state: "confirmed", signed_by: "user-doc", signed_at: "2026-07-22" },
          { section: "operacao_patio", state: "nothing_to_declare", signed_by: "user-eqp", signed_at: "2026-07-23" },
        ],
      }}
    />,
  );

  const legacy = screen
    .getByRole("heading", { name: /Opera.*o de p.*tio — resolu.*o registrada no fechamento/ })
    .closest("section")!;
  expect(legacy.textContent).toContain("Nada a declarar");
  expect(legacy.textContent).toContain("Carla Equipamentos");
});

// A observação saía prefixada pela chave crua da seção ("carga_descarregada:"),
// que é contrato de banco, não texto para o Financeiro ler.
it("prefixa cada observação com o rótulo pt-BR da seção, não com a chave", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
        sections: {},
        occurrences: [],
        signoffs: [
          { section: "carga_descarregada", observation: "Dois containers avariados." },
          { section: "datas", observation: "ATB confirmado por rádio." },
          { section: "operacao_patio", observation: "Storage conferido com o depot." },
        ],
      }}
    />,
  );

  const observacoes = screen.getByRole("heading", { name: "Observações por seção" }).closest("section")!;
  expect(observacoes.textContent).toContain("Carga descarregada:");
  expect(observacoes.textContent).toContain("Escala:");
  // Seção aposentada continua legível no registro histórico.
  expect(observacoes.textContent).toContain("Operação de pátio:");
  expect(observacoes.textContent).not.toContain("carga_descarregada");
});

// Snapshot legado (anterior à Task 5) nunca gravou `departmentSignoffs`: o
// impresso precisa sair sem lançar e sem inventar um bloco de assinaturas.
it("imprime snapshot legado sem departmentSignoffs sem lançar e sem bloco de assinaturas", () => {
  expect(() =>
    render(
      <AgencyReportDocument
        snapshot={{
          header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
          sections: {},
          occurrences: [],
          signoffs: [],
        }}
      />,
    ),
  ).not.toThrow();

  expect(screen.queryByRole("table", { name: "Assinaturas departamentais" })).toBeNull();
});

// Task 4 do ADR 0039: reabertura com justificativa entra no impresso (pedido
// explícito do usuário), mas nenhum marco de prazo — deadline, veredito
// (no prazo/atrasado) ou contagem de dias — pode sair no papel (ADR 0039:
// "cumprimento e atraso são medida interna da agência e vivem só nas telas").
it("imprime a reabertura departamental com justificativa e nenhum marco de prazo", () => {
  render(
    <AgencyReportDocument
      actorNames={{ "user-ops": "Beto Operações" }}
      snapshot={{
        header: {
          carrierName: "Armador teste",
          voyageLabel: "NAVIO TESTE / 01E",
          port: "BRVIX",
          schedule: { atd: "2026-07-20" },
          unifiedAtd: "2026-07-20",
          atdRegisteredAt: "2026-07-20T18:00:00Z",
          atdSource: "pod",
          deadlineDate: "2026-07-23",
        },
        sections: {},
        occurrences: [],
        signoffs: [],
        departmentSignoffs: [
          {
            department: "operacoes",
            signed_by: "user-ops",
            signed_at: "2026-07-24",
            reopenings: [
              {
                changed_at: "2026-07-22T10:00:00Z",
                changed_by: "user-ops",
                justification: "Reaberto para corrigir a contagem de containers.",
              },
            ],
          },
        ],
      }}
    />,
  );

  const signoffTable = screen.getByRole("table", { name: "Assinaturas departamentais" });
  expect(signoffTable.textContent).toContain("Beto Operações");
  expect(signoffTable.textContent).toContain("Reaberto para corrigir a contagem de containers.");

  // Nenhum veredito, cor ou contagem de dias de prazo sai no papel — só datas
  // de assinatura (e, agora, a reabertura com justificativa).
  expect(screen.queryByText("2026-07-23")).toBeNull();
  expect(screen.queryByText("23/07/2026")).toBeNull();
  expect(screen.queryByText(/no prazo/i)).toBeNull();
  expect(screen.queryByText(/atrasad/i)).toBeNull();
  expect(screen.queryByText(/vencido/i)).toBeNull();
  expect(screen.queryByText(/dias? decorrido/i)).toBeNull();
  expect(screen.queryByText(/prazo de conclus/i)).toBeNull();
});

// Snapshot fechado ANTES da Task 4 nunca gravou `reopenings` por linha: o
// impresso precisa sair sem lançar e sem coluna de reaberturas.
it("imprime departmentSignoffs legado sem `reopenings` sem lançar e sem coluna de reaberturas", () => {
  expect(() =>
    render(
      <AgencyReportDocument
        actorNames={{ "user-doc": "Ana Documentação" }}
        snapshot={{
          header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
          sections: {},
          occurrences: [],
          signoffs: [],
          departmentSignoffs: [
            { department: "documentacao", signed_by: "user-doc", signed_at: "2026-07-20" },
          ],
        }}
      />,
    ),
  ).not.toThrow();

  expect(screen.queryByRole("columnheader", { name: "Reaberturas" })).toBeNull();
});

// Task 1 do ADR 2026-07-31: carga solta em transbordo, separada da própria da
// escala; precisa aparecer no impresso, não só na aba.
it("imprime a carga solta em transbordo separada da própria da escala", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
        sections: {
          cargaSolta: {
            bls: 0,
            machines: 0,
            packages: 0,
            weightTon: 0,
            cbm: 0,
            transshipment: { bls: 2, machines: 3, packages: 10, weightTon: 15, cbm: 25 },
          },
        },
        occurrences: [],
        signoffs: [],
      }}
    />,
  );

  expect(screen.getByRole("heading", { name: "Carga solta" })).toBeTruthy();
  expect(
    screen.getByRole("table", { name: "Carga solta em transbordo" }).textContent,
  ).toContain("B/Ls em transbordo2");
});

// Snapshot legado (anterior a este fix) nunca gravou `cargaSolta.transshipment`:
// o impresso precisa sair sem lançar e sem bloco de transbordo.
it("imprime snapshot legado sem cargaSolta.transshipment sem lançar", () => {
  expect(() =>
    render(
      <AgencyReportDocument
        snapshot={{
          header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
          sections: { cargaSolta: { bls: 1, machines: 0, packages: 0, weightTon: 1, cbm: 1 } },
          occurrences: [],
          signoffs: [],
        }}
      />,
    ),
  ).not.toThrow();

  expect(screen.queryByRole("table", { name: "Carga solta em transbordo" })).toBeNull();
});

// Plano 2026-08-08: o impresso do ADR usa a linguagem visual da fatura de
// taxas locais — cabeçalho de tabela navy com texto branco e zebra nas linhas.
// A barra de total âmbar da listagem do operado (ADR 0035, CONTEXT.md) fica no
// topo da tabela, como já era antes do plano.
it("imprime as tabelas no padrão visual da fatura (cabeçalho navy, zebra e barra de total no topo)", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: {
          carrierName: "Armador teste",
          voyageLabel: "NAVIO TESTE / 01E",
          port: "BRVIX",
          terminal: "TVV",
          schedule: { ata: "2026-07-19", atb: "2026-07-19", atd: "2026-07-20", rtw: 2 },
        },
        sections: {
          cargaDescarregada: {
            rows: { "40HC": { carga_geral: 3 }, "20DC": { imo: 1 } },
            totals: { carga_geral: 3, imo: 1 },
          },
        },
        occurrences: [],
        signoffs: [],
      }}
    />,
  );

  // Fatos da escala no bloco de metadados do kit (labelCell/cell).
  const facts = screen.getByRole("table", { name: "Escala" });
  expect(facts.textContent).toContain("Armador teste");
  expect(facts.textContent).toContain("TVV");

  // jsdom normaliza a cor inline para rgb() — o teste compara pelo mesmo token
  // da fatura, convertido, em vez de fixar a string do navegador.
  const rgb = (hex: string) =>
    `rgb(${[1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)).join(", ")})`;

  const table = screen.getByRole("table", { name: "Matriz de descarga" });
  const head = table.querySelector("thead tr") as HTMLElement;
  expect(head.style.background).toBe(rgb(DOC_NAVY));
  expect(head.style.color).toBe("white");

  const bodyRows = [...table.querySelectorAll("tbody tr")] as HTMLElement[];
  expect(bodyRows[1].style.background).toBe(rgb(DOC_ZEBRA));

  // Total no topo — ADR 0035 e CONTEXT.md exigem o total antes das combinações.
  const totalRow = bodyRows[0];
  expect(totalRow.style.background).toBe(rgb(DOC_ACCENT));
  expect(totalRow.textContent).toContain("TOTAL:");
  // 3 + 1 = 4 unidades operadas, somadas na barra do topo.
  expect(totalRow.textContent).toContain("4");
});

// ADR por terminal: cada terminal responde por parte das frentes, entao o
// impresso do outro chega com varias seções vazias.
it("nao imprime faixa de seção sem dado e sem resolução", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: {
          carrierName: "Armador teste",
          voyageLabel: "NAVIO TESTE / 01E",
          port: "BRVIX",
          terminalCode: "TVV",
          terminal: "Terminal de Vila Velha",
          schedule: { ata: "2026-07-19", atb: "2026-07-19", atd: "2026-07-20", rtw: null },
        },
        sections: { cargaSolta: { bls: 1, machines: 0, packages: 0, weightTon: 125, cbm: 80 } },
        signoffs: [{ section: "carga_descarregada", state: "nothing_to_declare", signed_by: "u1", signed_at: "2026-07-21T10:00:00Z" }],
      }}
      actorNames={{ u1: "Ana Ribeiro" }}
    />,
  );

  // "Carga solta" carrega a resolução da seção; "Matriz de descarga" e o
  // segundo bloco da mesma seção e, sem combos, nao tem nada a imprimir.
  expect(screen.getByRole("heading", { name: "Carga solta" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Matriz de descarga" })).toBeNull();
});

it("distingue seção fora do escopo do terminal de nada a declarar", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: {
          carrierName: "Armador teste",
          voyageLabel: "NAVIO TESTE / 01E",
          port: "BRVIX",
          terminalCode: "TVV",
          terminalScope: { vazios_embarcados: { assigned: false } },
          schedule: { ata: "2026-07-19", atb: "2026-07-19", atd: "2026-07-20", rtw: null },
        },
        sections: {},
        signoffs: [{ section: "vazios_embarcados", state: "nothing_to_declare", signed_by: "u1", signed_at: "2026-07-21T10:00:00Z" }],
      }}
      actorNames={{ u1: "Ana Ribeiro" }}
    />,
  );

  expect(screen.getByRole("heading", { name: "Embarque de vazios" })).toBeTruthy();
  expect(screen.getByText("Sem frente atribuída a este terminal")).toBeTruthy();
  expect(screen.queryByText("Nada a declarar — Ana Ribeiro em 21/07/2026")).toBeNull();
});

it("imprime Restow vazio como travessao, nao como zero", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: {
          carrierName: "Armador teste",
          voyageLabel: "NAVIO TESTE / 01E",
          port: "BRVIX",
          terminalCode: "PORTMAC",
          schedule: { ata: "2026-07-19", atb: "2026-07-23", atd: null, rtw: null },
        },
        sections: {},
      }}
      actorNames={{}}
    />,
  );
  const escala = screen.getByRole("table", { name: "Escala" });
  const restowRow = [...escala.querySelectorAll("tr")].find((row) => row.textContent?.includes("Restow"))!;
  expect(restowRow.textContent).toContain("—");
  expect(restowRow.textContent).not.toContain("0");
});

it("troca a barra do rotulo da viagem no nome do arquivo impresso", () => {
  expect(
    buildAgencyReportPrintFilename({
      header: { voyageLabel: "COSCO SHIPPING ARIES / 088E", port: "BRVIX", terminalCode: "TVV" },
    }),
  ).toBe("ADR - COSCO SHIPPING ARIES - 088E - BRVIX - TVV.pdf");
})

// Natureza (IMO/OOG/carga geral) e destino são eixos independentes: o
// transbordo saiu da matriz e viaja no snapshot como `cargaDescarregada.destino`.
// Sem imprimir esse par, o ADR fechado perderia um número que a aba mostra.
it("imprime o destino dos containers descarregados quando o snapshot traz o split", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
        sections: {
          cargaDescarregada: {
            rows: { "40HC": { carga_geral: 3, imo: 1 } },
            totals: { carga_geral: 3, imo: 1 },
            destino: { destinoFinal: 3, transbordo: 1 },
          },
        },
      }}
      actorNames={{}}
    />,
  );

  const destino = screen.getByRole("table", { name: "Destino dos containers descarregados" });
  expect(destino.textContent).toContain("Destino final");
  expect(destino.textContent).toContain("Em transbordo");
  const transbordo = [...destino.querySelectorAll("tr")].find((row) => row.textContent?.includes("Em transbordo"))!;
  expect(transbordo.textContent).toContain("1");
});

// Snapshot fechado antes da separação não tem `destino`: nada extra é impresso
// (o transbordo dele continua saindo como categoria da própria matriz).
it("não inventa bloco de destino em snapshot fechado antes da separação", () => {
  render(
    <AgencyReportDocument
      snapshot={{
        header: { carrierName: "Armador teste", voyageLabel: "NAVIO TESTE / 01E", port: "BRVIX" },
        sections: {
          cargaDescarregada: { rows: { "40HC": { transbordo: 2 } }, totals: { transbordo: 2 } },
        },
      }}
      actorNames={{}}
    />,
  );

  expect(screen.queryByRole("table", { name: "Destino dos containers descarregados" })).toBeNull();
});
