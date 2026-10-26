# Ferramentas da Etapa 1 do Manual do Operador

Material de trabalho usado em 2026-10-26 para produzir a
[matriz de cobertura](../../../docs/manual/README.md) e o
[relatório da Etapa 1](../../../docs/archive/reports/2026-10-26-mapeamento-manual-do-operador.md).
Guardado para quem continuar o trabalho repetir ou estender o método. Não faz
parte de nenhum check. Os caminhos dentro dos arquivos apontam para a pasta
temporária da sessão original (`/tmp/claude-0/.../scratchpad/manual`): troque
pela pasta que você usar.

| Arquivo | Para quê |
|---|---|
| `BRIEF.md` | Instruções comuns do mapeamento de uma área (formato da cobertura, destinos, setores, citação dos itens) |
| `areas-prompts.md` | Onde começar no código e nos documentos, por área |
| `assign.mjs` | Distribui o inventário (`npm run manual:inventory`) pelas 13 áreas |
| `selfcheck.mjs` | Lista os itens de uma área sem citação no arquivo de cobertura |
| `VERIFY.md` | Instruções da conferência independente de uma área |
| `DOCFIX.md` | Instruções para corrigir documento defasado (classe a) |
| `docfix-ledger.txt` | Registro de cada divergência da classe a: corrigida, onde, ou reclassificada |
| `DECIDE.md` | Instruções para transformar divergência em ficha de decisão ([página](../../../docs/manual/decisoes/README.md)) |
| `covlib.py`, `consolidate.py`, `report_tables.py`, `fora_table.py`, `assemble.py`, `relatorio-template.md.tmpl` | Montagem do relatório a partir dos arquivos de cobertura |

O inventário e o check de cobertura vivos são `scripts/manual/inventory.mjs` e
`scripts/manual/check-coverage.mjs` (`npm run manual:inventory`,
`npm run manual:coverage`), que precisam do banco local preparado por
`scripts/setup-local-pg.sh --reset`.
