# 0031 — VAZIOS EXP: grão-container substitui booking; Cadastro de Depot é a fonte de tarifas

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Modelo atual separa unidades importadas e linhas manuais de serviço; grão-container e tarifas automáticas descritos originalmente não governam o custo atual.
> Rastreabilidade: [ADR 0032](./0032-cadastro-depot-servicos-precificados-por-tipo-de-calculo.md), [ADR 0033](./0033-embarque-vazios-unidades-importadas-servicos-lancados.md); [migration ativa 002](../../supabase/migrations/002_business_logic_and_security.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-07-23

## Contexto

Uma sessão de grilling sobre o fluxo de VAZIOS EXP (2026-07-23), cruzando o
modelo de domínio com o código e com uma planilha real de inventário
(`embarque_*`, 26 colunas, ~1.400 containers), expôs divergências entre a
linguagem de negócio, o schema atual e a operação real:

1. **A identidade da linha é o booking, não o container.** A tabela
   `vazios_bookings` exige `booking_number` (NOT NULL), deixa
   `container_number` opcional e impõe `UNIQUE (manifest_id, booking_number)`.
   Na operação, porém, cada linha é **um container físico**, o container é
   obrigatório, e **um booking agrupa 1:N containers** — a constraint atual
   rejeita um booking com múltiplos containers no mesmo import. A planilha real
   sequer tem coluna de booking: o agrupador operacional é a OS (`ORDER No.`) e
   a identidade é o container.

2. **O depot é texto livre por container, sem tarifas.** `depot` é uma string
   solta em `vazios_bookings`; overtime é um percentual por depot lançado no
   nível da operação (`vazios_export_overtime_depots`); os serviços de
   reorganização são um enum fixo (`bundle`/`desova`/`visual_check`) com tarifa
   global única (`vazios_reorg_rates`). Não há storage, free time, handling nem
   transporte tarifados. A operação precisa de tarifas **por depot** —
   handling in/out, armazenagem, free time, overtime, transporte e serviços
   extras — para calcular custos e conferir faturas.

3. **O import descarta dados e não deduplica.** `import_vazios_bookings_transactional`
   declara apenas 7 das 16 colunas que o parser e o serviço enviam: os 9 campos
   operacionais (depot, hand-in/out, material, bundle, transporte, overtime) são
   silenciosamente perdidos no servidor. Cada import cria um manifesto novo e
   insere sem deduplicar, de modo que reimportar duplica containers.

## Decisão

### 1. O container é o grão e a identidade do VAZIOS EXP

A linha do fluxo passa a ser identificada pelo **número do container**, com
unicidade **`(viagem, container)`** — o porto e a OS são atributos, não chave.
`booking_number` deixa de ser identidade obrigatória; quando presente na fonte,
é atributo de agrupamento. A `UNIQUE (manifest_id, booking_number)` é removida.
O import passa a **upsert por container** (atualiza os existentes por número,
insere os novos, não apaga os ausentes).

Campos por nível, conforme a planilha real (ver mapa na seção Consequências):
- **do booking/operação** (repetem entre containers): destino, porto de
  embarque, OS;
- **do container** (próprios da linha): número, tipo, data de movimentação
  (embarque), depot, hand-in/hand-out, condição do vazio, overtime
  (handling/transporte), observações.

### 2. Cadastro de Depot é a fonte única de tarifas de vazios

Introduz-se o **Cadastro de Depot** como entidade registrada, dona das tarifas
por depot: handling in/out, armazenagem (storage), **free time de storage**,
overtime, transporte e serviços extras personalizáveis. O depot da linha
(coluna `DEPOT`) é resolvido contra esse cadastro; quando o valor é o próprio
porto/terminal, a linha é **Embarque Direto** (sem depot, sem handling/storage/
transporte). Consequências do cadastro:

- **Storage cobrável = `máx(0, hand-out − hand-in − free time do depot)`**,
  distinto do Free Time de Demurrage (que se aplica à carga de importação do
  cliente).
- **Handling in/out e transporte são automáticos** para todo container vindo de
  depot (tarifa do depot × ocorrência); Embarque Direto não incorre.
- **Overtime é por container**, em duas bases independentes (handling e
  transporte), como percentual sobre a tarifa unitária correspondente do depot
  (`valor = tarifa × (1 + percentual)`), substituindo o percentual por depot no
  nível da operação.
- **Serviços de reorganização deixam de ser enum fixo** e passam a ser
  configuráveis por depot. Bundle e desova são lançados como **quantidade por
  operação**; visual check é **flag por container** (coluna `P`).
- A **condição do vazio** (íntegro / avaria / com material) vem da coluna de
  status e afeta a tarifa; o flag Material do Armador deriva dela.

O cadastro mora na evolução da página `/embarquevazios/taxas` (hoje só tarifas
de reorganização, e sem entrada de menu), que ganha o cadastro de depots +
todas as tarifas e uma entrada de navegação. Edição permitida a
**Administrativo e Equipamentos**.

### 3. O cálculo nasce na tela de Vazios EXP; o ADR reflete

A valoração (custo por container e total da operação) é calculada na própria
tela de VAZIOS EXP, reorganizada em **duas abas** — a 1ª com os dados por
container (semelhante à atual), a 2ª focada em custos e totais. A seção
**Operação de Pátio** do ADR passa a exibir **contagens + valores calculados**
lado a lado, permanecendo a folha que o Financeiro confere contra as faturas
(sem valoração própria no ADR). O import passa a persistir **todos** os campos e
a exigir **viagem + porto** (a mesma viagem tem portos distintos; o porto vem da
coluna `POD` de descarga, que coincide com o de embarque).

## Consequências

- **Migração de schema:** remover `UNIQUE (manifest_id, booking_number)`;
  tornar `container_number` obrigatório e `booking_number` opcional; unicidade
  `(viagem, container)`; novas tabelas de Cadastro de Depot e tarifas; reescrever
  `import_vazios_bookings_transactional` para upsert e para persistir todos os
  campos. Segue a numeração sequencial de migrations (ADR 0016).
- **Mapa planilha → sistema** (referência da fonte real): considerar
  `CONTAINER, TIPO, POD(=porto embarque), DEPOT, Current Status(=condição),
  HIGHLIGHTS(=observações), VISUAL CHECK(=flag), IMPORT EMPTY RETURN DATE(=hand-in),
  EMPTY GATE OUT(=hand-out), LOAD DATE(=data embarque), VESSEL/POD export(=validação/destino),
  ORDER No.(=OS), OVERTIME(=% → duas colunas handling/transporte)`; ignorar
  `BL, TEUS, FULL/EMPTY, VESSEL import, DISCHARGE DATE, UNSTUFFING *, FULL GATE OUT,
  depot cross check, OVD IM, OVD MTY, Comments`.
- **RBAC:** o Cadastro de Depot amplia o escopo de Equipamentos para editar
  tarifas (antes restrito à operação da escala), mantendo Administrativo.
- **Estende a ADR 0027/0029** (Operação de Pátio como seção do ADR): a seção
  passa a exibir valores, sem mudar a propriedade da seção nem o sign-off.
- **Superseda a modelagem original do módulo Vazios** (migration 035) quanto à
  identidade e à constraint de unicidade.

## Alternativas consideradas

- **Manter booking como identidade e aceitar 1:1 na prática.** Rejeitada: a
  planilha real não tem booking e a operação confirma 1 booking → N containers;
  manter a constraint quebraria o import real.
- **Tarifas por operação (como hoje), sem Cadastro de Depot.** Rejeitada: free
  time, handling e transporte variam por depot e precisam de fonte estável e
  reutilizável entre viagens; lançar por operação repetiria a mesma tabela a
  cada escala.
- **Import completo substituindo a operação (replace), como o Baplie.**
  Rejeitada em favor de **upsert por container**: correções pontuais não devem
  exigir reimportar o arquivo inteiro nem apagar containers já ajustados à mão.
