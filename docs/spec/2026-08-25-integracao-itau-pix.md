# Integração futura com o Itaú — cobrança PIX

**Status:** planejamento futuro — não aprovado para execução

> **Nota editorial — 2026-10-06:** execução aprovada pelo dono. Credenciais
> produtivas recebidas no protocolo IT-000245617 sem envio de chave pública.
> Plano vivo: [integração Itaú Pix](../plans/2026-10-06-integracao-itau-pix.md),
> que substitui a PR 827 e registra as decisões abertas desta spec.

**Objetivo:** substituir, quando priorizado, a geração local de cobrança PIX e a conciliação manual do extrato do Itaú por uma integração com a API PIX Recebimentos do Itaú, usando QR Code dinâmico e confirmação automática de pagamento.

## 1. Contexto

O sistema já possui:

- módulo financeiro com faturas, recibos e lançamentos;
- geração local de BR Code/PIX em `src/lib/pix.ts`;
- conciliação por arquivo de extrato PIX do Itaú em `src/pages/Reconciliacao.tsx` e `src/services/reconciliacao.ts`;
- ledger financeiro e mecanismo de liquidação com proteção contra duplicidade.

O material histórico consultado em `~/Downloads/Integração ITAÚ/` contém uma coleção Postman, e-mails de onboarding e um arquivo de planilha relacionado à integração anterior. Esses arquivos não devem ser versionados nem anexados ao repositório. A coleção e a planilha continham material sensível; nenhum token, chave privada, certificado, segredo ou identificador de credencial é reproduzido nesta spec.

## 2. Escopo

### Incluído

1. Criar uma cobrança PIX dinâmica no Itaú vinculada à fatura local.
2. Exibir o QR Code e o código copia e cola retornados pelo Itaú.
3. Receber a confirmação de pagamento por webhook do Itaú.
4. Consultar o estado da cobrança e recuperar cobranças como mecanismo de reconciliação e recuperação de falhas.
5. Liquidar a fatura e registrar o recebimento no ledger de forma idempotente.
6. Preservar rastreabilidade entre fatura, cobrança Itaú, `txid`, `endToEndId` e lançamento financeiro.

### Fora do escopo inicial

- pagamentos via cartão, boleto ou outros bancos;
- integração com extrato bancário completo;
- transferência PIX de saída;
- renovação automática de certificados sem desenho operacional aprovado;
- suporte multiempresa ou múltiplas contas Itaú, salvo se isso for exigido pelo modelo atual;
- alteração imediata do fluxo de produção.

## 3. Vocabulário

- **Fatura:** documento e obrigação financeira local que pode ser paga pelo cliente.
- **COB:** cobrança PIX imediata, normalmente sem vencimento futuro.
- **COBV:** cobrança PIX com vencimento, adequada quando a fatura precisa carregar uma data de vencimento formal.
- **TXID:** identificador da cobrança PIX, usado para consultar e correlacionar o pagamento.
- **EndToEndId:** identificador da transação PIX liquidada, retornado na confirmação de pagamento.
- **Webhook:** endpoint HTTPS exposto pelo sistema para receber notificações assíncronas do Itaú.
- **mTLS:** autenticação por certificado do cliente em uma conexão TLS; deve ser distinguida da autenticação OAuth usada para consumir a API.

## 4. Fluxo de negócio proposto

1. Usuário emite ou publica uma fatura.
2. O backend cria uma cobrança no Itaú, usando um `txid` próprio e idempotente.
3. O sistema persiste a resposta do Itaú antes de exibir a cobrança.
4. A tela da fatura mostra QR Code dinâmico, código copia e cola, valor, expiração e status.
5. O cliente paga no aplicativo do banco.
6. O Itaú chama o webhook do sistema.
7. O webhook valida a requisição, registra o evento bruto de forma segura e responde rapidamente.
8. Um processamento idempotente valida a cobrança, confere valor e vínculo com a fatura e efetiva a liquidação.
9. A fatura passa para paga; o ledger recebe o lançamento e a origem da liquidação passa a identificar a integração Itaú.
10. Um job de reconciliação consulta cobranças e pagamentos recentes para detectar webhook perdido, duplicado ou divergente.

O webhook não deve depender de uma operação longa nem executar toda a conciliação dentro da requisição HTTP. A confirmação deve ser persistida e processada de maneira reentrante.

## 5. Superfície Itaú identificada no material histórico

Os endpoints abaixo foram identificados na coleção Postman histórica. Antes da implementação, as URLs, versões, escopos, contratos e requisitos de segurança devem ser conferidos na documentação vigente do Itaú e no ambiente de homologação.

### Autenticação e certificados

- `POST https://sts.itau.com.br/seguranca/v1/certificado/solicitacao`
- `POST https://sts.itau.com.br/seguranca/v1/certificado/renovacao`
- `POST https://sts.itau.com.br/api/oauth/token`

O fluxo histórico usa certificado/CSR para habilitação e OAuth 2.0 com `client_credentials` para obter token de acesso. Tokens, segredos, chaves privadas e certificados devem ficar fora do código, do banco de dados de negócio, dos logs e da issue.

### Cobrança PIX imediata

- `POST /pix_recebimentos/v2/cob` — criar cobrança.
- `PUT /pix_recebimentos/v2/cob/{txid}` — criar ou atualizar cobrança com `txid` definido pelo integrador.
- `GET /pix_recebimentos/v2/cob/{txid}` — consultar cobrança.
- `GET /pix_recebimentos/v1/cob?inicio={inicio}&fim={fim}` — listar cobranças no intervalo.
- `GET /pix_recebimentos/v2/cob/{txid}/qrcode` — obter dados do QR Code.

O exemplo histórico de criação usa valor original e chave PIX. O contrato final deve ser modelado a partir do schema vigente e validado contra casos de valor, expiração, pagador e informações adicionais.

### Cobrança com vencimento

- `PUT /pix_recebimentos/v2/cobv/{txid}` — criar ou atualizar cobrança com vencimento.
- `GET /pix_recebimentos/v2/cobv?inicio={inicio}&fim={fim}` — listar cobranças.
- `GET /pix_recebimentos/v2/cobv/{txid}/qrcode` — obter dados do QR Code.

A decisão entre COB e COBV é obrigatória antes do desenho definitivo. Se a data de vencimento da fatura tiver significado operacional e jurídico no sistema, COBV deve ser avaliado primeiro; se o objetivo for apenas disponibilizar uma cobrança com validade curta, COB pode ser suficiente.

### Webhook

- `GET /pix_recebimentos/v2/webhook?inicio={inicio}&fim={fim}` — consultar configurações, conforme o contrato vigente.
- `PUT /pix_recebimentos/v2/webhook/{chave}` — registrar ou alterar a URL do webhook da chave PIX.
- `GET /pix_recebimentos/v2/webhook/{chave}` — consultar a configuração.
- `DELETE /pix_recebimentos/v2/webhook/{chave}` — remover a configuração.

O material histórico menciona certificado de autoridade (`ca-cert`/`CARoot.crt`), mTLS e possível necessidade de configuração em gateway, proxy ou load balancer. Isso deve ser validado com o Itaú e com a infraestrutura de produção antes de abrir o endpoint.

## 6. Adaptação ao sistema atual

### Componentes que podem ser reaproveitados

- A fatura continua sendo a origem da obrigação e do valor a cobrar.
- `src/services/reconciliacao.ts` já concentra a correlação por TXID e a liquidação.
- O ledger atual já possui proteção contra múltiplas liquidações para a mesma fatura.
- Supabase Edge Functions são o ponto natural para chamadas externas e recebimento do webhook.
- O padrão existente de jobs/cron pode suportar consulta de recuperação.

### Componentes que precisarão evoluir

- `src/lib/pix.ts` deverá deixar de ser a fonte principal do QR Code quando a fatura usar Itaú; a geração local pode permanecer como fallback explicitamente definido.
- A fatura deverá armazenar a referência da cobrança externa, status, `txid`, conteúdo copia e cola/QR Code, expiração e timestamps de sincronização.
- Será necessária uma tabela de eventos de webhook com chave de idempotência e estado de processamento.
- O ledger deverá receber uma origem específica da integração Itaú, sem mascarar a diferença entre importação de extrato e confirmação por webhook.
- A reconciliação deverá ganhar uma rotina automática de recuperação, sem eliminar imediatamente o fluxo manual.
- A configuração de chave PIX, credenciais, certificados e URLs deverá ser separada por ambiente.

## 7. Modelo de dados mínimo a validar

A implementação deve definir, no mínimo, os seguintes conceitos persistentes:

### Cobrança externa da fatura

- `invoice_id`;
- provedor (`itau`);
- modalidade (`cob` ou `cobv`);
- `txid` único por provedor;
- identificador externo retornado pelo Itaú, se houver;
- valor esperado em unidade monetária segura;
- chave PIX utilizada;
- status local e status externo;
- payload de apresentação do QR Code/copia e cola, sem dados secretos;
- criação, expiração, última consulta e timestamps de atualização;
- código e mensagem de erro normalizados.

### Evento de pagamento/webhook

- hash ou identificador idempotente do evento;
- provedor e ambiente;
- `txid`;
- `endToEndId`;
- valor recebido;
- horário informado pelo banco;
- payload sanitizado ou referência segura ao payload original;
- status de recebimento e processamento;
- timestamps, tentativas e erro técnico/domínio, quando houver.

Não armazenar token OAuth, `client_secret`, chave privada, certificado privado ou cabeçalhos completos de autenticação em nenhuma dessas estruturas.

## 8. Segurança e operação

- Manter credenciais e certificados em secret manager/variáveis seguras por ambiente.
- Rotacionar ou revogar as credenciais que apareceram nos materiais históricos antes de qualquer uso futuro.
- Não registrar tokens, segredos, certificados, chaves privadas ou o corpo completo de requisições autenticadas.
- Nunca transportar `curl -k` ou equivalente para produção; a validação de cadeia TLS deve permanecer habilitada.
- Restringir o webhook à autenticação e validações compatíveis com o contrato Itaú, incluindo mTLS quando exigido.
- Validar assinatura, certificado, origem e estrutura do evento conforme a documentação vigente; não confiar apenas no `txid` recebido.
- Usar timeout, retry com backoff e idempotência nas chamadas de saída.
- Não marcar uma fatura como paga apenas por receber HTTP 200 no webhook.
- Conferir existência da cobrança, valor, moeda, `txid`, estado e ausência de liquidação anterior antes de efetivar o recebimento.
- Responder o webhook dentro do limite acordado e deslocar processamento pesado para uma fila/tabela de trabalho.
- Monitorar falhas de token, certificado, webhook, divergência de valor, duplicidade e atraso de confirmação.
- Definir procedimento de renovação de certificado antes da expiração e testar a troca em homologação.
- Tratar dados de pagador e payloads de pagamento conforme LGPD e a política de retenção do sistema.

## 9. Contrato interno proposto (nomes provisórios)

Os nomes abaixo são uma proposta de arquitetura, não endpoints existentes atualmente.

- `POST /functions/v1/itau-pix-cobrancas` — solicitar criação de cobrança para uma fatura.
- `GET /functions/v1/itau-pix-cobrancas/{invoiceId}` — consultar a cobrança local e seu status.
- `POST /functions/v1/itau-pix-webhook` — receber notificações do Itaú.
- Job protegido de reconciliação — consultar cobranças/pagamentos recentes e reprocessar eventos pendentes.

As funções devem autorizar o usuário no endpoint de criação/consulta e tratar o webhook como endpoint de sistema, sem expor credenciais ao navegador. A aplicação web deve receber apenas os dados necessários para apresentar a cobrança.

## 10. Critérios de aceite para a futura implementação

- Uma fatura elegível gera no máximo uma cobrança ativa por modalidade/provedor, salvo ação explícita de regeneração.
- O QR Code e o copia e cola apresentados ao cliente correspondem à cobrança do Itaú persistida para aquela fatura.
- Repetir a solicitação de criação não cria cobranças duplicadas.
- Um webhook repetido não duplica evento, lançamento ou recibo.
- Um webhook de valor divergente não liquida a fatura e gera exceção operacional.
- Um webhook de `txid` desconhecido não altera nenhuma fatura.
- O processamento suporta webhook recebido antes de uma consulta manual posterior.
- A consulta de recuperação consegue identificar pagamentos cujo webhook não foi processado.
- A fatura, o ledger e a tela de conciliação exibem a origem e os identificadores necessários para auditoria.
- O fluxo manual de extrato continua disponível durante a transição e não duplica uma liquidação já confirmada pela API.
- Testes cobrem sucesso, timeout, token expirado, certificado inválido/expirado, indisponibilidade do Itaú, duplicidade, divergência e reprocessamento.
- Homologação é concluída antes de qualquer chave produtiva ser ativada.

## 11. Decisões em aberto

- Usaremos COB ou COBV?
- Qual é o campo oficial de data de vencimento e expiração que deve refletir o domínio de faturas?
- O webhook será publicado diretamente pela Edge Function ou por um gateway/proxy com terminação mTLS?
- Como o certificado cliente e a CA serão armazenados e renovados no ambiente de execução?
- A cobrança será criada na emissão da fatura ou apenas quando o usuário solicitar “gerar PIX”?
- Como tratar alteração de valor, cancelamento, vencimento e segunda via?
- Qual será a janela e a frequência da reconciliação de recuperação?
- O Itaú exigirá liberação de IP, allowlist ou configuração adicional para homologação/produção?
- Qual contrato vigente substitui os exemplos da coleção Postman histórica?

## 12. Próximos passos quando o trabalho for priorizado

1. Confirmar COB/COBV e o comportamento desejado de vencimento/expiração.
2. Obter a documentação vigente, credenciais de homologação e requisitos de webhook do Itaú.
3. Fazer um spike isolado de autenticação, criação de cobrança, consulta e recebimento de webhook.
4. Fechar o modelo de dados e a estratégia de idempotência.
5. Implementar primeiro o fluxo em homologação, com logs sanitizados e testes de falha.
6. Integrar a cobrança ao módulo de faturas e a confirmação ao ledger.
7. Executar testes de recuperação e manter o extrato manual como contingência até a operação estar estável.

## Referências

- [Autenticação — Itaú for Developers](https://devportal.itau.com.br/autenticacao-documentacao)
- [Certificado dinâmico e credenciais — Itaú for Developers](https://devportal.itau.com.br/certificado-dinamico-credenciais)
- [Como fazer a primeira chamada a uma API — Itaú for Developers](https://devportal.itau.com.br/como-fazer-a-primeira-chamada-a-uma-api)
- [APIs de pagamentos e recebimentos — Itaú Empresas](https://www.itau.com.br/empresas/pagamentos-recebimentos/gestao-financeira)
- [Guia de uso do Pix — Itaú](https://www.itau.com.br/media/dam/m/53743b305ecd3bd7/original/Guia-de-Uso-Pix_LP.pdf)

## Contratos locais após a revisão da PR 839 (migration 130)

A integração futura deve separar o documento imutável da cobrança bancária:
valor da cobrança vem do saldo pagável, e não de `invoices.total_brl`. O histórico
local de versões/TXIDs e a resolução de pagamentos tardios já preservam origem,
Cliente, composição e restituição do excedente. Casos incompatíveis ou já
quitados ficam para revisão. COD e correção compartilham um efeito monetário.

A geração/cancelamento no Itaú, webhook, consulta de recuperação, outbox,
identificação por endToEndId e idempotência entre webhook/extrato continuam
pendentes desta integração. A implementação deverá desativar a emissão local
para cobranças do provedor, guardar o QR retornado pelo banco, cancelar a
cobrança anterior com confirmação/recuperação e preservar pagamentos recebidos
enquanto o cancelamento estiver em trânsito. `local_pix_charge_versions` não
representa confirmação de cancelamento bancário nem substitui o histórico de
recebimentos do provedor. Não há chamada Itaú ou credencial adicionada na PR.
