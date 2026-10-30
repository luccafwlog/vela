# Chegadas e saídas e Consulta de container no fwlog.com.br

Para quem cuida do site institucional (WordPress). Regra e campos na
[ADR 0114](../adr/0114-chegadas-e-consulta-de-container-publicas-no-fwlog.md);
segredos e widget em [Serviços externos](servicos-externos.md#turnstile-dos-widgets-públicos-fwlogcombr).

O site recebe **só dois `<iframe>`**. Nenhum script, chave, token ou endereço
do Supabase vai para o WordPress: as páginas rodam no domínio do Portal
(`portalfwlog.com.br`), que só aceita ser exibido dentro de
`https://fwlog.com.br` e `https://www.fwlog.com.br`.

## Antes de colar (equipe técnica)

1. Migration `542` aplicada e Edge Functions `public-ship-schedule` e
   `public-container-lookup` publicadas.
2. Widget Turnstile dos widgets públicos criado, com a Site Key em
   `VITE_TURNSTILE_PUBLIC_SITE_KEY` (build do Portal) e os secrets
   `TURNSTILE_PUBLIC_SECRET_KEY`, `TURNSTILE_PUBLIC_ALLOWED_HOSTNAMES` e
   `PUBLIC_FWLOG_ALLOWED_ORIGINS` nas Edge Functions.
3. As duas URLs de produção abrem direto no navegador e mostram o quadro e o
   campo de consulta (sem "indisponível").

## Produção: os dois blocos para colar

Em cada página do WordPress, um bloco **HTML personalizado** com o código
abaixo, sem mudar nada.

Chegadas e saídas:

```html
<iframe
  src="https://portalfwlog.com.br/portal/publico/chegadas-saidas"
  title="Chegadas e saídas de navios — Fwlog"
  width="100%"
  height="900"
  style="border:0;width:100%;min-height:900px"
  loading="lazy"
  referrerpolicy="no-referrer"
  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
></iframe>
```

Consulta de container:

```html
<iframe
  src="https://portalfwlog.com.br/portal/publico/consulta-container"
  title="Consulta de container — Fwlog"
  width="100%"
  height="820"
  style="border:0;width:100%;min-height:820px"
  loading="lazy"
  referrerpolicy="no-referrer"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
></iframe>
```

Por que cada permissão do `sandbox` (o mínimo que funciona):

| Permissão | Para quê |
|---|---|
| `allow-scripts` | A página e a verificação de segurança (Turnstile) rodam JavaScript |
| `allow-same-origin` | O Turnstile exige; sem ela a verificação falha. Continua isolado do WordPress: a página é de outro domínio |
| `allow-forms` | Só na consulta: o botão **Consultar** envia o formulário |
| `allow-popups` e `allow-popups-to-escape-sandbox` | O botão "Ver no mapa" (MarineTraffic) e o link de privacidade do Turnstile abrem em nova aba, fora das restrições do iframe |

Não acrescente `allow-top-navigation`: as páginas nunca precisam trocar a
página do site.

## Staging (teste antes de produção)

As mesmas linhas com `https://staging.vela-portal.pages.dev` no lugar de
`https://portalfwlog.com.br`:

- `https://staging.vela-portal.pages.dev/portal/publico/chegadas-saidas`
- `https://staging.vela-portal.pages.dev/portal/publico/consulta-container`

O staging fica atrás do Cloudflare Access (login da equipe): abra as URLs
direto no navegador, já autenticado. Dentro de um iframe o Access pode pedir
login ou não carregar; isso é do Access, não das páginas. O teste do iframe de
verdade é feito numa página **rascunho/privada** do WordPress em
`fwlog.com.br` apontando para produção, antes de publicar.

## O que não colar

- Nenhum `<script>`, nenhuma Site Key, Secret Key, token, `apikey` nem endereço
  `*.supabase.co`.
- Nenhuma cópia da planilha, nenhum link para `/consultar-devolucao/` com o
  Excel: a planilha atual tem uma aba oculta (`Planilha2`) com 9.119
  containers legíveis por qualquer um e deve sair do site depois do período em
  paralelo (abaixo).
- Nenhum outro caminho do Portal em iframe: só os dois acima são aceitos; os
  demais recusam (`frame-ancestors 'none'`).

## Depois de publicar: conferir

1. As duas páginas do site mostram o conteúdo dentro do iframe; no celular o
   quadro vira cartões. Com muitos navios o quadro rola dentro do próprio
   iframe: é esperado (a altura não se ajusta sozinha sem script no site, e
   nenhum script vai para o WordPress). Se preferir, aumente o `height`.
2. O quadro tem "Atualizado em …" e o botão **Atualizar** funciona.
3. Um navio com IMO cadastrado tem o ícone do mapa, que abre o MarineTraffic
   em nova aba.
4. A consulta de um container conhecido (de Salvador, Vitória, Pecém ou
   Suape, descarregado nos últimos 90 dias ou ainda não devolvido) mostra a situação e a data limite; um número
   com o último algarismo trocado mostra "Confira o número…".
5. Nenhuma das páginas mostra cliente, B/L, valores ou o nome do sistema
   interno.
6. Aberta direto num endereço de outro site (por exemplo, um teste local em
   `iframe` fora do fwlog.com.br), a página não aparece: o navegador recusa.

## Corte da planilha

1. Período em paralelo de duas semanas: iframes publicados e a planilha ainda
   no ar, com aviso no site apontando para a consulta nova.
2. A equipe confere com as transportadoras que a consulta atende (free time e
   data limite batem com o que a Fwlog cobra).
3. Retirar a planilha e o arquivo do WordPress (inclusive da biblioteca de
   mídia, para o link direto parar de funcionar).
