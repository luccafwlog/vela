# Guia do Portal do Cliente Fwlog (onboarding)

**Versão para envio ao cliente**, aprovada por quem pediu o material em
2026-10-29, página a página. Ao mudar uma tela do Portal que o guia mostra,
atualize o guia e gere o PDF de novo.

Material para o cliente final do Portal do Cliente (`portalfwlog.com.br`):
um guia ilustrado em A4, um guia rápido de duas páginas para o e-mail de anúncio
e os textos dos e-mails que os acompanham. O cliente
não vê o nome do sistema interno; o guia fala só em Fwlog e Portal do
Cliente. Nada aqui é importado por `src/` nem muda o Portal.

## Arquivos

| Arquivo | O que é |
|---|---|
| [Tutorial_Portal_Fwlog.html](Tutorial_Portal_Fwlog.html) | Fonte do guia: 15 páginas A4 prontas para impressão. Abra a partir desta pasta do repositório, porque as fontes e as logos vêm de `public/`. |
| [Tutorial_Portal_Fwlog.pdf](Tutorial_Portal_Fwlog.pdf) | O guia em PDF, para anexar ao e-mail ou imprimir. É gerado a partir do HTML. |
| [guia-rapido-portal-fwlog.html](guia-rapido-portal-fwlog.html) | Fonte do guia rápido: duas páginas A4 em formato de folheto, com o mesmo visual e os mesmos desenhos de tela do guia completo. |
| [guia-rapido-portal-fwlog.pdf](guia-rapido-portal-fwlog.pdf) | O guia rápido em PDF, para anexar ao e-mail de anúncio. |
| [gerar-pdf.mjs](gerar-pdf.mjs) | Gera os dois PDFs e recusa página que transborda o A4, fonte ou logo que não carregou, rodapé ou numeração errada, a marca “Rascunho para revisão” e qualquer menção ao sistema interno. |

As dicas que poderiam aparecer dentro do Portal estão numa spec à parte, porque
specs só moram em `docs/spec/`:
[dicas contextuais do Portal](../../docs/spec/2026-10-28-dicas-contextuais-portal-design.md).

### O que o guia cobre

| Página | Assunto |
|---|---|
| 1 | Capa |
| 2 | Boas-vindas, menu do Portal, como o acesso funciona, sumário e primeiros passos |
| 3 | Primeiro acesso pelo convite (48 horas, uso único, reenvio) |
| 4 | Entrar com CNPJ e senha; Esqueci minha senha |
| 5 | Painel: cartões, Chegadas e saídas (datas de origem e de Vitória, Ver no mapa, Ver meus B/Ls) e avisos |
| 6 | BLs e Containers: as duas abas (só o próprio CNPJ, B/L depois do CE), dias de uso, free time e devolução |
| 7 | Desbloqueio de CE Mercante: requisitos, passos e prazo |
| 8 | Acompanhar a solicitação de desbloqueio: os quatro requisitos por B/L e as situações |
| 9 | Faturas (só emitidas), situação e impressão |
| 10 | Fatura consolidada: vários B/Ls numa fatura e um Pix, quem entra, Coberta e Refazer consolidada |
| 11 | Pagamento por Pix (única forma de pagamento): QR, Copia e Cola, “em preparação” e baixa automática |
| 12 | Demurrage (US$ fixo, R$ pelo câmbio do dia) e disputa |
| 13 | Central de Informações e os e-mails que o cliente recebe |
| 14 | Meu perfil: caixas de comunicados, endereço e e-mail de recuperação |
| 15 | Contatos e o que fica fora do Portal |

O guia é atemporal: não cita data de início nem navio. Cada página traz o
desenho da tela com pontos numerados, um **passo a passo** curto ligado a esses
números e um quadro **Bom saber** só com o que não é óbvio (prazos, limites,
regras). O que a tela já diz sozinha fica de fora. O guia não fala de
pagamento parcial, para não sugerir que a Fwlog o aceita.

Para a equipe (o guia não traz esses avisos): as telas são desenhos
esquemáticos, não capturas, e os dados são fictícios (Exemplo Comércio Ltda.,
CNPJ `12.***.***/0001-90`, B/L `AURU1234567`, fatura `TX-2026-00421`,
containers `EXMU…`, Invoice `DEM-2026-0057`). Nomes de navio e viagem, o
número da solicitação de desbloqueio e a maioria das datas aparecem como barras
cinza, para o guia não envelhecer; só a tabela Chegadas e saídas do Painel
mostra datas de exemplo, porque a página explica como lê-las. O QR Code do desenho é um padrão
decorativo, sem dados: nenhum app de banco o lê.

### Guia rápido

Folheto de duas páginas para o primeiro contato, anexado ao e-mail de
anúncio; não substitui o guia completo. Pouco texto e desenhos de tela:

- **Página 1:**
  - capa com o que é o Portal e o endereço;
  - o desenho do Painel;
  - quatro destaques: Pix com baixa automática e recibo, free time à vista,
    desbloqueio de CE e navios no radar.
- **Página 2:**
  - primeiro acesso em três passos;
  - "Veja como funciona", com quatro desenhos:
    - Pix até o recibo;
    - situação dos containers;
    - os quatro requisitos do desbloqueio de CE;
    - fatura consolidada;
  - os três contatos (suporte, Importação e Equipamentos);
  - convite para pedir o guia completo ao suporte.

Os desenhos repetem os do guia completo. Os valores são de exemplo, e a
legenda da página 1 avisa que as imagens são ilustrativas.

Tudo vem do guia completo; o que não está nele ficou de fora:

- **Itaú, TED e comprovante.** O guia completo diz que Taxas Locais e
  Demurrage são pagas só por Pix e que não é preciso enviar comprovante. O
  nome do banco só aparece em comentários do código, nunca ao cliente.
- **Transhipping.** O guia completo não cita a marca (decisão de 2026-10-28).
- **Link do guia completo no Portal.** O guia não está publicado no Portal
  nem na Central de Informações. Por isso o convite final pede o guia ao
  suporte e indica o menu Informações para tabelas, depósitos e contatos.

## Gerar os PDFs

Depois de mudar um dos HTMLs, rode na raiz do repositório:

```bash
node artifacts/portal-onboarding-cliente/gerar-pdf.mjs
```

Usa o Playwright das dependências de desenvolvimento (`npm ci` antes, se a
pasta `node_modules` não existir). Sem o navegador do Playwright instalado,
aponte outro Chromium em `PDF_BROWSER_EXECUTABLE_PATH`, como os scripts de
`scripts/perf/` fazem com `PERF_BROWSER_EXECUTABLE_PATH`. Cada PDF só é gravado se
todas as conferências do seu HTML passarem. A DM Sans é uma fonte variável e entra no PDF como Type 3: o texto
continua selecionável e pesquisável, mas alguns leitores antigos desenham a
letra com menos nitidez em tela.

## Textos prontos para e-mail

São mensagens enviadas pela equipe, à mão, de qualquer caixa da Fwlog: as
dúvidas vão sempre para `suporte@portalfwlog.com.br`.
O convite de acesso **não** é um destes textos: ele sai do sistema, sozinho,
para o e-mail de recuperação do CNPJ, com o assunto “Ative o acesso da
&lt;razão social&gt; ao Portal do Cliente”.

### 1. Apresentação do Portal (anexar o PDF)

**Assunto:** Portal do Cliente Fwlog: acesso e guia de uso

> Prezado cliente,
>
> Os processos da sua empresa com a Fwlog são acompanhados no Portal do
> Cliente: portalfwlog.com.br.
>
> No Portal, você:
>
> - consulta as faturas emitidas de Taxas Locais e Demurrage e paga por Pix,
>   pelo QR Code ou pelo código Copia e Cola, com baixa automática;
> - acompanha os B/Ls da sua empresa, os containers, a devolução e o free time;
> - pede o desbloqueio do CE Mercante;
> - encontra as tabelas de Taxas Locais, os depósitos de devolução, os agentes
>   por porto e os nossos contatos.
>
> **Como acessar.** Não há cadastro no site. Você vai receber um e-mail com o
> assunto “Ative o acesso da [razão social] ao Portal do Cliente”. Clique em
> **Ativar acesso** e crie a sua senha. O link vale por 48 horas e só pode ser
> usado uma vez. Depois, entre com o CNPJ da empresa e a senha criada.
>
> Anexamos um guia com o passo a passo de cada tela.
>
> Dúvidas sobre o acesso: suporte@portalfwlog.com.br.
>
> Atenciosamente,
> Equipe Fwlog

### 2. Lembrete: convite não usado

**Assunto:** Seu acesso ao Portal do Cliente Fwlog

> Prezado cliente,
>
> Enviamos o convite de acesso ao Portal do Cliente para o e-mail cadastrado da
> [razão social], CNPJ [CNPJ]. O link do convite vale por 48 horas e só pode
> ser usado uma vez.
>
> Se você não encontrou o convite, confira a caixa de spam. Se o link venceu,
> escreva para suporte@portalfwlog.com.br pedindo um novo. O novo convite
> invalida os anteriores: use sempre o mais recente.
>
> Atenciosamente,
> Equipe Fwlog

### 3. Resposta do suporte: novo convite enviado

**Assunto:** Novo convite do Portal do Cliente

> Olá,
>
> Enviamos um novo convite para o e-mail cadastrado da [razão social]. O
> assunto é “Novo convite para ativar seu acesso ao Portal do Cliente”. Os
> links anteriores deixaram de funcionar.
>
> O novo link vale por 48 horas e só pode ser usado uma vez. Ao ativar, crie a
> sua senha e entre com o CNPJ da empresa em portalfwlog.com.br.
>
> Atenciosamente,
> Suporte do Portal do Cliente · Fwlog

## Fontes conferidas

Cada afirmação do guia saiu destas fontes (**Código**: leitura estática do
repositório na `staging` de 2026-10-28; nada foi observado em produção).

| Assunto | Fonte |
|---|---|
| Rotas, telas, convite, login, recuperação, perfil, Faturas, Demurrage no Portal, Central de Informações | [Portal do Cliente](../../docs/modules/portal-cliente.md) |
| Cores, letras, blocos, botões e o que o cliente vê da marca | [Identidade visual](../../docs/identidade-visual.md) e [assets de marca](../../public/branding/README.md) |
| Textos exatos das telas | `src/pages/PortalLogin.tsx`, `PortalAtivacao.tsx`, `PortalForgotPassword.tsx`, `PortalDashboard.tsx`, `PortalBilling.tsx`, `PortalOperacao.tsx`, `PortalProfile.tsx`; `src/components/auth/PortalAccessHelp.tsx`; `src/components/layout/PortalLayout.tsx` |
| Regra de senha e mensagem de login recusado | `src/lib/passwordPolicy.ts`, `src/lib/portalCnpjLogin.ts` |
| Assuntos e textos dos e-mails do acesso | `supabase/functions/_shared/portalEmailTemplates.ts` |
| Pix: “QR Code Pix em preparação”, baixa em 1 a 5 minutos | `src/components/portal/PortalPixPaymentBlock.tsx`, `PIX_SETTLEMENT_NOTE` em `src/components/shared/InvoiceDocumentKit.tsx`, [Reconciliação PIX](../../docs/modules/reconciliacao-pix.md) |
| Pix como única forma de pagamento; Desbloqueio de CE liberado ao cliente | Informado no pedido de revisão de 2026-10-28 |
| “No free time · N dias” conta os dias que faltam | `src/lib/portalOperationViews.ts` |
| B/L só aparece com CE Mercante | [Regras de negócio § Gate de CE Mercante no Portal](../../docs/operations/regras-de-negocio.md#gate-de-ce-mercante-no-portal) |
| Desbloqueio de CE: quatro requisitos, prazo, até 100 B/Ls | [Desbloqueio de CE](../../docs/modules/desbloqueio-ce.md) |
| Demurrage: US$ fixo, R$ pelo câmbio até o pagamento, Régua pausada na disputa, anexos | [Demurrage](../../docs/modules/demurrage.md) e a tabela de disputa em [Portal do Cliente](../../docs/modules/portal-cliente.md) |
| Datas de Chegadas e saídas | `src/components/portal/ShipScheduleWidget.tsx`, `src/components/portal/shipScheduleCells.ts` |
| Caixas de comunicados | `src/services/customerCommunicationBoxes.ts` |
| Endereços de contato | `src/config/portalUrl.ts` (suporte), `src/services/customerCommunicationTemplates.ts` (importação e Demurrage) e os quatro endereços do pedido |
| Número da Invoice de Demurrage (`DEM-AAAA-NNNN`) | migration `294` |

## Verificação feita

- `node artifacts/portal-onboarding-cliente/gerar-pdf.mjs`: guia rápido em duas
  páginas A4, com as mesmas conferências e sem Itaú, TED, Transhipping ou
  rascunho no texto extraído (`pdftotext`), 2026-10-29.
- `node artifacts/portal-onboarding-cliente/gerar-pdf.mjs`: 15 páginas, sem
  transbordo, fontes e logos carregadas, rodapé e numeração certos em todas,
  sem a marca de rascunho e sem menção ao sistema interno (**Runtime**,
  Playwright 1.64.1 do repositório com o Chromium 1243 do ambiente de nuvem,
  2026-10-29). Numa cópia com uma página estourada, a numeração errada e o
  nome interno no texto, o script apontou os três problemas, saiu com erro e
  não regravou o PDF; numa cópia com “Rascunho para revisão” no rodapé, fez o
  mesmo.
- Revisão visual página a página em capturas do HTML e do PDF rasterizado
  (`pdftoppm`), e extração do texto do PDF (`pdftotext`).
- `npm run docs:check` e `git diff --check`.

Não verificado: aparência em leitores de PDF de terceiros (Acrobat, Outlook,
celular) e impressão em papel.
