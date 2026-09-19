# 0038 — Taxa Local é valor congelado na emissão, ancorado na escala do POD

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Vigência da tabela é informativa; COD reprecifica no destino final; B/L misto resolve duas tabelas. Congelamento na emissão permanece.
> Rastreabilidade: [ADR 0040](./0040-vigencia-da-tabela-de-taxas-e-informativa.md), [ADR 0051](./0051-cod-reprecifica-no-destino-final.md), [ADR 0069](./0069-resolucao-de-tabela-de-taxas-e-funcao-unica-compartilhada.md); [migration ativa 062](../../supabase/migrations/062_pr698_audit_remediations.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-08-06 (decisão 3 supersedida parcialmente pela
[ADR 0040](./0040-vigencia-da-tabela-de-taxas-e-informativa.md) em 2026-08-07;
decisão 1 supersedida parcialmente pela
[ADR 0051](./0051-cod-reprecifica-no-destino-final.md) em 2026-08-18;
ver notas editoriais ao final)

## Contexto

A revisão do motor de cálculo de Taxas Locais
([auditoria de 2026-08-06](../archive/audits/2026-08-06-revisao-motor-calculo-taxas-locais.md))
encontrou dez pontos em que o motor decide sozinho algo que deveria ser política
declarada. Três eram estruturais: não existe histórico imutável do que foi
cobrado; a data que escolhe a tarifa é a data de upload do B/L; e o recálculo
não é bloqueado depois de faturado.

O sistema já tinha uma resposta trabalhada para o mesmo problema — do lado do
Demurrage. A **Tarifa de Demurrage** tem vigência temporal e precedência
documentadas (ADR 0014); a Taxa Local não tinha sequer verbete no `CONTEXT.md`
para "tabela", "item" ou "condição de cliente", os três substantivos que a
própria definição de Taxas Locais citava.

A verificação mostrou que a proteção do Demurrage **não vem da vigência da
tarifa**: `demurrageRates.ts` resolve a tarifa pela vigência do dia do cálculo
(`CURRENT_DATE`), e as colunas `valid_from`/`valid_to` servem para agendar troca
de preço, não para reproduzir o preço de uma época. O que protege o Demurrage é
o congelamento do USD na emissão. Versionar item de tarifa nunca foi o
mecanismo, em nenhum dos dois módulos.

Duas regras operacionais foram confirmadas durante a revisão e sustentam as
decisões abaixo:

- O CE Mercante é cadastrado **no mínimo 5 dias antes da atracação**, e a fatura
  é emitida em cadeia automática a partir dele (ADR 0020). A fatura precisa
  estar paga para o cliente retirar a carga.
- B/Ls que dividem um container **recebem o CE no mesmo momento**.

## Decisão

**1. O fato gerador da Taxa Local é a emissão do CE Mercante**, não a chegada da
carga. Emitido o CE, a taxa é devida pelo porto declarado nele. Omissão de
Escala, Transbordo e COD não a alteram: no transbordo a carga chega ao POD
original; no COD o cliente retira em outro porto por conveniência própria e o
desvio é ônus operacional do armador. A ADR 0022 ("financeiro permanece manual")
e a ADR 0020 (emissão automática no CE) nunca estiveram em conflito — para taxa
local, omissão simplesmente não tem consequência financeira.

**2. O valor é congelado na emissão da fatura.** A fatura passa a guardar seu
próprio detalhamento em vez de derivá-lo ao vivo de `charge_calculations`, e o
recálculo passa a ser recusado para B/L já faturado — mesma trava que
`add_manual_bl_charge` já aplica (migration `108`) e que
`calculate_bl_local_charges` não tem. Correção depois de emitida continua sendo
cancelamento e reemissão, nunca edição.

**3. A Data de Referência da Tarifa é a ETA da escala do POD.** Ancorar na
escala garante que todos os B/Ls do mesmo navio no mesmo porto sejam cobrados
pela mesma tarifa — taxa local é cobrança de chegada, e "mesmo navio, preços
diferentes" não é defensável perante o cliente. Não é a ATA, que ainda não
existe quando a fatura é emitida. Não é a data de upload do B/L, que é fato
administrativo.

A ETA identifica **a que período comercial a viagem pertence**; não afirma que o
navio chegou. Por isso a decisão 1 (o físico é irrelevante) e a decisão 3
(âncora na chegada prevista) não se contradizem.

**4. Diverge deliberadamente do Demurrage na âncora.** O Demurrage resolve a
tarifa pelo dia do cálculo e está certo: é cobrança por container e por dia,
intrinsecamente individual, que não produz a comparação "mesmo navio, preços
diferentes".

**5. Não pode haver duas Condições de Cliente vigentes** para o mesmo Cliente e
o mesmo Item de Taxa. Sobreposição é erro de cadastro, não agendamento — dois
acordos conflitantes para o mesmo período. O cadastro recusa; não existe
critério de desempate. Hoje o motor resolve por `created_at DESC` (vence a
digitada por último), o que pode descartar uma promoção específica em favor de
uma renegociação geral cadastrada depois.

Também aqui a divergência com o Demurrage é intencional: tarifa é lista de preço
pública, onde agendar vigência por cima é operação normal; Condição de Cliente é
acordo negociado, e conflito precisa aparecer.

**6. Taxa local em USD converte na emissão pelo ROE vigente e congela.** Reusa a
máquina de PTAX + markup que já roda para o Demurrage, sem herdar o Recálculo
Diário: ali a dívida está correndo, aqui o valor é devido por inteiro desde o
CE. Hoje uma linha em USD grava `billing_hold_reason` pedindo um "ajuste manual"
que não tem tela onde ser feito.

**7. Quando não é possível resolver, o motor para e sinaliza — nunca cobra
zero.** O padrão já existe (`review:no_table`, `review:weight_missing`,
`review:imo_oog_thd`) e passa a valer para todo caminho de quantidade zero,
incluindo os que hoje somem em silêncio.

**8. O cálculo passa a ter duas fases; o CE deixa de ser o gatilho do cálculo e
passa a ser o de confirmação e emissão.** Supersede parcialmente a
[ADR 0020](./0020-ce-mercante-gatilho-calculo-taxas-locais.md).

- **Importar o B/L calcula as taxas** com o que o B/L tem naquele momento. O
  resultado é **provisório e conferível**: o operador extrai planilha e valida.
  **Nenhuma fatura é emitida, nada é publicado no Portal.**
- **O import recalcula os irmãos.** Não só os B/Ls importados: também todo B/L
  da mesma viagem que compartilhe container com eles e **ainda não tenha fatura
  emitida**. Assim o rateio `1/share_count` provisório fica correto assim que o
  segundo B/L entra, mesmo que ele venha numa importação posterior.
  B/L com fatura emitida nunca é recalculado — o congelamento da decisão 2
  prevalece; esse caso vira sinalização, pelo aviso de container compartilhado
  que já existe no import.
- **Cadastrar o CE Mercante recalcula, confirma e fecha**, e só então emite a
  fatura e publica.

O schema já previa as duas fases: `charge_status` distingue `calculated` de
`ready_for_billing`. O que colapsou os dois foi o trigger
`trg_promote_calculated_bl_ready` (migration `129`), que promove um ao outro sem
intervenção. Desligar essa promoção devolve aos estados o significado que já
tinham — `calculated` = calculado e conferível, `ready_for_billing` = o que o CE
produz.

Barato de implementar: cálculo e emissão **já são chamadas separadas** em
`src/services/reviewBillingAutomation.ts`, e a emissão não está encadeada no
banco. O que existe hoje é uma recusa explícita de calcular sem CE, mais o
trigger de promoção.

A premissa da ADR 0020 continua válida onde importa: o **valor faturado** segue
saindo do cálculo feito no CE, quando todos os B/Ls da viagem já existem. O que
muda é passar a existir também um número antes, para conferência.

## Consequências

- Recalcular um B/L faturado deixa de ser possível. O detalhamento que o cliente
  vê passa a bater com o total da fatura por construção, e o histórico do que foi
  cobrado deixa de depender de o preço da tabela não ter sido editado.
- Versionamento de item de tarifa deixa de ser necessário. O que a auditoria
  apresentou como "opção A ou opção B" (congelar a fatura *ou* versionar a
  tarifa) resolve-se só com a primeira.
- A ADR 0020 fica íntegra, mas sua decisão 5 nomeia a proteção errada; a
  correção está na nota editorial daquele documento. Nada precisa ser
  construído para o rateio de container compartilhado enquanto a regra
  operacional do CE simultâneo valer — se ela mudar, a 0020 precisa ser
  reavaliada.
- Veículo em FCL passa a pagar taxas locais. Hoje não paga: o motor força
  `container_load_type = 'LCL'` e lê o próprio valor um instante depois, então a
  condição nunca falha. A fonte correta já é importada e gravada em todo B/L de
  container e é usada hoje apenas para exibição — especificamente
  **`movement_to`**, o lado do destino. Taxa local é cobrança de chegada, e o
  que define se há o que cobrar é quem executa a movimentação no POD: num B/L
  `FCL/LCL` o armador entrega o container na CFS e não há taxa local dele; num
  `LCL/FCL` há. Ler `movement_from` inverteria os dois casos mistos.
- O motor deixa de escrever em `container_load_type`, cujo único escritor no
  sistema é ele mesmo e que nunca é revertido.
- **O cálculo provisório fica correto para container compartilhado**, graças ao
  recálculo de irmãos. Na prática os B/Ls que dividem container vêm na mesma
  importação, e aí o rateio já nasce certo; quando vêm em importações separadas,
  a entrada do segundo corrige o primeiro. A divergência entre provisório e
  faturado deixa de ser estrutural e passa a ser residual — sobra apenas o que
  mudar no B/L entre o import e o CE (peso, containers, cliente), que é
  justamente o que a conferência existe para pegar.
- Ainda assim, a planilha de conferência deve **identificar as linhas de
  container compartilhado**. Não porque o número esteja errado, mas porque é a
  linha cujo valor depende de um B/L que não está na planilha: quem confere
  precisa saber que aquele rateio tem uma contraparte.
- A aba **Validação** de `/faturamento` ganha o papel que hoje não tem. O
  diagnóstico do [plano de execução](../archive/plans/2026-08-06-faturamento-ajuste-completo.md)
  registrou que ela "promete uma conferência que a tela não faz"; com a fase
  provisória, passa a haver o que conferir. A Etapa 4 daquele plano (renomear
  "Validação") deve ser reavaliada à luz disto.
- `downloadCsv` (`src/lib/csv.ts`) existe e não tem nenhum consumidor hoje. A
  planilha de conferência é seu primeiro uso.

## Alternativas consideradas

- **Versionar `charge_table_items` com vigência.** Permitiria reproduzir o preço
  de qualquer época. Rejeitada: o congelamento na emissão entrega o mesmo
  resultado de auditoria com muito menos maquinário, e é o mecanismo que o
  Demurrage já usa.
- **Ancorar a tarifa no momento do cálculo (cadastro do CE), como o Demurrage.**
  Rejeitada: não existe data de emissão do CE no sistema (`bls.ce_mercante` é só
  o número) e o único proxy seria "quando alguém digitou", que é a mesma classe
  de data administrativa que a decisão 3 descarta.
- **Ancorar na ATA.** Rejeitada: o CE precede a atracação em pelo menos 5 dias,
  então a fatura já foi emitida quando a ATA passa a existir.
- **Detectar omissão de escala e sinalizar as faturas emitidas dos B/Ls
  afetados.** Rejeitada pela decisão 1: não há o que sinalizar, porque a taxa
  continua devida.
- **Recalcular B/Ls irmãos quando um novo B/L compartilha container.**
  Rejeitada **apenas para B/L com fatura emitida**, onde contrariaria o
  congelamento da decisão 2. Na fase provisória da decisão 8 ela é **adotada**:
  nada foi emitido, então recalcular o irmão não congela nem descongela coisa
  alguma — é só manter o número provisório certo. Esta ADR chegou a rejeitá-la
  em bloco antes da decisão 8 existir; a rejeição era boa para o mundo de uma
  fase só.
- **Bloquear USD na Tabela de Taxas Locais.** Seria mais simples que a decisão
  6, mas a Booking Cancelation Fee é cobrada do cliente em dólar.
- **Aplicar Recálculo Diário à taxa local em USD.** Rejeitada: criaria dois
  comportamentos para o mesmo documento conforme a moeda do item, e contraria a
  decisão 2.

## Notas de implementação

O cálculo provisório da decisão 8 encaixa em `confirmBlFreightImport`
(`src/services/blFreightImport.ts`) como passo pós-commit best-effort e
idempotente — mesmo padrão de `applyBapliePhysicalFlags`, que já roda ali. E
precisa rodar **depois** dele: as flags IMO/OOG são aplicadas pós-commit e
definem o perfil de carga, logo as quantidades de THD. Calcular antes produz
perfil errado.

O Movimento aparece em duas notações equivalentes e o parser lê texto livre das
células `T20`/`AC20`: `CY` = `FCL` e `CFS` = `LCL`, sendo `FCL`/`LCL` a forma
mais comum nos B/Ls recebidos. A leitura precisa aceitar as duas.

**Ausência de Movimento cobra normalmente** — a Isenção de Taxas Locais exige
LCL declarado. Notação desconhecida é tratada como ausência, e ausência não
isenta.
Este é o único ponto em que a decisão 7 ("para e sinaliza") não se aplica, e de
propósito: aqui não há risco de cobrar zero em silêncio, porque o padrão *é*
cobrar. Errar isentando não deixa rastro; errar cobrando o cliente contesta.

A correção acontece na fase provisória da decisão 8 — o B/L de veículo aparece
cobrado na planilha de conferência, o operador ajusta o Movimento na ficha e o
CE fecha certo. É a fase provisória que torna este padrão viável: sem ela, o
default de cobrar emitiria fatura errada direto ao cliente.

A taxa de preenchimento de `movement_to` nos dados reais continua valendo a
verificação, mas deixou de ser risco de desenho — mede apenas quanto trabalho
manual a regra vai gerar, não se ela funciona.

## Nota editorial — 2026-08-06 (implementação completa)

Todas as 13 etapas de `docs/archive/plans/2026-08-06-faturamento-ajuste-completo.md`
foram entregues nesta sessão (migrations `261`–`269`):

- **Decisão 1 (achado 3):** `create_local_consolidated_invoice_core` congela
  `invoice_items` na consolidação (migration `261`); faturas individuais já
  congelavam desde a `025`.
- **Decisão 2 (achado 6):** `calculate_bl_local_charges` recusa recalcular B/L
  com `financial_status IN ('invoiced','partially_paid','paid')` (migration
  `262`).
- **Decisão 8 (achados 8 e 11):** promoção automática `calculated →
  ready_for_billing` removida (migration `263`); cálculo provisório passa a
  rodar no import, antes do CE Mercante — que continua exigido só para emitir.
- **Decisão 7 (achado 1):** situações que cobravam zero em silêncio agora
  param e sinalizam `review_required` (migration `264`).
- **Achados 8 e 10 (isenção de veículo):** exige `movement_to` com prova
  positiva de LCL/CFS; motor parou de escrever `container_load_type` por
  conta própria (migration `265`) — corrige um bug real que isentava 100% dos
  B/Ls com veículo.
- **Decisão 3 (achado 4):** data de referência da tarifa passa a ser a ETA da
  escala do POD, não `uploaded_at` do lote (migration `266`).
- **Decisão 5 (achado 5):** Condições de Cliente sobrepostas viram restrição
  de exclusão no banco (migration `267`).
- **Decisão 6 (achado 7):** taxa local em USD converte para BRL na emissão
  pelo ROE vigente, sem Recálculo Diário (migration `268`); a mesma migration
  corrigiu um bug pré-existente de emissão automática sem checar CE Mercante
  (`trg_emit_invoice_on_bl_ready`, removido).
- **Achado 9:** o último rateio de container compartilhado absorve a
  diferença de arredondamento, para a soma das partes fechar o valor cheio do
  item (migration `269`).
- **Etapa 12 (consolidação de abas):** aba Pendências (subconjunto literal da
  Validação) e aba Demurrage (duplicava `/demurrage`) removidas de
  `/faturamento`; nota editorial correspondente na
  [ADR 0008](0008-demurrage-integrado-sem-unificar-persistencia.md).

Os marcadores "decidida e ainda não implementada" foram removidos dos
verbetes correspondentes no `CONTEXT.md`. Gaps conhecidos, deixados como tal
por decisão explícita nesta sessão (sem acesso a banco de produção ou à
operação para confirmar premissas): a taxa de preenchimento real da ETA por
escala (decisão 3) não foi verificada contra produção antes de aplicar; a
confirmação com a operação de que ninguém imprime Demurrage a partir de
`/faturamento` não foi feita antes de remover esse caminho (etapa 12). Ambos
documentados em `docs/RASTREABILIDADE.md` e `docs/modules/faturamento.md`
respectivamente.

## Nota editorial — 2026-08-07 (decisão 3 supersedida parcialmente)

A [ADR 0040](./0040-vigencia-da-tabela-de-taxas-e-informativa.md) removeu a
trava que a decisão 3 criou: a vigência da Tabela de Taxas Locais deixou de
filtrar o cálculo (a tabela é resolvida por escopo + `active`) e a ETA deixou de
ser pré-requisito — `review:no_eta` não existe mais. A Data de Referência da
Tarifa continua existindo, agora só para resolver a Condição de Cliente, com
precedência ETA da escala → `voyages.eta` → data de hoje.

O gap conhecido registrado na nota editorial anterior — "a taxa de preenchimento
real da ETA por escala não foi verificada contra produção" — foi o que motivou a
0040. As demais decisões desta ADR permanecem íntegras, em especial a 2
(congelamento na emissão) e a 5 (vigência da Condição de Cliente).

## Nota editorial — 2026-08-18 (decisão 1 supersedida parcialmente)

A [ADR 0051](./0051-cod-reprecifica-no-destino-final.md) inverteu a parte da
decisão 1 que afirmava que COD não altera a Taxa Local. A Taxa Local é cobrança
de chegada no **destino final**, e o COD muda o destino final — logo ele
reprecifica. O Transbordo continua não reprecificando, porque nele o destino
final é preservado.

Cai junto a justificativa "a taxa devida continua sendo a do porto declarado no
CE": o CE Mercante permanece o **fato gerador** da cobrança, mas nunca foi o
seletor do preço, e o schema nunca vinculou um CE a um porto — `bls.ce_mercante`
é `TEXT` livre. A [revisão de 2026-08-18](../archive/audits/2026-08-18-revisao-transbordo-cod.md)
também apurou que a regra nunca chegou a ser aplicada: nada no fluxo de COD
disparava recálculo, e o resultado dependia de o B/L ser tocado depois ou não.

O restante desta ADR permanece íntegro — em especial a decisão 2 (congelamento
na emissão e recusa de recálculo para B/L faturado), que é justamente o que
define os três ramos do ajuste financeiro na 0051.
