# Onboarding Itaú Pix — estado da integração (código + processo)

**Atualizado em:** 2026-10-01.
**Propósito:** dar a qualquer agente que abrir a PR 827 o estado atual do
processo com o Itaú em paralelo ao código. Os planos existentes descrevem o
passo a passo; este documento diz onde a bola está parada e quem é o dono de
cada trava.
**Regra:** nenhum valor sensível (tokens, segredos, certificados, chaves
privadas) entra neste documento — só metadados. E-mails, anexos e credenciais
ficam fora do repo, na pasta local do dono; nunca versionar.

## TL;DR

- **Código (PR 827):** simulação completa de cobranças Pix; transporte real
  (`supabase/functions/_shared/itauPixTransport.ts`) implementado para a
  "Regulatório Pix v2" mas isolado e desconectado por desenho. Nada aqui
  movimenta dinheiro de verdade.
- **Itaú:** protocolo novo **IT-000245617** recebido em 2026-10-01 (e-mail de
  boas-vindas + e-mail de tracking). Cadastro da empresa pendente — depende de
  resposta ao e-mail de boas-vindas.
- **Certificados:** portal do desenvolvedor só permite consulta (nada em
  homologação/produção); a "nova experiência" de gestão de
  certificados/credenciais foi oferecida em modal numa sessão autenticada em
  2026-10-01 e dispensada; o acesso depende do time comercial do Itaú.

## Linha do tempo

| Data | Evento |
|---|---|
| 2026-07-07 | E-mail de boas-vindas, protocolo IT-000205325: credenciais produtivas + token temporário de 7 dias. Prazo expirou sem uso; protocolo substituído. |
| 2026-09-30 | Sessão autenticada no portal do desenvolvedor Itaú: o produto "Recebimentos Pix" é a API `itau-ep9-api-regulatorio-pix-v2-externo` (v2.27.2); base de produção `https://pix-pj.api.itau.com/regulatorio-pix/v2`; modelo antigo (`secure.api.itau.com.br/pix_recebimentos/v2`) em desativação. Telas de Certificados/Credenciais: só consulta, com mensagem orientando contatar o time comercial para a "nova experiência". |
| 2026-10-01 | E-mail de boas-vindas novo, protocolo **IT-000245617** (Implantação Técnica), produto API PIX DE RECEBIMENTOS, conta 0870/37293-5. Exige contato por e-mail para o cadastro da empresa; manter o assunto e responder no mesmo thread. |
| 2026-10-01 | E-mail automático de tracking (Cadastro Técnico Cash): solicitação recebida, em análise, mesmo protocolo. Automático — não responder. |
| 2026-10-01 | Artefatos da integração anterior do fornecedor decodificados: CSRs com CN = identificador-cliente (UUID idêntico ao `sub` dos tokens e ao campo "CREDENCIAL" da planilha); o guia em anexo confirma `CN=CLIENT_ID` no subject do CSR e o token de 7 dias "recebido por e-mail" como Bearer para solicitar o certificado. |

**Correção registrada em 2026-10-01:** "TRANSHIPPING AGENCIA" na saudação dos
e-mails é o início da razão social da titular da conta (TRANSHIPPING
AGENCIAMENTO MARITIMO LTDA) — os e-mails são da integração do Vela, não de
outro sistema.

## Fluxo do certificado (mapeado em 2026-10-01)

1. Gerar o par de chaves localmente (RSA 2048; a privada nunca sai da máquina
   do dono). Não precisa de nada do Itaú — pode ser feito agora.
2. Responder o e-mail de boas-vindas pedindo o cadastro; perguntar qual
   identificador usar no CN do CSR e para onde enviar a chave pública/CSR.
3. O e-mail "Credenciais Itaú" traz o token temporário (7 dias) e o
   client_secret criptografado. O client_id viaja no `sub` do token.
4. Gerar o CSR com `CN=<client_id>`; POST no STS
   (`/seguranca/v1/certificado/solicitacao`) usando o token como Bearer.
5. A resposta devolve o `.crt` assinado (1 ano) — a emissão **é** a
   confirmação; não há trava manual posterior documentada.
6. Avisar o Itaú por e-mail quando o fluxo produtivo estiver rodando
   (acompanhamento deles).

**Custódia definida:** privada gerada e guardada localmente pelo dono; em
runtime, o trio (privada + .crt + client_secret) vai para o Supabase Vault.
Nada no repo, no frontend, no chat ou no e-mail.

## Fatos técnicos confirmados (2026-09-30/10-01)

- Produto: API PIX DE RECEBIMENTOS — `itau-ep9-api-regulatorio-pix-v2-externo`,
  OpenAPI 2.27.2.
- Produção: `https://pix-pj.api.itau.com/regulatorio-pix/v2` (idêntica à do
  transporte na PR).
- Sandbox: `https://sandbox.devportal.itau.com.br/itau-ep9-api-regulatorio-pix-v2-externo/v2`.
- Token (OAuth2 client_credentials + mTLS): `https://sts.itau.com.br/api/oauth/token`.
- Solicitação de certificado: `https://sts.itau.com.br/seguranca/v1/certificado/solicitacao`.
- Escopos: `cob.write/read`, `pix.write/read`, `cobv.*`, `webhook.*`,
  `lotecobv.*`, `payloadlocation.*`.
- Endpoints: POST /cob, PUT/PATCH/GET /cob/{txid}, GET /cob, /cobv, /lotecobv,
  /loc, /pix, /pix/{e2eid}, devoluções, /webhook (PUT /webhook/{chave}, mTLS
  mútuo com CA própria a importar).
- Conta: 0870/37293-5.
- Divergência antiga **resolvida**: o host `secure.api.itau.com.br/pix_recebimentos/v2`
  era o modelo antigo, em desativação — a PR usa o modelo correto.

## Bloqueadores com dono

| Trava | Dono | Estado |
|---|---|---|
| Responder o e-mail de boas-vindas (cadastro + identificador do CN + canal de envio da pública/CSR) | Dono | Pendente |
| Cadastro da empresa / identificador para o CSR | Implantação Técnica Itaú | Aguardando a resposta do dono |
| Acesso à "nova experiência" de certificados/credenciais | Time comercial Itaú | Portal só consulta; modal dispensado em 01/10 — vale revisitar e clicar "começar" |
| Confirmar se a empresa já tem certificado API Itaú (reutilizar em vez de gerar) | Dono + Itaú | Pergunta incluída na resposta ao e-mail |
| Ligar o transporte real + polling GET com paginação/checkpoint + cron autorizado | Código (PR futura) | Bloqueado até credenciais vigentes |

## Próximos passos (ordem)

1. Dono responde o e-mail de boas-vindas (mesmo thread, sem alterar o assunto),
   citando IT-000245617: pede o cadastro, pergunta o identificador do CN, o
   canal de envio da pública/CSR e o acesso à "nova experiência".
2. Dono gera o par de chaves localmente (pode fazer agora; não depende do Itaú).
3. Com o identificador: gera o CSR final e envia pelo canal indicado.
4. Recebe o "Credenciais Itaú": descriptografa o client_secret, solicita o
   certificado no STS, guarda o trio no Supabase Vault.
5. Valida OAuth/escopos na conta real; liga o transporte; implementa polling
   GET `/pix` com paginação/checkpoint; cria cron autorizado.

## Arquivos relacionados

- `docs/plans/2026-09-30-preparacao-acesso-itau-pix.md` — plano de acesso
  (passo a passo e etapas de prova).
- `docs/plans/2026-09-30-simulacao-itau-pix-no-vela.md` — plano da simulação.
- Diagnóstico da PR confrontada com a doc do Itaú (fora do repo):
  `~/workspace/goals/vela-qa-testing/files/diagnostico-pr827-itau-pix.md`.
