# Rate limit distribuído do Portal

Este procedimento cobre a segunda camada de proteção dos fluxos públicos do
Portal. A primeira camada continua no Supabase e não deve ser removida quando o
Redis estiver ativo.

## Contrato

O limite padrão é de 10 erros em 5 minutos para a combinação de IP e CNPJ:

- login: `portal-login` e verificação da senha atual na troca do Email de Recuperação;
- recuperação: pedidos de recuperação, inclusive os que não encontram conta;
- ativação: recusas de política de senha, em um balde próprio para não consumir
  as tentativas de login.

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

O Redis provisionado para esta frente é `vela-rate-limit`, na região `sa-east-1`.
O token usado para backups do R2 é de outro produto e não pode ser reutilizado.

## Validação

1. Confirmar que a migration `076_portal_activation_rate_limit.sql` foi
   aplicada antes de publicar as Edge Functions.
2. Fazer o deploy das funções `portal-login`, `portal-password-recovery`,
   `portal-recovery-email-change` e `portal-invite-activate`.
3. Em Preview, executar tentativas sintéticas e autorizadas com fixture: nove
   erros do mesmo IP+CNPJ continuam recebendo a resposta normal; a próxima
   tentativa bloqueada recebe a resposta genérica/limitada; outro IP não é
   bloqueado.
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
