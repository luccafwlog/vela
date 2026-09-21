# 0020 — CE Mercante como gatilho do cálculo automático de Taxas Locais

> **Nota editorial — 2026-09-21 · supersedida parcialmente.** CE confirma o cálculo e dispara emissão; a importação de B/L passa a disparar o cálculo automático inicial de taxas na própria ingestão (migration 072), sem depender de runner offline ou de cliente já vinculado. Container/carga solta/misto compartilham resolução; Granito mantém persistência própria.
> Rastreabilidade: [ADR 0038](./0038-taxa-local-valor-congelado-ancorado-na-escala.md), [ADR 0041](./0041-validacao-fila-de-bloqueios-ce-como-confirmacao.md), [ADR 0042](./0042-ce-mercante-confirma-calculo-em-todos-os-modos.md), [ADR 0069](./0069-resolucao-de-tabela-de-taxas-e-funcao-unica-compartilhada.md); [migrations ativas 051](../../supabase/migrations/051_ce_mercante_auto_billing.sql), [072](../../supabase/migrations/072_local_charges_auto_calculation_on_import.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-07-08

## Contexto

O cálculo automático de Taxas Locais de B/Ls de container é disparado hoje por
dois caminhos de import: o manifesto executa billing dentro da própria RPC
transacional do lote ([ADR 0005](./0005-pipeline-importacao-viagem-staging-reconciliacao.md),
[ADR 0006](./0006-revisao-operacional-reconciliacao-cliente-gate-faturamento.md))
e o Importar B/L tenta cálculo/emissão pós-commit para cliente reconciliado por
documento ([ADR 0017](./0017-bl-fonte-ingestao-correcao-autoridade-compartilhada.md)).

O motor de taxas divide cobranças por container entre os B/Ls que o
compartilham (`1/share_count` na base `container_distinct_voyage`). Essa divisão
só sai correta se **todos os B/Ls que compartilham o container já existirem no
sistema** no momento do cálculo. A realidade operacional derruba essa premissa
nos gatilhos atuais: os B/Ls de uma viagem chegam no mesmo dia, mas em
**uploads separados** — o primeiro B/L importado calcularia o container inteiro
(`share_count=1`) e, faturado, ficaria travado com cobrança 1,5× a taxa devida
quando o irmão chegasse.

A operação confirmou duas invariantes de negócio: (1) nenhuma taxa é calculada
ou faturada antes de o CE Mercante do B/L estar cadastrado; (2) o CE Mercante
só existe depois que o EDI do manifesto foi transmitido ao Mercante — momento
em que, por construção, todos os B/Ls da viagem já foram importados.

## Decisão

1. **O cadastro do CE Mercante é o gatilho único do cálculo automático de
   Taxas Locais para B/Ls de container.** Qualquer canal de cadastro de CE
   (planilha por linha, EDI de retorno do manifesto, edição na ficha do B/L)
   dispara o cálculo daquele B/L.

2. **Os imports deixam de calcular.** O import de manifesto não executa mais
   billing no lote, e o Importar B/L não tenta mais cálculo/emissão pós-commit.
   Importar passa a ser apenas ingestão de dados.

3. **Os gates existentes permanecem.** O gatilho por CE respeita reconciliação
   de cliente, review gate e holds ([ADR 0006](./0006-revisao-operacional-reconciliacao-cliente-gate-faturamento.md));
   CE cadastrado com gate pendente calcula quando o gate liberar, não antes.

4. **Fronteira: somente B/Ls de container.** Carga solta (breakbulk) mantém o
   cálculo pós-commit do seu import e o Granito mantém seu fluxo próprio — o
   problema motivador (divisão de container compartilhado) não existe nesses
   modos. Assimetria assumida deliberadamente para minimizar o diff.

5. **A proteção de faturamento do ADR 0017 continua como rede de segurança**
   para o caso residual de um B/L tardio compartilhar container com B/L já
   calculado/faturado (variável de faturamento → informar e exigir override
   auditado).

## Consequências

- Viagens com manifesto calculam taxas **mais tarde** do que hoje (no CE, não
  no import). Sem impacto real de faturamento: a operação já não fatura antes
  do CE.
- A divisão `1/share_count` de container compartilhado torna-se correta por
  construção na cadeia normal (importa tudo → gera EDI → Mercante devolve CE →
  calcula), eliminando a dependência da ordem de chegada dos uploads.
- Supersede parcialmente a 0005/0006 no aspecto "billing dentro da transação
  de import" e a 0017 no aspecto "cálculo/emissão automática pós-commit do
  Importar B/L".
- O ciclo do sistema alinha-se ao ciclo federal: o CE — que já condiciona a
  visibilidade no Portal do Cliente — passa a condicionar também o financeiro.

## Alternativas consideradas

- **Recalcular B/Ls irmãos não faturados quando um novo B/L compartilha
  container.** Corrige o `share_count` a posteriori, mas mantém cálculo precoce
  inútil (a operação não fatura antes do CE) e não resolve o irmão já faturado.
  Rejeitada em favor de não calcular cedo demais.
- **Apenas sinalizar o compartilhamento tardio ao operador.** Menor diff, mas
  depende de memória humana para evitar cobrança 1,5× da mesma taxa. Rejeitada.
- **Manter o billing no import do manifesto e mudar só o caminho do B/L.**
  Criaria dois gatilhos para a mesma regra e reabriria o problema quando um
  B/L de arquivo compartilha container com B/L nascido de manifesto. Rejeitada.

## Nota editorial — 2026-08-06 (a rede de segurança da decisão 5 não cobre o caso residual)

A **decisão 5** afirma que a proteção de faturamento da ADR 0017 cobre o caso de
um B/L tardio compartilhar container com um B/L já calculado/faturado. A
verificação em código mostra que **não cobre**.

Em `src/services/blFreightImport.ts`, a análise de impacto de faturamento —
incluindo o aviso `Container(s) compartilhados com outro B/L afetados` — só é
computada quando o B/L importado **já existe e já tem cobrança própria**
(`const billed = billingLockedBlIds.has(doc.blNumber)`; o impacto exige
`existing && billed`). Para um B/L **novo**, nenhuma análise roda. Também não
existe gatilho que recalcule B/Ls irmãos quando novos containers entram na
viagem.

Consequência: o cenário residual permanece descoberto. O primeiro B/L é rateado
por `share_count = 1` e faturado pelo container inteiro; o irmão que chega depois
é rateado por `1/2`; a soma cobrada excede 100% do container sem sinalização.

Isto **não invalida a decisão principal** (o CE como gatilho único continua
correto e resolve a cadeia normal). Invalida apenas a mitigação declarada na
decisão 5 — e, por consequência, reabre as duas alternativas rejeitadas
("recalcular irmãos" e "apenas sinalizar"), que haviam sido descartadas
justamente por se considerar o residual coberto.

Diagnóstico completo em
[`docs/archive/audits/2026-08-06-revisao-motor-calculo-taxas-locais.md`](../archive/audits/2026-08-06-revisao-motor-calculo-taxas-locais.md),
ponto 2.

### Complemento do mesmo dia — o caso residual não existe na operação

Levantada a lacuna, a regra operacional foi confirmada: **B/Ls que dividem um
container recebem o CE Mercante no mesmo momento**. O cenário que a decisão 5
pretendia cobrir — um B/L novo compartilhando container com um irmão já
calculado — não ocorre, porque não há como um dos dois receber CE sozinho.

O caminho residual restante **está** coberto: acrescentar um container a um B/L
que já tem cobrança cai em `billingLockedBlIds` (que inclui B/L com
`charge_calculations`, não só com invoice), o aviso dispara e o override é
exigido.

Conclusão: a decisão 5 nomeia a proteção errada, mas a decisão principal fica
íntegra e **nada precisa ser construído**. As duas alternativas rejeitadas
seguem rejeitadas — agora pelo motivo certo (o caso não acontece), não pelo
motivo declarado na época (estaria coberto pela 0017). O `share_count` correto
depende da regra operacional acima; se ela mudar, esta ADR precisa ser
reavaliada.

Verificação barata disponível, caso algum dia se queira evidência em vez de
confiança na regra: a soma dos rateios cobrados por container deve fechar em 1,
e isso é consultável direto em `charge_calculations`.
