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
| 3 | **Lugar fixo para cada coisa** | Ficha: `IdentityBand`, `NextAction`, situação (trilhos), abas, blocos. Lista: título e ações, cartões que filtram, filtros, tabela. Sempre nessa ordem. |
| 4 | **Ausência não faz barulho** | Falta de dado é `NoValue` ("—" discreto, com significado para leitor de tela). Coluna sem nenhum dado sai da tabela, com uma nota. Zero conhecido continua escrito ("Nenhuma", "R$ 0,00"). Nunca "X" ou o mesmo texto em toda linha. |
| 5 | **Cor só para o que pede ação** | Vermelho bloqueia ou venceu, âmbar aguarda, verde concluiu, azul informa; sempre com texto. Uma única próxima ação por tela, na `NextAction`. O resto fica em tinta normal. |
| 6 | **Tabela padrão** | Tabela com a classe `app-table--padrao`: títulos dos grupos, cabeçalhos e células centralizados, números inclusive. Texto longo que pode passar do limite da coluna (nome do Cliente ou do consignatário, descrição) fica à esquerda com `.app-table__text`, para o começo do valor aparecer; o que não cabe vira "…". Colunas do mesmo grupo ficam sob uma faixa própria (`th.app-table__group`) com o título centralizado e um traço embaixo; não há linha vertical entre colunas. O grupo que decide vem primeiro. |
| 7 | **Estrutura azul-marinho, fundo neutro** | Barra, cabeçalho de tabela, faixa de identidade e aba ativa em azul-marinho; fundo cinza liso, sem textura. No Vela, dourado só no marcador e nas contagens da navegação. |
| 8 | **Uma família de letra** | DM Sans em tudo; IBM Plex Mono para códigos que confundem O com 0 (container, CE, lacre, TXID, código Pix). Syne só no nome "Vela". |
| 9 | **Ação tem cara de botão** | Tudo o que faz algo, ou leva a resolver algo, é `Button`, com borda ou preenchimento; pode ter cor, mas nunca é só texto colorido. Texto sublinhado fica para o identificador que abre o próprio registro (número do B/L, nome do Cliente, navio) e para o caminho de navegação (breadcrumb). |

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
| Tabela padrão | `table.app-table--padrao`, `th.app-table__group > span`, `.app-table__text` | Alinhamento centralizado, faixa de grupo com traço sob o título e texto longo à esquerda (regra 6). |
| `Button` | `src/components/ui/Button.tsx` | `primary` (preenchido, um por região), `secondary` (contorno), `danger` (contorno vermelho; sólido na confirmação) e `ghost` (o mais discreto, ainda com borda). |
| Demais primitivas | `src/components/ui/` | `Modal`, `Drawer`, `TabList`, `SegmentedControl`, `SummaryStrip`, `StepRail`, `MetricCard`, `Badge`, `Combobox`, paginação e estados de consulta, descritas em [ARCHITECTURE.md](ARCHITECTURE.md). |

## Cores

Os valores vivem em `src/index.css`; esta tabela dá os papéis. O tema escuro
do Vela redefine os mesmos tokens e passa no `npm run a11y:contrast`.

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
Toque (ponteiro grosso) mantém 44 px de alvo nos dois produtos.

## Superfícies especiais

- **TV do Line-Up:** quadro próprio que imita o quadro físico (decisão do responsável de 2026-10-08), fora das peças comuns; segue as regras 4, 5 e 8.
- **Documentos impressos:** papel branco, tinta preta e azul-marinho, marca Transhipping; regras de impressão em `src/index.css` (`@media print`).
- **Tema escuro do Vela:** mesmos papéis e peças, com os pares escuros dos tokens.

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

`npm run design:check` (no CI, job "Docs + Lint") compara o código com a linha
de base `scripts/design-baseline.json` e falha quando:

- um arquivo TSX ganha cor escrita direto, tamanho de letra fora da escala
  (`text-[11px]`), caixa alta, cor da paleta do Tailwind ou a fonte de marca;
- `src/index.css` ganha regras numa família de CSS de página (por exemplo
  `.app-bl-*`, `.app-customer-*`). As peças comuns acima podem crescer.

A linha de base guarda o que já existia em 2026-10-13 e só desce: ao migrar uma
tela, rode `npm run design:check -- --update` e confira no diff que os números
caíram. Uma peça comum nova é registrada neste documento antes de atualizar a
linha de base. `npm run a11y:contrast` verifica os pares de cor nos temas claro
e escuro do Vela e no tema do Portal.

O que a verificação não pega fica para a aprovação da tela: assunto misturado
num bloco, falta de dado principal, ação em texto e a ordem dos blocos.
