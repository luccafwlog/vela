# 0018 — Seleção de viagem padronizada em busca preditiva (Combobox)

> **Situação atual (2026-10-15).** A decisão continua valendo: toda seleção de viagem usa o `VoyageCombobox`, obrigatório nas importações da decisão 3 (Baplie, Veículos, Vazios, B/L) e limpável nos filtros.
> A importação de CE Mercante não está na lista da decisão 3: nela a viagem é um recorte do arquivo, não uma declaração, e o campo é limpável (decisão do dono de 2026-10-15, na revisão da PR 954). O lote já fica preso a uma viagem e rota pelo Manifesto Mercante: o banco recusa a planilha com B/Ls de mais de uma viagem ou rota (migration `181`). Com a viagem escolhida, a tela importa só as linhas dela; sem viagem, a planilha entra inteira, como em `/bls` sem filtro.
> Implementada: desde o item B26 do [plano de correções](../archive/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md) ([ADR 0083](./0083-decisoes-da-revisao-geral-da-documentacao.md), item 26), as importações de B/L e de CE Mercante abertas na página da viagem, e o Embarque de Vazios aberto por ela, vêm semeados com a viagem e continuam editáveis (decisão 2).
> Regra vigente em [Viagens](../modules/viagens.md), seções "Anatomia das telas" e "Catálogo de ações".

Status: aceito — 2026-07-01

## Contexto

A seleção de viagem estava espalhada e inconsistente pela aplicação: cada tela
que precisava apontar uma viagem trazia o seu próprio `<select>` cru (ex.:
`Baplie.tsx`, `Veiculos.tsx`, `VaziosImportacao.tsx`, filtros de `Containers.tsx`
e `Demurrage.tsx`), listando todas as viagens num dropdown. Com o volume de
viagens, rolar um `<select>` até achar o navio certo é lento e propenso a erro.

Ao tornar o import de B/L um caminho primário de ingestão ([ADR 0017](./0017-bl-fonte-ingestao-correcao-autoridade-compartilhada.md),
nota editorial de 2026-07-01), o operador passou a **declarar navio + viagem**
em todo import. O padrão desejado — e que já vale para o resto do sistema — é
**digitar o navio e receber sugestões** de `NAVIO / número`, em vez de caçar num
dropdown.

O componente já existe: `src/components/ui/Combobox.tsx` é um typeahead com
debounce, navegação por teclado e `fetchOptions`/`onSelectOption`. Ele já é usado
em outros contextos, mas **não** na seleção de viagem.

## Decisão

1. **Toda seleção de viagem usa o `Combobox`**, buscando por navio e sugerindo
   `NAVIO / número` (fonte `voyage-options`). Substitui os `<select>` de viagem
   nas ~14 telas que os têm.
2. **Pré-semeado editável no contexto.** Onde há viagem de contexto (ficha do
   B/L, página da viagem), o campo abre semeado com ela via `initialValue` — um
   default de conveniência, **não um valor travado**. O operador pode reescrever
   e buscar outra.
3. **Filtro vs. seletor obrigatório, mesmo componente.**
   - **Imports** (Baplie, Veículos, Vazios, B/L): busca **obrigatória**, uma só
     viagem, sem opção de vazio.
   - **Filtros de listagem** (Containers, Demurrage, …): busca **limpável** —
     apagar o texto equivale a "todas as viagens", preservando o comportamento
     atual do dropdown.

## Consequências

- Diff amplo por natureza: toca todas as telas de seleção de viagem. O rollout é
  a razão desta ADR existir — um dev futuro veria "todo `<select>` de viagem
  virou typeahead" e precisa do porquê.
- O import de B/L consome o mesmo componente; some o auto-match silencioso de
  viagem (`resolveVoyageId`), coerente com a ADR 0017 (o arquivo valida a viagem
  declarada, não a resolve).
- Estende a [0003](./0003-spa-react-rotas-lazy-camadas-page-hook-service.md)
  (camadas de UI) padronizando um controle compartilhado; não revoga nada.

## Alternativas consideradas

- **Aplicar a busca só no import de B/L.** Rejeitada: mantém o resto do sistema
  no `<select>` inconsistente; o pedido explícito é o padrão valer em todo o
  sistema.
- **Manter os `<select>`.** Rejeitada: não escala com o número de viagens e não
  entrega o fluxo "digita navio → sugere viagem".
- **Transformar também os filtros em busca obrigatória.** Rejeitada: perderia o
  "todas as viagens", que é um estado válido e usado nas listagens.
