# Integração Itaú Pix — QR dinâmico e baixa automática

**Estado:** plano aprovado para execução em 2026-10-06. Fase 0 (certificado)
aguardando a credencial dedicada pedida ao Itaú em 06/10 (ver "Quando o Itaú
responder"); Fase 1 em andamento.
**Substitui:** a PR 827 (`codex/itau-pix-simulation`) como caminho de entrega.
Os planos daquela branch nunca chegaram à `main`; o que vale deles está
incorporado aqui.
**Spec de origem:** [integração Itaú Pix](../spec/2026-08-25-integracao-itau-pix.md).

## Resultado esperado

Toda fatura do Vela (Taxas Locais individual/consolidada, avulsa e Demurrage)
é cobrada por uma COB dinâmica do Itaú. O cliente paga o QR no app do banco;
o Vela identifica o pagamento pela API, dá a baixa pelos comandos financeiros
existentes e só então libera o recibo. O QR estático (`build_transshipping_pix_payload`
e `src/lib/pix.ts`) deixa de ser o meio de cobrança.

## O que chegou do Itaú em 2026-10-06 (protocolo IT-000245617)

Evidência documental: e-mail "RES: Manual e Boas Vindas - PIX - IT-000245617",
planilha "Credencial e Token.xlsx" e três PDFs ("Obter Certificado e Solicitar
Access Token", "Webhook PIX Recebimentos QrCode", "Guia de Navegação Itaú for
Developers"). Arquivos fora do repositório; nenhum valor sensível aqui.

- **Credenciais produtivas** emitidas para o CNPJ 06.352.972/0001-21: planilha
  com CLIENT ID (UUID) e TOKEN (JWT de ativação), validade **13/10/2026 08:44**.
  O token já vem decifrado.
- **Não houve envio de chave pública.** O fluxo da PR 827 que previa enviar
  `public.pem` e decifrar client_id/token com chave de sessão não se aplicou.
  A privada de onboarding guardada no Vault (`ITAU_ONBOARDING_PRIVATE_KEY`)
  não tem uso e deve ser removida pelo dono.
- O token de 7 dias serve **uma vez** para trocar um CSR por certificado
  (validade 365 dias) + client_secret, em
  `POST https://sts.itau.com.br/seguranca/v1/certificado/solicitacao`.
- Depois: OAuth `client_credentials` com mTLS em
  `https://sts.itau.com.br/api/oauth/token`, access_token de 5 minutos,
  enviado como `Authorization: Bearer`.
- Produto: API PIX Recebimentos (`itau-ep9-api-regulatorio-pix-v2-externo`),
  já em **produção** — não há homologação com estado para esta conta.
- Pré-requisito: chave Pix cadastrada no Itaú na conta 0870/37293-5. O QR
  estático atual usa a chave CNPJ `06352972000121`; confirmar que é dessa conta.
- Webhook (opcional): URL cadastrada **sem** o sufixo `/pix`, o Itaú chama
  `<url>/pix`; exige mTLS de entrada com a CA do Itaú e resposta em até 5 s.
- O e-mail não respondeu à pergunta sobre limites de frequência das consultas.

## Diagnóstico da PR 827 contra a `main` atual

A PR é rascunho de 2026-09-30, construída sobre um **simulador** e com a
migration `114`. Desde então a `main` recebeu 122–149, várias no fluxo
financeiro. Conflitos encontrados:

| # | Conflito | Consequência |
|---|---|---|
| 1 | `114_itau_pix_simulation.sql` redefine `_portal_invoice_details_core`, que a `main` reescreveu em `124` e `136` | Aplicar a 114 hoje (ou renumerada) reverteria correções e restituições no Portal. Não aproveitável como está. |
| 2 | Numeração `114` fora de ordem (a `main` está em `149`) | Precisa nova migration ≥ `150`, escrita sobre as definições atuais. |
| 3 | TXID: a `130` gera TXIDs de até **25** caracteres (limite do QR estático); COB com TXID próprio exige **26–35** alfanuméricos | Gerar TXID próprio para a COB; o resolvedor da `130` normaliza para maiúsculas, então usar só `[A-Z0-9]`. |
| 4 | A `130` já criou `local_pix_charge_versions`: cada saldo pagável tem sua cobrança, TXID e valor, e `reconcile_invoice_payment_by_txid` resolve por ela | A PR cria `pix_charges` paralelo. Para faturas locais, registrar a COB **nessa** tabela e reaproveitar o resolvedor; não criar segundo modelo. |
| 5 | A `136` exige referência bancária e idempotência (`financial_payment_attempts`) e restringe as baixas a usuário Admin (`auth.uid()`) | A baixa automática precisa de um núcleo sem sessão (ator de sistema) que use `endToEndId` como referência bancária e chave de idempotência. |
| 6 | `122`/`126`/`128`: cancelamento e reemissão **automáticos** por correção do B/L e troca de Cliente | Cada cancelamento precisa cancelar a COB no Itaú, e cada reemissão criar outra — volume automático, não só ação de usuário. |
| 7 | `136`: restituições com evidência | Devolução Pix pela API fica fora; restituição segue manual com comprovante. |
| 8 | PR assume simulação e bloqueia o projeto produtivo | O dono autorizou testes reais de centavos; a prova passa a ser em produção com fatura de teste (dados descartáveis, ver `AGENTS.md`). O simulador sai. |

**Decisão:** não editar a PR 827. Abrir PRs novas a partir da `main` e fechar a
827 como referência quando a Fase 2 for aberta. Aproveitar dela:
`supabase/functions/_shared/itauPixTransport.ts` (com host configurável e
validação de resposta), calendário de feriados de Vitória/ES 2026–2027, a
regra de corte das 14h30, os tipos de Alerta `pix_review` e
`pix_ptax_pending` e o roteiro de cenários. Descartar: tabelas e RPCs de
simulação, `itau-pix-simulation`, `PixSimulationNotice` e `usePixSimulationRefresh`.

Nada na `main` contradiz a integração; os pontos 3–6 são adaptações
obrigatórias. O ponto de atenção de negócio é a baixa manual da `136`: com o
Itaú, ela vira **exceção** (TED, depósito, pagamento fora do QR), não some.

## Convivência com o sistema de terceiro (decisão de 2026-10-06)

O sistema de terceiro ativado em julho continua em uso na mesma conta e na
mesma chave Pix. O Vela terá credencial própria; não revogar o certificado
dele. Consequências:

- `GET /pix` por período pode trazer recebimentos do terceiro. O Vela só
  baixa TXID criado por ele; TXID desconhecido é ignorado, sem `pix_review`.
- TXIDs do Vela levam prefixo fixo próprio (ex.: `VELA`), dentro de 26–35
  caracteres `[A-Z0-9]`, para não colidir com os do terceiro.
- Webhook é um por chave Pix: cadastrar o do Vela derrubaria o do terceiro.
  A Fase 6 só é possível com outra chave Pix ou acordo com o terceiro.

## Regras de cobrança (aprovadas em 2026-09-30, mantidas)

- Demurrage: uma COB ativa por fatura; nova PTAX altera a **mesma** COB
  (mesmo TXID, nova revisão). Corte às 14h30 do próximo dia útil em
  Vitória/ES (sexta → segunda; feriados nacionais e municipais). Depois do
  corte, a mesma fatura recebe nova COB com a PTAX do dia. Alerta às 14h se a
  PTAX do dia não estiver refletida.
- Pagamento aceito durante troca de PTAX quita pelo valor da revisão paga.
- Taxas Locais: COB pagável enquanto a fatura estiver aberta; renovar a
  expiração na mesma COB quando possível. Saldo novo (baixa parcial,
  correção) = nova COB, novo TXID — coerente com a `130`.
- Cancelar fatura = solicitar remoção da COB; mostrar "cancelamento pendente"
  até a confirmação. Pagamento que chegar antes é preservado para análise
  (`pix_review`), sem devolução automática.
- Resposta incerta do Itaú (timeout, 5xx) nunca vira sucesso nem nova emissão:
  consultar antes de repetir; incerteza gera Alerta.
- Conciliação PIX vira tela de monitoramento; baixa manual é exceção.

## Decisões em aberto (com padrão recomendado)

| Decisão | Padrão adotado se o dono não disser outra coisa |
|---|---|
| Baixa: consulta periódica ou webhook | Consulta (`GET /cob/{txid}` das cobranças ativas, mais varredura `GET /pix` por janela) a cada **1 minuto**, mais botão "Já paguei — verificar" no Portal e no detalhe da fatura. Webhook só se a consulta não bastar (exige mTLS de entrada com Cloudflare pago). |
| QR estático como contingência se o Itaú cair | **Não**. Sem COB confirmada, a fatura mostra "QR em preparação"; Alerta se passar de 10 min. Um QR estático pago fora da COB não teria baixa automática. |
| Recibo para baixa manual de exceção | Recibo também sai, porque é baixa verificada pelo Admin com referência bancária. "Só após pagamento confirmado" vale para qualquer baixa, não para fatura emitida. |
| Valor mínimo de teste | R$ 0,01 em fatura avulsa de teste, cliente fixture. |

## Fases

Cada fase fecha com evidência rotulada (Código / Teste / Runtime) e fica em
PR própria quando tocar código.

### Quando o Itaú responder

O dono só precisa avisar "o Itaú respondeu" e indicar o `.eml`. O resto é
conduzido pelo agente:

1. Extrair corpo e anexos do `.eml` numa pasta temporária e ler a resposta.
   Conferir se veio CLIENT ID novo, comparando por hash com
   `C:\Users\Lucca\.itau\IT-000245617\2026-10-06\client_id.txt`. Se o Itaú
   pedir outra coisa (revogação, formulário), mostrar ao dono antes de agir.
2. `bash C:\Users\Lucca\.itau\fase0.sh 0-nova <planilha.xlsx>`: cria
   `C:\Users\Lucca\.itau\IT-000245617\<data>` e copia a planilha e o roteiro.
   O roteiro aceita cabeçalho `CLIENT ID` ou `CREDENCIAL`.
3. O dono roda as etapas `1-preparar` a `7-limpar` no terminal dele, uma por
   vez; o agente lê só as saídas mascaradas. O token vale cerca de 7 dias.

### Fase 0 — Certificado e segredos (dono)

O roteiro `C:\Users\Lucca\.itau\fase0.sh` (fora do repositório) automatiza
os passos abaixo sem imprimir segredos; a lista documenta o que ele faz.

Sem o certificado nada do resto roda em produção. Executar em Git Bash, numa
pasta fora do repositório (ex.: `C:\Users\Lucca\.itau\IT-000245617\2026-10-06`).

1. Gerar chave e CSR com `CN=<CLIENT ID da planilha>`:
   `MSYS_NO_PATHCONV=1 openssl req -new -newkey rsa:2048 -nodes -sha512 -keyout itau.key -out itau.csr -subj "/CN=<CLIENT_ID>/OU=Transhipping Agenciamento Maritimo/L=Vitoria/ST=ES/C=BR"`
   (OpenSSL 3.5.6 disponível nesta máquina.)
2. Enviar o CSR com o token da planilha, **sem `-k`** (TLS validado):
   `curl -sS -X POST https://sts.itau.com.br/seguranca/v1/certificado/solicitacao -H "Content-Type: text/plain" -H "Authorization: Bearer $(cat token.txt)" --data-binary @itau.csr -o resposta.txt`
3. Separar a resposta: 1ª linha = client_secret (`client_secret.txt`); o
   restante, do `BEGIN` ao `END`, = `itau.crt`. Conferir:
   `openssl x509 -in itau.crt -noout -subject -enddate` e que o módulo do
   `.crt` é igual ao do `.key`.
4. Cadastrar em Supabase → Edge Functions → Secrets (via painel ou
   `supabase secrets set --env-file`, nunca em chat/git): `ITAU_CLIENT_ID`,
   `ITAU_CLIENT_SECRET`, `ITAU_CERT_B64`, `ITAU_KEY_B64` (PEM em base64 numa
   linha: `base64 -w0 itau.crt`) e `ITAU_PIX_KEY`.
5. Guardar cópia de `itau.key`, `itau.crt` e client_secret no iCloud Senhas.
   Apagar `token.txt` depois do uso. Remover `ITAU_ONBOARDING_PRIVATE_KEY` do Vault.
6. Lembrete de renovação: certificado vence em 365 dias; renovar 30 dias
   antes por `/seguranca/v1/certificado/renovacao`.

Prova: data de emissão e validade do `.crt` registradas aqui; secrets listados
pelo nome no painel. Se o token vencer antes, pedir outro no mesmo thread.

### Fase 1 — Prova real de centavos (sem tocar faturas)

Edge Function `itau-pix` (nova), protegida por segredo próprio, sem acesso do
navegador, com ações de diagnóstico: obter token; `PUT /cob/{txid}` de
R$ 0,01; `GET /cob/{txid}`; `PATCH` (valor/expiração e remoção);
`GET /pix?inicio&fim`. Reaproveita o transporte da PR 827.

Roteiro com o dono: criar COB de R$ 0,01 → dono paga pelo celular → consultar
até `CONCLUIDA` com `pix[].endToEndId` → conferir a mesma transação no
`GET /pix` por janela → testar `PATCH` de valor em COB ativa e remoção.
Medir: header aceito (`Authorization` vs `auth`), latência entre pagamento e
consulta, expiração máxima aceita, resposta a chamadas repetidas e limites
(429). Resultado vira a seção "Contrato observado" deste plano.

### Fase 2 — Emissão da COB nas faturas

Migration `150+` sobre as definições atuais (não reaproveitar o corpo da 114):

- Faturas locais: estender `local_pix_charge_versions` com provedor, status
  Itaú, revisão, expiração e `pixCopiaECola`; Demurrage ganha o equivalente
  ligado a `demurrage_invoices`.
- Fila de trabalho (outbox) gravada na **mesma transação** que emite,
  cancela, altera saldo ou PTAX — incluindo os caminhos automáticos de
  `126`/`128` e a troca de Cliente da `136`.
- Configuração `pix_provider` (`static` | `itau`) para virar a chave na hora
  certa; enquanto `static`, nada muda.
- `itau-pix` processa a fila fora da transação (cron de 1 minuto +
  disparo imediato após emitir), confirma o resultado e grava o QR.
- Vela e Portal exibem o `pixCopiaECola`/QR da COB; "QR em preparação"
  enquanto pendente; cancelamento pendente visível. Invalidação pelos efeitos
  de cache existentes.

### Fase 3 — Baixa automática e recibo

- Consulta das COBs ativas e varredura `GET /pix` com checkpoint e janela
  sobreposta; deduplicação por `endToEndId`.
- Núcleo de baixa de sistema reaproveitando `register_ledger_invoice_payment`
  e `register_demurrage_payment`: `endToEndId` como referência bancária,
  idempotência derivada dele, origem `itau_api`, conferência de valor/TXID/
  status. Divergência, fatura cancelada ou paga → `pix_review`, sem baixa.
- Recibo e status "paga" aparecem no Vela e no Portal só após essa baixa.
- Botão "Já paguei — verificar" chama a consulta da COB daquela fatura.

### Fase 4 — Regras de Demurrage e Taxas Locais

PTAX no mesmo TXID, corte 14h30 com calendário, nova COB após o corte,
Alerta das 14h, renovação de Taxas Locais, cancelamento com retentativa,
pagamento concorrente ao cancelamento. Cenários da PR 827 reaproveitados como
roteiro de teste.

### Fase 5 — Virada e encerramento

Virar `pix_provider` para `itau` em produção; R$ 0,01 de ponta a ponta em cada
tipo de fatura; Conciliação PIX como monitoramento; atualizar
`faturamento.md`, `reconciliacao-pix.md`, `demurrage.md`, manual de serviços
externos e `RASTREABILIDADE.md`; fechar a PR 827; arquivar este plano e a spec.

### Fase 6 (opcional) — Webhook

Só se a consulta de 1 minuto não atender. Desenho já avaliado: host dedicado
com mTLS de entrada (Cloudflare Access pago) → Edge Function → mesma fila.

## Checks por fase de código

`npm run docs:check`, `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`, `npm run migrations:check`, `npm run rpc:check`,
`git diff --check`; replay da migration em Postgres controlado. Teste de texto
SQL não prova execução nem RLS; a prova de pagamento é o teste de centavos.

## Registro

| Data | Evento |
|---|---|
| 2026-10-02 | Dono pergunta ao Itaú sobre certificado existente, envio de chave pública e limites de consulta. |
| 2026-10-06 | Itaú envia credenciais produtivas, token de ativação (vence 13/10 08:44) e guias. Sem envio de chave pública. Plano criado; PR 827 declarada defasada. |
| 2026-10-06 | Envio do CSR recusado: HTTP 409, `C700a`, "O certificado ainda está válido. A emissão de um novo não é permitida." O CLIENT ID é o mesmo da credencial de julho (IT-000205325, comparado por hash). A coleção do fornecedor anterior contém CSRs com esse CN, então o certificado vigente foi emitido em julho pelo terceiro; a afirmação da PR 827 de que o token de julho expirou sem uso estava errada. Chave e certificado vigentes não estão com o Vela. Fase 0 bloqueada até o Itaú liberar uma nova emissão. Chave e CSR gerados hoje foram mantidos e o token não foi reenviado. |
| 2026-10-06 | Dono confirma que o sistema de terceiro segue em uso. Decisão: pedir ao Itaú uma credencial nova, dedicada ao Vela, sem revogar a atual. Chave e CSR de hoje (CN do CLIENT ID antigo) ficam arquivados e sem uso. |
| 2026-10-06 | Dono responde no thread IT-000245617 pedindo a credencial dedicada, sem revogar a atual. Também pergunta se as duas credenciais convivem na mesma chave, se `GET /pix` mistura os recebimentos e quais os limites de consulta. Aguardando o Itaú. |
