# ADR 0062 — Consolidação de Migrações: Schema Inicial v1.0 e Arquivo Morto

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Squash e arquivo histórico permanecem; URL/segredos dos jobs usam Vault e ops.dispatch_edge_job, substituindo configuração por app.settings.*.
> Rastreabilidade: [ADR 0063](./0063-configuracao-de-jobs-cron-no-vault.md); [migration ativa 007](../../supabase/migrations/007_cron_secrets_no_vault.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-09-02

## Contexto

Ao longo da fase de desenvolvimento pré-produção do Transhipping Desk, a camada de banco de dados acumulou **383 arquivos de migração** (`001_schema.sql` a `384_comunicados_automacao_falhas.sql`, com o número 283 pulado no histórico).

Esse volume histórico representou a evolução e o amadurecimento dos módulos operacionais, financeiros e de governança, mas gerou custos operacionais e técnicos acumulados:
- **763 declarações `CREATE FUNCTION`** para 394 funções únicas (funções essenciais de cálculo e transição de estado sofreram até 13 redefinições sucessivas);
- **366 comandos `ALTER TABLE`** incrementais sobre tabelas centrais (`bls` sofreu 36 reformas; `invoices`, 21);
- **111 tabelas criadas** e 6 descontinuadas ao longo do tempo, restando 106 tabelas ativas;
- Replay substancialmente mais lento na inicialização de bancos locais descartáveis e em branches efêmeras do Supabase;
- **201 arquivos de teste (`*Migration.test.ts`)** com mais de 240 leituras estáticas (`readFileSync`, `readdirSync`) inspecionando contratos de SQL específicos em migrações históricas.

Com o sistema pronto para a versão 1.0 e antes de sua entrada formal em produção, surgiu a oportunidade ideal para realizar a consolidação técnica (*squash*) definitiva do schema.

## Decisão

1. **Substituição da cadeia em `supabase/migrations/` pelo Schema Inicial v1.0:**
   - `001_initial_schema.sql`: DDL estrutural definitivo contendo as 106 tabelas sobreviventes, sequências, tipos, chaves primárias, constraints de checagem, índices otimizados e chaves estrangeiras com comportamento `ON DELETE` explícito; inclui o catálogo canônico de portos brasileiros (`public.ports`) necessário para vínculos de terminais e escalas.
   - `002_business_logic_and_security.sql`: Lógica de negócio, funções auxiliares, triggers de manutenção de `updated_at`, funções RPCs consolidadas com `SECURITY DEFINER` e `SET search_path = public, pg_temp;`, habilitação e definição das 273 políticas RLS ativas, catálogos essenciais de sistema (`app_settings`, `customer_communication_kinds`, `customer_communication_templates`, `alert_type_catalog`) e fechamento de privilégios conforme a ADR 0047.
    - `seed.sql`: Preservado como carga canônica de reset/desenvolvimento (taxas locais, tarifas de Demurrage e serviços de terminais/depots com asserções de integridade); a migration `006` bootstrapa o mesmo catálogo quando o banco está vazio.

2. **Criação do Arquivo Morto (`supabase/migrations_archive/`):**
   - Todas as 383 migrações históricas originais são preservadas integralmente em `supabase/migrations_archive/`, com paridade criptográfica (SHA-256) atestada.
   - O diretório é estritamente de arquivo/leitura histórica e de auditoria, acompanhado de seu respectivo `README.md`.

3. **Harness de Retrocompatibilidade da Suíte de Testes:**
   - Em `src/test/setup.ts`, foi implementado um adaptador seguro para os módulos de sistema de arquivos (`node:fs` e `fs`).
   - Quando um teste requisitar um arquivo de migração histórico em `supabase/migrations/` que não esteja presente no diretório ativo, o harness redireciona a chamada de forma transparente para `supabase/migrations_archive/`.
   - Listagens de diretório (`readdirSync`) em `supabase/migrations/` passam a responder o conjunto canônico arquivado para os testes de contrato estáticos, filtrando artefatos não-SQL e preservando a validação de mais de 2.700 testes sem necessidade de reescrever centenas de arquivos de teste.
   - **Custo aceito, explicitamente:** com o redirecionamento, os 201 testes `*Migration.test.ts` deixam de enxergar o schema que é de fato aplicado — passam a auditar contratos históricos do arquivo morto. Isso vale inclusive para os testes escritos como invariante de futuro, que varrem a cadeia inteira (por exemplo `portalInvoiceDetailsAnonGrantInvariant.test.ts`). Enquanto esses testes não forem reescritos contra o schema v1.0, a cobertura do artefato ativo fica a cargo de dois gates dedicados:
     - `scripts/security/verificar_guardas.py` (job `security-audit` do CI), que faz o replay de autorização sobre `supabase/migrations/`;
     - `src/services/__tests__/consolidatedSchemaInvariants.test.ts`, que escapa do mock com `vi.importActual` e trava RLS, `search_path`, exposição a `anon` e o fechamento de defaults no diretório real.

4. **Numeração das Migrações Futuras e Correção da RPC BAPLIE:**
   - Novas migrações pós-v1.0 continuam a convenção sequencial de três dígitos (ADR 0016). A `003` está ocupada pela camada do item 5 (`003_pos_squash_objetos_fora_do_dump.sql`).
    - A migration `004_vazios_delete_baplie_grant.sql` concede `EXECUTE` em `public.delete_baplie_manifest_for_voyage(bigint)` a `authenticated` e `service_role`, sanando a omissão histórica da migration arquivada 097 (que havia revogado de `PUBLIC`/`anon` sem conceder ao papel autenticado). A migration `005_pg_net_jobs_rls_guard.sql` (nota nº 3) instala `pg_net`, reafirma os 4 jobs HTTP da 003 em bancos já provisionados e versiona a guarda `rls_auto_enable()`/`ensure_rls`. A `006_operational_contract_hardening.sql` fecha os ACLs de tabelas/sequências e RPCs, converge baselines e catálogos, e falha explicitamente quando os pré-requisitos externos não existem.

5. **Objetos fora do recorte do dump:**
   - As 001 e 002 nascem de um `pg_dump` do schema `public`. Três classes de objeto vivas em produção ficam estruturalmente fora desse recorte e precisam ser mantidas à mão: os defaults de privilégio (`pg_default_acl`, ADR 0047 / migration arquivada 297), os agendamentos `pg_cron` (schema `cron`) e os buckets e policies de Storage (schema `storage`).
   - Regenerar o dump não recupera nenhuma delas. Toda regeneração precisa reaplicar essa camada explicitamente.
   - `supabase/migrations/003_pos_squash_objetos_fora_do_dump.sql` mantém essa camada, e `scripts/build-squash-migrations.mjs` passa a abortar diante de qualquer tipo de bloco do dump que não esteja classificado — foi um descarte silencioso desses que apagou o `ALTER DEFAULT PRIVILEGES` na primeira geração.

6. **Etapa 4 — Destino dos 201 testes de migration (Roadmap):**
   - O harness de `fs` em `src/test/setup.ts` foi adotado como ponte transitória para viabilizar o squash sem reescrever centenas de testes legados.
   - Como evolução planejada pré-produção, os testes que apenas afirmavam estrutura pontual histórica ("migration N contém X") serão aposentados em bloco, enquanto os que verificam invariantes de futuro serão reescritos contra o schema ativo (`supabase/migrations/`).

## Nota editorial — 2026-09-03 (não reescreve a decisão acima)

O item 3 descreve o harness como "listagens passam a responder o conjunto
canônico arquivado". Esse comportamento foi supersessão ainda na PR 651:
`src/test/setup.ts` passa a responder a UNIÃO do diretório ativo
(`supabase/migrations/`) com o arquivo morto — ativos primeiro, sem duplicata.
Motivo: com só-arquivo, os testes escritos como invariante de futuro (ex.
`portalInvoiceDetailsAnonGrantInvariant.test.ts`) ficariam cegos às migrations
novas (`005_*` em diante); a união mantém os 201 testes legados verdes e deixa
os invariantes enxergarem o schema que é de fato aplicado. Seis testes de
contrato pontual histórico foram escopados ao arquivo morto porque o snapshot
concentrado falseava `.find`/spans; a unicidade de prefixos do ativo vive em
`consolidatedSchemaInvariants.test.ts`. O custo da ponte transitória segue
marcado com `ponytail:` em `src/test/setup.ts`, e a cobertura do artefato ativo
segue nos gates citados no item 3 mais o `migration-replay` do CI
(`scripts/check-squash-replay.sql`, replay real em PostgreSQL descartável).

## Nota editorial — 2026-09-03, nº 2 (não reescreve a decisão acima)

O item 1 da decisão diz "chaves estrangeiras com comportamento `ON DELETE`
explícito". Precisão: 48 das 201 FKs da `001` não declaram ação (ex.:
referências a `auth.users(id)` e `voyage_id` herdados da `001_schema.sql`
original) — e isso é fidelidade, não falha: o arquivo morto também não as
declara, e o replay comparado A×B em PostgreSQL 16 confirma zero divergência
de constraints. Ler como "com os comportamentos `ON DELETE` originais
preservados".

## Nota editorial — 2026-09-03, nº 3 (não reescreve a decisão acima)

Revisão final independente da PR 651 (4 bancos reais: produção, replay do
arquivo morto, replay consolidado e Preview). Veredito: sem regressão —
106 tabelas, 1.121 colunas, 397 funções com corpos idênticos entre A e B,
273 policies, 144 triggers, 307 índices e RLS em 106/106, com `alert_type_catalog` em 32/29 de conteúdo idêntico ao de produção. Ajustes assumidos aqui:

- **pg_net é política nova, não restauração (A3).** Nenhuma das 383 migrations
  jamais rodou `CREATE EXTENSION pg_net` (zero ocorrências no arquivo morto).
  Produção tem 5 jobs e nenhum pg_net; o ambiente novo sobe com 7 (+ digest
  condicional), ganhando `alerts-foundation-detectors`, `demurrage-dunning`
  e `customer-communication-auto-runner`. É defensável (as Edge Functions
  estão deployadas e ociosas sem ele), e fica explicitamente assumido como
  decisão — o mesmo rigor que recusou endurecer revokes de tabela/sequência.
- **Colocação de extensões: best-effort (M4).** Em PG vanilla, pg_trgm e
  btree_gist nascem em `public` (047/267/366 sem schema); no Supabase real a
  plataforma pré-instala extensões em `extensions` (Preview: btree_gist em
  extensions, uuid-ossp presente sem que nenhuma migration o crie) e o
  `CREATE ... IF NOT EXISTS` vira no-op. Sem impacto prático — índices e
  constraints batem nos dois layouts. Ler os comentários de colocação da 001
  como intenção, não como garantia de catálogo.
- **Catálogos e baselines (B1/B2).** A `006` tornou o contrato operacional
  executável também em bancos novos e em produção convergida: bootstrapa os
  catálogos vazios, garante as duas baselines idempotentemente e o gate verifica
  os pisos. O `seed.sql` permanece a carga de reset e a fonte de dados canônica.
- **anon sem SELECT no ambiente novo (B3).** Produção concede SELECT a anon em
  87/106 tabelas (default de plataforma materializado na criação); o ambiente
  novo concede 0 — mais restrito, com as mesmas 273 policies. As 4 tabelas em
  que o novo concede SELECT a `authenticated` sem produção conceder não têm
  policy nenhuma: a RLS nega tudo. Sem vazamento.
- **Preview reutiliza versões registradas (A1/A2).** O branching do Supabase só
  aplica arquivos novos: se 001/002 mudarem após o primeiro push, a branch
  segue híbrida até ser resetada (deletar a branch no Dashboard + novo push, ou
  fechar/reabrir a PR) e reconferida (32/29, 2 baselines, 7 jobs, 2 buckets,
  `pg_default_acl` fechado). A 003 só é validada em Supabase real — o replay
  local tem stub cron no-op e nenhum schema storage.

## Consequências

- O tempo de bootstrap de novos ambientes, bancos de testes descartáveis e branches de preview do Supabase é drasticamente reduzido.
- O histórico completo de engenharia e decisões permanece arquivado e auditável em `supabase/migrations_archive/`.
- A paridade validada é de **objetos do schema `public`**: 106 tabelas, 1.121 colunas, 397 funções do projeto (com corpos idênticos), 273 policies, 144 triggers e 307 índices conferem entre o replay das 383 migrações e o schema consolidado, medidos por consulta ao catálogo em dois bancos PostgreSQL 16 descartáveis. Evidência em [`docs/archive/reports/2026-09-02-paridade-squash-schema-v1.md`](../archive/reports/2026-09-02-paridade-squash-schema-v1.md). A paridade **não** se estende ao que vive fora de `public` — defaults de privilégio, jobs `pg_cron` e Storage —, que depende da camada descrita no item 5 da decisão. Descrever a comparação como "paridade bit a bit de 100%" seria mais forte do que a evidência sustenta.
- O banco já provisionado guarda em `supabase_migrations.schema_migrations` as versões `001`…`384`. Como os arquivos consolidados reaproveitam os prefixos `001` e `002`, um `supabase db push` contra esse projeto **não aplica nada**: o histórico remoto já registra essas versões. O procedimento operacional e comandos de reconciliação via `supabase migration repair` estão documentados em [`docs/operations/squash-schema-v1-deploy.md`](../operations/squash-schema-v1-deploy.md).
- Branches de preview do Supabase e `supabase db reset` continuam criando o banco do zero: é ali, e só ali, que os arquivos consolidados são realmente executados. Toda validação do squash depende desse caminho.

## Relação com decisões anteriores

- Estende a ADR 0010 (Validação, testes e gates de deploy).
- Atualiza a ADR 0016 (Migrations: nomenclatura numerada sequencial única), mantendo o padrão numérico a partir do marco consolidado v1.0.
- Reafirma e consolida a ADR 0047 (Grants de função fechados por padrão em `public`).
