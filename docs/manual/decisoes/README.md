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
  `escolha` (letra da opção, `outra` quando nenhuma opção serve e a
  `nota` descreve a solução pedida, ou `null`), `nota` e `decididoEm`. Um agente lê
  com a ferramenta `ArtifactData` (`action: "list"`, `collection: "decisoes"`,
  a URL acima).
- **Cópia das escolhas:** [`decisoes-2026-10-27.json`](decisoes-2026-10-27.json),
  tirada do registro em 2026-10-27, com as 112 fichas decididas (103 na
  opção recomendada, 6 em outra opção e 3 em "Outra solução" com nota). O
  registro da página continua sendo a fonte; a cópia guarda o estado para
  quem continuar sem acesso à página.
- **Fonte da página:** [`pagina-modelo.html`](pagina-modelo.html) (layout e
  código) e [`fichas.json`](fichas.json) (112 fichas). Para republicar no
  mesmo endereço: `python3 docs/manual/decisoes/montar-pagina.py saida.html`
  e publicar `saida.html` com a ferramenta Artifact passando `url` acima
  (sem `capabilities`, para manter o `db` declarado).
- **118 divergências em 112 fichas.** Seis pontos tinham sido encontrados em
  duas áreas e viraram uma ficha só (2026-10-27); o campo `tambem` da ficha
  lista as divergências absorvidas, e a escolha da ficha vale para elas.
  Absorvidas: `06-clientes-comunicacao:D13` em `ACE-D01`, `ACE-D02` em
  `02-viagens-adr:2`, `ACE-D03` em `ALE-D13`, `ACE-D14` em
  `06-clientes-comunicacao:D10`, `ALE-D10` em `06-clientes-comunicacao:D04` e
  `ALE-D16` em `10-recebimento:7`. Escolhas gravadas antes da junção nas
  absorvidas (`ACE-D14`: B) continuam no registro e batem com a ficha mantida.
- As fichas foram escritas a partir das divergências conferidas no código,
  sem nova leitura do código para cada caso. ACE-D13 e DEM-D09 foram escritas
  com o banco local desligado.

Decisão tomada vira tarefa própria (correção no código ou no documento) e,
quando muda regra, ADR nova; o manual descreve o que o sistema faz até a
correção sair.
