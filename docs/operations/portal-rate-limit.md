# Rate limit distribuído do Portal

Este procedimento cobre a segunda camada de proteção dos fluxos públicos do
Portal. A primeira camada continua no Supabase e não deve ser removida quando o
Redis estiver ativo.

## Contrato

O balde do Supabase, chaveado só pelo CNPJ (ADR 0049), sempre decide: se ele
bloqueia, ou se a RPC falha, a tentativa é recusada mesmo que o Redis libere, e
trocar de IP não contorna o bloqueio. O Redis só acrescenta bloqueios. Seu
limite padrão é de 10 erros em 5 minutos para a combinação de IP e CNPJ. Cada
fluxo tem seu balde no Supabase (`portal_login_attempts`, por hash do CNPJ) e
sua ação no Redis:

- login: `portal-login` e verificação da senha atual na troca do Email de
  Recuperação — Supabase bloqueia com 5 erros em 15 minutos. Desde a migration
  `410`, a tentativa é reservada antes de a senha ser conferida
  (`portal_login_reserve_attempt`, sob trava do CNPJ), já contada como erro;
  senha certa a marca como sucesso e falha do Auth a apaga
  (`portal_login_settle_attempt`). Pedidos simultâneos não passam do limite;
- recuperação: pedidos de recuperação, inclusive os que não encontram conta —
  Supabase bloqueia com 5 pedidos em 15 minutos;
- ativação: recusas de política de senha, em um balde próprio para não consumir
  as tentativas de login — Supabase bloqueia com 10 recusas em 5 minutos.

Com os limiares padrão, a camada Redis não bloqueia nada além do balde: no
login e na recuperação, depois de 5 erros (ou pedidos) do mesmo CNPJ, a 6ª
tentativa já recebe a resposta genérica/limitada vinda do Supabase, de qualquer
IP, antes de o par IP+CNPJ chegar a 10; na ativação os dois limites coincidem. A camada só acrescenta
bloqueio quando `PORTAL_RATE_LIMIT_THRESHOLD` for menor que o limite do balde
do fluxo (por exemplo, rajadas de um mesmo IP).

As chaves usam HMAC-SHA-256 de IP e CNPJ com
`PORTAL_RATE_LIMIT_HMAC_SECRET`. O endereço do Redis, o token e o segredo HMAC
ficam apenas nas variáveis server-side das Edge Functions. Logs registram
somente o comando, estado do circuito e erro técnico sanitizado.

## Configuração

No projeto Supabase de produção e em cada Preview que for exercitado, cadastrar
no Secret Management das Edge Functions:

| Variável | Valor |
|---|---|
| `UPSTASH_REDIS_REST_URL` | REST URL do database `vela-rate-limit` |
| `UPSTASH_REDIS_REST_TOKEN` | Token Upstash separado, com menor privilégio e acesso somente ao database `vela-rate-limit` |
| `PORTAL_RATE_LIMIT_HMAC_SECRET` | segredo aleatório independente do token Upstash |
| `PORTAL_RATE_LIMIT_THRESHOLD` | opcional; padrão `10` |
| `PORTAL_RATE_LIMIT_WINDOW_SECONDS` | opcional; padrão `300` |
| `PORTAL_RATE_LIMIT_TIMEOUT_MS` | opcional; padrão `750` |
| `PORTAL_RATE_LIMIT_CIRCUIT_SECONDS` | opcional; padrão `30` |
| `PORTAL_RATE_LIMIT_ENABLED` | opcional; `false` desliga a camada mesmo com os três segredos cadastrados |

O Redis provisionado para esta frente é `vela-rate-limit`, na região `sa-east-1`.
O token usado para backups do R2 é de outro produto e não pode ser reutilizado.

## Validação

1. Confirmar que a migration `076_portal_activation_rate_limit.sql` foi
   aplicada antes de publicar as Edge Functions.
2. Fazer o deploy das funções `portal-login`, `portal-password-recovery`,
   `portal-recovery-email-change` e `portal-invite-activate`.
3. Em Preview, executar tentativas sintéticas e autorizadas com fixture:
   cinco erros de login do mesmo CNPJ bloqueiam esse CNPJ por 15 minutos em
   qualquer IP (balde do Supabase); a tentativa seguinte, inclusive de outro
   IP, recebe a resposta genérica. O contador do par IP+CNPJ no Upstash aparece
   incrementado, mas com os limiares padrão não bloqueia sozinho.
4. Verificar no Upstash apenas o contador, o TTL próximo de 300 segundos e as
   métricas de erro/comando. Não registrar nem copiar chaves, CNPJs, IPs ou
   tokens.
5. Interromper temporariamente o acesso ao endpoint REST e confirmar que o
   login continua obedecendo o balde persistido do Supabase, sem liberar
   tentativas ilimitadas e sem bloquear indefinidamente todos os usuários.

Essa validação é evidência de Runtime somente quando executada no Preview ou
ambiente de produção controlado. Testes locais do adaptador são evidência de
Código/Teste e não substituem a conferência remota.

## Métricas e custo

Acompanhar no Upstash os comandos `EVAL`, erros de requisição e uso/custo do
database. O limite de 5 minutos expira chaves automaticamente. O circuito
local abre após três falhas consecutivas e tenta novamente após o intervalo
configurado; durante esse período o Supabase continua sendo a defesa ativa.

## Rollback

1. Remover `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` e
   `PORTAL_RATE_LIMIT_HMAC_SECRET` das Edge Functions; o código volta ao caminho
   persistido do Supabase sem alterar a experiência do cliente.
2. Se necessário, revogar o token Upstash separado e conferir que nenhum token
   de backup do R2 foi afetado.
3. Só remover a migration de ativação em uma migration explícita posterior; não
   reescrever a migration já aplicada.
