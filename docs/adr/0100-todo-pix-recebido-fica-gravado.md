# 0100 — Todo Pix recebido pelo Itaú fica gravado

Status: aceito — 2026-10-23 (pedido do responsável, ao saber que a consulta da
API Pix Recebimentos traz também transferências que não vieram de uma cobrança
do Vela). Implementada nas migrations `442` e `443`, na Edge `itau-pix` e na
aba **Pix recebidos** da Conciliação PIX.

Supersede a decisão 16 da [ADR 0093](./0093-tabela-vinculada-ao-bl-e-coerencia-financeira.md)
("Pix sem TXID do Vela é gravado como 'Pix recebido sem baixa' e abre
`pix_unreconciled`") e o item B11 da [ADR 0094](./0094-preco-fixo-na-importacao.md)
("o Pix com TXID de outro sistema que cobra na mesma chave continua
ignorado"). Muda a regra de [Segurança](../operations/seguranca.md) de que o
Pix do sistema de terceiro e os dados do pagador não eram gravados.

## Contexto

A integração usa a API Pix do Itaú (padrão do Banco Central). A baixa
automática não consulta cobrança por cobrança: a cada minuto pede ao banco a
lista de **todos os Pix recebidos** na conta da Transhipping num período
(`GET /pix`). Essa lista traz o Pix de cobrança do Vela (TXID `VELA…`), o Pix
feito digitando a chave, sem identificador da cobrança, e o Pix do QR de outro
sistema que usa a mesma chave.

Até aqui o Vela baixava o Pix do Vela, gravava o Pix sem identificador como
"em análise" com Alerta para o Financeiro e descartava o resto, sem guardar
nada do que o banco devolve além de valor e horário. O responsável quer ver
tudo o que entrou e decidir caso a caso, sem Alerta para o que não é cobrança
do Vela.

O padrão do Banco Central para o Pix recebido traz identificadores, valor,
horário, chave, mensagem livre do pagador (`infoPagador`) e devoluções, mas não
o nome nem o CPF/CNPJ de quem pagou. A especificação do Itaú declara um campo
opcional `pagador` (nome, CPF, CNPJ); até esta decisão nenhum retorno de
produção tinha sido guardado para confirmar se o banco o preenche.

## Decisão

1. **Pix de cobrança do Vela** (TXID `VELA…`) segue para a baixa automática,
   sem mudança de regra: valor diferente, fatura não pagável e os demais casos
   continuam em análise com o Alerta `pix_unreconciled`.
2. **Todo o resto** (sem TXID, TXID de outro sistema, teste `VELAT…`) é
   gravado como **recebido**: sem baixa e sem Alerta.
3. **Todo Pix guarda o retorno do Itaú** como veio: valor, horário, chave,
   mensagem do pagador, `pagador` quando o banco mandar e qualquer outro campo.
   A tela mostra o nome e o CPF/CNPJ do pagador quando vierem.
4. **Aba Pix recebidos** na Conciliação PIX: lista todos os Pix, com origem,
   situação e a fatura da baixa. Ler é de todo usuário interno ativo, como o
   resto da Conciliação; nome, documento e mensagem do pagador e o retorno do
   banco só para o Financeiro e o Administrativo, a mesma regra da leitura das
   falhas da consulta (migration `385`, item 14).
5. **Conciliar é opção do operador:** na linha aberta de um Pix recebido, quem
   concilia pode dar a baixa numa fatura aberta (Taxas Locais, avulsa ou
   Invoice de Demurrage). A baixa usa o valor e o horário do Pix e grava o
   identificador do Pix como referência bancária, pelos mesmos donos da baixa
   manual. Cancelar essa baixa devolve o Pix a "Sem baixa", sem Alerta.
6. A aba **Pendências** fica só com o que pede ação: o Pix de cobrança do Vela
   em análise (bloco **Pix em análise**), as exceções do extrato e as cobranças
   que aguardam o Itaú.

## Consequências

- Os Pix sem identificador que estavam em análise viram "recebidos" e os
  Alertas deles fecham (migration `442`, com a afirmação "Data status" do
  `AGENTS.md`).
- Um Cliente que paga digitando a chave não abre mais Alerta. A baixa depende
  de alguém procurar o Pix na aba Pix recebidos (a lista sugere as faturas
  abertas de mesmo valor e as do Cliente com o documento do pagador) ou do
  extrato no plano B.
- O Vela passa a guardar dados pessoais de quem paga a Transhipping, inclusive
  de pagamentos de outro sistema. Ficam na tabela `itau_pix_receipts`, sem
  acesso direto pela API; a leitura passa pela RPC com o recorte do item 4.
- A Edge publicada antes da mudança continua funcionando com a migration
  aplicada: o registro do Pix sem TXID passa a gravar "recebido". O Pix de
  outro sistema só começa a ser gravado com a Edge nova publicada.
- Pix anteriores à publicação não são buscados de novo: a consulta segue do
  ponto em que parou (com 10 minutos de sobreposição).
- Se o Itaú não preencher `pagador`, a coluna mostra "Pagador não informado
  pelo Itaú" e o retorno inteiro continua na linha aberta. Os nomes de campo
  lidos ficam em `_itau_pix_payer_name` e `_itau_pix_payer_document`.

Regra vigente em [Reconciliação PIX](../modules/reconciliacao-pix.md).
