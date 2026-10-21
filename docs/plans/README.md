# Planos de implementação (vivos)

Planos ativos — trabalho previsto e ainda não concluído. Este é o único
diretório de planos vivos do projeto; skills e agentes gravam planos novos aqui.

Quando um plano é totalmente executado, encerrado ou superado por decisão
registrada, ele é movido para [`../archive/plans/`](../archive/plans/README.md)
com nota de estado e motivo; o arquivo continua sendo histórico, não fonte de
verdade sobre o estado atual.

## Planos ativos


- [2026-10-21 — Frente das importações](2026-10-21-frente-das-importacoes.md) — executa a [ADR 0095](../adr/0095-importacoes-regras-da-revisao.md) a partir da [revisão das importações](../archive/audits/2026-10-21-revisao-importacoes.md); lote 0 (leitura de arquivo e mensagens) na PR luccafwlog/vela#1020; lote 1 (trava e Baplie no servidor, migrations `387` a `390`) na PR luccafwlog/vela#1023; lotes 2 a 10 de banco a partir da migration `391`.

- [2026-10-13 — Identidade visual: migração tela a tela](2026-10-13-identidade-visual-tela-a-tela.md) — base da [identidade visual única](../identidade-visual.md) entregue em 2026-10-13 ([ADR 0081](../adr/0081-identidade-visual-unica.md)): tokens, tema FWLOG do Portal, peças comuns e `npm run design:check`; 22 telas a migrar (os e-mails do Vela e do Portal acrescentados ao lote 6 em 2026-10-19), cada uma aprovada pelo responsável com captura de hoje, proposta e lista do que muda; ficha do B/L, passada única e lote 1 (lista de BLs, ficha da Viagem, ficha do Cliente, Taxas Locais · Faturas e Validação, Portal · Faturas, e as abas restantes das fichas do B/L e da Viagem em 2026-10-15) e lote 2 (operação do dia a dia, 2026-10-16, PR 969) e lote 3 (Financeiro, 2026-10-16, PR 970) entregues; lote 4 (restante do Portal) aprovado e entregue em 2026-10-18 (PR 972), com as migrations `298` a `300` ([ADR 0088](../adr/0088-portal-so-mostra-fatura-emitida.md) e [ADR 0089](../adr/0089-desbloqueio-ce-bl-muda-de-solicitacao.md)); lotes 5a e 5b entregues em 2026-10-19 (5b com as migrations `325`, `326` e `328` e as ações de linha só com ícone em todo o sistema); lote 6 dividido em 6a (acesso e importações, entregue com a [ADR 0092](../adr/0092-importacao-com-erro-e-recusada-inteira.md)) e 6b (e-mails e impressos); restam as telas 20 e 22 (lote 6b).


Planos concluídos, encerrados ou superados ficam no [índice dos planos arquivados](../archive/plans/README.md). As notas de estado que este índice acumulou até 2026-10-13 estão no [registro histórico](../archive/reports/2026-10-14-estado-planos-vivos-ate-2026-10-13.md); as anteriores, no [registro de 2026-09-18](../archive/reports/2026-09-18-notas-historicas-indice-planos.md).

## Ao concluir um plano

1. `git mv docs/plans/<plano>.md docs/archive/plans/`
2. Remover a linha da lista acima e acrescentar o plano, com estado e motivo, ao [índice dos planos arquivados](../archive/plans/README.md).
3. Se a spec originária estiver em `docs/spec/`, movê-la para `docs/archive/specs/`.
4. Registrar a entrega no [`../CHANGELOG.md`](../CHANGELOG.md).
5. Rodar `npm run docs:check`.
