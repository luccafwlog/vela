# Chegadas e Saídas

> **Status:** ativo · **Atualizado:** 2026-09-23 · **Rota interna:** `/chegadas-saidas` · **Consumidor:** widget do Dashboard do Portal

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
`src/components/portal/ShipScheduleWidget.tsx` e migrations `172`/`173`.

## Anatomia das telas

### Rota interna `/chegadas-saidas`

A página lista viagens com `show_on_portal = true` por
`fetchPortalScheduleVoyages()`, projetando cada viagem na grade fixa de lanes
`PORTAL_SCHEDULE_LANES`: Qingdao, Shanghai, Taicang, Ningbo, Nansha, Salvador,
Vitória e Pecém.

O modal pede navio, VOY, IMO e uma data ISO por lane. Checkbox "não escala"
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
confirmação antes (`clearedPodLabels`): o ETD/ETA publicado é removido e, se a escala não tiver
âncora operacional (manifesto vinculado, ATA/ATD ou B/L), ela é removida também
de Viagens e do Line-Up. O upload em lote nunca cancela escalas — células vazias
ou "X" são ignoradas.

A tela não tira linhas do quadro. A viagem sai da Programação sozinha ao
receber o último ATD (passa a Concluída); antes disso, só sai por Excluir ou
Cancelar em `/viagens` (ADR 0071, item 12; "Remover do Portal" foi retirado na
Fase 4a da política de exclusão).

O upload em lote baixa um template gerado da mesma constante de lanes. Cada
linha da planilha (`VESSEL NAME`, `VOY`, `IMO`, lanes ETD/ETA) vira uma chamada
ao mesmo `createOrAttachVoyageFromSchedule`. Datas aceitas: ISO ou
`DD/MM/AAAA`; vazio/`X` significa "não escala". Antes do parse, o arquivo é
classificado pelo conteúdo (XLSX/XLS ou CSV), bytes inválidos são recusados sem
fallback implícito e o diagnóstico do preview informa formato, encoding, BOM e
tamanho do arquivo.

### Widget do Portal

`ShipScheduleWidget` usa `usePortalScheduleVoyages` com query key
`['portal-schedule-voyages']`. O serviço chama a RPC `portal_ship_schedule`,
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
| Importar planilha | Usuário interno ativo; arquivo `.xlsx/.xls/.csv` | `SpreadsheetUpload` | `parseScheduleRows` + `createOrAttachVoyageFromSchedule` por linha | Mesma persistência do modal | Resumo de sucesso/erro por linha; invalida caches | Erro de parse/linha exibido no resumo; pode haver sucesso parcial | **Código**, **Teste** |
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

- A lista de portos-vitrine é única em `PORTAL_SCHEDULE_LANES`.
- `show_on_portal` controla visibilidade; viagens manuais começam ocultas.
- Viagens `completed` não aparecem na RPC do Portal.
- PODs omitidos pelo armador (`audit_logs.field_name='omitted'`) aparecem na
  projeção como `OMIT`, enquanto snapshots deletados permanecem ocultos.
- "Não escala" não cria schedule para a lane.
- Chegadas e Saídas nunca grava ATA/ATD/RTW/CE/linked.
- A ordenação do quadro é automática pela menor ETA; não há setas manuais nem
  arquivamento em `ended_vessels` no fluxo atual.

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
  A migration `257` passou a exigir `is_active_read_user()` e removeu o serviço
  e o hook mortos que as liam pela sessão do Portal. Ver
  `docs/archive/audits/security-audit-portal-2026-08-05.md`.
- A migration `314_ship_schedule_shows_omitted.sql` mantém a projeção do Portal
  alinhada à programação interna e deve acompanhar o deploy do código.
