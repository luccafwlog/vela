# Segurança

> A fronteira de autorização vive no **banco** (RLS + RPCs `SECURITY DEFINER`). Checagens no cliente são apenas UX.

---

## RLS-first

- **RLS ativo em todas as tabelas.** Acesso segmentado por role via helpers `is_admin()`, `is_active_user()`, `current_user_role()` (ADR 0004).
- **Dados financeiros:** leitura interna usa `is_active_read_user()`; escrita depende da RPC/policy e das exceções das ADRs 0046/0060. Não presumir restrição universal a admin.
- A lógica financeira sensível (criar invoice, numerar, consolidar, PIX) roda em **RPCs `SECURITY DEFINER`** transacionais — o cliente não escreve direto nessas tabelas.
- **Default-deny em funções** (ADR 0011, reforçada pela ADR 0047): desde a migration `297`, o `ALTER DEFAULT PRIVILEGES` de `public` **revoga** `EXECUTE` de `PUBLIC`, `anon` e `authenticated`. Função nova nasce fechada e o acesso é concedido caso a caso na própria migration (`GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO authenticated;`) — esquecer quebra fechado, com erro de permissão em teste, em vez de abrir em silêncio. Antes disso o default do Supabase concedia `EXECUTE` a `anon`/`authenticated` em toda função criada, o que gerou as correções `078`, `088`, `093`, `152` e `257` e deixou 51 funções executáveis por `anon` até a `297` varrê-las. `PUBLIC` faz parte da revogação por necessidade: sem ela, `anon` e `authenticated` herdariam o EXECUTE do default embutido do PostgreSQL. Atenção ao recriar função: `CREATE OR REPLACE` preserva o ACL, mas `DROP FUNCTION` + `CREATE` exige o `GRANT` de volta.
- **Exceção pré-autenticação:** há **uma** viva — `portal_ship_schedule()`, vitrine pública da programação de navios. A exceção `anon` da ADR 0013 (`portal_resolve_login`) foi encerrada na migration `182`, quando o login passou a ser resolvido pela Edge Function `portal-login` com `service_role`.
- **Helpers de revisão privilegiados:** `compute_bl_review_pendencies` lê `customer_portal_accounts`, relação administrativa protegida por RLS. Por isso roda como `SECURITY DEFINER` com `search_path` fixo e sem `EXECUTE` direto para `PUBLIC`, `anon` ou `authenticated`; somente RPCs/triggers autorizados o invocam.

> Checagens no front (`can()`, `isAdmin`, `roleHasPermission`) servem só para esconder UI. Nunca são a fronteira real.

## Roles internas

`administrativo` · `financeiro` · `operacoes` · `documentacao` · `equipamentos`, em `user_profiles` (`role`, `active`). Geridas em `/admin/usuarios`. Ver [Admin Usuários](../modules/operacao-suporte.md#admin-usuários).

## Duas fronteiras de autenticação

| Fronteira | Hook | Mecanismo |
|---|---|---|
| **Interna** | `src/hooks/useAuth.tsx` | Supabase Auth + perfil em `user_profiles`; timeout de inatividade de **8 horas**; role → permissões. |
| **Portal** | `src/hooks/usePortalAuth.tsx` | Supabase Auth. Login exclusivo por CNPJ normalizado via Edge Function `portal-login`. |

> **Portal login:** o navegador envia apenas CNPJ e senha para `portal-login`; a identidade técnica e o email técnico permanecem no servidor. Para não transformar o custo da verificação em oráculo de CNPJ, conta elegível e conta inexistente fazem exatamente um lookup administrativo e uma tentativa no Auth; o caso inexistente usa a identidade sem vínculo configurada em `PORTAL_LOGIN_DUMMY_AUTH_USER_ID`, e qualquer sessão dummy é descartada. As Edge Functions do Portal chamadas pelo navegador compartilham uma allowlist de origens em `supabase/functions/_shared/cors.ts` (`vela.app.br`, `portalfwlog.com.br` e localhost de dev); os aliases gerados pelos projetos Vercel `vela` e `fwlog-portal` são aceitos por padrões restritos à equipe `luccafwlogs-projects`, e domínios adicionais entram somente como URLs HTTPS exatas em `VERCEL_PREVIEW_ORIGINS`. Origem fora da allowlist recebe a **ausência** de `Access-Control-Allow-Origin`, nunca a string `null` — `null` é uma origem real (iframe `sandbox`, documento `data:`, alguns redirecionamentos) e devolvê-la liberaria justamente o contexto mais anônimo; `Vary: Origin` acompanha para que cache compartilhado não sirva o header de uma origem a outra.

> **Senha do Portal:** a ADR 0019 vale para as duas fronteiras. `supabase/functions/_shared/passwordPolicy.ts` espelha `src/lib/passwordPolicy.ts` e é a única regra aplicada em `admin-users`, `portal-invite-activate` e `portal-password-reset` — mínimo de 8 caracteres com maiúscula, minúscula e dígito, igual ao `password_requirements` de `supabase/config.toml`. As Edge Functions validam antes de chamar o GoTrue para que a recusa chegue ao cliente como regra explicada, e não como erro genérico de ativação.

## Rate limiting

- **Provisão de portal**: convites e recuperação usam tokens opacos de uso único, com expiração e hash persistido; o login e a recuperação aplicam rate limit por CNPJ.
- **Login/resolução de portal:** tentativas registradas em `portal_login_attempts` / `portal_login_resolution_attempts`; limites em `portal_rate_limits` (RPC `check_portal_rate_limit`).

## Invariante de provisionamento do portal

Uma conta de `customer_portal_accounts` só pode ficar ativa quando possui `auth_user_id`. A identidade é criada na ativação do convite; suspensão revoga sessões e devolve a conta à análise. A prontidão do Portal é guarda dos caminhos manuais de emissão; a automação CE tem exceção interna controlada na migration `051`.

Troca/redefinição de senha, recuperação assistida, troca de Email de Recuperação (self-service ou assistida, migration `195`) e suspeita de comprometimento revogam as sessões existentes via `portal_revoke_sessions` (migration `194`, delete direto em `auth.sessions`/`auth.refresh_tokens` — o endpoint admin `/admin/users/{id}/logout` do GoTrue retorna 404 nesta versão). O reset self-service revoga antes da mudança, instala uma quarentena futura em `credentials_revoked_at`, altera a senha e revoga novamente; falha intermediária mantém o fluxo negado fechado.
O corte de `iat` é estrito desde a migration `068`: qualquer access
token emitido antes do marco final é recusado, inclusive dentro dos cinco
segundos antes tolerados. Token sem `iat` válido também é recusado enquanto o
marco estiver ativo.

As RPCs `SECURITY DEFINER` de provisionamento vigentes (`portal_set_exception`, `portal_return_to_analysis`, `portal_admin_change_cnpj`, `portal_cancel_invite`, `portal_assisted_email_change`) autorizam em duas camadas: EXECUTE concedido só a `authenticated`/`service_role` (o herdado do `PUBLIC` foi revogado na migration `192`) e guarda NULL-safe sobre `_portal_actor_role()`, negando role indefinido — inclusive clientes do Portal, que também são role `authenticated`. As RPCs temporárias de pré-voo e backfill foram revogadas e removidas pela migration `201`. Correção da falha *fail-open* encontrada em teste de isolamento por CNPJ (2026-07-14): a comparação com role NULL não disparava o `permission denied`, e o `REVOKE ... FROM anon` original não removia o EXECUTE do `PUBLIC`.

A migration `067` estende a mesma disciplina NULL-safe às RPCs internas de
Dispute, modelos de comunicação e terminal do ADR. As implementações de negócio
ficam privadas e os wrappers concedidos a `authenticated` negam um cliente do
Portal antes de qualquer leitura ou mutação. A mesma migration faz as RPCs de
detalhes financeiros projetarem allowlists JSON explícitas: notas internas,
identidade de operadores, justificativas, aprovadores, TXID e snapshots de
cálculo não atravessam a fronteira do Portal. A interface mostra o ROE aplicado,
sem decompor no navegador o fator comercial da cotação.

## Edge Functions

- **Convite/ativação e recuperação** — criam a identidade técnica somente na ativação do convite, sem expor email técnico ou senha ao operador; suspensão revoga as sessões do usuário.
- **`send-customer-communication`** — valida sessão interna, perfil ativo,
  natureza, contato, preferência e supressões antes de registrar a tentativa;
  a chave global desligada registra simulação e não chama o Resend.
- **`demurrage-dunning`** — aceita somente o bearer de
  `DEMURRAGE_DUNNING_SECRET` em comparação *timing-safe*, usa `service_role`
  apenas no servidor e reivindica cada cobrança antes de renderizar/enviar,
  evitando concorrência entre execuções do cron.

## Headers HTTP / CSP

Definidos em `vercel.json`:

- `X-Frame-Options: DENY` · `X-Content-Type-Options: nosniff` · `Referrer-Policy`
- **CSP** sem `unsafe-inline` em scripts; `connect-src` restrito a Supabase, `olinda.bcb.gov.br` e Sentry. O browser não chama Resend diretamente; o envio permanece nas Edge Functions. Ver [Deploy](../setup/deploy.md#content-security-policy).
- **Telemetria Vercel:** Web Analytics e Speed Insights removem query strings e normalizam identificadores dinâmicos de clientes, B/Ls, viagens e inspeções antes do envio.

## Outras defesas

- **Upload guard:** `assertUploadSize` (`src/lib/fileGuard.ts`) limita tamanho antes de `XLSX.read` (mitiga a vulnerabilidade conhecida do `xlsx`).
- **Injeção em filtros PostgREST:** input de usuário em `.or()/.ilike()` é escapado por `escapeFilterTerm` / `sanitizeLikeTerm` (`src/lib/utils.ts`) e termos que ficam vazios após o escape não geram cláusula. A fronteira cobre as buscas de clientes (lista, lookup e export), faturamento, Granito e bookings de Vazios.
- **Injeção de fórmula em planilhas:** `src/lib/spreadsheetSafe.ts` é o sanitizador canônico. `src/services/exports.ts`, `src/lib/csv.ts` e `src/services/reconciliacao.ts` o reutilizam antes de gerar XLSX/CSV.
- **Segredos de servidor** ficam **apenas** em env vars de Edge Functions, nunca no bundle do cliente.

### Read model do Console

A migration `196_portal_provisioning_console_read_model.sql` usa `SECURITY DEFINER` com `search_path` fixo, revoga `PUBLIC/anon` e restringe a RPC por perfil. A migration corretiva `197_portal_provisioning_console_fixes.sql` torna o vínculo de alertas de invoice seguro para identificadores textuais e inclui `financial_status` nulo em `has_active_process`. A migration `198_portal_provisioning_queue_self_heal.sql` adiciona reparo idempotente antes da leitura, sem grants diretos e sem criação de credenciais. Operações recebe a situação resumida e os booleanos `has_open_invoice`/`has_active_process`; eventos são bloqueados para esse perfil e limitados entre 1 e 50 registros.

## Riscos de segurança monitorados

- A leitura de planilhas usa `@e965/xlsx` com limite de upload antes do parsing e acesso restrito a usuários autenticados. O `npm audit` do repositório estava limpo em 2026-08-26; manter o limite e revalidar a dependência em atualizações. Ver [ROADMAP](../ROADMAP.md).
- Snapshots de auditoria de segurança ficam em [archive/](../archive/README.md).
