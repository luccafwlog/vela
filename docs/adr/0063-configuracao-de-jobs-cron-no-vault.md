# ADR 0063 — Configuração dos jobs `pg_cron` mora no Supabase Vault, não em `app.settings.*`

> **Situação atual (2026-10-24).** A decisão vale e foi implementada na migration `007`; a `165` deu 30 s ao dispatcher e deslocou os horários, e os segredos de job criados depois seguem o mesmo contrato de nomes no Vault. A leitura do cofre não é mais só do `pg_cron`: a [ADR 0083](./0083-decisoes-da-revisao-geral-da-documentacao.md) (item 5) a abriu aos disparos das migrations `218` e `219`, e a [ADR 0102](./0102-emails-automaticos-saem-pelo-evento.md) às rotinas de e-mail chamadas pela transação do evento (`ops.kick_edge_job`, migration `456`). Regra vigente em [Segredos dos jobs](../operations/segredos-cron.md#quem-lê).
> Não vale mais o caminho único de leitura dos itens 2 a 4 sem exceção: pela [ADR 0083](./0083-decisoes-da-revisao-geral-da-documentacao.md) (item 5), `ops.kick_import_effects_runner` (migration `218`) e `ops.kick_itau_pix_runner` (`219`), `SECURITY DEFINER` e acionados por gatilho na importação e na cobrança Pix, podem ler o segredo do Vault além do job do `pg_cron`; a exposição aceita é a chamada com o segredo na fila do `pg_net`.
> Regra vigente em [Segredos dos jobs `pg_cron`](../operations/segredos-cron.md), seções "Onde os valores moram hoje" e "Quem lê", e em [Serviços externos](../operations/servicos-externos.md), seção "Jobs agendados (`pg_cron`)".

Status: supersedida parcialmente — 2026-09-03

## Contexto

Quatro jobs `pg_cron` chamam Edge Functions por `pg_net` e precisam de dois
valores em tempo de execução: a base da API do projeto e o segredo que a
Function exige no cabeçalho.

| Job | Function | Cabeçalho |
|---|---|---|
| `portal-daily-digest` | `portal-daily-digest` | `Authorization: Bearer …` |
| `alerts-foundation-detectors` | `alerts-detector` | `Authorization: Bearer …` |
| `demurrage-dunning` | `demurrage-dunning` | `Authorization: Bearer …` |
| `customer-communication-auto-runner` | `customer-communication-auto-runner` | `X-Communication-Automation-Secret` |

As migrations arquivadas `185`, `319`, `378` e `381`, e depois a `003` e a
`005`, resolviam esses valores por GUCs de classe customizada
(`app.settings.supabase_url`, `app.settings.digest_secret`,
`app.settings.alerts_detector_secret`,
`app.settings.demurrage_dunning_secret`,
`app.settings.customer_communication_automation_secret`), lidos com
`current_setting(..., true)` e um literal de fallback quando ausentes.

Nenhuma migration do repositório definia esses GUCs, e a documentação instruía
o operador a defini-los. Na convergência de produção da PR 651 isso se mostrou
**impossível**: a role `postgres` do Supabase não é superuser e não pode criar
parâmetro de classe customizada. Tanto `ALTER DATABASE ... SET` quanto
`ALTER ROLE ... SET` falham com `permission denied to set parameter
"app.settings.supabase_url"`, e `ALTER SYSTEM` e concessão de superuser estão
fora de questão num projeto gerenciado.

Para deixar os jobs funcionando, a convergência gravou URL e segredo como
**literais dentro de `cron.job.command`**. Isso funciona, e é a razão de os
oito jobs estarem ativos hoje, mas coloca segredo em texto claro numa tabela:
legível por qualquer conexão `postgres`, pelo Console e por qualquer dump
daquela tabela, e visível em qualquer inspeção de rotina do agendamento.

## Decisão

1. **O mecanismo de configuração dos jobs passa a ser o Supabase Vault.**
   A extensão `supabase_vault` já está instalada. Cinco entradas, nomeadas
   igual aos Edge Function Secrets correspondentes: `SUPABASE_URL`,
   `PORTAL_DIGEST_SECRET`, `ALERTS_DETECTOR_SECRET`,
   `DEMURRAGE_DUNNING_SECRET` e
   `CUSTOMER_COMMUNICATION_AUTOMATION_SECRET`. Nomes iguais são o contrato:
   banco e Function rotacionam em par.

2. **`SUPABASE_URL` mora no cofre mesmo não sendo segredo.** É a base pública
   da API. Fica ali para existir um único caminho de leitura e um único
   procedimento de rotação, e para que a migration não fixe o *project ref* —
   branches efêmeras de Preview (ADR 0056) têm ref próprio.

3. **Um dispatcher único lê o cofre: `ops.dispatch_edge_job(text, text, text,
   text)`.** O comando do job passa a citar apenas nomes:
   `SELECT ops.dispatch_edge_job('alerts-detector', 'ALERTS_DETECTOR_SECRET');`

4. **A função é `SECURITY INVOKER`, não `SECURITY DEFINER`.** É o ponto
   central da decisão: ela não empresta privilégio. Quem não alcança
   `vault.decrypted_secrets` por direito próprio continua sem alcançar. O
   `pg_cron` executa o job como `postgres`, que já tem o `SELECT` concedido
   pela plataforma. `SECURITY DEFINER` funcionaria e seria pior — criaria um
   caminho de escalonamento onde não é preciso nenhum.

5. **A função vive no schema `ops`, não em `public`.** `ops` não concede
   `USAGE` a `PUBLIC`, `anon` nem `authenticated`, e não está entre os schemas
   expostos pela Data API: a função não vira endpoint REST. É o primeiro
   schema próprio do projeto fora de `public`; ele é reservado a superfície
   operacional server-side (cron, `pg_net`) e não deve receber tabela de
   domínio.

6. **Cofre vazio não é falha.** Banco novo e branch de Preview nascem sem as
   entradas; a função emite `WARNING` e não dispara. O job continua agendado e
   visível. Isso substitui o comportamento anterior de disparar contra
   `https://invalid-….invalid` a cada 15 minutos.

7. **Os oito jobs passam a ser incondicionais.** Antes, `portal-daily-digest`
   só era agendado quando os GUCs existissem — o que nunca acontecia. Agora os
   oito existem em qualquer banco, e o que varia é o cofre estar preenchido.

Implementada em `supabase/migrations/007_cron_secrets_no_vault.sql`, que também
semeia o cofre a partir dos literais dos comandos legados — move o que já
existe, sem gerar segredo novo e sem imprimir valor — e carrega a verificação
executável que aborta se algum comando ainda expuser literal.

Procedimento operacional em
[`docs/operations/segredos-cron.md`](../operations/segredos-cron.md).

## Consequências

- Rotação passa a ser `vault.update_secret(...)` mais o Edge Function Secret,
  sem tocar em `cron.job`.
- `app.settings.*` deixa de ser mecanismo de configuração do projeto. A
  documentação que instruía a defini-los descrevia um caminho impossível e foi
  corrigida no mesmo change (`WORKFLOW.md`, `docs/ARCHITECTURE.md`,
  `docs/setup/deploy.md`, `docs/operations/squash-schema-v1-deploy.md`).
  As migrations `003` e `005` preservam a leitura por `current_setting` no
  registro histórico; a `007` as sucede em efeito.
- Um schema novo (`ops`) entra no banco. `scripts/security/verificar_guardas.py`
  faz replay estático só de `public`: objetos em `ops` ficam fora do alcance
  dele por construção, e a contrapartida é a verificação executável dentro da
  própria migration mais o teste de contrato
  `src/services/__tests__/cronSecretsVaultMigration.test.ts`.
- **Não resolvido, e fora do alcance da role do projeto:**
  `net.http_request_queue` e `net._http_response` pertencem a `supabase_admin`
  e nascem com privilégio para `PUBLIC`, sem RLS. Enquanto a requisição está na
  fila, o cabeçalho `Authorization` está legível ali por quem tiver conexão
  Postgres direta. `postgres` não é dono nem membro de `supabase_admin` e não
  pode revogar. Vale para qualquer chamada HTTP autenticada saída do banco —
  é anterior a esta decisão e não foi introduzido por ela. Detalhe e alcance
  real em [`docs/operations/segredos-cron.md`](../operations/segredos-cron.md).

## Alternativas rejeitadas

- **Insistir em `app.settings.*`.** Bloqueado por privilégio, sem variação que
  funcione. Manter a instrução na documentação seria manter um caminho morto.
- **Tabela protegida em schema privado.** Funciona, mas guarda o segredo em
  texto claro numa tabela — o mesmo defeito de `cron.job.command`, só que com
  ACL melhor. O Vault cifra em repouso e já existe.
- **Subconsulta ao Vault embutida no comando de cada job.** Tira o segredo do
  texto sem função nenhuma, e é a alternativa mais curta. Rejeitada porque
  repete a leitura em quatro comandos e não tem onde colocar o desvio de
  "cofre vazio": cada job passaria a falhar de forma ruidosa em todo banco
  novo.
- **`SECURITY DEFINER` com `search_path` fechado.** Desnecessário: o executor
  do job já tem o privilégio. Adicionaria escalonamento sem resolver nada.
