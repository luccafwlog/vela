# Guia do Portal do Cliente Fwlog (onboarding)

**Rascunho para revisão.** Não envie a clientes antes de aprovar o material e
resolver os [pontos a confirmar](#pontos-a-confirmar).

Material para o cliente final do Portal do Cliente (`portalfwlog.com.br`):
um guia ilustrado em A4 e os textos dos e-mails que o acompanham. O cliente
não vê o nome do sistema interno; o guia fala só em Fwlog e Portal do
Cliente. Nada aqui é importado por `src/` nem muda o Portal.

## Arquivos

| Arquivo | O que é |
|---|---|
| [Tutorial_Portal_Fwlog.html](Tutorial_Portal_Fwlog.html) | Fonte do guia: 13 páginas A4 prontas para impressão. Abra a partir desta pasta do repositório, porque as fontes e as logos vêm de `public/`. |
| [Tutorial_Portal_Fwlog.pdf](Tutorial_Portal_Fwlog.pdf) | O guia em PDF, para anexar ao e-mail ou imprimir. É gerado a partir do HTML. |
| [gerar-pdf.mjs](gerar-pdf.mjs) | Gera o PDF e recusa página que transborda o A4, fonte ou logo que não carregou, rodapé ou numeração errada e qualquer menção ao sistema interno. |

As dicas que poderiam aparecer dentro do Portal estão numa spec à parte, porque
specs só moram em `docs/spec/`:
[dicas contextuais do Portal](../../docs/spec/2026-10-28-dicas-contextuais-portal-design.md).

### O que o guia cobre

| Página | Assunto |
|---|---|
| 1 | Capa, com o marco do navio Green Guangzhou V.6 |
| 2 | Boas-vindas, menu do Portal, sumário e como ler os passos |
| 3 | Primeiro acesso pelo convite (48 horas, uso único, reenvio) |
| 4 | Entrar com CNPJ e senha; Esqueci minha senha |
| 5 | Painel e Chegadas e saídas |
| 6 | BLs e Containers (só o próprio CNPJ, B/L depois do CE) |
| 7 | Desbloqueio de CE Mercante, marcado **[A confirmar se já liberado comercialmente]** |
| 8 | Faturas (só emitidas), consolidada e impressão |
| 9 | Pix: QR, “em preparação”, baixa automática e quando mandar comprovante |
| 10 | Demurrage (US$ fixo, R$ pelo câmbio do dia) e disputa |
| 11 | Central de Informações e os e-mails que o cliente recebe |
| 12 | Meu perfil: caixas de comunicados, endereço e e-mail de recuperação |
| 13 | Contatos, o que o cliente não faz no Portal e checklist inicial |

Cada passo segue **Onde → Ação → Efeito**. As telas são desenhos
esquemáticos, não capturas. Os dados são fictícios: Exemplo Comércio Ltda.,
CNPJ `12.***.***/0001-90`, B/L `AURU1234567`, fatura `TX-2026-00421` de
R$ 1.250,00. Também são fictícios os containers `EXMU…`, o CE
`152605001234567`, a Invoice `DEM-2026-0057`, o câmbio 5,8575, os e-mails
`@exemplo.com.br` e a conversa da disputa. O QR Code do desenho é um padrão
decorativo, sem dados: nenhum app de banco o lê.

## Gerar o PDF

Depois de mudar o HTML, rode na raiz do repositório:

```bash
node artifacts/portal-onboarding-cliente/gerar-pdf.mjs
```

Usa o Playwright das dependências de desenvolvimento (`npm ci` antes, se a
pasta `node_modules` não existir). Sem o navegador do Playwright instalado,
aponte outro Chromium em `PDF_BROWSER_EXECUTABLE_PATH`, como os scripts de
`scripts/perf/` fazem com `PERF_BROWSER_EXECUTABLE_PATH`. O PDF só é gravado se
todas as conferências passarem. A DM Sans é uma fonte variável e entra no PDF como Type 3: o texto
continua selecionável e pesquisável, mas alguns leitores antigos desenham a
letra com menos nitidez em tela.

## Textos prontos para e-mail

São mensagens enviadas pela equipe, à mão, a partir de uma caixa da Fwlog.
O convite de acesso **não** é um destes textos: ele sai do sistema, sozinho,
para o e-mail de recuperação do CNPJ, com o assunto “Ative o acesso da
&lt;razão social&gt; ao Portal do Cliente”.

### 1. Comunicado do novo Portal (anexar o PDF)

**Assunto:** Novo Portal do Cliente Fwlog a partir do Green Guangzhou V.6

> Prezado cliente,
>
> A partir do navio Green Guangzhou V.6, com previsão de chegada em Vitória em
> 06/11/2026, os processos da sua empresa passam a ser acompanhados no novo
> Portal do Cliente Fwlog: portalfwlog.com.br.
>
> No Portal, você:
>
> - consulta as faturas emitidas de Taxas Locais e Demurrage e paga por Pix,
>   com baixa automática, sem precisar enviar comprovante;
> - acompanha os B/Ls da sua empresa, os containers, a devolução e o free time;
> - pede o desbloqueio do CE Mercante; **[A confirmar se já liberado comercialmente]**
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
| B/L só aparece com CE Mercante | [Regras de negócio § Gate de CE Mercante no Portal](../../docs/operations/regras-de-negocio.md#gate-de-ce-mercante-no-portal) |
| Desbloqueio de CE: quatro requisitos, prazo, até 100 B/Ls | [Desbloqueio de CE](../../docs/modules/desbloqueio-ce.md) |
| Demurrage: US$ fixo, R$ pelo câmbio até o pagamento, Régua pausada na disputa, anexos | [Demurrage](../../docs/modules/demurrage.md) e a tabela de disputa em [Portal do Cliente](../../docs/modules/portal-cliente.md) |
| Datas de Chegadas e saídas | `src/components/portal/ShipScheduleWidget.tsx`, `src/components/portal/shipScheduleCells.ts` |
| Caixas de comunicados | `src/services/customerCommunicationBoxes.ts` |
| Endereços de contato | `src/config/portalUrl.ts` (suporte), `src/services/customerCommunicationTemplates.ts` (importação e Demurrage) e os quatro endereços do pedido |
| Número da Invoice de Demurrage (`DEM-AAAA-NNNN`) | migration `294` |

O navio Green Guangzhou V.6 e a data 06/11/2026 vêm do pedido; o repositório
não tem esse navio.

## Pontos a confirmar

1. **Desbloqueio de CE para o cliente.** O módulo está publicado em produção,
   mas o pedido pede marcar se já está liberado comercialmente. A marca aparece
   no sumário, na página 7 e no comunicado. Retire as três marcas, ou a página
   inteira, conforme a decisão.
2. **Para onde vai o comprovante** de TED, depósito ou Pix feito fora da
   cobrança do Portal (páginas 9 e 13). O sistema não recebe comprovante pelo
   Portal. Proposta: `importacao@fwlog.com.br` para Taxas Locais e
   `eqp@fwlog.com.br` para Demurrage.
3. **Nome do recebedor** que o app do banco mostra no Pix (página 9).
4. **Processos anteriores ao Green Guangzhou V.6.** O guia não diz onde o
   cliente acompanha os navios anteriores.
5. **“Transhipping, titular da cobrança”** (página 8): confirmar se essa é a
   frase para o cliente sobre a marca dos documentos impressos.
6. **Quem envia o comunicado** e de qual caixa, e se o guia vai anexo ou por
   link.
7. **Aprovação visual** do responsável, como pede a identidade visual para
   material novo.

## Verificação feita

- `node artifacts/portal-onboarding-cliente/gerar-pdf.mjs`: 13 páginas, sem
  transbordo, fontes e logos carregadas, rodapé e numeração certos em todas,
  sem menção ao sistema interno (**Runtime**, Playwright 1.64.1 do repositório
  com o Chromium 1243 do ambiente de nuvem, 2026-10-28). Numa cópia com uma
  página estourada, a numeração errada e o nome interno no texto, o script
  apontou os três problemas, saiu com erro e não regravou o PDF.
- Revisão visual página a página em capturas do HTML e do PDF rasterizado
  (`pdftoppm`), e extração do texto do PDF (`pdftotext`).
- `npm run docs:check` e `git diff --check`.

Não verificado: aparência em leitores de PDF de terceiros (Acrobat, Outlook,
celular) e impressão em papel.
