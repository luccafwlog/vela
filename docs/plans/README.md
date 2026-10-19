# Planos de implementação (vivos)

Planos ativos — trabalho previsto e ainda não concluído. Este é o único
diretório de planos vivos do projeto; skills e agentes gravam planos novos aqui.

Quando um plano é totalmente executado, encerrado ou superado por decisão
registrada, ele é movido para [`../archive/plans/`](../archive/plans/README.md)
com nota de estado e motivo; o arquivo continua sendo histórico, não fonte de
verdade sobre o estado atual.

## Planos ativos


- [2026-10-13 — Identidade visual: migração tela a tela](2026-10-13-identidade-visual-tela-a-tela.md) — base da [identidade visual única](../identidade-visual.md) entregue em 2026-10-13 ([ADR 0081](../adr/0081-identidade-visual-unica.md)): tokens, tema FWLOG do Portal, peças comuns e `npm run design:check`; 21 telas a migrar, cada uma aprovada pelo responsável com captura de hoje, proposta e lista do que muda; ficha do B/L, passada única e lote 1 (lista de BLs, ficha da Viagem, ficha do Cliente, Taxas Locais · Faturas e Validação, Portal · Faturas, e as abas restantes das fichas do B/L e da Viagem em 2026-10-15) e lote 2 (operação do dia a dia, 2026-10-16, PR 969) e lote 3 (Financeiro, 2026-10-16, PR 970) entregues; lote 4 (restante do Portal) aprovado e entregue em 2026-10-18 (PR 972), com as migrations `298` a `300` ([ADR 0088](../adr/0088-portal-so-mostra-fatura-emitida.md) e [ADR 0089](../adr/0089-desbloqueio-ce-bl-muda-de-solicitacao.md)); restam as telas internas que ainda não entraram em lote.

- [2026-10-17 — Correção dos e-mails do sistema](2026-10-17-correcao-dos-emails.md) — revisão de todo e-mail gerado (Comunicados, régua automática, Cobrança de Demurrage, Portal, Desbloqueio de CE, internos e retorno do provedor) depois do loop de 422 do CE (PR #971); fases 0 a 6 com o que precisa estar pronto antes de ligar a chave de envio real; 21 decisões do responsável tomadas em 2026-10-18; fases 1 a 5 implementadas no PR #973; falta a Fase 6 (ligar a chave).


Planos concluídos, encerrados ou superados ficam no [índice dos planos arquivados](../archive/plans/README.md). As notas de estado que este índice acumulou até 2026-10-13 estão no [registro histórico](../archive/reports/2026-10-14-estado-planos-vivos-ate-2026-10-13.md); as anteriores, no [registro de 2026-09-18](../archive/reports/2026-09-18-notas-historicas-indice-planos.md).

## Ao concluir um plano

1. `git mv docs/plans/<plano>.md docs/archive/plans/`
2. Remover a linha da lista acima e acrescentar o plano, com estado e motivo, ao [índice dos planos arquivados](../archive/plans/README.md).
3. Se a spec originária estiver em `docs/spec/`, movê-la para `docs/archive/specs/`.
4. Registrar a entrega no [`../CHANGELOG.md`](../CHANGELOG.md).
5. Rodar `npm run docs:check`.
