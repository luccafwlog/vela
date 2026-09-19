# 0016 — Migrations: nomenclatura numerada sequencial única

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** A sequência histórica foi consolidada em 001/002 e preservada em migrations_archive. Novas migrations usam o maior prefixo ativo + 1; não renumerar a lacuna histórica 014.
> Rastreabilidade: [ADR 0062](./0062-consolidacao-migrations-schema-1-0.md); [migration ativa 001](../../supabase/migrations/001_initial_schema.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-06-24

## Contexto

O diretório `supabase/migrations/` acumulou **duas convenções de nome** convivendo:
55 migrations com prefixo numerado sequencial (`001_…` a `055_…`) seguidas de 104 com
timestamp UTC (`20260520132021_…` a `20260624150000_…`). O Supabase CLI aplica migrations em
ordem **lexicográfica do prefixo de versão**, então o corte era limpo (numeradas antes das
timestamped), mas o diretório era difícil de ler e a documentação (`WORKFLOW.md`) prescrevia o
timestamp como padrão "atual".

Uma auditoria estática + dinâmica das 159 migrations (ver o [registro histórico da auditoria](../archive/audits/2026-06-24-auditoria-migrations-renumeracao.md))
confirmou um estado saudável:

- correspondência **1:1** entre arquivos e `supabase_migrations.schema_migrations` (zero
  nunca-executadas, zero registradas-sem-arquivo);
- schema puramente aditivo (nenhuma coluna/tabela adicionada-e-removida);
- as únicas pendências eram cosméticas/redundantes: duas duplicatas idempotentes
  (`017` ≡ colunas de `009`; a antiga `20260520172541` ≡ `054`, byte-a-byte) e cadeias de
  `CREATE OR REPLACE FUNCTION` (evolução legítima, não removível);
- nenhuma órfã real (objetos referenciados por app/RPC/trigger).

A razão histórica para "não renomear arquivos aplicados" é que o nome é a chave de versão em
`schema_migrations`: renomear desincroniza o tracking em ambientes já provisionados, exigindo
`supabase migration repair`. Como o ambiente-alvo é **descartável** (recriável via `db reset`),
esse risco não se aplica aqui.

## Decisão

Padronizar **todas** as migrations no esquema numerado sequencial de três dígitos
(`NNN_descricao_curta.sql`), em uma renumeração pontual:

- as 104 timestamped foram renomeadas para `056_…` a `159_…`, preservando o sufixo descritivo e a
  ordem (sort lexicográfico novo = sort antigo = ordem de aplicação);
- as `001_…`–`055_…` permaneceram intactas;
- o **timestamp original** foi inserido como comentário no cabeçalho de cada arquivo renomeado
  (`-- Renumbered from <ts> (original timestamped migration: <nome antigo>).`), preservando o
  registro histórico;
- **nada foi deletado nem unificado** — as duplicatas idempotentes e as cadeias de função
  permanecem, porque o histórico já funciona e o custo de reescrevê-lo supera o ganho;
- referências ao nome antigo foram atualizadas na documentação viva (`RASTREABILIDADE.md`,
  `docs/modules/`, `docs/operations/`) e nos testes de drift (`src/services/__tests__/*Migration*`);
  os snapshots históricos (`docs/archive/`, `CHANGELOG.md`) foram preservados como estão.

A renumeração foi **validada por replay completo**: as 159 migrations foram aplicadas do zero, na
ordem nova, em um Postgres descartável, com `schema_migrations` reconstruída (159 linhas, `001`–`159`,
sem buracos) e o schema final batendo com o estado last-writer-wins do banco real
(`uq_charge_calculations_bl_key` presente; índice/função obsoletos ausentes). O `supabase db reset`
local não pôde rodar neste ambiente (a imagem `supabase/postgres` é bloqueada pela política de
egresso), por isso o replay equivalente foi usado como prova.

Daqui para frente, novas migrations seguem o próximo número sequencial disponível,
derivado do maior prefixo em `supabase/migrations/`.

## Consequências

- **Positivas:** diretório legível e previsível; uma só convenção; ordem lexicográfica = ordem de
  aplicação preservada; rastreabilidade do timestamp original mantida no cabeçalho.
- **Negativas / custos:** quebra a regra anterior de "nunca renomear migrations aplicadas" — só é
  seguro porque o banco é descartável e foi feito `db reset`/replay; em qualquer ambiente já
  provisionado exigiria `supabase migration repair`; branches paralelos passam a precisar reconciliar
  números (em vez de timestamps) antes do merge.
- **Relação:** estende a 0010 (gates de validação); atualiza `WORKFLOW.md` §5.
