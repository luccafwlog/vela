# Planos de implementação (vivos)

Planos ativos — trabalho previsto e ainda não concluído. Este é o único
diretório de planos vivos do projeto; skills e agentes gravam planos novos aqui.

Quando um plano é totalmente executado, ele é movido para
[`../archive/plans/`](../archive/plans/README.md) como registro histórico.

## Planos ativos

- [2026-09-18 — Governança, limpeza e evolução das skills](2026-09-18-governanca-limpeza-evolucao-skills.md) — inventário, decisão, sincronização segura e melhoria comportamental das skills do Vela.
- [2026-09-06 — Remediação das auditorias #654–#660](2026-09-06-plano-remediacao-auditorias-654-660.md) — execução parcial; os residuais de S03, S05, S06/S07 e a prova de runtime continuam abertos.
- [2026-09-12 — Remediação da revisão sistemática multiagente](2026-09-12-plano-implementacao-auditoria-sistematica.md) — plano de remediação dos achados consolidados da auditoria da PR #687, cobrindo acessibilidade, UX, documentos/faturas, segurança de testes, banco de dados e performance.

O plano [2026-09-17 — Unificação de B/Ls, carga mista e Manifesto Mercante](../archive/plans/2026-09-17-unificacao-bls-carga-mista-e-manifesto-mercante.md) foi concluído e arquivado.
O plano [2026-09-12 — Transição de marca: Transhipping Desk → Vela](../archive/plans/2026-09-12-plano-transicao-marca-vela.md) foi concluído e arquivado (PR #688).
O plano [2026-09-03 — Issue 609: contatos e caixas de comunicação](../archive/plans/2026-09-03-issue-609-contatos-caixas-comunicacao.md) foi concluído e arquivado.

## Revisão do ciclo de vida — 2026-09-19

Os três planos acima continuam vivos: remediação #654–#660 ainda exige prova de
runtime; revisão sistemática mantém C4/D4/D6 abertos; governança de skills
mantém validação no Alienware e encerramento pendentes. Nenhum foi arquivado
apenas por ter grande parte implementada.

As notas de execução intermediária de agosto/setembro foram preservadas no
[registro histórico](../archive/reports/2026-09-18-notas-historicas-indice-planos.md).

## Ao concluir um plano

1. `git mv docs/plans/<plano>.md docs/archive/plans/`
2. Remover a linha da tabela acima.
3. Se a spec originária estiver em `docs/spec/`, movê-la para `docs/archive/specs/`.
4. Registrar a entrega no [`../CHANGELOG.md`](../CHANGELOG.md).
5. Rodar `npm run docs:check`.
