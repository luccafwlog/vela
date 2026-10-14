# Design da página `/viagens`

Fontes do canvas de design publicado para a página `/viagens`. Não é código de
produção: nada aqui é importado por `src/`.

A **Direção A** foi a escolhida — mantém o rail horizontal e o card de detalhe
com abas que já existem, mudando hierarquia e densidade. As direções
descartadas não ficam versionadas: o registro da decisão vive na história do
git e no pull request.

Este canvas é o registro do redesenho de agosto de 2026, entregue em sete
blocos (PRs #588 e #591–#599; ver o [CHANGELOG](../../docs/CHANGELOG.md)); não
há trabalho em andamento nele. A página mudou de novo depois, na revisão visual
de outubro de 2026: a tela vigente é a do código, não a destes artboards.

Cada aba tem um par antes/depois lendo os mesmos dados. O ADR tem um terceiro
artboard, `AdrEstados`, com as hipóteses que o fluxo cheio não mostra — os
vazios do recorte por terminal, o documento fechado, a escala omitida, o ADR
legado sem `terminal_id`, o leitor sem permissão e as guardas de erro.

## Páginas do canvas

| Página | Artboards |
| --- | --- |
| Página | [`Main.dc.html`](./Main.dc.html) — a Direção A inteira |
| Aba ADR | [`AdrAntes`](./AdrAntes.dc.html), [`AdrDepois`](./AdrDepois.dc.html) e [`AdrEstados`](./AdrEstados.dc.html) |
| Cards | [`Cards.dc.html`](./Cards.dc.html) — anatomia e estados |
| Aba Rotas e Manifestos | [`RotasAntes`](./RotasAntes.dc.html) e [`RotasDepois`](./RotasDepois.dc.html) |
| Aba Exportação | [`ExportacaoAntes`](./ExportacaoAntes.dc.html), [`ExportacaoDepois`](./ExportacaoDepois.dc.html), [`ExportacaoMultiDepot`](./ExportacaoMultiDepot.dc.html) e [`ModalGranito`](./ModalGranito.dc.html) |
| Aba Importação | [`ImportacaoAntes`](./ImportacaoAntes.dc.html) e [`ImportacaoDepois`](./ImportacaoDepois.dc.html) |
| Visão geral · Planejamento | [`PlanejamentoAntes`](./PlanejamentoAntes.dc.html) e [`PlanejamentoEscala`](./PlanejamentoEscala.dc.html) |

[`canvas.json`](./canvas.json) — gerado por [`canvas.mjs`](./canvas.mjs) — define
posições, páginas, notas e a página de abertura.

## Como os artboards são gerados

```sh
node build.mjs && node canvas.mjs
```

[`build.mjs`](./build.mjs) emite os `.dc.html` e grava as alturas em
[`heights.json`](./heights.json), que [`canvas.mjs`](./canvas.mjs) usa para
posicionar as molduras sem sobreposição. Os módulos de apoio:

- [`kit.mjs`](./kit.mjs) — tokens e componentes transpostos 1:1 de
  `src/index.css` (tema `current`) e de `src/components/ui`: paleta,
  Syne/DM Sans/IBM Plex Mono, `.app-btn`, `.app-surface`, `.app-badge`,
  `.app-tab`, `.app-table`, além do cabeçalho, da faixa de câmbio e da barra de
  navegação.
- [`data.mjs`](./data.mjs) — dados de amostra. Nomes de navio, armador, portos e
  datas são plausíveis e seguem o vocabulário de
  [`CONTEXT.md`](../../CONTEXT.md) (inclusive o alias `ZYHY` e as marcas `OMIT` e
  `X` da programação), mas **não são registros reais**.
- [`blocks.mjs`](./blocks.mjs) — blocos da página: cabeçalho, barra de comando,
  herói da viagem, faixa de KPIs, abas, planejamento, transbordo e linha do tempo.
- [`abakit.mjs`](./abakit.mjs) — a gramática comum das abas, fechada na
  Importação: faixa de total, bloco por escala, painel chapado com número
  dominante, tokens com contagem, faixa e barra de ações.
- [`adr.mjs`](./adr.mjs) — a aba ADR: o "hoje", transcrição fiel de
  `src/components/voyages/VoyageAgencyReportTab.tsx`, a proposta e a matriz de
  hipóteses. Os dois primeiros artboards leem o mesmo conjunto de dados, cheio
  até o limite do que cada uma das seis seções de `AGENCY_REPORT_SECTIONS`
  exibe; só as primitivas de apresentação mudam entre eles.
- [`rotas.mjs`](./rotas.mjs) — a aba Escalas & Manifestos renomeada para Rotas e
  Manifestos: o "hoje", transcrição fiel de
  `src/components/voyages/VoyageManifestosTab.tsx`, e a proposta.
- [`modalgranito.mjs`](./modalgranito.mjs) — o modal "Importar Manifesto
  Granito", hoje e a proposta.
- [`exportacao.mjs`](./exportacao.mjs) — a aba Exportação: o "hoje", transcrição
  fiel de `src/components/voyages/VoyageExportacaoTab.tsx`, e a proposta.
- [`importacao.mjs`](./importacao.mjs) — a aba Importação: o "hoje", transcrição
  fiel de `src/components/voyages/VoyageImportacaoTab.tsx`, e a proposta.
- [`tabs.mjs`](./tabs.mjs) — corpo de cada aba do `VoyageCard`.
- [`visaogeral.mjs`](./visaogeral.mjs) — a tabela de Planejamento por escala:
  o "hoje", transcrição fiel de `src/components/voyages/VoyageVisaoTab.tsx`, e
  a proposta fechada, com as atracações num painel recolhível de cabeçalho
  próprio. É a tabela que o `Main` usa.

### Medindo a altura de um artboard

`height` em `build.mjs` é o quadro; conteúdo além dele fica cortado. Para medir
o que o artboard realmente ocupa, zere o `min-height` do `.shell` e leia a
altura pelo DOM já executado:

```sh
sed -E 's/min-height: [0-9]+px/min-height: 0/' AdrDepois.dc.html > probe.html
printf '<script>addEventListener("load",()=>setTimeout(()=>{document.title="H="+Math.ceil(document.querySelector(".shell").getBoundingClientRect().height)},300))</script>' >> probe.html
/opt/pw-browsers/chromium --headless --disable-gpu --no-sandbox \
  --virtual-time-budget=8000 --window-size=1440,900 --dump-dom \
  "file://$PWD/probe.html" | grep -o '<title>H=[0-9]*'
```

O `height` do artboard é esse número mais ~140px de respiro do quadro.

## Publicação

O arquivo semeado do canvas (`viagens-tres-direcoes.html`) é grande — ~2 MB,
embute o editor — e por isso não é versionado. O nome do arquivo ficou do
primeiro seed e é mantido de propósito: trocá-lo criaria um Artifact novo em
outra URL. O título publicado é "Página de Viagens".

Para atualizar: rode os dois scripts acima e semeie de novo com o helper do
skill `design` (`seed-canvas.mjs --template ... --artboard ... --canvas
canvas.json`), republicando no mesmo Artifact.

> **`seed-canvas.mjs` não está neste repositório.** Ele pertence ao skill
> `design` e só existe na máquina de quem tem esse skill instalado — não há como
> republicar o canvas a partir de um clone limpo. O que **é** reproduzível aqui
> são os artefatos versionados: `node build.mjs && node canvas.mjs` regenera os
> `.dc.html`, o `heights.json` e o `canvas.json` de forma determinística, byte a
> byte. Nenhum passo do CI roda esses scripts nem confere os `.dc.html`; a
> conferência fica com quem revisa. A semeadura é o último passo, manual, e só
> quem for republicar precisa dele.
>
> Consequência prática: quem alterar um `.mjs` **precisa commitar os `.dc.html`,
> o `heights.json` e o `canvas.json` regerados junto** — quem revisa não
> consegue produzi-los de outra forma.
