# Retomada da remediação run-2 — 2026-10-06

O Comunicado institucional teve simulação validada em produção após a
publicação autorizada da correção. O plano
[run-2](../../plans/2026-09-28-remediacao-auditoria-seguranca-run-2.md) permanece
vivo. Nenhum envio real foi autorizado ou habilitado nesta retomada.

## Evidência de produção

- Frontend observado: `085520e7eb16`, Vela/Portal em produção.
- Supabase: `106`, `108`, `109`, `110` em `schema_migrations`.
- Headers HTTP dos dois domínios: `connect-src` com HTTPS/WSS de
  `fgmkhbzhaeebrsizwccx.supabase.co`; nenhum `*.supabase.co`.
- Primeiro Comunicado: erro SQL `22023`, "Natureza invalida para o tipo de
  comunicado", nos logs às 22:04 de Brasília. Consulta confirmou catálogo
  vazio. Reposição das dez combinações autorizada pelo dono e realizada por
  INSERT idempotente. Contagem posterior = 10; `communications_enabled=false`.
- Segundo Comunicado: registro `customer_communications.id=1`, institucional;
  `rendered_subject`, `rendered_text` e SHA-256 de 64 caracteres persistidos.
  Navio/viagem nulos, esperados no institucional sem vínculo de B/L.
  Tentativa com `dispatch_mode=simulado`, sem ID do provedor, mas
  `status=falha_permanente` por ausência de `RESEND_API_KEY`. Cabeçalho `falha`.
  Tela mostrou "Comunicado registrado em simulação; nenhum e-mail foi enviado";
  essa mensagem não prova simulação concluída.

## Correções e validação local

Migration `157` repõe o catálogo para replay. A limpeza operacional preserva
tipos, caixas e modelos de Comunicado, impedindo repetir a perda estrutural.
Helper de e-mail aceita simulação explícita; produtores manual e Demurrage
derivam a opção da chave global, nunca de campo enviado pelo navegador.
Convite/recuperação sem credencial continuam falhando.

Auxiliares dos agentes fixados por versão npm/commit GitHub. A configuração
anterior `@shadcn/mcp` devolveu 404 no registry; substituída pelo servidor
oficial `shadcn mcp`. Os três comandos MCP respondem a `--help`; isso não
comprova conexão aos clientes de agentes. Fontes:
[shadcn](https://ui.shadcn.com/docs/mcp) e
[OpenCode](https://opencode.ai/v2/docs/plugins).

O checkout original sofreu mudança de branch e commit durante a execução.
As alterações de catálogo/configuração foram incorporadas ao commit externo
`ea17d773`. A continuação usa worktree próprio a partir desse commit; não
reescreve seu histórico. Um Postgres separado na porta local `55432` isola
os testes de outras tarefas que também modificavam `vela_test`.

**Teste executado:** `docs:check`, `typecheck`, `lint`, `npm test` (3.973
passaram; 400 pulados), `build`, `migrations:check`, `rpc:check` (228 nomes) e
`git diff --check`. Suítes focadas de e-mail: 23 casos passaram. Postgres 16
isolado, replay completo de 155 migrations: suítes run-2, reforços, catálogo e
status parcial passaram em série (23 casos). Os shims locais não comprovam
Storage/Auth reais. Primeira execução no banco local compartilhado falhou
por catálogos ausentes; resultados substituídos pelo replay isolado.

`deno check` (Deno 2.9.6) retorna 26 erros de tipos nas duas Functions; a
mesma checagem na base `ea17d773`, sem a correção, retorna os mesmos 26 códigos
e mensagens. Portanto não está verde e não comprova integridade completa das
Functions; a alteração não acrescentou erro nessa comparação.

## Pendências de operação

GitHub: environments sem secrets/restrição de branch; credenciais ainda no
repositório, incluindo Firebase legado. Rulesets retornam 403 com exigência
de GitHub Pro para o repositório privado. Não foram removidos tokens antes de
validar credenciais substitutas e deploy. Produção Pages recente passou;
Preview `37555176797` parou porque a PR já estava fechada; limpeza
`37555200319` falhou em GET Cloudflare HTTP 400, diagnóstico ainda pendente.
Uma deploy key com escrita foi encontrada: `Codex workspace - Transhipping
Desk`. Permissão padrão do workflow é leitura; aprovação de PR pelo token
Actions está desabilitada. A existência da chave de escrita exige revisão do
dispositivo/dono; não prova acesso indevido. Só há um colaborador, então a
exigência de revisão também precisa de um revisor elegível.
Consulta da branch `main` retornou `protected=false`; o manual vivo foi
corrigido para não afirmar revisão obrigatória que não está aplicada.

Vault: consultas só de nomes/datas, sem valores; segredos existentes ainda
sem evidência de rotação. `IMPORT_EFFECTS_CRON_SECRET` e `RECALC_CRON_SECRET`
ausentes. Backup dedicado já documentado em
[backup R2](../../operations/backup-r2.md); execução agendada seguinte não foi
observada nesta máquina macOS.

Falta envio real controlado,
PKCE, Dispute com as duas identidades internas, importação e configuração dos
painéis. Não há evidência para encerrar ou arquivar o plano.

## Publicação autorizada e repetição

Em 2026-10-06, às 22:19 de Brasília (2026-10-07 UTC), publicação pelo CLI
Supabase com `--use-api`, a partir de `0889e478`, no projeto
`fgmkhbzhaeebrsizwccx`: `send-customer-communication` v169 e
`demurrage-dunning` v166, ambas ACTIVE e `verify_jwt=false` preservado.
Fonte remota confirmou `simulate: !enabled` no manual e as duas chamadas
`simulate: !communicationsEnabled` no runner.

**Runtime observado:** nova composição institucional pelo Vela, recorte do
Cliente de teste. A tela informou duas tentativas em simulação. Consulta
posterior confirmou `customer_communications.id=2`, `status=simulado`, assunto,
texto e SHA-256 persistidos; navio/viagem nulos. Tentativas `id=2` e `id=3`
com `status=aceito`, `dispatch_mode=simulado`, `last_error=null`,
`provider_message_id=null`; `communications_enabled=false`. Nenhum e-mail
real foi enviado. O runner Demurrage não foi executado: sua publicação e
contrato foram conferidos, sem evidência runtime de cobrança nesta etapa.

## Livre e anexo inválido — continuação em 2026-10-06

**Runtime observado em produção:** Comunicado livre `id=3`, recorte GREEN
TAICANG e Cliente de teste, vinculado ao B/L `CSC45370901400`. Banco confirmou
`vessel_name=GREEN TAICANG`, `voyage_number=4`, correspondentes ao B/L,
assunto/texto/hash persistidos e status `simulado`. Duas tentativas aceitas,
sem erro nem ID do provedor; chave global desligada.

Arquivo de texto simples de 65 bytes, nome `vela-run2-falso.pdf`, selecionado
pelo navegador e submetido no teste em simulação. A Function recusou com
"O conteúdo do anexo 1 não corresponde ao tipo informado." Consulta posterior
confirmou zero comunicados com o assunto do teste negativo e zero anexos com
esse nome. Isso comprova rejeição pela assinatura do conteúdo no fluxo real,
sem envio de e-mail. Evidência visual local: `/tmp/vela-run2-pdf-recusado.jpg`.

## Dispute e Storage — sessão real de Equipamentos

Com autorização específica do dono, criados Invoice e Dispute `id=1` para ABF,
documento `TEST-RUN2-DISPUTE-20261007`, B/L `CSC45370901400`. Invoice permanece
`draft`, USD 0, sem TXID. Sem emissão de cobrança, geração de pagamento ou
envio de e-mail. A resposta cria notificação dentro do Portal; conferidos
triggers e fonte publicada do digest, que não consome `portal_notifications`.

**Runtime observado:** Vela `2159842`, André Peres, Equipamentos. Mensagem
`id=1` persistida com autoria da sessão (`d33d3287-f5d3-4d98-b2a9-a00f157fcf2d`).
Upload de `vela-run2-dispute.txt` falhou: Storage HTTP 500 em
2026-10-07 01:39:50 UTC; log PostgreSQL simultâneo informa sessão Portal
inválida. Nenhum objeto nem metadado de anexo gravado. Captura local:
`/tmp/vela-run2-dispute-falha.jpg`.

**Teste automatizado:** leitura direta de Disputes como Equipamentos falhou
com `28000` antes da correção. Migration `158` usa `CASE` nas políticas de
leitura de Disputes e objetos: identidade interna não chama o contrato estrito
de sessão Portal. A política INSERT permanece intacta. Após aplicar localmente,
13 testes da suíte run-2 passam; com os reforços, 22 casos SQL passam. Tabela Storage descartável sob RLS confirma
INSERT RETURNING próprio permitido e Financeiro, outra autoria, caminho de
outro cliente e Dispute resolvida recusados (`42501`). O shim não comprova
upload físico; reteste real depende de aplicação autorizada em produção.

**Achado adicional:** a RPC grava `next_responder=cliente` na mensagem, mas o
trigger `sync_demurrage_dispute_lifecycle_from_invoice` sobrescreve o próximo
responsável da Dispute com `equipamentos`. Não corrigido nesta migration;
permanece pendente de reprodução/correção separada.

Checks desta correção: migrations:check, rpc:check, docs:check, typecheck,
lint, build e diff --check aprovados. Suíte geral: 3973 testes aprovados,
402 ignorados; caso adicional de escopo/revogação do Portal executado e
aprovado no PostgreSQL local depois dessa suíte geral.

## Publicação da correção de Storage e reteste

Dono autorizou a aplicação da migration `158` e repetição do upload.
Supabase `apply_migration` retornou sucesso no projeto `fgmkhbzhaeebrsizwccx`
(nome remoto `dispute_storage_internal_session`). Reteste real pela sessão
do André, frontend `2159842`, concluiu sem erro na tela em 2026-10-07
01:46 UTC. Mensagem `id=2`; anexo `id=1`, `vela-run2-dispute.txt`,
`text/plain`, 94 bytes. Objeto físico registrado no Storage com tamanho/MIME
corretos, proprietário e `uploaded_by` correspondentes à sessão Equipamentos.
Invoice permanece `draft`, USD 0, `pix_txid=null`. Nenhum envio de e-mail,
cobrança emitida ou pagamento gerado. Captura: `/tmp/vela-run2-dispute-sucesso.jpg`.

Isso encerra a falha de upload interno observada; recusa em sessão real de
Financeiro ainda depende da troca de login pelo dono. O achado do próximo
responsável continua separado e pendente.

## Financeiro e próxima ação da Dispute

**Runtime observado:** sessão de Thuani Petri, conta Financeiro fornecida pelo
dono, frontend `2159842`, `/demurrage`: fila de Disputes, resposta e upload
ausentes. Captura `/tmp/vela-run2-financeiro-dispute.jpg`. Não houve tentativa
direta de INSERT no Storage sob essa sessão; a recusa de banco é evidência
automatizada local, não runtime de produção.

**Teste automatizado:** resposta Equipamentos com próxima ação Cliente retornou
`aberta`, mas persistiu `equipamentos` antes da correção. Migration `159`
adiciona retorno antecipado ao trigger quando os dois campos de lifecycle da
Invoice são iguais aos anteriores. Não altera dados existentes nem permissões.
Correção local; aplicação em produção depende de autorização específica.

Validação da migration `159`: 23 testes SQL locais aprovados nas suítes run-2
e reforços; migrations:check, rpc:check, docs:check, typecheck, lint do teste
alterado e diff --check aprovados. Gates gerais de aplicação já aprovados na
mesma base da `158`; nenhuma alteração no código de aplicação nesta etapa.

## Publicação da próxima ação

Com autorização específica do dono, migration `159` aplicada via
`apply_migration` no projeto `fgmkhbzhaeebrsizwccx`, nome remoto
`dispute_preserve_next_responder`, com retorno de sucesso. Conferência da
definição publicada confirma o guard de mudança real dos campos. Nenhum
registro histórico reescrito; a Dispute de teste ainda precisa de nova
resposta pela sessão real de Equipamentos para comprovar a próxima ação.

## Reteste runtime da próxima ação

Sessão real do André, frontend `2159842`: nova resposta na mesma Dispute de
teste (mensagem `id=3`) com próxima ação Cliente. A tela mostrou
`próximo: cliente`; consulta ao banco confirmou Dispute `aberta`,
`next_responder=cliente`, coerente com a mensagem. Invoice continua `draft`,
USD 0, sem TXID. Nenhum e-mail, cobrança emitida ou pagamento gerado.
Captura `/tmp/vela-run2-proxima-acao-cliente.jpg`. Falha do trigger corrigida
e verificada em produção.

**Runtime no Portal:** após atualização de `/portal/billing`, aba Demurrage,
a sessão ABF exibiu as três mensagens da Dispute de teste, incluindo a resposta
da migration `159`. Confirma leitura da conversa pelo cliente destinatário;
não comprova download do anexo nem isolamento entre duas sessões de clientes.

## Conferência do painel Supabase Auth

**Runtime observado:** painel autenticado do projeto `fgmkhbzhaeebrsizwccx`,
Authentication → Attack Protection: captcha switch desligado, Save changes
desabilitado. Item de conferência #7 quitado; nenhuma configuração alterada.
Captura `/tmp/vela-run2-supabase-captcha.jpg`.

Auth Hooks: nenhum hook configurado; organização Fwlog Pro. Menu mostra
Password Verification Attempt e MFA Verification Attempt indisponíveis,
exigindo Team/Enterprise. Confirma fallback D1(a) aprovado; código do
`portal-login` usa `derivePortalAuthPassword` com `PORTAL_PASSWORD_PEPPER`.
Essa inspeção não é teste de senha direta no GoTrue. Captura
`/tmp/vela-run2-supabase-hook-plano.jpg`.

URL Configuration: Site URL `https://transhippingdesk.com.br`; oito redirects
dos projetos legados `transhippingdesk`/`vela` na Vercel, nenhum domínio atual
visível nessa lista. Drift operacional registrado para diagnóstico dos fluxos
Auth/PKCE antes de alteração; nenhum redirect adicionado/removido.

## Conferência GitHub Environments no painel autenticado

Environment `cloudflare-pages`: No restriction, zero secrets/variables. API
confirma `supabase-branches` sem deployment branch policy e sem proteção;
`cloudflare-production` tem zero secrets. Repository secrets continuam com
`CLOUDFLARE_PAGES_API_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `PREVIEW_ADMIN_PASSWORD`
e o legado Firebase. Nenhum valor acessado e nenhum secret alterado/removido.
Captura `/tmp/vela-run2-github-environment.jpg`.

Workflows da base atual usam environments a partir da branch confiável:
preview via `workflow_run`, cleanup via `pull_request_target`, provisionamento
via dispatch. Restrição a `main` preparada, aguardando autorização específica.
Credenciais novas precisam ser cadastradas pelo dono (handoff); só remover
as cópias do repositório após deploys dos substitutos aprovados.

## Decisão do dono sobre environments

Dono recusou a restrição de deployment branch a `main` após explicação do
fluxo de Preview. Nenhuma restrição aplicada. Item retirado da execução por
decisão explícita, com risco aceito, sem comprovação de remediação. Demais
pendências permanecem no escopo.

## Acessos GitHub e limpeza de Preview

O repositório tem doze GitHub Apps instalados (Codex Connector, Claude, Claude
Design Import, Cloudflare Workers and Pages, Cursor, Devin.ai, genspark,
lovable.dev, Meta Muse, Sentry, Supabase e Vercel); a revisão foi somente
leitura. Há uma única deploy key, `Codex workspace - Transhipping Desk`,
`read/write`, usada há menos de três meses. Ela precisa de revisão do dono;
não foi removida.

O workflow de limpeza da PR #872 falhou em 2026-10-07 com HTTP 400 no primeiro
GET de deployments. Ajustei o script para `per_page=25`, mantendo paginação e
o comportamento de preservar o deployment mais recente. Os quatro testes
existentes passam; uma execução futura do workflow é necessária para comprovar
a chamada real. Nenhuma exclusão ocorreu na execução que falhou.
