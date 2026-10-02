# Onboarding Itaú Pix — estado da integração (código + processo)

**Atualizado em:** 2026-10-02.
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

## Fluxo do certificado (revisado em 2026-10-02)

**Evidência documental:** [guia atual do Itaú para certificado dinâmico](https://devportal.itau.com.br/certificado-dinamico-demais-produtos),
consultado em 2026-10-02. Corrige a descrição anterior: o e-mail entrega
client_id, token temporário e chave de sessão criptografados; o client_secret
é devolvido pelo STS junto com o certificado, não presumido no e-mail.

1. Preparar o par RSA 2048 localmente, sem depender do banco. **Concluído em
   2026-10-02:** `private.pem` (PKCS#8) e `public.pem`, fora do repositório,
   com permissões Windows restritas ao dono. Integridade da privada,
   correspondência da pública e assinatura/verificação local aprovadas.
2. Responder o e-mail de boas-vindas para solicitar cadastro, confirmar se há
   certificado vigente reutilizável e o ponto focal/canal para a pública.
3. Enviar somente `public.pem` ao ponto focal confirmado. O guia recomenda
   e-mail; nenhum envio foi realizado nesta preparação.
4. Receber o e-mail "Credenciais Itaú" e descriptografar localmente client_id
   e token temporário usando a chave privada e a chave de sessão recebida.
   O token de onboarding vale 7 dias; material antigo não foi reutilizado.
5. Gerar e validar o CSR final com `CN=<client_id>` decifrado. O CSR segue
   para o STS, não substitui a pública enviada ao ponto focal. O guia gera
   uma chave própria para o CSR: se esse fluxo for seguido, manter também a
   privada de descriptografia, sem sobrescrever os arquivos desta preparação.
6. POST do CSR no STS (`/seguranca/v1/certificado/solicitacao`), com token
   temporário como Bearer e TLS validado. A resposta traz `.crt` e client_secret.
   Conferir validade, cadeia e correspondência com a privada do CSR.
7. Validar OAuth e consultas autorizadas na conta antes de considerar o acesso
   operacional; avisar o Itaú quando o fluxo produtivo estiver rodando.

**Custódia:** o material preparado está em
`C:\Users\Lucca\.itau\IT-000245617\2026-10-02`, sob responsabilidade do dono;
`LEIA-ME.txt` registra a validação e o uso de cada arquivo. Nenhum CSR,
certificado ou segredo bancário foi emitido. Se o banco confirmar certificado
vigente reutilizável, o novo par pode não ser necessário.
Em runtime, o destino definido para privada do CSR + `.crt` + client_secret
é o Supabase Vault; nomes, acesso pela função e instalação ainda pendentes.
Nenhum valor sensível entra no repo, frontend, chat ou e-mail.

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
| Responder o e-mail de boas-vindas (cadastro + canal de envio da pública + certificado existente) | Dono | Pendente |
| Cadastro da empresa / emissão do material de ativação | Implantação Técnica Itaú | Aguardando a resposta do dono |
| Acesso à "nova experiência" de certificados/credenciais | Time comercial Itaú | Portal só consulta; modal dispensado em 01/10 — vale revisitar e clicar "começar" |
| Confirmar se a empresa já tem certificado API Itaú (reutilizar em vez de gerar) | Dono + Itaú | Pergunta incluída no rascunho; envio pendente |
| Ligar o transporte real + polling GET com paginação/checkpoint + cron autorizado | Código (PR futura) | Bloqueado até credenciais vigentes |

## Próximos passos (ordem)

1. Dono responde no mesmo thread, citando IT-000245617: solicita cadastro,
   confirmação de certificado existente, ponto focal para `public.pem` e acesso
   à gestão de certificados/credenciais. Rascunho preparado; envio pendente.
2. Confirmado o canal, envia a pública já preparada e recebe material vigente.
3. Descriptografa client_id/token localmente; gera e valida o CSR final;
   solicita certificado e client_secret no STS, com autorização específica.
4. Valida cadeia, validade e correspondência da chave; instala o material no
   destino aprovado. Nada foi instalado no Supabase nesta preparação.
5. Valida OAuth/escopos e consulta real autorizada; liga o transporte;
   implementa polling GET `/pix` com paginação/checkpoint e cron autorizado.

## Arquivos relacionados

- `docs/plans/2026-09-30-preparacao-acesso-itau-pix.md` — plano de acesso
  (passo a passo e etapas de prova).
- `docs/plans/2026-09-30-simulacao-itau-pix-no-vela.md` — plano da simulação.
- Diagnóstico da PR confrontada com a doc do Itaú (fora do repo):
  `~/workspace/goals/vela-qa-testing/files/diagnostico-pr827-itau-pix.md`.
