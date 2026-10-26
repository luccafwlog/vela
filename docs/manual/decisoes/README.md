# Decisões das divergências

Página para o dono decidir as 118 divergências das classes b e c do
[mapeamento de 2026-10-26](../../archive/reports/2026-10-26-mapeamento-manual-do-operador.md#6-divergências-para-decisão-do-dono).
Cada ficha traz um caso hipotético com nomes inventados, o que o sistema faz
hoje, duas ou três opções com o efeito de cada uma e a opção recomendada.

- **Página publicada:** <https://claude.ai/artifact/SDGqaeCFq1Uht6ih1ef46R>
  (artefato privado do dono; quem for continuar precisa que o dono a
  compartilhe pelo menu Compartilhar da página).
- **Onde ficam as escolhas:** no banco do próprio artefato, coleção
  `decisoes`, um documento por ficha. O id do documento é a chave da ficha
  com `:` trocado por `_` (por exemplo `07-portal_POR-D13`). Campos:
  `escolha` (letra da opção ou `null`), `nota` e `decididoEm`. Um agente lê
  com a ferramenta `ArtifactData` (`action: "list"`, `collection: "decisoes"`,
  a URL acima).
- **Fonte da página:** [`pagina-modelo.html`](pagina-modelo.html) (layout e
  código) e [`fichas.json`](fichas.json) (as 118 fichas). Para republicar no
  mesmo endereço: `python3 docs/manual/decisoes/montar-pagina.py saida.html`
  e publicar `saida.html` com a ferramenta Artifact passando `url` acima
  (sem `capabilities`, para manter o `db` declarado).
- As fichas foram escritas a partir das divergências conferidas no código,
  sem nova leitura do código para cada caso. ACE-D13 e DEM-D09 foram escritas
  com o banco local desligado. ACE-D02 e Viagens nº 2 tratam do mesmo ponto e
  devem ser decididas juntas.

Decisão tomada vira tarefa própria (correção no código ou no documento) e,
quando muda regra, ADR nova; o manual descreve o que o sistema faz até a
correção sair.
