# Tentativas de TRUNCATE em produção — 2026-11-03

Relatório da investigação de 2026-11-03/04 sobre os erros `25006` (`cannot
execute TRUNCATE TABLE in a read-only transaction`) no Postgres de produção
(`fgmkhbzhaeebrsizwccx`). Horários em Brasília (UTC-3). Nenhum dado foi
apagado.

## Resumo

Um bloco **"LIMPA TUDO (…)"**, marcado **WRITE**, estava na seção **Reports**
do Project Overview do projeto Vela no dashboard do Supabase. A cada abertura
ou recarga dessa página, o dashboard tentava desenhar o bloco rodando o SQL dele
com o papel `supabase_read_only_user`; o banco recusava no `TRUNCATE` e o bloco
exibia "SQL query is not read-only and cannot be rendered". Foram **32
tentativas**, todas recusadas: 27 entre 13:22:18 e 17:15:35 e 5 entre 23:21:07
e 23:33:01 de 2026-11-03, estas durante a própria investigação. Não houve
invasão nem execução manual. O dono removeu o bloco às 23:33 e as tentativas
pararam.

## O SQL

Um `DO $$ … $$` que monta a lista de todas as tabelas de `public`, menos uma
lista de preservação, e executa `TRUNCATE TABLE … RESTART IDENTITY CASCADE`.
Não é `supabase/scripts/limpar_dados_teste.sql`: o texto não aparece em nenhum
commit do repositório, não tem a confirmação `vela.limpeza_banco_descartavel`
nem as checagens de tabela ausente e de cascata, e a lista de preservação é
anterior à atual (cita `depot_tariffs` e `_prisma_migrations`; não preserva
`app_settings`, `business_holidays`, `exchange_rate_reference`,
`container_types`, `demurrage_rate_groups` nem os catálogos de Comunicados).
Teria esvaziado cerca de 150 tabelas, entre elas `customers`, `bls`,
`invoices`, `payments`, `audit_logs` e as do Pix.

## Evidências

| Afirmação | Label | Fonte |
| --- | --- | --- |
| 32 erros `25006`, `application_name=supabase/dashboard`, papel `supabase_read_only_user`, mesmo `query_id` `3312435758574820162` e mesmo texto (1.513 caracteres) | Runtime | `postgres_logs` de produção, consultados em 2026-11-04 pelo conector Supabase |
| Anotação de cada execução: `-- source: dashboard`, `-- user: session:1a41b620-c57f-4a4e-bf58-36de91dfc2fa`, `-- date: <hora do navegador>` | Runtime | Mesmo log |
| `1a41b620-…` é a conta luccafwlog@gmail.com, única integrante da organização Fwlog; IP `179.234.237.58`, confirmado pelo dono como o do Mac dele | Runtime | Account Audit Logs do dashboard (prints do dono); Organization → Team |
| Cada tentativa vem 0,2–1,8 s depois da carga de página do projeto (checagens `/health` do Realtime e do Storage; "Get project api keys" e "Gets project's network bans" no Audit Log) | Runtime | `realtime_logs`, `storage_logs` e Account Audit Logs |
| A execução do SQL em si não aparece no Account Audit Log, só a carga da página; as consultas feitas pelo conector entre 22:40 e 23:10 também não aparecem | Runtime | Account Audit Logs |
| O bloco "LIMPA TUDO (…)" com selo WRITE estava em Project Overview → Reports | Runtime | Print do dono, 2026-11-03 23:3x |
| Depois de remover o bloco, a recarga de 23:33:03 não gerou `25006` (log do banco conferido até 23:35) | Runtime | `postgres_logs` e `realtime_logs` |
| Nenhum outro `TRUNCATE TABLE` em `public` de 2026-11-01 00:00 a 2026-11-04 02:35; os "truncate" do deploy das migrations 570–574 (10:36) são de tabelas temporárias | Runtime | `postgres_logs` |
| Na branch `staging` (`uvgqfpleiyfythkhutlj`), visitada às 13:22–13:35, nenhum `TRUNCATE` e nenhum erro vindo do dashboard em 2026-11-03 | Runtime | `postgres_logs` da staging |
| `supabase_read_only_user` tem `default_transaction_read_only=on`, pertence só a `pg_read_all_data` e `pg_monitor`, e não tem `TRUNCATE` nem `DELETE` | Runtime | Catálogo de produção (`pg_roles`, `has_table_privilege`) |
| Dados intactos em 2026-11-03 23:06: `customers` 36, `bls` 141, `invoices` 68, `app_settings` 1, `audit_logs` 12.752 linhas com id máximo 226.319 (sem `RESTART IDENTITY`) | Runtime | Contagens em produção |

Um `TRUNCATE` bem-sucedido não seria registrado com a configuração de log
atual: a conclusão "nada apagado" vem das barreiras abaixo e das contagens, não
da ausência de log.

## Por que não apagou

1. O dashboard roda os blocos de Reports com `supabase_read_only_user`, em
   transação somente leitura.
2. Esse papel não tem privilégio de `TRUNCATE`; mudar o modo da transação não
   bastaria.
3. Rodado como `postgres` no SQL Editor, o texto incluía `app_settings`, e o
   gatilho da migration `156` recusaria o comando inteiro.

A terceira barreira dependia da lista do próprio snippet: com `app_settings`
na exclusão, nada impediria o esvaziamento.

## O que foi feito

- 2026-11-03 23:33: o dono removeu o bloco ("Remove chart"). O snippet continuou
  salvo no SQL Editor; o texto completo foi guardado como evidência antes, fora
  do repositório.
- 2026-11-04: o dono apagou todos os snippets do SQL Editor do projeto,
  inclusive o "LIMPA TUDO"; Shared, Favorites e Private ficaram vazios
  (conferido por ele no dashboard).
- Migration `585`: todo `TRUNCATE` em tabela de `public` passa a ser recusado,
  inclusive em cascata, salvo na sessão que rodou
  `SET vela.limpeza_banco_descartavel = 'confirmo'`
  ([reset do ambiente](../../operations/reset-ambiente.md)). Teste:
  `src/integration/truncateConfirmacao.local-pg.test.ts`.

## Pendências na data

- Aplicar a migration `585` em produção pelo fluxo normal (`staging` → `main`).
- Backups na data: o diário do Supabase (físico, não baixável) mais recente era
  de 2026-11-03 08:02, antes do primeiro dia com dados reais; o backup lógico
  diário no R2 roda às 09:00 no computador Windows
  ([serviços externos](../../operations/servicos-externos.md#backup)) e não foi
  conferido nesta investigação. Point in Time Recovery desligado; a adoção é
  decisão do dono.
