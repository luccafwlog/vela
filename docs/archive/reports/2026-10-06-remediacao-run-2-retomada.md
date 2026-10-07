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
