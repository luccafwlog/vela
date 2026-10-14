# Relatório de uso observável das skills — 2026-09-18

> Este relatório é conservador: conta invocações explícitas e evidências técnicas nos históricos locais, mas não afirma detectar todos os acionamentos automáticos dos harnesses.

- **Repositório:** `/Users/luccajuliatti/Downloads/vela`
- **Gerado em:** 2026-09-18T19:59:03.201Z
- **Skills analisadas:** 14
- **Marcadores de escopo:** `/Users/luccajuliatti/Downloads/vela`, `https://github.com/luccafwlog/transhippingdesk`, `https://github.com/luccafwlog/transhippingdesk.git`
- **Período dos registros:** 2026-08-10T01:07:17.260Z a 2026-09-18T19:41:32.210Z
- **Skills com invocação explícita observável:** 2 de 14
- **Invocações explícitas contabilizadas:** 4

## Fontes consultadas

| Aplicativo | Arquivos | Eventos lidos | Observação |
| --- | ---: | ---: | --- |
| Claude Code | — | — | históricos de projetos relacionados ao Vela |
| Codex | 200 | 182241 | históricos originados pelo Codex |
| Antigravity | 42 | 17586 | conversas canônicas contendo referências ao Vela |
| OpenCode | 1 | — | banco SQLite local, sessões do Vela |
| T3 | 5 | 397 | histórico do T3 e sessões do Codex originadas pelo T3 |

## Como interpretar

- **Invocações explícitas:** o usuário pediu diretamente uma skill, por exemplo `/brainstorming` ou “use a skill brainstorming”. É o sinal mais forte disponível.
- **Evidência técnica:** um agente leu uma entrada `SKILL.md` durante uma sessão. É um sinal útil, mas pode incluir leitura preparatória e não prova que o fluxo foi determinante.
- **Menções:** o nome apareceu no prompt do usuário, mas pode ter sido apenas discussão, documentação ou comparação.
- Ausência de registro não significa que a skill nunca foi acionada; significa apenas que não foi possível observá-la nos históricos coletados.

## Ranking por evidência observável

| Ordem | Skill | Invocações explícitas | Apps | Evidência técnica | Menções | Última invocação | Confiança |
| ---: | --- | ---: | --- | ---: | ---: | --- | --- |
| 1 | eli5 | 3 | codex:1, antigravity:2 | 6 | 3 | 2026-09-15T18:51:46.000Z | alta para uso explícito |
| 2 | handoff | 1 | t3:1 | 2 | 3 | 2026-08-10T01:07:17.260Z | alta para uso explícito |
| 3 | executing-plans | 0 | — | 3 | 69 | — | baixa; proxy técnico e menção |
| 4 | writing-plans | 0 | — | 3 | 11 | — | baixa; proxy técnico e menção |
| 5 | design-audit | 0 | — | 3 | 1 | — | baixa; proxy técnico e menção |
| 6 | brainstorming | 0 | — | 3 | 0 | — | baixa; proxy técnico |
| 7 | grilling | 0 | — | 2 | 3 | — | baixa; proxy técnico e menção |
| 8 | wayfinder | 0 | — | 2 | 1 | — | baixa; proxy técnico e menção |
| 9 | frontend-design | 0 | — | 2 | 0 | — | baixa; proxy técnico |
| 10 | security-audit-penetration-testing | 0 | — | 1 | 1 | — | baixa; proxy técnico e menção |
| 11 | vela-code-review | 0 | — | 1 | 1 | — | baixa; proxy técnico e menção |
| 12 | improve-codebase-architecture | 0 | — | 1 | 0 | — | baixa; proxy técnico |
| 13 | wait-what | 0 | — | 1 | 0 | — | baixa; proxy técnico |
| 14 | writing-skills | 0 | — | 1 | 0 | — | baixa; proxy técnico |

## Limitações e próximos dados

- Os históricos do Alienware ainda não foram coletados; portanto este é um relatório do MacBook.
- Claude, Codex, Antigravity, OpenCode e T3 não oferecem neste inventário uma métrica universal de “skill acionada automaticamente”.
- OpenCode e T3 registram partes da mesma execução quando o T3 usa um provedor externo; invocações explícitas iguais são deduplicadas quando compartilham horário e texto normalizado.
- Evidência técnica continua sendo um proxy fraco: ler um `SKILL.md` pode ser preparação do agente, e não prova de que a skill mudou o resultado.
- A próxima rodada deve comparar este relatório com o Alienware e validar as famílias de maior sobreposição em cenários reais do Vela.
- Nenhuma exclusão deve ser decidida apenas por este ranking; importância de domínio e dependências continuam sendo critérios independentes.
