# 0129 — EDI Mercante registrado com número próprio, dados do manifesto corrigidos na ficha e consignatário estrangeiro impedido

Status: aceito — 2026-11-06 (decisões do dono na
[issue #1238](https://github.com/luccafwlog/vela/issues/1238), itens 1, 2, 4
e 5). Implementada nas migrations `600` e `601`. Estende a
[ADR 0116](./0116-edi-mercante-gerado-pelo-vela.md).

## Contexto

A [ADR 0116](./0116-edi-mercante-gerado-pelo-vela.md) passou a gerar o EDI
Mercante no Vela. O primeiro arquivo foi aceito pelo Mercante em 2026-11-05
(GS8, manifesto 1226502047331), e a issue #560 foi encerrada com quatro
decisões em aberto, levadas para a #1238:

- **Registro.** **Baixar arquivo** só baixava: nada ficava gravado e o nome
  levava o instante da geração (`FWL_MERCANTE_<AAAAMMDDHHMM>_<sigla>.TXT`).
- **Correção.** O C5 leva os blocos de consignatário, embarcador e notify, o
  CNPJ/CPF do consignatário e o total de volumes. A ficha do B/L não os
  editava: só a reimportação do arquivo os corrigia, o que não resolve quando
  o próprio arquivo vem errado.
- **Consignatário estrangeiro.** O C5 saía sempre com o indicador de
  consignatário estrangeiro `N`, sem passaporte nem nome do estrangeiro. Sem
  CNPJ, o arquivo era impedido com "reimporte o arquivo do B/L", o que não
  resolve o caso.
- **TECON SSA.** A rota com POD em Salvador era impedida por falta do código
  Mercante do terminal.

## Decisão

1. **Registro e número próprio** (item 4). **Baixar arquivo** grava antes do
   download, em `mercante_edi_files`, a Viagem, a rota, a natureza (contêiner,
   carga solta ou vazios), quantos B/Ls e itens o arquivo leva, quem gerou e
   quando. O número é uma sequência do Vela a partir de 1, sem continuar a
   série do sistema externo. O nome passa a ser
   `FWL_MERCANTE_<número com 6 dígitos>_<sigla>.TXT`. Sem o registro, o
   arquivo não é baixado. Cada arquivo aparece no Histórico da Viagem como
   "EDI Mercante gerado". A RPC `register_mercante_edi_file` só aceita a conta
   Dev (`is_dev_user`), que é quem vê o botão (decisão do dono de 2026-11-03).
   O registro passa a ser uma regra do banco, e a matriz "O que cada setor
   pode" ganha a linha `gerar-edi-mercante`.
2. **Dados do manifesto corrigidos na ficha** (item 1). A aba **Detalhes do
   B/L** ganha o bloco **Dados do manifesto**: blocos de consignatário,
   embarcador e notify, CNPJ/CPF do consignatário, total de volumes e
   unidade. A gravação passa por `save_bl_review`, com justificativa, e o
   antes e o depois vão ao Histórico do B/L.
   - O CNPJ/CPF precisa ter 14 dígitos válidos ou 11. Com Cliente no B/L, ele
     precisa ser o CNPJ do Cliente: outro consignatário passa pela troca do
     Cliente.
   - Cada campo corrigido vira uma linha de `bl_manifest_corrections`. Fora
     da ficha (reimportação de B/L, Manifesto BB, qualquer gravação
     automática), o gatilho `zz_keep_bl_manifest_corrections` mantém o valor
     corrigido. O Histórico do B/L registra "Correção da ficha mantida" com o
     valor que chegou, e a prévia da reimportação do arquivo de B/L avisa o
     campo.
   - **Exceção.** O B/L que passa a outro Cliente cujo CNPJ não é o corrigido
     (Troca de Consignatário aceita, vínculo pela Revisão) perde as correções
     do consignatário (bloco e CNPJ). O Histórico registra "Correção da ficha
     substituída". Sem isso, o B/L ficaria com um Cliente e o manifesto com
     outro consignatário.
3. **Consignatário estrangeiro impedido** (item 5, opção b). O consignatário
   sem CNPJ/CPF e sem nenhum sinal de endereço ou empresa no Brasil é tratado
   como estrangeiro. Para identificar o Brasil, o Vela procura no bloco:
   BRASIL ou BRAZIL, CNPJ, CPF, CEP, LTDA, EIRELI, S/A ou um CEP no formato
   `00000-000`.
   - O consignatário estrangeiro impede o arquivo de contêiner e fica como "a
     completar" no arquivo parcial de carga solta. A mensagem diz o motivo e,
     se o consignatário for brasileiro, manda informar o CNPJ/CPF na ficha.
   - O Vela não preenche passaporte nem nome do estrangeiro. Essas posições
     ficam para quando aparecer um caso real.
   - As mensagens de bloco ou CNPJ ausente passam a mandar corrigir na ficha,
     não reimportar.
4. **TECON SSA** (item 2). Código Mercante `BRSSA002`, confirmado pelo dono.

## Consequências

- O Histórico da Viagem diz quem gerou cada EDI Mercante, quando, para qual
  rota e natureza e com qual nome de arquivo. O número do arquivo não se
  repete.
- Corrigir um dado do manifesto na ficha é definitivo para a reimportação. Para
  voltar a usar o valor do arquivo, a pessoa corrige o campo de novo na ficha.
  A correção não tem botão de "desfazer".
- A heurística do estrangeiro olha só o texto do bloco. Um bloco brasileiro
  sem país, CEP nem forma societária e sem CNPJ cai no mesmo impedimento. A
  saída é a mesma: informar o CNPJ/CPF na ficha.
- Regra vigente: [Manifestos & EDI § EDI Mercante](../modules/manifesto-edi.md#edi-mercante).
