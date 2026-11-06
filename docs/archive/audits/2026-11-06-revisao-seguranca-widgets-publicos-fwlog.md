# Revisão de segurança dos widgets públicos do fwlog.com.br — 2026-11-06

> Registro histórico da revisão de 2026-11-06, pedida pelo dono depois do
> lançamento do Portal para o mercado. As regras dos widgets estão na
> [ADR 0114](../../adr/0114-chegadas-e-consulta-de-container-publicas-no-fwlog.md);
> o que mudou depois fica no [CHANGELOG](../../CHANGELOG.md) e nos módulos.

- **Unidade revisada:** a Consulta de container pública
  (`https://fwlog.com.br/consultar-devolucao/`, iframe de
  `https://portalfwlog.com.br/portal/publico/consulta-container`), a Edge
  Function `public-container-lookup`, as funções SQL das migrations `542`, `543`
  e `545`, os headers de iframe (Pages Function de `/portal/publico/*`) e, de
  passagem, o quadro `public-ship-schedule`, que divide o mesmo código.
- **Pergunta:** o widget é porta de entrada para invadir o Vela ou o Portal, e
  que barreira falta.
- **Restrições respeitadas:** nenhuma escrita na produção. No banco de produção
  só se leu o catálogo (`pg_proc`, `pg_indexes`), nunca linha de tabela; nos
  logs, só contagens. Na Edge, só pedidos `OPTIONS`, que o código responde
  antes de qualquer contador. O teste ativo de falsificação de IP não foi feito
  (o dono dispensou).

## Resposta

O widget não é porta de entrada para o sistema. O navegador não recebe chave;
a única entrada é o número do container, conferido pelo dígito ISO 6346 antes
do banco; o banco só é lido por duas funções que apenas o `service_role`
executa; a resposta é uma lista fixa de 10 campos.

## Conferências

| Afirmação | Evidência |
|---|---|
| `public_container_lookup`, `public_ship_schedule` e as funções auxiliares (`_ship_schedule_core`, `_public_*_port_codes`, `_iso6346_check_digit_valid`, `bl_has_portal_release`, `_container_free_days`, `_container_demurrage_status`) sem `EXECUTE` para `anon` e `authenticated` | **Runtime:** produção, `has_function_privilege` em 2026-11-06 |
| O filtro de B/L com Cliente da `545` está na função em produção | **Runtime:** corpo da função em produção, 2026-11-06 |
| A Edge publicada (versão 15) é igual ao repositório, arquivo a arquivo (`index.ts`, `publicFwlog.ts`, `turnstile.ts`, `rateLimit.ts`, `boundedBody.ts`, `cors.ts`, `portalLoginRateLimit.ts`, `telemetry.ts`, `telemetryScope.ts`, `telemetryContract.ts`) | **Runtime:** arquivos da função publicada comparados com o repositório em `24e51684` |
| CORS só para `https://portalfwlog.com.br`; `www.portalfwlog.com.br`, `fwlog.com.br`, `vela.app.br`, staging e preview do Pages, origem qualquer e `null` recusadas | **Runtime:** preflight `OPTIONS` em produção |
| Iframe só nas duas páginas públicas e só dentro de `https://fwlog.com.br` e `https://www.fwlog.com.br`; outro caminho sob `/portal/publico/` é 404 com `frame-ancestors 'none'`; login e Painel com `X-Frame-Options: DENY` | **Runtime:** headers de produção |
| Entrada limitada a 4 KB; número normalizado e com dígito conferido na Edge e de novo no SQL; RPC parametrizada | **Código:** `supabase/functions/_shared/publicFwlog.ts`; **Teste:** Deno `publicFwlog.test.ts` |
| "Não encontrado" igual para todo motivo (status, corpo e tempo mínimo de 400 ms) | **Código**; **Teste:** Deno `publicFwlog.test.ts` |
| Busca por índice (`idx_bl_containers_number_normalized`) | **Runtime:** `pg_indexes` em produção |
| O IP dos limites vem de `CF-Connecting-IP`, que a Cloudflare grava e o cliente não troca; nos 78 pedidos registrados ele é igual ao `x-real-ip` e sem lista | **Runtime:** logs da Edge (contagem); documentação da Cloudflare. Sem teste ativo |
| Sem secret do Turnstile, sem hostname ou sem Upstash, recusa | **Código**; **Teste:** Deno `publicFwlog.test.ts` |
| Logs, Sentry e PostHog sem número de container nem IP | **Código**; **Teste:** Deno `publicFwlog.test.ts` |
| Uso em 24 h: 17 consultas (9 achadas, 8 não encontradas), 22 leituras do quadro, nenhuma recusa por limite, verificação ou disjuntor | **Runtime:** logs da função, 2026-11-05 a 2026-11-06 |

## Achados

1. **Planilha antiga ainda publicada (fora do código).** A página tem o botão
   para `tracking-devolucao-de-container-1.xlsx`, e a versão anterior
   (`tracking-devolucao-de-container.xlsx`) também abre. A aba oculta
   `Planilha2` traz cerca de 10,7 mil containers de Vitória e Salvador, com
   descargas de julho a novembro de 2026, porto de origem, navio, prazo do free
   time, devolução e dias de uso. Aba oculta e planilha protegida não impedem a
   leitura. **Decisão do dono (2026-11-06):** a planilha fica no ar por mais um
   tempo; não traz consignatário. O corte continua descrito em
   [fwlog-site-embed.md](../../operations/fwlog-site-embed.md#corte-da-planilha).
2. **Disjuntor global sem aviso (corrigido nesta entrega).** Com cerca de 30 IPs
   e verificações do Turnstile resolvidas por serviço pago, 300 "não encontrado"
   na hora tiram a busca do ar para todos até a hora virar, e nada avisava (429
   não vai ao Sentry). Agora o pedido que abre o disjuntor manda um aviso ao
   Sentry, um por hora
   ([Observabilidade](../../operations/observabilidade.md#erros-das-edge-functions)).
3. **Consulta em massa de números conhecidos (aceito).** O "achou" não tem teto
   global, só por IP (20 a cada 10 min e 100 por dia). Quem tem uma lista de
   números e muitos IPs acompanha a situação deles. Os campos são os da lista
   positiva da ADR 0114.
4. **Custo de pedidos sem verificação (configuração).** Os contadores do
   Upstash são gravados antes do Turnstile: um script com `Origin` forjado gasta
   comandos do Upstash e execuções da Edge sem resolver nada. O Upstash é o
   mesmo do login do Portal, que sem ele volta à trava do Supabase. Medida
   indicada: teto de gasto e alerta no plano do Upstash.
5. **Comentário interno no HTML da página do site.** O bloco HTML do Elementor
   publicado trazia um comentário de rascunho com instruções internas. Retirada
   em andamento pela equipe do site, junto com o cuidado do WordPress.
6. **Manual de serviços externos desatualizado (corrigido nesta entrega).**
   Dizia o widget do Turnstile "ainda não criado" e os secrets "ainda não
   cadastrados".

## Não verificado

- Modo (Managed) e hostnames do widget no painel do Turnstile.
- Plano e teto de gasto do Upstash.
- Falsificação de IP por teste ativo.
