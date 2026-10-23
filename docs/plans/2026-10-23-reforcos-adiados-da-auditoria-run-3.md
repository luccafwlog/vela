# Reforços adiados da auditoria de segurança run-3

Data: 2026-10-23. Origem: notas de endurecimento da auditoria de segurança
run-3 (2026-10-22). Decisão do dono de 2026-10-22: tratar estes dois pontos
numa rodada própria, depois da PR luccafwlog/vela#1038, que trouxe as correções
e as demais decisões da auditoria (migrations `419` a `439`).

## Estado

Nada executado. Nenhum dos dois pontos tem caminho de exploração demonstrado;
são defesa em profundidade.

## 1. Dependências das Edge Functions fixadas por lock

**Hoje.** Parte das Edge Functions importa o `supabase-js` e outras
dependências por URL do `esm.sh` (`https://esm.sh/@supabase/supabase-js@2.117.2`)
sem passar por `supabase/functions/deno.json` e `deno.lock`. O CI confere com
lock só as funções que ele checa (`ci.yml`, passos "Email Edge Functions type
check", "Itaú Pix Edge Function type check and routine status" e o teste de
`portal-ce-unlock-document`/`ce-unlock-cleanup`). Não se
sabe se a publicação usa o `deno.lock`: o `supabase functions deploy` resolve
os imports de novo.

**Conferido em 2026-10-22.** As 20 dependências do `deno.lock` e dos imports
por `esm.sh`/`npm:` não tinham aviso na base OSV (adendo da auditoria).

**Proposta.**

1. Levar todas as funções ao import map de `supabase/functions/deno.json`
   (nome lógico, uma versão por dependência) e ao `deno.lock`, com
   `--frozen` no CI.
2. Conferir na documentação do Supabase CLI se o deploy respeita o lock; se
   não respeitar, registrar o limite e trocar `esm.sh` por `npm:` com versão
   exata, que o deploy resolve pelo registro npm.
3. Estender o `deno check` do CI a todas as funções. Hoje `portal-login` e
   outras ficam fora e têm erros de tipo antigos (`PortalDb`, `EdgeRuntime`);
   corrigi-los faz parte desta rodada.

**Pronto quando** toda função resolve dependências pelo import map e pelo
lock, o CI confere todas com `--frozen`, e o manual de
[serviços externos](../operations/servicos-externos.md) diz como a publicação
trata o lock.

## 2. CSP sem o host compartilhado do PostHog

**Hoje.** A CSP (`scripts/cloudflare-security-headers.mjs`) libera
`script-src https://eu-assets.i.posthog.com`, host do fornecedor que também
serve scripts de outros projetos. Com qualquer injeção de HTML futura, esse
host vira fonte de script para o atacante. `style-src` mantém
`'unsafe-inline'`. O `form-action 'self'` já entrou na PR luccafwlog/vela#1038.

**Proposta.**

1. Ver se o `posthog-js` instalado (import dinâmico, sem autocapture nem
   replay) ainda baixa algum script do `eu-assets`. Se não baixar, tirar o
   host do `script-src`.
2. Se baixar, servir o carregador pelo próprio domínio (proxy reverso do
   PostHog ou cópia versionada em `public/`) e limitar a CSP a `'self'`.
3. Medir quanto do `'unsafe-inline'` de `style-src` vem de estilo inline do
   React e das bibliotecas; tirar só se não quebrar a tela
   (`npm run design:check`).

**Pronto quando** a CSP não lista host de terceiro em `script-src`, a
telemetria continua chegando (evento de teste no PostHog) e o teste da CSP
(`scripts/cloudflare-pages-workflow.test.mjs` ou o de cabeçalhos) confere o
novo valor.
