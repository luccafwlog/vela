# 0094 — Preço das Taxas Locais fixo na importação e respostas às pendências da frente financeira

Status: aceito — 2026-10-21 (decisões do responsável na revisão das
importações e respostas às perguntas do plano de pendências). Implementada na
PR luccafwlog/vela#1019, migrations `378` a `383` e, da revisão final antes do
merge, `384` e `385`, pelo
[plano arquivado](../archive/plans/2026-10-21-preco-na-importacao-e-pendencias.md).

Supersede parcialmente a [ADR 0093](./0093-tabela-vinculada-ao-bl-e-coerencia-financeira.md)
(decisão 2, frase final; decisão 3; decisão 5, data de referência) e a
[ADR 0040](./0040-vigencia-da-tabela-de-taxas-e-informativa.md) (a ETA
ancorava a Condição de Cliente). Completa a ADR 0093 nas decisões 16 e 21 e
a regra de B/L cancelado (F-28). Altera a nota "Taxas do dia do CE" da
[ADR 0070](./0070-portal-trava-toda-emissao-e-liberacao-por-cliente.md).

## Contexto

A ADR 0093 congelava o preço das Taxas Locais no registro do CE. Até lá o B/L
seguia a tabela, a Condição e o câmbio do dia, a data de referência era a ETA
da escala (que, alterada, recalculava o provisório) e a Condição nova
recalculava os B/Ls sem CE. Na revisão das importações de 2026-10-21 o
responsável decidiu que o preço fica fixo quando o B/L entra no Vela, e
respondeu as 13 perguntas que o plano de correções deixou em aberto.

## Decisão

### A. Preço fixo na importação

**A1.** No dia em que o B/L entra no Vela (primeiro cálculo, normalmente a
importação) ficam fixos a tabela, a Condição do Cliente, a data de referência
(dia de Brasília) e o câmbio dos itens em dólar. O CE não fixa nada. A
Condição é escolhida pelo dia da importação; a ETA deixa de ancorá-la, e a
ETA alterada não muda o preço de B/L nenhum. A base (containers e rateio,
Movement To, POD, peso, veículos) continua sendo a atual na emissão.

**A2.** B/L importado sem Cliente: tabela, data e câmbio ficam fixos na
importação; quando o Cliente é vinculado, ou trocado em B/L não faturado, vale
a Condição desse Cliente vigente no dia da importação. A reimportação de B/L
não faturado só refixa o preço (tabela, Condição, câmbio e data do dia) com o
aceite do operador na prévia; sem ele, mantém o preço e aplica só a mudança
de base, e o arquivo idêntico não muda o preço. B/L faturado segue a decisão 4
da ADR 0093. POD que muda antes da emissão (reimportação com aceite, COD ou
ficha) passa à tabela do POD novo ativa no momento; Condição, câmbio e data
continuam os da importação.

**A3.** Criar, ativar ou desativar Condição não recalcula B/L existente: vale
para os que entrarem depois, ou na reimportação com aceite. Editar item ou
Condição continua sendo correção de erro (ADR 0093, decisão 2).

**A4.** O preço fixo passa ao primeiro cálculo e guarda o câmbio; a data de
referência é a do preço fixo; a ETA não recalcula; o backfill segue o "Data
status" do AGENTS.md.

### B. Respostas às pendências

**B1.** Só as funções do sistema gravam em `bl_containers`,
`baplie_containers`, `vehicles`, `vazios_*` e `granite_*`, como a migration
`366` fez em `bls`. Ficam liberados por coluna os pontos que a tela grava:
`bl_containers.unpacking_location`, `vazios_importacao_containers.natureza`,
`voyages`/`vessels`/`carriers` e `vazios_export_*`.

**B2.** As RPCs revogadas na `366` ficam revogadas: nenhuma tela nem Edge
Function as usa; aba antiga recarrega. Os scripts de QA parados em
`scripts/qa-display-production/` gravavam direto nessas tabelas e RPCs e
precisam de ajuste se voltarem a ser usados.

**B3.** Falha de cálculo (câmbio ausente e afins) recusa a gravação inteira,
com mensagem que aponta o B/L e o que falta, em todo caminho que calcula
(planilha de CE, arquivo de B/L, Manifesto BB, B/L avulso, Base de Clientes,
Revisão, ficha e troca de Cliente em B/L não faturado). B/L sem tabela não é
falha: fica em espera.

**B4.** B/L cancelado é somente leitura em tudo, inclusive containers e
veículos; a planilha de datas grava só nos B/Ls ativos do container.

**B5.** A reimportação de carga solta pede a confirmação de faturamento,
conferida no servidor, com a fatura e o valor antes → depois, também para
CBM, volumes e máquinas e para `bb_cbm` mudado sozinho. Sem a confirmação, nada
que afete a cobrança muda. Se a reemissão não for possível (caso misto), a
fatura não é cancelada e um alerta avisa.

**B6.** POD depois do CE: ver A2. **B7.** B/L que muda de Viagem pela
reimportação deixa de existir (a importação o recusa; frente das
importações). **B8.** CE trocado não muda preço (A1). **B9.** Arquivo idêntico
não muda o preço (A2).

**B10.** O ROE manual da Invoice de Demurrage prevalece: ela fica fora do
recálculo automático pela PTAX até alguém tirar o ROE manual, com rastro. É
regra da Demurrage; a seção A não se aplica a ela.

**B11.** A decisão 16 da ADR 0093 vale só para Pix **sem TXID nenhum**. O Pix
com TXID de outro sistema que cobra na mesma chave continua ignorado.

**B12.** Número da fatura: quatro dígitos (`INV-AAAA-0001`) e o número inteiro
a partir de 10.000, com o ano de Brasília. O "5 dígitos" da F-43 não vale.

**B13.** A avulsa com linha em dólar cobra o total convertido de uma vez, como
a taxa local; a linha mostra o unitário só em US$ e o total em R$, sem
unitário em R$.

### C. Confirmações

**C1.** Vincular Cliente a B/L com CE continua emitindo na hora, salvo no B/L
cuja fatura foi cancelada (ADR 0093, decisão 12). **C2.** Reativar B/L reabre
os efeitos encerrados no cancelamento; o `local_billing` reaberto de B/L com
fatura cancelada devolve `skipped`.

## Consequências

- O valor de um B/L importado não muda por ETA, Condição nova, câmbio do dia,
  CE ou reimportação idêntica; só por mudança de base, correção de tarifa
  (decisão 2 da ADR 0093) ou refixação pedida.
- A emissão, o recebível, a correção e o COD convertem o dólar pelo câmbio
  fixado (`bl_price_freezes.roe`).
- Falhas de cálculo deixam de ficar silenciosas: a gravação inteira é recusada
  e o operador corrige a causa antes de gravar de novo.
- Exceção provisória em B4: o chassi do B/L cancelado ainda passa ao B/L
  reemitido pelo arquivo de B/L (só dentro dele, pelo marcador
  `vela.vin_reissue`, migration `385`), até a frente das importações deixar de
  ler a aba VIN.
- Até existir a tela do aceite, refixar o preço é só do sistema
  (`service_role`, migration `385`).
- Fica com a frente das importações (não desta decisão): tela do aceite de
  refixar, recusa de B/L em outra Viagem, portos, LCL, aba VIN e efeitos.

## Alternativas consideradas

- **Preço no CE** (ADR 0093, decisão 3): rejeitada; a data do CE varia por
  B/L do mesmo navio e o B/L ficava com o preço do dia até lá.
- **Alerta em vez de recusa na falha de cálculo**: rejeitada; o B/L ficava
  gravado sem preço e sem dono.
