# 0123 — Manifesto Mercante de carga separado por natureza: contêiner ou carga solta

Status: aceito — 2026-11-05 (pedido do dono: "separando, sempre, os manifestos
e EDI pelas naturezas, ainda que tenham a mesma rota. Assim, o EDI Mercante
será sempre só de container ou só de carga solta"). Implementada na migration
`592` e na aba **Rotas e Manifestos** da Viagem
(`src/components/voyages/VoyageManifestosTab.tsx`). Estende a
[ADR 0078](./0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md)
(itens 6 e 7: Manifesto Mercante por rota) e a
[ADR 0116](./0116-edi-mercante-gerado-pelo-vela.md) (itens 1 e 8: linha
CNTR/BB com os dois arquivos). Regra vigente em
[Manifestos & EDI § Manifesto Mercante](../modules/manifesto-edi.md#manifesto-mercante).

## Contexto

O Manifesto Mercante de carga era cadastrado por Viagem e rota (POL → POD),
com a natureza `carga` ou `vazio`. Uma rota com B/L de contêiner e de carga
solta virava uma linha **CNTR/BB** em Rotas e Manifestos, com os números dos
dois Manifestos empilhados na mesma célula: a tela não dizia qual número era de
contêiner e qual era de carga solta, e o banco não sabia. Na prática, a agência
manifesta contêiner e carga solta em Manifestos separados, e o EDI Mercante já
saía em dois arquivos (contêiner e carga solta parcial) a partir da mesma linha.

## Decisão

1. Todo Manifesto Mercante de carga é só de contêiner ou só de carga solta
   (`manifestos_mercante.cargo_mode`), mesmo quando as duas naturezas dividem
   a rota. Vazios seguem com a natureza própria.
2. O B/L misto (contêiner e carga solta) vai no Manifesto de carga solta, como
   já ia no EDI ([ADR 0116](./0116-edi-mercante-gerado-pelo-vela.md), item 8).
   O B/L inteiro fica num Manifesto só.
3. O banco recusa o vínculo de natureza trocada em todas as portas: planilha de
   CE (a planilha com as duas naturezas e o número da outra natureza são
   recusados inteiros), **Mover**, **Informar**/**Editar** e reativação do B/L.
   O B/L cuja natureza muda (o contêiner que ganha carga solta e vira misto, o
   misto que perde a carga solta) sai do Manifesto, com o Histórico, e com CE
   abre o Alerta "CE fora do Manifesto da rota".
4. Rotas e Manifestos mostra uma linha por rota e natureza: **CNTR**, **BB** e
   **VAZIOS**. A sigla **CNTR/BB** deixa de existir. Cada linha tem os seus
   Manifestos, a sua cobertura de CE, o seu **Ver B/Ls** e o seu EDI: a linha
   CNTR gera o arquivo de contêiner e a linha BB o parcial de carga solta.
5. Os Manifestos já gravados recebem a natureza dos B/Ls vinculados; sem B/L,
   a dos B/Ls ativos da rota quando todos são de uma natureza, e contêiner nos
   demais casos. Manifesto com B/L das duas naturezas faz a migration parar
   sem gravar nada (a produção conferida em 2026-11-05 não tinha nenhum).

## Consequências

- O operador vê de qual natureza é cada número, e o EDI de cada linha leva só
  aquela natureza.
- Um número digitado na linha errada é recusado com a natureza do Manifesto
  ("O Manifesto Mercante N é de carga solta (não de contêiner)…").
- Fica de fora: dividir um B/L misto entre dois Manifestos. Se o Mercante
  pedir o contêiner do misto no Manifesto de contêiner, a mudança é partir o
  B/L em dois CEs.
