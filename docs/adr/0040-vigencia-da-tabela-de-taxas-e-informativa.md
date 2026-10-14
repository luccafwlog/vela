# 0040 — A vigência da Tabela de Taxas Locais é informativa, não trava do cálculo

> **Situação atual (2026-10-13).** Decisão vigente e implementada: a tabela é resolvida por escopo e `active`, a vigência só desempata e avisa na tela, e a ETA só ancora a Condição de Cliente (definição atual de `resolve_local_charge_table_id` na migration `002`).
> Estendida pela [ADR 0069](./0069-resolucao-de-tabela-de-taxas-e-funcao-unica-compartilhada.md) (função única que devolve duas tabelas ao B/L misto); a [ADR 0073](./0073-cadastro-usado-so-se-desativa.md) acrescenta que tabela usada só se desativa, pelo Administrativo.
> As migrations `019`, `092`, `123`, `266`, `267`, `270` e `275` citadas abaixo são da cadeia arquivada (`supabase/migrations_archive/`), anterior à consolidação da ADR 0062.
> Regra vigente: [Taxas Locais](../modules/taxas-locais.md).

Status: estendida — 2026-08-07

## Contexto

A [ADR 0038](./0038-taxa-local-valor-congelado-ancorado-na-escala.md) (decisão 3)
definiu a **Data de Referência da Tarifa** como a ETA da escala do POD, e a
migration `266` a tornou obrigatória: sem ETA não havia data, sem data não havia
tabela resolvida, e o B/L inteiro caía em `review:no_eta` — nenhuma linha
calculada, nenhum valor para conferir.

A própria migration registrou o risco por escrito: a taxa real de preenchimento
da ETA por escala nunca foi verificada contra produção antes de aplicar. A
review da PR 501 já tinha encontrado a primeira consequência disso — todo B/L
importado antes de alguém abrir o modal da escala e salvar a ETA caía em
revisão — e a migration `270` respondeu com um fallback para `voyages.eta`.

O fallback tratou o sintoma. A operação mostrou o problema real: a ETA é um dado
que chega tarde e muda, enquanto a tabela de taxas é um cadastro estável de
preço por porto. Amarrar um ao outro fez uma data operacional decidir se o
sistema calcula ou não, e o resultado foi um motor que para sem ter nenhum
motivo comercial para parar. A vigência das tabelas cadastradas, por sua vez,
raramente descreve troca de preço agendada: descreve quando aquela lista foi
escrita.

## Decisão

**1. A vigência da Tabela de Taxas Locais deixa de participar do cálculo.**
`resolve_local_charge_table_id` para de filtrar por `valid_from`/`valid_to`. A
tabela é resolvida por **escopo** (modo de carga + POD) e por **`active`**.
Desativar a tabela passa a ser o único jeito de tirá-la do ar.

**2. Entre tabelas ativas do mesmo escopo vence a de vigência inicial mais
recente**, com o maior `id` como segundo critério. A vigência continua sendo
desempate estável e leitura humana — nunca mais exclusão. Duas tabelas ativas
para o mesmo POD e modo de carga são erro de cadastro, e a tela avisa (decisão
4); mas o motor não para por causa disso: ele escolhe e segue.

**3. A ETA deixa de ser pré-requisito para calcular.** A pendência
`review:no_eta` deixa de existir. A Data de Referência da Tarifa continua
existindo, com um papel menor: resolver a **Condição de Cliente**, que é acordo
negociado com período contratado e mantém a vigência valendo (decisão 5 da ADR
0038, preservada). Sua precedência passa a ser **ETA da escala do POD →
`voyages.eta` → data de hoje**. O último degrau é o que remove a trava: nunca
falta data, então o cálculo nunca para por falta dela.

Nesse ponto a taxa local passa a se comportar como o Demurrage, que sempre
resolveu a tarifa pela vigência do dia do cálculo (`demurrageRates.ts`).

**4. A vigência vira informativo e alerta na tela.** O cadastro continua tendo
vigência inicial e final, e `/taxas-locais` passa a sinalizar quando o que está
cadastrado não descreve o que o motor faz:

- **Vigência vencida** em tabela ativa — continua sendo aplicada; inative-a para
  tirá-la do ar.
- **Vigência futura** em tabela ativa — já está sendo aplicada.
- **Não aplicada** — existe outra tabela ativa no mesmo escopo, com vigência
  inicial mais recente, e é ela que o cálculo usa.

Sem esses avisos a mudança seria uma regressão de transparência: um período
cadastrado que não significa mais nada mente em silêncio, e a escolha entre duas
tabelas ativas ficaria invisível.

## Consequências

- **Supersede parcialmente a decisão 3 da ADR 0038.** O que ela protegia —
  "mesmo navio, mesma tarifa para todos os B/Ls" — não some por acidente: a
  tabela agora é a mesma para todo B/L do mesmo POD e modo de carga,
  independentemente de data, o que é uma garantia mais forte que a anterior.
  O que se perde é a capacidade de **agendar** troca de preço por data e de
  **reproduzir** o preço de uma época pela tabela. Nenhuma das duas era usada:
  o congelamento na emissão (decisão 2 da ADR 0038) é que reproduz o que foi
  cobrado, e agendamento passa a ser a operação manual de inativar uma tabela e
  ativar outra.
- **A trava tinha um segundo lugar onde morar.** `mark_bl_ready_for_billing`
  exigia tabela vigente em `CURRENT_DATE` desde a migration `019`. Tirar a
  vigência só do cálculo faria o B/L calcular e travar depois, ao ser marcado
  como pronto para faturar. O gate passa a usar o mesmo critério do resolvedor —
  escopo + `active` (migration `275`). A vigência das Tarifas de Demurrage
  (`092`/`123`) não foi tocada: continua valendo por decisão própria (ADR 0014).
- O `review:no_eta` some do funil da Validação. B/Ls que estavam parados nele
  não ganham valor sozinhos — eles não têm linha de cálculo nenhuma — e precisam
  de um recálculo, que a Validação e a ficha do B/L já oferecem. A migration
  apaga a pendência e o motivo de bloqueio, para a tela não continuar mostrando
  uma trava revogada.
- A ETA continua sendo a âncora preferida da Condição de Cliente, então o
  cadastro de condições negociadas não muda de comportamento quando a ETA existe
  — que é o caso normal.
- Quando a ETA não existe, a Condição de Cliente passa a ser resolvida pela data
  de hoje. Duas consequências reais: uma condição cadastrada para um período
  futuro não se aplica a um B/L sem ETA importado hoje, e um recálculo feito
  meses depois pode resolver uma condição diferente. É aceitável porque o valor
  é congelado na emissão (decisão 2 da ADR 0038) e o recálculo é recusado depois
  de faturado — a variação só existe na fase provisória, que é justamente a que
  existe para ser conferida.
- Duas tabelas ativas no mesmo escopo deixam de ser impossíveis por construção
  (antes, vigências disjuntas separavam-nas). Passam a ser erro de cadastro
  visível, não restrição de banco. Não foi criada restrição de exclusão como a
  de `customer_rate_overrides` (migration `267`) de propósito: ali sobreposição
  é conflito entre dois acordos e precisa recusar; aqui é lista de preço, e
  recusar o cadastro devolveria a rigidez que esta ADR está removendo.

## Alternativas consideradas

- **Manter a vigência e só remover a exigência de ETA** (data de referência =
  hoje quando falta ETA). Resolveria a trava sem mexer na resolução da tabela,
  mas manteria uma tabela com vigência vencida fora do cálculo — o mesmo
  impedimento improdutivo, só que disparado pelo cadastro em vez de pela ETA.
- **Restrição de exclusão impedindo duas tabelas ativas no mesmo escopo.**
  Rejeitada: recusar o cadastro é o tipo de rigidez que esta ADR remove, e o
  motor tem desempate determinístico. O alerta na tela cobre o caso.
- **Remover as colunas `valid_from`/`valid_to` de `charge_tables`.** Rejeitada:
  o usuário pediu explicitamente que a vigência continue cadastrada como
  informativo, e ela ainda é o critério de desempate entre tabelas ativas.
- **Também tornar informativa a vigência da Condição de Cliente.** Rejeitada
  como fora de escopo: Condição de Cliente é acordo negociado com período
  contratado, e a ADR 0038 (decisão 5) trata sobreposição ali como erro que
  precisa aparecer. O pedido era sobre a tabela de taxas.
