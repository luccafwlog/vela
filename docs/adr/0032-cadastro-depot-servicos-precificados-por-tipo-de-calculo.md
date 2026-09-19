# 0032 — Cadastro de Depot: serviços precificados por tipo de cálculo substituem tarifas estruturadas

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Serviços manuais e valores sugeridos substituem tipos de cálculo e quantidades automáticas; cadastro de terminais permanece.
> Rastreabilidade: [ADR 0033](./0033-embarque-vazios-unidades-importadas-servicos-lancados.md); [migration ativa 002](../../supabase/migrations/002_business_logic_and_security.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-07-23

## Contexto

Uma sessão de grilling sobre a página `/embarquevazios/depots` (2026-07-23)
partiu de um pedido simples — tirá-la do menu superior e acessá-la por um botão
dentro de `/embarquevazios` — e expôs que o modelo de tarifas fixado pela
ADR 0031 não atende à operação real dos depots:

1. **Tarifas estruturadas não cabem na variação real.** A ADR 0031 modelou o
   depot com colunas fixas (handling in/out, transporte, storage/dia, free time,
   overtime). Na prática cada depot cobra um conjunto próprio e heterogêneo de
   serviços, cada um com sua própria tarifa; uma grade de colunas fixas não
   representa isso.
2. **A página só empilha, não gerencia.** O form de tarifa nunca reedita
   (sempre `insert`, sem `id`), a lista é somente leitura e não há inativação nem
   encerramento de vigência — várias tarifas podem ficar `active` sobrepostas,
   tornando a vigente ambígua.
3. **Overtime real vem do arquivo, não da operação.** O percentual de overtime
   chega **por container, numa coluna da planilha importada**; a incidência é
   definida individualmente em cada serviço precificado.

## Decisão

### 1. A página espelha o padrão `/taxas-locais`: depot como tabela, serviços como itens

A página é renomeada para `/embarquevazios/depots` (título **"Tabela de
Depots"**), **sai do menu superior** e passa a ser acessada por um **botão** no
cabeçalho de `/embarquevazios`. O layout master-detail é mantido, mas o detalhe
do depot deixa de ter cards separados de "Tarifas" e "Serviços" e passa a ter
**uma única lista de serviços precificados**, no mesmo modo dos itens do
`/taxas-locais`: criar/editar in-place, **inativar (toggle) em vez de excluir
por padrão**, excluir quando necessário, e **histórico de vigência** visível com
badge "vigente".

O mesmo tratamento de menu se aplica a `/granito/taxas` (sai do menu, ganha
botão dentro de `/granito`), **sem renomear o slug** — ali `taxas` descreve
corretamente a entidade (é uma tabela de tarifas). O rename do Vazios ocorreu só
porque `taxas` nomeava errado o que é um cadastro de **depots**.

### 2. Todo preço é uma linha de serviço com um tipo de cálculo

Não há mais tarifa estruturada em colunas. Cada linha de serviço tem: **nome**,
**tipo de cálculo**, **valor unitário**, **vigência** (`valid_from`/`valid_to`) e
**ativo**. O `tipo de cálculo` é escolhido pelo usuário e define a conta:

- **Fixo por container** — `valor × nº de containers do depot na escala`
  (ex.: handling in/out, transporte). Aplica a **todos** os containers do depot,
  sem gate por flag.
- **Storage por dias** — `valor × dias cobráveis`, com
  `dias = máx(0, hand-out − hand-in − free time do depot)` somados por container.
- **Quantidade** — `valor × quantidade lançada no Vazios EXP`
  (ex.: Reorganização, Bundle Composition, Visual Check).

O `free_time_days` permanece **atributo do depot** (parâmetro do storage), não é
uma linha de serviço.

### 3. Overtime: percentual por container vindo do import, incidência por serviço

O overtime continua **percentual**, mas passa a ser lido de uma **coluna da
planilha importada, por container** (célula vazia/0 = sem overtime naquele
container). Cada serviço pode ser marcado como `subject_to_overtime`; o valor é
o percentual do container aplicado sobre a soma dos serviços fixos marcados do
depot. Isso substitui o percentual
por operação (`vazios_export_overtime_depots`) e as flags
`overtime_handling`/`overtime_transport` por booking.

### 4. Limpeza das flags por container

As flags de booking `bundle`, `visual_check`, `transporte`, `overtime_handling`
e `overtime_transport` são **removidas**: bundle e visual check viram serviços
tipo Quantidade, transporte vira serviço "fixo por container" (todos), e o
overtime vem da coluna importada. A flag `material` (Material do Armador)
permanece, pois deriva da condição do vazio e implica tarifa distinta.

O cálculo continua nascendo na tela de **Vazios EXP** (a quantidade dos serviços
tipo Quantidade é lançada ali); o **ADR permanece exibição derivada**, sem
redigitação — a regra da ADR 0027/0029 é preservada.

## Consequências

- **Migração de schema:** aposentar `depot_tariffs` estruturado, migrando os
  preços para linhas de `depot_services`; substituir o enum `charge_basis`
  (`per_container_flag`/`per_operation_qty`) pelo `tipo_calculo`
  (`fixo_por_container`/`storage_por_dias`/`quantidade`); mover `free_time_days`
  para `depots`; adicionar em `depot_services` a incidência de overtime por
  serviço; adicionar coluna de overtime % por container em
  `vazios_bookings`; remover as flags `bundle`/`visual_check`/`transporte`/
  `overtime_handling`/`overtime_transport`; remover `vazios_reorg_rates`
  (global) e `vazios_export_overtime_depots`. Segue a numeração sequencial de
  migrations (ADR 0016).
- **Import:** o parser da planilha de vazios passa a ler a coluna de overtime %
  por container e deixa de mapear as colunas das flags removidas.
- **Downstream:** a aba de Custos/Operação do Vazios EXP e a Operação de Pátio do
  ADR recalculam a partir de `depot_services` + `tipo_calculo` + overtime% +
  free time, no lugar do `REORG_SERVICES` fixo e das tarifas estruturadas.
- **RBAC:** inalterado em relação à 0031 (edição por Administrativo e
  Equipamentos).

## Alternativas consideradas

- **Manter tarifas estruturadas e só adicionar edição/vigência (0031).**
  Rejeitada: a grade fixa de colunas não representa o conjunto variável de
  serviços cobrados por depot.
- **Duas listas (Tarifas e Serviços) sob o depot.** Rejeitada: o usuário modela
  tudo como "serviço com sua tarifa"; uma lista única com tipo de cálculo é o
  mesmo conceito sem a divisão artificial.
- **Digitar as quantidades de reorg direto no ADR.** Rejeitada para preservar a
  ADR 0027/0029 (ADR é exibição derivada); a quantidade nasce no Vazios EXP.

## Relação com a ADR 0031

Supersede parcialmente a ADR 0031 quanto ao **modelo de tarifas do Cadastro de
Depot**: as tarifas estruturadas por colunas, o overtime como percentual por
operação, os serviços de reorganização (bundle por quantidade / visual check por
flag) e as flags por container dão lugar a serviços precificados por tipo de
cálculo, overtime por coluna importada e incidência por depot. A decisão de
**grão-container** e **upsert por container** da ADR 0031 permanece vigente.
