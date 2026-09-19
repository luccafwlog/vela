# 0029 — Sign-off do ADR por departamento, seções na ordem do ciclo e operação de pátio como seção própria

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Ocorrências deram lugar a observações por seção; Operação de Pátio é subseção de Embarque de Vazios, não seção assinável separada.
> Rastreabilidade: [ADR 0030](./0030-adr-observacoes-por-secao-substitui-ocorrencias.md), [ADR 0036](./0036-adr-embarque-vazios-secao-unica-escala-fora-das-fases.md); [migration ativa 002](../../supabase/migrations/002_business_logic_and_security.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-07-21 (nota editorial em 2026-08-04)

> **Nota editorial — 2026-08-04.** Dois pontos desta decisão foram supersedidos
> pela [ADR 0036](./0036-adr-embarque-vazios-secao-unica-escala-fora-das-fases.md).
>
> 1. **Operação de pátio não é mais seção assinável.** O problema 3 do contexto
>    ("Operação de pátio escondida") era de apresentação, e foi resolvido aqui
>    com um corte no modelo: a oitava seção `operacao_patio`. O `CONTEXT.md`
>    define Embarque de Vazios como UM agregado por escala com duas partes, e o
>    corte fazia Equipamentos dar duas resoluções para um fato só. A 0036 funde
>    as duas em `vazios_embarcados` e devolve a evidência via subseção com
>    título próprio — o ADR passa a ter **seis** seções.
> 2. **As fases do ciclo são duas, não cinco.** "Registro" caiu com a 0030;
>    "Operação de pátio" e "Escala" caem com a 0036 (a primeira vira subseção de
>    exportação, a segunda é o assunto do relatório, não uma etapa dele). Restam
>    **Importação** e **Exportação**, com a seção Escala abrindo a aba sem faixa.
>
> Permanecem integralmente: sign-off por departamento (três, não sete), a
> resolução por seção como pré-requisito, o gate de fechamento em 3/3, os
> alertas de pendência por departamento e a justificativa em dois níveis.

## Contexto

A ADR 0027 modelou o Agency Departure Report com **sign-off por seção**: sete
seções, cada uma com um estado explícito (Pendente → Confirmado / Nada a
declarar) e um departamento dono, e o fechamento exigindo as sete assinadas. A
0028 tornou cada transição auditável (histórico em `audit_logs`, justificativa na
reversão).

A revisão de UX da aba ADR (2026-07-21) levantou quatro problemas de
apresentação e de modelo que a implementação atual não resolve:

1. **Ordem sem narrativa.** As seções aparecem numa ordem que não conta a
   história da escala; para o Financeiro, que lê o ADR para aprovar faturas, é
   difícil situar cada número no ciclo (chegada → descarga → operação → embarque
   → saída).
2. **Sign-off por seção não bate com o corte por ciclo.** Uma fase do ciclo
   mistura donos (a fase de importação tem carga descarregada e vazios
   descarregados de Documentação ao lado de veículos de Equipamentos). Sete
   assinaturas espalhadas por fases visuais confundem quem assina e quem lê.
3. **Operação de pátio escondida.** Storage, overtime, depots, OS e serviços
   extra — a informação mais relevante para conferir faturas de armazenagem e
   overtime — vivia dentro da seção "Embarque de vazios", sem evidência própria.
4. **Evidência fraca na importação** e **cópia ruim** ("Matriz de descarga
   (tipo × categoria)", "Container com veículo").

## Decisão

**Sign-off por departamento, com resolução por seção como pré-requisito.**
O ato de assinar passa a ser **um por departamento** (Operações, Documentação,
Equipamentos) — três assinaturas, não sete. Cada seção mantém seu estado de
**resolução** (Pendente → Confirmado / Nada a declarar) como pré-requisito: o
sign-off de um departamento só é habilitado quando todas as suas seções estão
resolvidas. Isso preserva a semântica de "ausência ≠ conclusão" da 0027 (uma
seção sem dado ainda precisa ser marcada "Nada a declarar") **e** desacopla a
assinatura da fase visual, resolvendo o conflito entre corte por ciclo e dono
departamental. O **fechamento passa a exigir 3/3 departamentos**, não 7/7
seções. Os **alertas de pendência passam a ser por departamento**
("Documentação pendente"), mantendo o gatilho após o ATD da 0027.

**Justificativa em dois níveis (estende a 0028).** Alterar uma seção já
resolvida continua exigindo justificativa auditada, com histórico por seção
(contrato da 0028 preservado). **Reabrir o sign-off já dado de um departamento**
passa a exigir justificativa própria. O fechamento/reabertura do ADR inteiro
permanece como na 0027.

**Operação de pátio vira a oitava seção**, sob Equipamentos, separada de
"Embarque de vazios". Consolida storage (containers × dias), overtime
(handling/transporte + % por depot), depots + embarque direto, OS e serviços
extra. Equipamentos passa a resolver três seções (veículos, operação de pátio,
embarque de vazios) antes da sua assinatura.

**Apresentação na ordem do ciclo da escala**, em cinco fases com faixa e título:
Escala (datas) → Importação (carga descarregada + carga solta, vazios
descarregados, veículos) → Operação de pátio → Exportação (granito, vazios
embarcados) → Registro (ocorrências). Uma **barra-resumo dos três departamentos
no topo** reúne estado, ato de assinar e "Fechar ADR". Cada bloco ganha uma
**legenda curta sempre visível, voltada ao Financeiro** (o que o número conta +
estado do sign-off), e um **número-herói** por bloco (ex.: total de containers
descarregados, dias de storage, janela ATB→ATD), com IMO destacado à parte na
descarga. Cópia corrigida: "Container com veículo" → "Veículos"; "Matriz de
descarga (tipo × categoria)" → "Descarga de importação".

**Ocorrências por qualquer departamento, com tag opcional de seção.** Deixa de
ser exclusiva de Operações no registro (Operações permanece dona do sign-off do
diário); cada ocorrência pode, opcionalmente, referenciar uma das oito seções.

O ADR continua **exibição derivada** (0027): só terminal, ocorrências e
resolução/sign-offs nascem no ADR. O documento impresso/fechado deve espelhar
este mesmo modelo — o redesenho do impresso fica para uma fase seguinte.

## Considered Options

- **Manter sign-off por seção, reagrupar só no visual** (rejeitada): resolveria
  a narrativa, mas deixaria sete assinaturas cruzando fases de donos mistos — o
  problema 2 permanece.
- **Sign-off por fase do ciclo** (rejeitada): uma fase mistura donos; exigiria
  uma regra artificial de "quem assina uma fase de donos mistos" e quebraria o
  alinhamento sign-off ↔ departamento.
- **Operação de pátio como sign-off independente (quarta assinatura)**
  (rejeitada): não mapeia para um quarto departamento; viraria uma exceção ao
  modelo por-departamento. Preferiu-se seção sob Equipamentos.

## Consequências

- **Supersede parcialmente a 0027** quanto a: granularidade do sign-off (por
  departamento, não por seção), gate de fechamento (3 departamentos), alertas
  (por departamento), divisão de seções (nova seção "operação de pátio") e
  autoria de ocorrências (qualquer departamento + tag). Permanecem da 0027: a
  âncora `agency_departure_reports (voyage_id, port)`, a exibição derivada, o
  fechamento com snapshot e a exclusividade de ocorrências/sign-offs como dados
  próprios.
- **Estende a 0028:** o histórico auditável e a justificativa de reversão
  passam a valer tanto para a resolução de seção quanto para a reabertura do
  sign-off departamental. O reúso de `audit_logs` permanece.
- **Schema/RPC:** o enum de seções ganha `operacao_patio`; o mapa
  `AGENCY_REPORT_SECTIONS` (dono por seção) é estendido; a resolução de seção
  passa a ser distinta do sign-off departamental (novo agregado ou coluna de
  estado por departamento); a inserção de ocorrência é ampliada para todos os
  departamentos e ganha referência opcional a seção; a validação de fechamento
  passa a checar os três departamentos.
- **Migração** dos sign-offs existentes (por seção) para o novo modelo, sem
  perder o histórico já gravado em `audit_logs`.
- **RBAC:** a permissão de resolução por seção continua pelo dono; a nova
  seção `operacao_patio` fica sob Equipamentos; o insert de ocorrência abre
  para os três departamentos.
- O documento impresso (`AgencyReportDocument`) fica temporariamente
  desalinhado com a aba até o redesenho do impresso — risco editorial aceito,
  registrado como pendência no plano de implementação.

## Nota editorial (2026-07-22 — sessão de revisão pós-implementação)

Uma revisão de uso real, após a 0029 entrar em produção, encontrou dois
ajustes de apresentação nesta ADR (o modelo de dados/RBAC foi revisto
separadamente na ADR 0030):

- **Agrupamento visual de "Operação de pátio" e "Vazios embarcados".**
  Os dois blocos leem a mesma tabela de origem (`vazios_bookings`) mas
  apareciam em fases visuais diferentes ("Operação de pátio" vs.
  "Exportação"), escondendo que são a mesma informação vista de dois
  ângulos. "Vazios embarcados" passa a ser renderizado dentro/ao lado da
  fase "Operação de pátio"; a fase "Exportação" passa a conter só o bloco
  "Granito". Seção, dono (Equipamentos) e sign-off de "Vazios embarcados"
  não mudam — só a posição na tela.
- **Remoção da legenda-resumo.** A legenda curta abaixo do título de cada
  seção, decidida nesta ADR como "voltada ao Financeiro", se mostrou
  redundante com o título da seção e com os títulos dos MetricPanels
  internos — e, na seção "Carga descarregada", ficou incompleta (citava só
  containers, não a carga solta que o bloco também mostra). A legenda é
  removida de todas as seções; título de seção + títulos dos MetricPanels
  passam a ser a única identificação de cada número exibido.
