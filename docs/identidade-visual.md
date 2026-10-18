# Identidade visual do Vela e do Portal Fwlog

Fonte canônica da aparência dos dois produtos, decidida pelo responsável em
2026-10-13 ([ADR 0081](adr/0081-identidade-visual-unica.md)). Vale para as telas
atuais, que migram tela a tela, e para toda tela nova, que já nasce assim.
Substitui o "Contrato visual" da etapa 00 da campanha de revisão visual
([plano arquivado](archive/plans/2026-10-07-revisao-visual-ux-prompts.md)).

O problema que a identidade resolve: quem usa precisava **caçar a informação**,
porque os assuntos não estavam separados e o que importa não se destacava.

## O que é fixo e o que se ajusta

- **Fixo em todas as telas:** cores, letra, fundo, cabeçalho de tabela, o
  formato do bloco com título, a faixa de identidade da ficha, a faixa de
  próxima ação, a forma dos botões e a forma de mostrar estado e ausência.
- **Ajustado tela a tela, com aprovação do responsável:** quais blocos a tela
  tem, a ordem, qual é o dado principal de cada bloco, quais colunas a tabela
  mostra e qual grupo vem primeiro.
- **Quando uma tela pede algo que as regras não permitem,** a regra muda neste
  documento e passa a valer para todas. Não há exceção por tela.

## As nove regras

| # | Regra | Como se aplica |
|---|---|---|
| 1 | **Um assunto, um bloco** | Cada grupo de informação é um `Block`: superfície branca com o título numa faixa azulada. Dois assuntos não dividem a mesma caixa separados só por uma linha fina. |
| 2 | **Todo bloco tem um dado principal** | Um `LeadValue` maior e em negrito (o navio, o CE, o Cliente, "0 de 2 devolvidos"). O resto é apoio em `FactList`/`Fact`: rótulo cinza em cima, valor embaixo. |
| 3 | **Lugar fixo para cada coisa** | Ficha: `IdentityBand`, `NextAction` (só onde a tela aprovada a usa, como a ficha do B/L), situação (trilhos), abas, blocos. Lista: título e ações, cartões (de total ou que filtram, quando a tela precisa deles), filtros, tabela. Sempre nessa ordem. |
| 4 | **Ausência não faz barulho** | Falta de dado é `NoValue` ("—" discreto, com significado para leitor de tela). Coluna sem nenhum dado sai da tabela, com uma nota. Zero conhecido continua escrito ("Nenhuma", "R$ 0,00"). Nunca "X" ou o mesmo texto em toda linha. |
| 5 | **Cor só para o que pede ação** | Vermelho bloqueia ou venceu, âmbar aguarda, verde concluiu, azul informa; sempre com texto. Uma pendência aparece uma vez, no bloco do seu assunto (Portal sem conta no bloco Portal, Demurrage vencida no bloco do saldo); a `NextAction` só existe onde a tela aprovada a pediu (ficha do B/L), e nunca repete o que um bloco já diz. Em lista, cada pendência de uma linha aparece uma vez só, na coluna em que se resolve (Cliente sem vínculo na coluna Cliente, taxa parada na coluna Taxas locais), sem um aviso genérico repetindo o mesmo fato. Em tabela, a situação é texto simples, sem selo colorido: âmbar só no que pede ação (saldo maior que zero, em curso), cinza no que encerrou sem efeito (cancelada, isenta), "Paga" com o ícone ✓ verde antes da palavra em toda tela que mostra paga, e "Consolidada" como ícone pequeno de pilha ao lado do número (o nome aparece ao passar o mouse), não como selo. O resto fica em tinta normal. |
| 6 | **Tabela padrão** | Toda `table.app-table`: títulos dos grupos, cabeçalhos e células centralizados, números inclusive. Texto longo que pode passar do limite da coluna (nome do Cliente ou do consignatário, descrição) fica à esquerda com `.app-table__text`, para o começo do valor aparecer; o que não cabe vira "…", com o valor inteiro no `title`. Texto corrido que é o próprio conteúdo da linha e não aparece inteiro em outro lugar (mensagem do alerta, observação, descrição do item da fatura, nome da taxa) quebra linha com `.app-table__text--wrap`, sem "…". Pilha de selo ou número (`.app-table__cell-stack--center`) continua centralizada. Célula que ocupa a linha inteira (`colspan`: linha aberta, aviso, carregando) segue à esquerda. **Tabela limpa** (decisão de 2026-10-14, aplicada tela a tela pelos lotes): uma linha de título só, sem faixa de grupos; nada escrito embaixo do valor da célula; sem quebra de linha nem "…" em dado curto (número, data, valor, situação). Quando a linha não cabe, uma coluna sai da tabela e o dado fica no detalhe ou na linha aberta; qual coluna sai é decisão da tela. O identificador que abre o registro é o link da linha, sem botão "Detalhes" ao lado. Até a tela ser revista, colunas do mesmo grupo ficam sob uma faixa própria (`th.app-table__group`) com o título centralizado e um traço embaixo. Não há linha vertical entre colunas. O que decide vem primeiro. Tabela dentro de tabela (linha aberta, atracações) tem cabeçalho claro, na cor da faixa dos blocos, para não competir com a de fora; vale sozinho dentro de `tr[data-row-detail]` ou de outra `.app-table`, e com `app-table--nested` nos demais casos. |
| 7 | **Estrutura azul-marinho, fundo neutro** | Barra, cabeçalho de tabela (menos a tabela dentro de tabela, regra 6), faixa de identidade e aba ativa em azul-marinho; as abas não selecionadas ficam sombreadas na cor da faixa dos blocos (`--app-strip`), para não ficarem soltas (decisão de 2026-10-16, vale para toda `TabButton`); fundo cinza liso, sem textura. No Vela, dourado só no marcador e nas contagens da navegação. |
| 8 | **Uma família de letra** | DM Sans em tudo; IBM Plex Mono para códigos que confundem O com 0 (container, CE, lacre, TXID, código Pix). Syne só no nome "Vela". |
| 9 | **Ação tem cara de botão** | Tudo o que faz algo, ou leva a resolver algo, é `Button`, com borda ou preenchimento; pode ter cor, mas nunca é só texto colorido. O identificador que abre o próprio registro (número do B/L, nome do Cliente, navio) e o caminho de navegação (breadcrumb) são texto na cor de link, sem sublinhado; o sublinhado aparece só ao passar o mouse ou com o foco do teclado. Link no meio de uma frase continua sublinhado. Número do B/L, CE Mercante, CNPJ e número do contêiner exibidos como valor levam o ícone de copiar (`CopyValue`), que substitui as ações "Copiar …" de menu. |

## Peças comuns

Uma tela compõe estas peças; não cria CSS próprio para elas.

| Peça | Arquivo | Uso |
|---|---|---|
| `Block` | `src/components/ui/Block.tsx` | Bloco com título em faixa (regra 1). `aside` à direita da faixa; `flush` para tabela encostada nas bordas. |
| `LeadValue` | idem | Dado principal (regra 2), com `detail` e `tone` (`warning`/`danger`) só quando pede ação. |
| `FactList` e `Fact` | idem | Pares rótulo/valor de apoio em 1 a 4 colunas (2 no celular). |
| `IdentityBand` | `src/components/ui/IdentityBand.tsx` | Faixa azul-marinho da ficha: tipo, identificador (o `h1` da página), fatos e ações. |
| `NextAction` | `src/components/ui/NextAction.tsx` | A próxima ação da tela, com motivo e botão (`tone` `danger`, `warning` ou `info`). |
| `NoValue` | `src/components/ui/NoValue.tsx` | "—" com o significado para leitor de tela. |
| `CopyValue` | `src/components/ui/CopyValue.tsx` | Identificador com o ícone de copiar ao lado (regra 9): aparece ao passar o mouse na linha ou no valor e com o foco; sempre visível em tela de toque. Fora de um link: envolve o `Link`, nunca fica dentro dele. |
| `.app-link` | `src/index.css` | Identificador que abre o registro (regra 9) em telas sem link próprio de família: cor de link, sublinhado só ao passar o mouse ou com foco. |
| `StatusText`, `ConsolidatedMark` e `ComplementMark` | `src/components/ui/StatusText.tsx` | Situação em texto (regra 5): `tone` `warning` (âmbar, pede ação), `muted` (encerrou sem efeito) e `paid` (✓ verde antes de "Paga"); `ConsolidatedMark` é o ícone de pilha da fatura consolidada, com "Consolidada" ao passar o mouse; `ComplementMark` é o ⊕ da Invoice de Demurrage complementar, com "Complementa a DEM-…" (lote 4). |
| `ChoiceCards` | `src/components/ui/ChoiceCards.tsx` | Escolha entre poucas opções que mudam o efeito de uma ação, cada uma com o que acontece escrito embaixo; pode começar sem nada marcado, e o botão que depende dela espera a escolha (Portal do Cliente no cadastro da Revisão). Para alternar uma visão, `SegmentedControl`. |
| `MetricCard` em `.app-metric-row` | `src/components/ui/MetricCard.tsx` | Cartões de total ou de filtro no topo de uma lista, quando a tela aprovada os pede: `detail` para uma linha de apoio, `tone="warning"` só para número que pede ação e é maior que zero, `onSelect` com `selected` quando o cartão filtra (`aria-pressed`); `onSelect` sem `selected` quando só leva a outra tela, como no Painel do Portal. |
| Tabela padrão | `table.app-table`, `th.app-table__group > span`, `.app-table__text` (célula) e `.app-table__text-head` (cabeçalho), `app-table--nested`, `tr.app-table__row--muted` (linha encerrada sem efeito, como a fatura cancelada, inteira em cinza) | Alinhamento centralizado, faixa de grupo com traço sob o título, texto longo à esquerda (também quando a célula tem `.app-table__truncate` ou `.app-table__cell-stack`) e cabeçalho claro na tabela interna (regra 6). |
| `Button` | `src/components/ui/Button.tsx` | `primary` (preenchido, um por região), `secondary` (contorno), `danger` (contorno vermelho; sólido na confirmação) e `ghost` (o mais discreto, ainda com borda). |
| Demais primitivas | `src/components/ui/` | `Modal`, `Drawer`, `TabList`, `SegmentedControl`, `SummaryStrip`, `StepRail`, `MetricCard`, `Badge`, `Combobox`, paginação e estados de consulta, descritas em [ARCHITECTURE.md](ARCHITECTURE.md). |

## Cores

Os valores vivem em `src/index.css`; esta tabela dá os papéis. Não há tema
escuro: foi retirado em 2026-10-15 por decisão do responsável (não tinha
seletor na tela). Classe `dark:` do Tailwind não deve voltar ao código.

| Papel | Token | Vela (claro) | Portal Fwlog |
|---|---|---|---|
| Fundo da página | `--app-bg` | `#f6f7f9`, liso | igual |
| Superfície e bloco | `--app-surface` | `#ffffff` | igual |
| Faixa de título do bloco | `--app-strip` / `--app-strip-text` | `#eef2f7` / azul-marinho | `#edf3fa` / azul-marinho FWLOG |
| Estrutura (barra, cabeçalho de tabela, faixa de identidade, aba ativa) | `--app-navy`, `--app-thead-bg` | `#152238` | `#0d2b5e` (azul da logo) |
| Navegação ativa e contagem | `--app-nav-active` | dourado `#d4882e` | azul do globo `#5aaaf0` |
| Botão principal | `--app-blue-btn` | `#1d4d88` | `#1d67b3` |
| Link de identificador | `--app-link` | `#1d4d88` | `#1a5aa0` |
| Texto, apoio | `--app-text`, `--app-muted` | `#121822`, `#4f5868` | igual |
| Bordas | `--app-border`, `--app-border-strong`, `--app-border-soft` | `#c3cad5`, `#9aa4b2`, `#e2e6ec` | igual |
| Estados | `--app-{success,warning,danger,info,neutral}-{fg,bg,border}` | verde, âmbar, vermelho, azul, cinza | igual, com `info` no azul FWLOG |

Cor de estado só por esses aliases. Cor escrita direto no componente
(`#0d1117`, `text-slate-400`) é proibida.

## Letra

| Uso | Tamanho/linha | Peso |
|---|---|---|
| Título de página no Vela | 22/28 (`--app-size-title`) | 700 |
| Título de página no Portal; identificador na `IdentityBand` | 24/32 (`--app-size-page`) | 700 |
| Título de modal | 20/28 | 600 |
| Dado principal do bloco (`LeadValue`) | 18/24 | 700 |
| Corpo, campos, botões, título do bloco | 14/20 | 400/500; título do bloco 700 |
| Tabela e corpo denso do Vela | 13/18 | 400; cabeçalho 600 |
| Rótulo, legenda, ajuda | 12/16 | 400/500 |
| Valor a pagar no Portal | 34/42 | 700 |
| Tela de acesso (login, ativação) | 32/40 | 700 |

Mínimo de 12 px. Caixa normal em rótulos, cabeçalhos, tags e abas; caixa alta
só em códigos que já são maiúsculos (LOCODE, container, B/L). Números, valores
e datas com `tabular-nums`; na tabela padrão ficam centralizados (regra 6).

## Vela e Portal

| Aspecto | Vela | Portal Fwlog |
|---|---|---|
| Marca | "Vela" em Syne e o símbolo do veleiro | Logo FWLOG branca sobre o azul-marinho da marca ([branding](../public/branding/README.md)) |
| Densidade | Compacta com mouse (controle 36 px, linha 40 px) | Confortável (controle 44 px, linha 52 px) |
| Destaque | Dourado na navegação ativa | Azul do globo; sem dourado e sem Syne |
| Pergunta da tela | "O que está pendente e onde ajo?" | "O que preciso fazer e quanto devo?" |

O Modo Inspeção usa o shell e as telas do Portal, então mostra a marca FWLOG.
Os tokens da marca ficam na raiz do `portal.html` (`data-app="portal"`) e no
shell `.app-shell--portal`: login, ativação, recuperação de senha, avisos e
modais fora do shell também recebem a marca.
Toque (ponteiro grosso) mantém 44 px de alvo nos dois produtos.

## Menu do Vela

A estrutura do shell interno (`src/components/layout/AppLayout.tsx`, CSS
`.app-header`, `.app-nav-*` e `.app-sidebar` em `src/index.css`), decidida pelo
responsável em 2026-10-15 a partir de uma simulação aprovada:

- **Posição do menu:** muda só no menu da conta, na seção "Posição do menu", sem
  outro botão na tela. São quatro opções: **No topo** (padrão, a barra única de
  hoje), **Lateral fixa** (240 px, sempre aberta), **Lateral recolhida** (64 px,
  só os ícones; o nome aparece ao passar o mouse e o grupo abre ao lado) e
  **Lateral expansível** (64 px que abre por cima da página ao passar o mouse,
  depois de 0,15 s, ou com o foco do teclado). A escolha fica guardada no
  navegador (`useNavPosition`, chave `vela_nav_position`), como o tema visual.
- **Na lateral:** a faixa de avisos fica no alto da página, ao lado do menu; o
  sino e a conta (nome e Departamento) ficam no rodapé e abrem para a direita.
  Na fixa e na expansível os grupos (Importação, Exportação, Financeiro) abrem
  como lista no próprio menu, e o grupo da tela atual já vem aberto.
- **Abaixo de 1100 px** toda posição usa o botão Menu do cabeçalho, como antes.
- **Contagem da navegação** (Alertas, Revisão, Taxas Locais e a soma no grupo):
  sempre logo depois do nome, no topo, na lateral, nos grupos e no Menu do
  celular; só a seta do grupo fica na ponta direita. Na lateral recolhida e na
  expansível fechada, a contagem fica no canto do ícone.
- O Portal Fwlog não tem essa escolha: segue com a barra no topo.

## Superfícies especiais

- **TV do Line-Up:** quadro próprio que imita o quadro físico (decisão do responsável de 2026-10-08), fora das peças comuns; segue as regras 4, 5 e 8.
- **Documentos impressos:** fora das peças comuns, com a identidade própria mantida por decisão do responsável de 2026-10-13: marca Transhipping, barras âmbar de total, cabeçalho de tabela azul-marinho, título centralizado com filete, bloco de dados do Cliente em tabela e bloco Pix (um redesenho em papel branco, tinta preta e azul-marinho foi reprovado). Kit em `src/components/shared/InvoiceDocumentKit.tsx` e `invoiceFormat.ts`; regras de impressão em `src/index.css` (`@media print`) e `src/lib/printDocument.ts`.

## Como uma tela muda

1. **Tela existente:** a mudança é proposta com a captura de hoje, a proposta e
   a lista do que muda na organização; o responsável aprova antes da
   implementação. O andamento fica no
   [plano de migração tela a tela](plans/2026-10-13-identidade-visual-tela-a-tela.md).
2. **Tela nova:** compõe as peças comuns. Só a organização (blocos, ordem, dado
   principal) passa pela aprovação, no mesmo formato.
3. **Regra nova ou alterada:** muda este documento e, se for decisão de
   produto, ganha nota na ADR 0081 ou uma ADR nova.

## Verificação automática

`npm run design:check` (no CI, job `quality`) compara o código com a linha
de base `scripts/design-baseline.json` e falha quando:

- um arquivo TSX ganha cor escrita direto (`#152238`, `#fff8`, `rgb(…)`,
  `hsl(…)`), tamanho de letra fora da escala (`text-[11px]`), caixa alta, cor
  da paleta do Tailwind ou a fonte de marca;
- uma folha de estilo de `src/` ganha regras numa família de CSS de página (por
  exemplo `.app-bl-*`, `.app-customer-*`), inclusive agrupada ou aninhada com
  uma peça comum, ou num `.css` novo. As peças comuns acima podem crescer,
  pelo nome exato do bloco: `.app-block-cliente` conta como página, não como
  `app-block`.

A linha de base guarda o que já existia em 2026-10-13 e só desce: ao migrar uma
tela, rode `npm run design:check -- --update` e confira no diff que os números
caíram. O `--update` recusa gravar um número que subiu; regra nova da
verificação ou peça comum registrada neste documento entram com
`--update --allow-increase`, que lista o que subiu para ir na descrição da PR. `npm run a11y:contrast` verifica os pares de cor nos temas claro
e escuro do Vela e no tema do Portal.

O que a verificação não pega fica para a aprovação da tela: assunto misturado
num bloco, falta de dado principal, ação em texto e a ordem dos blocos.
