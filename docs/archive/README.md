# Archive

Conteúdo **histórico e não-vivo**: planos concluídos, encerrados ou superados;
specs cuja execução foi concluída; auditorias datadas e relatórios de execução.
Preservados para trilha e contexto — **não** são fonte de verdade do estado
atual. Para o estado atual, ver a [documentação viva](../README.md).

Reorganizado em 2026-07-18: as antigas subpastas `superpowers/{plans,specs,sdd}`
foram achatadas em `plans/`, `specs/` e `reports/sdd/`; as auditorias soltas da
raiz foram agrupadas em `audits/`. Links internos dos arquivos podem refletir os
caminhos da época — o conteúdo não é editado retroativamente e o `docs:check`
não verifica este diretório.

## Estrutura

| Pasta | O que é |
|---|---|
| `plans/` | Planos de implementação concluídos, encerrados ou superados (numerados e datados, desde 2026-06). Inclui os subprojetos `2026-07-08-transhipping-desk-edi-taxas/`, `cadastro-unico-navio-viagem/` e `security-audit-2026-07-07/` |
| `specs/` | Specs / design docs aprovadas cujos planos derivados foram concluídos |
| `audits/` | Auditorias e reviews datados (técnica, QA e2e, segurança, qualidade de código, portal) |
| `reports/sdd/` | Relatórios de execução por task (subagent-driven development), agrupados por plano |
| `qa/` | Loops de QA por história e QA contínua (2026-06) |
| `design-audit/` | Auditoria UX/UI (README + `assets/` com screenshots) |
| `assets/` | Screenshots referenciados pelas auditorias de QA e o bundle de handoff do design system (`2026-06-12-design-system-handoff.zip`, movido da raiz em 2026-07-19) |

> Muitos itens dessas auditorias já foram remediados. Use-as como contexto
> histórico, não como TODO atual. O que os planos entregaram está resumido no
> [CHANGELOG](../CHANGELOG.md).

## Entrada de novos arquivos

- Plano concluído → `plans/` (movido de `docs/plans/`).
- Spec com plano concluído → `specs/` (movida de `docs/spec/`).
- Auditoria/review nova → nasce direto em `audits/`.
- Relatório de execução → nasce direto em `reports/`.

Regra completa em [`../CONVENCOES.md`](../CONVENCOES.md#ciclo-de-vida-de-planos-e-specs).
