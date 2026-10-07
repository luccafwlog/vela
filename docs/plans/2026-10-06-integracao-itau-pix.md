# Integração Itaú Pix — QR dinâmico e baixa automática

**Estado:** plano aprovado para execução em 2026-10-06. Fase 0 (certificado)
aguardando a credencial dedicada pedida ao Itaú em 06/10 (ver "Quando o Itaú
responder"); Fases 1 a 4 e a tela de monitoramento da Fase 5
prontas no código (migrations 151–154), revisadas e unificadas numa PR contra
a `main`; sem publicação da função, secrets, cron nem virada.
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

## Sandbox do devportal (2026-10-06)

Enquanto a credencial dedicada não chega, o dono criou uma aplicação de sandbox
no devportal (sem certificado; credencial só de sandbox, fora do repositório).
O cliente real (`_shared/itauPix.ts`) rodou localmente contra
`https://sandbox.devportal.itau.com.br`: token em `/api/oauth/jwt`, API em
`/itau-ep9-api-regulatorio-pix-v2-externo/v2`. Observado:

- Token `client_credentials` aceito; `Bearer`, 300 s. `x-itau-apikey` não fez
  diferença no sandbox (não prova nada sobre a produção).
- `PUT /cob/{txid}` com o corpo do Vela: 201 `ATIVA`. A resposta é exemplo
  fixo (TXID `bbba96…`, não o enviado), então consulta, alteração,
  cancelamento e pagamento **não** são testáveis no sandbox.
- `calendario.expiracao` veio como texto (`"3600"`), contra o inteiro da
  especificação. O cliente passou a aceitar inteiro em texto.
- `GET /pix` recusou `inicio`/`fim` com milissegundos (400
  `PixConsultaInvalida`). O cliente passou a enviar RFC 3339 sem fração de
  segundo, arredondando `inicio` para baixo e `fim` para cima.

Nada disso substitui a Fase 1: mTLS, `sts.itau.com.br`, pagamento real,
latência e limites só se provam com a credencial de produção.

## Decisões em aberto (com padrão recomendado)

| Decisão | Padrão adotado se o dono não disser outra coisa |
|---|---|
| Baixa: consulta periódica ou webhook | Consulta (`GET /cob/{txid}` das cobranças ativas, mais varredura `GET /pix` por janela) a cada **1 minuto**, mais botão "Já paguei — verificar" no Portal e no detalhe da fatura. Webhook só se a consulta não bastar (exige mTLS de entrada com Cloudflare pago). |
| QR estático como contingência se o Itaú cair | **Não**. Sem COB confirmada, a fatura mostra "QR em preparação"; Alerta se passar de 10 min. Um QR estático pago fora da COB não teria baixa automática. |
| Recibo para baixa manual de exceção | Recibo também sai, porque é baixa verificada pelo Admin com referência bancária. "Só após pagamento confirmado" vale para qualquer baixa, não para fatura emitida. |
| Valor mínimo de teste | R$ 0,01 em fatura avulsa de teste, cliente fixture. |

## Roteiro de ativação (depois do merge do código)

Ordem única para ligar a integração. Cada passo diz quem faz, o que fazer e
como conferir. Não pule passos: se a conferência falhar, pare, registre em
"Registro" e resolva antes de seguir. O agente só executa ações em produção
(publicar função, agendar job, SQL em `app_settings`) com autorização explícita
do dono para aquele passo; segredos nunca passam pelo chat nem pelo git.

Pré-condição de **todos** os passos e de cada sessão nova:
`SELECT count(*) FROM public.app_settings WHERE id = 1` deve ser `1`. Toda a
configuração Itaú mora nessa linha, e sem ela os `UPDATE ... WHERE id = 1` dos
passos 5 e 8 e o checkpoint de recebimentos não afetam nada, sem erro. A linha
já sumiu de produção duas vezes por ação externa ao repositório (restaurada
pelas migrations `104` e `155`); desde a `156` o banco recusa `DELETE` e
`TRUNCATE` dela, inclusive em cascata de `user_profiles`. Se faltar mesmo
assim, pare e avise o dono antes de recriá-la.

1. **Credencial dedicada (Itaú → dono).** Aguardar, no thread IT-000245617,
   CLIENT ID novo e token de ativação (vale cerca de 7 dias). O agente lê a
   resposta; se o Itaú pedir outra coisa (revogação, formulário), mostra ao
   dono antes de agir. Conferir: o CLIENT ID é diferente do de julho
   (comparar por hash com a cópia guardada pelo dono fora do repositório).
2. **Certificado (dono, no terminal dele).** Fase 0, itens 1–3, com o CLIENT
   ID novo. Conferir: `openssl x509 -in itau.crt -noout -subject -enddate` e
   módulo do `.crt` igual ao do `.key`; registrar emissão e validade aqui.
   Novo `C700a` = parar e voltar ao Itaú.
3. **Segredos (dono).** Supabase → Edge Functions → Secrets: `ITAU_CLIENT_ID`,
   `ITAU_CLIENT_SECRET`, `ITAU_CERT_B64`, `ITAU_KEY_B64`, `ITAU_PIX_KEY` e
   `ITAU_PIX_ADMIN_SECRET` (≥ 32 caracteres aleatórios). O mesmo
   `ITAU_PIX_ADMIN_SECRET` também no Vault, com o mesmo nome (procedimento em
   [segredos e cron](../operations/segredos-cron.md)). Remover
   `ITAU_ONBOARDING_PRIVATE_KEY` do Vault. Conferir pelos nomes no painel e
   `SELECT count(*) FROM vault.secrets WHERE name = 'ITAU_PIX_ADMIN_SECRET'` = 1.
4. **Publicar a função (agente).**
   `supabase functions deploy itau-pix --project-ref fgmkhbzhaeebrsizwccx`
   (`verify_jwt = false` vem de `supabase/config.toml`; o acesso é pelo bearer
   próprio). Conferir: `POST` sem bearer → 403; `{"action":"token"}` com o
   bearer → `token_type` Bearer e `expires_in` perto de 300.
5. **Conta "API Itaú" (dono, depois agente).** O dono cria em `/admin` → Criar
   usuário: nome "API Itaú", perfil Administrativo, ativa, senha forte guardada
   fora do repositório; ninguém entra no Vela com ela. O agente grava o id:
   `UPDATE public.app_settings SET itau_pix_settlement_actor = '<id>' WHERE id = 1;`
   Conferir: a consulta de `itau_pix_settlement_actor` devolve o id e a conta
   está ativa.
6. **Teste de centavos (agente conduz, dono paga).** Fase 1, só com cobranças
   de teste (`VELAT…`): `create_test` de `0.01` → o dono paga pelo celular →
   `get` até `CONCLUIDA` com `pix[].endToEndId` → `list_pix` na janela do
   pagamento (o Pix aparece; `outros` diz se o banco mistura os recebimentos
   do terceiro) → noutra cobrança de teste, `update_test` (valor e validade) e
   `cancel`. Registrar em "Contrato observado" (nova seção deste plano): header
   aceito, latência entre pagamento e consulta, validade máxima aceita,
   respostas repetidas, 429 e tamanho de página. Divergência do código = PR de
   correção antes do passo 7.
7. **Agendar a fila (agente).**
   `SELECT cron.schedule('itau-pix-queue', '* * * * *', $$SELECT ops.dispatch_edge_job('itau-pix', 'ITAU_PIX_ADMIN_SECRET');$$);`
   Com a chave ainda `static`, cada execução só consulta recebimentos (os de
   teste e do terceiro são ignorados). Conferir: `cron.job_run_details` sem
   erro e, na Conciliação PIX, "Última consulta de recebimentos" avançando.
8. **Virar a chave (dono decide, agente executa).**
   `UPDATE public.app_settings SET pix_provider = 'itau' WHERE id = 1;` e, logo
   em seguida, o SQL do [manual de serviços externos](../operations/servicos-externos.md#itaú--api-pix-recebimentos)
   que dá cobrança às faturas já abertas. Conferir: em cerca de 1 minuto as
   faturas abertas mostram o QR do Itaú; uma avulsa de R$ 0,01 para cliente
   fixture, paga pelo dono, fica paga com recibo no Portal em cerca de 1
   minuto; repetir com Taxas Locais e Demurrage. Depois: atualizar módulos,
   manual e `RASTREABILIDADE.md` para "publicado" e arquivar este plano e a
   spec (Fase 5).

O roteiro `fase0.sh` citado abaixo é um auxiliar local do dono (Windows, fora
do repositório); qualquer máquina pode seguir os comandos da Fase 0 no lugar
dele. No macOS, troque `base64 -w0 arquivo` por `base64 < arquivo | tr -d '\n'`.

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
   linha: `base64 -w0 itau.crt`; no macOS `base64 < itau.crt | tr -d '\n'`) e `ITAU_PIX_KEY`.
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

**Entregue em 2026-10-06 (Código/Teste local, sem implantação):** migration
`151_itau_pix_cobrancas.sql`, processador da fila em `itau-pix` e aviso "QR
em preparação" nos documentos do Vela e no Portal. Desvios do desenho acima:

- Uma tabela só, `itau_pix_charges`, para faturas locais, avulsas e Demurrage;
  ao ativar, a cobrança local é espelhada em `local_pix_charge_versions` para
  manter o contrato de conciliação da `130`. Estender a tabela da `130` exigiria
  outra para a Demurrage.
- Os chamadores não mudaram: os dois gatilhos donos do QR (`populate_local_invoice_pix_payload`
  e o novo `zz_itau_pix_demurrage_payload`) cobrem emissão, baixa, correção,
  reemissão automática, troca de Cliente e PTAX.
- Sem disparo imediato após emitir: só o cron de 1 minuto. Com isso, o QR leva até cerca de
  1 minuto para aparecer.
- "Cancelamento pendente" não aparece na tela; fica em `itau_pix_charges` até
  a tela de monitoramento (Fase 5).
- Cron e segredo no Vault não foram criados; ver o manual de serviços externos.

Provas: replay das 148 migrations em Postgres 16 local; suíte
`itauPixCharges.local-pg.test.ts` (9 casos, inclusive emissão real por
`create_manual_invoice`, cancelamento e PTAX); suítes financeiras existentes
com as mesmas falhas locais com e sem a `151` (ambiente Windows); 14 testes
do cliente/processador e testes das telas.

### Fase 3 — Baixa automática e recibo

- Consulta das COBs ativas e varredura `GET /pix` com checkpoint e janela
  sobreposta; deduplicação por `endToEndId`.
- Núcleo de baixa de sistema reaproveitando `register_ledger_invoice_payment`
  e `register_demurrage_payment`: `endToEndId` como referência bancária,
  idempotência derivada dele, origem `itau_api`, conferência de valor/TXID/
  status. Divergência, fatura cancelada ou paga → `pix_review`, sem baixa.
- Recibo e status "paga" aparecem no Vela e no Portal só após essa baixa.
- Botão "Já paguei — verificar" chama a consulta da COB daquela fatura.

**Entregue em 2026-10-06 (Código/Teste local, sem implantação):** migration
`152_itau_pix_baixa_automatica.sql` e consulta de recebimentos em `itau-pix`.

- A cada execução do cron (depois da fila de cobranças), `GET /pix` cobre a
  janela entre o checkpoint e agora, com 10 min de sobreposição e no máximo 6 h
  por vez. Pix de TXID que não começa com `VELA` (sistema de terceiro) é
  ignorado e não é gravado; Pix de cobrança de teste (`VELAT…`) só é contado,
  sem baixa nem Alerta. O checkpoint só avança quando a janela inteira foi
  registrada.
- `itau_pix_settle` deduplica por `endToEndId` (`itau_pix_receipts`) e baixa
  pelos donos existentes: individual/consolidada por
  `reconcile_invoice_payment_by_txid`, avulsa por
  `register_verified_invoice_payment` e Demurrage por
  `register_demurrage_payment`. O `endToEndId` é a referência bancária da baixa.
- Desvio: a origem não é `itau_api` no ledger. A restrição de
  `ledger_settlements.source` não foi alterada; a baixa local fica como
  conciliação por TXID e a origem Itaú aparece na referência bancária e nas
  notas do pagamento.
- Desvio: sem tipo novo `pix_review`. A recusa usa o Alerta existente
  `pix_unreconciled` (Administrativo → Conciliação PIX), com motivo.
- Baixa local exige `app_settings.itau_pix_settlement_actor`: a conta Admin
  dedicada "API Itaú", criada pelo dono, que aparece como autora das baixas
  automáticas (decisão de 2026-10-06). Sem ela, todo Pix vai para análise.
- Erro passageiro do banco (conflito, lock, timeout, conexão) não vira
  análise: a chamada falha e a próxima consulta tenta de novo.
- Sem botão "Já paguei" (confirmado pelo dono em 2026-10-06). O detalhe da fatura aberto no Portal se
  atualiza a cada 20 s enquanto ela for pagável; com o cron de 1 min, a baixa
  e o recibo aparecem em cerca de 1 min sem ação do cliente.
- O recibo continua sendo o existente: só aparece com a fatura paga.

Provas: suíte `itauPixCharges.local-pg.test.ts` com 12 casos (avulsa,
Demurrage, sem usuário de baixa, TXID desconhecido, repetição, permissões);
caso `152` em `invoicePostBillingSafety.local-pg.test.ts` para fatura
individual emitida por CE (valor divergente vai para análise, valor certo
baixa uma vez com o `endToEndId`). Esse caso foi sabotado para confirmar que
executa. Mais 17 testes do cliente, processador e consulta.

### Fase 4 — Regras de Demurrage e Taxas Locais

PTAX no mesmo TXID, corte 14h30 com calendário, nova COB após o corte,
Alerta das 14h, renovação de Taxas Locais, cancelamento com retentativa,
pagamento concorrente ao cancelamento. Cenários da PR 827 reaproveitados como
roteiro de teste.

**Entregue em 2026-10-06 (Código/Teste local, sem implantação):** migration
`153_itau_pix_prazos_e_ptax.sql`; `itau-pix` roda `itau_pix_maintain` antes
da fila e passou a enviar PATCH e a confirmar vencimentos.

- **Calendário:** `business_holidays` com Vitória/ES 2026–2027 (dados da PR
  827). `itau_pix_cutoff` dá 14h30 do próximo dia útil. Ano sem calendário conta
  só fins de semana (decisão do dono em 2026-10-06: a integração não para), e
  a partir de 1º/11 o Alerta `calendario_feriados_pendente` pede o cadastro do
  ano seguinte.
- **Demurrage:** PTAX nova ou prazo novo alteram a mesma cobrança (PATCH,
  mesmo TXID, validade até o próximo corte). O QR segue visível durante a
  alteração. Quando o ROE não muda, a manutenção estende a validade se a
  fatura já reflete a PTAX de hoje.
- **Vencimento:** passada a validade, a cobrança é consultada no banco. Se
  não foi paga, vira `expired` e a fatura ganha nova cobrança com novo TXID.
  Se foi paga, fica `concluded` e segue para a baixa.
- **Revisão anterior:** a baixa de Demurrage deixou de exigir o valor exato da
  cobrança; `register_demurrage_payment` confere as duas últimas fotos de PTAX.
  Pix da revisão anterior pago durante a troca quita pelo valor pago.
- **Taxas Locais:** a cobrança ativa é renovada no mesmo TXID quando faltam 7
  dias, por mais `itau_pix_expiration_seconds` (30 dias). O limite máximo do
  Itaú ainda será conferido no teste de centavos.
- **Alerta das 14h:** em dia útil, Demurrage aberta sem a PTAX de hoje
  confirmada na cobrança abre `demurrage_ptax_recalc_failed` (Documentação,
  entidade `itau-pix-14h`); fecha quando tudo estiver refletido.
- Desvio: o Alerta das 14h reaproveita o tipo existente da Documentação
  (`demurrage_ptax_recalc_failed`). O plano da PR 827 previa um tipo novo para
  Equipamentos. O do calendário tem tipo próprio.
- Limite: depois do corte sem PTAX do dia, a nova cobrança sai com o último
  valor disponível e o Alerta continua aberto. A Demurrage depende do job
  `recalc-demurrage-ptax` agendado.

Provas: suíte `itauPixCharges.local-pg.test.ts` com 16 casos (corte e
feriados, PTAX no mesmo TXID, Pix da revisão anterior, vencimento confirmado e
substituição, renovação local, Alerta das 14h, permissões), repetida duas
vezes no mesmo banco. Mais 19 testes do processador. Suítes financeiras com
`151`–`153`: as mesmas 21 falhas locais de ambiente, nome a nome.

### Fase 5 — Virada e encerramento

Virar `pix_provider` para `itau` em produção; R$ 0,01 de ponta a ponta em cada
tipo de fatura; Conciliação PIX como monitoramento; atualizar
`faturamento.md`, `reconciliacao-pix.md`, `demurrage.md`, manual de serviços
externos e `RASTREABILIDADE.md`; fechar a PR 827; arquivar este plano e a spec.

**Tela de monitoramento entregue em 2026-10-06 (código, sem publicação).**
`154_itau_pix_monitoramento.sql` cria `itau_pix_monitor` (só Admin, só
leitura) e a Conciliação PIX abre com o bloco "Cobranças Pix Itaú": chave
ligada ou não, última consulta de recebimentos, cobranças ativas e a lista do
que pede atenção (aguardando o banco, cancelamento pendente, resposta incerta,
erro) mais Pix recebidos em análise. Pix em análise fecha sozinho quando a
fatura fica paga; nos demais casos o Admin marca como tratado com motivo
(`itau_pix_mark_receipt_handled`). Nos dois casos o Alerta fecha. Provas: suíte
`itauPixCharges.local-pg.test.ts` com 17 casos (Admin lê cancelamento
pendente; outro perfil recebe recusa), repetida duas vezes; teste de
comportamento da página.

Falta da Fase 5, tudo dependente da credencial: os passos 1–8 do
[Roteiro de ativação](#roteiro-de-ativação-depois-do-merge-do-código) e, ao
fim, arquivar este plano e a spec. A PR 827 já foi fechada.

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
| 2026-10-06 | Fase 1 implementada no código (função `itau-pix`, não publicada). Incidente: um teste local do roteiro chamou o CLI real e gravou 6 secrets `ITAU_*` com valores fictícios no projeto de produção (13:28 UTC); removidos em seguida com `supabase secrets unset` e a ausência foi conferida (34 secrets, nenhum `ITAU_*`). Nenhuma função lia esses nomes. |
| 2026-10-06 | Revisão da Fase 1: dono decide que a cobrança de uma fatura só muda pela própria fatura no Vela. As ações de diagnóstico de `itau-pix` passam a alterar e cancelar só cobranças de teste (`VELAT…`; as de fatura são `VELA` + hexadecimal, que nunca tem `T`), e `list_pix` devolve só os Pix do Vela, sem `infoPagador`, com a contagem dos demais. |
| 2026-10-06 | Revisão da Fase 2. Dono decide: na virada, todas as faturas abertas ganham cobrança Itaú (só há 2 faturas, ambas de teste; procedimento no manual de serviços externos); voltar para `static` não é procedimento operacional. Correções: cancelamento repetido consulta a cobrança antes de pedir de novo; aviso "QR em preparação" da Demurrage só para fatura emitida ou vencida. Com autorização do dono para editar as migrations 150–153 da pilha (não aplicadas em nenhum ambiente), o pedido de cancelamento deixa de encurtar a reserva de uma chamada em andamento. |
| 2026-10-06 | Revisão da Fase 3. Dono confirma: sem botão "Já paguei", só a atualização automática do Portal; baixas automáticas assinadas por conta Admin dedicada "API Itaú", criada pelo dono. Correção: erro passageiro do banco na baixa falha a chamada para nova tentativa, em vez de mandar o Pix para análise. |
| 2026-10-06 | Revisão da Fase 4. Dono decide: sem calendário cadastrado, a integração segue contando só fins de semana. Correções: Alerta próprio `calendario_feriados_pendente` (fecha ao cadastrar o ano); alteração repetida consulta a cobrança antes de novo PATCH. |
| 2026-10-06 | Revisão da Fase 5. Dono aprova: Pix em análise fecha sozinho quando a fatura da cobrança fica paga e, nos demais casos, Admin marca como tratado com motivo (fecha o Alerta). Correção: "pedem atenção" lista só cobranças que aguardam o banco. |
| 2026-10-06 | Revisão das PRs 861–867 concluída e PR 827 fechada. As seis PRs foram unificadas numa só contra a `main`; as migrations da pilha foram renumeradas de 150–153 para 151–154, porque a `main` recebeu `150_importacao_bl_flags_baplie_so_do_lote.sql`. As menções a 150–153 nas linhas anteriores deste registro referem-se à numeração antiga. |
| 2026-10-07 | PR 870 mergeada; migrations 151–154 aplicadas em produção (conferido em `supabase_migrations.schema_migrations`, 26 feriados e o tipo `calendario_feriados_pendente` presentes). Na mesma conferência, `app_settings` estava sem a linha `id = 1`, apesar da `104`; a migration `155` a restaura e o Roteiro de ativação ganhou essa pré-condição. Origem da remoção não identificada no repositório. |
| 2026-10-07 | Origem da remoção de `app_settings` não identificada (logs de 24 h só registram DDL; nada no repositório apaga a linha). Migration `156`: gatilhos recusam `DELETE` e `TRUNCATE` do singleton, inclusive em cascata de `user_profiles`, para que a próxima tentativa falhe com erro visível. |
