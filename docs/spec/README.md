# Specs vivas

Specs descrevem decisões ainda não executadas. O ciclo de vida é definido em
[CONVENCOES.md](../CONVENCOES.md#ciclo-de-vida-de-planos-e-specs).

| Spec | Estado |
|---|---|
| [Remediação de UI, design system e acessibilidade](2026-09-20-remediacao-ui-design-system-design.md) | Aprovada e em execução; corrige os 15 achados da auditoria de 2026-09-20 |
| [Integração Itaú PIX](2026-08-25-integracao-itau-pix.md) | Planejamento futuro, não aprovado para execução; API dinâmica/webhook não implementados |

As specs de carga mista, Manifesto Mercante, múltiplos terminais e editor de
escala já estão em [archive/specs](../archive/specs/). Suas regras vigentes
pertencem ao glossário, arquitetura e módulos, reconciliados com o código.

As edições CSV/XLSX da especificação comportamental de 2026-07-02 e 2026-08-12
são snapshots históricos em [archive/specs](../archive/specs/), não uma spec
canônica viva. Para regenerar uma edição histórica, forneça seu caminho
explicitamente a `scripts/build-behavioral-spec.mjs`; não há CSV vivo para o
modo sem argumentos.
