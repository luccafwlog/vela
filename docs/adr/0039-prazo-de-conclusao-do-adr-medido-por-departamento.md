# 0039 — Prazo de Conclusão do ADR: contagem a partir do ATD real, medida por departamento

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** No ADR terminalizado o prazo usa ATD da Atracação; o caminho legado por escala permanece. O agregado administrativo está na aba prazo-adr.
> Rastreabilidade: [ADR 0068](./0068-terminal-do-bl-herdado-da-frente-com-excecao-individual.md); [migration ativa 002](../../supabase/migrations/002_business_logic_and_security.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-08-06

> **Nota editorial — 2026-08-24.** Esta decisão fixou o T0 como "o ATD da escala
> unificada — a saída do navio do porto brasileiro". A nota de 2026-08-24 da ADR
> 0035 passou as datas de berço para a **Atracação** (a passagem da Escala por um
> terminal), e o ADR já é por terminal desde a ADR 0027, com fechamento
> independente. **O relógio passa a partir do ATD da Atracação daquele
> terminal**, não do ATD da Escala.
>
> O princípio não muda — "o relógio começa na data real do ATD", nunca no
> instante do registro. Muda a identificação de *qual* ATD é o relevante para
> aquele relatório: um prazo cujo T0 é a saída de outro terminal não é
> gerenciável por quem responde por ele, e um navio que fica mais duas semanas
> no porto congelaria o ADR de um terminal que terminou. Com dois terminais em
> Vitória — TVV desatracando em 29/08 e Portmac em 02/09 — o ADR do TVV conta de
> 29/08 e o da Portmac de 02/09.
>
> Consequências: `getVoyageUnifiedAtd` (a precedência POD-canônico/POL-fallback,
> escrita para este relógio) perde o seu consumidor; e os alertas pós-ATD da
> migration 326, que já iteram por terminal mas comparam contra as datas da
> *escala* **nos dois ramos** — o ETB na linha 518 e o ETD na 528 —, passam a
> comparar contra as datas da própria Atracação. O verbete **ATD** de
> `CONTEXT.md` já foi ajustado para "desatracou do terminal da Atracação".
>
> **O fallback do POL sai da medição.** `reconcile_agency_report_alerts` calcula
> hoje `COALESCE(v_pod_atd, v_pol_atd)` e deriva o prazo daí. O ATD do POL é
> registro documental do conhecimento, sem vínculo com Escala nem Atracação
> (ponto 3 da nota de 2026-08-24 da ADR 0035) — e um prazo de relatório
> operacional é precisamente um vínculo com a operação. O fallback também só
> agiria quando falta o dado bom, isto é, quando menos se sabe o que houve no
> cais, e por ser por porto devolveria aos dois ADRs de um mesmo porto o prazo
> comum que esta nota veio eliminar. A regra "Sem ATD não há prazo", já escrita
> nesta decisão, cobre a ausência. A linha `voyage_pol_schedule_atd` de
> `agency_report_pending_baselines` permanece na tabela e deixa de ser lida:
> vigência que existiu não se apaga. O instante de vigência da pendência segue
> em 2026-07-19.
>
> **Um produtor só, sem perder o relógio de parede.** O alerta
> `agency_report_deadline_missed` tem dois produtores vivos em grãos diferentes:
> `detect_agency_report_deadline_missed()` (migration 271, anterior à 306) varre
> por `(viagem, porto, departamento)` e insere direto em `alerts`; a fundação da
> 323 reconcilia por `(viagem, porto, terminal)`. `detect_agency_report_pending()`
> tem o mesmo defeito. Com prazos por terminal, os dois passam a **discordar**, e
> não apenas a duplicar. As funções legadas deixam de inserir alertas e passam a
> apenas iterar os ADRs abertos chamando o reconciliador da fundação. A varredura
> não pode simplesmente sair: **o prazo vence pela passagem do tempo, não por
> evento de auditoria** — um T0 lançado na terça, com vencimento na sexta, não
> gera evento algum na sexta para uma trigger reagir. É a mesma limitação que
> esta ADR já registra nas Consequências, e removê-la agravaria. Os alertas
> legados abertos são fechados explicitamente, com motivo registrado.

## Contexto

O ADR já registra tudo o que é preciso para saber **quando** cada departamento
concluiu a sua parte: `agency_departure_report_signoffs.signed_at` (resolução de
seção), `agency_departure_report_department_signoffs.signed_at` (Sign-off
Departamental, ADR 0029) e `agency_departure_reports.closed_at` (Fechamento,
ADR 0027). Toda transição também vai para `audit_logs` (ADR 0028/0029).

O que não existe é **compromisso de tempo**. Os alertas pós-ATD (migrations
`214`/`251`) dizem que há pendência, mas não conhecem data-limite: um ADR
pendente há dois dias e outro há três semanas produzem o mesmo alerta. A direção
pediu um SLA interno — o ADR pronto em até 72 horas depois da saída do navio — e
uma medição por escala que permita calibrar esse prazo com dado real, em vez de
por impressão.

Três fatos do sistema condicionam o desenho:

1. **O ATD é data sem hora.** A escala captura o ATD em `<Input type="date">`
   (`VoyageScheduleModals.tsx`), e o glossário dizia "data e hora efetivas" — uma
   divergência entre documento e código, corrigida junto com esta decisão. Um
   compromisso em horas não tem onde se ancorar.
2. **A saída real e o seu registro são momentos distintos.** O ATD vive em
   `audit_logs`; o valor é a data em que o navio saiu, o `changed_at` é quando
   alguém digitou. Divergem em dias com frequência.
3. **Reabrir o ADR não apaga assinaturas** (ADR 0030, migration `227`); só o
   departamento que reabre a **própria** assinatura perde o seu `signed_at`
   (migration `223`).

## Decisão

**O relógio começa na data real do ATD da escala unificada**, não no momento em
que o ATD foi registrado. É a saída do navio do porto brasileiro — o fato que
encerra a escala — e usa a precedência que a ADR 0035 já fixou na projeção
(`voyageRouteSchedules.ts`): a linha POD é canônica, o POL preenche apenas
campos vazios. Divergência entre os dois portadores continua exposta na
interface e **não move o prazo**.

A consequência é aceita de propósito: **um ADR pode nascer vencido**. Navio que
sai na segunda e tem o ATD lançado na sexta chega ao lançamento com o prazo
esgotado. Medir a partir do registro eliminaria esse caso, mas tornaria o SLA
gameável — bastaria atrasar o lançamento do ATD para nunca estourar — e mediria
a diligência administrativa em vez da realidade operacional.

**O prazo é de três dias úteis, não de 72 horas.** Vence no fim do terceiro dia
útil após o ATD; o dia da saída não conta, mesmo sendo dia útil. Dia útil é de
segunda a sexta. **Feriados contam como dia útil**: o prazo não conhece
calendário de feriados, nacional ou portuário.

**São três prazos independentes, um por departamento**, com a mesma data-limite,
cumpridos pelo respectivo Sign-off Departamental. O Fechamento entra na linha do
tempo como marco de conclusão, **sem prazo próprio** — é ato manual que hoje não
pertence a nenhum departamento, e cobrá-lo criaria um atraso sem dono.

**O cumprimento é medido pela assinatura vigente.** Um departamento que reabre a
própria assinatura volta a estar em contagem e fica fora do prazo se reassinar
tarde; os outros dois permanecem em dia, porque reabrir o ADR não toca nas
assinaturas alheias. A linha do tempo exibe as reaberturas com a justificativa
que o sistema já obriga a preencher — é o que separa demora de zelo.

**O cumprimento é atributo do departamento, nunca da pessoa.** O nome de quem
assinou continua visível em cada ADR; o agregado não soma por usuário.

**Sem ATD não há prazo.** O ADR de escala cujo navio não saiu tem linha do tempo
sem vencimento e sem cor; assinar antes da saída é permitido, fica marcado como
tal e conta como cumprido quando o ATD chega. Escala omitida fica **fora da
medição em definitivo** — nem cumprida, nem descumprida.

**O compromisso não retroage.** Só escalas com ATD posterior ao início da
vigência são medidas, seguindo o precedente de baseline das migrations
`214`/`251`.

**O vencimento sem assinatura gera alerta próprio**, um por departamento em
falta, convivendo com o alerta de pendência existente — os dois afirmam coisas
diferentes.

**Duas superfícies, uma fonte.** A linha do tempo vive na aba ADR de
`/viagens/:voyageId` (contexto de trabalho, visível a quem opera); o agregado
vive em `/admin/usuarios`, que é `adminOnly` e já hospeda usuários e logs de
auditoria. O agregado **não** vai para `/relatorios`, que é leitura de negócio
(fatura, cliente, demurrage) e não de equipe.

**O impresso mostra as datas de assinatura, não o veredito.** Quem validou o quê
e quando é evidência que dá confiabilidade ao documento que o Financeiro usa
para liberar pagamento; cumprimento e atraso são medida interna e ficam nas
telas. Os marcos vão para o `closed_snapshot` de qualquer forma, pela mesma razão
que o snapshot existe (ADR 0027).

## Consequências

- A linha do tempo é **exibição derivada**, coerente com a ADR 0027: nenhum marco
  novo nasce nela. O que precisa ser criado é o cálculo do vencimento, a marca de
  vigência e o alerta de estouro.
- O semáforo lê o estado atual (`signed_at`), não o histórico — a regra da
  assinatura vigente tornou desnecessária a leitura de `audit_logs` para a cor.
  O histórico continua sendo lido para exibir reaberturas.
- **O alerta de estouro herda uma limitação conhecida:** `detect_agency_report_pending()`
  só roda quando alguém abre `/alertas` (`src/pages/Alertas.tsx`); não há cron. Um
  ADR que estoura na sexta pode só gerar alerta na segunda. O `created_at` do
  alerta, portanto, não é evidência de quando o prazo venceu — a evidência é a
  linha do tempo, que calcula a partir do ATD. Agendamento no servidor fica como
  decisão posterior.
- O agregado nasce vazio e só fica interpretável depois de ~15–20 escalas. A
  calibração do prazo é o objetivo declarado, então o número inicial deve ser
  lido como amostra, não como avaliação.
- Com dias úteis, ATD de sexta dá ao time um prazo que vence na quarta — o fim de
  semana não consome dias. Isso remove o viés sistemático que dias corridos
  criariam contra escalas que saem no fim da semana.
- Feriado contando como dia útil produz injustiça pontual e conhecida. É o preço
  de não manter tabela de feriados (nacional, estadual e municipal — Santos e
  Paranaguá divergem) por uma métrica cuja finalidade é calibrar a si mesma.
- O glossário do **ATD** foi corrigido: "data efetiva, registrada sem hora".

## Alternativas consideradas

- **Contar a partir do registro do ATD (`changed_at`).** Tem precisão de segundos
  e é o gatilho que os alertas já usam, o que daria um T0 único no sistema. Mas
  premia o lançamento tardio: quanto mais demora a registrar a saída, mais prazo
  se ganha.
- **Dias corridos.** Mais simples e alinhado à contagem do Financeiro, mas
  reprovaria sistematicamente toda escala com ATD entre quinta e sábado, medindo
  o calendário em vez da operação.
- **Um relógio só, no Fechamento.** Mede a entrega ao Financeiro, que é o
  objetivo final, mas mistura atraso departamental com atraso de um ato sem dono:
  3/3 assinado no D+2 e ninguém clicando em "Fechar" produziria vermelho sem
  culpado.
- **Medir pela primeira assinatura, com contador de reaberturas à parte.**
  Protege quem assinou no prazo e foi arrastado por erro alheio, mas deixa o SLA
  gameável na direção oposta — assinar tudo no D+1 sem conferir e corrigir depois
  manteria o painel verde. A regra da assinatura vigente, somada ao fato de que
  reabrir o ADR não toca nas assinaturas alheias, já protege quem não reabriu.
- **Ranking por pessoa.** O dado permite (`signed_by`), mas quem clica costuma
  ser quem estava disponível, não quem produziu o dado que faltava — precisão
  falsa sobre a pessoa errada. E transformaria o sign-off em risco pessoal,
  fazendo as pessoas evitarem assinar, o que degrada justamente o dado que o SLA
  mede.
- **Calcular a medição retroativamente** (o dado existe desde julho de 2026).
  Daria volume imediato para calibrar, mas cobraria uma operação por uma regra
  que ainda não existia.
- **Agregado em `/relatorios`.** Casa de relatórios já pronta, com filtro de
  período — mas suas abas são leitura financeira e de cliente; medição de equipe
  ali confunde as duas naturezas.
- **Substituir o alerta de pendência pelo de vencimento.** Reduziria ruído, mas
  atrasaria em três dias o aviso de que há trabalho pendente, tornando o estouro
  mais provável.
- **Imprimir o veredito de SLA no ADR fechado.** O impresso é de uso interno, o
  que tornaria inofensivo — mas o compromisso é da agência consigo mesma e não
  precisa viajar dentro de um documento que circula.

## Implementação

Implementada — plano executado em [`docs/archive/plans/2026-08-06-adr-prazo-conclusao-linha-do-tempo.md`](../archive/plans/2026-08-06-adr-prazo-conclusao-linha-do-tempo.md).
Termos em `CONTEXT.md`: **Linha do Tempo do ADR** e **Prazo de Conclusão do
ADR**; verbete **ATD** corrigido para "data efetiva, registrada sem hora".
