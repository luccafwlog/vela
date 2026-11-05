# Reforços adiados da auditoria de segurança run-3

Data: 2026-10-23. Origem: notas de endurecimento da auditoria de segurança
run-3 (2026-10-22). Decisão do dono de 2026-10-22: tratar estes dois pontos
numa rodada própria, depois da PR luccafwlog/vela#1038, que trouxe as correções
e as demais decisões da auditoria (migrations `419` a `439`).

## Estado

**Encerrado em 2026-11-05 e arquivado.** Por decisão do dono, depois da
revisão abaixo, foram feitos os passos pertinentes e o 2.3 fica de fora:

- **1.1 e 1.3:** todas as dependências das funções têm nome lógico no import
  map `supabase/functions/deno.json`, que todas as entradas de
  `supabase/config.toml` declaram; o código importa só o nome. O CI faz o
  `deno check` das 26 funções e roda os testes Deno delas num passo só, com o
  lock das funções (`--frozen`); o `deno.lock` da raiz saiu. Os 25 erros de
  tipo de `portal-login`, `portal-invite-activate` e `recalc-demurrage-ptax`
  foram corrigidos sem mudar o comportamento. `edgeTelemetryConfiguration.test.ts`
  falha se uma função ficar sem o import map ou importar com versão no código.
- **2.1:** o `posthog-js` roda com `disable_external_dependency_loading`, e o
  `script-src` deixou de listar `https://eu-assets.i.posthog.com` (fica só no
  `connect-src`); `publicEmbedHeaders.test.ts` confere o novo `script-src`.
- **2.2:** obsoleto (ver a revisão).
- **2.3:** não será feito, por decisão do dono: o `style-src` mantém
  `'unsafe-inline'`, de que a janela de impressão depende.

Não verificado: o evento de teste chegando ao PostHog com a opção nova e a
publicação das funções com o import map na integração do Supabase; os dois só
aparecem depois do merge.

Do ponto 1, o passo 2 foi feito em 2026-11-03 (ver "Andamento"); o resto
continua pendente. A [revisão de 2026-11-05](#revisão-de-2026-11-05) confirmou
que os passos que faltam continuam pertinentes, com dois ajustes de escopo: o
passo 2 do ponto 2 deixou de ser necessário, e o passo 3 do ponto 2 tem uma
dependência concreta, a janela de impressão. Nenhum dos dois pontos tem caminho
de exploração demonstrado; são defesa em profundidade.

## Revisão de 2026-11-05

Varredura do código, do CI (`ci.yml`), do Dependabot e das decisões
posteriores a 2026-10-23 (ADRs 0100 a 0122,
[serviços externos](../../operations/servicos-externos.md) e
[segurança](../../operations/seguranca.md#headers-http--csp)). Nenhuma decisão
posterior tornou um ponto obsoleto por inteiro: o PostHog continua em uso, e a
[ADR 0114](../../adr/0114-chegadas-e-consulta-de-container-publicas-no-fwlog.md)
acrescentou eventos das páginas públicas, que o fwlog.com.br põe em iframe e
que usam a mesma CSP.

| Passo | Situação | Evidência |
|---|---|---|
| 1.1 Import map | Pertinente, por outro motivo | O risco de cadeia de fornecimento que motivou o ponto foi resolvido em 2026-11-03: nenhum import vem do esm.sh, os quatro pacotes (`@supabase/supabase-js`, `svix`, `@e965/xlsx`, `@sentry/deno`) estão no `deno.lock` com versão exata, e a publicação confere o lock. O que sobra é a atualização: o Dependabot do Deno lê só o `deno.json` e o `deno.jsonc` (documentação do GitHub, "Supported ecosystems and repositories"), e o `deno.json` das funções só declara o `@sentry/deno`. As versões escritas direto no código, em cerca de 30 arquivos, não recebem atualização: as funções estão no `supabase-js` 2.117.2, e o frontend já está no 2.118.0. |
| 1.2 Publicação respeita o lock | Feito em 2026-11-03 | [Serviços externos § Edge Functions](../../operations/servicos-externos.md#edge-functions) diz como a publicação trata o lock. |
| 1.3 `deno check` de todas as funções | Pertinente | O CI confere 17 das 26 funções. Das 9 que ficam fora, 6 passam sem erro hoje (`alerts-detector`, `ce-unlock-document-download`, `ce-unlock-export`, `import-effects-runner`, `portal-account-suspend` e `portal-dispute-attachment`; `deno check` local com o lock das funções, `--frozen`). As outras 3 têm 25 erros de tipo: `portal-login` (6, `PortalDb`), `portal-invite-activate` (10 de "'invite' possibly null" e 2 de `EdgeRuntime`) e `recalc-demurrage-ptax` (7, tipo do cliente do Supabase). Pela leitura do código, nenhum é defeito de execução: o convite nulo já é barrado por `valid`, antes do uso. Como cada merge na `main` republica todas as funções, e mudança em `_shared/` chega a todas, uma função fora do CI pode quebrar sem aviso. |
| 2.1 PostHog ainda baixa script | Respondido: baixa | O `posthog-js` 1.443.0 instalado insere, a cada carga, `<script src="https://eu-assets.i.posthog.com/array/<chave>/config.js">` (a configuração remota). Isso vale no Vela e no Portal, porque os dois recebem a chave. Com `disable_external_dependency_loading: true` em `createPostHogConfig` (`src/lib/featureFlags.ts`), a biblioteca não insere script nenhum e busca a mesma configuração em JSON (`/array/<chave>/config`), que o `connect-src` já permite. Leitura do código da biblioteca, não conferida no navegador. |
| 2.2 Carregador pelo próprio domínio | Obsoleto | Com a opção acima não há script a servir: proxy reverso e cópia em `public/` deixam de ser necessários. |
| 2.3 `'unsafe-inline'` em `style-src` | Pertinente, de ganho baixo | O estilo do React (`style={…}`) é aplicado pelo CSSOM e não depende de `'unsafe-inline'`. A dependência encontrada é a janela de impressão: `printDocumentElement` (`src/lib/printDocument.ts`) abre `window.open('')`, que herda a CSP do site, e põe um `<style>` com a folha A4, as margens e a numeração das páginas. Sem `'unsafe-inline'`, esse `<style>` é recusado. Por ser um texto fixo, o hash dele no `style-src` cobriria esse caso. Não foi medido no navegador se há outra fonte de estilo inline (atributos `style` copiados para a janela, bibliotecas). Sem execução de script, o ganho é pequeno. |

O teste da CSP citado em "Pronto quando" do ponto 2 não confere hoje o
`script-src`: `scripts/cloudflare-pages-stage.test.mjs` e
`src/lib/publicEmbedHeaders.test.ts` conferem `frame-ancestors` e
`connect-src`.

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

**Andamento (2026-11-03).** O ponto 2 está respondido: a integração do
Supabase confere o `supabase/functions/deno.lock` no empacotamento e recusou o
deploy quando o esm.sh serviu outro build do `tslib` (log da branch staging,
`workflow_run_logs`). Todas as funções passaram a importar o `supabase-js` por
`npm:@supabase/supabase-js@2.117.2`; nenhum import vem mais do esm.sh, e o lock
das funções cobre todas elas
([serviços externos § Edge Functions](../../operations/servicos-externos.md#edge-functions)).
Faltam o import map único (ponto 1, nome lógico por dependência) e o `deno
check` de todas as funções no CI (ponto 3).

**Pronto quando** toda função resolve dependências pelo import map e pelo
lock, o CI confere todas com `--frozen`, e o manual de
[serviços externos](../../operations/servicos-externos.md) diz como a publicação
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
