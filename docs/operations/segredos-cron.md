# Segredos dos jobs `pg_cron`

Como os jobs HTTP do banco encontram a URL da API e o segredo da Edge
Function que vão chamar, como rotacionar esses valores e como verificar que
nenhum deles voltou a aparecer em texto claro.

Decisão em [ADR 0063](../adr/0063-configuracao-de-jobs-cron-no-vault.md).
Implementação em `supabase/migrations/007_cron_secrets_no_vault.sql`.

## Por que não é `app.settings.*`

A role `postgres` do Supabase não é superuser e não pode criar parâmetro de
classe customizada. Tanto `ALTER DATABASE ... SET app.settings.supabase_url`
quanto `ALTER ROLE ... SET app.settings.supabase_url` falham com:

```text
ERROR: permission denied to set parameter "app.settings.supabase_url"
```

Não existe variação desse comando que funcione com os privilégios do projeto —
`ALTER SYSTEM` e a concessão de superuser estão fora de questão. Documentação
anterior que instrui a definir esses GUCs descreve um caminho impossível neste
projeto e foi corrigida no mesmo change.

## Onde os valores moram hoje

No **Supabase Vault** (extensão `supabase_vault`, schema `vault`), uma entrada
por nome:

| Nome no Vault | Consumidor | Espelha o Edge Function Secret |
|---|---|---|
| `SUPABASE_URL` | todos os jobs | — (configuração, não segredo) |
| `PORTAL_DIGEST_SECRET` | `portal-daily-digest` | `PORTAL_DIGEST_SECRET` |
| `ALERTS_DETECTOR_SECRET` | `alerts-foundation-detectors` | `ALERTS_DETECTOR_SECRET` |
| `DEMURRAGE_DUNNING_SECRET` | `demurrage-dunning` | `DEMURRAGE_DUNNING_SECRET` |
| `CUSTOMER_COMMUNICATION_AUTOMATION_SECRET` | `customer-communication-auto-runner` | `CUSTOMER_COMMUNICATION_AUTOMATION_SECRET` |
| `PORTAL_EMAIL_EVENTS_CRON_SECRET` | `portal-email-events-runner` | `PORTAL_EMAIL_EVENTS_CRON_SECRET` |
| `IMPORT_EFFECTS_CRON_SECRET` | `import-effects-runner` | `IMPORT_EFFECTS_CRON_SECRET` |
| `RECALC_CRON_SECRET` | `recalc-demurrage-ptax` | `RECALC_CRON_SECRET` |

Os nomes são iguais aos dos Edge Function Secrets de propósito: o par
banco/Function é o contrato, e rotacionar um sem o outro derruba o job.

`SUPABASE_URL` não é segredo — é a base pública da API. Ele mora no cofre para
que exista **um** caminho de leitura e **um** procedimento de rotação, não por
confidencialidade.

## Quem lê

Só `ops.dispatch_edge_job(text, text, text, text)`:

```sql
SELECT ops.dispatch_edge_job('alerts-detector', 'ALERTS_DETECTOR_SECRET');
```

O comando do job cita **nomes**; nenhum valor aparece em `cron.job.command`.

A função é `SECURITY INVOKER` de propósito: ela não empresta privilégio a
ninguém. Quem não alcança `vault.decrypted_secrets` por direito próprio
continua sem alcançar. O `pg_cron` executa o job como `postgres`, que já tem o
`SELECT` concedido pela plataforma.

O schema `ops` não concede `USAGE` a `PUBLIC`, `anon` nem `authenticated`, e não
está entre os schemas expostos pela Data API — a função não é um endpoint REST.

Com o Vault vazio (banco novo, branch de Preview), a função emite `WARNING` e
não dispara. O job continua agendado e visível; a ausência do POST é o
comportamento esperado, não falha.

## Rotacionar um segredo

Rotação é sempre **par**: Edge Function Secret e Vault, na mesma janela.

1. Gere o valor novo fora do repositório e do terminal compartilhado.
2. Atualize o Edge Function Secret pelo Console do Supabase ou por
   `supabase secrets set <NOME>=<valor>`.
3. Atualize o Vault, sem imprimir o valor:

   ```sql
   SELECT vault.update_secret(
     (SELECT id FROM vault.secrets WHERE name = 'ALERTS_DETECTOR_SECRET'),
     '<valor novo>'
   );
   ```

4. Confirme no próximo disparo (seção seguinte). Não é preciso tocar em
   `cron.job`: o comando referencia o nome, não o valor.

Trocar a base da API (projeto novo, domínio próprio) usa o mesmo
`vault.update_secret` sobre `SUPABASE_URL`.

## Verificação

Nenhuma das consultas abaixo imprime segredo.

**Nenhum job carrega literal** — deve retornar zero linhas:

```sql
SELECT jobname
FROM cron.job
WHERE command ~ $re$Bearer ' \|\| '[^']$re$
   OR command ~ $re$'X-Communication-Automation-Secret',\s*'[^']$re$;
```

**Os jobs HTTP passam pelo dispatcher** — deve retornar `ok = true` em todas as
linhas. `recalc-demurrage-ptax` **não é criado pelas migrations** (ver
"Agendar o recálculo de PTAX" abaixo), então em um banco recém-provisionado a
consulta devolve seis linhas; sete depois que ele for agendado manualmente:

```sql
SELECT jobname, schedule, active,
       command LIKE 'SELECT ops.dispatch_edge_job(%' AS ok
FROM cron.job
WHERE jobname IN ('portal-daily-digest', 'alerts-foundation-detectors',
                  'demurrage-dunning', 'customer-communication-auto-runner',
                  'portal-email-events-runner', 'import-effects-runner',
                  'recalc-demurrage-ptax')
ORDER BY jobname;
```

### Agendar o recálculo de PTAX

**Agendado em produção em 2026-10-07** (jobid 26), às 17h UTC (14h Brasília)
de segunda a sexta. Provisão de `RECALC_CRON_SECRET` em par e disparo manual
validado: HTTP 200, referência cambial de hoje persistida, zero faturas
alteradas (só havia uma Demurrage em rascunho). Primeiro ciclo agendado ainda
não observado; o teste comprovou o dispatcher e a função publicados.

A migration `018` deliberadamente **não** cria o job `recalc-demurrage-ptax`.
Criá-lo e desativá-lo no replay exigiria `UPDATE` em `cron.job`, privilégio que
o papel de migrations do Supabase não tem — a tentativa anterior abortava a
aplicação com `permission denied for table job (SQLSTATE 42501)` e impedia as
migrations seguintes de rodar. Agendar é passo operacional, executado **depois**
de validar segredo, Edge e gateway conforme a S09:

```sql
-- 1. Confirme que o segredo existe no cofre e que a Edge responde fail-closed
--    com segredo ausente/errado antes de agendar.
SELECT count(*) FROM vault.secrets WHERE name = 'RECALC_CRON_SECRET';

-- 2. Agende. cron.schedule é função da extensão e não exige ACL de tabela.
SELECT cron.schedule(
  'recalc-demurrage-ptax',
  '0 17 * * 1-5',
  $$SELECT ops.dispatch_edge_job('recalc-demurrage-ptax', 'RECALC_CRON_SECRET');$$
);

-- 3. Para pausar sem remover, use a função da extensão — nunca UPDATE direto:
--    SELECT cron.alter_job(jobid, active := false) FROM cron.job
--    WHERE jobname = 'recalc-demurrage-ptax';
```

Remover: `SELECT cron.unschedule('recalc-demurrage-ptax');`.

### Agendar o expurgo do desbloqueio de CE

**Agendado em produção em 2026-10-07** (jobid 24): sem pedidos nem documentos no módulo, um
disparo manual respondeu HTTP 200 (`removed: 0`, `expired_drafts: 0`); não havia Preview
disponível para a validação prevista. Pelo mesmo motivo, a migration `141` não cria o job `ce-unlock-cleanup`
(corrigida em 2026-10-06, depois de falhar em produção com o mesmo `42501`).
Agende somente depois de cadastrar `CE_UNLOCK_CLEANUP_SECRET` no cofre e na Edge
Function e de validar o expurgo, conforme o [manual de serviços externos](servicos-externos.md):

```sql
SELECT cron.schedule(
  'ce-unlock-cleanup',
  '0 6 * * *',
  $$SELECT ops.dispatch_edge_job('ce-unlock-cleanup', 'CE_UNLOCK_CLEANUP_SECRET', 'Authorization', 'Bearer ');$$
);
```

Remover: `SELECT cron.unschedule('ce-unlock-cleanup');`.

### Agendar o envio dos avisos do desbloqueio de CE

**Agendado em produção em 2026-10-07** (jobid 23), após cadastrar o segredo no cofre e na
Edge Function e de um disparo manual responder HTTP 200. A migration `160` não cria o job
`ce-unlock-notify-email`; em outro ambiente, agende somente depois de
cadastrar `CE_UNLOCK_CLEANUP_SECRET` (o mesmo segredo do expurgo), `RESEND_API_KEY`,
`PORTAL_FROM_EMAIL` e `PORTAL_REPLY_TO` na Edge Function:

```sql
SELECT cron.schedule(
  'ce-unlock-notify-email',
  '*/5 * * * *',
  $$SELECT ops.dispatch_edge_job('ce-unlock-notify-email', 'CE_UNLOCK_CLEANUP_SECRET', 'Authorization', 'Bearer ');$$
);
```

Remover: `SELECT cron.unschedule('ce-unlock-notify-email');`. Sem o job, os avisos do sino
continuam funcionando e as linhas de e-mail ficam pendentes em `ce_unlock_email_outbox`.

**O cofre tem as oito entradas** — deve retornar `8`:

```sql
SELECT count(*) FROM vault.secrets
WHERE name IN ('SUPABASE_URL', 'PORTAL_DIGEST_SECRET', 'ALERTS_DETECTOR_SECRET',
               'DEMURRAGE_DUNNING_SECRET', 'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET',
               'PORTAL_EMAIL_EVENTS_CRON_SECRET', 'IMPORT_EFFECTS_CRON_SECRET',
               'RECALC_CRON_SECRET');
```

**O cofre está fechado para o cliente** — as quatro colunas devem ser `false`:

```sql
SELECT has_table_privilege('anon',          'vault.decrypted_secrets', 'SELECT') AS anon_le_cofre,
       has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT') AS auth_le_cofre,
       has_schema_privilege('anon',          'ops', 'USAGE')                     AS anon_alcanca_ops,
       has_schema_privilege('authenticated', 'ops', 'USAGE')                     AS auth_alcanca_ops;
```

**Os disparos estão chegando** — status HTTP do último ciclo, sem cabeçalhos:

```sql
SELECT d.jobid, j.jobname, d.status, d.start_time
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE j.command LIKE 'SELECT ops.dispatch_edge_job(%'
ORDER BY d.start_time DESC
LIMIT 8;

SELECT id, status_code, created
FROM net._http_response
ORDER BY created DESC
LIMIT 8;
```

`status_code = 200` confirma o par (Vault, Edge Function Secret) alinhado;
`401` significa que os dois lados divergiram — refaça a rotação em par.

## Provisionar um banco novo

Um banco criado só por migrations nasce com o cofre vazio. Depois de aplicar as
migrations, cadastre as oito entradas uma única vez:

```sql
SELECT vault.create_secret('https://<ref>.supabase.co', 'SUPABASE_URL',
  'Base da API do projeto.');
SELECT vault.create_secret('<valor>', 'PORTAL_DIGEST_SECRET',
  'Espelha o Edge Function Secret de mesmo nome.');
-- idem para ALERTS_DETECTOR_SECRET, DEMURRAGE_DUNNING_SECRET e
-- CUSTOMER_COMMUNICATION_AUTOMATION_SECRET, PORTAL_EMAIL_EVENTS_CRON_SECRET,
-- IMPORT_EFFECTS_CRON_SECRET e RECALC_CRON_SECRET.
```

Até lá, os jobs ficam agendados e inertes, com `WARNING` no log a cada execução.
Mesmo com o Vault preenchido, `import-effects-runner` exige
`IMPORT_EFFECTS_RUNNER_ENABLED=true`; o job de PTAX permanece inativo até a
liberação operacional após validação de Preview e gateway.

## Risco residual

`net.http_request_queue` e `net._http_response` pertencem a `supabase_admin` e
nascem com privilégio para `PUBLIC` (`anon` e `authenticated` incluídos), sem
RLS. Enquanto a requisição está na fila, o cabeçalho `Authorization` está
legível ali. A role `postgres` não é dona dessas tabelas nem membro de
`supabase_admin`, então **não pode** revogar esse privilégio — é o único ponto
deste assunto que exige privilégio de plataforma.

Alcance real: o schema `net` não está entre os schemas expostos pela Data API,
então o cliente do navegador com a chave publicável não chega lá pelo PostgREST;
a leitura exige conexão Postgres direta como `anon`/`authenticated`. A janela é
de subsegundos — o worker do `pg_net` consome e apaga a linha da fila — e
`net._http_response` guarda resposta, não o cabeçalho enviado.

Isso vale para **qualquer** chamada HTTP autenticada saída do banco: existia
antes desta mudança e não foi introduzido por ela. Confirme em
**Data API settings** que `net` não está exposto.

**Suspeita:** não há como fechar esse privilégio com a role do projeto.
