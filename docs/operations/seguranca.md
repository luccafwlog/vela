# Segurança

> A fronteira de autorização vive no **banco** (RLS + RPCs `SECURITY DEFINER`). Checagens no cliente são apenas UX.

---

## RLS-first

- **RLS ativo em todas as tabelas.** Acesso segmentado por role via helpers `is_admin()`, `is_active_user()`, `current_user_role()` (ADR 0004).
- **Dados financeiros:** leitura interna usa `is_active_read_user()`; escrita depende da RPC/policy e das exceções das ADRs 0046/0060. Não presumir restrição universal a admin.
- A lógica financeira sensível (criar invoice, numerar, consolidar, PIX) roda em **RPCs `SECURITY DEFINER`** transacionais — o cliente não escreve direto nessas tabelas.
- **Default-deny em funções** (ADR 0011, reforçada pela ADR 0047): desde a migration arquivada `297` — hoje nas migrations `001` e `006`, com a varredura de `PUBLIC`/`anon` da `003` —, o `ALTER DEFAULT PRIVILEGES` de `public` **revoga** `EXECUTE` de `PUBLIC`, `anon` e `authenticated`. Função nova nasce fechada e o acesso é concedido caso a caso na própria migration (`GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO authenticated;`) — esquecer quebra fechado, com erro de permissão em teste, em vez de abrir em silêncio. Antes disso o default do Supabase concedia `EXECUTE` a `anon`/`authenticated` em toda função criada, o que gerou as correções das migrations arquivadas `078`, `088`, `093`, `152` e `257` e deixou 51 funções executáveis por `anon` até a arquivada `297` varrê-las. `PUBLIC` faz parte da revogação por necessidade: sem ela, `anon` e `authenticated` herdariam o EXECUTE do default embutido do PostgreSQL. Atenção ao recriar função: `CREATE OR REPLACE` preserva o ACL, mas `DROP FUNCTION` + `CREATE` exige o `GRANT` de volta.
- **Exceção pré-autenticação:** há **uma** viva — `portal_ship_schedule()`, vitrine pública da programação de navios e único `GRANT` a `anon` na cadeia ativa. A exceção `anon` da ADR 0013 (`portal_resolve_login`) foi encerrada pela migration arquivada `182`, quando o login passou a ser resolvido pela Edge Function `portal-login` com `service_role`, que lê `customer_portal_accounts` diretamente; `portal_resolve_login` ficou no catálogo sem grant e sem chamador.
- **Helpers de revisão privilegiados:** `compute_bl_review_pendencies` lê `customer_portal_accounts`, relação administrativa protegida por RLS. Por isso roda como `SECURITY DEFINER` com `search_path` fixo e sem `EXECUTE` direto para `PUBLIC`, `anon` ou `authenticated`; somente RPCs/triggers autorizados o invocam.
- **Tabelas lidas pelo navegador ganham `GRANT` explícito:** tabelas seguem o default da plataforma Supabase (`authenticated` recebe privilégios em tabela nova de `public`) e a fronteira real é a RLS. Banco montado só pelas migrations — replay do CI, design-audit, `setup-local-pg.sh` — não tem esse default, então tabela que o navegador lê direto precisa do grant na própria migration; sem ele a leitura falha com 42501 fora de produção (VELA-16, corrigida pela `166` para `baplie_reconciliation_resolutions`).
- **Edge Functions do Portal:** chamadas que usam `service_role` validam ator e escopo no servidor. As migrations `101` e `102` concedem a esse role somente as operações diretas de runtime necessárias em `customer_portal_accounts`, `customers`, `portal_invites`, `portal_email_attempts` e `alerts`, incluindo uso das sequences; não alteram grants de `PUBLIC`, `anon` ou `authenticated`.

> Checagens no front (`can()`, `isAdmin`, `roleHasPermission`) servem só para esconder UI. Nunca são a fronteira real.

**Dupla proteção RBAC:** a interface usa `can(permission)` para orientar a
navegação e esconder exceções, mas a autoridade está nas policies RLS, nas RPCs
e nas Edge Functions; toda permissão precisa valer também para chamada direta à
API, e o rastro obrigatório responsabiliza as operações auditadas. No
navegador, a recusa do banco é lida por `classifyDbError` (`src/lib/errors.ts`),
a tabela compartilhada de códigos Postgres/PostgREST para tipo e mensagem em
português; quem a consome não mostra `details`, `hint` nem dados sensíveis do
erro bruto.

## Roles internas

As policies de leitura e marcação de notificações internas exigem destinatário
igual a `auth.uid()` e perfil interno ativo (`is_active_read_user()`, migration
`131`), inclusive para acesso direto com um JWT ainda válido após desativação.

`administrativo` · `financeiro` · `operacoes` · `documentacao` · `equipamentos`, em `user_profiles` (`role`, `active`). Geridas em `/admin/usuarios`. Ver [Admin Usuários](../modules/operacao-suporte.md#admin). O papel legado `operator` é tratado como Documentação; o papel `admin` (Administrador) deixou de existir (migration `093`).

- **Usuário interno ativo:** identidade do Supabase Auth com perfil ativo em
  `user_profiles` e papel reconhecido (`is_active_user()` no banco; o app recusa
  perfil inativo ou papel desconhecido). Identidade Auth sem perfil ativo não
  tem acesso interno. Quantidade e identidade dos usuários são dados do
  ambiente, não regra.
- **Departamento:** o papel do usuário interno, usado como assinatura de
  responsabilidade: identifica o autor no registro de eventos e define quem
  assina cada seção do ADR de Saída ([Viagens](../modules/viagens.md)). O papel
  também autoriza operações específicas (tabela abaixo); Departamento não é
  acesso irrestrito.
- **Rastro obrigatório** ([ADR 0046](../adr/0046-escrita-interna-global-com-rastro-obrigatorio.md)):
  toda escrita registra autor e Departamento no instante do evento
  (`audit_logs.actor_role`/`actor_department`); o Departamento é gravado com o
  evento, nunca derivado do cadastro atual. Ações automáticas assinam
  `sistema`.

### Visualização global interna

A leitura interna é ampla, inclusive de dados financeiros e de tarifação
(`is_active_read_user()`), mas não é acesso irrestrito:

- a área `/admin` inteira — Usuários, logs, métricas e todas as abas — é só do
  Administrativo, inclusive para leitura; o item Admin do menu só aparece para
  ele;
- `/clientes/comunicacao` exige `customer_communications` (Administrativo,
  Documentação e Equipamentos);
- `/reconciliacao` (Conciliação PIX) mostra "Acesso restrito" a quem não é
  Administrativo, inclusive para leitura;
- `/desbloqueio-ce` exige `ce_unlock_read` (todos, exceto Equipamentos); gerir
  pedidos e documentos (`ce_unlock_manage`, `ce_unlock_documents`) é de
  Administrativo e Documentação ([Desbloqueio de CE](../modules/desbloqueio-ce.md));
- no console do Portal, Operações não vê Email de Recuperação, entrega nem
  candidatos ([Portal do Cliente](../modules/portal-cliente.md#console-clientesportal)).

A matriz do frontend está em `roleHasPermission` (`src/hooks/useAuth.tsx`); a
autorização real fica nas policies e RPCs.

### Escrita interna global e exceções

A escrita operacional é liberada a todo Departamento interno ativo, com rastro
obrigatório ([ADR 0046](../adr/0046-escrita-interna-global-com-rastro-obrigatorio.md)).
As exceções abaixo são aplicadas pelo banco, operação por operação; a tabela
não substitui as validações de estado e de escopo de cada RPC, e as
assinaturas do ADR de Saída continuam com o Departamento dono.

| Operação | Quem pode | Regra no módulo |
|---|---|---|
| Administração de usuários e painel `/admin` | Administrativo | [Operação e suporte](../modules/operacao-suporte.md) |
| Provisionamento do Portal | Administrativo e Documentação; trocar o CNPJ e conceder ou revogar a Liberação de faturamento sem Portal, só Administrativo | [Portal do Cliente](../modules/portal-cliente.md#provisionamento-e-ativação-do-convite) |
| Liquidação de ajustes financeiros (`settle_financial_adjustments`) | Administrativo e Financeiro | [Faturamento](../modules/faturamento.md) |
| Comunicados e edição interna das Caixas de Comunicação | Administrativo, Documentação e Equipamentos | [Clientes](../modules/clientes.md) |
| Ligar a chave global de envio de Comunicados | Administrativo | [Clientes](../modules/clientes.md) |
| Resposta e reabertura de disputa de Demurrage | Equipamentos e Administrativo | [Demurrage](../modules/demurrage.md) |
| Conciliação PIX (tela e RPCs de baixa, exceção e monitor) | Administrativo | [Conciliação PIX](../modules/reconciliacao-pix.md) |
| Emitir fatura local e Invoice de Demurrage; baixa manual local, cancelar baixa, cancelar fatura, preparar cancelamento financeiro e autorizar restituição excepcional | Administrativo | [Faturamento](../modules/faturamento.md), [Demurrage](../modules/demurrage.md) |
| Fatura Avulsa (`create_manual_invoice`) | Qualquer usuário interno ativo, com motivo e rastro ([ADR 0083](../adr/0083-decisoes-da-revisao-geral-da-documentacao.md), item 9); hoje a RPC aceita só o Administrativo: correção pendente no [plano de correções](../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md) | [Faturamento](../modules/faturamento.md) |
| Cancelar e reativar Viagem e B/L; reverter omissão de escala; reabrir ADR de Saída fechado | Administrativo | [Viagens](../modules/viagens.md) |
| Desativar e reativar Cliente | Administrativo | [Clientes](../modules/clientes.md) |
| Desativar e reativar tarifa (tabela, item, condição de Cliente, tarifa e acordo de Demurrage, tarifa de Granito) | Administrativo | [Taxas Locais](../modules/taxas-locais.md) |
| Exclusão operacional protegida (`delete_records`) e Excluir escala (`delete_escala`), inclusive a de exportação | Administrativo, com motivo, respeitando a Trava de exclusão ([ADR 0071](../adr/0071-ce-mercante-como-trava-de-exclusao.md)); a migration `088` desfez a abertura da `080` e devolveu a policy de DELETE de `voyage_export_schedules` a `is_admin()` | [Regras de negócio](regras-de-negocio.md#hard-delete-controlado), [Viagens](../modules/viagens.md) |
| Excluir veículos, com motivo (`delete_vehicles_with_reason`, migration `184`) | Qualquer Departamento ativo | [Manifesto/EDI](../modules/manifesto-edi.md) |
| Excluir unidade manual e linha de serviço de vazios | Qualquer Departamento ativo; a ADR 0071 (item 4) prevê a trava pelo ADR de Saída fechado, que o banco ainda não impõe: correção pendente (B14) no [plano de correções](../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md) | [Manifesto/EDI](../modules/manifesto-edi.md) |
| Remover o CE Mercante do B/L | Qualquer Departamento ativo, com motivo | [Manifesto/EDI](../modules/manifesto-edi.md) |
| Importações de arquivo | Qualquer Departamento ativo, com o rastro no Histórico ([ADR 0078](../adr/0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md)) | [Manifesto/EDI](../modules/manifesto-edi.md) |

### Administrativo ativo mínimo

Regra decidida: o banco recusa rebaixar de setor ou desativar o último
Administrativo ativo
([ADR 0083](../adr/0083-decisoes-da-revisao-geral-da-documentacao.md), item 2). A regra e a correção pendente estão em
[Operação e suporte § Administrativo ativo mínimo](../modules/operacao-suporte.md#administrativo-ativo-mínimo).

## Duas fronteiras de autenticação

| Fronteira | Hook | Mecanismo |
|---|---|---|
| **Interna** | `src/hooks/useAuth.tsx` | Supabase Auth + perfil em `user_profiles`; timeout de inatividade de **8 horas**; role → permissões. |
| **Portal** | `src/hooks/usePortalAuth.tsx` | Supabase Auth. Login exclusivo por CNPJ normalizado via Edge Function `portal-login`. |

> **Logout fail-closed:** tanto `useAuth` quanto `usePortalAuth` utilizam `removeLocalSessionFallback` (`src/services/supabaseAuth.ts`). Se a revogação remota falhar ou exceder o timeout de 5 segundos (por partição de rede ou indisponibilidade do Auth), a sessão local (localStorage e memória) é purgada forçadamente no cliente de forma isolada, removendo estritamente o `storageKey` da respectiva aplicação (`td-portal-auth` no Portal e a chave padrão no app interno), preservando o isolamento de sessões no mesmo domínio. Na interface do Portal, o botão de logout desabilita durante o processo (`isSigningOut`) e exibe aviso contextual na tela de login caso a revogação no servidor não tenha sido confirmada (G-PAF3). O aviso vem do estado vivo do provider (`signOutError`): aparece quando a falha é confirmada, até 5 s depois do redirecionamento para o login, e é limpo ao iniciar um novo login; não é persistido em `sessionStorage`, para nunca reaparecer num logout posterior bem-sucedido.

> **Portal login:** o navegador envia apenas CNPJ, senha e o token do desafio Cloudflare Turnstile para `portal-login`; a identidade técnica fica no servidor. A Edge Function confere o Turnstile (ação `portal_login`; `portal_recovery` na recuperação) antes de qualquer outra verificação e recusa com HTTP `403` token ausente ou inválido; sem `TURNSTILE_SECRET_KEY`, só o stack local passa ([serviços externos](servicos-externos.md#cloudflare-turnstile)). As demais recusas do login — CNPJ desconhecido, conta inativa, senha errada e bloqueio — recebem o mesmo `401` genérico; o email técnico aparece no claim `email` do JWT depois do login, então a senha guardada no GoTrue é derivada com pepper e só as Edge Functions sabem calculá-la. Para não transformar o custo da verificação em oráculo de CNPJ, conta elegível e conta inexistente fazem exatamente um lookup administrativo e as mesmas tentativas no Auth (primeiro a senha derivada `HMAC(PORTAL_PASSWORD_PEPPER, senha)`, depois a senha pura de conta legada, que migra para a derivada quando acerta); o caso inexistente usa a identidade sem vínculo configurada em `PORTAL_LOGIN_DUMMY_AUTH_USER_ID`, e qualquer sessão dummy é descartada. As Edge Functions do Portal chamadas pelo navegador compartilham uma allowlist de origens em `supabase/functions/_shared/cors.ts` (`vela.app.br`, `portalfwlog.com.br` e localhost de dev); os previews dos dois projetos Cloudflare Pages são aceitos por padrões restritos aos nomes `vela-internal` e `vela-portal`, e domínios adicionais entram somente como URLs HTTPS exatas em `CLOUDFLARE_PAGES_PREVIEW_ORIGINS`. Origem fora da allowlist recebe a **ausência** de `Access-Control-Allow-Origin`, nunca a string `null` — `null` é uma origem real (iframe `sandbox`, documento `data:`, alguns redirecionamentos) e devolvê-la liberaria justamente o contexto mais anônimo; `Vary: Origin` acompanha para que cache compartilhado não sirva o header de uma origem a outra.

> **Senha do Portal:** a ADR 0019 vale para as duas fronteiras. `supabase/functions/_shared/passwordPolicy.ts` espelha `src/lib/passwordPolicy.ts` e é a única regra aplicada em `admin-users`, `portal-invite-activate` e `portal-password-reset` — mínimo de 8 caracteres com maiúscula, minúscula e dígito, igual ao `password_requirements` de `supabase/config.toml`. As Edge Functions validam antes de chamar o GoTrue para que a recusa chegue ao cliente como regra explicada, e não como erro genérico de ativação.

## Rate limiting

- **Login, recuperação e ativação do Portal:** contados por hash do CNPJ em
  `portal_login_attempts`, em baldes separados: login (5 erros em 15 minutos,
  também usado pela verificação da senha atual na troca do Email de
  Recuperação), recuperação (5 pedidos em 15 minutos) e ativação (10 recusas em
  5 minutos). O balde do Supabase, chaveado só pelo CNPJ
  ([ADR 0049](../adr/0049-rate-limit-do-portal-chaveado-somente-por-cnpj.md)),
  sempre decide, e falha da RPC conta como bloqueio; trocar de IP não contorna o
  bloqueio. A camada opcional no Upstash Redis (par IP+CNPJ, chaves HMAC) só
  acrescenta bloqueio. Contrato, segredos, validação e rollback em
  [Rate limit do Portal](portal-rate-limit.md); comportamento das telas em
  [Portal do Cliente](../modules/portal-cliente.md#autenticação-e-sessão).
- **Ações self-service do Portal:** consolidar, desfazer consolidada e abrir
  disputa usam `check_portal_rate_limit` sobre `portal_rate_limits` (3 tentativas
  em 10, 15 e 30 minutos), executável só pelas RPCs do Portal desde a migration
  `106`. `portal_login_resolution_attempts` pertence ao resolver legado
  `portal_resolve_login`, que o login não usa.
- **Convites e recuperação:** tokens opacos de uso único, com expiração e hash
  persistido.
- **Anexos de disputa de demurrage:** cota máxima cumulativa de 100 MB por cliente em disputas abertas e limite de taxa de 20 uploads a cada 24 horas por cliente (G-PAF1), verificados pela RPC `add_demurrage_dispute_attachment` sob lock transacional por cliente para prevenir condições de corrida (TOCTOU).

## Invariante de provisionamento do portal

Uma conta de `customer_portal_accounts` só pode ficar ativa quando possui `auth_user_id`. A identidade é criada na ativação do convite. Suspender revoga as sessões e bloqueia a conta (Suspensa) sem mudar a decisão de provisionamento; reativar uma conta Suspensa devolve o Cliente a Aguardando análise, desfaz o vínculo e bane o usuário técnico antigo, para um novo convite ([Portal do Cliente](../modules/portal-cliente.md#provisionamento-e-ativação-do-convite)). O Portal pronto é trava de toda emissão, inclusive a automática pela transição do CE; a saída é a ativação ou a Liberação de faturamento sem Portal ([Regras de negócio](regras-de-negocio.md#gate-de-faturamento), [ADR 0070](../adr/0070-portal-trava-toda-emissao-e-liberacao-por-cliente.md)).

Troca/redefinição de senha, recuperação assistida, troca de Email de Recuperação (self-service ou assistida, migration arquivada `195`) e suspeita de comprometimento revogam as sessões existentes via `portal_revoke_sessions` (criada na migration arquivada `194`, definição vigente na migration `132`; delete direto em `auth.sessions`/`auth.refresh_tokens` — o endpoint admin `/admin/users/{id}/logout` do GoTrue retorna 404 nesta versão). O reset self-service revoga antes da mudança, instala uma quarentena futura em `credentials_revoked_at`, altera a senha e revoga novamente; falha intermediária mantém o fluxo negado fechado.
O corte de `iat` é estrito desde a migration `069`: qualquer access
token emitido antes do marco final é recusado, inclusive dentro dos cinco
segundos antes tolerados. Token sem `iat` válido também é recusado enquanto o
marco estiver ativo.

A migration `132` faz `portal_revoke_sessions` adquirir o lock da conta antes
de revogar sessões e gravar o marco final com `clock_timestamp()`. JWTs emitidos
durante a espera também ficam anteriores ao corte; `now()` representaria o
início da transação e deixaria essa janela aberta.

Desde a migration `131`, reset e confirmação do Email de Recuperação usam RPCs
exclusivas de `service_role` com lock por conta. O reset aceita somente convite
pendente, não expirado e destinado ao email atual, consome-o e registra
`recovery_reset_invite_id` antes de chamar o Auth. A confirmação aplica o email,
cancela os links de recuperação anteriores e revoga sessões na mesma transação.
O trigger cobre também a troca assistida. Enquanto o reset está em andamento,
qualquer alteração do Email de Recuperação é recusada; o marcador só é removido
depois da alteração da senha e da revogação final confirmadas.

Na confirmação pública, reset em andamento retorna HTTP `423` e a tela informa
que o novo email ainda não foi confirmado, orientando reabrir o link depois.
HTTP `409` permanece reservado ao pedido já resolvido por outro caminho.

**Publicação:** aplicar as migrations `131` e `132` antes de publicar `portal-password-reset`
e `portal-recovery-email-change`. **Falha de reset:** não há desbloqueio por tempo.
O operador deve confirmar nos logs que a execução terminou e que nenhuma chamada
ao Auth continua pendente, verificar o resultado da alteração e revogar as sessões
antes de concluir a operação com `portal_finish_password_reset(account_id,
invite_id)` usando `service_role`. Não reutilizar o convite consumido: depois de
resolver a operação, emitir uma nova recuperação. Sem confirmação desses passos,
manter o bloqueio e investigar. A quarentena de credenciais permanece válida.

As RPCs `SECURITY DEFINER` de provisionamento vigentes (`portal_return_to_analysis`, `portal_admin_change_cnpj`, `portal_cancel_invite`, `portal_assisted_email_change`, `portal_release_suppressed_email`) autorizam em duas camadas: EXECUTE concedido só a `authenticated`/`service_role` (o herdado do `PUBLIC` foi revogado na migration arquivada `192`) e guarda NULL-safe sobre `_portal_actor_role()`, negando role indefinido — inclusive clientes do Portal, que também são role `authenticated`. `portal_set_exception` restou apenas como função que recusa, sem grant a `authenticated`. A migration arquivada `203` revogou e removeu as RPCs temporárias de pré-voo e backfill. Correção da falha *fail-open* encontrada em teste de isolamento por CNPJ (2026-07-14): a comparação com role NULL não disparava o `permission denied`, e o `REVOKE ... FROM anon` original não removia o EXECUTE do `PUBLIC`.

A migration `068` estende a mesma disciplina NULL-safe às RPCs internas de
Dispute, modelos de comunicação e terminal do ADR. As implementações de negócio
ficam privadas e os wrappers concedidos a `authenticated` negam um cliente do
Portal antes de qualquer leitura ou mutação. A mesma migration faz as RPCs de
detalhes financeiros projetarem allowlists JSON explícitas: notas internas,
identidade de operadores, justificativas, aprovadores, TXID e snapshots de
cálculo não atravessam a fronteira do Portal. A interface mostra o ROE aplicado,
sem decompor no navegador o fator comercial da cotação.

## Edge Functions

- **Convite/ativação e recuperação** — criam a identidade técnica somente na ativação do convite, sem expor email técnico ou senha ao operador; suspensão revoga as sessões do usuário.
- **`portal-password-recovery`** — responde imediatamente `{ accepted: true }` (HTTP 200) após checagem de rate limit e delega processamento (busca de conta, supressão, convite reusável e envio de email) para background com `EdgeRuntime.waitUntil` (G-PAF4), eliminando canal lateral de temporização (TTFB uniforme para CNPJs válidos e inexistentes). O processamento em background opera em melhor esforço (best-effort); caso o isolate seja encerrado antes da conclusão, novo pedido pode ser feito pelo cliente após expirar a janela de rate limit.
- **`portal-dispute-attachment`** — recebe uploads multipart de clientes do Portal com `verify_jwt = false` no gateway para garantir a passagem de requisições de preflight CORS (`OPTIONS`), validando o token JWT da sessão explicitamente no início da função via `authClient.auth.getUser()`. Valida tipo/tamanho do arquivo (máx 10 MB) e magic bytes em memória (PDF, JPG, PNG, TXT), confirma autoria da mensagem (`author_type = 'cliente'` e `author_id = auth.uid()`), grava no storage via `service_role` no caminho `<customer_id>/disputes/<dispute_id>/<message_id>/...` e invoca a RPC `add_demurrage_dispute_attachment` com o cliente autenticado do usuário para registro de metadados, verificação física do objeto no storage e verificação de quota (100 MB em disputas abertas) e limite diário (20 uploads/24h por cliente). Em caso de falha no registro de metadados, remove imediatamente o objeto órfão do storage. Anexos do Portal só são aceitos em Disputes abertas (`add_demurrage_dispute_attachment` e `portal_check_dispute_attachment_eligibility`, migration `075`), para que nenhum upload fique fora da quota. No fluxo interno de Demurrage, a remoção imediata do órfão usa a policy `demurrage_dispute_objects_delete`, que permite ao usuário interno ativo apagar pelo Storage API apenas o objeto que ele mesmo enviou e que ainda não tem metadado; anexo registrado é imutável. A RPC `list_orphaned_dispute_attachments(p_older_than)` (somente `service_role`, somente leitura) lista órfãos por idade; a remoção dos caminhos listados deve ser feita pelo Storage API, porque apagar linhas de `storage.objects` por SQL não remove o arquivo físico. Clientes do Portal não possuem permissão de escrita direta no bucket `demurrage-disputes` (policy `demurrage_dispute_objects_insert` restrita a Equipamentos/Administrativo, autoria da sessão e caminho de mensagem em Dispute aberta, migration `106`). A RPC `portal_check_dispute_attachment_eligibility` permite pré-validação de cota e rate limit no front-end antes da inserção da mensagem na conversa.
- **`send-customer-communication`** — valida sessão interna, perfil ativo,
  natureza, contato, preferência e supressões antes de registrar a tentativa;
  a chave global desligada registra simulação e não chama o provedor de e-mail.
- **`demurrage-dunning`** — aceita somente o bearer de
  `DEMURRAGE_DUNNING_SECRET` em comparação *timing-safe*, usa `service_role`
  apenas no servidor e reivindica cada cobrança antes de renderizar/enviar,
  evitando concorrência entre execuções do cron.

## Headers HTTP / CSP

Gerados em `_headers` pelo staging do Cloudflare Pages:

- `X-Frame-Options: DENY` · `X-Content-Type-Options: nosniff` · `Referrer-Policy`
- **CSP** sem `unsafe-inline` em scripts; `connect-src` restrito a Supabase, `olinda.bcb.gov.br`, Sentry, PostHog EU e Turnstile; `script-src`/`frame-src` só abrem o Turnstile e a configuração do PostHog. O browser não chama o provedor de e-mail (MillionSend) diretamente; o envio permanece nas Edge Functions. Ver [Deploy](../setup/deploy.md#headers-rotas-e-cors).

## Outras defesas

- **Upload guard:** `assertUploadSize` (`src/lib/fileGuard.ts`) limita tamanho antes de `XLSX.read` (mitiga a vulnerabilidade conhecida do `xlsx`).
- **Injeção em filtros PostgREST:** input de usuário em `.or()/.ilike()` é escapado por `escapeFilterTerm` / `sanitizeLikeTerm` (`src/lib/utils.ts`) e termos que ficam vazios após o escape não geram cláusula. A fronteira cobre as buscas de clientes (lista, lookup e export), faturamento, Granito e bookings de Vazios.
- **Injeção de fórmula em planilhas:** `src/lib/spreadsheetSafe.ts` é o sanitizador canônico. `src/services/exports.ts`, `src/lib/csv.ts` e `src/services/reconciliacao.ts` o reutilizam antes de gerar XLSX/CSV.
- **Higienização de artefatos de build:** `scripts/clean-build-artifacts.mjs` remove `.map` e `.vite` ao final de cada build (`cleanProductionArtifacts`) e executa varredura recursiva estrita pós-build (`assertNoForbiddenArtifacts`), falhando fechado (`process.exit(1)`) se qualquer mapa de código-fonte ou diretório de cache vazar no diretório final de distribuição.
- **Segredos de servidor** ficam **apenas** em env vars de Edge Functions, nunca no bundle do cliente. No Portal, `service_role` e a chave do provedor de e-mail (`RESEND_API_KEY`) nunca vão ao navegador nem a logs ou auditoria, e o frontend não os usa para contornar RLS e permissões.

### Read model do Console

`portal_list_provisioning_console` (definição vigente na migration `103`) usa `SECURITY DEFINER` com `search_path` fixo, sem execução para `PUBLIC`/`anon`, e restringe a RPC por perfil. Antes da leitura, chama o reparo idempotente `portal_repair_missing_accounts`, sem grants diretos e sem criação de credenciais. Operações recebe a situação resumida e os booleanos `has_open_invoice`/`has_active_process`; eventos são bloqueados para esse perfil e limitados entre 1 e 50 registros. O read model nasceu nas migrations arquivadas `migrations_archive/196_portal_provisioning_console_read_model.sql`, `197_portal_provisioning_console_fixes.sql` (vínculo de alertas de invoice seguro para identificadores textuais; `financial_status` nulo em `has_active_process`) e `198_portal_provisioning_queue_self_heal.sql`. Telas e ações em [Portal do Cliente](../modules/portal-cliente.md#console-clientesportal).

## Riscos de segurança monitorados

- A leitura de planilhas usa `@e965/xlsx` com limite de upload antes do parsing e acesso restrito a usuários autenticados. O `npm audit` do repositório estava limpo em 2026-08-26; manter o limite e revalidar a dependência em atualizações. Ver [ROADMAP](../ROADMAP.md).
- Snapshots de auditoria de segurança ficam em [archive/](../archive/README.md).

## Desbloqueio de CE Mercante

As migrations do Desbloqueio (`139`–`149`, `160`, `161`, `173` e `220`; as `137`–`138` são da Central de Informações) usam schema privado para implementação e RPCs públicas
com allowlists e `search_path` fixo. Não há grants de tabela para o navegador.
Portal resolve CNPJ pela sessão/conta ativa, nunca pelo payload. Administrativo
e Documentação gerenciam; Financeiro e Operações consultam sem PDFs. Inspeção
consulta pelo cliente selecionado e recusa comandos de escrita.

`portal-ce-unlock-document` limita o corpo multipart mesmo sem Content-Length,
aceita PDFs de até 10 MiB com extensão, MIME e assinatura `%PDF-`, e reserva
caminho/quota no servidor (20 tentativas/24 h; 100 MiB ativos por cliente).
Autentica com `getUser`, grava com cliente de serviço e finaliza com RPC do
usuário que revalida autoria, contexto e metadados reais do objeto. PDF inválido
é recusado antes da reserva; falha de armazenamento reivindica e compensa a
reserva pendente sem remover um PDF já registrado. Tentativas nunca finalizadas
não entram na projeção dos documentos nem substituem a versão submetida. Download
autorizado em RPC gera URL privada com 60 segundos; nunca há leitura direta
no bucket `ce-unlock-documents`. O modelo oficial é o único PDF global do Portal.

Comandos exigem UUID idempotente; repetição com payload diferente é recusada.
Versões otimistas protegem pedido, revisão documental e entrega. Exportação
revalida os requisitos em transação e registra snapshot; download ou aprovação
não confirmam desbloqueio. Arquivos gerados usam sanitização canônica para
evitar fórmulas de planilha.

`ce-unlock-cleanup` e `ce-unlock-notify-email` usam bearer dedicado `CE_UNLOCK_CLEANUP_SECRET` e falham
fechado se ausente. Envio à ZPT e conciliação (`ce_unlock_zpt_status`, `exported_at`) são
visíveis só ao desk: o Portal os recebe removidos por `ce_unlock_private.portal_view`. `service_role` é usado apenas dentro do servidor, nunca
como segredo do cron ou no navegador. A agenda nasce desativada. Consulte
[serviços externos](servicos-externos.md#desbloqueio-de-ce-mercante) para rollout
e retenção. Código no checkout não comprova publicação destas funções/policies.

`itau-pix` usa bearer dedicado `ITAU_PIX_ADMIN_SECRET`, sem JWT da plataforma,
e falha fechado se ele ou a configuração Itaú estiverem ausentes. O
certificado mTLS e o client_secret ficam só em secrets das Edge Functions;
respostas e erros nunca contêm o token de acesso. As ações de diagnóstico
consultam somente TXIDs com prefixo `VELA` (a mesma chave Pix é usada por um
sistema de terceiro) e só alteram ou cancelam cobranças de teste (`VELAT…`,
até R$ 1,00); a cobrança de uma fatura só muda pela própria fatura. A
listagem de Pix recebidos devolve apenas os do Vela, sem `infoPagador`, e só
a contagem dos demais.

A baixa automática (`itau_pix_settle`, só `service_role`) assume dentro da
transação a identidade da conta Admin dedicada "API Itaú" configurada em
`app_settings.itau_pix_settlement_actor` e a restaura ao sair (em produção,
`auth.uid()` lê `request.jwt.claim.sub` antes de `request.jwt.claims`;
conferido em 2026-10-06). Assim, as
mesmas checagens de `auth.uid()`/`is_admin()` das baixas manuais continuam
valendo. Conta inativa ou ausente faz o Pix ir para análise, sem baixa. Pix
do sistema de terceiro e dados do pagador não são gravados.

`itau_pix_monitor` (leitura) e `itau_pix_mark_receipt_handled` (encerrar Pix em
análise com motivo) exigem Admin ativo dentro da função; as tabelas Itaú
continuam sem acesso direto para `authenticated`.

A evidência externa de confirmação permanece restrita ao desk também no
histórico: motivos legados de eventos `confirm` são omitidos no Portal e nas
leituras resumidas de Financeiro/Operações. A UI envia a referência em campo
próprio, sem copiá-la para o motivo público.

### Leitura RLS de Disputes e Storage

A migration `158_dispute_storage_internal_session.sql` usa `CASE` nas políticas
de leitura para que identidades internas não executem
`current_portal_customer_id()`, contrato estrito que exige sessão válida do
Portal. A política INSERT continua exigindo Equipamentos/Administrativo,
mensagem própria, Dispute aberta e caminho do cliente/disputa/mensagem.
Validação SQL local confirma essas restrições. Correção aplicada com autorização
do dono em produção em 2026-10-06; upload físico e metadados confirmados na
sessão real de Equipamentos. Interface na sessão real de Financeiro conferida sem resposta/anexo; em
2026-10-08, um `POST` direto ao Storage com essa sessão foi recusado com `403
AccessDenied` (RLS). Ver o relatório da retomada run-2 e o
[plano arquivado](../archive/plans/2026-09-28-remediacao-auditoria-seguranca-run-2.md).
