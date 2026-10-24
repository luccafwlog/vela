# Segredos dos jobs `pg_cron`

Como os jobs HTTP do banco encontram a URL da API e o segredo da Edge
Function que vão chamar, como rotacionar esses valores e como verificar que
nenhum deles voltou a aparecer em texto claro.

Decisão em [ADR 0063](../adr/0063-configuracao-de-jobs-cron-no-vault.md).
Implementação em `supabase/migrations/007_cron_secrets_no_vault.sql`; tempo limite
e horários fora da rajada em `supabase/migrations/165_cron_dispatch_timeout_e_escalonamento.sql`;
disparo das rotinas de e-mail pelo evento em
`supabase/migrations/456_emails_automaticos_saem_pelo_evento.sql`
([ADR 0102](../adr/0102-emails-automaticos-saem-pelo-evento.md)).

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
| `DEMURRAGE_DUNNING_SECRET` | `demurrage-dunning` e o disparo na emissão da Invoice ([pelo evento](#disparo-pelo-evento), migration `456`) | `DEMURRAGE_DUNNING_SECRET` |
| `CUSTOMER_COMMUNICATION_AUTOMATION_SECRET` | `customer-communication-auto-runner` e o disparo pelo que deixa um alvo pronto ([pelo evento](#disparo-pelo-evento)) | `CUSTOMER_COMMUNICATION_AUTOMATION_SECRET` |
| `PORTAL_EMAIL_EVENTS_CRON_SECRET` | `portal-email-events-runner` e o disparo pelo evento gravado pelo webhook ([pelo evento](#disparo-pelo-evento)) | `PORTAL_EMAIL_EVENTS_CRON_SECRET` |
| `IMPORT_EFFECTS_CRON_SECRET` | `import-effects-runner` e o disparo pela importação (`ops.kick_import_effects_runner`, migration `218`) | `IMPORT_EFFECTS_CRON_SECRET` |
| `RECALC_CRON_SECRET` | `recalc-demurrage-ptax` | `RECALC_CRON_SECRET` |
| `ITAU_PIX_CRON_SECRET` (a cadastrar; até lá, `ITAU_PIX_ADMIN_SECRET`) | `itau-pix-queue` e o disparo da fila (`ops.kick_itau_pix_runner`, migrations `219` e `438`) | `ITAU_PIX_CRON_SECRET` (a Edge aceita também `ITAU_PIX_ADMIN_SECRET` na transição) |
| — | diagnóstico manual da `itau-pix` (equipe técnica, sem cron) | `ITAU_PIX_DIAGNOSTIC_SECRET` (só na Edge) |
| `CE_UNLOCK_CLEANUP_SECRET` | `ce-unlock-cleanup` | `CE_UNLOCK_CLEANUP_SECRET` |
| `CE_UNLOCK_NOTIFY_SECRET` (no Vault de produção, conferido em 2026-10-24; até `CE_UNLOCK_NOTIFY_SHARED_RETIRED=true`, a Edge aceita também `CE_UNLOCK_CLEANUP_SECRET`) | `ce-unlock-notify-email` (migration `438`) e o disparo pelo aviso gravado na fila ([pelo evento](#disparo-pelo-evento), só com este segredo) | `CE_UNLOCK_NOTIFY_SECRET` |

Os nomes são iguais aos dos Edge Function Secrets de propósito: o par
banco/Function é o contrato, e rotacionar um sem o outro derruba o job.

### Um segredo por rotina (auditoria run-3)

Decisão do dono de 2026-10-22: cada rotina com o próprio segredo. Antes,
`ITAU_PIX_ADMIN_SECRET` servia ao cron Itaú, ao disparo da fila e ao
diagnóstico, e `CE_UNLOCK_CLEANUP_SECRET` servia ao expurgo e aos avisos do
Desbloqueio de CE. A migration `438` faz o job `itau-pix-queue`, o disparo
`ops.kick_itau_pix_runner` e o job `ce-unlock-notify-email` (se existir)
escolherem o segredo pelo nome com `ops.preferred_vault_secret(próprio,
compartilhado)`: o próprio quando está no Vault, o compartilhado enquanto não
está. Não é preciso reagendar job.

Ordem da troca, com um valor novo de 32 caracteres aleatórios ou mais por
segredo:

1. **Itaú, rotina:** cadastre `ITAU_PIX_CRON_SECRET` nos secrets das Edge
   Functions e depois no Vault, com o mesmo valor. A Edge aceita o novo e o
   antigo; o cron passa ao novo assim que ele está no Vault, sem rodada
   recusada.
2. **Itaú, diagnóstico:** cadastre `ITAU_PIX_DIAGNOSTIC_SECRET` só na Edge e
   use-o nas chamadas manuais.
3. **Fim da transição Itaú:** confira no histórico do cron (`cron.job_run_details`)
   que `itau-pix-queue` segue `succeeded`, e apague `ITAU_PIX_ADMIN_SECRET` da
   Edge e do Vault.
4. **Avisos do Desbloqueio de CE:** cadastre `CE_UNLOCK_NOTIFY_SECRET` na Edge
   e depois no Vault, com o mesmo valor. A função dos avisos aceita o novo e o
   do expurgo (`CE_UNLOCK_CLEANUP_SECRET`) durante a troca, sem rodada
   recusada.
5. **Fim da transição dos avisos:** confira no histórico do cron que
   `ce-unlock-notify-email` segue `succeeded` e cadastre
   `CE_UNLOCK_NOTIFY_SHARED_RETIRED=true` nos secrets das Edge Functions. Os
   secrets valem para o projeto inteiro e `CE_UNLOCK_CLEANUP_SECRET` continua
   do expurgo, por isso ele não é apagado: a variável é que tira dele o acesso
   aos avisos.

`SUPABASE_URL` não é segredo — é a base pública da API. Ele mora no cofre para
que exista **um** caminho de leitura e **um** procedimento de rotação, não por
confidencialidade.

## Quem lê

Os jobs leem o cofre por `ops.dispatch_edge_job(text, text, text, text)`:

```sql
SELECT ops.dispatch_edge_job('alerts-detector', 'ALERTS_DETECTOR_SECRET');
```

O comando do job cita **nomes**; nenhum valor aparece em `cron.job.command`.
Desde a migration `456` essa forma (2 ou 4 argumentos) manda o corpo `{}` pela
forma de 5 argumentos, `ops.dispatch_edge_job(função, segredo, cabeçalho,
prefixo, corpo)`, que é a implementação (Vault, timeout de 30 s); a Edge lê o
corpo vazio como execução do cron.

O dispatcher é `SECURITY INVOKER` de propósito: ele próprio não empresta
privilégio a ninguém. Chamado pelo `pg_cron`, roda como `postgres`, que já tem
o `SELECT` concedido pela plataforma.

Além dos jobs, três funções `SECURITY DEFINER` (donas `postgres`) leem o cofre
dentro da transação de quem usa a tela, acionadas por gatilho:

- `ops.kick_import_effects_runner()` (migration `218`), chamada pelo gatilho
  `AFTER INSERT` em `import_pending_effects` quando a instrução grava efeito
  `pending` ou `retry_wait` (a importação de planilha): confere no cofre se
  `SUPABASE_URL` e `IMPORT_EFFECTS_CRON_SECRET` existem e chama o dispatcher,
  que então roda com o privilégio do dono;
- `ops.kick_itau_pix_runner()` (migration `219`), chamada pelos gatilhos
  `AFTER INSERT` e `AFTER UPDATE` em `itau_pix_charges` quando a instrução
  deixa cobrança pendente já vencida (a emissão ou mudança de uma fatura): lê
  `SUPABASE_URL` e `ITAU_PIX_ADMIN_SECRET` e monta o próprio `net.http_post`
  com `{"action":"process_charges"}`, sem passar pelo dispatcher. Desde a
  migration `438`, lê `ITAU_PIX_CRON_SECRET` quando ele está no Vault;
- `ops.kick_edge_job(...)` (migration `456`), chamada pelos gatilhos das
  rotinas de e-mail ([Disparo pelo evento](#disparo-pelo-evento)): confere o
  par no cofre e chama o dispatcher com `{"source":"trigger"}` e o segredo
  dedicado da rotina.

As três disparam no máximo uma vez por transação, não devolvem o valor lido,
não são executáveis por `PUBLIC`, `anon` nem `authenticated` e, sem o par no
cofre, não fazem nada. São a exceção decidida à
[ADR 0063](../adr/0063-configuracao-de-jobs-cron-no-vault.md), que reservava a
leitura do cofre ao `pg_cron`: as pontes `218` e `219` podem ler o segredo a
partir da importação ou da emissão feita pelo usuário, e a exposição aceita é
que a chamada com o segredo passa pela fila do `pg_net`
([ADR 0083](../adr/0083-decisoes-da-revisao-geral-da-documentacao.md), item 5,
estendido às rotinas de e-mail pela
[ADR 0102](../adr/0102-emails-automaticos-saem-pelo-evento.md)).

O schema `ops` não concede `USAGE` a `PUBLIC`, `anon` nem `authenticated`, e não
está entre os schemas expostos pela Data API — a função não é um endpoint REST.

A chamada ao `pg_net` usa `timeout_milliseconds := 30000` (migration `165`);
ver [Horários e tempo limite dos disparos](#horários-e-tempo-limite-dos-disparos).

Com o Vault vazio (banco novo, branch de Preview), a função emite `WARNING` e
não dispara. O job continua agendado e visível; a ausência do POST é o
comportamento esperado, não falha.

## Horários e tempo limite dos disparos

**Sintoma (produção, 2026-10-08):** `net._http_response` com `status_code`
nulo, `timed_out = true` e `Timeout of 5000 ms reached`, sempre em :00/:15/:30/:45,
quando vários jobs disparavam no mesmo minuto. Na maioria das linhas o tempo
inteiro foi gasto em DNS (`DNS time: ~5000 ms`); em algumas o DNS foi rápido e
a Function passou de 5 s. A chamada não chegava à Edge Function e a rodada era
perdida até o ciclo seguinte (uma hora, na Régua de Cobrança).

**Causa:** até a `165`, o dispatcher não passava `timeout_milliseconds`, então
valia o padrão de 5000 ms do `pg_net`, que inclui a resolução de nome. Uma
consulta DNS sem resposta na primeira tentativa só é refeita pelo resolvedor
depois de ~5 s, exatamente quando o orçamento acabava. O `pg_net` não tem retry.
**Inferência:** o mecanismo exato do DNS do worker não é observável pelo projeto;
o padrão de ~5000 ms em DNS e a concentração nos minutos de rajada sustentam
essa leitura.

**Correção (migration `165`):**

- o dispatcher passa `timeout_milliseconds := 30000`. Vale para todo job que o
  chama, inclusive os agendados manualmente;
- os jobs criados por migrations saem dos minutos cheios, via
  `cron.alter_job` (preserva jobid, comando e estado ativo):

| Job | Antes | Depois |
|---|---|---|
| `alerts-foundation-detectors` | `*/15 * * * *` | `2-59/15 * * * *` (:02/:17/:32/:47) |
| `import-effects-runner` | `*/5 * * * *` | `3-59/5 * * * *` (:03/:08/…/:58); desde a migration `218`, `* * * * *` |
| `customer-communication-auto-runner` | `*/15 * * * *` | `4-59/15 * * * *` (:04/:19/:34/:49) |
| `demurrage-dunning` | `0 * * * *` | `7 * * * *` |

`portal-daily-digest` (11:00 UTC) e os jobs por minuto (`portal-email-events-runner`,
`itau-pix-queue`) não mudam. Desde a migration `456`,
`customer-communication-auto-runner` roda em `1-59/2 * * * *` e
`demurrage-dunning` em `3-59/5 * * * *`, também por `cron.alter_job`, com o
disparo pelo evento ([Disparo pelo evento](#disparo-pelo-evento)). Os jobs então agendados à mão
(`ce-unlock-notify-email`, `ce-unlock-cleanup`, `recalc-demurrage-ptax`,
`itau-pix-queue`) não são tocados por essa migration; recebem só o timeout novo.
Desde a migration `358`, `recalc-demurrage-ptax` e `itau-pix-queue` são
recriados pela cadeia, com o mesmo nome e corpo.

**Risco residual:** uma falha que dure mais de 30 s (DNS fora do ar, Function
travada) ainda perde a rodada. Se reaparecer, o próximo passo é um job de
reconciliação que leia `net._http_response` e redispare uma vez. Desde a
migration `310`, o job SQL `http-job-failures` (a cada 15 min) lê
`net._http_response` e abre o Alerta `rotina_http_falhou` para resposta fora de
2xx, sem status ou com tempo esgotado na última hora; ele avisa, não redispara
([observabilidade](observabilidade.md#respostas-de-erro-das-rotinas-http)).

**Verificar depois de aplicar:** nenhuma linha recente com `timed_out` nos
minutos de rajada:

```sql
SELECT date_trunc('minute', created) AS minuto, count(*) FILTER (WHERE timed_out) AS timeouts,
       count(*) AS respostas
FROM net._http_response
WHERE created > now() - interval '24 hours'
GROUP BY 1
HAVING count(*) FILTER (WHERE timed_out) > 0
ORDER BY 1 DESC;

SELECT jobname, schedule, active FROM cron.job
WHERE jobname IN ('alerts-foundation-detectors', 'import-effects-runner',
                  'customer-communication-auto-runner', 'demurrage-dunning')
ORDER BY jobname;
```

## Disparo pelo evento

Desde a migration `456`
([ADR 0102](../adr/0102-emails-automaticos-saem-pelo-evento.md)), as rotinas de
e-mail não esperam o próximo ciclo do cron: o gatilho no evento chama
`ops.kick_edge_job(função, segredo, cabeçalho, prefixo, intervalo)`, que manda
`{"source":"trigger"}` à Edge Function com o segredo **dedicado** da rotina. O
job continua como rede de segurança (reenvios, disparos perdidos e o que vence
pelo relógio).

| Rotina | Gatilho (tabela e evento) | Segredo e cabeçalho | Intervalo mínimo | Job |
|---|---|---|---|---|
| `ce-unlock-notify-email` | `ce_unlock_email_outbox`, inserção (por instrução) | `CE_UNLOCK_NOTIFY_SECRET`, `Authorization: Bearer` | nenhum | `*/5 * * * *` (à mão) |
| `portal-email-events-runner` | `portal_email_events`, evento `pending` gravado pelo webhook | `PORTAL_EMAIL_EVENTS_CRON_SECRET`, `Authorization: Bearer` | nenhum | `* * * * *` |
| `customer-communication-auto-runner` | `bls` (B/L com Cliente inserido; Cliente, Viagem, porto, terminal, faturamento, CE, revisão, peso, cancelamento ou cálculo das taxas mudou); `audit_logs` (ETA, ATA, omissão ou exclusão da Escala); `voyage_escala_terminal_state` (ATB); `customer_contact_box_links` (contato ligado a caixa); `customer_contacts` (e-mail trocado ou contato reativado) | `CUSTOMER_COMMUNICATION_AUTOMATION_SECRET`, `X-Communication-Automation-Secret` | 90 s | `1-59/2 * * * *` |
| `demurrage-dunning` | `demurrage_invoices`, Invoice emitida (`first_billed_at`), só com a janela de dia útil aberta | `DEMURRAGE_DUNNING_SECRET`, `Authorization: Bearer` | 60 s | `3-59/5 * * * *` |

Regras do disparo:

- **Depois do COMMIT.** O `pg_net` só envia quando a transação termina; rollback
  não dispara nada.
- **Uma vez por transação** e rotina (trava `vela.kick_<rotina>`): uma
  importação de centenas de B/Ls chama o runner uma vez.
- **Intervalo mínimo** em `ops.edge_job_kicks` (`last_kicked_at`): o primeiro
  evento dispara na hora; os seguintes, dentro do intervalo, ficam para o cron
  ou para o próximo disparo, e saem sem travar a linha da rotina, para não fazer outra transação, já fora do intervalo, pular o
  disparo. A linha de outra transação que está disparando a mesma rotina não é
  esperada (`SKIP LOCKED`): com intervalo, conta como disparo em andamento; sem
  intervalo, dispara sem registrar.
- **Só o segredo dedicado.** O compartilhado de transição da migration `438`
  (`CE_UNLOCK_CLEANUP_SECRET`) não serve ao disparo. Sem o par `SUPABASE_URL` e
  segredo no Vault, nada dispara e nada é avisado; o job, que passa pelo
  dispatcher, é quem avisa com `WARNING`.
- **Falha não derruba a gravação.** Erro no disparo vira `WARNING`; o cron
  processa.
- **Heartbeat só do cron.** A Edge Function lê o corpo: com
  `{"source":"trigger"}` roda a mesma rodada e não reporta ao Better Stack
  (`runCronWithBetterStackHeartbeat`, `_shared/betterStackHeartbeat.ts`).

A fila do Desbloqueio de CE é lida com reserva (`ce_unlock_email_pending`:
`FOR UPDATE SKIP LOCKED` e `claimed_until` de 10 minutos), para a rodada do
gatilho e a do cron não pegarem a mesma linha
([Desbloqueio de CE](../modules/desbloqueio-ce.md#avisos-ao-cliente)).

**Verificar.** Último disparo de cada rotina e a resposta da Edge Function
(nenhuma das consultas imprime segredo):

```sql
SELECT k.function, k.last_kicked_at, r.status_code, r.timed_out, r.created
FROM ops.edge_job_kicks k
LEFT JOIN net._http_response r ON r.id = k.last_request_id
ORDER BY k.function;
```

`net._http_response` guarda as respostas por algumas horas; sem linha, o
disparo é mais antigo que a retenção do `pg_net`. As rotinas sem intervalo
(avisos do Desbloqueio de CE e eventos) só registram quando pegam a linha sem
disputa.

**Medir no ambiente** (staging ou produção, depois do deploy da `456` e com o
Vault e os secrets da Edge provisionados):

1. Desbloqueio de CE: recuse um documento de uma solicitação de teste e confira
   o intervalo entre `ce_unlock_email_outbox.created_at` e o evento
   `email.delivered` da tentativa (`portal_email_events.received_at` ligado a
   `portal_email_attempts` pelo `provider_message_id`). Meta: menos de 10 s.
2. CE e Taxas: com um Cliente × Viagem prestes a ficar pronto, fature o último
   B/L e confira o intervalo até `customer_communications.created_at` do
   `ce_mercante_taxas` e até o `email.delivered`. Meta: até ~3 min.
3. Régua de Cobrança: emita uma Invoice de Demurrage dentro da janela e confira
   o intervalo até o Comunicado `cobranca_demurrage`.
4. Heartbeats do Better Stack: continuam vindo só no ritmo do cron.

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

Alternativa usada em 2026-10-08 para os cinco segredos antigos: gerar o valor no
próprio banco e gravá-lo no Vault, ler na mesma sessão do SQL Editor e copiar
para o Edge Function Secret, sem passar por arquivo ou terminal:

```sql
SELECT vault.update_secret(id, encode(extensions.gen_random_bytes(32), 'hex'))
FROM vault.secrets WHERE name = 'ALERTS_DETECTOR_SECRET';
SELECT name, decrypted_secret FROM vault.decrypted_secrets
WHERE name = 'ALERTS_DETECTOR_SECRET';
```

Entre a gravação no Vault e a no Edge Function Secret, os disparos recebem
`401`; os jobs de minuto em minuto perdem um ou dois ciclos. Para testar o
`portal-daily-digest` fora do horário, `SELECT ops.dispatch_edge_job(
'portal-daily-digest', 'PORTAL_DIGEST_SECRET')` devolve o id do pedido, e
`net._http_response` com esse id mostra o status (envia o resumo interno).

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
linhas. Desde a migration `358`, `recalc-demurrage-ptax` e `itau-pix-queue`
são criados pela cadeia (com o `ops.dispatch_edge_job` presente; sem ele, a
`358` só avisa por WARNING). `ce-unlock-cleanup` e `ce-unlock-notify-email`
**não são criados pelas migrations** (ver as seções de agendamento abaixo),
então em um banco recém-provisionado a consulta devolve oito linhas; dez depois
que os dois forem agendados manualmente, como em produção:

```sql
SELECT jobname, schedule, active,
       command LIKE 'SELECT ops.dispatch_edge_job(%' AS ok
FROM cron.job
WHERE jobname IN ('portal-daily-digest', 'alerts-foundation-detectors',
                  'demurrage-dunning', 'customer-communication-auto-runner',
                  'portal-email-events-runner', 'import-effects-runner',
                  'recalc-demurrage-ptax', 'itau-pix-queue',
                  'ce-unlock-cleanup', 'ce-unlock-notify-email')
ORDER BY jobname;
```

### Agendar o recálculo de PTAX

**Agendado em produção em 2026-10-07** (jobid 26), às 17h UTC (14h Brasília)
de segunda a sexta. Provisão de `RECALC_CRON_SECRET` em par e disparo manual
validado: HTTP 200, referência cambial de hoje persistida, zero faturas
alteradas (só havia uma Demurrage em rascunho). Primeiro ciclo agendado
observado em 2026-10-08 às 17:00 UTC (`cron.job_run_details`).

Desde a migration `358` a cadeia recria o job (`cron.unschedule` e
`cron.schedule`, sem `UPDATE` em `cron.job`); o roteiro abaixo serve para
recriá-lo à mão. A migration `018` deliberadamente **não** criava o job.
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
cadastrar `CE_UNLOCK_NOTIFY_SECRET` (segredo próprio desde a auditoria run-3), `RESEND_API_KEY`,
`PORTAL_FROM_EMAIL` e `PORTAL_REPLY_TO` na Edge Function:

```sql
SELECT cron.schedule(
  'ce-unlock-notify-email',
  '*/5 * * * *',
  $$SELECT ops.dispatch_edge_job('ce-unlock-notify-email', ops.preferred_vault_secret('CE_UNLOCK_NOTIFY_SECRET', 'CE_UNLOCK_CLEANUP_SECRET'), 'Authorization', 'Bearer ');$$
);
```

Remover: `SELECT cron.unschedule('ce-unlock-notify-email');`. Sem o job, os avisos do sino
continuam funcionando e as linhas de e-mail ficam pendentes em `ce_unlock_email_outbox`.
Com a chave de envio desligada, a função não exige `RESEND_API_KEY` nem remetente: registra
os avisos como `simulated` (migration `307`).

**O cofre tem as dez entradas** — deve retornar `10`:

```sql
SELECT count(*) FROM vault.secrets
WHERE name IN ('SUPABASE_URL', 'PORTAL_DIGEST_SECRET', 'ALERTS_DETECTOR_SECRET',
               'DEMURRAGE_DUNNING_SECRET', 'CUSTOMER_COMMUNICATION_AUTOMATION_SECRET',
               'PORTAL_EMAIL_EVENTS_CRON_SECRET', 'IMPORT_EFFECTS_CRON_SECRET',
               'RECALC_CRON_SECRET', 'ITAU_PIX_ADMIN_SECRET',
               'CE_UNLOCK_CLEANUP_SECRET');
-- Depois da troca da auditoria run-3: 'ITAU_PIX_CRON_SECRET' no lugar de
-- 'ITAU_PIX_ADMIN_SECRET', mais 'CE_UNLOCK_NOTIFY_SECRET'.
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
migrations, cadastre as dez entradas uma única vez:

```sql
SELECT vault.create_secret('https://<ref>.supabase.co', 'SUPABASE_URL',
  'Base da API do projeto.');
SELECT vault.create_secret('<valor>', 'PORTAL_DIGEST_SECRET',
  'Espelha o Edge Function Secret de mesmo nome.');
-- idem para ALERTS_DETECTOR_SECRET, DEMURRAGE_DUNNING_SECRET,
-- CUSTOMER_COMMUNICATION_AUTOMATION_SECRET, PORTAL_EMAIL_EVENTS_CRON_SECRET,
-- IMPORT_EFFECTS_CRON_SECRET, RECALC_CRON_SECRET, ITAU_PIX_CRON_SECRET,
-- CE_UNLOCK_CLEANUP_SECRET e CE_UNLOCK_NOTIFY_SECRET (ITAU_PIX_ADMIN_SECRET só
-- até o fim da transição da auditoria run-3).
```

Até lá, os jobs ficam agendados e inertes, com `WARNING` no log a cada execução.
Mesmo com o Vault preenchido, `import-effects-runner` exige
`IMPORT_EFFECTS_RUNNER_ENABLED=true` (ligado em produção em 2026-10-12). Além do
job, a migration `218` dispara o runner a cada transação que grava efeito
pendente, por `ops.kick_import_effects_runner()`; sem o par no Vault esse
disparo não acontece e não gera `WARNING`. Só um runner trabalha por vez
(`ops.import_effects_runner_lease`). Em banco novo, o job de PTAX não existe
até ser agendado (seção [Agendar o recálculo de PTAX](#agendar-o-recálculo-de-ptax)).

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
antes desta mudança e não foi introduzido por ela. Desde as migrations `218` e
`219`, a chamada com o segredo também entra na fila a cada importação que grava
efeito e a cada cobrança Pix que fica pendente, e desde a `456`, a cada evento
das rotinas de e-mail (com o intervalo mínimo de cada uma), não só a cada ciclo
do `pg_cron` (ver [Quem lê](#quem-lê)). Confirme em
**Data API settings** que `net` não está exposto.

**Suspeita:** não há como fechar esse privilégio com a role do projeto.
