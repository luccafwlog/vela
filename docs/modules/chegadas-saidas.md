# Chegadas e Saídas

> **Status:** ativo · **Atualizado:** 2026-10-14 · **Rota interna:** `/chegadas-saidas` · **Consumidor:** widget do Dashboard do Portal

## Propósito e escopo

Este módulo publica a programação comercial de navios no Portal do Cliente a
partir da própria **Viagem**. Conforme ADR 0021, cadastrar em
`/chegadas-saidas` cria ou anexa uma viagem operacional e grava POL/ETD e
POD/ETA em `audit_logs` pelos mesmos serviços de rota usados por `/viagens`.

`vessel_schedules` e `ended_vessels` permanecem no histórico de schema, mas a
tela atual não escreve mais nelas. Não houve migração de dados legados.

Fontes principais: `src/pages/ChegadasSaidas.tsx`,
`src/pages/chegadasSaidasForm.ts`, `src/services/voyageFromSchedule.ts`,
`src/services/portalScheduleVoyages.ts`, `src/services/portalScheduleLanes.ts`,
`src/services/portalScheduleBulkImport.ts`,
`src/components/portal/ShipScheduleWidget.tsx` e a RPC `portal_ship_schedule`
(definição vigente na migration `002`; a coluna `show_on_portal` e a RPC
nasceram nas migrations arquivadas `172`/`173`).

## Anatomia das telas

### Rota interna `/chegadas-saidas`

A página lista viagens com `show_on_portal = true` por
`fetchPortalScheduleVoyages()`, projetando cada viagem na grade fixa de lanes
`PORTAL_SCHEDULE_LANES`: Qingdao, Shanghai, Taicang, Ningbo, Nansha, Salvador,
Vitória e Pecém.

O modal (`Modal` do design system, tamanho `md`) pede navio, VOY, IMO e uma data ISO por lane, agrupadas em **Chegada no Brasil (ETA)** — primeiro, porque ao menos um porto de descarga é obrigatório — e **Saída na origem (ETD)**. O botão principal mostra "Salvando…" e impede repetição. Checkbox "não escala"
deixa a lane sem data e, portanto, sem schedule. Ao salvar,
`createOrAttachVoyageFromSchedule` deduplica por VOY + IMO (fallback nome
canônico), cria ou anexa a viagem, liga `show_on_portal` e grava somente ETD de
POL e ETA de POD. O IMO exato prevalece sobre a grafia e um IMO distinto nunca
é fundido; sem IMO, mais de uma candidata nominal produz conflito explícito.
Aliases de armador aceitam pontuação e designações como `M/V` sem tratar
prefixos maiores, como `CSCL`, como `CS`. ATA, ATD, RTW, CE status, escala e
vínculo não são sobrescritos.

Na **edição**, apenas as datas da programação são editáveis — navio, VOY e IMO
são read-only (corrigidos na tela Viagens). Marcar um porto como "não escala"
cancela aquela escala — quando é porto de descarga que tinha data, a tela pede
confirmação antes (`clearedPodLabels`): o ETD/ETA publicado é removido. A
escala só é retirada também de Viagens e do Line-Up quando quem salva é o
Administrativo, ela não tem âncora operacional (manifesto vinculado, ATA/ATD ou
B/L) e o porto não está sob a Trava de exclusão; para os demais Departamentos,
a escala continua sem data (migration `090`, ADR 0071). O upload em lote nunca cancela escalas — células vazias
ou "X" são ignoradas.

A tela não tira linhas do quadro. A viagem sai da Programação sozinha ao
receber o último ATD (passa a Concluída); antes disso, só sai por Excluir ou
Cancelar em `/viagens` (ADR 0071, item 12; "Remover do Portal" foi retirado na
Fase 4a da política de exclusão).

O upload em lote baixa um template gerado da mesma constante de lanes. **Conferir
prévia** lê o arquivo e mostra, por linha (`VESSEL NAME`, `VOY`, `IMO`, lanes
ETD/ETA), se a viagem é nova, quais datas mudam, se ela passa a aparecer no
Portal ("Publica no Portal": Viagem existente oculta, mesmo sem data que mude)
ou o erro (ex.: viagem ambígua), sem gravar (`planScheduleSheet`, com as mesmas
regras de agenda da gravação individual). Na planilha, o IMO só identifica o
navio com 7 dígitos (prefixo "IMO" aceito); "TBA", "-" e afins são ignorados com
aviso e a busca é pelo nome. Nome igual com outro IMO cadastrado é erro da linha
("IMO conflitante"), nunca fusão. Viagem cancelada é erro da linha (somente
leitura). A mesma Viagem e porto em mais de uma linha com datas diferentes
recusa essas linhas; na Viagem nova, linhas com o mesmo número e o mesmo IMO
ou o mesmo nome contam como a mesma Viagem, mesmo que só uma traga o IMO, e o
mesmo navio novo com dois IMOs diferentes no arquivo recusa as linhas, também
quando estão em viagens diferentes e o navio é achado pelo nome (a gravação
grava o primeiro IMO no navio e recusaria o segundo). Porto removido da Viagem
(POD com "Excluir") que volta na planilha entra com a data que tinha como
"antes" e volta ao planejamento (`deleted=false`), como na gravação pela tela;
antes a gravação recusava o arquivo para sempre como prévia obsoleta. **Gravar programação** grava tudo numa transação
(`apply_schedule_sheet_atomic`, migrations `188`, `193`, `199`, `201`, `202`, `209`, `213` e `217`, com as mesmas regras
de navio, IMO e Viagem cancelada): Viagem nova é criada uma vez, toda Viagem
enviada é publicada no Portal, dois arquivos simultâneos da mesma Viagem nova
(com e sem IMO) esperam um pelo outro e não duplicam navio nem Viagem, as travas
são pegas antes da primeira linha e em ordem fixa (dois arquivos com as mesmas
Viagens em ordens diferentes não se travam; as Viagens já cadastradas do arquivo são travadas em ordem de id antes do laço, `213`, e o navio novo também é travado pelo nome e pelo IMO, sem o número da Viagem, para dois arquivos com o mesmo navio em viagens diferentes não o cadastrarem duas vezes, `217`), o navio sem IMO achado pelo nome
recebe o IMO do arquivo, como no cadastro pela tela (`202`), cada evento de agenda leva horário próprio (a
última linha do arquivo vale), a data que a prévia viu tem de ser a vigente (outra
gravada depois recusa o arquivo como prévia obsoleta, `209`; mandar de novo a mesma
data passa) e qualquer falha desfaz o arquivo inteiro; linhas
com erro na prévia ficam de fora. Depois de gravar (planilha ou modal), a tela
atualiza as consultas pelo dono `afterViagemAlterada` (opções de Viagem, agenda,
ficha e Line-Up). O resultado fica na tela com a contagem e a lista nominal das
viagens não gravadas e das datas ignoradas; o diagnóstico do arquivo fica
recolhido. Datas aceitas: ISO ou
`DD/MM/AAAA` (parser único `src/lib/importDate.ts`; o CSV não é mais
reinterpretado como mês/dia); vazio/`X` significa "não escala". Antes do parse, o arquivo é
classificado pelo conteúdo (XLSX/XLS ou CSV), CSV Windows-1252 é aceito com
aviso, uma coluna do modelo repetida no cabeçalho (ex.: duas `VOY`) bloqueia a
leitura ("A coluna … aparece mais de uma vez no cabeçalho") e o diagnóstico do
preview informa formato, encoding, BOM e
tamanho do arquivo.

### Widget do Portal

`ShipScheduleWidget` usa `usePortalScheduleVoyages` com query key
`['portal-schedule-voyages']`. Widget e quadro interno compartilham as regras de célula de
`src/components/portal/shipScheduleCells.ts` e a apresentação de
`ShipScheduleWidget.tsx`: data efetiva (ATD no POL, ATA no POD) com `✓` e o verde
de concluído — o mesmo verde do ATD do POL descrito em
[Viagens](viagens.md#etd-e-atd-do-pol-manifesto-mercante-da-rota) —, previsão
sem marca, previsão já passada sem data efetiva como "a confirmar", `OMIT` e `X`
distintos, cada estado também em texto para leitor de tela. Colunas agrupadas em
Saída na origem (ETD) e Chegada no Brasil (ETA); abaixo de 640 px o widget vira
cartões por navio. Erro de consulta mostra "Tentar novamente" e não se confunde
com programação vazia. O serviço chama a RPC `portal_ship_schedule`,
que é `SECURITY DEFINER` e allowlisted para `anon`, retornando somente viagens
ativas com `show_on_portal = true`. PODs deletados continuam ocultos; PODs
omitidos retornam com `omitted=true` e são renderizados como `OMIT`, distinto de
`X` e sem representar uma data. O widget renderiza as colunas pela constante de
lanes e ordena pela menor ETA de POD.

## Catálogo de ações

| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
|---|---|---|---|---|---|---|---|
| Carregar publicados | Sessão interna | Montagem de `/chegadas-saidas` | `useQuery(['portal-schedule-voyages'])` | RPC `portal_ship_schedule` projetada em linhas | Preenche tabela por ETA | Erro de leitura da RPC exibido na página | **Código**, **Teste** |
| Adicionar/anexar viagem | Usuário interno ativo; navio, VOY e ao menos um POD com data | Modal | `buildScheduleLanes` + `createOrAttachVoyageFromSchedule` | `voyages.show_on_portal`, `audit_logs` POL/POD | Invalida `['portal-schedule-voyages']` e `['voyages']` | Campos obrigatórios, identidade divergente ou falha ao persistir | **Código**, **Teste** |
| Editar publicação | Usuário interno ativo; viagem já visível | Botão Editar/modal | Pré-preenche datas projetadas e salva pelo mesmo serviço | Atualiza somente ETD/ETA informados | Last write wins em ETD/ETA digitados | Conflitos de identidade e erro do serviço | **Código**, **Teste** |
| Importar planilha | Usuário interno ativo; arquivo `.xlsx/.xls/.csv` | `SpreadsheetUpload`: área de arquivo comum (`ImportFilePicker`), “Conferir prévia” e “Gravar programação”; escolher o arquivo ou conferir não grava | `parseScheduleRows` + `planScheduleSheet` (prévia) + `applyScheduleSheetPlan` → `apply_schedule_sheet_atomic` (migrations `188`, `193`, `199`, `201`, `202`, `209`, `213` e `217`) | Mesma persistência do modal, numa transação; publica a Viagem oculta | Prévia por viagem; resumo após gravar; `afterViagemAlterada` | Erro de linha aparece na prévia e a linha fica de fora; falha na gravação não grava nada | **Código**, **Teste**, **Integração em PostgreSQL local:** `programacaoPlanilha.local-pg.test.ts` |
| Consultar no Portal | Sessão do Portal | `ShipScheduleWidget` | `usePortalScheduleVoyages` | RPC `portal_ship_schedule` | Cache `['portal-schedule-voyages']` | Erro de RPC e estados vazio/loading no widget | **Código**, **Teste**, **Teste de contrato SQL** |

## Estado e dados

| Dado | Fonte atual |
|---|---|
| Visibilidade no Portal | `voyages.show_on_portal` |
| POL/ETD | `audit_logs` com `entity_type='voyage_pol_schedule'` |
| POD/ETA | `audit_logs` com `entity_type='voyage_pod_schedule'` |
| Portos-vitrine | `PORTAL_SCHEDULE_LANES` |
| Leitura do Portal | RPC `portal_ship_schedule` |

## Fluxos e invariantes

### Programação no Portal

- A Programação de Navios é a visão voltada ao cliente, distinta do Line-Up
  (TV), que é o painel operacional interno ([Operação e suporte](operacao-suporte.md#line-up)).
  Não tem cadastro próprio (ADR 0021): é a projeção das viagens com
  `show_on_portal = true`, com as suas Escalas brasileiras — inclusive as que
  só embarcam.
- A lista de portos-vitrine é única em `PORTAL_SCHEDULE_LANES`.
- `show_on_portal` controla visibilidade; viagens manuais começam ocultas.
- Viagens `completed` não aparecem na RPC do Portal.
- PODs omitidos pelo armador (`audit_logs.field_name='omitted'`) aparecem na
  projeção como `OMIT`, enquanto snapshots deletados permanecem ocultos.
- "Não escala" não cria schedule para a lane.
- Chegadas e Saídas nunca grava ATA/ATD/RTW/CE/linked.
- A ordenação do quadro é automática pela menor ETA; não há setas manuais nem
  arquivamento em `ended_vessels` no fluxo atual.
- O ATD do POL (regra em [Viagens](viagens.md#etd-e-atd-do-pol-manifesto-mercante-da-rota))
  ocupa a célula de ETD daquele porto, com `✓` e o verde de concluído, sem
  transformar ATD em ETD: o quadro não tem coluna própria de ATD.

### Saída da Programação

- A linha da viagem sai da Programação, no Vela e no Portal, quando a viagem
  recebe o último ATD e passa a Concluída; não há ação manual para isso.
- Antes do último ATD, a viagem só sai por **Excluir** ou **Cancelar viagem**
  em `/viagens`, com a confirmação e os avisos dessas ações. "Remover do
  Portal" e "Encerrar navio" não existem mais ([ADR 0071](../adr/0071-ce-mercante-como-trava-de-exclusao.md),
  item 12; `archive_vessel_schedule` foi removida na migration `087`).

## Testes e validação

- `src/pages/__tests__/chegadasSaidasForm.test.ts`
- `src/pages/__tests__/ChegadasSaidas.behavior.test.tsx`
- `src/services/__tests__/portalScheduleBulkImport.test.ts`
- `src/services/__tests__/importText.test.ts`
- `src/services/__tests__/importCore.test.ts`
- `src/services/__tests__/voyageIdentityS03.test.ts`
- `src/lib/__tests__/vesselAliasS03.test.ts`
- `src/services/__tests__/portalScheduleVoyages.test.ts`
- `src/services/__tests__/portalShipScheduleMigration.test.ts`
- `src/components/portal/__tests__/ShipScheduleWidget.test.tsx`

## Notas e divergências

- As tabelas `vessel_schedules` e `ended_vessels` seguem versionadas porque
  ambientes antigos podem tê-las, mas não são usadas pelo fluxo atual.
- A leitura das duas era `USING (true)` para qualquer `authenticated` — o que
  incluía o cliente do Portal, contornando o portão `voyages.show_on_portal`.
  A migration arquivada `257` passou a exigir `is_active_read_user()` e removeu o serviço
  e o hook mortos que as liam pela sessão do Portal. Ver
  `docs/archive/audits/security-audit-portal-2026-08-05.md`.
- A migration arquivada `314_ship_schedule_shows_omitted.sql` passou a devolver
  a escala omitida na projeção do Portal, alinhada à programação interna; a
  definição vigente de `portal_ship_schedule` está na migration `002`.
