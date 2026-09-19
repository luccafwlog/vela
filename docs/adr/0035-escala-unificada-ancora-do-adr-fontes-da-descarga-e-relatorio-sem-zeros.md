# 0035 — Escala unificada (POL+POD) como âncora do ADR, B/L como fonte da descarga e relatório que lista só o operado

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Escala unificada permanece, mas apuração terminalizada respeita a exceção do B/L e a herança das frentes. Pesos container e BB são disjuntos após 061.
> Rastreabilidade: [ADR 0068](./0068-terminal-do-bl-herdado-da-frente-com-excecao-individual.md); [migration ativa 061](../../supabase/migrations/061_bl_weight_semantics_and_triggers.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-07-31 (notas editoriais em 2026-08-03, 2026-08-04 e 2026-08-26)

> **Nota editorial — 2026-08-03.** O bloco 1 desta decisão foi revisitado com a
> operação antes da execução. O modelo não muda; três pontos que a decisão
> deixara em aberto ficam registrados aqui, e o plano
> `docs/plans/2026-07-31-escala-unificada-pol-pod.md` foi reescrito para
> refleti-los.
>
> 1. **Uma escala, um modal.** A decisão unificou a *linha* da Visão geral, mas
>    não disse como se digita. Fica decidido: um único botão "Adicionar escala"
>    e um único modal por escala, com os dados de exportação numa seção atrás de
>    um **toggle persistido** (`tem_exportacao`) — a maioria das escalas não
>    embarca. O toggle não é derivado do preenchimento: declara-se a exportação
>    antes de conhecer quantidades. Desligá-lo é impedido enquanto houver
>    granito ou Embarque de Vazios na escala; sem carga, pede confirmação e
>    descarta o planejamento digitado. Granito permanece como checkbox dentro da
>    seção, não como um segundo toggle. O porto é escolhido entre `BRVIX`,
>    `BRSSA`, `BRPEC`, `BRSUA`, `BRSSZ`, `BRIGI`, `BRNVT`, com validação `BR*`.
> 2. **A unificação é do registro, não de toda superfície.** "O porto vira uma
>    linha só" vale para a **Visão geral**. O **Line-Up, o Painel e a TV
>    continuam segregando importação e exportação**: uma escala que opera nos
>    dois sentidos aparece em duas linhas do mesmo registro, com as **mesmas
>    datas da escala** — a linha de exportação perde ETA/ETB próprios e difere
>    apenas no conteúdo. Escala de sentido único gera uma linha só, e a escala
>    que só embarca passa a existir no Line-Up e na Programação do Portal, onde
>    hoje não existe. A assimetria é deliberada: não é resíduo a ser "corrigido".
> 3. **Base vazia dispensa a máquina de transição.** Em 2026-08-03 a produção
>    tinha 1 viagem, 1 linha de exportação (já com `pol`), 0 linhas de POL e 5
>    eventos de POD. Sem legado, caem o backfill de `pol` em três níveis, a
>    precedência "POD canônico com POL/EXP preenchendo vazios", o aviso de
>    divergência entre linhas e o corte temporal de baseline do alerta pós-ATD:
>    `pol` passa a `NOT NULL` com `UNIQUE (voyage_id, pol)` de uma vez. A
>    projeção continua lendo as três origens, porque `voyage_pol_schedule` segue
>    sendo escrito pelo `Laden on Board` (ADR 0025) e por Chegadas & Saídas
>    (ADR 0021) — mas o **ATD documental do POL não sobrescreve o ATD da
>    escala**, e a divergência entre os dois não é arbitrada pelo sistema.
>
> Permanece integralmente o restante: identidade `(viagem, porto brasileiro)`,
> escala estrangeira fora, ADR e três sign-offs para escala que só embarca,
> `voyage_pod_schedule` como portador físico e `port_calls` como upgrade adiado.

> **Nota editorial — 2026-08-04.** A escala unificada deixara em aberto como a
> viagem exibe sua rota. Fica decidido:
>
> 1. **Uma linha de rota por perna.** O cabeçalho da viagem deixa de somar
>    origens e destinos numa linha só. A perna de importação vai do POL da carga
>    às escalas que descarregam; a de exportação vai das escalas que embarcam
>    aos portos de descarga dessa carga. Quando um lado não é conhecido, aparece
>    `Origem a definir` ou `Destino a definir` — a linha existe mesmo incompleta,
>    porque a perna é um fato do planejamento, não do preenchimento. A perna que
>    não existe é outra coisa: viagem que só embarca, sem carga nem escala que
>    descarregue, não desenha perna de importação nenhuma (o POL da viagem não
>    conta como prova de importação).
> 2. **O destino da exportação é digitado, não inferido.** O embarque de uma
>    escala leva granito **e containers**, e o manifesto só existe depois do
>    embarque; inferir o destino dele deixaria a perna vazia durante todo o
>    planejamento. `voyage_export_schedules.discharge_ports` (migration 254)
>    guarda os portos informados no cadastro da escala, estrangeiros inclusive, e
>    o cabeçalho os soma aos `discharge_port` dos manifestos já importados.
> 3. **A coluna "Opera" diz sentido, não modalidade.** Os marcadores da Visão
>    geral ficam em Importação e Exportação. Granito é modalidade de carga da
>    exportação — continua como checkbox do cadastro e como módulo próprio, mas
>    não é uma terceira operação da escala.

> **Nota editorial — 2026-08-24.** Uma revisão do modal de edição da Viagem e do
> modal de Escala expôs que as datas da escala tinham dois donos e nenhuma regra:
> o ETD documental do POL preenchia a coluna de ETD da escala quando esta estava
> vazia, e reaparecia ao ser apagado. A operação foi consultada e o modelo de
> datas fica assim:
>
> 1. **A Escala é dona de ETA e ATA; a Atracação é dona de ETB, ATB, ETD e ATD.**
>    Entra a **Atracação** — a passagem de uma Escala por um terminal, com o ciclo
>    próprio de berço. Uma Escala é uma sequência ordenada de Atracações; o mesmo
>    terminal ocorre uma vez por Escala. A **ordem é derivada** de
>    `COALESCE(ATB, ETB)`, com empate desfeito pelo código do terminal: uma
>    posição digitada envelheceria contra as próprias datas exibidas ao lado, e
>    alimentaria o ATD derivado com uma mentira; derivada, ela só fica indefinida
>    enquanto não existe data alguma — momento em que também não há nada a
>    ordenar. Uma Atracação **nasce da atribuição de um terminal a uma frente
>    operacional**, e pode existir **sem terminal** (TBC) — no máximo uma por
>    Escala —, guardando a previsão de berço desde o planejamento. O **ATD da
>    Escala** passa a ser derivado: o da última Atracação, existindo apenas
>    quando todas as Atracações têm ATD, e é ele que conclui a Viagem.
>
> 2. **A segregação por sentido do ponto 2 da nota de 2026-08-03 permanece
>    integralmente** — uma linha por escala e sentido no Line-Up, no Painel e na
>    TV. O que muda é a frase "a linha de exportação perde ETA/ETB próprios":
>    ela valia porque o ETB pertencia à Escala e não havia outro que a linha
>    pudesse mostrar. Com a Atracação, **cada linha passa a ter ETB/ATB
>    próprios — os da primeira Atracação que hospeda uma frente daquele
>    sentido**. ETA e ATA seguem compartilhados, porque a chegada ao porto é uma
>    só. Sem isso a linha de exportação exibiria o ETB de um terminal que não é
>    o dela.
>
> 3. **Cai a precedência POD/POL para `etd` e `atd`, e o aviso de divergência
>    desses dois campos.** As datas do POL são registro documental do
>    conhecimento e **não têm vínculo com Escala nem com Atracação**; vivem na
>    coluna ATD POL de Escalas & Manifestos e em Chegadas e Saídas, e em nenhuma
>    outra superfície. A divergência de Nº de Escala permanece, porque ali as
>    duas origens descrevem o mesmo fato. Isto conclui o que a nota de
>    2026-08-03 já havia declarado no ponto 3 e o código não seguiu.
>
> 4. **O modal da Viagem deixa de editar datas.** Saem as seções "Portos de
>    carregamento (POL)" e "Portos de descarga para o Line-Up": criar escala
>    passa a ser exclusividade do Planejamento por escala e de Chegadas & Saídas
>    (ADR 0021), e o ETD do POL é digitado onde ele mora. A âncora do 1º Porto
>    Brasileiro (D−7/D−5) permanece no modal, mas validada contra as Escalas
>    persistidas da viagem — e desabilitada na criação, quando ainda não há
>    escala para ancorar.
>
> 5. **O Restow é da Atracação.** A reestiva acontece no berço, com equipamento
>    daquele terminal. O impresso do ADR já traz ATD e Restow na mesma célula,
>    lendo os dois da Escala: corrigir só o ATD deixaria incoerente um documento
>    que circula até o Financeiro. O campo por terminal já existia e era gravado
>    pelo modal, mas **nenhum leitor o consumia** — o valor era digitado,
>    validado, auditado e nunca reaparecia. Passa a alimentar Line-Up, planilha e
>    ADR; o campo da Escala é removido.
>
> 6. **Previsão não pede justificativa; realizado pede.** Alterar ETA, ETB ou ETD
>    nunca exige justificativa — previsão mudar é a natureza dela, e exigi-la no
>    campo mais volátil da tela treina a equipe a preencher "ajuste", corroendo o
>    pedido onde ele importa. Alterar um **realizado já registrado** (ATA, ATB,
>    ATD) exige, porque é afirmar que o fato antes registrado estava errado:
>    preencher um campo vazio não pede, trocar o valor pede, e **esvaziá-lo pede**.
>    É a mesma lógica do bloqueio por ADR fechado — os dois protegem afirmações,
>    com pesos diferentes.
>
> A base de produção não tinha datas de berço em 24/08/2026 (zero eventos de
> ETB, ATB, ATA e ATD; um único ETD), então não há backfill: as colunas nascem
> no formato novo, como o ponto 3 da nota de 2026-08-03 já havia estabelecido
> para a unificação.

> **Nota editorial — 2026-08-26.** A matriz de descarga passa a distinguir a
> natureza **OOG** (`is_oog`) além de carga geral e IMO. O flag é lido do Baplie
> quando há correspondência, com fallback para o B/L; ao consolidar duplicatas
> pelo número do container, os flags IMO e OOG são preservados e OOG vence IMO
> na categoria exibida. A extensão mantém a regra da seção 4 de listar apenas o
> que foi operado e não altera snapshots fechados.

## Contexto

Uma revisão completa do fluxo do Agency Departure Report em 31 jul 2026
(`docs/archive/audits/2026-07-31-revisao-fluxo-adr-cobertura-hipoteses.md`)
verificou o relatório contra três hipóteses operacionais reais: transbordo,
viagem criada exclusivamente para embarque e granito. As três falham, e por um
mecanismo só.

**O ADR só existe onde existe um POD.** A ADR 0027 ancorou o relatório em
`(voyage_id, port)` com "um ADR por escala brasileira (POD)", e a lista de
escalas da aba é montada exclusivamente a partir dos portos de descarga da
viagem. Todas as sete seções são filtros por igualdade contra essa string de
porto — **inclusive as duas de exportação** (granito por `loading_port`, vazios
embarcados por `embark_port`), que semanticamente usam porto de *carregamento*.
Isso só funciona porque, na escala clássica de transbordo, o porto brasileiro é
POD e POL ao mesmo tempo.

Consequências verificadas no código:

1. **Viagem só de embarque não tem ADR nenhum.** A escala existe no sistema
   como linha POL (`voyage_pol_schedule`) e linha EXP
   (`voyage_export_schedules`), exibidas na Visão geral, mas o ADR não lê
   nenhuma das duas. Sem B/Ls e com `pol_id`/`pod_id` nulos na viagem, a aba
   renderiza "Nenhuma escala ativa para compor o ADR" — sem ADR, sem pendência
   e sem alerta, porque o gatilho pós-ATD lê apenas `voyage_pod_schedule.atd` e
   escala de exportação não tem ATD em lugar nenhum.
2. **Carga em transbordo não aparece em ADR nenhum.** A omissão de escala
   (ADR 0022) mantém `bls.pod` no POD omitido — só o COD reescreve o destino —,
   então o container descarregado no Porto de Transbordo não é encontrado pelo
   ADR daquele porto, e o POD omitido não gera ADR. A categoria `transbordo` da
   matriz de descarga é, na prática, inalcançável.
3. **Zero silencioso por porto que não casa.** `granite_bls.loading_port` é
   gravado cru da planilha e comparado com um LOCODE; `embark_port` do Embarque
   de Vazios é texto livre. Divergiu, a seção fica vazia — e o departamento
   assina "Nada a declarar" sobre carga que existe.

Uma segunda questão apareceu na revisão do modelo com a operação: a matriz
tipo × natureza herdada do ADR em papel obriga o relatório a declarar zero para
tudo que não aconteceu. Num sistema, ausência é sabida — não precisa ser
digitada nem impressa.

## Decisão

### 1. A escala é (viagem, porto brasileiro); POL e POD do mesmo porto são a mesma escala

A âncora do ADR deixa de ser o POD e passa a ser a **escala**: a projeção
unifica `voyage_pod_schedule`, `voyage_pol_schedule` e `voyage_export_schedules`
por `(viagem, porto)`, restrita a portos brasileiros (`BR*`). Uma escala pode
contemplar só importação, só exportação ou as duas — e gera **um** ADR nos três
casos.

A unificação acontece na **projeção compartilhada**, não só na leitura do ADR:
Visão geral, Line-Up, Próxima Escala, alertas e ADR passam a ler a mesma lista.
Na Visão geral, o porto vira uma linha só, com marcadores do que a escala opera
(importação, exportação, granito, containers), no lugar das linhas de POD mais a
linha EXP separada.

Consequências diretas:

- `voyage_export_schedules` deixa de ser uma linha por viagem e passa a ser
  **uma por (viagem, porto)** — sem isso uma viagem com dois portos brasileiros
  de embarque não consegue registrar o segundo.
- `eta`, `etb`, `ata`, `atb`, `etd` e `atd` passam a ser campos **da escala**,
  não do papel do porto: escala que só carrega tem ATA e ATB como qualquer
  outra.
- Em colisão de valores entre as linhas, **a linha de POD é a fonte canônica** e
  POL/EXP preenchem apenas o que estiver vazio; divergência entre elas é exibida
  como aviso na seção Datas, nunca resolvida em silêncio.
- O gatilho de pendência pós-ATD passa a enxergar o ATD da escala unificada.
  Escalas anteriores ao deploy não geram pendência retroativa — mesmo mecanismo
  de baseline temporal já usado pela migration 214.
- O fechamento continua exigindo os **três** sign-offs departamentais, mesmo
  numa escala em que um departamento não tenha nada: assinar é declarar que se
  conferiu, e ausência de dado não é conclusão (ADR 0027).

### 2. O ADR do porto de descarga enxerga a carga descarregada por omissão

Transbordo continua nascendo exclusivamente de omissão de escala (ADR 0022) e
`bls.pod` continua intocado — reescrever o destino é o que caracteriza o COD.
O que muda é a leitura: as seções de carga do ADR passam a considerar também os
B/Ls com `bl_transshipments.disposition = 'transshipment'` cuja omissão tenha
`discharge_pod` igual ao porto da escala.

- Vale para as **três** seções que contam carga: containers, carga solta e
  veículos. Corrigir só os containers deixaria a escala meio contada.
- As unidades de transbordo aparecem **separadas** das de destino final,
  reativando a natureza `transbordo` que existia sem nunca contar nada.
- Escala omitida continua **sem** ADR, com uma exceção: a que já tinha ADR
  **fechado** antes da omissão permanece no seletor, marcada como omitida, para
  consulta e impressão. Relatório fechado é registro; sumir com ele é perder
  trilha.

### 3. O B/L conta a carga descarregada; o Baplie continua autoridade física

A contagem de containers **cheios** de importação passa a sair dos B/Ls, não do
Baplie — coerente com a ADR 0025, que fez do B/L a fonte documental única da
carga de container.

- Container **cheio** presente no Baplie e ausente de todo B/L sai do total e
  vira **aviso de divergência** na seção, com link para a Conciliação
  Baplie × B/L — que é o módulo que já trata Divergência de Existência.
- **Vazio descarregado conta pelo Baplie** (`status = 'empty'`). A regra do "sem
  B/L" não se aplica a ele: vazio não tem B/L por natureza, e a ausência não é
  anomalia.
- O **flag IMO continua vindo do Baplie** quando houver: a contagem é
  documental, a classificação operacional é física. O verbete de `CONTEXT.md`
  sobre a autoridade do Baplie permanece válido, agora explícito quanto ao que
  ele **não** determina — a contagem de cheios.
- Quando Baplie e módulo de vazios divergirem na contagem, o ADR mostra os dois
  números e avisa, em vez de escolher um.
- Granito passa a casar por porto normalizado na escrita **e** na leitura, com
  fallback para o `loading_port` do manifesto quando o B/L não o traz. O porto
  do Embarque de Vazios deixa de ser texto livre e passa a ser escolhido entre
  as escalas da viagem. Onde ainda assim sobrar carga num porto que não é escala
  da viagem, o ADR **avisa** — nenhuma normalização alcança o que já está
  gravado.

### 4. O relatório lista o que foi operado; zero não é informação

A matriz tipo × natureza herdada do papel é abandonada nas duas superfícies —
aba e documento impresso. O ADR passa a listar **apenas as combinações que
ocorreram**, com o total da escala no topo:

- carga descarregada: uma linha por tipo × natureza com quantidade
  (`40HC · carga geral: 51`), incluindo `vazio` como natureza quando houver;
- vazios embarcados: uma linha por **(tipo, condição, local de origem)**;
- blocos de métricas sem dado (carga solta, storage, embarque direto, veículos)
  **não aparecem**.

O princípio **não** vale para a resolução: seção sem dado exibe "nada operado
nesta escala" e permanece Pendente até alguém declarar Confirmado ou Nada a
declarar. É o que separa "não houve" de "ninguém olhou" — o motivo pelo qual a
ADR 0027 criou o estado explícito.

O documento impresso passa a mostrar, além dos números, a **resolução de cada
seção** com autor e data e os **três sign-offs departamentais**. Seção sem dado
consta no documento com a sua resolução: some o zero, não some a conferência.

## Considered Options

- **Manter a âncora no POD e documentar a convenção de cadastrar a escala de
  embarque como POD** (rejeitada): funciona hoje por acidente e transfere para a
  digitação uma regra que o sistema pode saber. Não sobrevive a um porto que
  seja POL de exportação sem ser POD.
- **Unificar POL+POD apenas na leitura do ADR** (rejeitada): a Visão geral
  continuaria mostrando duas linhas para uma escala, criando duas respostas para
  "quais são as escalas desta viagem" — a doença que a decisão trata.
- **Promover a escala a tabela própria (`port_calls`)** (adiada, como na 0027):
  a projeção sobre `audit_logs` continua sendo a representação; migrar história
  viva de line-up, viagens, omissão e status permanece fora de escopo. A
  unificação acontece na leitura e na escrita da projeção, não no armazenamento.
- **Reescrever `bls.pod` no transbordo, como o COD faz** (rejeitada): destruiria
  a distinção entre transbordo e COD e falsearia o destino documental do B/L.
- **Contar cheios pelo Baplie, como hoje** (rejeitada): infla a descarga com
  container sem lastro documental, e o desencontro já tem dono — a Conciliação.
- **Manter a grade com zeros no impresso, por familiaridade** (rejeitada): duas
  formas para a mesma verdade, e o documento que chega ao Financeiro seria o
  menos informativo dos dois.

## Consequências

- **Supersede parcialmente a 0027** quanto à âncora ("um ADR por escala
  brasileira (POD)" passa a "por escala brasileira, POL e/ou POD") e quanto à
  fonte da carga descarregada. Preserva integralmente: exibição derivada sem
  redigitação, resolução explícita por seção, snapshot de fechamento e o
  princípio de que ausência de dado não é conclusão.
- **Estende a 0029 e a 0030**: as seções, os donos departamentais e o gate de
  3/3 permanecem; muda a forma de exibição do conteúdo e o que o impresso
  mostra.
- **Estende a 0022** sem alterá-la: omissão, transbordo e COD continuam como
  registro operacional com financeiro manual; o ADR passa a ler o
  `discharge_pod` que ela já grava.
- **Reforça a 0025**: o B/L é a fonte documental da carga de container, agora
  também na contagem exibida pelo ADR.
- **Schema:** `voyage_export_schedules` passa a `UNIQUE (voyage_id, pol)` com
  backfill do porto; a validação de forma do snapshot no fechamento, removida
  por acidente pela migration 224 quando o gate migrou para departamentos, é
  restaurada com a allowlist de chaves atualizada.
- **Retroatividade:** escalas de exportação históricas passam a existir como
  escalas e são consultáveis, mas só as com ATD posterior ao deploy geram
  pendência e alerta.
- **Fora de escopo:** o embarque de **container cheio de exportação** continua
  sem representação no ADR, porque o sistema não tem módulo que o registre — e o
  ADR exibe dado derivado, não digitado (ADR 0027). Quando o módulo existir, o
  conteúdo entra na seção Carga carregada, sob Documentação. Até lá, a seção
  cobre granito.
- A execução está dividida em dois planos: `docs/plans/` traz
  `2026-07-31-escala-unificada-pol-pod.md` (âncora e projeção) e
  `2026-07-31-adr-cobertura-fontes-forma.md` (transbordo, fontes e forma). O
  segundo não depende do primeiro e pode ser entregue antes.
