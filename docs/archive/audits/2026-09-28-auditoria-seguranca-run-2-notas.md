# Auditoria de segurança run-2 — notas de trabalho

> **Snapshot histórico:** notas cronológicas da execução run-2 (commit `17da824a`, 2026-09-27 e 2026-09-28),
> preservadas como foram escritas. O relatório final está em
> [2026-09-28-auditoria-seguranca-run-2.md](2026-09-28-auditoria-seguranca-run-2.md). Caminhos de código são relativos à raiz do repositório
> naquele commit; menções a `REPORT.md`, `target-src/`, `harness/` e `agents/` referem-se à pasta da execução, fora do repositório.


**Situação: incompleta.** O usuário interrompeu a execução por custo. Foram cobertas 13 de 34 unidades do plano. Nenhum candidato passou pela verificação independente que a skill exige, então todos os itens abaixo são **candidatos** (reproduzidos localmente pelo próprio caçador), não achados confirmados.

- Commit auditado: `17da824a3d5c0f4d8f178c3d78ccf3e9a9046345` (cópia somente leitura em `target-src/`).
- Execução: somente leitura do código e Postgres 16 local isolado (sem rede, dados fictícios). Não houve nenhum contato com produção, Supabase, Cloudflare ou Vercel.
- Limites locais: não havia PostgREST, GoTrue nem Deno. Por isso o comportamento das Edge Functions só pode ser avaliado lendo o código, e as configurações do painel (Auth, segredos, cabeçalhos) não foram observadas.

## Resumo

Na parte revisada, a principal fronteira se manteve: um cliente do Portal não lê nem altera dados de outro cliente. Isso vale para as RPCs `portal_*`, para as tabelas lidas diretamente e para os arquivos das Disputes. Também se mantiveram:

- as funções privilegiadas negam acesso a usuários do Portal e a usuários internos inativos;
- `anon` só executa `portal_ship_schedule`;
- não há injeção de SQL;
- as 491 funções `SECURITY DEFINER` fixam `search_path`;
- os segredos das tarefas agendadas estão no Vault;
- as filas não aceitam gravação de papéis sem privilégio;
- o webhook de e-mail valida a assinatura.

Os problemas encontrados são de severidade proposta baixa. Dois deles contornam regras de negócio explícitas (a regra de quem responde uma Dispute e a trilha de auditoria).

## Candidatos (não verificados de forma independente)

| # | Severidade proposta | Título | Quem explora | Onde |
|---|---|---|---|---|
| 1 | baixa (impacto médio) | Encerrar, cancelar ou reabrir a Dispute editando a fatura diretamente, sem a regra de papel da 081 | qualquer usuário interno ativo (ex.: financeiro) | `012_demurrage_mutation_guards.sql:484` (permissão de UPDATE nas colunas `dispute_*`), política `demurrage_invoices_update_active_global` (`002:25388`), gatilho `sync_demurrage_dispute_lifecycle_from_invoice` (`002:21451`) |
| 2 | baixa | Anexar arquivos visíveis ao cliente em qualquer Dispute, inclusive resolvida, sem a regra Equipamentos/Administrativo | qualquer usuário interno ativo | política de storage `demurrage_dispute_objects_insert` (`074:11`), ramo interno de `add_demurrage_dispute_attachment` (`075:58`) |
| 3 | baixa | Cliente do Portal zera o próprio limite de tentativas chamando `check_portal_rate_limit` direto | usuário do Portal (só afeta o próprio cliente) | `002:3394-3404` e permissão a `authenticated` em `002:27471` |
| 4 | baixa | Registrar outro usuário como autor via `p_actor` | qualquer usuário interno ativo | `reject_customer_reconciliation` (`002:16389`), `add_manual_bl_charge` (`091:372`), `calculate_bl_local_charges` (`056:556`), `run_billing_for_import_batch` (`002:18263`) |
| 5 | baixa | Gravar em `audit_logs` departamento (`actor_role`/`actor_department`) e data (`changed_at`) falsos | qualquer usuário interno ativo | política `audit_logs_insert_self_global` (`002:24302`) não fixa esses campos |
| 6 | baixa | `save_bl_review` revela se um número de BL existe antes de checar permissão | usuário do Portal | `070_customer_review_communication_remediations.sql:63-77` |

## Correção sugerida (uma migration nova, 097)

1. `REVOKE UPDATE (dispute_open, dispute_status) ON public.demurrage_invoices FROM authenticated;` e levar o modal legado de Disputa (`src/pages/Demurrage.tsx` / `demurrageInvoices.ts`) para as RPCs `add_demurrage_dispute_message`/`reopen_demurrage_dispute`.
2. Nas duas políticas de storage e no ramo interno de `add_demurrage_dispute_attachment`, exigir `_portal_actor_role() IN ('equipamentos','administrativo')`, que a mensagem seja do próprio usuário e que a Dispute esteja aberta.
3. `REVOKE ALL ON FUNCTION public.check_portal_rate_limit(text,integer,integer) FROM PUBLIC, anon, authenticated;` e rejeitar janela ou limite menores ou iguais a 0 dentro da função.
4. Nas 4 RPCs com `p_actor`, se quem chama não é admin, exigir `p_actor = auth.uid()`, como já fazem `approve_customer_reconciliation` e `calculate_bl_local_charges_batch`.
5. Criar um gatilho `BEFORE INSERT` em `audit_logs` que, para sessões `authenticated`, sobrescreve `actor_role` e `actor_department` com `current_actor_role()` e `changed_at` com `now()`.
6. Mover a checagem `auth.uid()`/`is_active_user()`/`p_changed_by = auth.uid()` para o início de `save_bl_review`.

Para cada item, vale um teste de regressão SQL no padrão de `src/integration/*.local-pg.test.ts`. As reproduções estão em `agents/<id>/artifacts/evidence/` e `candidates/`.

## Reforços sugeridos (não são vulnerabilidades)

- As políticas `app_settings_administrativo_update` e `exchange_rate_reference_internal_read` chamam `_portal_actor_role()`, que `authenticated` não pode executar, então sempre falham (fecham o acesso). Corrigir ou remover.
- `recalculate_demurrage_invoices_manual` deixa qualquer usuário interno definir a PTAX que reprecifica as faturas abertas. Considerar restringir a Financeiro e Administrativo.
- `add_demurrage_dispute_attachment` não limita o tamanho de `p_file_name`.
- Anexos órfãos nunca são limpos (`list_orphaned_dispute_attachments` não é chamada em lugar nenhum).
- A Edge Function de anexo grava até 10 MB antes de checar cota e sessão revogada.
- `portal_add_dispute_message` e `portal_invoice_details` não aplicam a trava de liberação do Portal (afeta só o próprio cliente).
- Os segredos de cron movidos para o Vault na 007 não foram trocados. Recomenda-se rotacioná-los.
- Um bounce temporário marca `recovery_email_status='bounce_permanente'`.
- `anon` mantém USAGE/UPDATE em sequências e SELECT em tabelas (a RLS bloqueia). Revogar deixaria a negação explícita.
- As mensagens de Dispute expõem ao cliente o UUID do atendente (`author_id`, `uploaded_by`).
- `retry_import_effect` compara com nomes de papel antigos e bloqueia Administrativo e Operações (erro funcional).
- A função legada `import_breakbulk_manifest_transactional_031` continua liberada para `authenticated`.

## Não revisado (21 unidades)

- Lógica de valores de cobrança (valores, estornos, concorrência).
- Ciclo de vida: suspensão, reativação e revogação de sessão. Pista em aberto: a suspensão não invalida convites pendentes, e `portal-invite-activate` reativa a conta.
- Gatilhos que fingem ser `service_role` (`051`).
- Login, recuperação, reset e convite do Portal; limites de tentativa e Turnstile.
- Edge Functions internas: `admin-users`, `portal-invite-send`, `portal-account-suspend` e `send-customer-communication`. Pistas: HTML livre em comunicados e concatenação de dados sem escape no e-mail de cobrança agrupado.
- Front-end: XSS, sessão, telemetria, importação e exportação de planilhas.
- CI, dependências, scripts operacionais, cabeçalhos, CORS, itens básicos e varreduras curinga.

Plano de cobertura completo em `coverage-ledger.json`.

---

## Continuação — bloco 1 revisado (2026-09-28)

**Escopo:** login, recuperação de senha, reset de senha e convite/ativação do Portal, com limites de tentativa e Turnstile, e suspensão/reativação da conta do Portal. Isso corresponde às unidades `fn-portal-auth` e `fn-preauth-abuse`, à parte de suspensão de `db-lifecycle` e a `portal-account-suspend`/`portal-invite-send` de `fn-staff-privileged`. `admin-users` e `send-customer-communication` continuam não revisados.

**Método e evidência:** leitura direcionada de `target-src/` (commit `17da824a`), sem agentes e sem executar nada. Todo o bloco é **inspeção estática**. Não houve GoTrue, Deno nem painel do Supabase. O comportamento do GoTrue citado abaixo (claim `email` no JWT, *password grant* com a chave anon) é o comportamento conhecido do Supabase Auth e **não foi observado** neste ambiente. A configuração de Auth de produção também não foi observada. Nada no repositório foi alterado.

Arquivos lidos: `supabase/functions/{portal-login,portal-password-recovery,portal-password-reset,portal-invite-activate,portal-recovery-email-change,portal-account-suspend,portal-invite-send}/index.ts`, `_shared/{portalToken,portalLoginIdentity,portalLoginRateLimit,rateLimit,turnstile,revokePortalSessions,portalPasswordResetFlow,portalInvites,portalEmail,passwordPolicy}.ts`, `config.toml` (`[auth]`), `current_portal_customer_id` (`069`, `092:177`), as RPCs de limite de tentativa (`002:13001-13345`, `076`), `portal_revoke_sessions` (`002:13636`), `portal_cancel_invite` (`002:11700`), `_portal_actor_role` (`002:18`), `normalize_cnpj`, os gatilhos de `customer_portal_accounts`, as políticas RLS do Portal, `src/pages/Portal{ResetPassword,Ativacao,ConfirmarEmail}.tsx`, `src/components/portal/PortalReviewPanel.tsx`, `src/hooks/usePortalProvisioning.ts` e a ADR 0049.

### Novo candidato (não verificado de forma independente)

| # | Severidade proposta | Título | Quem explora | Onde |
|---|---|---|---|---|
| 7 | baixa | A senha do Portal pode ser testada direto no GoTrue com o email técnico, sem o limite por CNPJ, sem Turnstile e sem alerta | quem já teve uma sessão do Cliente (ex-funcionário do Cliente, computador compartilhado) e por isso conhece o email técnico | controles existem só em `portal-login/index.ts:33,47,82`; a senha do cliente é a própria senha do GoTrue (`portal-invite-activate/index.ts:39`, `portal-password-reset` via `updateUserById`); `config.toml` `[auth.rate_limit] sign_in_sign_ups = 30` (por IP, a cada 5 min) |

Detalhe do candidato 7:

- **Pré-condição.** O email técnico (`p-<uuid>@…invalid`) não é secreto. O access token devolvido por `portal-login` traz o claim `email`, e o supabase-js grava `session.user.email` no `localStorage` do Portal. Isso contradiz `docs/modules/clientes.md:220`, que diz: "o navegador nunca conhece o email técnico".
- **Caminho.** A pessoa chama `POST /auth/v1/token?grant_type=password` com a chave anon, que é pública no bundle, informando o email técnico e a senha a testar.
- **O que fica de fora nesse caminho:**
  - o balde de 5 falhas em 15 minutos por CNPJ (ADR 0049);
  - o Redis;
  - o Turnstile;
  - a checagem `account_situation = 'ativo'`;
  - o alerta `portal_abuso_login`.
- **Limites que continuam valendo:**
  - só o limite do GoTrue, por IP, que pode ser contornado trocando de IP;
  - a política de senha (8 caracteres com maiúscula, minúscula e dígito).
- **Resultado.** A sessão emitida é aceita pelo banco. `current_portal_customer_id` só exige `active = true`, cliente não desativado e `iat` posterior a `credentials_revoked_at`. Assim, depois que o Cliente troca a senha para tirar alguém, essa pessoa pode continuar tentando senhas num ritmo muito maior que o permitido pelo Portal, sem que o operador veja nada.
- **Correção sugerida.** Guardar no GoTrue uma senha derivada, `HMAC(PORTAL_PASSWORD_PEPPER, senha)` com sufixo fixo para passar em `password_requirements`, e aplicar a derivação em `portal-invite-activate`, `portal-password-reset`, `portal-login` e na verificação de `portal-recovery-email-change`. Com isso, a senha que o cliente conhece deixa de funcionar direto no GoTrue. Para as contas existentes, migrar no próximo login bem-sucedido. Uma alternativa é o *Password Verification Hook* do Supabase Auth, com o mesmo balde por CNPJ. Também é preciso corrigir `clientes.md:220`.

### Pistas encerradas (o controle se manteve)

1. **Suspensão × convite pendente.** A pista de "Não revisado" se confirma no código, mas não é alcançável pelo fluxo normal.
   - Confirmado no código: `portal-account-suspend` não toca em `portal_invites`, e `portal-invite-activate` não olha `account_situation` nem `auth_user_id` antes de gravar `active = true, account_situation = 'ativo'` (`:20`, `:44`).
   - Por que o fluxo normal não chega lá:
     - a tela só oferece Suspender para conta `ativo` (`PortalReviewPanel.tsx:195`);
     - a conta `ativo` não tem `convite` pendente, porque a ativação consome o convite;
     - `portal-invite-send` recusa conta `ativo` (`:31`) e invalida **todos** os pendentes, de qualquer finalidade (`:32`).
   - Resta a corrida de dois envios simultâneos, ou uma chamada direta da função pela equipe com outro estado. Isso vai para os reforços.
2. **Conta suspensa sem acesso.** Suspender grava `active = false` e revoga as sessões. Todas as políticas e RPCs do Portal passam por `current_portal_customer_id`, que exige `active = true`. A recuperação só emite link para conta `ativo`. Um reset feito numa conta suspensa troca a senha, mas não dá acesso. O mesmo vale para um login direto no GoTrue.
3. **Tokens.** Os tokens de convite, recuperação e confirmação de email têm 256 bits aleatórios, e o banco guarda só o SHA-256. Cada consumidor filtra pela sua finalidade (`recuperacao`, `convite`, `confirmacao_email`), então um token não serve para outro fluxo. A validade é checada, e o consumo é condicional (`status = 'pendente'` e `expires_at > now()`), portanto o uso é único e seguro contra corrida. As páginas tiram o token da URL, e o `Referrer-Policy` é `strict-origin-when-cross-origin`.
4. **Reset.** A sequência é revogar, pôr em quarentena (`credentials_revoked_at` 15 minutos no futuro), trocar a senha e revogar de novo. Junto com o corte estrito por `iat` (`069`/`092`), isso não deixa sobreviver uma sessão emitida com a senha antiga. Se a troca falhar, o resultado é fechado: o link é consumido e o cliente pede outro.
5. **Enumeração.**
   - O login usa a mesma mensagem para todos os casos, e o caminho de conta inexistente autentica contra o usuário fictício (*dummy*).
   - No caminho bloqueado, o trabalho extra roda em `waitUntil`.
   - A recuperação sempre responde `accepted` e processa em segundo plano.
   - `inspect` exige um token válido.
6. **Cabeçalhos de IP** (`CF-Connecting-IP`/`X-Forwarded-For`). Eles só compõem a chave do Redis, que pode apenas acrescentar bloqueio. Quem decide é o balde do Supabase por CNPJ. Forjar o cabeçalho não libera nada.
7. **Trancar o CNPJ de outra pessoa.** É possível, mas é o preço aceito na ADR 0049 (janela de 15 minutos com alerta). Não é um achado.
8. **Reativação.** A reativação limpa `auth_user_id`. O usuário antigo do Auth continua existindo, mas a sessão dele não encontra conta e é recusada. Os links de recuperação antigos são invalidados pelo próximo `portal-invite-send`, que não filtra por finalidade.
9. **Troca do Email de Recuperação.** Exige sessão e senha atual, e consulta o balde do login antes de verificar a senha. A confirmação exige o token enviado à caixa nova e revoga as sessões.
10. **Normalização do CNPJ.** O TS (`normalizeCnpj`) e o SQL (`normalize_cnpj` e o gatilho de `login_cnpj`) aplicam a mesma regra, mantendo as letras em maiúsculas. Não há colisão.
11. **Papel em `portal-account-suspend` e `portal-invite-send`.** Ambas usam `portal_current_role()` (`SECURITY DEFINER`, que exige `user_profiles.active`). Só Administrativo e Documentação passam, a mesma regra de `portal_cancel_invite`. O envio de convite para um endereço qualquer é decisão da equipe, prevista em projeto.

### Reforços sugeridos do bloco 1 (não são vulnerabilidades)

- O Turnstile libera tudo quando `TURNSTILE_SECRET_KEY` está ausente (`_shared/turnstile.ts:100-101`). Confirmar o segredo em produção, que não foi observado, e considerar negar por padrão fora do ambiente local.
- Suspender deveria cancelar os convites pendentes de todas as finalidades, como já fazem `portal_cancel_invite` e `portal-invite-send`.
- `portal-invite-activate` deveria exigir `account_situation IN ('convite_pendente', 'falha_no_envio')` e `auth_user_id IS NULL`.
- `portal-account-suspend` deveria validar o estado atual (suspender só `ativo`, reativar só `suspenso`), como a tela já faz.
- Reativar deveria apagar ou banir o usuário antigo do Auth em vez de só desvincular `auth_user_id`.
- `portal-recovery-email-change` (`request`) não tem cota de envio. Um Cliente ativo pode disparar quantos emails de confirmação quiser para endereços arbitrários, com conteúdo fixo, gastando a reputação e a cota do domínio do Portal. Esse caminho também não checa `active` (usa `getUser`, não `current_portal_customer_id`). Sugestão: reutilizar o convite vivo, como já faz a recuperação, e exigir conta ativa.
- `portal-login` checa `account_situation`, enquanto o banco checa `active`. Hoje isso não tem efeito, mas vale alinhar as duas checagens.
- `portal-invite-activate:41` devolve o convite a `pendente` sem a condição `.eq('status', 'consumido')`, que o caminho de `:47` já usa. Isso é menor.

### Atualização de "Não revisado"

Os itens "Login, recuperação, reset e convite do Portal; limites de tentativa e Turnstile" e a parte de suspensão de "Ciclo de vida" estão cobertos por esta continuação. Continuam em aberto:

- no ciclo de vida: reativação de **cliente** (`092`), rotina de guarda (`094`), exclusões (`096`) e gatilhos `051`;
- nas Edge Functions internas: `admin-users` (inclusive a pista `update_credentials` em usuário técnico do Portal) e `send-customer-communication`.

O candidato 7, como os demais, precisa de verificação independente, idealmente com o GoTrue real num ambiente controlado.

---

## Continuação — bloco 2 revisado (2026-09-28)

**Escopo (definido nesta sessão):** Edge Functions internas que usam `service_role` depois de checar o papel de quem chama:

- `admin-users`;
- `send-customer-communication`;
- a pista do e-mail de cobrança agrupado em `demurrage-dunning`;
- a prévia HTML de `ClientesComunicacao.tsx`.

Isso corresponde ao resto de `fn-staff-privileged` (a parte de `portal-account-suspend`/`portal-invite-send` já estava no bloco 1) e às unidades `fn-communications-access` e `fn-communications-injection`.

**Método e evidência:** o mesmo do bloco 1. Leitura direcionada de `target-src/` (`17da824a`), sem agentes e sem executar nada, e todo o bloco é **inspeção estática**. A assinatura de `auth.admin.signOut` citada abaixo é a da biblioteca `supabase-js`/`auth-js` e **não foi observada** em execução. O repositório não foi alterado.

Arquivos lidos:

- Edge Functions: `supabase/functions/admin-users/index.ts` e `send-customer-communication/index.ts` (inteiros); `demurrage-dunning/index.ts:470-500`.
- Templates e front-end: `_shared/customerCommunicationTemplates.ts` → `src/services/customerCommunicationTemplates.ts` (renderizadores, `escapeHtml`, validação de anexos); `src/pages/ClientesComunicacao.tsx` (`applySavedTemplate`, envio, prévia `:1207`).
- Banco: `is_admin`/`is_active_read_user`/`_portal_actor_role` (`002`); políticas e gatilhos de `user_profiles` (`002:23713`, `:23929`, `:26449-26473`); `cpa_admin_all` (`002:24910`); definição das tabelas `customer_communications`/`customer_communication_attempts`/`bls`/`demurrage_invoices` (`001`).
- Configuração e documentação: `config.toml` (`admin-users` fora da lista, portanto `verify_jwt` fica no padrão); `docs/operations/seguranca.md:29-90`; ADR 0059.

### Novos candidatos (não verificados de forma independente)

| # | Severidade proposta | Título | Quem explora | Onde |
|---|---|---|---|---|
| 8 | baixa (impacto médio) | Administrativo define a senha do usuário técnico de um Cliente e entra no Portal como esse Cliente | usuário interno ativo com papel `administrativo` (`is_admin()`) | `admin-users/index.ts:96-124` aceita qualquer `user_id`; `auth_user_id` do Cliente é legível por `cpa_admin_all` (`002:24910`) |
| 9 | baixa | Sessões de usuário interno nunca são revogadas: desativar ou trocar a senha não expulsa quem já tem sessão | quem já tem uma sessão de um usuário interno (conta comprometida) | `admin-users/index.ts:141` (`admin.auth.admin.signOut(userId)`); `:113` troca a senha sem revogar |
| 10 | baixa | `send-customer-communication` envia HTML e assunto arbitrários em `livre`/`institucional`, fora do escape que a tela garante, sem guardar o conteúdo enviado | usuário interno ativo de Administrativo, Documentação ou Equipamentos | `send-customer-communication/index.ts:298-300,493-495`; `customer_communications` (`001:1459`) não tem assunto nem corpo |

Detalhe dos candidatos:

- **#8.**
  - **Caminho.** O Administrativo:
    1. lê `customer_portal_accounts.auth_user_id` do Cliente;
    2. chama `admin-users` com `{action: 'update_credentials', user_id, password}`;
    3. entra por `portal-login` com o CNPJ (público) e a senha nova.
  - **O que a função não checa.** Não confere se o `user_id` tem linha em `user_profiles`, ou seja, se é um usuário interno.
  - **Efeito:**
    - uma sessão válida do Portal em nome do Cliente, com a qual o Administrativo pode escrever na Dispute como `cliente`, revisar BL e aprovar conciliação;
    - o Cliente perde a própria senha;
    - as sessões do Cliente não são revogadas, e `credentials_revoked_at` não muda;
    - nada vai para `portal_provisioning_events`. O único rastro é uma linha em `audit_logs` com `entity_type = 'user_profile'`, `field_name = 'password'`.
  - **O que isso contradiz:** `docs/operations/seguranca.md:78` ("sem expor email técnico ou senha ao operador") e `docs/modules/clientes.md:220`.
  - **Correção:** em `update_credentials` e `deactivate`, recusar `user_id` que não esteja em `user_profiles`, que esteja em `customer_portal_accounts.auth_user_id` ou que seja `PORTAL_LOGIN_DUMMY_AUTH_USER_ID`. A troca de acesso do Cliente continua pelos fluxos do Portal.
- **#9.**
  - **Por que `deactivate` falha.** `auth.admin.signOut` recebe o **JWT** do usuário, não o id. Passar o UUID faz a chamada falhar sempre. A função só registra `console.error` e responde `sessions_revoked: false`, e a tela ignora esse campo. `seguranca.md:59` já registra que o endpoint admin de logout do GoTrue devolve 404 nesta versão, e por isso o Portal usa `portal_revoke_sessions`. Não existe equivalente para usuários internos.
  - **O que isso causa:**
    - Depois de uma conta comprometida, trocar a senha pelo Admin (`:113`) não derruba a sessão do invasor, que continua com acesso total, porque o perfil segue ativo.
    - Desativar bloqueia o acesso pelo banco (`is_active_user`/`is_active_read_user`), mas os refresh tokens continuam existindo. Ao **reativar** o usuário (só o flag, `adminUsers.ts:52`), o refresh token antigo do invasor volta a funcionar.
  - **Correção:** uma RPC `service_role` que apague `auth.sessions`/`auth.refresh_tokens` do usuário, nos moldes de `portal_revoke_sessions`, chamada em `deactivate` e em toda troca de senha ou e-mail. Tratar a falha como erro, e não como aviso.
- **#10.**
  - **Como a tela faz.** Nos tipos `livre` e `institucional`, a tela renderiza o texto com `escapeHtml` (`customerCommunicationTemplates.ts:455`).
  - **Como o servidor faz.** O servidor envia o `html`, o `subject` e o `text` que recebeu (`:493-495`). Ele só re-renderiza os tipos operacionais e `ce_mercante_taxas`.
  - **Efeito.** Chamando a função direto, um usuário desses três setores envia, a qualquer contato ativo de qualquer Cliente, HTML livre com o remetente do Portal: links disfarçados, formulários, `text` diferente do `html`.
  - **O rastro.** Nenhuma tabela guarda o assunto nem o corpo enviados. `customer_communications` e `customer_communication_attempts` guardam tipo, âncoras, `created_by` e o destinatário mascarado.
  - **O que atravessa.** Não é outra fronteira de papel: são os mesmos setores que podem escrever o texto pela tela. O que se contorna é a escapagem e a trilha obrigatória (ADR 0046).
  - **Correção:** re-renderizar `livre`/`institucional` no servidor a partir de `subject`/`body` (o renderizador já é compartilhado com o Deno) e guardar assunto e corpo, ou um hash e uma cópia, no registro do comunicado.

### Pistas encerradas (o controle se manteve)

1. **Entrada de `admin-users`.**
   - Fica no `verify_jwt` padrão, porque não aparece em `config.toml`.
   - Exige `is_admin()`, que pede papel `administrativo` e `active = true`.
   - As escritas em `user_profiles` passam pelo cliente de quem chama, sob RLS. O gatilho `prevent_user_profile_privilege_escalation` impede alguém de trocar o próprio papel.
   - `create` só aceita os cinco setores, sem `admin`.
   - `deactivate` recusa o próprio usuário.
2. **Quem envia Comunicados.**
   - O papel vem de `portal_current_role()`, que exige perfil ativo. A lista (Administrativo, Documentação, Equipamentos) confere com o módulo descrito na ADR 0059/0060.
   - `cobranca_demurrage` é recusada nessa função, porque só a régua automática envia cobrança.
   - A chave global `communications_enabled` desligada gera só simulação.
3. **Automação.** O segredo é comparado em tempo constante e precisa ser não vazio. Sem o segredo configurado, o caminho de automação não abre. O bearer arbitrário só vale junto com o segredo, que fica no Vault e nos segredos da função.
4. **Vínculos de destinatário, B/L e âncora.**
   - O destinatário precisa ser contato do próprio Cliente e passar por `customer_communication_recipient_allowed` e pelas duas listas de supressão, que são checadas de novo no envio.
   - Os B/Ls precisam pertencer ao Cliente.
   - Viagem, porto e Atracação são conferidos com os B/Ls, e, no NOB, também a Frente de Operação.
5. **Conteúdo dos tipos operacionais e do CE Mercante.** O servidor renderiza tudo de novo a partir do banco, com `escapeHtml` em todos os campos.
6. **Anexos.**
   - Até 3 arquivos e 10 MB, nos tipos PDF, JPEG, PNG e texto.
   - O tamanho declarado precisa bater com o conteúdo base64.
   - O caminho no storage é `<communication_id>/<sha256>-<n>-<nome saneado>`, sem travessia de diretório.
7. **Prévia com `dangerouslySetInnerHTML`** (`ClientesComunicacao.tsx:1207`). O HTML sai do renderizador local, que escapa o corpo e o nome do Cliente, e os modelos salvos passam pelo mesmo renderizador (`applySavedTemplate` só preenche assunto e texto). Não há XSS armazenado entre usuários internos.
8. **E-mail de cobrança agrupado** (pista de "Não revisado"). A concatenação sem escape se confirma em `demurrage-dunning/index.ts:495,499`, com `customer.name`, `doc_number` e `bl_id`. Nenhum desses campos, porém, é gravável por um principal de confiança menor:
   - o nome é cadastrado pela equipe;
   - `doc_number` vem da emissão interna;
   - `bl_id` vem de manifestos importados pela equipe.

   Por isso fica como reforço, e não como candidato. Muda de figura se o manifesto de terceiros for tratado como fonte não confiável, porque `bls.id` não tem restrição de formato.
9. **Assunto com nome da empresa.** O envio é JSON para o Resend, não cabeçalho montado à mão. Não há injeção de cabeçalho.

### Reforços sugeridos do bloco 2 (não são vulnerabilidades)

- Usar `escapeHtml` no e-mail de cobrança agrupado (`demurrage-dunning/index.ts:495,499`), como já faz o modelo individual.
- `admin-users` não confere o erro de `audit()` (`:92,121,123`): a senha ou o e-mail podem mudar sem a linha em `audit_logs` que a ADR 0046 exige. Tratar a falha como erro.
- Anexos de Comunicado: o tipo é o declarado pelo navegador, sem checagem de assinatura de arquivo (*magic bytes*), e a extensão do nome não é comparada com o tipo. `portal-dispute-attachment` já faz as duas coisas. Replicar.
- `anchor_invoice_id`, `vessel_name`, `voyage_number` e `terminal_name` (fora do NOB) vêm do corpo da requisição e são gravados no histórico sem conferência. Isso é só cosmético, mas vale conferir ou derivar do banco.
- `deactivate` com um `user_id` sem perfil responde `ok`, porque o UPDATE atinge 0 linhas sem erro. Responder 404.

### Atualização de "Não revisado"

As Edge Functions internas estão cobertas pelos blocos 1 e 2. As duas pistas que estavam em aberto foram tratadas:

- HTML livre em comunicados: virou o candidato 10;
- cobrança agrupada: virou reforço.

`update_credentials` virou o candidato 8.

Continuam em aberto:

- lógica de valores de cobrança;
- resto do ciclo de vida (`092` reativação de cliente, `094`, `096`, gatilhos `051`);
- front-end (XSS fora de Comunicados, sessão, telemetria, planilhas);
- CI, dependências, scripts, cabeçalhos/CORS e varreduras curinga.

Os candidatos 8 a 10, como os demais, precisam de verificação independente. Para o 9, o ideal é observar a chamada `signOut(userId)` contra um GoTrue real num ambiente controlado.

---

## Continuação — bloco 3 revisado (2026-09-28)

**Escopo (definido nesta sessão):** o resto do ciclo de vida, com o que ficou pendente de `db-lifecycle` e a unidade `db-trigger-role-elevation`:

- desativação e reativação de **cliente** (`092`);
- rotina de guarda (`094`);
- exclusões (`086`, `087`, `088`, `096`);
- cancelamento e reativação de B/L e viagem (`089`, só as guardas);
- os gatilhos do faturamento automático pelo CE Mercante que se passam por `service_role` (`051`).

**Método e evidência:** o mesmo dos blocos 1 e 2. Leitura direcionada de `target-src/` (`17da824a`), sem agentes e sem executar nada. Todo o bloco é **inspeção estática** e não houve teste no Postgres local. O repositório não foi alterado.

Arquivos lidos:

- `092` inteiro; `094` inteiro; `096` inteiro; `086` inteiro;
- `087:1-65,160-172`; `088:1-40,136-139` e `delete_records` final (`088:241-359`); `089` (guardas e grants); `067` (`guard_voyage_hard_delete`);
- `051:1-40,249-346,450-530`;
- em `002`: políticas e grants de DELETE de `customers`/`customer_contacts`/`voyages`, políticas de `audit_logs`, `trg_voyage_schedule_snapshot`, `portal_create_account_on_customer_insert`;
- em `001`: as FKs que apontam para `customers`.

### Novo candidato (não verificado de forma independente)

| # | Severidade proposta | Título | Quem explora | Onde |
|---|---|---|---|---|
| 11 | baixa | Excluir cliente com CNPJ por DELETE direto na API, fora de `delete_records` (sem a trava "desative em vez de excluir" e sem motivo) | usuário interno ativo com papel `administrativo` | políticas `customers_delete_admin` (`002:25225`) e `customer_contacts_delete_admin` (`002:25119`), mais `GRANT DELETE` (`002:30730`, `:30762`), nunca revogados; regra só em `delete_records` (`088:297-300`) |

Detalhe do #11:

- **Regras que a API direta contorna.**
  - As migrations `087`/`088` passaram a exclusão de B/L, container, veículo e cliente para `delete_records`, com trava, prévia e motivo obrigatório (ADR 0071/0073).
  - Para B/L, container e veículo, a `088:136-139` também tirou o DELETE direto de `authenticated`. Para **cliente** e **contato**, não. Continuam a política `is_admin()` e o grant.
  - A regra "cliente com CNPJ: desative em vez de excluir" existe só dentro de `delete_records`.
- **Por que hoje quase sempre falha.** `customer_portal_accounts` e `portal_provisioning_events` têm FK `ON DELETE CASCADE` para `customers`, e `portal_create_account_on_customer_insert` grava um evento de Portal quando o cliente é criado. O gatilho somente-inclusão de `portal_provisioning_events` recusa o DELETE em cascata.
- **Quando passa a funcionar.** A própria `094:10-11` registra que, **depois que `run_retention()` apaga os eventos com mais de 1 ano**, essa trava implícita some e sobra "a regra explícita em delete_records". Mas o DELETE direto não passa por essa função.
- **Caminho.** Para um cliente com mais de um ano de cadastro e sem B/L, fatura, recebível ou Dispute (as FKs `RESTRICT`/`NO ACTION` ainda seguram esses casos), um Administrativo:
  1. apaga os contatos, `DELETE /rest/v1/customer_contacts?customer_id=eq.X`;
  2. apaga o cliente, `DELETE /rest/v1/customers?id=eq.X`.
- **Efeito:** o cliente com CNPJ é excluído sem motivo e sem a linha `deleted` de `delete_records`. O gatilho `audit_customers` grava `excluido` com `justification` nula. A conta do Portal cai em cascata, e o usuário técnico do Auth fica órfão.
- **Alcance.** É o mesmo principal que pode chamar `delete_records`, mas atravessa uma regra de negócio explícita e a trilha com motivo (ADR 0071, item 8).
- **Correção:** repetir para `customers` e `customer_contacts` o que a `088` fez nas três tabelas de B/L: `DROP POLICY customers_delete_admin, customer_contacts_delete_admin` e `REVOKE DELETE … FROM authenticated`. Vale conferir também se o DELETE direto de `voyages` (`voyages_delete_admin`) deve seguir o mesmo caminho. Para viagem, o risco é menor: `guard_voyage_hard_delete` (`067`) recusa qualquer viagem com dado vinculado, então só uma viagem vazia sai sem motivo.

### Pistas encerradas (o controle se manteve)

1. **Gatilhos da `051` que se passam por `service_role`** (pista de "Não revisado").
   - `trg_auto_bill_bl_after_ce_mercante` só grava `request.jwt.claim.role = 'service_role'` quando `auth.uid() IS NULL` **e** o papel ainda não é `service_role` (`051:476`). Isso só acontece em conexão sem JWT (dono, cron). Uma sessão de usuário interno sempre tem `auth.uid()` e não entra nesse ramo.
   - Em `auto_bill_bl_after_ce_mercante`, quem não é `service_role` precisa ter `p_actor = auth.uid()` e perfil ativo (`:272-273`). Por isso a troca de `request.jwt.claim.sub` (`:347`) nunca acontece numa chamada de usuário interno.
   - Os valores que o usuário controla na linha (`ce_mercante`, `customer_id`, `customer_reconciliation_status`) só disparam o faturamento que a própria regra de negócio prevê. A exceção à trava do Portal é documentada (`seguranca.md:57`), e as saídas idempotentes e a checagem de conciliação vêm antes de qualquer troca de identidade.
   - O contexto interno (`vela.billing_context_table`) é um ponteiro para uma tabela temporária do dono da função. Não dá para forjá-lo só com `set_config`, que de todo modo não está exposto pelo PostgREST.
2. **Cliente desativado.**
   - `deactivate_customer` e `reactivate_customer` exigem Administrativo ativo e motivo, recusam desativar com fatura, recebível ou Demurrage em aberto e gravam em `audit_logs`.
   - As colunas de desativação só mudam pelas RPCs: o gatilho exige `vela.allow_customer_state`, que é local à transação.
   - O Portal cai na hora (`current_portal_customer_id`, `092:201-203`).
   - B/L com CNPJ de cliente desativado vira sugestão, e o vínculo manual é recusado.
3. **Rotina de guarda.**
   - `run_retention()` não é executável por `anon` nem por `authenticated`.
   - `audit_logs` não tem UPDATE nem DELETE para `authenticated`/`service_role` (`086:44-47`). Portanto nenhum usuário consegue envelhecer uma linha legítima para a rotina apagá-la. Com o candidato 5 (`changed_at` falso), dá para inserir linhas já "antigas", mas elas são do próprio autor, e apagá-las não apaga rastro de ninguém.
   - O DELETE nas tabelas somente-inclusão só passa com `vela.retention`, ligado dentro da rotina.
   - `portal_login_attempts` guardado por 1 ano não afeta o balde de 15 minutos.
4. **Marcas de escala em `audit_logs`.** `trg_voyage_schedule_snapshot` (`SECURITY DEFINER`) grava `voyages.*_schedule_snapshot` a partir de qualquer linha inserida. Porém `voyages` já é de escrita global para usuário interno ativo (`voyages_update_active_global`, ADR 0046), então não há ganho de privilégio.
5. **Exclusões por `delete_records`, `delete_catalog_row` e B/L.**
   - `delete_records` e `delete_catalog_row` exigem Administrativo ativo (a exceção documentada é a linha de serviço de vazios) e motivo.
   - `delete_catalog_row` aceita uma lista fixa de tabelas e monta o SQL com `%I`/`USING`, sem injeção.
   - O DELETE direto de B/L, container, veículo e das tabelas de cadastro foi revogado (`088`, `096`), e documento fiscal e auditoria não se apagam pela API (`086`).
6. **Cancelar e reativar B/L e viagem** (`089`). As funções exigem Administrativo ativo (e `p_changed_by = auth.uid()` em `cancel_voyage`), e a troca de estado só passa com `vela.allow_bl_state` local à transação.

### Reforços sugeridos do bloco 3 (não são vulnerabilidades)

- **O que desativar o cliente não bloqueia.** A desativação não mexe na conta do Portal. `portal-password-recovery`, `portal-invite-send`, `send-customer-communication` e `portal-daily-digest` não olham `customers.deactivated_at`. Assim, um cliente desativado ainda recebe link de recuperação (a sessão resultante é recusada pelo banco) e pode receber Comunicados e o resumo diário. Sugestão: recusar ou ignorar cliente desativado nesses caminhos.
- **Corrida na desativação.** `deactivate_customer` trava a linha do cliente, mas a emissão de fatura não trava o cliente. Uma fatura criada na mesma janela pode sobreviver à checagem de "em aberto". Isso é menor.
- **Faltas nos gatilhos de exclusão.**
  - O DELETE direto de viagem vazia (`voyages_delete_admin`) grava `excluido` sem motivo.
  - O DELETE em cascata de `customer_portal_accounts` deixa o usuário do Auth órfão.

### Atualização de "Não revisado"

Ciclo de vida e gatilhos `051` estão cobertos pelos blocos 1 a 3. Continuam em aberto:

- lógica de valores de cobrança (valores, estornos, concorrência);
- front-end (XSS fora de Comunicados, sessão, telemetria, planilhas);
- CI, dependências, scripts operacionais, cabeçalhos/CORS e varreduras curinga.

O candidato 11, como os demais, precisa de verificação independente. O teste natural é um SQL no padrão de `src/integration/*.local-pg.test.ts`: cliente com CNPJ, eventos de Portal apagados pela rotina de guarda, e depois DELETE direto como Administrativo.

---

## Continuação — bloco 4 revisado (2026-09-28)

**Escopo (definido nesta sessão):** lógica de valores de cobrança, a unidade `db-billing-logic`: valores, estornos, reembolsos, descontos, PIX e concorrência. As guardas de papel dessas RPCs já tinham sido levantadas em `db-staff-financial` (ledger). Aqui o critério é o da unidade: só vale como achado quando **um principal de confiança menor** (Cliente do Portal ou setor sem autoridade financeira) **ou uma chamada concorrente ou repetida** chega a um estado financeiro inválido.

**Método e evidência:** o mesmo dos blocos anteriores. Leitura direcionada de `target-src/` (`17da824a`), sem agentes e sem executar nada. Todo o bloco é **inspeção estática**, sem teste de concorrência no Postgres local. O repositório não foi alterado.

Definições lidas (a última versão de cada, com a cadeia de *wrappers* seguida até a implementação):

- caminhos do Portal: `portal_create_consolidation` (`002:11753`), `create_local_consolidated_invoice_core` (`019:880`), `portal_obsolete_consolidation` (`002:13167`);
- baixa local, com a cadeia completa: `register_ledger_invoice_payment` de 8 argumentos (`070:160`) → `_legacy_070`, o *wrapper* SQL de `066:288` → versão de 9 argumentos (`070:183`) → `_legacy_066`, o *wrapper* de `052:175` → `_legacy_052`, a implementação de `019:6`; mais `assert_ledger_invoice_payment_allocation` (`052:89`);
- demais RPCs: `reconcile_invoice_payment_by_txid` (`002:15047`), `reverse_invoice_payment` (`019:343`), `register_demurrage_payment` (`027`), `apply_demurrage_discount` (`012`), `reverse_demurrage_payment` (`002:17746`), `settle_invoice_refund` (`002:21150`), `recalculate_demurrage_invoices` (`066:430`), `check_portal_rate_limit` (`002:3394`);
- gatilhos de INSERT em `invoices`.

### Resultado: nenhum candidato novo

Nenhum caminho alcançável por um Cliente, por um setor sem autoridade financeira ou por repetição ou concorrência de chamadas levou a um estado financeiro inválido.

### Agravante do candidato 3

`portal_create_consolidation` e `portal_obsolete_consolidation` limitam o Cliente a 3 criações a cada 10 minutos e 3 desfazimentos a cada 15 minutos, usando `check_portal_rate_limit`. Pelo candidato 3, o próprio Cliente zera esses contadores chamando a função com janela negativa. Com os contadores zerados, ele pode criar e desfazer consolidadas sem limite.

Cada ciclo grava:

- uma fatura nova, com número tirado do gatilho `assign_invoice_number`;
- os itens da fatura e os eventos de ciclo de vida;
- várias linhas em `audit_logs` (o gatilho `audit_invoices` grava uma por campo);
- uma entrada em `audit_logs` com a justificativa "via portal";
- duas notificações.

O efeito fica limitado ao próprio Cliente e ao volume das tabelas: faturas `obsolete` em série nas listas financeiras internas e números de fatura queimados. Não altera valores. A correção 3 já proposta (tirar o `EXECUTE` de `authenticated` e recusar janela ou limite ≤ 0) fecha também este efeito.

### Pistas encerradas (o controle se manteve)

1. **Consolidação pelo Portal.**
   - O Cliente vem de `current_portal_customer_id()`. Os recebíveis de outro Cliente, os de B/L sem liberação do Portal e os inexistentes são recusados.
   - O núcleo trava os recebíveis com `FOR UPDATE` em ordem de id e exige status aberto com saldo positivo. Recusa recebível que já está em outra consolidada aberta: sob `READ COMMITTED`, a segunda transação vê o vínculo depois da espera.
   - O total é a soma dos saldos no servidor, e o Cliente não informa valor nenhum.
   - A falta de ROE congelado em linha USD aborta a operação.
2. **Desfazer consolidada pelo Portal.** A fatura é travada e precisa ser do próprio Cliente e do tipo `consolidated`. A operação é recusada se a fatura estiver paga, coberta, cancelada ou obsoleta, ou se houver **qualquer** linha em `payments`. Toda baixa local grava em `payments` (`019:105`), então `partially_paid` também fica bloqueada.
3. **Baixa local.**
   - Todas as entradas exigem Administrativo ativo.
   - O valor precisa ser maior que zero, e o que excede o saldo só entra por lançamento manual.
   - O TXID não pode ter sido conciliado antes.
   - As travas ficam em ordem determinística: *advisory* por B/L, depois recebíveis e depois a fatura com `FOR UPDATE`.
   - A idempotência vem de `ledger_payment_requests` com hash do conteúdo: a mesma `request_id` com outro conteúdo é recusada, e a repetição devolve o resultado gravado.
   - A soma alocada por recebível nunca passa do valor original.
   - Uma chamada concorrente com o estorno pode dar *deadlock*, porque as ordens de trava diferem, mas o banco aborta uma das duas e não fica estado parcial.
4. **Conciliação por TXID.** A regra é só "TXID igual ao número da fatura", sem recurso por valor ou CNPJ. Se houver mais de uma fatura correspondente, a conciliação não é feita, e fatura `obsolete`/`cancelled` não casa. Um PIX pago numa consolidada desfeita depois vai para tratamento manual, sem virar baixa na fatura errada.
5. **Demurrage.**
   - **Baixa:** trava de linha e idempotência por `request_id`. Só aceita fatura `issued`/`overdue` sem `paid_at`, e o valor precisa bater com a foto financeira dentro de R$ 0,01. O TXID não pode estar em outra fatura, e a repetição do mesmo TXID é idempotente.
   - **Desconto:** aceita percentual de 0 a 100 e valor fixo até o total em USD, exige justificativa e recusa fatura paga ou cancelada.
   - **Estorno:** exige Administrativo, justificativa e fatura `paid`.
   - **Recálculo por PTAX:** só toca faturas `issued` sem `paid_at`, sob `FOR UPDATE`, com PTAX no intervalo (0, 1000].
6. **Reembolso.** `settle_invoice_refund` exige Financeiro, `p_actor = auth.uid()`, trava a linha e aceita só reembolso `pending`.

### Reforços sugeridos do bloco 4 (não são vulnerabilidades)

- **Ordem de travas.** Alinhar a ordem de travas entre baixa e estorno de fatura local. Hoje a baixa trava recebíveis e depois a fatura, e o estorno trava a fatura e depois os recebíveis. O banco resolve com *deadlock* e aborto, mas a operação falha de forma confusa para o usuário. O estorno também poderia pegar os *advisory locks* por B/L que a baixa já usa.
- **PIX em trânsito.** `portal_obsolete_consolidation` poderia recusar o desfazimento enquanto houver candidato de conciliação PIX pendente para aquela fatura, para não mandar para tratamento manual um PIX que o Cliente já pagou.
- **Notificação da consolidada.** A notificação de consolidada usa `array_length(p_receivable_ids)` (a entrada crua, com repetidos) em vez da contagem deduplicada. É só cosmético.
- **Recálculo por PTAX.** `recalculate_demurrage_invoices` reprecifica só `issued`, deixando `overdue` de fora, embora a baixa aceite as duas. É preciso confirmar se é regra de negócio. Não é questão de segurança.

### Atualização de "Não revisado"

A lógica de valores de cobrança está coberta. Continuam em aberto:

- front-end (XSS fora de Comunicados, sessão, telemetria, importação e exportação de planilhas);
- a cadeia de importação (`chain-import-pipeline`);
- CI, dependências, scripts operacionais, cabeçalhos/CORS, itens básicos do repositório e varreduras curinga.

---

## Continuação — bloco 5 revisado (2026-09-28)

**Escopo (definido nesta sessão):** o front-end que roda no navegador, ou seja, as unidades `fe-dom`, `fe-session` e `fe-telemetry`:

- `fe-dom`: pontos onde dados do banco viram HTML, links ou navegação;
- `fe-session`: os dois clientes Supabase, logout e cache;
- `fe-telemetry`: Sentry, PostHog e Vercel.

Importação e exportação de planilhas e a cadeia de importação (`fe-imports`, `fe-exports`, `chain-import-pipeline`) ficam para outro bloco.

**Método e evidência:** leitura direcionada de `target-src/` (`17da824a`), sem agentes e sem executar nada. Para o comportamento das bibliotecas, li o código **instalado** em `~/Downloads/vela/node_modules`, só leitura: `@supabase/auth-js` 2.103.3 (`GoTrueClient.js:260-300,3000-3090`) e `@sentry-internal/browser-utils`/`@sentry/browser` 10.57.0 (`instrument/history.js`, `integrations/breadcrumbs.js`, `core/utils/url.js`).

Isso **não** é observação em navegador: o bloco é inspeção estática do app e das bibliotecas. O repositório não foi alterado.

Arquivos do app lidos:

- sessão e entrada: `src/services/supabase.ts`, `src/hooks/useAuth.tsx` (`onAuthStateChange`, `signOut`), `src/hooks/usePortalAuth.tsx` (`clearPortalQueries`), `src/main.tsx` (ordem de inicialização), `src/lib/portalQueryClient.ts`;
- telemetria: `src/lib/telemetry.ts`, `telemetryContract.ts`, `featureFlags.ts` (PostHog);
- DOM: `src/lib/printDocument.ts`, `src/components/portal/NotificationBell.tsx`, `src/services/customerFicha.ts` (links da linha do tempo), `ShipScheduleWidget.tsx`/`ChegadasSaidas.tsx` (links do MarineTraffic), `src/pages/Profile.tsx` (troca de e-mail);
- a varredura de todos os `dangerouslySetInnerHTML`/`innerHTML`/`window.open`/`href`/`src` dinâmicos em `src/`.

### Novo candidato (não verificado de forma independente)

| # | Severidade proposta | Título | Quem explora | Onde |
|---|---|---|---|---|
| 12 | baixa | Login forçado (*login CSRF*) no app interno: um link com `#access_token=…&refresh_token=…` troca a sessão de quem abre | qualquer pessoa com uma sessão válida do mesmo projeto Supabase: usuário interno ou Cliente do Portal (usuário técnico) | `src/services/supabase.ts:18-24` (`detectSessionInUrl: true` com o `flowType` padrão `implicit`); `auth-js` `_initialize` → `_getSessionFromURL` → `_saveSession` |

Detalhe do #12:

- **Mecanismo.** No `auth-js` instalado, quando a URL tem os parâmetros de retorno *implicit* (`access_token`, `refresh_token`, `expires_in`, `token_type`), `_initialize` valida o token com `/user` e **grava a sessão por cima da que existia**. Ele não confere se a página iniciou aquele fluxo, e não existe `state` ou *verifier* no fluxo *implicit*.
- **Ataque.** A pessoa manda a um usuário interno o link `https://<app interno>/#access_token=<o seu>&refresh_token=<o seu>&expires_in=3600&token_type=bearer`.
- **Efeitos:**
  - Com a sessão de **outro usuário interno**, a vítima passa a trabalhar na conta de quem atacou. As gravações dela saem em nome de quem atacou, e o que ela digita fica visível para quem atacou nas telas e na trilha da própria conta.
  - Com o token técnico de um **Cliente do Portal**, o perfil não carrega, e `useAuth` faz logout. A vítima perde a sessão, o que é só incômodo.
- **Alcance.** Não dá acesso a dados que quem atacou já não tivesse. Por isso a severidade é baixa.
- **Por que o app usa essa opção.** O app interno precisa de `detectSessionInUrl` para o link de confirmação da troca de e-mail (`Profile.tsx:49`, `updateUser({ email })`).
- **Correção:** `flowType: 'pkce'` no cliente interno. O retorno passa a ser `?code=` trocado com o *verifier* guardado no navegador de quem iniciou, e um link forjado deixa de funcionar. Isso também tira os tokens da URL (veja o reforço de telemetria abaixo).

### Pistas encerradas (o controle se manteve)

1. **Pontos onde dados viram HTML.**
   - Só há dois em `src/`:
     - a prévia de Comunicados, já tratada no bloco 2, sem XSS armazenado;
     - `printDocumentElement`, que clona o DOM já renderizado pelo React, com texto escapado, e define o título por propriedade, sem HTML.
   - Não há `innerHTML`, `document.write`, `eval` nem `new Function`.
2. **Links e navegação a partir de dados.**
   - `NotificationBell` só navega para `link` que começa com `/portal`, e pelo roteador, sem `location`.
   - Os links da linha do tempo do cliente (`customerFicha.ts`) são rotas internas montadas no código, com ids interpolados após um prefixo fixo.
   - Os links do MarineTraffic têm prefixo fixo `https://…/imo:`, então um valor do banco não vira `javascript:`.
3. **Isolamento das duas sessões.** Os clientes interno e do Portal usam chaves de armazenamento distintas. O Portal tem `detectSessionInUrl: false` e recebe seus tokens por query, que as páginas removem.
4. **Cache do Portal no logout.** `clearPortalQueries` remove as consultas com prefixo `portal-`, e todas as chaves das telas do Portal usam esse prefixo (a única fora do padrão, `customer-detail`, é do app interno). O cache fica só em memória: não há `persistQueryClient` nem gravação de dados em `localStorage`, fora o tema e o cache de ROE público.
5. **PostHog.** Sem captura automática, sem visualização de página, sem gravação de sessão, com persistência em memória. `before_send` só deixa sair eventos nomeados e quatro propriedades de uma lista fechada (hashes e enums). URL, dispositivo e identificadores caem.
6. **Vercel Analytics e Speed Insights.** `redactVercelTelemetryEvent` remove query e fragmento e troca CNPJ, B/L, viagem e cliente dos caminhos por marcadores.
7. **Sentry.**
   - `sendDefaultPii: false`, sem *replay* nem *tracing*.
   - `beforeSend` limpa CNPJ, CPF e e-mail das mensagens, `extra`, `tags` e *breadcrumbs*, e tira a query da URL e do `Referer`.
   - O usuário vai só com o UUID, e no Portal vai sem usuário.

### Reforços sugeridos do bloco 5 (não são vulnerabilidades)

- **Fragmento de URL na telemetria.**
  - **O defeito:** `redactTelemetryUrl` só corta a partir de `?` (`telemetryContract.ts:18-21`). Uma URL com `#access_token=…&refresh_token=…` e sem `?` passa intacta.
  - **Quando a URL tem tokens no fragmento:** no app interno, o fluxo *implicit* os coloca lá no retorno da troca de e-mail, e também no link do #12, até o `auth-js` limpar com `location.hash = ''`. Isso acontece depois de uma chamada de rede.
  - **Onde os tokens iriam para o Sentry:**
    - em `event.request.url`, se um erro for capturado nessa janela;
    - no `from` de um *breadcrumb* de navegação, se houver um `pushState`/`replaceState` com URL durante a janela.
  - **O que não se demonstrou.** Na leitura do Sentry instalado, o `lastHref` começa vazio, e o `popstate` gerado pela limpeza não grava o fragmento. Portanto o vazamento depende da ordem dos eventos na carga da página.
  - **Correção:** fazer `redactTelemetryUrl` remover também `#…`. O `flowType: 'pkce'` do #12 elimina a origem.
- **Cache no logout interno.** O logout do app interno (`useAuth.signOut`) não limpa o cache do TanStack Query nem recarrega a página. Como a leitura interna é global (ADR 0044), o impacto se limita a dados por usuário, como notificações internas e perfil: eles podem aparecer para o próximo usuário na mesma aba até a nova busca. Sugestão: `queryClient.clear()` no logout, como o Portal já faz com o prefixo `portal-`.
- **CNPJ no caminho da URL.** O Sentry não troca CNPJ no **caminho** de `event.request.url`, como `/clientes/<cnpj>`. O `scrubPii` só é aplicado a mensagens e *breadcrumbs*. A Vercel já troca por `:cnpj`. Reaproveitar `VERCEL_DYNAMIC_ROUTE_REDACTIONS` no `beforeSend`.

### Atualização de "Não revisado"

XSS, sessão e telemetria do front-end estão cobertos. Continuam em aberto:

- importação e exportação de planilhas e a cadeia de importação (`fe-imports`, `fe-exports`, `chain-import-pipeline`), inclusive *prototype pollution* em fusões de objetos vindos de planilha ou JSON;
- CI, dependências, scripts operacionais, cabeçalhos/CORS, itens básicos do repositório e varreduras curinga.

O candidato 12, como os demais, precisa de verificação independente. O teste natural é em navegador contra um GoTrue local: abrir o link forjado numa aba com sessão interna ativa e confirmar a troca de usuário.

---

## Continuação — bloco 6 revisado (2026-09-28)

**Escopo (definido nesta sessão):** importação e exportação de planilhas e a cadeia de importação, ou seja, as unidades `fe-imports`, `fe-exports` e `chain-import-pipeline`. A pergunta desta última é o uso de segunda ordem dos dados importados: que campo de arquivo vira autoridade para vínculo ao Portal, destinatário de e-mail ou faturamento.

**Método e evidência:** leitura direcionada de `target-src/` (`17da824a`), sem agentes e sem executar nada. Todo o bloco é **inspeção estática**. As versões de biblioteca citadas vêm do `package.json` e de fatos públicos das correções, sem nada testado. O repositório não foi alterado.

Arquivos lidos:

- importação e exportação: `src/services/importCore.ts` (inteiro), `src/lib/csv.ts`, `src/lib/spreadsheetSafe.ts`, `src/services/exports.ts` (`toSheet` e o CSV de conferência `:266-282`), `src/services/reconciliacao.ts:705-726`, `src/services/importValidation.ts:55-85`;
- contatos e convite: `ensure_customer_contact_email` (`043:18-123`), `capture_manifest_financial_contact` (`008:1789`) e suas chamadas (`002:1505,2241,18744`; `072:408`), `customer_communication_recipient_allowed` (`043:132`);
- disparo automático: `evaluate_and_dispatch_automatic_communications` (versão final em `062`, seleção por caixa em `:722-797`), `customer-communication-auto-runner/index.ts`;
- candidatos do convite: a consulta do console do Portal (`002:12880,12943`) e `PortalReviewPanel.tsx:40-175`;
- documentação: `docs/modules/manifesto-edi.md:145-165`.

### Novo candidato (não verificado de forma independente)

| # | Severidade proposta | Título | Quem explora | Onde |
|---|---|---|---|---|
| 13 | baixa (impacto médio) | O e-mail escrito no documento do B/L vira contato **ativo** do Cliente e passa a receber os comunicados dele. No console do Portal, esse e-mail aparece como candidato a convite com a etiqueta "Contato do Cliente" | quem define o bloco do consignatário de um B/L destinado ao Cliente (embarcador ou parte que instrui o B/L). O CNPJ do Cliente é público | `ensure_customer_contact_email` (`043:85-102`), chamada pela importação e pela conciliação; seleção por caixa em `062:722-797`; etiqueta fixa em `002:12880,12943` |

Detalhe do #13:

- **A regra documentada.** `docs/modules/manifesto-edi.md:145-158` descreve a captura como intencional: o e-mail do consignatário que vem no documento do B/L é registrado como contato financeiro na própria importação. No caminho de vínculo automático por CNPJ (`matched_document`), isso acontece **sem Revisão**. A documentação não trata de quem controla esse campo.
- **O que a captura faz** (`043:85-102`):
  - cria o contato ativo, com `origin = 'bl_automatico'` e `purpose = 'financeiro'`;
  - liga o contato **sempre** à caixa `documentacao_operacao`;
  - se o Cliente ainda não tinha contato principal, o contato vira **principal** e entra em **todas** as caixas ativas (`documentacao_operacao`, `financeiro`, `demurrage`).
- **O que o contato passa a receber.** O disparo automático (`062:722-797`) manda para os contatos das caixas `documentacao_operacao`/`financeiro`, e `customer_communication_recipient_allowed` só recusa contato desativado ou suprimido. O e-mail capturado recebe, sem nenhum passo humano:
  - o resumo de CE Mercante e Taxas Locais do Cliente **na viagem inteira**, com todos os B/Ls do Cliente naquela viagem (inclusive de outros embarcadores), números de CE e valores;
  - os avisos operacionais NOA, NOR e NOB;
  - se virou principal, também a régua de cobrança de Demurrage;
  - e, pela caixa, os Comunicados livres e institucionais enviados a "todos".
- **Caminho** para quem embarca **um** B/L consignado ao CNPJ de um Cliente e põe um e-mail próprio no bloco do consignatário:
  1. a importação vincula o B/L por CNPJ;
  2. a captura cria o contato ativo;
  3. o resumo financeiro da viagem sai automaticamente para esse endereço, se `communications_enabled` estiver ligada.
- **Agravante no Portal.** A consulta do console (`002:12880,12943`) lista esses contatos entre os "Candidatos de email" do convite com `origin` fixa `'Contato do Cliente'`, escondendo que vieram de `bl_automatico`. O convite dá acesso completo ao Portal do Cliente e exige clique e confirmação da equipe ("este email pertence à pessoa autorizada pelo Cliente?"), mas a etiqueta induz a confiar no endereço.
- **O que não se verificou.** Não confirmei quem preenche o e-mail do consignatário no documento de origem (sistema do armador, instrução do embarcador). A premissa de que ele não é escrito pelo próprio Cliente precisa de confirmação com o negócio.
- **Correção sugerida:**
  - criar o contato de `bl_automatico` **inativo**, ou fora de todas as caixas, até uma confirmação da equipe (a Revisão já é o lugar);
  - não promovê-lo a principal automaticamente;
  - na consulta de candidatos, expor a `origin` real e não oferecer contato `bl_automatico` como candidato a convite sem essa confirmação.

### Pistas encerradas (o controle se manteve)

1. **Leitura de planilha.**
   - O leitor central usa `@e965/xlsx` 0.20.3, versão posterior às correções públicas do SheetJS para *prototype pollution* (0.19.3) e ReDoS (0.20.2).
   - O mapeamento de colunas usa mapas fixos de cabeçalho (`createHeaderMapper`/`matchHeaders`). Um cabeçalho `__proto__`/`constructor` só gera chave inerte, e não há fusão profunda de objetos vindos da planilha.
   - EDI é recusado no leitor de planilhas, e o fallback Windows-1252 só é aceito quando o importador o pede.
   - Como o arquivo é escolhido e aberto pela própria equipe, travamento ou arquivo gigante afeta só a própria sessão, sem atravessar fronteira.
2. **Exportação XLSX.** Todas as exportações passam por `sanitizeSheetRows` e `json_to_sheet`, que gravam as células como **texto**. Célula de texto em XLSX não é avaliada como fórmula, mesmo começando com `=`, então o prefixo `'` é defesa extra.
3. **Exportação CSV.** Só existe uma exportação CSV de dados (conferência de Taxas Locais), com B/L, nome do Cliente, POD e itens de tarifa. Nenhum texto escrito por Cliente do Portal vai para planilha exportada à equipe.

### Reforços sugeridos do bloco 6 (não são vulnerabilidades)

- **Retorno de carro no CSV.** `downloadCsv` (`csv.ts:5-12`) só põe aspas quando há vírgula, aspa ou `\n`. Um valor com `\r` no meio (`"abc\r=HYPERLINK(…)"`) sai sem aspas. No Excel, o `\r` quebra a linha, e o trecho depois dele vira a primeira célula da linha seguinte, **sem** passar pelo `sanitizeCellValue`, que só olha o início do valor. Sugestão: pôr aspas também quando houver `\r` e aplicar a sanitização a cada linha do valor. Hoje os campos vêm de importação ou da equipe.
- **CSV de problemas de importação.** `formatIssuesAsCsv` (`importValidation.ts:73-79`) não passa `row`, `field`, `code` nem `message` por `sanitizeCellValue`, e pôr o campo entre aspas não impede fórmula no Excel. O conteúdo vem do próprio arquivo que a equipe importou, que já poderia conter a fórmula. Mesmo assim, reaproveitar `downloadCsv` fecha a diferença.
- **Sanitizador de fórmula.** `FORMULA_INJECTION_PREFIX` não cobre espaço à esquerda antes de `=`, nem os caracteres de largura total (`＝`, `＋`, `－`, `＠`), que alguns leitores normalizam. Vale incluir.

### Atualização de "Não revisado"

Importação, exportação e cadeia de importação estão cobertas. Continuam em aberto:

- CI e workflows (`ci-workflows`);
- dependências (`deps-supply`);
- scripts operacionais (`scripts-ops`);
- cabeçalhos, CORS e hospedagem (`hosting-headers-cors`);
- itens básicos do repositório (`obvious-repo`);
- varreduras curinga (`wildcard-app`, `wildcard-db`).

O candidato 13, como os demais, precisa de verificação independente: um teste SQL que importe um B/L com vínculo por CNPJ e e-mail de consignatário novo e confira que o contato entra ativo, na caixa `documentacao_operacao`, e aparece em `evaluate_and_dispatch_automatic_communications`. Também é preciso confirmar com o negócio quem escreve esse e-mail no documento de origem.

---

## Continuação — bloco 7 revisado (2026-09-28)

**Escopo definido para o bloco 7:** as unidades que restavam — CI e workflows (`ci-workflows`), dependências (`deps-supply`), scripts operacionais (`scripts-ops`), cabeçalhos, CORS e hospedagem (`hosting-headers-cors`), itens básicos do repositório (`obvious-repo`) e as varreduras curinga (`wildcard-app`, `wildcard-db`).

**Método e evidência:** inspeção estática da cópia congelada (`target-src`, commit 17da824a), sem agentes, com leitura direcionada:

- os seis workflows em `.github/workflows/` e `.github/dependabot.yml`;
- `package.json`, `package-lock.json` (versões resolvidas, origem dos pacotes, pacotes com script de instalação) e os imports das Edge Functions;
- `scripts/load-branch-env.mjs`, `provision-preview-admin.mjs`, `cloudflare-pages-stage.mjs`, `vercel-build.mjs`, `backup-r2.mjs`, `qa-display-production/`, `no-mistakes/setup.sh`;
- `vercel.json`, `_shared/cors.ts`, `.env.example`, `.gitignore`, `.mcp.json`, `opencode.json`;
- `docs/operations/servicos-externos.md` (onde cada segredo está guardado);
- uma varredura por padrões de segredo em todo o `target-src` (fora de `node_modules`) e duas varreduras curinga: sinks de DOM no front e a definição final de cada uma das 562 funções SQL das migrations.

Não foram observados: as configurações do repositório no GitHub (secrets por environment, regras de branch dos environments, rulesets), as variáveis da Vercel e do Cloudflare Pages, e o histórico git (a cópia congelada não tem `.git`). Nada foi executado.

### Novo candidato (não verificado de forma independente)

| # | Título | Severidade | Pré-requisito |
|---|---|---|---|
| 14 | Os tokens que publicam produção e administram o Supabase ficam ao alcance de qualquer branch, sem revisão | média | permissão de push em qualquer branch do repositório |

**14 — Secrets de deploy no nível do repositório.**

- **Onde estão:** `servicos-externos.md:400` lista `CLOUDFLARE_PAGES_API_TOKEN` e `SUPABASE_ACCESS_TOKEN` como secrets de **Actions do repositório**. O environment `cloudflare-production` guarda só as 7 variáveis `VITE_*` (`servicos-externos.md:60`). Os workflows confirmam: o job `publish` da Preview (`cloudflare-pages-preview.yml`) e o de limpeza usam `secrets.CLOUDFLARE_PAGES_API_TOKEN` sem environment, e `provision-preview-admin.yml` usa `secrets.SUPABASE_ACCESS_TOKEN` também sem environment.
- **Por que importa:** um secret de repositório é entregue a qualquer workflow disparado por `push` em qualquer branch, e esse workflow é lido **da própria branch**. A proteção do `main` ("exige revisão") e o cuidado dos workflows de Preview (código da PR isolado do token, `workflow_run` a partir da branch padrão) não valem para quem simplesmente cria `.github/workflows/x.yml` numa branch nova e faz push.
- **O que cada token permite:**
  - `CLOUDFLARE_PAGES_API_TOKEN` (Pages: Edit) publica em `--branch main` dos projetos `vela-internal` e `vela-portal`, ou seja, troca o JavaScript servido em `vela.app.br` e `portalfwlog.com.br`. Com isso dá para ler a sessão de toda a equipe e de todos os Clientes.
  - `SUPABASE_ACCESS_TOKEN` é o token da Management API usado pelo CLI (`supabase branches get`). Um token desse tipo costuma ter o alcance da conta: lê as chaves `service_role` e altera o projeto de produção `fgmkhbzhaeebrsizwccx`.
- **Quem tem esse pré-requisito:** colaboradores com escrita e, neste repositório, os agentes que abrem branches `codex/*` e `claude/*` com credencial de push. Um agente conduzido por injeção de prompt é o caminho mais plausível.
- **Agravante:** em `provision-preview-admin.yml` o `SUPABASE_ACCESS_TOKEN` e o `PREVIEW_ADMIN_PASSWORD` estão no `env` do **job**, e não do step. Eles ficam visíveis para o `npm ci` (scripts de instalação de `core-js`, `esbuild`, `workerd`) e para a action de terceiros `supabase/setup-cli@v3`, fixada por tag móvel. Os demais workflows restringem o token ao step.
- **Não verificado:** as configurações reais do GitHub. Se o token já estiver também num environment com regra de branch, ou se um ruleset impedir push em `.github/workflows/**`, o risco cai.
- **Correção sugerida:**
  - mover os dois tokens para environments (por exemplo `cloudflare-pages` e `supabase-branches`) com deployment branch = `main`. Os jobs de Preview rodam por `workflow_run` e a limpeza por `pull_request_target`, ambos no contexto da branch padrão, então continuam funcionando;
  - no `provision-preview-admin.yml`, passar os secrets só aos steps que os usam;
  - trocar o `SUPABASE_ACCESS_TOKEN` pessoal por um token de escopo mínimo, se o Supabase oferecer, e rotacioná-lo depois da mudança.

### Pistas encerradas (o controle se manteve)

- **Workflows de Preview.**
  - O código da PR roda apenas no job `build`, com `persist-credentials: false` e só a URL e a chave pública da branch Supabase.
  - Os tokens ficam em jobs que fazem checkout da branch padrão.
  - O filtro `head.repo.id == repository.id` exclui forks.
  - O check "Supabase Preview" é exigido pelo `app.id` oficial (330661), não só pelo nome.
  - O nome da branch é validado por regex antes de ir ao CLI.
  - O SHA é revalidado antes de publicar.
- **Admin da Preview.** `assertPreviewTarget` recusa uma URL que cite o ref de produção, comparando com uma cópia de nome próprio que o `$GITHUB_ENV` não sobrescreve. `load-branch-env.mjs` usa delimitador heredoc e recusa colisão.
- **Workflow de produção.** Exige `event == push` em `main` e environment `cloudflare-production`. Tokens por step, `persist-credentials: false`. A limpeza por `pull_request_target` só faz checkout da branch padrão.
- **Dependências npm.**
  - Todos os pacotes do lockfile vêm de `registry.npmjs.org`.
  - Versões resolvidas: `pdfjs-dist` 4.10.38, posterior à correção da CVE-2024-4367 (4.2.67), `@e965/xlsx` 0.20.3, `supabase-js` 2.103.3, `react-router` 7.18.2.
  - Só quatro pacotes têm script de instalação: `core-js`, `esbuild`, `fsevents` e `workerd`.
  - O Dependabot cobre npm, actions e Deno.
- **Segredos no repositório.**
  - A varredura por JWT, `sb_secret_`, `sk_`, `re_`, `AKIA`, `ghp_`, chave privada e URL Postgres com senha não achou nada. Só a senha fictícia de `backup-r2.test.mjs` apareceu.
  - `.env*` está no `.gitignore`, exceto o exemplo.
  - O ref do projeto aparece na documentação, mas já é público no bundle.
- **Cabeçalhos.**
  - `vercel.json` e `cloudflare-pages-stage.mjs` emitem a mesma CSP.
  - A CSP tem `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'` e scripts só de `self`, Turnstile e PostHog, com HSTS e `nosniff`.
  - O stage grava `_headers` e `_redirects` **depois** de copiar os arquivos e descarta `.map`.
- **CORS.** Uma origem fora da allowlist fica sem o header, e não recebe `null`. Há `Vary: Origin`. Os padrões de Preview estão presos ao time Vercel e aos dois projetos Pages.
- **Scripts operacionais.**
  - `backup-r2.mjs` usa `spawn` sem shell, senha via `PGPASSWORD`, cifra antes do envio e cria arquivos com `wx`.
  - `qa-display-production` entra com login de usuário (RLS), não com chave de serviço.
  - O instalador `no-mistakes` é fixado por versão e conferido por SHA-256 commitado.
- **Varredura curinga do banco.**
  - As 562 definições finais de função `SECURITY DEFINER` fixam `search_path`.
  - O único SQL dinâmico com `%s` (`rls_auto_enable`, 006:330) usa `object_identity` do event trigger, que já vem citado.
  - `anon` executa apenas `portal_ship_schedule`, como já registrado.
- **Varredura curinga do front.**
  - O único `dangerouslySetInnerHTML` é a prévia de comunicados, encerrada no bloco 2.
  - `postMessage` só aparece no worker interno de BAPLIE.
  - `window.open` só aparece em `printDocument`, encerrado no bloco 5.

### Reforços sugeridos do bloco 7 (não são vulnerabilidades)

- **Imports Deno sem versão fixa.** Há 21 imports de `https://esm.sh/@supabase/supabase-js@2` nas Edge Functions, e o webhook importa `https://esm.sh/svix@1`. Cada deploy resolve a versão mais recente da major num CDN de terceiros, sem `deno.lock`, dentro de funções que têm a `service_role`. Vale fixar a versão exata (ou `npm:` pelo `deno.json`, como já se faz com `@sentry/deno`) e commitar o lock.
- **Actions por tag.** `actions/*@v7` e `supabase/setup-cli@v3` são tags móveis. Nos jobs com token, fixar por SHA.
- **Preview pode publicar um Worker.** O job `publish` envia o diretório construído pela PR com `wrangler pages deploy`. Um `_worker.js` ou `_routes.json` ali vira código de servidor em `pr-<n>.*.pages.dev`, atrás do Access. Vale o job confiável recusar esses arquivos antes do deploy.
- **Credenciais da branch sem máscara.** `load-branch-env.mjs` põe `SUPABASE_SERVICE_ROLE_KEY` e o segredo JWT da branch em `$GITHUB_ENV` sem `::add-mask::`. Hoje nada as imprime.
- **Origens legadas no CORS.** `transhippingdesk.web.app`, `transhippingdesk.firebaseapp.com`, `transhippingdesk.com.br` e os aliases `*.vercel.app` continuam liberados. Se algum domínio ou site Firebase for liberado e registrado por terceiros, passa a ser origem aceita. O impacto é baixo porque as funções usam `Authorization` e não cookie. Remover ao fim da transição (a Vercel sai em 2026-10-01).
- **CSP ampla.** `connect-src https://*.supabase.co` aceita qualquer projeto Supabase, o que dá um canal de saída se houver XSS. Dá para restringir ao host do projeto no build.
- **Ferramentas de agente sem versão.** `.mcp.json` roda `npx -y` de três pacotes (um com `@latest`), e `opencode.json` carrega o plugin `github:cesumilo/opencode-skills-as-commands` sem commit fixo. Eles rodam com as credenciais de quem abre o repositório e reforçam o caminho do candidato 14.
- **Backup.** `SUPABASE_DB_URL` com a senha do banco fica como variável do usuário Windows, visível a todo processo dessa conta, incluindo `npm install` e agentes rodados ali. A tarefa também roda o `backup-r2.mjs` da cópia de trabalho, que muda a cada `git pull`. Vale uma conta ou pasta dedicada ao backup, fixada numa versão revisada.
- **Secret legado.** `FIREBASE_SERVICE_ACCOUNT_TRANSHIPPING_DESK` continua no repositório sem uso (`servicos-externos.md:402`). Remover.

### Atualização de "Não revisado"

Todas as 21 unidades do plano de cobertura foram revisadas nos blocos 1 a 7. Continuam fora da inspeção estática:

- configurações do GitHub (environments, rulesets, alcance real dos tokens), variáveis da Vercel e do Cloudflare Pages;
- histórico git (segredos removidos em commits antigos);
- qualquer comportamento em execução.

O candidato 14 precisa de verificação independente: conferir em **Settings → Secrets and variables → Actions** e em **Environments** onde os dois tokens estão e quais regras de branch se aplicam, e ver o alcance do `SUPABASE_ACCESS_TOKEN` no painel do Supabase. Os candidatos 1 a 13 continuam com as verificações descritas nos blocos anteriores.

---

## Validação dos candidatos 1 a 14 (2026-09-28)

**Como foi feita.** A pedido do usuário, a validação foi feita na mesma sessão, sem agentes. Portanto **não é a verificação independente** que a skill exige na fase 3: quem validou é o mesmo que revisou os blocos 1 a 7. O relatório registra isso.

**Ambiente e evidência.**

- **Banco:** Postgres 16 descartável do harness (`harness/pgbox.sh`, cópia de `harness/template`), sem rede, só em socket unix, dentro do sandbox do `supervise.py` (scratch `agents/v01`).
- **Schema:** as migrations 001–096 do template foram comparadas byte a byte com `target-src/supabase/migrations`, e todas são idênticas. O template é, portanto, o schema do commit 17da824a.
- **Dados:** fixtures fictícias. Três usuários: Administrativo, Financeiro e um usuário técnico do Portal. Clientes com CNPJ de teste.
- **Sessão simulada:** `SET ROLE authenticated` com `request.jwt.claims`. Cada teste roda numa transação encerrada com `ROLLBACK`. A única exceção é o #3, que precisa de transações separadas; a tabela `portal_rate_limits` foi limpa no fim.
- **O que não roda localmente:** GoTrue, PostgREST, Deno e navegador. Os candidatos que dependem deles foram conferidos lendo o código da Edge Function e da biblioteca instalada (`@supabase/auth-js` 2.103.3), sem executar.
- **Nenhum contato** com produção, Supabase, GitHub, Cloudflare ou Vercel.

### Resultado

| # | Resultado | Evidência | Severidade proposta |
|---|---|---|---|
| 1 | **confirmado** | executado | baixa (impacto médio) |
| 2 | **confirmado** | executado | baixa |
| 3 | **confirmado** | executado | baixa |
| 4 | **confirmado, rebaixado** | executado | informativa |
| 5 | **confirmado** | executado | baixa |
| 6 | **confirmado** | executado | baixa |
| 7 | **precisa de validação** | leitura | — |
| 8 | **confirmado na leitura** | Edge Function lida, não executada | baixa (impacto médio) |
| 9 | **parcial** | leitura da biblioteca | baixa (parte confirmada) |
| 10 | **confirmado na leitura** | Edge Function lida, não executada | baixa |
| 11 | **confirmado** | executado | baixa |
| 12 | **confirmado na leitura** | código da biblioteca, sem navegador | baixa |
| 13 | **rejeitado como descrito; substituído pelo 13b** | executado | — |
| 13b | **confirmado (defeito com efeito de disponibilidade)** | executado | média (disponibilidade da importação) |
| 14 | **precisa de validação** | leitura | — |

### Detalhe por candidato

- **#1 — confirmado.** Usuário Financeiro, fatura com Dispute aberta:
  - `UPDATE demurrage_invoices SET dispute_status='resolvido', dispute_open=false` passou. O gatilho levou a Dispute a `resolvida`, `next_responder = ninguem`, com `resolved_at` preenchido.
  - `UPDATE … SET dispute_status='aberto', dispute_open=true` a reabriu, com `aberta` e `equipamentos`.
  - Para o mesmo usuário, a RPC oficial `reopen_demurrage_dispute` recusou com "Apenas Equipamentos ou Administrativo pode reabrir a Dispute". A diferença entre os dois caminhos é o achado.
- **#2 — confirmado.** Usuário Financeiro, Dispute **resolvida**:
  - o INSERT em `storage.objects` (bucket `demurrage-disputes`) passou pela política `demurrage_dispute_objects_insert`, que só exige `is_active_user()`;
  - `add_demurrage_dispute_attachment` gravou o anexo (`uploaded_by` = Financeiro).
  - O ramo interno da função não confere nem o papel nem o estado da Dispute. As duas checagens só existem no ramo do Portal.
- **#3 — confirmado.** Usuário do Portal, ação real `create_consolidation` (usada por `portal_create_consolidation` com 3 tentativas a cada 10 minutos; também valem `open_dispute` e `obsolete_consolidation`):
  - três chamadas passaram e a quarta recusou com P0429;
  - uma chamada com `p_window_minutes = 0` apagou o histórico;
  - a chamada seguinte com os parâmetros normais passou.
  - O efeito fica no próprio Cliente: mais consolidações e mais Disputes por minuto, que caem na fila da equipe.
- **#4 — confirmado, rebaixado para informativo.** O Financeiro chamou `reject_customer_reconciliation(…, p_actor = <id do Administrativo>)`. `customer_reconciliation_queue.rejected_by` e a linha `customer_reconciliation_status` que a função grava ficaram com o Administrativo.
  - O que rebaixa: o gatilho de auditoria gravou em paralelo as mudanças em `bls` com o usuário real, e a própria linha forjada saiu com `actor_role = financeiro`. A trilha completa ainda mostra quem agiu; só o campo "rejeitado por" da fila mente.
  - `add_manual_bl_charge` tem o mesmo padrão (`COALESCE(p_actor, auth.uid())`), mas não foi executado.
- **#5 — confirmado.** O Financeiro inseriu direto em `audit_logs` uma linha com `changed_at = 2020-01-01`, `actor_role = administrativo` e `actor_department = Administrativo`, e os três valores foram gravados como enviados. `changed_by` fica preso ao próprio usuário.
- **#6 — confirmado.** Usuário do Portal chamando `save_bl_review`:
  - para um B/L de outro Cliente, invisível pela RLS (o `SELECT` devolve 0 linhas), recebeu "foi alterado por outro usuario";
  - para um B/L inexistente, recebeu "nao encontrado".
- **#7 — precisa de validação.** Continua dependendo da configuração de Auth de produção: limite de tentativas do endpoint `/token` e captcha no GoTrue. O `config.toml` local tem `sign_in_sign_ups = 30` a cada 5 minutos por IP e captcha comentado, mas isso não prova o que está em produção.
  - Fato que falta: se o projeto de produção tem captcha no Auth e qual limite de login por IP aplica.
  - Checagem segura, feita pelo dono: ler **Authentication → Rate Limits / Attack Protection** no painel.
- **#8 — confirmado na leitura.** `admin-users` `update_credentials` (`:96-124`) só exige `user_id`, e nenhum ramo confere se o id pertence a `user_profiles`. A política `cpa_admin_all` (`is_admin()`, todas as operações) entrega `customer_portal_accounts.auth_user_id` ao Administrativo, conferido no banco local. Não houve GoTrue para executar a troca.
- **#9 — parcial.**
  - **Confirmado na leitura:** no `auth-js` instalado, `admin.signOut(jwt, scope)` envia o argumento como `Authorization: Bearer <jwt>` para `/logout` (`GoTrueAdminApi.js:51-60`, `lib/fetch.js:76-77`). Com o UUID do usuário no lugar do JWT, a chamada não pode encerrar as sessões dele, e a função só registra o erro (`admin-users:141-144`). Desativar, portanto, não revoga refresh tokens.
  - **Precisa de validação:** se a troca de senha feita pelo admin (`updateUserById`) revoga ou não as sessões existentes no GoTrue desta versão.
- **#10 — confirmado na leitura.** Só `ce_mercante_taxas` (`:400`) e os avisos operacionais (`:489`) preenchem `canonicalPayload`. Para `livre` e `institucional` valem o `subject`, o `html` e o `text` recebidos (`:493-495`).
- **#11 — confirmado.** Administrativo, Cliente com CNPJ e um contato:
  1. Antes da retenção, o DELETE direto falhou no gatilho somente-inclusão de `portal_provisioning_events`, como previsto.
  2. `delete_records(…, dry_run)` respondeu `blocked: "cliente com CNPJ: desative em vez de excluir"`.
  3. Na preparação da fixture, a data do evento de Portal foi recuada 400 dias para simular o tempo. Depois `run_retention()` rodou como o cron roda e apagou o evento.
  4. `delete_records` continuou recusando, mas `DELETE FROM customer_contacts …` seguido de `DELETE FROM customers …` apagou o Cliente.
- **#12 — confirmado na leitura da biblioteca.**
  - O cliente interno usa `detectSessionInUrl: true` e não define `flowType`, e o padrão do `auth-js` 2.103.3 é `implicit`.
  - Em `_initialize`, a URL com `access_token` é tratada como retorno *implicit*. `_getSessionFromURL` só valida o token em `/user` (sessão emitida há mais de 120 s gera apenas um aviso), e `_saveSession` grava a sessão por cima da atual.
  - Não houve teste em navegador.
- **#13 — rejeitado como descrito.** Neste schema, o contato vindo do B/L **nunca chega a ser criado**:
  - O gatilho `trg_seed_customer_contact_box_links` (008) já vincula o contato novo às caixas no `AFTER INSERT`.
  - Em seguida, `ensure_customer_contact_email` (043) insere de novo os mesmos vínculos sem `ON CONFLICT`, e a transação falha com `customer_contact_box_links_pkey`.
  - Por isso não existe o cenário "terceiro passa a receber comunicados". O defeito que aparece no lugar é o 13b.
- **#13b — confirmado (novo).** A importação é recusada por inteiro quando o B/L traz um e-mail de consignatário novo.
  - **Reprodução:** `import_breakbulk_manifest_transactional`, chamada pelo Financeiro com um B/L vinculado por CNPJ (`customer_id` preenchido), falhou inteira com `duplicate key … customer_contact_box_links_pkey`. A mesma chamada, sem `manifest_customer_email`, passou.
  - **Caminho:** `import_breakbulk_manifest_transactional:178` → `apply_bl_review_gate_after_import` → `capture_manifest_financial_contact` → `ensure_customer_contact_email`, sem tratamento de exceção em nenhum nível.
  - **Outros caminhos, pelo mesmo motivo (não executados):**
    - `import_bl_freight_transactional_legacy_357:91` chama o mesmo gate;
    - a chamada direta `ensure_customer_contact_email` também falha, testada isoladamente. Ela vem de `src/services/customers.ts:123` (Revisão), `approve_customer_reconciliation`, `complete_review_customer_group` e `save_bl_review_legacy_070`.
  - **Quem provoca:** quem preenche o e-mail do consignatário no documento de origem. Basta um endereço ainda não cadastrado num B/L de Cliente já identificado.
  - **Efeito:** o manifesto inteiro deixa de entrar, e a Revisão ou a Aprovação daquele B/L também falha até alguém cadastrar o e-mail à mão.
  - **Por que ninguém viu:** os testes existentes do caminho (`importacaoCapturaContatoMigration.test.ts`, `issue609ContactBoxesMigration.test.ts`) só conferem o texto do SQL, e nenhuma suíte `local-pg` do CI importa um B/L com e-mail de consignatário.
  - **Ressalva:** o banco de produção foi montado pelas migrations originais, não pelo squash. Vale o dono conferir, só por leitura, se `trg_seed_customer_contact_box_links` existe lá. Se existir, o comportamento é o mesmo.
  - **Correção:** remover de `ensure_customer_contact_email` o INSERT próprio em `customer_contact_box_links`, ou pôr `ON CONFLICT DO NOTHING`, e cobrir com um teste `local-pg` que importe um B/L com e-mail novo. **Atenção:** consertar só isso faz nascer o cenário original do #13, porque o contato passaria a entrar ativo e, sem principal, em todas as caixas. A correção precisa vir junto com a do #13: contato inativo até revisão, sem promoção automática a principal e origem real no console.
- **#14 — precisa de validação.** O fato que falta são as configurações do GitHub: se `CLOUDFLARE_PAGES_API_TOKEN` e `SUPABASE_ACCESS_TOKEN` estão só em **Secrets → Actions** do repositório ou também em environments com regra de branch, se há ruleset em `.github/workflows/**`, e qual o alcance real do token do Supabase.

### Situação da execução

- **Fase 3 (validação):** feita sem agentes. Registrado que **não é independente**.
- **Fases 4 a 6 (`findings.json` com validadores, verificação final e relatórios derivados):** não feitas. Pela regra da skill, a execução continua `incomplete`, e o motivo é a ausência de verificação independente e dos artefatos estruturados.

**Observação lateral (não é candidato; não investigada).** Um `SELECT` direto em `demurrage_disputes` feito pelo Financeiro falhou com "Sessao do portal invalida ou expirada". Uma política da tabela chama `current_portal_customer_id()`, que lança exceção para quem não é do Portal, em vez de devolver nulo. Se alguma tela interna lê a tabela direto, e não por RPC, ela quebra para a equipe. Vale conferir.

### Atualização com o que o dono observou (2026-09-28)

O dono mandou duas capturas de tela: **GitHub → Settings → Secrets and variables → Actions** (Repository secrets) e **Supabase → Authentication → Rate Limits** do projeto. É uma observação do dono sobre a configuração em uso; nada foi executado contra esses serviços.

- **#14 — confirmado pela observação do dono.** Severidade proposta: **média**.
  - `CLOUDFLARE_PAGES_API_TOKEN` (atualizado há 5 dias) e `SUPABASE_ACCESS_TOKEN` (há um mês) estão em **Repository secrets**. `PREVIEW_ADMIN_PASSWORD` também.
  - Por serem secrets de repositório, qualquer workflow disparado por push em qualquer branch os recebe, mesmo que exista uma cópia em environment. A captura não mostra os environments, mas isso não muda a conclusão.
  - Continuam sem observação: se há ruleset limitando quem altera `.github/workflows/**`, quem tem permissão de push (inclusive as credenciais usadas pelos agentes) e o alcance do `SUPABASE_ACCESS_TOKEN`.
  - A captura também mostra que o legado `FIREBASE_SERVICE_ACCOUNT_TRANSHIPPING_DESK` continua lá (reforço do bloco 7).
- **#7 — confirmado pela observação do dono e pela leitura.** Severidade proposta: **baixa**.
  - O limite de login do Auth em produção é **30 tentativas a cada 5 minutos por IP** (360 por hora por IP). O `portal-login` permite 5 falhas a cada 15 minutos por CNPJ (20 por hora).
  - **Captcha:** não está ligado no GoTrue, por dedução do código. `portal-login/index.ts:77` chama `signInWithPassword({ email, password })` sem `captchaToken`; se o captcha estivesse ligado, o login do Portal falharia para todos.
  - **Resultado:** quem conhece o e-mail técnico de um Cliente testa senhas direto em `/auth/v1/token` cerca de 18 vezes mais rápido por IP do que o Portal permite, sem Turnstile, sem o alerta `portal_abuso_login` e sem a checagem de `account_situation`. O limite por IP se contorna distribuindo as tentativas entre vários IPs.
  - **O que não foi executado:** nenhuma tentativa real contra o GoTrue.
- **Efeito colateral do mesmo limite (observação, não é candidato).** Os logins do Portal passam pelo `signInWithPassword` da Edge Function, então o GoTrue talvez conte todos pelo mesmo IP de saída. Nesse caso, o limite de 30 a cada 5 minutos valeria para todos os Clientes somados. Não verificado: depende de o GoTrue usar o IP da função ou o `X-Forwarded-For`.
- **13b — ainda depende do dono.** Falta conferir no banco de produção, por leitura, se o gatilho `trg_seed_customer_contact_box_links` existe.

---

**Este arquivo é o relatório de trabalho da execução (notas cronológicas dos blocos 1 a 7 e da validação).** O relatório final, derivado do `findings.json` e do `coverage-ledger.json`, está em `REPORT.md`.
