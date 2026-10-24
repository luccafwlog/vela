# 0089 — No Desbloqueio de CE, o B/L muda de solicitação ainda não validada

> **Situação atual (2026-10-24).** A decisão vale inteira, com uma ressalva na decisão 4: desde a [ADR 0101](./0101-desbloqueio-ce-prazo-e-vigencia-anual.md) (decisões 4 e 5) o Cliente VIP só usa os anuais na solicitação cujos B/Ls eles cobrem (B/L importado dentro da vigência); a que tem B/L fora dela segue comum, com termo e procuração anexados.

Status: aceito — 2026-10-18 (decisão do responsável na aprovação do lote 4 da
identidade visual, "caminho A"). Implementada na migration `299`, com testes no
Postgres local; ver o [plano da identidade visual](../plans/2026-10-13-identidade-visual-tela-a-tela.md).

## Contexto

Um B/L só pode estar numa solicitação ativa (índice `ce_unlock_one_active_bl`,
migration `139`). Para juntá-lo a outros B/Ls numa solicitação nova, o Cliente
precisava cancelar a antiga, o que não podia fazer depois do envio (o Cliente
só cancela rascunho e correção pedida). A tela "Nova solicitação" mostrava o
B/L como "Já em solicitação", sem saída.

Foram apresentados dois caminhos: (A) o B/L sai da solicitação antiga e entra
na nova; (B) o Cliente acrescenta B/Ls à solicitação existente. O responsável
escolheu o A.

## Decisão

1. B/L ativo em solicitação **ainda não validada** (rascunho, enviada, em
   análise ou correção pedida) do mesmo Cliente, e ainda não enviado à ZPT,
   pode ser pedido de novo.
2. Ao criar a solicitação nova, o B/L sai da antiga e o Histórico das duas
   registra a mudança.
3. A antiga que fica sem B/L é **cancelada**; a que mantém outros B/Ls
   **continua aberta** com eles.
4. Documentos não passam de uma solicitação para outra: termo e procuração são
   enviados de novo na nova (o Cliente VIP usa os anuais nas duas).
5. Antes de criar, o Portal mostra o que vai acontecer com cada solicitação
   antiga e pede confirmação; a mudança não se desfaz.

B/L de solicitação com "Documentação validada", de outro Cliente ou já
exportado continua bloqueado.

## Alternativas rejeitadas

- **Caminho B (acrescentar B/L à solicitação existente):** exigia um comando
  novo, nova análise dos documentos já aprovados para o B/L acrescentado e
  regras de prazo para o pedido que muda de tamanho.
- **Levar os documentos da antiga para a nova:** o termo e a procuração
  citam os B/Ls do pedido em que foram enviados; a análise do desk vale para
  aquele conjunto.

## Consequências

- A trava "um B/L, uma solicitação ativa" continua; o comando `draft` passa a
  travar antes as solicitações de onde os B/Ls saem, na mesma ordem dos demais
  comandos (pedido antes do Cliente e do B/L). Pedido que mudou entre a leitura
  e a criação é recusado com "Solicitação alterada; atualize a página."
- O Histórico ganha o evento `bl_moved` ("B/L passou para a solicitação
  CE-…"). A regra vigente fica no
  [módulo Desbloqueio de CE](../modules/desbloqueio-ce.md#bl-que-muda-de-solicitação).
