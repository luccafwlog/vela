# 0120 — Padrão visual das planilhas exportadas

Status: aceito — 2026-11-03 (decisão do dono, a partir de três propostas
renderizadas). Implementada em `src/services/exportWorkbook.ts`.

Estende a [ADR 0081](./0081-identidade-visual-unica.md) à planilha que sai
do botão **Exportar** do Vela e do Portal Fwlog. A regra viva está em
[Planilhas exportadas](../identidade-visual.md#planilhas-exportadas).

## Contexto

Toda planilha exportada (B/Ls, Containers, Faturas, Relatórios, Demurrage,
Desbloqueio de CE, Portal, histórico de baixas e as demais) saía como a
biblioteca `@e965/xlsx` escreve por padrão: cabeçalho igual às outras
linhas, colunas na largura padrão cortando Cliente e CNPJ, dinheiro sem
moeda, data como texto e nomes de coluna copiados do código (`TotalBRL`,
`DataPagamento`, `QtdBLs`). O dono considerou o resultado pobre e pediu um
padrão único, com identidade.

A edição comunitária do SheetJS (`@e965/xlsx`) não grava cor, fonte,
congelamento de linha nem filtro; só largura e formato de número. Qualquer
das propostas exigia outra biblioteca para escrever.

Foram apresentadas três propostas cumulativas, renderizadas a partir de
arquivos reais com dados fictícios (Faturas e Containers do Vela, Faturas de
Taxas locais do Portal): **A**, só o cabeçalho azul-marinho e a base;
**B**, com faixa de identidade, linhas alternadas e total; **C**, com faixa
de grupos e a situação em cor.

## Decisão

1. **Nível C em toda exportação.** Faixa de identidade, grupos de colunas
   (onde a exportação os declara), situação em cor pela regra 5, códigos em
   letra monoespaçada, linhas alternadas e linha de total. O padrão vale
   para as 25 exportações do Vela e do Portal e para as que vierem.
2. **"Vela" em dourado na faixa de identidade**, como o nome na barra do
   sistema; no Portal, "Portal Fwlog" em branco sobre o azul da FWLOG. É a
   única aparição do dourado fora da navegação (exceção à regra 7,
   registrada aqui).
3. **Cabeçalho em português**, com espaço e acento: "Total (R$)", "Emissão",
   "Qtd. B/Ls", "Peso bruto (kg)". A planilha que serve de molde para
   reimportar (Programação de navios, Base de Clientes, aba de carga solta
   do manifesto) mantém os cabeçalhos que o importador reconhece e sai
   **plana**: só cabeçalho, larguras e filtro, sem faixa nem total.
4. **Data é data**, não texto: a célula recebe a data do banco e o Excel
   ordena e filtra por ordem cronológica. O dia sai como está gravado; um
   instante sai no dia e na hora locais de quem exporta, como a tela mostra.
5. **Total com soma viva** (`SOMA()`), não número fixo: quem filtra ou apaga
   linhas vê o total acompanhar.
6. **Letra monoespaçada só em container, B/L, CE e lacre** (regra 8), não no
   número da fatura nem no CNPJ.
7. **Um dono.** `src/services/exportWorkbook.ts` escreve toda planilha; cada
   exportação em `src/services/exports.ts` (e o histórico de baixas em
   `reconciliacao.ts`) monta as linhas, o rótulo em português e declara só o
   que o rótulo não diz sozinho (tipo da coluna, grupos, substantivo da
   faixa). Nenhuma tela estiliza a própria planilha.
8. **Biblioteca.** A escrita passa para `exceljs` (MIT), carregado sob
   demanda no clique de Exportar, fora do grafo estático das rotas. A
   leitura das importações continua com `@e965/xlsx`. A neutralização de
   fórmula (`spreadsheetSafe.ts`) continua valendo em valores e cabeçalhos,
   agora dentro do dono.
9. **Rótulo em vez de código cru** nas colunas de revisão e situação
   financeira do B/L (Containers e Manifestos): "Pendente", "Faturado", em
   vez de `pending_review`, `invoiced`. O nome do arquivo não muda.

## Consequências

- Quem usava a planilha numa macro ou fórmula própria pelo nome antigo da
  coluna (`TotalBRL`) ajusta uma vez; os moldes de reimportação não mudam.
- O tipo da coluna é inferido pelo rótulo e pelos valores quando a
  exportação não o declara (`inferColumnType`, marcado como heurística); um
  rótulo novo que ela erra se corrige declarando `types` na exportação, não
  ensinando mais um nome à heurística.
- Calibri e Consolas são as letras da planilha, porque vêm com todo Excel;
  DM Sans e IBM Plex Mono ficam nas telas.
- O chunk de exportação cresce (exceljs é maior que o SheetJS), sem efeito
  no orçamento de carga das rotas, que não o incluem.
- Evidência de implantação: `src/services/__tests__/exportWorkbook.test.ts`
  (contra o exceljs real: faixa, cabeçalho, formatos, cores, total,
  neutralização de fórmula) e `exports.test.ts` (linhas de cada tela).
