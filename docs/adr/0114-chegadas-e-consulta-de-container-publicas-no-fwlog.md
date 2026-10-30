# 0114 — Chegadas e saídas e Consulta de container públicas no fwlog.com.br

Status: aceito — 2026-10-30 (decisões do dono de 2026-10-29, A1 a A5 e B1 a B5,
no pedido da tarefa). Implementada na migration `542`, nas Edge Functions
`public-ship-schedule` e `public-container-lookup` (módulo comum
`supabase/functions/_shared/publicFwlog.ts`), nas páginas
`/portal/publico/chegadas-saidas` e `/portal/publico/consulta-container` do
Portal e na Pages Function `functions/portal/publico/[[path]].ts`.

Supersede parcialmente a [ADR 0090](./0090-programacao-de-navios-so-com-sessao.md)
só no ponto "nenhuma leitura pré-login": a programação e a consulta por
container passam a ser lidas sem login, **por Edge Function com
`service_role`**. O item 1 da 0090 (nenhuma função do banco para `anon`)
continua valendo sem exceção nova, e a suíte
`advisorFuncoesFechadas.local-pg.test.ts` continua igual.

## Contexto

O site institucional fwlog.com.br publica hoje uma planilha Excel em
`/consultar-devolucao/` para as transportadoras consultarem descarga,
devolução e free time por container. A planilha tem uma aba oculta com 9.119
containers legíveis por qualquer um. O Portal logado substitui a planilha
para o Cliente, mas as transportadoras do Cliente não têm conta. O site vai
ganhar dois produtos públicos, sem login, alimentados pelo Vela e pelo
Portal, colados no WordPress como `<iframe>` (nenhum script, chave ou lógica
do sistema vai para o WordPress).

## Decisão

### A. Quadro "Chegadas e saídas"

1. É o painel do Portal, da mesma fonte: o que o Vela publica (`show_on_portal`)
   aparece no Portal e no fwlog.com.br, com as datas confirmadas (✓ ATD/ATA).
   `show_on_portal` passa a significar "Portal **e** fwlog.com.br".
2. Sem "Meus B/Ls" e sem nenhuma leitura de B/L, carga ou Cliente.
3. Com o botão do MarineTraffic pelo IMO do navio (`vessels.imo`, só 7
   dígitos); sem IMO, sem botão.
4. Sem janela de tempo: todas as Viagens ativas com `show_on_portal`, como no
   Portal, com teto técnico de 100 Viagens.
5. Portos de chegada: Salvador, Vitória, Pecém e **Suape (BRSUA)**. Suape entra
   também no Portal logado e em Chegadas e Saídas do Vela
   (`PORTAL_SCHEDULE_LANES`), para os dois quadros continuarem iguais. O
   servidor filtra pelos portos do quadro; o navegador não recebe outro porto.

### B. Consulta de container

1. Lista positiva da resposta, e nada além: número (normalizado), tipo, navio,
   viagem, porto de descarga, data de descarga, data de devolução, free time
   em dias, data limite de devolução (descarga + free time, a mesma conta do
   status de Demurrage e da Invoice) e situação simplificada (aguardando
   descarga, dentro do free time, free time vencido, free time a confirmar,
   devolvido). A situação sai só desses campos e do dia de hoje; não acrescenta
   dado. "Consultado em" é a hora da resposta, não a da última alteração.
2. Só o número do container, sem segundo fator.
3. Uma linha, sempre a da Viagem mais recente daquele número, nunca histórico.
   Desempate determinístico: data de referência mais nova, Viagem de maior id,
   B/L de menor número e container de menor id. No container rateado entre
   B/Ls do mesmo Cliente na Viagem, é a linha do B/L-âncora da Invoice de
   Demurrage (menor número), então a resposta não varia por B/L.
4. Janela de 90 dias: entra o container cuja **data de referência** (dia de
   Brasília) é de hoje menos 90 dias em diante. A data de referência é a
   descarga; sem ela, a ATA e depois a ETA da escala do POD
   (`pod_schedule_snapshot`); sem escala, a ATA e a ETA gerais da Viagem.
   Container sem nenhuma dessas datas fica fora. Container já descarregado e
   ainda sem devolução entra **qualquer que seja a idade** da descarga
   (decisão do dono de 2026-10-30): é o caso que mais interessa à
   transportadora (free time vencido).
5. Portos da consulta: Salvador, Vitória, Pecém e Suape (`PUBLIC_LOOKUP_PORTS`;
   Pecém por decisão do dono de 2026-10-30). Lista própria, separada da dos
   portos da Central de Informações do Portal (`portalServicePorts`).
6. O free time em dias pode refletir o acordo comercial do Cliente
   (`customer_demurrage_agreements`) ou o free time do B/L. É decisão
   consciente do dono: a planilha atual já expõe isso. O valor sai da mesma
   regra do Portal e da Invoice (`_container_free_days`).
7. Fora da resposta, sempre com a mesma resposta vazia: número com formato
   ou dígito verificador ISO 6346 inválido, número inexistente, fora da
   janela, B/L sem CE Mercante, B/L cancelado, Viagem cancelada, porto não
   atendido e container SOC (SOC/COC está na lista do que nunca sai). O
   recorte do CE é o mesmo do Portal (`bl_has_portal_release`): o site nunca
   mostra carga que o próprio Cliente ainda não vê (decisão do dono de
   2026-10-30).

### Nunca sai, em nenhum dos dois

Cliente, consignatário, notify, shipper, CNPJ/CPF, e-mails, telefones,
endereços; B/L, CE Mercante, desbloqueio de CE; valores (Demurrage, taxas,
faturas, saldo, ROE, tarifas, overrides), Pix, status financeiro, disputas;
peso, tara, lacre, CBM, IMO/ONU da carga, NCM, descrição da carga, local de
desova, SOC/COC; lista ou contagem de B/Ls ou containers por Viagem; IDs
internos; autor e hora das mudanças na trilha (`audit_logs`), notas, alertas;
`tracking_url`; o âmbar interno de "previsão vencida".

### Caminho e controles

1. **Nenhuma função para `anon`.** `public_ship_schedule()` e
   `public_container_lookup(text)` são `SECURITY DEFINER`, com `search_path`
   fixo, `REVOKE ALL` de `PUBLIC`, `anon` e `authenticated` e `EXECUTE` só para
   `service_role`. O corpo da programação mora em `_ship_schedule_core()`, lido
   por `portal_ship_schedule()` (mesma guarda da 337) e pela função pública.
2. **Edge Function com `service_role`**, `verify_jwt = false`, sem chave do
   Supabase no site. A resposta é montada na Edge por lista positiva; a linha
   do SQL nunca é repassada.
3. **Anti-abuso obrigatório e fail-closed.** Turnstile próprio dos widgets
   (secrets `TURNSTILE_PUBLIC_SECRET_KEY` e `TURNSTILE_PUBLIC_ALLOWED_HOSTNAMES`,
   Site Key `VITE_TURNSTILE_PUBLIC_SITE_KEY`), separado do login do Portal, com
   `action` `schedule` e `lookup`; quadro ao abrir e a cada Atualizar, busca a
   cada consulta. Limites no Upstash por IP (HMAC, nunca o IP em claro):
   quadro 30 a cada 10 min; busca 20 a cada 10 min e 100 por dia, 10
   "não encontrado" por hora e disjuntor global de 300 "não encontrado" por
   hora. Sem secret, sem hostname, sem origem permitida ou com o Upstash fora
   do ar, a Edge recusa; nunca libera.
4. **Quadro com cache compartilhado** de 90 s no Upstash, o mesmo para todos:
   o banco é lido no máximo uma vez por janela, qualquer que seja o tráfego.
5. **Busca uniforme:** "não encontrado" é `{found:false}`, status 200,
   `Cache-Control: no-store` e tempo mínimo de resposta igual ao do "achou",
   qualquer que seja o motivo.
6. **CORS** só para as origens de `PUBLIC_FWLOG_ALLOWED_ORIGINS`. O iframe roda
   na origem do Portal, então é ela que chama a Edge; o fwlog.com.br não
   precisa constar.
7. **Iframe só nas rotas públicas.** As duas rotas públicas
   (`/portal/publico/chegadas-saidas` e `/portal/publico/consulta-container`)
   saem pela Pages Function de `/portal/publico/*` com
   `frame-ancestors https://fwlog.com.br https://www.fwlog.com.br`
   e sem `X-Frame-Options`; todas as demais rotas dos dois sites, inclusive
   outro caminho sob `/portal/publico/`, continuam com
   `X-Frame-Options: DENY` e `frame-ancestors 'none'`. Sem o arquivo de headers
   que o stage grava só no Portal, a Function responde 404 que nega iframe.
8. Logs sem número de container nem IP em claro; volume e taxa de "não
   encontrado" pelo evento estruturado de cada pedido nos logs da Edge, e 5xx
   no Sentry pelo `instrumentEdgeHandler`. No navegador, dois eventos no
   PostHog (decisão do dono de 2026-10-30): `public_schedule_viewed` (quadro
   lido) e `public_container_lookup` com só o resultado (`lookup_outcome`:
   achou, não achou, número inválido, limite, verificação recusada,
   indisponível), nunca o número; a mesma barreira de `featureFlags.ts` corta
   URL, aparelho e qualquer outra propriedade.

## Testes exigidos

- local-pg (`publicFwlog.local-pg.test.ts`): grants; paridade
  `portal_ship_schedule` × `public_ship_schedule`; Viagem fora do Portal,
  cancelada e escala retirada fora; Suape dentro; dígito inválido,
  inexistente, fora da janela, sem CE Mercante, cancelado, porto não atendido e SOC
  indistinguíveis; número repetido → só a mais recente; rateio → resposta
  única; free time igual ao do Portal. `advisorFuncoesFechadas` sem exceção
  nova.
- Deno (`supabase/functions/_shared/publicFwlog.test.ts`): Turnstile ausente,
  inválido, de outro hostname ou de outra action; Upstash fora; limites e
  disjuntor; CORS; corpo grande; chave fora da lista positiva; logs sem
  número nem IP.
- Vitest: páginas públicas sem leitura de B/L nem "Meus B/Ls"; MarineTraffic
  só com IMO; listas iguais entre Edge, front e SQL; headers gerados e Pages
  Function (`src/lib/publicEmbedHeaders.test.ts`,
  `scripts/cloudflare-pages-stage.test.mjs`).

## Consequências

- Uma pessoa sem conta lê a programação publicada e, por número exato, um
  container dos portos da consulta dos últimos 90 dias ou ainda não
  devolvido. É menos do que a
  planilha pública atual expõe (aba oculta com 9.119 containers).
- Reabrir mais campos, portos, janela ou outra forma de busca exige nova ADR.
- Adicionar porto ao quadro muda três listas que os testes comparam:
  `PORTAL_SCHEDULE_LANES`, `_public_schedule_port_codes()` e a da Edge; à
  consulta, `PUBLIC_LOOKUP_PORTS`, `_public_lookup_port_codes()` e a da Edge.
- O limite global de 300 "não encontrado" por hora foi confirmado pelo dono
  em 2026-10-30.
- Configuração externa necessária antes de usar: widget Turnstile novo,
  secrets das Edges, variável de build da Site Key e origens do CORS
  ([Serviços externos](../operations/servicos-externos.md)); o passo a passo
  de colar os iframes está em
  [fwlog-site-embed.md](../operations/fwlog-site-embed.md).
