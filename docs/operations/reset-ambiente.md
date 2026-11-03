# Reset do Ambiente de Testes

**Status: produção fora de alcance desde 2026-11-03; limpeza ampla disponível
só para banco descartável em `supabase/scripts/limpar_dados_teste.sql`
(2026-10-07).** O script antigo `reset_operational_data.sql`, suspenso em
2026-06-18 por cobrir o modelo antigo, foi removido; registros históricos que o
citam continuam valendo para a época deles.

## Quando pode rodar

Nunca em produção. Desde 2026-11-03 o Vela e o Portal Fwlog têm clientes reais,
e a afirmação "Data status" do `AGENTS.md` diz que nenhuma linha de produção é
fixture. De 2026-10-07 a 2026-11-03 a limpeza era permitida também em produção, quando
toda linha era fixture (afirmação de 2026-09-18, agora substituída).

Alvos aceitos: o Postgres local do `setup-local-pg.sh`, o replay do job `db` do
CI e uma branch de Supabase criada para teste. Para remover dado errado de
produção, use a ação do produto ou uma migration com plano de preservação
([WORKFLOW.md](../../WORKFLOW.md#migration-que-reescreve-ou-apaga-dados)).

## O que faz

Esvazia todas as tabelas de `public` com `TRUNCATE ... RESTART IDENTITY
CASCADE` num único comando, exceto a lista `v_preservar` do script:

- usuários (`user_profiles`);
- configuração do sistema: `app_settings`, `exchange_rate_reference`,
  `business_holidays`;
- catálogo de tipos de alerta (`alert_type_catalog`);
- catálogos e modelos de Comunicados (`customer_communication_kinds`,
  `customer_communication_boxes`, `customer_communication_templates`);
- cadastro base: `charge_tables`, `charge_table_items`, `demurrage_rates`,
  `demurrage_rate_groups`, `container_types` (migration `514`), `depots`,
  `depot_services`, `carriers`, `ports`.

Travas, todas antes de apagar qualquer coisa:

- sessão sem `SET vela.limpeza_banco_descartavel = 'confirmo'` → erro
  "Limpeza recusada: produção tem dados reais…". A confirmação é um passo
  deliberado, não detecção de produção: quem confirma responde pelo alvo;
- nome da lista que não existe em `public` → erro (digitação não deixa uma
  tabela desprotegida);
- tabela preservada com chave estrangeira para uma tabela que seria esvaziada
  → erro (o `CASCADE` a apagaria junto);
- a migration `156` faz o banco recusar o `TRUNCATE` de `app_settings`: se ela
  sair da lista, a limpeza inteira falha. Foi a ausência dela na limpeza manual
  usada até 2026-10-06 que apagou a configuração duas vezes (restaurada pelas
  migrations `104` e `155`).

Ao criar tabela de configuração ou de cadastro base, inclua-a em `v_preservar`
na mesma mudança.

## Como executar

1. Confirme que a conexão aponta para um banco descartável, nunca para o
   projeto de produção.
2. Na mesma sessão, rode `SET vela.limpeza_banco_descartavel = 'confirmo';` e
   depois o arquivo inteiro (`psql -v ON_ERROR_STOP=1 -f`, ou no SQL Editor da
   branch de teste). A mensagem final lista o que foi preservado.
3. Confira: `SELECT count(*) FROM public.app_settings WHERE id = 1` = 1 e as
   contagens de diagnóstico abaixo zeradas para os dados operacionais.

Evidência: em 2026-10-07 o script rodou duas vezes seguidas no Postgres 16
descartável (replay de todas as migrations), preservou configuração, catálogo
e cadastro base, e as duas travas foram exercitadas.

## Consultas de diagnóstico

As consultas abaixo são somente leitura. Elas ajudam a medir o estado do
ambiente, mas não autorizam exclusão.

```sql
SELECT 'import_batches' AS table_name, COUNT(*) AS total
FROM public.import_batches
UNION ALL
SELECT 'bls', COUNT(*)
FROM public.bls
UNION ALL
SELECT 'bl_containers', COUNT(*)
FROM public.bl_containers
UNION ALL
SELECT 'invoices', COUNT(*)
FROM public.invoices
UNION ALL
SELECT 'bl_receivables', COUNT(*)
FROM public.bl_receivables
UNION ALL
SELECT 'ledger_settlements', COUNT(*)
FROM public.ledger_settlements
UNION ALL
SELECT 'demurrage_invoices', COUNT(*)
FROM public.demurrage_invoices
UNION ALL
SELECT 'granite_bls', COUNT(*)
FROM public.granite_bls
UNION ALL
SELECT 'vazios_bookings', COUNT(*)
FROM public.vazios_bookings
UNION ALL
SELECT 'vazios_importacao_containers', COUNT(*)
FROM public.vazios_importacao_containers
UNION ALL
SELECT 'portal_notifications', COUNT(*)
FROM public.portal_notifications
UNION ALL
SELECT 'audit_logs', COUNT(*)
FROM public.audit_logs;
```

Para localizar uma fixture, prefira filtros por viagem, B/L, cliente ou prefixo
de arquivo: a contagem global diz quanto existe, não o que cada linha significa.
