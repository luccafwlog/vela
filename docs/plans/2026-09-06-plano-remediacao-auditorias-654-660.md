# Remediação das auditorias #654–#660 — Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediar os riscos ainda presentes após a PR #661, com fronteiras financeiras e operacionais verificáveis, sem repetir correções entregues nem revogar decisões de domínio implicitamente.

**Architecture:** Preservar Page → Hook → Service → RPC/RLS e os domínios separados de Taxas Locais e Demurrage. Concentrar mudanças que precisam ser indivisíveis em RPCs; persistir efeitos recuperáveis na transação de origem e executá-los com idempotência, estados explícitos e auditoria. Evoluir schema e consumidores por expansão, migração e contração, mantendo snapshots financeiros e históricos append-only.

**Tech Stack:** React, TypeScript, TanStack Query, Zod, Vitest, PostgreSQL/Supabase, Deno Edge Functions, pg_cron/Vault, Resend, GitHub Actions e Vercel; versões conforme o lockfile e o workflow vigentes.

---

## 1. Resumo executivo e recomendação de ordem

**Estado deste documento: execução parcial após as PRs #670–#683 (2026-09-10), com as correções de recebimento da revisão da PR #684 em 2026-09-11.** O plano continua aberto: a PR #669 foi usada como baseline e as branches subsequentes integram correções focais, mas os itens residuais permanecem tarefas obrigatórias. O histórico da auditoria e as decisões ainda não executadas não devem ser lidos como comportamento já entregue.

### 1.0 Registro de execução desta branch

As entregas desta etapa foram feitas no worktree isolado, preservando a ordem Page → Hook → Service → RPC/RLS:

- **S01–S02:** guards de RPC/entrada, revogação e validação de Preview já existentes foram preservados e cobertos por catálogo/testes (`2d23d2e6`, `e1120960`).
- **S03:** o parser Baplie passou a bloquear peso inválido, porto desconhecido/ausente e vazamento de contexto entre equipamentos, com testes focados.
- **S05:** efeitos pós-commit ganharam consumidor SQL server-only, retry/bloqueio,
  alerta persistente, painel reabrível e runner agendado fail-closed (`025`–`026`,
  `031`). Granite/veículo/BB agora possuem consumidores em código; o worker
  continua bloqueado operacionalmente até a prova de rollout.
- **S07:** eventos de email passaram a ser inbox durável, com claim, ordenação, retry, supressão, fallback e runner server-only (`022`).
- **S08–S09:** emissão de Demurrage passou a aceitar somente identidades no RPC autoritativo, gerar snapshot append-only e retirar cálculos/escritas financeiras do browser; falhas de PTAX abrem alerta persistente (`023`–`024`).
- **S11–S12:** a paridade de Inspeção ganhou os wrappers de billing paginado da migration `021`, com filtros, contagem, limites e isolamento; as listas operacionais usam projeções paginadas existentes e o Painel oferece janela incremental de viagens (`a851fbf4`, `b1444146`).
- **S13:** buscas operacionais têm debounce, as três listas principais distinguem offline sem cache de lista vazia, quatro confirmações nativas usam `ConfirmDialog`, e as tabelas/menus principais têm caption, semântica de menu e foco de teclado (`87a4d520`, `b417109d`, `b1444146`, `c58330eb`).
- **S14:** o checker executado de RPC passou a validar o catálogo ativo; documentação viva e rastreabilidade foram atualizadas (`1ff9e1bd`, `b1444146`).

### 1.0.1 Execução complementar na PR #670

- **F1/F5:** `InvoiceDocument` deixou de reconverter linhas e de usar ROE `1`; o documento usa `current_total_brl` e `demurrage_invoice_items.subtotal_brl`, exibindo indisponibilidade para histórico sem valor persistido. A migration expansiva adiciona resíduo determinístico por linha, CHECKs de faixa/proveniência e revoga `UPDATE (roe, roe_manual)` de `anon`/`authenticated`; o service não aceita mais esses campos no patch do browser.
- **S03:** os cinco callers restantes de `toNumber` foram migrados para `parseImportNumber` com formato explícito; `locateHeaderRowIndex` foi conectado ao `readSheet`/import de datas; Baplie expõe issues, exporta relatório e bloqueia staging com erro. `importValidation` e `resolvePortCode` agora têm consumidores vivos.
- **Gate SQL:** as cinco suítes antes fora do gate foram corrigidas e incorporadas ao CI. Replay local do zero: 17 arquivos / 64 testes verdes. A correção adicional de `upsert_alert_item_before_milestone_hardening` impede eventos `updated` espúrios em reconciliação idempotente.
- **S02:** o skip observado em runs de `workflow_run` sem PR é explicado pelo `if` do workflow para pushes em `main`; na execução da PR, o check Supabase passou. O segredo operacional foi corrigido fora do código e o smoke autenticado do Preview foi concluído. O workflow continua fail-closed e nenhum job foi ativado.
- **S11/S14:** o catálogo e os documentos foram atualizados; `src/types/database.ts` foi regenerado oficialmente contra o schema do Preview, preservando os aliases de domínio. A inspeção das 14 candidatas legadas encontrou zero dependências `pg_depend`, zero referências nos corpos de outras funções e zero jobs locais; sem telemetria de consumidores externos, nenhum `DROP` foi aplicado.
- **S03/P0-4:** a identidade de navio/viagem agora normaliza tokens e designações (`M/V`, `VSL`), aceita variantes pontuadas dos aliases sem casar prefixos como `CSCL`, normaliza o rótulo textual do IMO e resolve primeiro pelo IMO exato. Quando a entrada não traz IMO, um único fallback nominal canônico é permitido; múltiplas candidatas são ambíguas. Com IMO informado, o fallback só considera cadastro sem IMO e recusa conflito com outro IMO; os testes S03 cobrem prioridade, IMOs distintos, ambiguidade e grafias do alias.

- **S03/P0-2/P0-3:** a detecção de formato agora é separada do decode: XLSX/XLS são reconhecidos pelo conteúdo binário, CSV e EDI pelo conteúdo textual, e texto desconhecido ou ambíguo é recusado. O decode permanece UTF-8 estrito por padrão, aceita BOM UTF-8/UTF-16, e só usa Windows-1252 quando o parser da origem autoriza explicitamente.
- **Preview:** `inspectImportFile` expõe formato, encoding, BOM, tamanho e prévia limitada; o resultado não promete reconstituir byte a byte o texto decodificado. O `FileImportModal` mostra esse diagnóstico, e os modais de Baplie/CE exibem o encoding selecionado.
- **Integração:** `readSheet` não encaminha EDI ao leitor de planilhas; Baplie e CE Mercante validam o formato antes de parsear; os callers de planilha usam a inspeção comum sem enviar conteúdo à telemetria. CSV de uma coluna só é aceito quando o cabeçalho é operacionalmente plausível, e a assinatura Mercante exige registros posicionais; texto arbitrário continua recusado. Evidência: `importText.test.ts`, `importCore.test.ts`, `ceMercanteEdiParser.test.ts`, `baplieParser.test.ts` e `FileImportModal.test.tsx`, com vetores UTF-8/BOM, Windows-1252, bytes inválidos, formatos binários/textuais e falsos positivos de CSV/EDI.
- **S03/Baplie:** o scanner agora respeita `UNA`, separadores e release character; limita a ingestão ao conteúdo antes do trailer, isola os segmentos entre EQDs consecutivos e associa `DGS`/`DIM` à unidade correta. Duplicatas continuam bloqueantes. Evidência: `baplieParserS03.test.ts` com dialetos LOC→EQD/EQD→LOC, múltiplos EQD, OOG/IMO, EOF, duplicata e UNA customizada.

### 1.0.4 Contratos concretos de planilhas — PR em preparação sobre #674

- **S03:** Granito agora valida calendário real de `Cargo Readiness Date`,
  normaliza e valida `L/PORT`/`D/PORT`, e mantém o B/L apenas na prévia quando
  houver erro. Vazios IMP canoniza ISO/tipo/rotas, rejeita tara inválida e
  sinaliza POL/POD não reconhecidos. Embarque de Vazios reutiliza os schemas
  ISO/data existentes após normalizar container/tipo. Veículos escolhem a
  gramática numérica pelo cabeçalho da origem (pt-BR interno, en-US COSCO) e
  recusam expoente, texto residual e container não-ISO.
- **Confirmação:** Manifesto BB, Granito, Vazios IMP e Veículos não permitem
  confirmar com `rowErrors`; o parser customizado da tela de Granito também
  bloqueia a RPC defensivamente. O catálogo de portos reconhece os códigos já
  usados nas escalas (`BR*`, `ITGOA`, `NLRTM`) sem transformar código desconhecido
  em porto válido.
- **Evidência local:** 83 testes focados verdes nos parsers, schemas, modal e
  telas (`vaziosImportAdrColumns`, `vaziosImportacaoImport`, `graniteParse`,
  `vehicleImport`, `portCode`, `FileImportModal`, `VoyageImportActions` e
  `Granite`); `typecheck`, `lint`, `docs:check` e `git diff --check` também
  passaram. Nenhuma migration foi criada e não houve ativação externa.

### 1.0.5 Relatório integral e leitura cancelável — PRs #675–#676

- **S03/S13:** `rowErrorsToImportIssues` converte o legado sem carregar `raw`,
  `ImportIssuesPanel` exibe todas as ocorrências aplicáveis e oferece CSV
  sanitizado; o contrato foi conectado aos modais compartilhados e às prévias
  de Carga Solta, Granito, Vazios de Importação e Veículos. O bloqueio de erro
  continua no parser/gate e não depende apenas da quantidade exibida.
- **S13:** `FileImportModal` agora informa arquivo concluído/total durante
  leituras múltiplas e permite cancelar. O cancelamento limpa a prévia parcial
  e impede qualquer importer/RPC após o cancelamento; as assinaturas públicas
  dos parsers permaneceram compatíveis. Como os parsers atuais não recebem
  `AbortSignal`, a interrupção é observada entre arquivos e depois de cada
  parser assíncrono; não se afirma interrupção interna de um parser já em
  execução. As superfícies customizadas passaram a usar o mesmo token de
  operação: Baplie, Granito, Veículos, Datas, CE Mercante e B/Ls mostram
  arquivo atual, progresso e cancelamento antes da persistência.
- **Evidência local:** testes focados do relatório/modal, hook cancelável e
  regressões das ações de importação passaram (54 testes); `typecheck`, `lint`,
  `docs:check` e `git diff --check` passaram. Nenhuma migration foi criada e
  não houve ativação externa.

### 1.0.6 Consumidores duráveis dos efeitos — PR em preparação sobre #677

- **S05:** a migration `031_import_effect_consumers.sql` conclui os consumidores
  server-only de Granito, veículos e carga solta, além de mover os produtores
  de B/L, CE, datas e B/L de frete para a fila persistida na mesma transação da
  origem. O cálculo de Granito valida peso, vigência e valores antes de apagar
  o snapshot anterior; sem tarifa vigente falha fechado e preserva o snapshot.
- **S05:** `useImportEffects` e `ImportResultPanel` consultam o resultado por
  unidade depois de recarregar. O detalhe do B/L exibe efeitos da unidade e da
  viagem física; Granito oferece reabertura do resultado persistido e retry
  auditado de bloqueios. A mensagem exibida é sanitizada e não inclui payload
  bruto.
- **Evidência local:** PostgreSQL descartável reaplicou as migrations ativas
  `001`–`013`, `015`–`031`; a integração de efeitos cobre cálculo de Granito
  sem tarifa, preservação do snapshot, claim, dispatcher e conclusão. O gate
  focado de UI/hooks e `typecheck` passou. Nenhum worker/cron, Edge, Vault,
  Resend ou outro consumidor externo foi ativado.

### 1.0.7 Contratos estruturais dos importadores — PR em preparação sobre #678

- **S03:** Granito/COSCO, Vazios e Vazios de Importação agora localizam o
  cabeçalho por marcadores da origem, recusam colunas obrigatórias ausentes e
  preservam a linha física quando existe preâmbulo. O importador de Vazios de
  Importação também repete o bloqueio antes da RPC, caso um caller envie um
  preview com divergências. O leitor preserva células numéricas Excel nativas
  no fluxo COSCO de veículos, sem relaxar strings ambíguas ou expoentes.
- **Fixtures e evidência local:** o gate focado usa o template publicado de
  Unidades Embarcadas, a fixture `test-fixtures/qa-veiculos.xlsx`, a nova
  fixture QA anonimizada `test-fixtures/qa-vazios-importacao.csv`, o manifesto
  carrier versionado de Salvador, encoding/Baplie e identidade de viagem.
  Foram 114 testes focados verdes após o RED dos sete contratos novos.
- **Residual:** ainda não há no repositório uma planilha COSCO/Granito real
  anonimizada autorizada para fechar a prova de fixture dessa origem; ela não
  será inventada nem extraída de produção. O gate integral e essa evidência
  operacional continuam pendentes.

### 1.0.8 Estado parcial por tentativa — PR em preparação sobre #679

- **S07/A4:** a migration `032_customer_communication_partial_status.sql`
  adiciona `dispatch_mode` (`real`/`simulado`) às tentativas, amplia o CHECK do
  cabeçalho e cria `refresh_customer_communication_status`, protegido para
  `service_role`, com trigger após inserção/atualização da tentativa. Misturas
  de sucesso, simulação e falha passam a resultar em `parcial` sem perder o
  resultado individual de cada destinatário.
- **S07:** `send-customer-communication` e `demurrage-dunning` registram o modo
  da tentativa e consultam a projeção SQL em vez de sobrescrever o cabeçalho
  com um status agregado local. O resumo de CE Mercante, o histórico e o
  status da célula de faturamento exibem/filtram `Parcial`. A migration corretiva
  `041_dunning_partial_claim_recovery.sql` trata `parcial` como estado terminal
  para recuperação de claims órfãos; o dunning reutiliza a chave histórica
  persistida quando a forma canônica nova não encontra a tentativa legada.
- **Evidência local:** 27 testes focados S07 verdes e a integração PostgreSQL
  descartável confirmou a transição `enviado → parcial` ao inserir uma falha
  após uma entrega real. `typecheck` e `git diff --check` também passaram.
- **Residual:** deploy/execução dos Edge Functions, prova com o provedor e
  ativação de envio continuam pendentes; nenhum worker, cron, Vault, Resend ou
  `communications_enabled` foi ativado nesta execução.

### 1.0.9 Readiness server-side de CE Mercante — PR em preparação sobre #680

- **S10/F12:** a migration `033_customer_communication_readiness_guards.sql`
  adiciona `customer_local_charges_communication_dispatch_ready`, que valida
  todos os B/Ls ativos do cliente/viagem, trava a unidade com advisory lock e
  locks de linha, e falha fechado quando faltar CE, revisão liberada ou
  financeiro concluído.
- **S10/S07:** a mesma guarda é aplicada por trigger na criação/alteração do
  comunicado e na aquisição de claims automáticos; o Edge de envio revalida
  imediatamente antes de registrar a tentativa. A janela após a revalidação e
  antes do HTTP externo continua explicitamente limitada pela fronteira do
  provedor.
- **S07:** o runner automático aceita `parcial` como resultado resolvido do
  destinatário atual, preservando retry somente para falhas não resolvidas.
- **Evidência local:** 30 testes focados verdes, integração PostgreSQL
  descartável verde para criação/claim/envio com CE removido, `typecheck` e
  `git diff --check`. Nenhum serviço externo foi ativado.
- **Residual:** o gate de emissão/Portal e a prova operacional em Preview
  continuam separados; esta PR fecha a guarda de comunicação de CE, não a
  ativação de envio.

### 1.0.10 BR Code/Pix estático — PR #681 sobre #680

- **S08-C/F8:** a conferência do Manual de Padrões para Iniciação do Pix
  versão 2.10.0 e do Manual BR Code versão 2.0.1 confirmou que o txid estático
  fica em `62-05`, com `***` como ausência e limite de 25 caracteres; o
  Merchant Account 26 não recebe esse campo. O campo 54 continua opcional,
  decimal e limitado a 13 caracteres.
- **Decoder independente:** `src/lib/pixDecoder.ts` valida a árvore TLV, o
  CRC-16/CCITT-FALSE, GUI/chave, moeda, país, limites e charset do subconjunto
  Pix estático emitido pela aplicação. O vetor oficial do Manual Pix termina
  em `63041D3D` e passa; CRC adulterado, txid inválido/longo e campo 05 em 26
  falham.
- **Evidência local:** builder TS e builder SQL passaram pelo decoder
  independente; a integração PostgreSQL validou o payload SQL, o CRC oficial,
  truncamento do txid e falha fechada para valor fora do limite. `typecheck`,
  `docs:check` e `git diff --check` passaram.
- **Residual:** a prova cobre QR Code Pix estático. Fluxos dinâmicos,
  compostos, Pix Automático, DICT, decoder de terceiro e execução em PSP
  continuam fora deste contrato e não são declarados conformes por ele.

### 1.0.11 Read-model operacional de viagens — PR #682 sobre #681

- **S12:** `operational_list_voyage_summaries` (`035`) entrega uma página
  resumida de viagens com rotas, modalidade de carga, cobertura de CE,
  containers e Baplie agregados no servidor. `useVoyages` deixou de carregar
  manifests, bookings e B/Ls completos para todo o rail; `useVoyageDetail`
  busca o detalhe apenas da viagem selecionada.
- **S12:** `LineUp` projeta `bl_containers` junto com os B/Ls e elimina a
  consulta secundária por lista de IDs; o contador de vazios de importação usa
  relação `inner` direta. EmbarqueVazios, `agencyDepartureReport` e Baplie
  compartilham a projeção pequena de rotas/rail e as consultas de Baplie
  passaram a declarar as colunas necessárias.
- **Evidência local:** typecheck, lint, `docs:check`, `rpc:check`, diff check,
  testes focados de read-model/Viagens/Line Up e replay PostgreSQL com a
  integração de agregados passaram. O benchmark local foi concluído na seção
  1.0.12; Preview autenticado e a prova manual permanecem pendentes e não são
  afirmados por esta entrega.

### 1.0.12 Benchmark S12 e contraste S13 — PR #683 sobre #682

- **S12:** o caminho normal dos hooks de listas chama diretamente as RPCs
  paginadas; os full-scans de compatibilidade foram removidos dos hooks. O
  resumo de Carga Solta passou a ser server-side na migration `036`, mantendo
  no cliente somente a exportação solicitada pelo usuário. A leitura de detalhe
  do Baplie foi extraída para `baplieReadModel.ts`, com projeção explícita,
  paginação por viagem e teste do contrato de existência de B/L. A correção
  forward de status nullable do rail está em `037`, sem editar a migration
  `035` histórica.
- **Medição local reproduzível:** com cinco rodadas, rollback por cenário,
  `ANALYZE` das tabelas sintéticas dentro da transação e três viagens/quatro
  rotas, o resumo teve p95 de `3,846/4,827/16,225 ms` para
  `100/1.000/10.000` B/Ls, contra `7,534/76,544/614,319 ms` do baseline
  pesado. Os bytes p95 foram `3.023/3.085/3.147` contra
  `205.971/2.055.752/20.589.687`; o `EXPLAIN` de 10.000 mediu `15,462 ms`
  contra `560,075 ms`. O `ANALYZE` evita que a medição escolha um plano
  baseado em cardinalidade vazia para os dados recém-inseridos.
- **S13:** `npm run a11y:contrast` passou 20 pares de tokens nos temas light e
  dark com mínimo 4,5:1, ajustando `muted-soft` e verde no light e
  `muted-soft` no dark. O roteiro manual de Preview, leitor de tela, foco,
  modal sujo e reconnect continua obrigatório.
- **Bloqueio explícito:** `npm run perf:authenticated-startup` foi executado e
  encerrou com código 2 por ausência de `PERF_BASE_URL`,
  `PERF_USER_EMAIL` e `PERF_USER_PASSWORD`; nenhuma credencial foi inventada
  ou persistida.

### 1.0.13 Recebimento da segunda revisão — PR #684

- **S03/importação:** a detecção de formato deixou de aceitar qualquer linha
  `M<dígitos>` como EDI e deixou de promover prosa a CSV; CSV de uma coluna
  exige cabeçalho operacional plausível. `readFirstSheetRows` entrega `rowNumber`
  físico 1-based, inclusive após linhas vazias, e os parsers usam esse valor sem
  renumerar a prévia.
- **S03/override:** `allowRowErrors` é separado de `allowPending`. As seis
  superfícies de importação previstas oferecem o override de erros de linha
  quando aplicável; erros de documento e de viagem continuam bloqueantes, e
  portos desconhecidos não são persistidos como texto cru.
- **S07/S14:** `parcial` permanece terminal para recuperação de claims de
  dunning na migration corretiva `041_dunning_partial_claim_recovery.sql`.
  Tentativas legadas reutilizam a chave de idempotência persistida, mesmo após
  a normalização da identidade do destinatário. A migration `040` e a nova
  migration `041` têm testes de contrato e linhas próprias em
  `docs/RASTREABILIDADE.md`; helpers sem caller de produção foram removidos.

### 1.0.2 Fechamento da revisão da PR #670

- O import de datas agora rejeita datas de calendário impossíveis e duplicatas conflitantes BL+container; quando um container não existe, o B/L inteiro é ignorado antes do RPC para preservar a atomicidade. Duplicatas idênticas continuam idempotentes.
- O documento de Demurrage recebeu um DTO explícito. A impressão da Conciliação PIX passou a achatar corretamente `{ invoice, items }`, removendo casts que mascaravam a ausência de `doc_number`, totais e dados do cliente no recibo.
- O replay limpo `001`–`013` e `015`–`030` aplicou 29 migrations; as 17 suítes SQL seriais passaram com 64 testes. O smoke autenticado no Preview confirmou importação de `01/08/2026` como `2026-08-01`, emissão/baixa de Demurrage com desconto de 10% (`DEM-2026-O5K9531`, R$ 1.319,32), documento com ROE/subtotal/desconto/total persistidos e paridade Portal/Inspeção com paginação.

O resultado não encerra o plano: a matriz abaixo ainda contém itens **Pendente** ou **Precisa de investigação**, incluindo validações estruturais/fixtures reais de parsers (S03), readiness de emissão/comunicação, BR Code/cache e execução real de PTAX (S08–S10), fallbacks e benchmarks de leitura (S12), contraste e validação manual de acessibilidade (S13) e prova de consumidores externos antes de qualquer `DROP` (S14). A ausência de deploy/execução remota de Edge, Vault, Resend, BCB e cron também permanece uma lacuna operacional; a chave de Comunicados, workers e cron continuam desligados.

Validação anterior do baseline está preservada no histórico abaixo. Nesta
integração, `npm test -- --run` passou com 558 arquivos, 2.954 testes aprovados
e 91 ignorados; typecheck, lint, build, `npm run docs:check` (428 Markdown/49
rotas), `npm run rpc:check` (168 RPCs), size-limit e `git diff --check` também
passaram. As 17 suítes locais opt-in de Postgres passaram com 64 testes. O
Preview teve smoke autenticado concluído, mas Edge Functions, Vault, Resend,
BCB e cron não foram ativados nem tratados como prova de produção.

### 1.0.3 Checklist operacional para o próximo agente

Esta seção é a leitura rápida do plano em **2026-09-10**. Um `[x]` significa
que a implementação correspondente existe no código desta linha e possui a
evidência indicada na seção 1.0/1.0.1/1.0.2 ou nos gates abaixo. Um `[ ]`
significa trabalho obrigatório ainda aberto. `Mitigado parcialmente` não deve
ser promovido a concluído apenas porque o caminho principal está verde.

#### Entregas já concluídas nesta linha

- [x] **S01 — segurança e catálogo:** migration 009, guards de entrada,
  revogações, testes SQL com roles e security/RPC catalog gates.
- [x] **S02 — lifecycle do Preview:** decisão pura de readiness, consulta do
  SHA exato, tratamento fail-closed de `skipped`/PR obsoleta e smoke
  autenticado no Preview atual.
- [x] **S03/P0-1 e parte de P0-2/P0-3:** `parseImportNumber` por formato,
  callers de produção migrados, validação bloqueante do Baplie, issues visíveis,
  `locateHeaderRowIndex` conectado ao import de datas e `resolvePortCode` vivo.
- [x] **S04 — núcleo de atomicidade:** datas por B/L, flags físicas do Baplie,
  metadados de import, CE por B/L/EDI e cadastro de clientes possuem RPCs
  transacionais e cobertura local opt-in.
- [x] **S05 — recuperação durável entregue em código:** outbox, claim/lease/retry,
  worker server-only, alertas de bloqueio e consumidores de efeitos local,
  Granito, veículos e carga solta; o painel reabre resultados persistidos.
  A ativação operacional do worker/cron continua separada e pendente.
- [x] **S06/S07 — elegibilidade, agrupamento e inbox:** fallback restrito ao
  principal, elegibilidade sem `customer_contact_preferences`, agrupamento D11,
  chave D04 para bounce, inbox durável, estados truthful, idempotência e
  reconciliação de alertas.
- [x] **S08-A/S08-B — autoridade financeira implementada:** guards de baixa e
  desconto, snapshot append-only, cálculo server-side, ROE/PTAX com procedência,
  documento derivado do persistido e PIX gerado pelo núcleo SQL.
- [x] **S09 — código de procedência e recálculo:** referência BCB/manual,
  retry/alerta de falha, gateway fail-closed e configuração do job inativo.
  A execução remota/ativação continua pendente; não confundir código pronto com
  job operacional comprovado.
- [x] **S10/F14 — centavo do ledger local:** saldo positivo de R$ 0,01 permanece
  aberto, com pagamento manual/PIX e integração SQL cobertos.
- [x] **S11 — Inspeção, Portal e tipos:** wrappers de leitura, paridade de
  escopo, paginação de billing, tipos regenerados do schema e correção dos
  payloads/documentos tipados.
- [x] **S12 — primeira entrega de leitura proporcional:** projeções paginadas,
  read-model resumido de viagens, detalhe sob demanda, redução do waterfall do
  Line Up, paginação de Portal, janela incremental do Painel e debounce/limites
  dos caminhos implementados.
- [x] **S13 — fundamentos de UX:** debounce, estados offline/error distintos,
  hidratação de perfil, confirmações compartilhadas e semântica/foco das tabelas
  e menus principais.
- [x] **S14 — gates documentais e de catálogo:** `docs:check`, catálogo RPC
  executado, replay de 29 migrations, tipos oficiais e inspeção local das
  candidatas legadas; nenhuma função/coluna foi removida.

#### Pendências que devem orientar o próximo agente

- [x] **S03/P0-4:** identidade canônica concluída em `src/lib/vesselAlias.ts`
  e `src/services/voyages.ts`: IMO exato tem prioridade sobre grafia e
  cadastros sem IMO quando necessário, aliases são comparados por tokens com
  designações de navio removidas, conflito com IMO distinto retorna ausência e
  ambiguidade gera erro explícito. Evidência: `vesselAliasS03.test.ts` e
  `voyageIdentityS03.test.ts` (12 testes de identidade verdes); não há `.find()`
  na resolução.
- [x] **S03 — formato e encoding:** `detectImportFormat` separa XLS/XLSX binário
  de CSV/EDI textual, recusa conteúdo desconhecido/ambíguo, mantém UTF-8 estrito
  e fallback 1252 explícito, aceita CSV de uma coluna apenas com cabeçalho
  operacional plausível e fornece prévia limitada com formato/encoding/BOM no
  modal compartilhado. Evidência: vetores
  em `importText.test.ts`, `importCore.test.ts`, `ceMercanteEdiParser.test.ts`,
  `baplieParser.test.ts` e `FileImportModal.test.tsx`.
- [x] **S03 — contratos estruturais:** Granito/COSCO, Vazios e Vazios IMP
  recusam marcadores obrigatórios ausentes, aceitam preâmbulo sem deslocar a
  linha física e mantêm o gate antes da RPC; o leitor de veículos preserva
  números Excel nativos. Erros de linha bloqueiam por padrão e só são aceitos
  com `allowRowErrors` explícito; `allowPending` continua reservado à
  reconciliação de cliente em Granito. Evidência: testes focados de importação,
  fixture QA de veículos, fixture QA de Vazios IMP, Baplie, encoding e
  identidade.
- [ ] **S03 residual:** fechar o gate com uma planilha COSCO/Granito real
  anonimizada autorizada e executar a suíte integral nesta linha. Os contratos
  de ISO, tara, datas/ordem, portos, linha física, detecção de formato e
  relatório compartilhado já foram entregues; o bloqueio padrão de
  `rowErrors` tem override explícito nas superfícies aplicáveis e não substitui
  os bloqueios de documento/viagem.
- [x] **S04/S05 código:** caudas de veículo, Granite e Breakbulk, relatório
  durável por unidade e consumidores server-side foram completados na migration
  `031_import_effect_consumers.sql`, com teste focado e integração de Granito.
- [ ] **S05 runtime:** o worker continua fail-closed/inativo até prova no
  Preview, secrets/Vault/Edge coerentes e autorização de rollout.
- [x] **S06/S07 de código:** não reabrir A1/A3/A4/A5/A6/A7/A8/A9 como se fossem
  tarefas novas; D04 e D11 já possuem implementação e testes.
- [ ] **S06/S07 runtime:** provar limites/provedor/Edge e eventual liberação de
  envio, bloqueada por D10; não ativar `communications_enabled` nesta execução.
- [x] **S08-C/F8 — escopo Pix estático:** Manual Pix 2.10.0 e Manual BR Code
  2.0.1 conferidos; builder TS/SQL corrigido para 26/00+01 e 62/05, com
  limite/charset de txid, campo 54 e CRC validados pelo decoder independente.
  O resultado não cobre QR dinâmico/composto nem execução em PSP.
- [ ] **S08/S09 runtime:** repetir prova sob roles reais no Preview para ACL,
  gateway, Vault e Edge; verificar falha/recuperação de PTAX e uma execução
  agendada. O job deve continuar inativo até esse aceite.
- [x] **S10/F12 — comunicação:** criação, claim e dispatch de CE Mercante
  revalidam no servidor CE, revisão e financeiro dos B/Ls ativos, com lock e
  identidade de serviço. **Residual:** o gate de emissão/Portal e a prova
  operacional remota permanecem separados; não reescrever pagamentos nem
  ativar envio.
- [x] **S12 — benchmark local:** medir 100/1.000/10.000 B/Ls com containers
  compartilhados, múltiplas escalas, requests SQL, bytes, EXPLAIN e p95; o
  harness termina cada cenário em rollback e registra o ambiente.
- [ ] **S12 residual:** reavaliar materialização de exportações explícitas,
  concluir a prova de refresh sem N+1 em todos os consumidores e repetir a
  medição autenticada no Preview.
- [x] **S13 — contraste de tokens:** gate automatizado mediu os dois temas e
  ajustou os pares abaixo de 4,5:1; componentes reais, estados hover/disabled e
  status compostos continuam no roteiro manual.
- [ ] **S13 residual:** executar roteiro manual de teclado/leitor de tela/modal
  sujo/offline e ceder execução entre blocos. O progresso/cancelamento dos
  uploads customizados está implementado; não introduzir worker ou
  virtualização sem benchmark.
- [ ] **S14 residual:** completar mapa literal rota → hook → service → RPC →
  tabela → teste; provar consumidores externos e dados das quatro colunas antes
  de qualquer `DROP RESTRICT`; manter funções fechadas se a ausência externa não
  puder ser provada e deixar DV sem bloqueio até decisão de dados reais.

**Regra de encerramento:** o agente seguinte deve marcar um bullet como `[x]`
somente depois de implementar, testar e registrar a evidência específica. Não
marcar uma seção inteira por herança: S03, S04/S05, S08-C, S09 runtime, S10,
S12, S13 e S14 ainda têm bullets abertos. O plano só pode ser arquivado quando
esses bullets estiverem concluídos, aceitos formalmente ou reclassificados com
uma decisão registrada.

### 1.1 Baseline e alcance da evidência

- **Código:** o baseline de `main` foi conferido no merge da PR #661 e a PR #669 foi adotada como baseline de integração. A árvore original estava limpa; nesta branch as migrations ativas relevantes incluem `009`–`013`, `015`–`041` (a numeração `014` permanece ausente). O arquivo histórico não é a definição final do banco.
- Fonte dos identificadores: [auditoria consolidada](../archive/audits/2026-09-06-auditoria-consolidada-prs-654-660.md). Preservar esse registro integralmente. Nas seções sem ID, usar o número e o título original; os sufixos deste plano apenas desdobram causas diferentes.
- Fontes de decisão: [AGENTS.md](../../AGENTS.md), [CONTEXT.md](../../CONTEXT.md), [WORKFLOW.md](../../WORKFLOW.md), [arquitetura](../ARCHITECTURE.md), [rastreabilidade](../RASTREABILIDADE.md), [convenções](../CONVENCOES.md) e [índice de ADRs](../adr/README.md).
- **Código** significa confirmação estática no baseline. **Teste de contrato SQL** significa inspeção textual de SQL; não prova execução, concorrência, grants efetivos ou PostgREST. Testes citados abaixo são existentes ou propostos, com essa distinção explícita; não foram executados para afirmar que uma remediação funciona.
- **Runtime histórico:** catálogo, volumetria e jobs citados na #659 pertencem à auditoria original. Não foi feita nova consulta ao banco de produção nesta sessão. Não presumir que a base continua vazia, que há exatamente 216 RPCs expostas ou que os volumes históricos representam a operação atual.
- **Runtime nesta sessão:** a PR #670 teve smoke autenticado no Preview e os checks do SHA `fb5db0c5` passaram. Não foram ativados cron, Edge Function, Vault, Resend, BCB ou envio real; essa ausência continua sendo uma pendência operacional quando o plano exigir prova remota.

### 1.2 Ordem por risco

1. **Fechar fronteiras pequenas e confirmadas:** grants, revogação de sessão e guards de entrada (S01); tornar a validação de Preview confiável (S02). Não condicionar um REVOKE urgente à conclusão de uma refatoração ampla.
2. **Impedir destinatário indevido e valor inválido:** roteamento de caixas (S06), baixa/discount/PIX de Demurrage (S08, primeira entrega). Corrigir a fronteira numérica dos imports em paralelo lógico (S03), sem depender de uma plataforma de importação nova.
3. **Restaurar atualização financeira automática de forma segura:** procedência de ROE/PTAX e job real (S09). Agendar somente depois de validar a autenticação da Edge e o contrato de recálculo.
4. **Eliminar perdas após commit:** atomicidade do import e da auditoria (S04), recuperação persistente (S05), inbox e estados dos comunicados (S07). Telemetria existente permanece; não é substituto de retry.
5. **Fechar coerência de documentos, ledger e prontidão:** restante de S08 e S10. Corrigir Inspeção e tipos (S11) cedo o suficiente para apoiar os novos contratos.
6. **Reduzir carga de leitura e erros de interação:** S12 e S13. Debounce, offline e acessibilidade podem sair antes das RPCs de paginação.
7. **Completar rastreabilidade e retirar legado comprovado:** S14. Os testes de catálogo que protegem segurança começam em S01, não esperam a limpeza final.

P0/P1/P2 neste plano indicam ordem de tratamento, não reclassificação retroativa das severidades originais. Uma dependência de decisão bloqueia apenas sua tarefa. Não usar a existência de decisões abertas para adiar correções independentes.

### 1.3 Provision Preview Admin: implementação concluída e limite da evidência

**Código entregue:** `scripts/preview-readiness.mjs` agora distingue `ready`,
`wait`, `failed`, `investigate` e `obsolete`; o workflow consulta o SHA exato,
pagina os check-runs, exige o app Supabase esperado, revalida estado/SHA antes
de carregar credenciais e nunca transforma `skipped` em sucesso. A guarda de
alvo, o carregamento de dotenv e a validação de senha também estão cobertos por
testes e pelo workflow.

**Evidência desta linha:** o check Supabase Preview da PR #670 passou e o smoke
autenticado foi concluído. Os runs antigos [34039653860](https://github.com/luccafwlog/transhippingdesk/actions/runs/34039653860)
e [34039757857](https://github.com/luccafwlog/transhippingdesk/actions/runs/34039757857)
continuam como histórico de diagnóstico, não como estado atual.

**Pendente operacional:** não alterar o fail-closed. Uma futura ativação ainda
precisa comprovar secret/Vault/Edge e login QA no ambiente correto; nenhuma
credencial de produção deve ser usada como fallback.

## 2. Matriz completa de classificação

Categorias utilizadas literalmente: **Já corrigido**, **Mitigado parcialmente**, **Pendente**, **Aceito**, **Precisa de investigação**. Uma linha desdobrada pode ter classificação distinta da outra metade do mesmo achado. Toda linha pendente tem subprojeto; itens aceitos e já corrigidos não voltam como implementação.

### 2.1 PR #654 — parsing, ingestão e identidade

| ID original | Classificação | Evidência atual e trabalho residual | Destino |
|---|---|---|---|
| P0-1 / §2.2 | Já corrigido | Todos os callers de produção identificados usam `parseImportNumber` com formato explícito; `toNumber` permanece apenas como helper de compatibilidade sem caller de produção. Testes cobrem `1e3`, separadores, vazio, zero e não finitos. | Regressão S03 |
| P0-2 | Mitigado parcialmente | Baplie agora transforma grupo físico inválido em issue bloqueante, mostra o relatório e impede staging; a semântica completa de identidade/UNA e importadores legados ainda exige regressão. | S03 |
| P0-3 / §2.1 | Mitigado parcialmente | `readSheet` agora localiza a linha de cabeçalho com janela/aliases e o import de datas usa a linha real; o recorte de bytes/decodificação de todos os parsers ainda não foi uniformizado. | S03 |
| P0-4 / §§5.1–5.3 | Já corrigido | `vesselAlias.ts` tokeniza designações e aliases pontuados com fronteira segura; `findVoyageByNumberAndVessel` prioriza IMO exato, rejeita conflito conhecido e não escolhe arbitrariamente entre candidatas. Testes cobrem grafias, prioridade, IMOs distintos e ambiguidade. | Regressão S03 |
| P1-5 / §3.2, igual a #657 P1-01 | Mitigado parcialmente | Datas por B/L usam RPC transacional; o caller rejeita datas impossíveis, duplicata conflitante e container ausente antes de aplicar, preserva outros B/Ls e impede faturamento do B/L falho. Continua pendente a unidade transacional de efeitos posteriores e o consumidor completo de cada cauda. | S04 + S05 |
| §2.3 — colunas e cabeçalho | Mitigado parcialmente | `locateHeaderRowIndex`/aliases foram conectados ao core de planilhas e ao import de datas; layouts fixos como COSCO ainda precisam de assinatura explícita. | S03 |
| §2.4 — datas | Mitigado parcialmente | O import de datas rejeita calendário impossível, mas a política ainda difere entre planilhas e alguns parsers podem transformar formatos inválidos/ambíguos em ausência. Manter inferência de ano apenas onde já é contrato de programação. | S03 |
| §2.5 — dado inválido | Mitigado parcialmente | Baplie agora preserva severidade, exibe issues e bloqueia erro; Vazios IMP e alguns fluxos de tara ainda precisam de contrato de rejeição próprio. | S03 |
| §2.6 — porto desconhecido | Mitigado parcialmente | Baplie usa `resolvePortCode` e bloqueia porto ausente/desconhecido; os demais importadores ainda precisam convergir para o mesmo resultado explícito. | S03 |
| §3.1 — imports já transacionais | Aceito | Preservar RPCs atômicas existentes; reexecutar seus contratos ao alterar helpers comuns. Não reconstruir esses imports. | Regressão S03/S04 |
| §3.3 — caudas BL/veículos/clientes/BB | Mitigado parcialmente | Núcleos persistem, mas lote/vínculo, efeitos de veículos e cadastro seguido de contatos têm fronteiras distintas; erros já visíveis não equivalem a rollback. | S04 + S05 |
| §3.4 — CE por linha vs manifesto | Já corrigido | `apply_ce_mercante_update` é atômica por B/L e `apply_ce_mercante_manifest` valida/aplica o EDI como conjunto; a distinção entre `bls` e Granito está explícita. Relatório durável de efeitos posteriores continua em S05. | S05 residual |
| §3.5 — feedback truncado/efêmero | Pendente | Limites de exibição ocultam erros; BB já persiste parte do relatório. Evoluir relatório completo com severidade e estado aplicado. | S03 + S05 |
| §4 / §6.7 — main thread e uploads | Mitigado parcialmente | Limites e import dinâmico existem; faltam progresso/cessão de execução e validação uniforme de extensão em Chegadas e Saídas. Tempos históricos não são benchmark atual. | S03/S13 |
| §6.2 — schemas de saída | Pendente | Validar contratos concretos de cada parser após normalização, com Zod existente; sem framework genérico ou correção duplicada em cada tela. | S03 |
| §6.6 — tabela de aliases; §6.7 — worker | Precisa de investigação | Persistência de aliases e worker só com ambiguidade operacional ou bloqueio medido; parser Baplie >3 MB é gatilho sugerido, não obrigação de aumentar limite. | S03, §8 |

### 2.2 PR #655 — comunicação

| ID | Classificação | Evidência atual e trabalho residual | Destino |
|---|---|---|---|
| A1 | Já corrigido | Migration 010 restringe o reparo ao principal elegível, sem escolher contato arbitrário; o alerta cadastral e a auditoria permanecem. | Regressão S06 |
| A2 | Mitigado parcialmente | Webhook, inbox, claim/lease, processador server-only e investigação de tentativa sem vínculo estão implementados e testados. A prova de deploy remoto, retry real e observabilidade do provedor permanece pendente. | S07 / D10 |
| A3 | Já corrigido | Claim filtra elegibilidade, respeita caixas/supressões, libera claims e permite que elegíveis após inelegíveis entrem no lote; revalidação ocorre antes do envio. | Regressão S06/S07 |
| A4 | Mitigado parcialmente | `simulado` só é emitido quando o canal está desativado e o caminho termina; tentativas agora persistem o modo e o cabeçalho é recalculado como `parcial` quando há mistura de entrega, simulação e falha. Prova de deploy/provedor continua pendente. | S07 |
| A5 | Mitigado parcialmente | Novas tentativas usam comunicação, contato e versão do destinatário, sem email na chave; identidades históricas e a migração completa da unicidade lógica ainda precisam ser fechadas. | S07 |
| A6 — volume por cliente | Já corrigido | D11 está implementada: grupo por cliente/ciclo, membership por invoice, uma mensagem por destinatário e faturas individuais preservadas; integração cobre 12 faturas/3 contatos e grupos que cruzam o limite do claim. | Regressão S06; ativação D10 |
| Régua contínua até liquidação | Aceito | Preservar repetição semanal sem máximo de semanas, conforme CONTEXT; decisão de volume por cliente em A6 é separada. | §8 |
| A7 | Já corrigido | O processador de bounce consulta `communications_enabled` somente para o aviso externo; supressão, reparo de caixas e alerta interno permanecem ativos com a chave desligada. | Regressão S06/S07 |
| A8 | Mitigado parcialmente | Deduplicação de tentativa/provider e membership de grupos são idempotentes; o índice histórico de `customer_communications` ainda contém `status` e precisa de reconciliação antes de ser contraído. | S07 |
| A9 | Já corrigido | Migration 010 retirou a leitura de produção de `customer_contact_preferences`; tabela/coluna ficam somente para compatibilidade/rollback. | Regressão S06 |

### 2.3 PR #656 — performance e UX

| ID / seção original | Classificação | Evidência atual e trabalho residual | Destino |
|---|---|---|---|
| Achado 1 / §1.1 / §3.3 — buscas e resumo de B/L | Mitigado parcialmente | Migration `020_operational_read_pages.sql`/`036` e `operationalLists.ts` limitam resposta e agregados na rota RPC; exportações explícitas ainda materializam o conjunto solicitado. | S12 |
| Achado 2 / §1.2 — `useContainers` | Mitigado parcialmente | A rota RPC pagina containers e calcula agregados no servidor; a exportação sob demanda ainda achata o conjunto completo filtrado para gerar o arquivo. | S12 |
| Achado 3 / §1.3 — `useVoyages` | Mitigado parcialmente | `useVoyages` consome `operational_list_voyage_summaries` e `useVoyageDetail` carrega o detalhe da viagem selecionada; fallback de compatibilidade e prova de escala real ainda exigem benchmark. | S12 |
| Achado 4 / §1.4 — ausência de memoização | Precisa de investigação | Ausência de `React.memo` não prova lentidão. Medir commits e props; memoizar somente hotspot demonstrado. | S12/S13 |
| Achado 5 / §1.5 — Line Up TV | Mitigado parcialmente | `Painel` consulta janela inicial de 60 viagens, informa o total e oferece “Carregar mais”; o snapshot eliminou o waterfall B/L → containers e há benchmark local, mas o refresh autenticado da TV ainda exige medição. | S12 |
| Achado 6 / §2 — listeners | Já corrigido | `src/pages/Containers.tsx` e `src/pages/Manifestos.tsx` usam `useEffect` e cleanup nos menus de ações. Não planejar nova troca de lifecycle. | Só regressão existente |
| §3.1 — retry/cache existentes | Aceito | Preservar configuração compartilhada e persistência de preferências já funcionais; não substituir TanStack Query. | Regressão S13 |
| Achado 7 / §3.2 — offline como vazio | Mitigado parcialmente | `QueryStateGate` cobre as listas principais e distingue query pausada sem cache de dados salvos; outras superfícies e o roteiro manual de reconnect ainda precisam de prova. | S13 |
| §4 — virtualização | Aceito | Paginação de 20–100 linhas não justifica virtualizar tudo. Investigar somente lista real >300 linhas ou profiler mostrando custo. | §8 |
| §5.1 — confirmações e modal sujo | Mitigado parcialmente | As quatro confirmações nativas auditadas agora usam `ConfirmDialog` com efeito descrito; proteção completa de formulário sujo e foco manual ainda não foi comprovada. | S13 |
| Achado 8 / §5.2 — contraste | Pendente | Tokens de texto secundário e cores de status precisam medição em ambos os temas; contagem histórica de 78 usos não é gate. | S13 |
| Achado 9 / §5.3 — teclado/tabelas | Mitigado parcialmente | Tabelas principais receberam `caption` e `scope`; menus e linhas expansíveis ainda precisam de operação por teclado/foco de retorno. | S13 |

### 2.4 PR #657 — transações, erros e sessão

| ID | Classificação | Evidência atual e trabalho residual | Destino |
|---|---|---|---|
| P1-01 | Mitigado parcialmente | Proteção contra emissão após update falho e RPC atômica por B/L entregues; efeitos dependentes e consumidores de veículo/Granite/BB ainda exigem recuperação durável. | S04/S05 |
| P1-02 — observabilidade | Já corrigido | Catches pós-CE registram `reportBestEffortFailure`; não recriar logging como solução. | Preservar |
| P1-02 — retry/fila/feedback | Mitigado parcialmente | `import_pending_effects` e `import-effects-runner` preservam lease, retry, bloqueio e histórico após o commit; o consumidor segue fail-closed e Granite/veículo continuam sem implementação completa. | S05 |
| P2-01 | Já corrigido | `import_bl_freight_with_metadata` valida viagem/pertencimento e grava batch/vínculo no mesmo contrato; batch continua opcional para B/L avulso conforme ADR 0017. | Regressão S04 |
| P2-02 — observabilidade | Já corrigido | Falhas de flags Baplie e taxas provisórias têm telemetria. | Preservar |
| P2-02 — ordenação/retry | Mitigado parcialmente | Outbox persiste dependência, prioridade, lease e retry; flags/provisional/local/demurrage têm consumidor SQL para os tipos suportados. Caudas sem consumidor completo permanecem `blocked` e devem aparecer no relatório. | S05 residual |
| P3-01 | Já corrigido | `omit_voyage_escala` serializa por viagem/escala e traduz somente a violação esperada de omissão; demais `unique_violation` não são engolidas. | Regressão S04 |
| P3-02 | Mitigado parcialmente | `useMarkInternalNotificationRead` restaura item/contador no erro e o sino exibe toast com retry; permanece validação manual de estados de rede. | S13 |
| P3-03 | Mitigado parcialmente | `useAuth` limpa perfil ao falhar hidratação e diferencia falha transitória de sessão; ainda falta roteiro manual completo para hidratação inicial, troca de usuário, timeout e inativo/revogado. | S13 |
| §§2–4 sem achado | Aceito | Não abrir refatoração genérica de RLS, cache, tradução de erros ou duplo clique; manter regressões dos contratos já protegidos. | §6 |

### 2.5 PR #658 — dinheiro, câmbio e documentos

| ID | Classificação | Evidência atual e trabalho residual | Destino |
|---|---|---|---|
| F1 | Já corrigido | `InvoiceDocument` lê `subtotal_brl`/`current_total_brl`, usa DTO explícito e não reconverte por linha nem usa ROE 1; snapshot e documento preservam o resíduo persistido. Histórico sem valor BRL é marcado como indisponível. | Regressão S08 |
| F2 — contrato de confirmação | Já corrigido | `register_demurrage_payment` e `apply_demurrage_discount` são os contratos tipados, idempotentes e guardados; callers antigos de baixa arbitrária não são mais usados pelo browser. | Regressão S08 |
| F2 — baixa arbitrária persistida | Mitigado parcialmente | O guard local/CI e as ACLs impedem escrita direta do browser; a confirmação sob roles reais de Preview continua evidência operacional obrigatória antes de classificar explorabilidade como encerrada. | S08 runtime |
| F3 | Já corrigido | Desconto fora de 0–100/total é recusado no núcleo SQL; zero não gera QR pagável e total negativo não persiste. | Regressão S08 |
| F4 — autoridade server-side | Já corrigido no código | RPC autoritativo resolve containers, datas, tarifas/acordos/overrides, ROE/PTAX e PIX; snapshots append-only possuem versão/hash. A prova remota de roles e os fluxos financeiros residuais são pendência operacional/S10, não motivo para reimplementar o núcleo. | S08 runtime/S10 |
| F4 — validade do cache | Já corrigido | Falha de refresh não renova `loadedAt`, o estado stale é exposto e emissão exige tarifa fresca; leitura pode manter dado antigo com erro/idade visíveis. | Regressão S08 |
| F5 | Já corrigido no código | Override manual exige valor válido, `roe_source` é controlado e UPDATE direto de `roe`/`roe_manual` foi revogado; prova remota do writer interno segue em S09 runtime. | S09 runtime |
| F6 — quantidade/fracionamento | Mitigado parcialmente | SQL distribui resíduo determinístico e documentos usam valor persistido; a apresentação da fração compartilhada ainda precisa explicar claramente `1/7` e a consulta diagnóstica de irmãos continua aberta. | S10 |
| F6 — B/L irmão tardio | Aceito | Risco residual reconhecido pela ADR 0020, complemento de 06/08: irmãos recebem CE juntos. Não recalcular/faturar irmãos automaticamente sem mudança dessa premissa. Validar ocorrência atual e promover decisão se houver evidência. | S10 diagnóstico / D05 |
| F7 | Já corrigido no código | Emissão SQL é a autoridade do payload PIX; browser não persiste uma versão financeira paralela. Ainda falta prova normativa/runtime independente. | S08-C/runtime |
| F8 | Mitigado parcialmente | Manual Pix 2.10.0/BR Code 2.0.1, decoder independente e correção dos subcampos 26/00+01, 62/05, campo 54, txid e CRC estão entregues na PR #681; QR dinâmico/composto e execução em PSP continuam fora do contrato. | S08-C/runtime |
| F9 | Já corrigido no código | Snapshot inicial usa PTAX factual para origem BCB/cached e permite `ptax = NULL` somente para manual com ROE; migration 030 corrigiu a coluna real `ptax`. | Regressão S09 |
| F10 | Já corrigido no código | Spread canônico está no cálculo SQL e os valores/versionamento são persistidos; manter uma única função ao evoluir. | Regressão S09 |
| F11 | Já corrigido | Browser usa contratos `register_demurrage_payment`/`apply_demurrage_discount`; histórico financeiro segue protegido e a integração local cobre idempotência/locks. | Regressão S08 |
| F12 | Mitigado parcialmente | A PR #680 revalida CE, revisão e financeiro no servidor com lock na criação/claim/envio de comunicação; o gate de emissão/Portal e a prova operacional remota continuam separados. | S10/S07 |
| F13 — constraints intrínsecas | Já corrigido no código | Guardas de tarifa validam não negativos, dias/faixas e vigência; manter preflight de dados antes de ampliar constraints. | Regressão S08 |
| F13 — gaps/sobreposições | Aceito | Lacunas de faixa têm regra aceita na ADR 0026; sobreposição de tabelas locais é deliberada na ADR 0040. Não proibir ambas com EXCLUDE genérico. Conflito específico de acordos continua protegido. | §8 |
| F14 | Já corrigido no código | Migration 019 e integração local mantêm R$ 0,01 aberto tanto no caminho manual quanto no PIX, sem baixa fictícia. | Regressão S10 |
| F15 | Mitigado parcialmente | Edge tem retry/backoff, erro sanitizado e alerta persistente; job nominal permanece inativo e falta prova de gateway/Vault/Preview e execução real. | S09 runtime |
| F16 | Mitigado parcialmente | Núcleos de invoice/ledger usam linhas elegíveis e estados financeiros protegidos; casos completos de isento/BRL/USD e reemissão continuam na validação de S10. | S10 |
| F17 | Já corrigido no código | Emissão autoritativa usa dia de negócio BRT para âncoras e snapshot; manter teste de borda temporal e não reescrever datas históricas. | Regressão S09 |
| Disputas e juros/multa | Aceito | Disputa pausa dunning, não PTAX/pagamento; juros/multa não são praticados. Não adicionar congelamento de câmbio ou encargos. | §8 |

### 2.6 PR #659 — arquitetura, schema, grants e dívida

| ID original | Classificação | Evidência atual e trabalho residual | Destino |
|---|---|---|---|
| 1 / §2.2 | Mitigado parcialmente | `recalc-demurrage-ptax` tem Edge, retry, alerta persistente e job nominal documentado/inativo; ativação e execução remota permanecem pendentes. | S09 |
| 2 / §4.1 | Já corrigido | Migration 009 revoga `PUBLIC`, `anon` e `authenticated` de `upsert_portal_invoice_exception` e mantém o uso legítimo por trigger/service_role; security replay confirma o guard. | Regressão S01 |
| 3 / §4.2 | Já corrigido | `portal_inspect_list_disputes` e o core privado foram entregues na migration 013; Inspeção usa wrapper escopado e não ganha escrita. | Regressão S11 |
| 4 / §2.7 | Já corrigido no código | Tipos oficiais foram regenerados do Preview; aliases compatíveis foram preservados, adapters/casts quebrados foram corrigidos e o catálogo verifica assinaturas. | Regressão S11/S14 |
| 5 / §2.3 | Pendente | `portal_list_operation_bls_legacy()` continua candidata sem consumidor vivo conhecido; remover apenas após prova de dependências e `DROP RESTRICT`. | S14 |
| 6 / §2.4 | Mitigado parcialmente | As 14 candidatas foram comparadas localmente com `pg_depend`, corpos, jobs e usos do repositório; consumidores externos continuam não observáveis, portanto nenhuma remoção é autorizada. | S14 |
| 7 / §§1.1–1.2 — fatos documentais | Já corrigido | Contagens/path/rota catch-all e testes citados foram corrigidos; #661 refinou `.from` para 60 tabelas + 2 buckets. Não repetir essas edições. | Preservar |
| 7 / §§1.3–1.4 — cobertura e prevenção | Mitigado parcialmente | `check-rpc-catalog.mjs`, mapa literal de Portal, docs:check e replay protegem contratos ativos; inventário inverso completo de rotas/arquivos/jobs ainda é residual. | S11/S14 |
| 8 / §4.3 | Já corrigido no núcleo | Flags físicas são aplicadas pela RPC atômica com autor/lock/auditoria no servidor; no-op não gera intenção fictícia e falha de auditoria desfaz a unidade. | Regressão S04 |
| 9 / §2.6 — quatro nullable | Pendente | Confirmar escrita externa/uso documental de `alerts.notified_at`, `bls.consignee_address`, `charge_calculations.reviewed_at` e `customer_portal_sessions.last_seen_at`; nenhuma remoção sem backup/preflight. | S14 |
| 9 / §2.6 — duas write-only | Aceito | Manter `ended_vessels.ended_at` e `portal_email_events.received_at`; esta última será útil ao inbox. | §8 |
| 10 / §3.1 — cast obsoleto | Já corrigido | Tipos oficiais e DTOs foram corrigidos; `InvoiceDocument`, Portal Billing e Conciliação PIX não dependem dos casts que ocultavam shape inválido. | Regressão S11 |
| 10 / §3.1 — projeção de escalas | Mitigado parcialmente | EmbarqueVazios e agencyDepartureReport usam `listVoyageRoutePorts`, uma projeção comum de POL/POD; a prova completa de todos os consumidores e do refresh sem N+1 continua em S12. | S12 |
| §3.2 — supressões | Mitigado parcialmente | Filtro por emails do cliente evita full-scan global atual. RPC filtrada/paginada é necessária ao ultrapassar teto por cliente, não prova de falha atual. | S06 diagnóstico, S12 condicional |
| §3.2 — B/Ls | Mitigado parcialmente | `operational_list_bls`, `operational_list_containers`, `operational_list_bl_summary` e `operational_list_voyage_summaries` têm filtros/limites ou agregados server-side; fallback de compatibilidade e listas derivadas ainda requerem convergência. | S12 |
| §3.2 — Painel 60 viagens | Mitigado parcialmente | Painel expõe janela inicial e “Carregar mais” com total; TV ainda mantém snapshot limitado e a cadeia de agregados não foi reestruturada. | S12 |
| §3.2 — PortalBillingTabs | Já corrigido no código | Taxas Locais e Demurrage usam páginas, contagem, filtros e wrappers de Inspeção na migration `021`; exportação busca páginas filtradas sob demanda. | Regressão S11/S12 |
| §3.3 — tetos distantes | Aceito | N+1 transbordos, alertas por página, ATD sequencial, Vault por disparo e ZIP sem Zip64 ficam condicionados a medição; lookup portos/layout COSCO recebem validação S03, sem substituição ampla. | §8 |
| §3.4 — ponte de testes do squash | Mitigado parcialmente | `src/test/setup.ts` combina ativo+archive e o replay/ catálogo executados protegem o schema atual; testes históricos continuam apenas contexto e a cobertura inversa ainda é residual. | S14 |
| §3.4 — `voyage_pod_schedule` | Aceito | ADRs 0027 e 0035 adiam explicitamente `port_calls`; literal histórico não é descumprimento que autorize migração ampla. | §8 |
| §3.4 — adapter billingLedger | Já corrigido no código | Regeneração oficial e typecheck passaram; manter contrato gerado como fonte, sem allowlist silenciosa de drift. | Regressão S11 |
| §3.4 — DV CNPJ | Precisa de investigação | `portalCnpjLogin.ts` aceita formato sem DV por dados de teste. Conferir base atual e variantes aceitas antes de restringir login. | S14 / D09 |
| §4.4 — Supabase em Baplie.tsx | Mitigado | `Baplie.tsx` não acessa mais Supabase diretamente para staging/existência; `baplieReadModel.ts` concentra a projeção explícita, a paginação por viagem e a checagem limitada de B/Ls. Preview autenticado e roteiro manual continuam residuais operacionais. | S12 |
| §2.5 / §4.5 — sem divergência | Aceito | Nenhuma tabela órfã comprovada; preservar cadeias de import, jobs válidos, triggers e decisões conferidas. | Regressão |

### 2.7 PR #660 e falha de workflow

| ID | Classificação | Evidência atual e trabalho residual | Destino |
|---|---|---|---|
| Achado 1 | Já corrigido | `portal_get_session_overview_v2` valida identidade/revogação pelo helper compartilhado antes de atualizar `last_login_at`; testes cobrem iat/revogação e erro genérico. | Regressão S01 |
| Achado 2 | Já corrigido | `assertPreviewTarget` roda antes de criar cliente; recusa produção, ref ausente e URL malformada. Testes em `previewAdminProvisioning.test.ts`. | Preservar, S02 regressão |
| Achado 3 | Já corrigido | Wrappers de escala e import BL validam `auth.uid`, usuário ativo, actor e permissão antes de ler/delegar; grants públicos foram fechados. | Regressão S01 |
| Achado 4 | Já corrigido | `vercel.json` inclui HSTS `max-age=31536000; includeSubDomains`. Não adicionar preload nem repetir header. | Preservar |
| Achado 5 | Aceito | DoS por rate limit somente CNPJ é tradeoff explícito ADR 0049. Monitorar, sem inventar identificação confiável por IP. | §8 |
| TOCTOU de contatos | Aceito | Hipótese depende de troca concorrente de customer_id, fora do fluxo atual. Preservar imutabilidade e lock do cliente; reabrir se essa capacidade nascer. | §8 |
| `portal_ship_schedule` anon | Aceito | Programação sem dados privados é exceção deliberada; grants nomeados, nunca PUBLIC genérico. | Regressão S01 |
| Vetores sem achado | Aceito | Não criar tarefas genéricas de IDOR, rotação de segredo sem incidente ou reescrita de Auth/webhooks. | §6 |
| Provision Preview Admin / §1.3 deste plano | Já corrigido no código; operação condicionada | Readiness, SHA, branch, dotenv, segredo mínimo e alvo estão protegidos; o Preview da PR #670 passou e o smoke autenticado foi concluído. Ativação futura de Edge/Vault/cron continua fora da prova local. | Regressão S02 / D10 |

## 3. Dependências entre subprojetos

```mermaid
flowchart TD
  S01["S01 Segurança e catálogo"] --> S04["S04 Transações de ingestão"]
  S01 --> S08["S08 Demurrage e PIX"]
  S02["S02 Preview"] --> V["Validação autenticada em Preview"]
  S03["S03 Parsing e identidade"] --> S04
  S04 --> S05["S05 Recuperação durável"]
  S06["S06 Caixas e elegibilidade"] --> S07["S07 Inbox e estados de envio"]
  S09["S09 ROE/PTAX e cron"] --> S08
  S08 --> S05
  S11["S11 Inspeção e tipos"] --> S12["S12 Leitura e paginação"]
  S10["S10 Ledger e prontidão"] --> S07
  S01 --> S11
  S12 --> S13["S13 UX e acessibilidade"]
  S01 --> S14["S14 Rastreabilidade e legado"]
  S11 --> S14
```

As setas são dependências de integração, não obrigação de bloquear toda uma frente: S08-A (guards/desconto/cache) precede S09; S08-B (snapshot de cálculo) consome S09 e já está implementado. S05 pode entregar recuperação de taxas locais antes da emissão durável de Demurrage; o worker autônomo só entra após runtime S09 e rollout. S13 pode entregar debounce/offline/contraste sem aguardar S12. A correção de readiness de S10 pode integrar a primeira versão segura de S07 sem esperar a política de centavos do ledger.

Não existe dependência obrigatória entre refatorar o parser Baplie e revogar um grant. Novas migrations de frentes independentes precisam, contudo, ser integradas em sequência única. A ordem de PRs em §5 explicita esses cortes.

## 4. Planos de implementação detalhados

### Convenção de execução das tarefas

Cada subprojeto abaixo é um plano menor, com fronteira própria e entregas separáveis. Na execução, trabalhar em ramo `codex/` isolado, revisar o baseline vigente e selecionar apenas a entrega corrente. Não iniciar todas as frentes de uma vez. As decisões de §9 delimitam ramos condicionais, sem autorizar decisões comerciais por omissão.

Para cada tarefa de comportamento: escrever o caso que falha, executar o teste estreito e confirmar a falha específica, mudar o contrato mínimo, executar novamente esperando PASS e fazer commit pequeno. Os vetores e contratos abaixo são critérios de implementação, não código já aplicado. Testes devem usar os helpers existentes; não criar um framework de fixtures. As instruções de rollout e documentação de §7 integram os critérios de aceite de cada entrega.

### S01 — Fronteiras de segurança e catálogo executado

**Objetivo / IDs:** fechar PUBLIC indevido e a exceção de revogação do overview; tornar explícito o guard já exigido na entrada. #659.2/§4.1, #660.1/3; início da cobertura #659 §3.4. **Prioridade:** P0 para grant, P1 para overview, P2 para defesa de entrada. **Dependências:** nenhuma de implementação; Preview S02 para validação externa. **Decisões:** preservar matriz RBAC vigente e a exceção de programação pública; não ampliar `is_admin()` nem restaurar restrições departamentais antigas.

**Arquivos:** criar migration `supabase/migrations/009_rpc_entry_security.sql`, `src/integration/auditSecurityBoundaries.local-pg.test.ts`; modificar `scripts/security/verificar_guardas.py`, `src/services/__tests__/consolidatedSchemaInvariants.test.ts` e, na execução, `docs/RASTREABILIDADE.md`/`docs/operations/validacao.md`. A definição fonte dos três RPCs vive hoje em `supabase/migrations/002_business_logic_and_security.sql`; copiá-la para CREATE OR REPLACE em migration nova, nunca editar a 002.

**Contratos SQL:** `upsert_portal_invoice_exception(bigint,text)`, `portal_get_session_overview_v2()`, `current_portal_customer_id()`, `save_voyage_escala_terminal_state_v2(bigint,text,integer,jsonb,jsonb,jsonb,text)`, `import_bl_freight_transactional(jsonb,uuid)`.

- [x] Registrar ACL efetiva no replay atual e provar que o grant indevido não é herdado por `anon`; o resultado do security replay está anexado pelos gates da PR.
- [x] Criar teste SQL para `has_function_privilege('anon', 'public.upsert_portal_invoice_exception(bigint,text)', 'EXECUTE') = false` e preservar o trigger legítimo com service_role.
- [x] Aplicar o fechamento exato em migration 009, inventariar separadamente funções de trigger e conservar chamadas internas/service_role necessárias.

```sql
REVOKE ALL ON FUNCTION public.upsert_portal_invoice_exception(bigint, text)
  FROM PUBLIC, anon, authenticated;
```

- [x] No overview, validar identidade/revogação pelo mesmo contrato antes do `UPDATE last_login_at`, manter mensagens genéricas e cobrir iat/revogação/claim inválido.
- [x] Antes de ler payload/tabelas/delegar no import e escala, exigir auth/usuário ativo/actor/permissão; manter `search_path` fixo e grants fechados.
- [x] Executar a suíte de segurança e invariantes SQL com chamada negada sem alteração persistida; o commit entregue é `3997aef5`.

**Compatibilidade / rollout:** mesmas assinaturas; aplicar SQL antes de frontend. Token revogado deve encerrar sessão conforme fluxo já existente. Não fazer rollback que reabra PUBLIC ou aceite token revogado. **Testes:** contrato textual de entrada; integração SQL com anon, Portal A/B, interno inativo, todos os perfis internos e ator divergente; runtime PostgREST com tokens reais. **Aceite:** nenhum dado/último login muda com token revogado; zero EXECUTE PUBLIC indevido no catálogo; programação pública e triggers válidos continuam funcionando. **Residual:** RLS local com shims não cobre gateway/Auth real; completar Preview antes de encerrar. **Ordem:** primeiro PR.

### S02 — Provisionamento de Preview coerente com o ciclo da PR

**Objetivo / IDs:** resolver o residual do workflow (§1.3), preservando #660.2. **Prioridade:** P1, habilita validação das outras frentes. **Dependências:** acesso de leitura aos runs/checks e uma PR aberta com branch Supabase. **Decisão técnica:** PR encerrada ou SHA superado não deve provisionar; `skipped` de PR aberta não é sucesso automático.

**Arquivos:** modificar `.github/workflows/provision-preview-admin.yml`; criar `scripts/preview-readiness.mjs` e `src/services/__tests__/previewReadiness.test.ts`; preservar `scripts/provision-preview-admin.mjs`, `scripts/load-branch-env.mjs` e os testes existentes. Atualizar `docs/setup/deploy.md` apenas na execução. **Migrations:** nenhuma.

- [x] Reconsultar os runs/checks históricos e registrar a distinção entre workflow confiável, PR/SHA e `skipped`; a PR #670 atual também teve check Supabase concluído.
- [x] Extrair decisão pura em `preview-readiness.mjs`, usando o contrato completo abaixo, e testar todos os retornos antes de ligar o YAML.

```js
export function decidePreviewReadiness({ open, currentSha, requestedSha, conclusion, branchReady }) {
  if (!open || currentSha !== requestedSha) return 'obsolete'
  if (conclusion === 'success' && branchReady) return 'ready'
  if (['failure', 'cancelled', 'timed_out', 'action_required'].includes(conclusion)) return 'failed'
  if (conclusion === 'skipped') return 'investigate'
  return 'wait'
}
```

```js
import { expect, it } from 'vitest'
// @ts-expect-error — script operacional JS sem declaração gerada.
import { decidePreviewReadiness } from '../../../scripts/preview-readiness.mjs'
it('não transforma skipped de PR aberta em autorização para provisionar', () => {
  expect(decidePreviewReadiness({ open: true, currentSha: 'a', requestedSha: 'a',
    conclusion: 'skipped', branchReady: true })).toBe('investigate')
})
```

- [x] No YAML, consultar PR/check do SHA exato com paginação, distinguir `obsolete`/`failed`/`investigate`/`wait`, revalidar SHA/estado e nunca carregar credenciais para PR obsoleta.
- [x] Executar os testes de readiness/provisionamento para no-check, pending, success, skipped, fechamento, SHA novo e falha terminal; o workflow da PR passou. Commit de referência: `ff44e1bb`.
- [x] Validar em PR aberta com branch Supabase, variáveis de branch, provisionamento idempotente e login QA; a evidência autenticada desta linha está registrada em 1.0.1/1.0.2. Ativação real futura continua sujeita a D10.

**Compatibilidade / rollout:** manter checkout confiável da branch padrão e guards de fork/repositório; não executar código da PR com secrets desse workflow. Deploy do script na branch padrão precede prova real do `workflow_run`. **Aceite:** run verde com QA funcional em PR elegível; run encerrado sem escrita para PR obsoleta; skip inexplicado diagnosticado, sem fallback. **Residual:** indisponibilidade da integração permanece falha operacional recuperável; este PR não muda integração/Vercel nem refaz decode de dotenv já corrigido. **Ordem:** segundo PR, independente de SQL.

### S03 — Fronteira de ingestão: número, bytes, estrutura e identidade

**Objetivo / IDs:** impedir corrupção silenciosa antes da persistência. #654 P0-1–P0-4, §§2.1–2.6, 3.5, 4, 5, 6; validação de layout/portos da #659 §3.3. **Prioridade:** P0 para coerção/associação, P1 para validação e feedback. **Dependências:** nenhuma de schema para parsers; S04 usa a saída validada. **Decisões:** D01 (convenções de arquivos/datas), dialetos Baplie aceitos; identidade por IMO antes de aliases. Não adivinhar formato de arquivo ambíguo.

**Arquivos:** criar `src/lib/importNumber.ts`, `src/services/importText.ts`, `src/services/importValidation.ts`, `src/lib/__tests__/importNumber.test.ts`; modificar `src/lib/utils.ts`, `src/lib/vesselAlias.ts`, `src/services/importCore.ts`, `src/services/baplieParser.ts`, `src/services/graniteImport.ts`, `src/services/vaziosImport.ts`, `src/services/vaziosImportacaoImport.ts`, `src/services/containerDatesImport.ts`, `src/services/blParser.ts`, `src/services/portCode.ts`, `src/services/voyages.ts`, `src/services/portalScheduleBulkImport.ts`, `src/pages/ChegadasSaidas.tsx` e modais compartilhados de import. Estender testes existentes desses parsers. **Migrations:** nenhuma inicialmente; índice/alias persistido apenas após D01 e inventário de duplicatas, em PR separado.

**Contrato de saída compartilhado proposto:**

```ts
export type ImportIssue = {
  row: number
  field: string
  code: 'invalid_number' | 'ambiguous_number' | 'invalid_date' | 'missing_header' |
    'unknown_port' | 'invalid_iso' | 'invalid_group' | 'ambiguous_voyage'
  severity: 'error' | 'warning'
  message: string
}
export type ParsedNumber =
  | { kind: 'value'; decimal: string }
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: 'syntax' | 'ambiguous' | 'non_finite' }
```

`decimal` é representação decimal canônica sem agrupamento, não resultado monetário calculado com float. Adaptar à API atual apenas após validar precisão/faixa. Um número JS nativo da célula é finito ou erro; string nunca perde letras para “virar número”. O helper não atribui valor zero à ausência.

- [x] Inventariar callers de `toNumber`, manter o helper apenas para compatibilidade e migrar callers de import para `parseImportNumber`; o teste preserva o caso histórico `1e3 → 13` como regressão do helper antigo.
- [x] Implementar gramáticas explícitas por formato, rejeitar ambiguidade/alfas/não finitos e aceitar expoente somente com opção explícita; callers validam escala/faixa e domínio.

| Entrada | Contexto | Resultado exigido |
|---|---|---|
| `1.234` | peso pt-BR declarado | 1234 |
| `1.234` | decimal en-US declarado | 1.234 |
| `1.234` | formato desconhecido | erro de ambiguidade |
| `1e3`, `12abc`, `NaN`, `Infinity` | decimal sem exponente | erro, sem substituição |
| vazio / número 0 | qualquer | estados diferentes: empty / value 0 |
| `1.234,56`, `1,234.56` | formato correspondente | decimal canônico `1234.56` |
| negativo em peso/tara | coluna não negativa | erro de domínio |

- [x] Separar completamente detecção de tipo e decode de XLS/XLSX, CSV e EDI, incluindo UTF-8/1252 estrito, bytes inválidos, BOM, assinatura posicional Mercante e heurística restrita para CSV de uma coluna. Evidência: `detectImportFormat`, `decodeImportBytes`, `inspectImportFile` e vetores em `importText.test.ts`; o preview mostra o formato e encoding selecionados.
- [x] Completar scanner Baplie por UNA/separadores/release character e por dialeto, com isolamento de grupos LOC/EQD, DGS/OOG, EOF e duplicata. Evidência: `baplieParserS03.test.ts` cobre ambos os sentidos LOC→EQD/EQD→LOC, separador de componente definido por UNA, DGS/DIM por EQD, trailer com conteúdo posterior e duplicata bloqueante.
- [x] Completar a validação estrutural dos marcadores fixos de Granito/Vazios/Vazios IMP/COSCO: cabeçalhos obrigatórios são conferidos, preâmbulos são localizados sem perder a linha física e preview com erro só chega à RPC com `allowRowErrors` explícito. `locateHeaderRowIndex`, `readFirstSheetRows` e `resolvePortCode` foram reutilizados, sem duplicação. Evidência: `graniteParse.test.ts`, `vaziosImportacaoImport.test.ts`, `vaziosImportAdrColumns.test.ts`, `graniteImportAtomic.test.ts` e fixture QA de veículos.
- [ ] Completar a prova com fixture COSCO/Granito real anonimizada autorizada; não inventar nem copiar dados de produção para teste.
- [x] Aplicar os contratos primitivos aos quatro fluxos: `IsoContainerSchema`/`IsoDateSchema`/`LocodeSchema`, parser numérico por origem e bloqueio de confirmação com override explícito de `rowErrors` nas superfícies que o oferecem. Erros de documento ou de viagem continuam bloqueantes, e `allowPending` não é usado como atalho para erros de linha. Evidência: `graniteParse.test.ts`, `vaziosImportacaoImport.test.ts`, `vaziosImportAdrColumns.test.ts`, `vehicleImport.test.ts`, `portCode.test.ts`, `importOverrideWiring.test.ts`, `FileImportModal.test.tsx`, `VoyageImportActions.behavior.test.tsx` e `Granite.behavior.test.tsx`.
- [x] Canonicalizar tokens de navio em `vesselAlias.ts`/`voyages.ts` com IMO prioritário, conflito explícito e regressão de IMOs distintos. Não resolver ambiguidade com `.find()`; evidência nos testes `vesselAliasS03.test.ts` e `voyageIdentityS03.test.ts`.
- [x] Baplie já expõe issues bloqueantes, contagens e relatório de preview.
- [x] Tornar feedback integral/exportável nos importadores que usam o modal/painel
  compartilhado, sem enviar arquivo/`raw`/PII à telemetria. Evidência:
  `ImportIssuesPanel.test.tsx`, `importValidation.test.ts`, `FileImportModal.test.tsx`
  e regressões de Carga Solta, Granito, Vazios IMP e Veículos.
- [x] Completar o mesmo contrato nas superfícies customizadas de arquivo,
  incluindo o upload Baplie de arquivo único. O hook compartilhado descarta
  respostas tardias e os modais não chamam persistência após cancelamento.
- [ ] Executar o gate completo de parsers depois dos itens acima, incluindo fixtures reais anonimizados, encoding, Baplie e identidade. Não usar a suíte verde atual como prova de P0-4 ou dos contratos ainda não cobertos.

**Compatibilidade / rollout:** conservar assinatura dos imports ou adaptar todos os callers no mesmo PR; avisar rejeições novas no preview. Não reprocessar lotes antigos nem fundir viagens já existentes automaticamente. **Testes:** unitários acima, integração parse→preview→RPC de Granito para verificar peso e valor, regressão de templates e EDI, runtime com arquivo real e alias. **Aceite:** nenhum campo inválido vira zero/null silenciosamente; duas unidades Baplie não trocam peso/POL/POD; nenhuma duplicata por alias conhecido e nenhum merge de IMO distinto. **Residual:** formatos não suportados são recusados com diagnóstico; cadastro amplo de aliases/UNLOCODE e worker exigem medição. **Ordem:** três PRs pequenos; precisão primeiro.

### S04 — Atomicidade da ingestão e da auditoria operacional

**Objetivo / IDs:** transformar sucessos parciais implícitos em unidades transacionais explícitas. #654 P1-5/§§3.2–3.4; #657 P1-01, P2-01, P3-01; #659.8. **Prioridade:** P1. **Dependências:** guard S01, contratos válidos S03; emissão posterior durável em S05. **Decisão D03:** padrão recomendado é atomicidade por B/L para datas/CE, mantendo B/Ls independentes aplicáveis; arquivo inteiro só se a operação exigir all-or-nothing. Baplie usa conjunto físico coerente por viagem; cadastro de cliente+contatos, por cliente.

**Arquivos:** modificar `src/services/containerDatesImport.ts`, `src/services/blFreightImport.ts`, `src/services/baplieReconciliation.ts`, `src/services/ceMercanteImport.ts`, `src/services/customerBase.ts`, `src/services/vehicleImport.ts`, `src/services/breakbulkImport.ts`, `src/components/shared/ContainerDatesImportModal.tsx`; criar `src/integration/importAtomicity.local-pg.test.ts`; estender `src/services/__tests__/containerDatesImport.test.ts`, `src/services/__tests__/blFreightImport.test.ts`, `src/services/__tests__/customerBase.test.ts`. Criar migrations `supabase/migrations/015_import_dates_and_flags_atomic.sql` e `supabase/migrations/016_import_metadata_and_omission_conflicts.sql` conforme §5. Atualizar módulos afetados na execução.

**Contratos propostos:** `apply_container_dates_atomic(p_request_id uuid,p_bl_id text,p_rows jsonb,p_changed_by uuid) returns jsonb`; `apply_baplie_physical_flags_atomic(p_voyage_id bigint,p_changes jsonb,p_changed_by uuid) returns jsonb`. O primeiro retorna `{request_id, bl_id, updated_ids, unchanged_ids, billing_state}`; o segundo retorna IDs realmente alterados e ação auditada. Erros de domínio abortam a unidade, com código conhecido; “unchanged” ainda permite verificar efeito financeiro pendente. Datas e flags não recebem valores financeiros livres.

- [x] Criar testes de falha no segundo update, evento de auditoria e pertencimento; a suíte SQL local comprova rollback da unidade e sucesso separado do B/L seguinte.
- [x] Na RPC/caller de datas, validar relação B/L/viagem/container, locks e preview stale; duplicatas idênticas são idempotentes e duplicatas conflitantes são rejeitadas antes do RPC.
- [x] Preservar a mitigação: update falho impede emissão daquele B/L, outras unidades têm resultado próprio e o caller não assume sucesso de todas as linhas.
- [x] Na RPC de flags, reconsultar staging/containers, obter autor no servidor, aplicar flags e evento na mesma transação; no-op não audita mudança fictícia e falha de auditoria desfaz flags.
- [x] No BL, incluir metadado/vínculo na transação existente, validar viagem/pertencimento e manter batch opcional para B/L avulso conforme ADR 0017.
- [x] No cadastro de clientes, mover cada linha para `apply_customer_base_row_atomic`, preservando soft-delete, unicidade, contatos e snapshot da ADR 0064.
- [x] Declarar CE de planilha por B/L e EDI como conjunto atômico; ambos persistem o gatilho recuperável quando aplicável.
- [x] Completar consumidores de veículo/Granite/BB no S05 sem interpretar tarifa ausente como tabela vazia; `031_import_effect_consumers.sql` cobre os três fluxos, com teste de contrato e integração local de efeitos.
- [x] Em `omit_voyage_escala`, serializar por viagem/escala e capturar somente a constraint de omissão esperada; não engolir `unique_violation` de outra origem.
- [x] Executar a suíte de atomicidade/imports; os 17 arquivos SQL seriais/64 testes e os testes focados passaram. Commits de referência: `666e4d5a`, `f4248168`, `5a1caf50`.

**Compatibilidade / rollout:** publicar RPC nova, migrar caller e depois retirar escrita antiga sensível. Locks em ordem estável e limite explícito de linhas por chamada; não usar transação aberta atravessando arquivos/HTTP. **Testes:** payload misturando viagem/B/L, dates repetidas iguais vs conflitantes, alteração concorrente, autor falsificado, falha na última linha, falha na auditoria e reimport unchanged; runtime importar, fechar aba e conferir estado. **Aceite:** cada unidade tem estado aplicado/não aplicado verificável; nenhuma flag bem-sucedida sem trilha obrigatória; nenhum B/L faturado sobre subconjunto falho. **Residual:** S04 isolado não garante emissão após commit; comunicar “dados salvos, faturamento pendente” até S05. **Ordem:** após parsing mínimo; flags podem integrar antes de concluir todos os templates.

### S05 — Recuperação persistente dos efeitos pós-commit

**Objetivo / IDs:** completar retry/fila/feedback residual de #657 P1-02/P2-02/P1-01 e #654 §§3.3–3.5. **Prioridade:** P1. **Dependências:** S04 para evento na origem; S08-B/D02 para emissão automática de Demurrage sem browser; S10 para gates de emissão/prontidão. **Decisões:** reprocessamento automático de falhas transitórias, bloqueio visível de erros permanentes; efeitos financeiros validam regras atuais e preservam snapshot já emitido.

**Arquivos:** criar `src/services/importEffects.ts`, `src/hooks/useImportEffects.ts`, `src/components/shared/ImportResultPanel.tsx`, `supabase/functions/import-effects-runner/index.ts`, `src/services/__tests__/importEffects.test.ts`, `src/integration/importEffects.local-pg.test.ts` e migration `supabase/migrations/017_import_effects_outbox.sql`; modificar `src/services/reviewBillingAutomation.ts`, `src/services/ceMercanteImport.ts`, `src/services/blFreightImport.ts`, `src/services/containerDatesImport.ts`, `src/services/vehicleImport.ts`, `src/services/breakbulkImport.ts`, `supabase/config.toml` e modais existentes. Documentar job/secrets em WORKFLOW e ADR nova na execução.

**Contrato persistido proposto:** registro de import leve separado de `import_batches`; efeito com identidade lógica única `(source_action_id,effect_kind,entity_id)`, revisão de origem, dependência, estado, número de tentativas, próxima tentativa, lease e resultado. Dados de origem/autor/departamento são congelados no servidor ao aceitar o comando. Histórico de tentativas é append-only; estado da fila é mutável. Sem email/arquivo bruto no log de erro.

```ts
export type ImportEffectState = 'pending' | 'running' | 'retry_wait' |
  'blocked' | 'succeeded' | 'superseded'
export type ImportEffectKind = 'physical_flags' | 'provisional_charges' |
  'local_billing' | 'granite_billing' | 'demurrage_billing' | 'vehicle_followup'
```

- [x] Provar falha após CE/aba e persistir efeito pendente; integração cobre que a intenção sobrevive sem a cauda HTTP.
- [x] Inserir efeito na transação de origem, deduplicar ação, superar revisão antiga e impedir invoice financeira duplicada.
- [x] Implementar claim com `FOR UPDATE SKIP LOCKED`, lease recuperável, exclusão por entidade e ordem de dependência `physical_flags → provisional_charges → billing`.
- [x] Worker chama núcleos privados com service_role, preserva actor/executor separados e não inventa `p_changed_by` para atravessar guard.
- [x] Classificar retries/leases/blocked/superseded, limitar tentativas e abrir alerta idempotente ao esgotar; ação de retry é auditada.
- [x] Persistir e exibir relatório integral por linha/unidade no detalhe e no
  modal de resultado, e reabrir o resultado após recarregar. O painel lista
  status, tentativas, erro sanitizado, resultado concluído e retry auditado.
- [x] O consumidor `demurrage_billing` existe e fica fail-closed/inativo até S08-B e rollout operacional.
- [ ] Não ativar cron/worker sem prova Preview e autorização D10. O código e o
  endpoint permanecem pausados por configuração, sem ativação nesta execução.
- [x] Executar testes unitários/integração de efeitos, crash, timeout, dois workers, replay, dependência e lease; commits de referência: `d85a0558`, `ff44e1bb`.

**Job proposto:** `import-effects-runner`, a cada cinco minutos (`*/5 * * * *`), via `ops.dispatch_edge_job('import-effects-runner', 'IMPORT_EFFECTS_CRON_SECRET')`. Segredo homônimo no Vault e Edge, autenticação própria fail-closed e `verify_jwt` coerente, provados em Preview antes de ativação.

**SQL / grants:** tabela sem escrita direta do browser; leitura interna por helper vigente; RPCs de listar/retry escopadas e auditadas; claim/complete exclusivamente service_role. Agendar por `ops.dispatch_edge_job`/Vault, sem segredo em SQL. **Rollout:** schema e leitura primeiro, produtores depois, worker inicialmente pausado; não ligar duas caudas para o mesmo evento. Backfill somente de efeitos comprovadamente incompletos, com simulação e dedup financeiro; nunca reenfileirar todos os imports históricos. **Aceite:** falha após commit recupera sem nova invoice duplicada, operador encontra pendência após recarregar; flags falhas bloqueiam dependentes. **Residual:** entrega é pelo menos uma vez, não promessa de exactly-once HTTP; idempotência no consumidor é obrigatória. **Ordem:** depois das RPCs de origem; PRs separados para núcleo, produtores e ativação.

### S06 — Roteamento de caixas e elegibilidade da régua

**Objetivo / IDs:** preservar consentimento de caixa e impedir starvation. #655 A1/A3/A9; D04 aprovada para A7, agrupamento D11 aprovado para A6; #659 §3.2 supressões. **Prioridade:** P1, bloqueador de ativação de envio em massa. **Dependências:** nenhuma para correção de fallback; S07 completa estados/recuperação. **Decisões:** D04 para aviso de bounce e D11 para volume por cliente; régua semanal contínua permanece contrato aceito.

**Arquivos:** criar migration `supabase/migrations/010_contact_routing_and_dunning_eligibility.sql`; modificar `supabase/functions/demurrage-dunning/index.ts`, `supabase/functions/portal-email-webhook/index.ts`, `src/services/customerCommunicationBoxes.ts`, `src/services/customerContactConfiguration.ts`, `src/services/customerCommunications.ts`; estender `src/services/__tests__/customerCommunicationBoxes.test.ts`, `src/services/__tests__/demurrageDunningMigration.test.ts`, `src/services/__tests__/demurrageDunningFunction.test.ts`; criar `src/integration/communicationEligibility.local-pg.test.ts`. Atualizar ADR 0064/0059 só conforme decisão, módulos e validação na execução.

**Contratos SQL:** `repair_customer_contact_box_fallbacks`, `customer_communication_recipient_allowed`, `claim_demurrage_dunning_candidates`, `demurrage_dunning_candidate_sendable`, `release_demurrage_dunning_claim`; resolver elegibilidade de caixa pela mesma regra canônica, respeitando natureza de supressão.

- [x] Cobrir principal suprimido/alternativo operacional e preservar fallback somente ao principal elegível; caso indevido falha e o reparo da ADR 0064 é auditado.
- [x] Remover seleção arbitrária; sem principal elegível a caixa fica sem destinatário, cobrança pausa e alerta cadastral é aberto/reutilizado. `documentacao_operacao` continua legítima para CE/Taxas.
- [x] Alinhar claim/sendable com desativação, caixas e supressões; retirar leitura de produção a `customer_contact_preferences` e revalidar antes do envio.
- [x] Cobrir lote com inelegíveis à frente, sem starvation; claims pausados são liberados e regularização reabre elegibilidade.
- [x] Implementar D11: grupos por cliente/ciclo, membership exata por invoice, uma entrega por destinatário, fixture de 12 invoices/3 contatos e grupos que atravessam o limite do claim.
- [ ] Provar limites/provedor e ativação real conforme D10.
- [ ] Inventariar contagens acima de 1000 por cliente para decidir paginação server-side de supressões; não remover a mitigação atual antes da medição.
- [x] Implementar D04: aviso externo de bounce respeita `communications_enabled`, enquanto supressão, reparo e alerta interno seguem ativos; testes cobrem chave ligada/desligada.
- [x] Executar testes de caixas, elegibilidade, D04/D11 e integração SQL; commit de referência: `fa4781fb`.

**Compatibilidade / rollout:** schema/RPC primeiro, depois Edge; chave permanece no estado atual, sem ativação implícita. Simulação com destinatários de QA comprova recorte; excluir fixtures dos envios reais. **Aceite:** zero destinatário novo fora das caixas permitidas; nenhuma starvation pelos inelegíveis; decisões de fallback e pause aparecem na auditoria. **Residual:** alteração de contato entre conferência e envio exige revalidação, sem prometer transação entre banco e provedor; o agrupamento por cliente/ciclo da D11 já está implementado e testado, mas limites/provedor e liberação real continuam pendentes. **Ordem:** primeiros PRs, antes de ativar envio real.

### S07 — Inbox de webhook, idempotência e estado observável do envio

**Objetivo / IDs:** não perder eventos e não chamar envio real de simulação. #655 A2/A4/A5/A8 e residual A3; fronteira de comunicado de #658 F12. **Prioridade:** P1. **Dependências:** S06 e núcleo de readiness S10; pode reutilizar padrões de lease de S05, sem impor uma fila genérica única a domínios distintos. **Decisões:** retenção de payload mínimo e PII (D07), estados de envio apresentados ao operador.

**Arquivos:** criar migration `supabase/migrations/018_email_inbox_and_dispatch_state.sql`, `supabase/functions/portal-email-events-runner/index.ts`, `src/integration/emailInbox.local-pg.test.ts`; modificar `supabase/functions/portal-email-webhook/index.ts`, `supabase/functions/demurrage-dunning/index.ts`, `supabase/functions/send-customer-communication/index.ts`, `supabase/functions/_shared/email.ts`, `src/services/customerCommunications.ts`, `src/components/billing/InvoiceCommunicationStatusCell.tsx` e testes `src/services/__tests__/portalEmailWebhook.test.ts`, `src/services/__tests__/sendCustomerCommunicationFunction.test.ts`, `src/services/__tests__/demurrageDunningFunction.test.ts`. Atualizar config/cron/Vault e docs na execução.

**Contratos:** estender `portal_email_events` com `provider_message_id`, payload mínimo validado, `processed_at`, tentativas/erro/lease; `received_at` existente é preservado. Recebimento deduplicado não significa processamento concluído. Claim/apply/complete são privados para service_role. Comunicado passa a distinguir pendente/processando, simulado terminal, enviado, parcial, pausado e falha; histórico de tentativas mantém o resultado real por destinatário.

- [x] Testar evento antes do vínculo da tentativa, dedup pendente/processada, falha entre etapas, repetição e evento desconhecido; evento sem tentativa vira investigação/alerta.
- [x] Persistir envelope validado antes do ACK; erro de persistência retorna não-2xx; claim/processamento/supressão/reparo usam transações e efeitos secundários idempotentes.
- [x] Aplicar transições por evento/horário sem regressão; bounce/complaint preservam natureza da supressão e stale transitions são ignoradas.
- [x] Persistir estado explícito `parcial` quando uma comunicação tem destinatários mistos; `dispatch_mode` fica na tentativa e a RPC/trigger recalcula o cabeçalho sem achatar combinações distintas. A prova de deploy/provedor permanece pendente.
- [x] Trocar novas chaves de dunning para comunicação/contato/versão do destinatário, sem email em claro; não reescrever identidades históricas.
- [ ] Remover `status` mutável da unicidade lógica de `customer_communications` após preflight/reconciliação das referências antigas; a membership D11 reduz o risco, mas não substitui esta contração.
- [x] Fechar readiness de `ce_mercante_taxas` na criação/claim/envio; a RPC server-side com locks e a revalidação do Edge impedem criação/claim/dispatch sem CE, revisão liberada e financeiro concluído para todos os B/Ls ativos. A prova de Preview/provedor permanece pendente.
- [x] Executar testes de webhook, dispatch, dunning e inbox; commit de referência: `ff44e1bb`.

**Job proposto:** `portal-email-events-runner`, a cada minuto (`* * * * *`), via `ops.dispatch_edge_job('portal-email-events-runner', 'PORTAL_EMAIL_EVENTS_CRON_SECRET')`. Usar segredo dedicado homônimo no Vault/Edge e mesmas provas de autenticação de S09. Retry de processamento em 1, 5, 15, 60 e 360 minutos, seis tentativas totais; após esgotamento, manter registro bloqueado e alertar para investigação, sem descartar. Ajustar janela somente com evidência da latência real de vínculo de tentativa.

**Rollout:** expandir CHECKs e leitores antes de novos estados; deploy Edge antes de ativar cron do inbox. Eventos antigos sem payload não são recuperáveis magicamente: buscar replay no provedor somente se disponível e permitido, senão registrar lacuna. Restringir leitura da chave histórica com PII; retenção/pseudonimização segue D07. **Aceite:** evento recebido duravelmente termina processado ou em fila de investigação; duplicata não duplica supressão/aviso; uma entrega seguida de pausa aparece parcial; retry não reenvia destinatário já aceito pelo provedor. **Residual:** exactly-once externo depende do provedor e da janela de idempotência; resultado ambíguo exige reconciliação antes de novo envio. **Ordem:** depois de corrigir elegibilidade, antes de qualquer liberação em massa.

### S08 — Integridade de Demurrage, descontos e PIX

**Objetivo / IDs:** dinheiro e documentos derivam de um estado validado e auditável. #658 F1–F4, F7–F8, F11, F13; contrato de emissão consumido por S05. **Prioridade:** P0 para baixa/desconto inválido; P1 para snapshot e precisão. **Dependências:** S01, S09 para cotação com procedência, D02 para autoridade de tarifa, D06 para parâmetros financeiros. D02 está aprovada; guards/desconto/cache continuam independentes da entrega do novo cálculo.

**Arquivos:** modificar `src/services/demurrage/demurrageInvoices.ts`, `src/services/demurrage/demurrageRates.ts`, `src/services/demurrage/demurrageContainers.ts`, `src/services/reconciliacao.ts`, `src/components/demurrage/InvoiceDocument.tsx`, `src/components/demurrage/PaymentModal.tsx`, `src/components/demurrage/DiscountModal.tsx`, `src/lib/pix.ts` (protegido); criar `src/integration/demurrageMoney.local-pg.test.ts`, estender testes de cálculo/discount/invoice/PIX existentes. As migrations já aplicadas são `supabase/migrations/012_demurrage_mutation_guards.sql`, `023_demurrage_calculation_snapshot.sql`, `027_demurrage_money_fixes.sql`, `028_demurrage_roe_integrity.sql` e `030_fix_demurrage_snapshot_ptax_column.sql`; não criar `011`/`014` retroativamente. Atualizar ADRs 0014/0015/0026 e módulo somente no PR correspondente.

**S08-A — guardas e correções que não dependem de mudar autoridade de tarifa.**

- [x] Executar a confirmação/ACL sob roles locais e registrar que escrita direta de history permanece bloqueada.
- [ ] Repetir o mesmo roteiro em Preview real antes de fechar F2 operacional.
- [x] Unificar o núcleo de confirmação com lock, role vigente, request/txid, janela de fotos e rejeição de `p_matches` como prova financeira.
- [x] Criar `register_demurrage_payment` e `apply_demurrage_discount` com UUID/idempotência, histórico e estados separados.
- [x] Recusar desconto inválido, produzir zero explícito sem QR pagável e impedir total negativo com `NUMERIC`/arredondamento de fronteira.
- [x] Retirar DML financeiro direto do browser e manter history sem escrita de `authenticated`.
- [x] Corrigir cache: falha não renova `loadedAt`, estado stale expõe erro/idade e emissão exige tarifa fresca.
- [x] Acrescentar guardas de sanidade de tarifas e manter gaps deliberados separados de sobreposição indevida.

**S08-B — snapshot de cálculo e impresso (D02 para cálculo server-side).**

- [x] Formalizar a supersessão parcial na ADR 0065: servidor resolve tarifa/acordo/override, valida containers/datas/revisão e mantém precedência de domínio.
- [x] Criar preview/emissão autoritativos com revisão esperada, conflito stale e núcleo comum para interno/worker; fila autônoma permanece bloqueada por rollout.
- [x] Persistir snapshot com USD/desconto/PTAX/ROE/data/fonte/versão e BRL de apresentação; resíduo é distribuído deterministicamente sem alterar total autoritativo.
- [x] Fazer documento ler snapshot/total persistido, recusar ROE ausente quando necessário, eliminar fallback 1 e preservar histórico legado como indisponível quando faltar fato.

**S08-C — BR Code e escritor único (F7/F8).**

- [x] Conferir o Manual Pix 2.10.0 e o Manual BR Code 2.0.1, registrar versão/vetores e validar 01/26/05/62/54/txid/charset com decoder independente para o QR Code estático da aplicação; o escopo não declara conformidade para QR dinâmico/composto.
- [x] SQL é a autoridade do payload persistido em emissão/recálculo/desconto e TS não grava uma versão financeira paralela.
- [x] Validar decoder independente contra o vetor oficial estático, CRC conhecido, limites de txid/campo 54 e árvore 26/62; testes dourados do builder permanecem apenas como regressão complementar.
- [x] Preservar `txid=doc_number`, QR antigo na janela ADR 0015, ausência de campo 54 para saldo zero e falha para limites inválidos; manter esses testes como regressão.

**Vetores mínimos a implementar na suíte SQL/TS:**

| Caso | Resultado |
|---|---|
| desconto 101 sobre base USD 100 | erro; invoice e histórico inalterados |
| desconto 100 sobre base USD 100 | total zero; payload ausente |
| pagamento repetido mesmo identificador | retorna mesmo resultado, uma baixa/história |
| dois pagamentos concorrentes da mesma invoice | uma transição financeira; outro duplicado/conflito explícito |
| valor da terceira PTAX anterior | divergência, não quitação |
| tolerância de R$ 0,01 na janela Demurrage | preservar ADR 0015, sem confundir com ledger local F14 |
| soma de conversões fracionárias | soma das linhas exibidas + ajuste = total persistido, em centavos |
| falha ao inserir história | nenhuma mudança financeira persistida |
| caller Portal ou ator adulterado | recusado sem efeito |

- [x] Executar os testes de dinheiro, desconto, emissão atômica, documento e PIX; todos os gates locais/CI passaram. Commits de referência: `d47a5b6c`, `ff44e1bb`, `c9c1b081`.

**Compatibilidade / rollout:** migration expansiva e wrappers antes dos callers; bloquear escrita antiga ao promover contratos seguros, com tratamento de app desatualizado. Autorizar arquivos protegidos conforme §9, sem editar histórico aplicado. **Runtime:** emissão → Portal/impresso/QR → recálculo → pagamento com QR anterior → tentativa repetida → consulta de histórico. **Aceite:** total exibido = persistido = QR; pagamento válido encerra recálculo, inválido não escreve; somente writers autorizados alteram dinheiro. **Status:** F4 server authority foi implementada e formalizada na ADR 0065; F8 permanece pendente de conformidade normativa e a ativação autônoma depende das provas de S09. O snapshot não recupera uma PTAX histórica que nunca foi gravada. **Ordem:** A cedo, B após S09/D02, C após confirmação normativa.

### S09 — ROE/PTAX com procedência e recálculo agendado

**Objetivo / IDs:** #658 F5/F9/F10/F15/F17 e #659.1; atualizar BRL sem sessão aberta e sem inventar cotação. **Prioridade:** P0/P1. **Dependências:** S01 e validação Preview S02; S08 usa o snapshot de câmbio. **Decisões D06:** manter escrita interna conforme RBAC, definir limite de sanidade/override com justificativa; execução diária às 17:00 UTC é proposta da auditoria, verificar disponibilidade de fechamento na operação.

**Arquivos:** modificar `supabase/functions/recalc-demurrage-ptax/index.ts`, `supabase/config.toml`, `src/services/demurrage/demurrageInvoices.ts`, `src/hooks/useRoeHeaderRate.ts`, `src/services/demurrage/demurrageKpis.ts`, `src/components/demurrage/PtaxModal.tsx` e os callers de `save_exchange_rate_reference`; criar `src/integration/exchangeRateIntegrity.local-pg.test.ts`, `src/services/__tests__/recalcDemurragePtax.test.ts`, migration `supabase/migrations/018_exchange_rate_provenance.sql`, com criação de job inicialmente inativo; se a entrega for desdobrada, alocar o próximo inteiro conforme §5. Atualizar ADRs 0014/0063 e WORKFLOW na execução.

**Contratos SQL:** `save_exchange_rate_reference`, `recalculate_demurrage_invoices`, foto inicial de `create_demurrage_invoice`, `ops.dispatch_edge_job`, função privada canônica de spread. Valor `NUMERIC` finito/positivo; procedência inclui `source`, `quote_date`, `ptax` real ou NULL e ROE aplicado. Não reconstruir PTAX com divisão em cotação manual sem fonte.

- [x] Criar casos de zero, negativo, null, cotação inválida e alteração concorrente com pagamento. A atualização transacional e o lock da invoice estão cobertos pelo código/testes locais; a execução sob roles e Edge reais continua pendente.
- [x] Centralizar spread 1,065 em função SQL usada por emissão, recálculo e leituras que precisam da regra. Snapshot guarda resultado/versão; TS não recalcula spread independentemente. Comparar valores canônicos e centavos, não igualdade binária.
- [x] Persistir par PTAX/ROE verdadeiro para fonte BCB e origem manual explícita quando só há ROE. O fallback inverso foi removido; histórico é selecionado pela data efetiva e registros antigos de origem incerta ficam identificados.
- [x] Usar dia de negócio `(now() AT TIME ZONE 'America/Sao_Paulo')::date` na primeira emissão/âncoras da régua, separando timestamp UTC de auditoria e data de publicação BCB. Os casos de horário/fim de semana ficam nos testes locais; não há backfill de datas antigas.
- [x] Tornar fetch BCB limitado e recuperável: timeout por tentativa, três tentativas para timeout/429/5xx com backoff/jitter, validação de schema/valor e alerta interno idempotente em falha persistente. A última cotação fica marcada como desatualizada e não é apresentada como nova.
- [x] Implementar o contrato fail-closed do gateway/dispatcher e manter `verify_jwt` coerente com a autenticação própria; o código não aceita anon nem registra segredo.
- [ ] Publicar/validar essa combinação no Preview real antes de ativar o job.
- [x] Deixar o job nomeado e idempotente, com `RECALC_CRON_SECRET` referenciado pelo nome no SQL e sem `service_role` como segredo de cron; o agendamento saiu da migration por exigir privilégio operacional.
- [ ] Criar/ativar o job no Vault/Edge/`pg_cron` do ambiente depois do aceite operacional.

```sql
-- Correcao 2026-09-09: `UPDATE cron.job` exige privilegio de tabela que o papel
-- de migrations do Supabase nao tem (42501) e aborta o replay. O agendamento
-- saiu da migration e virou passo operacional; ver
-- docs/operations/segredos-cron.md, "Agendar o recalculo de PTAX".
SELECT cron.schedule(
  'recalc-demurrage-ptax',
  '0 17 * * 1-5',
  $$SELECT ops.dispatch_edge_job('recalc-demurrage-ptax', 'RECALC_CRON_SECRET');$$
);
-- Pausar, se necessario, pela funcao da extensao:
-- SELECT cron.alter_job(jobid, active := false) FROM cron.job
-- WHERE jobname = 'recalc-demurrage-ptax';
```

- [ ] Verificar dispatcher/Vault e job em Preview real: sem segredo deve falhar fechado e alertar; autorizado atualiza uma invoice aberta e preserva paga. Repetição da mesma publicação não cria outra foto idêntica. Só então ativar pelo procedimento operacional registrado e comprovar uma execução agendada real, não apenas chamada manual.
- [x] Executar `npm test -- src/services/__tests__/recalcDemurragePtax.test.ts src/integration/exchangeRateIntegrity.local-pg.test.ts src/services/__tests__/demurrageRecalcAndPixWindowMigration.test.ts`; os testes locais e o gate integral da PR passaram. A evidência operacional do ambiente continua aberta.

**Compatibilidade / rollout:** dois estágios no mesmo subprojeto, procedência e job; a implementação está no código/migration 018, mas a ativação remota permanece separada. **Aceite ainda pendente:** exatamente um job por ambiente com agenda/config/secret coerentes e execução real confirmada; a falha BCB deve gerar sinal persistente e replay não pode duplicar história. **Residual:** publicação atrasada e indisponibilidade externa continuam possíveis; fallback manual precisa de procedência e sanity check. Não aplicar uma variação máxima arbitrária como regra comercial sem D06. **Ordem:** primeira onda financeira, antes de emissão durável autônoma.

### S10 — Ledger local, rateio e fronteiras de prontidão

**Objetivo / IDs:** #658 F6/F12/F14/F16/F17, parte local de F7. Separar três fatos: cálculo conferível, emissão permitida e comunicado pronto. **Prioridade:** P1. **Dependências:** S01, procedência/data S09, S11 para tipos; núcleo de readiness é dependência de S07. **Decisões:** D05 para centavo residual local e eventual mudança na premissa do compartilhamento tardio. Não aplicar regra de pagamento parcial local ao Demurrage.

**Arquivos:** modificar `src/services/billing.ts`, `src/services/billingLedger.ts`, `src/services/reconciliacao.ts`, `src/services/charges/chargeOperationsService.ts`, `src/services/customerCommunicationReadiness.ts`, `src/components/billing/InvoiceDocumentLocal.tsx`, `src/components/portal/PortalBillingTabs.tsx`; criar `src/integration/localBillingIntegrity.local-pg.test.ts`, migration `supabase/migrations/019_local_billing_integrity.sql`; estender testes de ledger/PIX, readiness e documento. Atualizar ADRs 0007/0020/0038/0040/0051/0054/0055 e módulos apenas no recorte alterado.

**Contratos SQL:** `register_ledger_invoice_payment`, `reconcile_invoice_payment_by_txid`, núcleos de `create_invoice_from_bls`/`create_local_consolidated_invoice`, `compute_bl_review_pendencies` e overloads, readiness de comunicação e `create_customer_communication_atomic`.

- [x] Criar teste de invoice local R$ 100,00, pagamento R$ 99,99 e comparação entre status, recebido e saldo do ledger, cobrindo caminho manual/PIX. A regressão do fechamento inconsistente de um centavo está coberta em `localBillingIntegrity.local-pg.test.ts`.
- [x] Implementar D05 aprovada no núcleo SQL: qualquer saldo positivo, inclusive R$ 0,01, continua em aberto e a invoice parcialmente paga; manual e PIX local preservam recebido/saldo reais. A tolerância da janela Demurrage ADR 0015 permanece separada.
- [x] Implementar reconciliação transacional, idempotência por evento e locks ordenados para pagamentos parciais, excedente/restituição, estorno e consolidação.
- [ ] Ampliar a matriz de casos de runtime/COD e comprovar cada fluxo sob dados reais de Preview.
- [x] Usar conjunto consistente de linhas elegíveis para necessidade de ROE, itens e totalização; isentos não entram no faturável e invoices vazias são bloqueadas.
- [ ] Completar a prova operacional combinada BRL/USD/misto/review/cancelado em todos os wrappers.
- [x] Manter precisão do rateio e a distribuição SQL do resíduo; o impresso identifica a fração e usa o total persistido. A cobertura local inclui compartilhamento/centavos.
- [ ] Fechar o roteiro de reordenação e renderização de todos os documentos em Preview.
- [ ] Fazer consulta diagnóstica de irmãos com CE/faturamento em momentos divergentes, sem recalcular, e levar ocorrência real à operação se existir. Não cancelar/reemitir irmãos nem alterar documento pago automaticamente.
- [x] Implementar o núcleo server-side de critérios de acesso à emissão (conta ativa, acesso utilizável, `auth_user_id`, `recovery_email` válido/não suprimido) nos wrappers individual/consolidado/Granito; cálculo continua separado do gate.
- [ ] Validar o gate completo no ambiente operacional.
- [x] Fazer overloads de pendências delegarem ao mesmo contrato, com precedência cliente → cálculo → CE → Portal e motivo Portal distinto de “Cálculo incompleto”. CE não foi introduzido no gate de revisão que deliberadamente não o exige.
- [x] Fechar readiness de `ce_mercante_taxas`: todos os B/Ls do cliente/viagem com CE, revisão liberada e financeiro concluído na criação/claim/envio, com advisory/row lock e identidade `service_role`. O gate de emissão/Portal continua separado e a validação de runtime permanece pendente.
- [x] Executar a cobertura local de ledger, readiness e `InvoiceDocumentLocal`; os gates da PR passaram.
- [ ] Reexecutar/estender o conjunto quando o readiness de comunicação e os cenários de runtime forem implementados.

**Compatibilidade / rollout:** RPCs antigas delegam ao mesmo núcleo durante transição; mudança de política financeira exige ADR antes da migration. Auditar divergências existentes em relatório somente leitura; backfill de saldo só com origem comprovada e ato financeiro autorizado. **Runtime:** simulação com recebimento parcial/estorno/COD e Portal bloqueado; comparação de SQL, tela, impresso, QR e fila de comunicado. **Aceite:** `saldo = devido − liquidações − ajustes` em centavos e coerente com status; zero emissão sem gate; nenhuma mensagem enviada com prontidão invalidada antes do claim. **Residual:** corrida entre validação final e entrega HTTP é inevitável sem API transacional externa; snapshot de decisão torna-a auditável. **Ordem:** readiness pode preceder ledger para liberar S07; políticas financeiras não se misturam na mesma PR com UI.

### S11 — Paridade de Inspeção e tipos do schema final

**Objetivo / IDs:** #659.3/4, §1.4 e cast obsoleto §3.1; preparar paginação de Portal. **Prioridade:** P1. **Dependências:** S01; regeneração reexecutada a cada migration futura. **Decisões:** autorização para arquivo protegido; preservar leitura interna global, Inspeção sem escrita e sem login fictício (ADR 0045).

**Arquivos:** criar migration `supabase/migrations/013_portal_disputes_inspection.sql`, `src/services/portalRpcContracts.ts`, `src/integration/portalInspectionParity.local-pg.test.ts`; modificar `src/services/portalScope.ts`, `src/services/portalBilling.ts`, `src/hooks/usePortalDisputes.ts`, `src/types/database.ts`, `src/services/billingLedger.ts`, `src/services/transshipments.ts`, `src/components/bl/BlOperacionalTab.tsx`. Se necessário separar complementos manuais, criar `src/types/database.extensions.ts` e `scripts/generate-database-types.mjs`; o gerador deve manter exports consumidos. Atualizar rastreabilidade e ADR 0045 na execução.

- [x] Criar teste de disputa com Cliente A/B, Portal A e Inspeção interna A: escopo equivalente, nenhuma disputa B e nenhuma escrita habilitada em inspeção; `portal_inspect_list_disputes` está presente e coberto.
- [x] Extrair/usar `_portal_list_disputes_core(p_customer_id bigint)` com wrappers Portal/Inspeção, guard, `search_path` fixo e grants explícitos. O overview especial de `portal_open_inspection` foi preservado.
- [x] Substituir construção livre de nome por mapa literal dos contratos de leitura/escrita, incluindo variantes de `callReportIdAwareRpc`; o mapa alimenta dispatcher, catálogo e rastreabilidade, sem criar variante de escrita.
- [x] Gerar tipos contra o replay/schema final, remover RPCs fantasma e ajustar `settle_cod_adjustment` sem editar bloco gerado manualmente; aliases/complementos consumidos foram preservados.

```bash
npx supabase@2.113.0 gen types typescript \
  --db-url postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test \
  --schema public > /tmp/transhipping-database-schema.generated.ts
```

Este comando é somente de execução futura, para o banco descartável de §6; não exporta schema de produção. Conferir a versão do CLI no workflow ao executar. O arquivo temporário serve para diff/extração; a versão final deve ser reproduzível pelo gerador, sem misturar edição manual no bloco gerado.

- [x] Remover os três adapters/casts obsoletos depois da aceitação do compilador; `notify2_block`/`consignee_phone` usam os tipos ativos. O catálogo compara assinaturas e retornos com `pg_proc`, sem allowlist silenciosa.
- [x] Executar `npm run typecheck` e os testes de paridade/Portal; typecheck, suíte integral e gate de catálogo da PR passaram. Regenerar novamente somente quando uma migration futura alterar o schema.

**Compatibilidade / rollout:** migration antes do dispatcher; mapa mantém assinaturas públicas. Query keys incluem modo/cliente/filtros para não reutilizar cache A em B. Regerar tipos de todo novo RPC nos PRs de domínio, não apenas no fechamento. **Runtime:** abrir faturamento em Inspeção e Portal, alternar clientes, verificar leitura e ausência de write/last_login indevido. **Aceite:** nenhum caller declarado aponta para contrato ausente, nenhum adapter mascara assinatura errada; resultados iguais para escopo equivalente. **Residual:** catalogar não testa todas as regras de negócio; executar chamadas representativas e manter testes por domínio. **Ordem:** primeira onda, após S01.

### S12 — Leituras proporcionais à página e projeção compartilhada

**Objetivo / IDs:** #656 §§1.1–1.5; #659 §3.1 projeção, §3.2 B/L/Painel/Portal e §4.4. **Prioridade:** P1 para varredura no caminho quente, P2 para redução de waterfall; memoização só medida. **Dependências:** S11 para contratos de Portal/tipos; pode iniciar debounce em S13. **Decisões:** manter filtros derivados e contadores corretos; limite visual TV não autoriza esconder histórico do Painel.

**Arquivos:** modificar `src/hooks/useBls.ts`, `src/services/bls.ts`, `src/services/containers.ts`, `src/services/voyages.ts`, `src/services/lineup.ts`, `src/services/voyageRouteSchedules.ts`, `src/services/agencyDepartureReport.ts`, `src/pages/EmbarqueVazios.tsx`, `src/pages/Baplie.tsx`, `src/pages/Painel.tsx`, `src/components/portal/PortalBillingTabs.tsx`; criar `src/services/operationalLists.ts`, `src/integration/operationalLists.local-pg.test.ts`, migration `supabase/migrations/020_operational_read_pages.sql`; estender `src/services/__tests__/lineupSnapshot.test.ts`, `src/services/__tests__/lineupScheduleDates.test.ts` e testes de filtros existentes. Índices só após EXPLAIN no dado sintético representativo.

**Contratos SQL propostos:** página e resumo de B/L/containers com os mesmos filtros canônicos, lista resumida de viagens e snapshot de Line Up; limite máximo de página 100, ordem total com ID de desempate. Portal usa núcleos escopados com dois wrappers. RPCs de consulta interna usam helper de leitura incluindo Equipamentos; consultas agregadas não podem escapar da política de escopo.

- [x] Medir baseline com 100, 1000 e 10000 B/Ls sintéticos, containers compartilhados e múltiplas escalas; registrar requests SQL, bytes, EXPLAIN e p95 com ambiente explícito. O harness `scripts/perf/measure-operational-read-model.mjs` executa em PostgreSQL local vazio e termina cada cenário em ROLLBACK. Os tempos de parser não servem como baseline dessas consultas.
- [x] Reproduzir filtros derivados e contagens em contratos SQL paginados, com busca/status/rota/viagem/compartilhamento e total separado da página. As projeções e páginas entregues em `020_operational_read_pages.sql` preservam escopo e filtros.
- [x] Substituir os full-scans de containers/B/L dos hooks de listagem e do resumo de Carga Solta por filtro/ordem/paginação/agregação server-side. Exportações explícitas ainda materializam somente o conjunto solicitado pelo usuário; elas permanecem como residual de medição, não como caminho de rail.
- [x] Separar resumo de viagem dos embeds de detalhe e concluir o snapshot/consulta de Line Up com omissões, POL documental, escala/atracação, somente embarque e vazios sem a consulta secundária B/L → containers.
- [x] Fazer EmbarqueVazios, `agencyDepartureReport` e a leitura de Baplie consumirem a projeção/serviço comum, preservando terminais e relatórios fechados.
- [x] Oferecer janela/“carregar mais” no Painel acima de 60 viagens e paginação com total/filtros nas listas de PortalBilling, incluindo wrappers de Inspeção.
- [ ] Comprovar refresh de 30 s sem refazer a cadeia inteira em Preview.
- [ ] Se a medição S06 confirmar teto de supressão por cliente, adicionar RPC server-side filtrada/paginada; até lá manter a mitigação atual e registrar o gatilho.
- [ ] Comparar profiler antes/depois e só aplicar memoização/virtualização onde custo e invalidação forem demonstrados.
- [x] Executar os testes de listas/projeções e os gates da PR relacionados a filtros/contagens.
- [ ] Executar `npm run perf:authenticated-startup` com credenciais de teste do Preview e anexar o resultado; o benchmark local 100/1.000/10.000 foi concluído em commit separado desta continuação.

**Compatibilidade / rollout:** RPCs de leitura novas antes dos hooks; remover consultas antigas depois de paridade. Novos índices com plano e custo conhecidos; migração não deve incluir alteração monetária. **Aceite:** página de 100 não transfere a tabela completa; requests por refresh permanecem limitados independentemente do número de linhas; histórico >60 é acessível; Portal A/B continua isolado; em 10000 B/Ls há redução mensurável de bytes e p95 vs baseline, com alvo definido no primeiro benchmark. **Residual:** totalizações ainda podem custar O(tabela) no servidor; EXPLAIN determina índice/cache, não promessa de custo constante. **Ordem:** depois de riscos de integridade; pode ser dividido em três PRs independentes por consumidor.

### S13 — Busca, offline, feedback e acessibilidade

**Objetivo / IDs:** #656 §3.2/3.3/5.1–5.3, avaliação §1.4; #657 P3-02/P3-03; progresso #654 §4. **Prioridade:** P1 para offline e falha silenciosa, P2 para interação. **Dependências:** nenhuma para correções locais; integrar estados das novas queries S12. **Decisões:** perfil com erro transitório não autoriza ações; nenhum perfil antigo de outro usuário pode sobreviver à troca de sessão.

**Arquivos:** modificar `src/hooks/useBls.ts`, `src/hooks/useAuth.tsx`, `src/components/layout/AppLayout.tsx`, `src/components/layout/PortalLayout.tsx`, `src/components/layout/InternalNotificationBell.tsx`, `src/components/ui/ConfirmDialog.tsx`, `src/components/ui/Modal.tsx`, `src/pages/ClientesComunicacao.tsx`, `src/pages/ChegadasSaidas.tsx`, `src/components/billing/InvoiceCommunicationStatusCell.tsx`, `src/pages/Manifestos.tsx`, `src/pages/Containers.tsx`, `src/pages/CargaSolta.tsx`, `src/pages/Veiculos.tsx`, `src/pages/Granite.tsx`, `src/pages/VaziosImportacao.tsx`, `src/components/voyages/VoyageFilters.tsx` e `src/index.css`; criar `src/hooks/useDebouncedValue.ts`, `src/hooks/__tests__/useDebouncedValue.test.ts`, `src/components/shared/QueryStateGate.tsx`, `src/components/shared/__tests__/QueryStateGate.test.tsx` e `src/hooks/__tests__/useAuthHydrationFailure.test.tsx`; estender `src/components/layout/__tests__/InternalNotificationBell.test.tsx`. O gate compartilhado serve aos shells interno e Portal, sem duplicar estado de conexão. **Migrations:** nenhuma.

- [x] Cobrir busca com relógio falso: várias teclas em menos de 300 ms geram uma mudança de query após a pausa; filtro não espera debounce de texto. O helper compartilhado e os callers auditados preservam URL, limpeza, página inicial e ignoram respostas antigas.
- [x] Testar query pausada offline sem cache e offline com dados anteriores. O gate mostra indisponibilidade ou conserva dados com indicação, sem converter falha em “nenhum registro”; reconnect retoma a leitura e escrita offline não é anunciada como salva.
- [x] No sino, erro de marcar lida mostra aviso acionável, restaura estado otimista/contador e permite retry sem duplicação, preservando logging e invalidando somente as chaves pertinentes.
- [x] Implementar a separação `loading`/`error`/`unauthorized` na hidratação, troca de usuário, timeout e perfil inativo/removido; erro transitório permite retry com ações bloqueadas e perfil revogado elimina acesso sem reutilizar autorização anterior.
- [ ] Executar o roteiro completo no Preview autenticado.
- [x] Substituir as quatro confirmações nativas por `ConfirmDialog`, com descrição da entidade/efeito, e preservar os listeners corrigidos de Containers/Manifestos.
- [x] Validar manualmente modal sujo, backdrop/Escape/fechar, foco previsível e ausência de confirmação quando não há alteração. Evidência: Preview Vercel da PR #683 no SHA `c252d7cb`, rota `/viagens`; alteração suja confirmou em Cancelar, fechar, Escape e backdrop, “Continuar editando” preservou o valor e o foco retornou a “Nova Viagem”; formulário limpo fechou sem confirmação.
- [x] Medir contraste de texto normal >=4,5:1 nos tokens de texto, link, status e cabeçalho nos dois temas reais; `npm run a11y:contrast` passou 20 pares e ajustou tokens claros/escuros. Estados hover/disabled e confirmação de que status não depende apenas de cor continuam no roteiro manual.
- [x] Implementar botões/menus de ação acessíveis por teclado e semântica de interação equivalente para as linhas auditadas.
- [ ] Completar caption, `aria-sort` e retorno de foco com verificação manual de leitor de tela; não criar grid ARIA sem necessidade.
- [x] Nos uploads múltiplos que usam `FileImportModal`, exibir progresso por
  arquivo e permitir cancelamento entre unidades; o cancelamento não inicia a
  etapa de importação. Evidência: `FileImportModal.test.tsx`.
- [x] Levar o mesmo controle às superfícies customizadas de arquivo único;
  `useCancellableFileRead` cobre leitura única e múltipla e os modais exibem
  arquivo atual/progresso/cancelamento. A leitura múltipla cede execução ao
  navegador entre arquivos; [ ] medir long tasks próximo do limite antes de
  decidir por worker ou mudança do teto de Baplie.
- [x] Executar os testes de hidratação, modal, comunicação, debounce, `QueryStateGate` e sino; typecheck, lint, build e suíte integral da PR passaram.
- [ ] Completar a evidência manual de teclado, leitor de tela, offline/reconnect e light/dark.

**Compatibilidade / rollout:** sem schema, alterações reversíveis; mensagens usam linguagem operacional, sem expor SQL/stacktrace. **Runtime:** teclado sem mouse, leitor de tela, duas abas, offline/reconnect, formulário sujo e light/dark em Preview autenticado; medir contraste e número de requests. **Aceite:** nenhuma falha de rede parece lista vazia/sucesso; todas as ações auditadas alcançáveis por teclado; foco retorna ao acionador; busca respeita 300 ms; listeners permanecem estáveis após mount/unmount. **Residual:** leitores de tela/latência reais não são cobertos só por jsdom; registrar teste manual. **Ordem:** entregar partes independentes cedo, sem esperar S12 completo.

### S14 — Rastreabilidade verificável e retirada criteriosa de legado

**Objetivo / IDs:** #659.5/6/7/9, §3.4 ponte de testes/DV; preservar fatos documentais já corrigidos. **Prioridade:** P1 para prevenção de drift, P2/P3 para limpeza. **Dependências:** S01 (catálogo), S11 (mapas/tipos); remover legado só depois de verificar schema e uso atual. **Decisões:** D07/D09 para dados/retencão/DV; promoção de escala a tabela está fora do escopo aceito.

**Arquivos:** modificar `scripts/check-docs.mjs`, `scripts/check-squash-replay.sql`, `src/test/setup.ts` somente se necessário distinguir suítes, `src/services/__tests__/consolidatedSchemaInvariants.test.ts`, `src/integration/rpcFinalDefinition.local-pg.test.ts`, `src/lib/portalCnpjLogin.ts` apenas após D09; criar `scripts/check-rpc-catalog.mjs`, `src/integration/rpcCatalog.local-pg.test.ts`, `src/services/__tests__/documentationContracts.test.ts` e, condicionalmente, migration `supabase/migrations/021_remove_verified_legacy.sql`. Na execução atualizar `docs/RASTREABILIDADE.md`, módulos/índices pertinentes e ADR 0062 com cobertura real, preservando archive.

- [x] Derivar o inventário executável do catálogo e o mapa literal S11, cruzando rotas → componentes → hooks → serviços → RPC/args/grants → tabelas → testes; o índice/catálogo atual e as famílias entregues estão documentados.
- [x] Completar as famílias ainda ausentes de PIX, notificações, vazios manuais e hooks/tabelas do residual sem recontar buckets como tabelas. Em 2026-09-25, `docs/RASTREABILIDADE.md` ganhou a matriz complementar por superfície → origem/hook → serviço → RPC/tabela → teste; `src/services/__tests__/documentationContracts.test.ts` cobre cinco famílias (5/5). A leitura de `useVaziosImportacaoStats` é direta via PostgREST, sem service/RPC intermediário; a ausência de teste dedicado de paginação/agregação ficou explícita como lacuna, sem ser apresentada como cobertura comportamental.
- [x] Fortalecer `docs:check` para as rotas vivas e arquivos referenciados, excluindo archive e classificando referências históricas/arquivos “a criar”; o gate atual passou sem inventar `/line-up-tv`.
- [ ] Manter a cobertura nos dois sentidos quando novas rotas/arquivos forem adicionados.
- [x] Criar e executar o gate de catálogo: RPCs chamadas, assinaturas, wrappers dinâmicos, grants default-deny e jobs obrigatórios são conferidos contra o schema final; combinado com o security checker, não depende só de regex/contagem.
- [x] Manter testes históricos ativo+archive identificados como históricos e migrar invariantes críticas para replay 001–última; replay local, tipos e invariantes da PR passaram. Não remover testes históricos em lote.
- [x] Conferir localmente as 14 candidatas contra dependências, corpos, mapa, triggers, jobs e scripts, registrando assinaturas e resultado.
- [ ] Repetir a prova para consumidores externos observáveis antes de qualquer remoção.

| Candidata | Argumentos de identidade |
|---|---|
| `portal_get_current_roe_legacy` | nenhum |
| `portal_get_profile_legacy` | nenhum |
| `portal_get_demurrage_invoice_detail_legacy` | bigint |
| `portal_invoice_details_legacy` | bigint |
| `portal_list_consolidatable_receivables_legacy` | nenhum |
| `portal_list_demurrage_invoices_legacy` | nenhum |
| `portal_list_notifications_legacy` | integer |
| `portal_list_operation_bls_legacy` | nenhum |
| `portal_list_operation_bls_without_transshipment_legacy` | nenhum |
| `portal_list_provisioning_console_legacy` | bigint |
| `portal_list_provisioning_events_legacy` | bigint, integer |
| `portal_notification_unread_count_legacy` | nenhum |
| `close_legacy_agency_report_alerts_for_scale` | bigint, text |
| `reconcile_bl_review_alerts_item` | text, text, text, text, text[], text |

- [ ] Remover candidatas somente após prova externa e `DROP FUNCTION assinatura RESTRICT` em migration nova. `portal_list_operation_bls_legacy()` continua candidata à retirada, nunca à restauração; preservar os sete elos vivos de import, jobs e event triggers.
- [ ] Investigar `alerts.notified_at`, `bls.consignee_address`, `charge_calculations.reviewed_at`, `customer_portal_sessions.last_seen_at` com contagem/preenchimento/consumidores externos. Só propor remoção com utilidade descartada e backup específico; `consignee_address` pode exigir correção de captura. As duas colunas write-only permanecem.
- [ ] Para DV, consultar contagens de documentos válidos/inválidos, separar sintético/real e validar formato conforme contrato antes de ativar restrição. Sem decisão sobre fixtures e clientes existentes, não bloquear login; preservar resposta genérica, anti-enumeração e rate limit.
- [x] Executar `npm run docs:check`, os testes de catálogo/definições/invariantes e `LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test node scripts/check-rpc-catalog.mjs`; o script recusa variável ausente e acusa assinatura incompatível. O gate passou sem autorizar DROP; os itens externos acima continuam pendentes.

**Compatibilidade / rollout:** primeiro observar/medir, depois retirar; `DROP RESTRICT`, sem CASCADE. Arquivar corpo original e preflight de dependências no PR para restauração em migration nova se necessário. Não alterar migrations_archive nem fatos históricos. **Aceite:** todos os contratos chamados têm linha/mapa/teste de existência; grants/jobs finais são verificados por SQL real; nenhuma função viva removida. **Residual:** consumidores externos sem telemetria impedem provar ausência absoluta; manter função fechada é alternativa aceitável e deve constar como investigação, não remoção concluída. **Ordem:** checker cedo, índice ao longo dos PRs, limpeza por último.

## 5. Sequência recomendada de PRs

Os nomes abaixo registram a sequência planejada e o estado observado na linha atual. `[x]` significa implementado e evidenciado; `mitigado` significa que o caminho principal foi corrigido, mas há cauda aberta; `[ ]` significa que o próximo agente ainda precisa implementar/provar o item. As migrations ativas relevantes são `009`–`013` e `015`–`041`; `014` permanece ausente por decisão do replay atual. Não criar uma migration `014` só para preencher a lacuna nem renumerar histórico aplicado; qualquer mudança nova deve usar o próximo número livre após rebase e atualizar este plano.

| Ordem | Estado | Entrega / ação | Referência atual | O que o próximo agente deve considerar concluído ou pendente |
|---|---|---|---|---|
| 01 | `[x]` | Fechar RPCs expostas e revogação do Portal | S01; `009_rpc_entry_security.sql` | ACL/roles/token, triggers, replay e security/catalog gates passaram. |
| 02 | `[x]` | Tratar lifecycle do Provision Preview Admin | S02; sem migration | Readiness por SHA exato, obsoleto/fail-closed e smoke atual estão implementados; não reabrir sem novo achado de infraestrutura. |
| 03 | `[x]` | Corrigir fallback e elegibilidade de cobrança | S06; `010_contact_routing_and_dunning_eligibility.sql` + `011_dunning_group_membership.sql` | Caixa/principal, supressão, starvation e D11 estão em código/testes; falta apenas prova operacional de provedor/limites dentro de D10. |
| 04 | `[x]` | Fechar baixa/desconto direto e cache de Demurrage | S08-A; `012_demurrage_mutation_guards.sql`, `027`/`028`/`029` | Guards, idempotência e cache stale/fresh foram implementados/testados; não reimplementar. |
| 05 | `[x]` + `[ ]` runtime | Preservar procedência e recálculo diário | S09; `018_exchange_rate_provenance.sql` + `024_demurrage_ptax_alert.sql` | Código, retry/alerta e configuração fail-closed estão prontos; Preview/Vault/Edge/cron e execução agendada real continuam pendentes. |
| 06 | `[x]` | Restaurar Inspeção de disputas, páginas e tipos | S11; `013_portal_disputes_inspection.sql` + `021_portal_billing_pages.sql` | Paridade de escopo, paginação, tipos e adapters passaram; regenerar apenas após nova migration. |
| 07 | `[x]` | Corrigir coerção numérica | S03/P0-1; sem migration | Callers e vetores numéricos estão corrigidos/testados. |
| 08 | `mitigado` + `[ ]` | Corrigir bytes, grupos Baplie e schemas | S03/P0-2/P0-3 | Encoding, scanner Baplie (UNA/dialetos/grupos/EOF), schemas concretos, relatório uniforme e progresso/cancelamento nas superfícies cobertas estão entregues; marcadores/fixtures residuais continuam abertos. |
| 09 | `[x]` | Unificar identidade de navio/viagem | S03/P0-4; sem migration | Alias canônico com IMO prioritário, conflito explícito e regressão de IMOs distintos em `vesselAlias.ts`/`voyages.ts` foram implementados e testados. |
| 10 | `[x]` + `[ ]` escopo externo | Fixar snapshot de Demurrage e escritor PIX | S08-B/C; `023_demurrage_calculation_snapshot.sql` + `030_fix_demurrage_snapshot_ptax_column.sql` + `034_pix_static_payload_normative_fixes.sql` | Autoridade server-side, snapshot, QR SQL e decoder independente do QR estático estão implementados/testados; runtime em PSP e QR dinâmico/composto permanecem fora do escopo. |
| 11 | `[x]` | Aplicar datas/flags em transação | S04/P1-01; `015_import_dates_and_flags_atomic.sql` | Atomicidade por B/L, auditoria e flags físicas estão cobertas; não repetir. |
| 12 | `[x]` | Fechar metadados e conflito de omissão | S04/P2-01/P3-01; `016_import_metadata_and_omission_conflicts.sql` | Metadados, CE e omissão/conflitos estão implementados/testados; não repetir o núcleo. |
| 13 | `mitigado` + `[ ] runtime` | Persistir efeitos e relatório de import | S05; `017_import_effects_outbox.sql` + `025_import_effect_worker.sql` + `026_import_effect_alert.sql` + `031_import_effect_consumers.sql` | Outbox/claim/lease/retry, consumidores server-side e painel reabrível por unidade passaram na prova local; Preview, secrets/Vault/Edge e ativação controlada do worker continuam pendentes. |
| 14 | `[x]` + `[ ]` runtime | Fechar readiness de emissão e comunicação | S10/F12; `033_customer_communication_readiness_guards.sql` | Guarda server-side de comunicação aplicada em criação/claim/envio, com lock e identidade de sistema; gate de emissão/Portal e prova de runtime continuam pendentes. |
| 15 | `[x]` + `[ ]` runtime | Persistir inbox e estados de envio | S07; `022_email_inbox_and_dispatch_state.sql` + `032_customer_communication_partial_status.sql` + `038_customer_communication_status_recipient_latest.sql` | Inbox, dedup, stale events, recuperação, estado explícito `parcial` e agregação da tentativa mais recente por destinatário estão entregues; índice sem `status`, deploy/Edge e provedor continuam pendentes. |
| 16 | `[x]` + `[ ]` | Fechar ledger, status/itens e rateio do impresso | S10/F14; `019_local_billing_integrity.sql` | D05/R$0,01 e integração local passaram; casos amplos, diagnóstico de irmãos e gate completo de comunicação continuam abertos. |
| 17 | `mitigado` + `[ ]` | Paginar listas e concluir projeção compartilhada | S12; `020_operational_read_pages.sql`, `035_operational_voyage_summaries.sql`, `036_operational_breakbulk_summary_metrics.sql`, `037_operational_voyage_summary_null_status.sql` e páginas Portal | Projeções, paginação/window, resumo de viagem sob demanda, Line Up sem waterfall de containers, resumo BB server-side, fallback forward de status nullable e filtros principais estão entregues; exportações sob demanda, refresh de Preview e profiler faltam. |
| 18 | `mitigado` + `[ ]` | Debounce, offline, feedback e acessibilidade | S13; sem migration | Debounce, estados de erro/offline, hidratação, confirmações/menu e progresso/cancelamento nos modais múltiplos e customizados estão entregues; contraste, leitor de tela/foco manual e cessão entre blocos faltam. |
| 19 | `[x]` + `[ ]` | Completar índice e gate de catálogo | S14/#659.7; scripts de docs/RPC catalog | `docs:check`, catálogo, replay, tipos e inspeção local das 14 candidatas passaram; famílias ausentes e prova externa ainda faltam. |
| 20 | `[ ]` | Retirar legado confirmado / DV condicional | S14/#659.5/6/9; sem DROP ainda | Provar consumidores externos e dados das quatro colunas, decidir DV e somente então abrir migration com `DROP ... RESTRICT`. |

PRs 07–09 e 18 podem avançar antes de 04–06 por serem independentes de SQL; isso não autoriza repetir entregas marcadas `[x]`. A ativação dos workers/cron/envios é etapa operacional distinta da criação do schema. Não habilitar comunicações reais porque S06/S07 estão verdes: D10, readiness e prova de provedor continuam obrigatórios.

## 6. Estratégia de testes e validação

### 6.1 Camadas de prova e comandos

**Nesta revisão do plano:** o código da PR 670 já foi validado pelos gates registrados em 1.0.1/1.0.2; para esta edição documental, executar `npm run docs:check` e `git diff --check`. Não confundir esses gates com prova de runtime remoto: Preview/Vault/Edge/cron, provedor de email, decoder BCB e benchmark continuam explicitamente pendentes onde marcados acima.

**Na execução de cada PR:** Node conforme `package.json` (24.x no baseline), dependências pelo lockfile e os testes estreitos indicados no subprojeto. Confirmar RED pelo comportamento que se quer corrigir, não por import quebrado acidental. Depois da correção, confirmar GREEN e executar gates aplicáveis:

```bash
npm ci --legacy-peer-deps
npm run docs:check
npm run typecheck
npm run lint
npm test
npm run build
npm run size-limit
python3 scripts/security/verificar_guardas.py --ci
```

Instalar dependências apenas se necessário; não repetir `npm ci` a cada pequeno commit. `size-limit` usa artefato de build. Para PR documental, não rodar suíte inteira sem motivo.

**Replay local descartável:**

```bash
scripts/setup-local-pg.sh --reset
LOCAL_PG_INTEGRATION=1 \
LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test \
  npm test -- --no-file-parallelism src/integration
psql postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test \
  -v ON_ERROR_STOP=1 -f scripts/check-squash-replay.sql
```

Usar `LOCAL_PG_INTEGRATION=1` e `LOCAL_DATABASE_URL` também nos comandos estreitos dos subprojetos que incluem `.local-pg.test.ts`. Conferir as variáveis opt-in exigidas por cada teste existente; não aceitar suite pulada como integração bem-sucedida. A integração contra o mesmo banco deve usar `--no-file-parallelism` para evitar corridas entre fixtures compartilhadas. O script provisiona PG16 local e shims; `supabase/config.toml` declara PG17 no baseline. PG16 prova compatibilidade do SQL local, não comportamento completo de PG17/Supabase. Os shims de cron/Vault/net/auth/storage não executam agendamento/HTTP/cifra reais. Não usar o script local com URL/cluster remoto nem o reset operacional suspenso.

Além do replay do zero, testar **upgrade**: banco descartável com 001–008 e dados representativos → migration nova → invariantes. Na evolução da série, base do upgrade passa a ser o último `main`. Testar preflight de dados inválidos, índices únicos, tempo de lock e recuperação por migration corretiva. Uma migration aplicada não precisa ser reaplicável cegamente; jobs/rotinas que podem ser reexecutados precisam ser idempotentes.

### 6.2 Consultas de contrato do catálogo

Exemplos somente leitura para a suíte local e preflight autorizado; resultado esperado indicado abaixo. Não selecionar `vault.decrypted_secrets` nem valores de segredos para anexar ao PR.

```sql
-- Deve retornar false depois de S01.
SELECT has_function_privilege(
  'anon', 'public.upsert_portal_invoice_exception(bigint,text)', 'EXECUTE'
) AS anon_can_execute;

-- Após hardening: zero funções de negócio com EXECUTE herdado de PUBLIC.
-- Exceção pública de programação deve ser grant nomeado a anon, não PUBLIC.
SELECT p.oid::regprocedure::text AS signature
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
WHERE n.nspname = 'public'
  AND p.prorettype <> 'trigger'::regtype
  AND a.grantee = 0
  AND a.privilege_type = 'EXECUTE';

-- Deve listar uma linha do job PTAX após S09; ativo só depois do rollout.
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname = 'recalc-demurrage-ptax';

-- Mapa de funções/argumentos finais; usar por assinatura, não só por nome.
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS identity_args,
       pg_get_function_result(p.oid) AS result_type, p.prosecdef, p.proconfig
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname, identity_args;
```

A consulta PUBLIC também pode revelar extensão/helper não pertencente à aplicação. Não revogar extensão automaticamente: a suíte deve distinguir funções do projeto e registrar exceção técnica explícita, sem permitir funções de negócio indevidas. Não assumir que “anon não executa” significa “Portal authenticated não executa”; testar ambos.

### 6.3 Matriz de regressão obrigatória

| Fronteira | Cenários | Evidência exigida |
|---|---|---|
| Auth/Portal/RLS | anon, Portal A/B, interno ativo por perfil, inativo, ator divergente, iat revogado, token novo | SQL executado + HTTP real; retorno filtrado correto, não só `error=null` |
| Parsing | UTF-8/1252, BOM, decimal ambíguo, cabeçalho deslocado/ausente, Baplie duas ordens/EOF, datas impossíveis, ISO/porto | unitário + arquivo real anonimizável → preview → banco |
| Atomicidade | falha na primeira/última linha/auditoria, dois operadores, retry após timeout, reimport unchanged | comparação de estado e auditoria antes/depois; duas conexões reais para corrida |
| Outbox/inbox | crash antes/depois do efeito, lease expirada, dupla entrega, nova revisão, webhook antecipado | integração SQL + execução Edge; efeito único e pendência recuperável |
| Demurrage | base/desconto/zero, duas PTAX/data do extrato, concorrência pagamento/recálculo, QR antigo, falta de história | dinheiro em centavos, histórico append-only e runtime Portal/impresso |
| Ledger local | parcial/excedente/estorno/COD, diferença 0,01, consolidada/reemissão, status isento USD | saldo e eventos fecham em centavos; documento não reescreve pagamento |
| Readiness | Portal ativo mas convite pendente/email suprimido, CE ausente, revisão bloqueada, cliente diferente | cada fronteira bloqueia somente sua ação; cálculo continua conferível |
| Comunicados | caixas distintas/sobrepostas, principal indisponível, inativo/opt-out, 60 candidatos, pausa após envio | simulação determinística, tentativa por destinatário, sem envio real indevido |
| Performance/UX | 10k B/Ls, >60 viagens, >1000 supressões, duas abas, offline, teclado, temas | requests/bytes/p95 comparáveis, foco/contraste e estados de erro reais |
| Schema/docs | replay/upgrade, grants, jobs, variantes dinâmicas, assinatura gerada, referência histórica legítima | catálogo executado + typecheck + docs:check |

Os testes existentes de listeners, guarda de Preview e HSTS são **regressão**, não novas tarefas de correção. Novos testes devem exercitar invariantes, não repetir a implementação ou apenas procurar strings. Não criar seeds grandes permanentes para testar um único caso; usar factories/helpers existentes e dados pequenos, exceto no benchmark explícito.

### 6.4 Preview e produção

- [ ] Supabase branch e Vercel Preview apontam para o mesmo ambiente da PR e SHA; a fixture QA é exclusiva da branch. Confirmar por referência de projeto, nunca imprimindo keys.
- [ ] SQL e Edge Functions correspondem ao contrato novo; conferir status da integração e testar RPC via PostgREST. Um frontend verde não prova migration ou Edge publicada.
- [ ] Usar clientes A/B e perfis internos sintéticos, faturas/containers e endereços QA controlados. Exercitar Inspeção sem sessão de Portal emprestada.
- [ ] Executar roteiro por domínio, registrando SHA, migration, ambiente, passos, resultado e evidência; falha impeditiva permanece aberta. “Não executado” deve ter motivo, nunca ser apresentado como PASS.
- [x] No PR, reportar checks do SHA efetivamente enviado. Seguir CLAUDE: acompanhar CI até concluir, corrigir falhas; não manter monitoramento até merge nem criar automação sem pedido. Evidência: PR #683 reporta o SHA `a2cb627c` e o run `34553981173`, acompanhado até todos os checks concluírem com sucesso.
- [ ] Após deploy autorizado, produção recebe preflight somente leitura e smoke do fluxo permitido, sem fixtures QA nem mensagens reais de teste. Operação financeira real ou envio ao cliente exige autorização e caso de negócio apropriado.

## 7. Estratégia de rollout, migração e rollback

### 7.1 Regras de migrations e compatibilidade

1. **Preflight:** registrar catálogo/ACLs/jobs, dados incompatíveis, duplicatas por nova identidade, valores negativos e histórico sem fonte. Volume zero da auditoria histórica não dispensa preflight atual. Não modificar dados para fazer constraint passar sem decisão rastreável.
2. **Expansão:** novas colunas nullable/default seguro, RPCs novas/wrappers compatíveis, CHECKs que aceitam transição de estados, tipos regenerados e UI que lê velho/novo. Não ligar produtor de estado que o consumidor ainda não entende.
3. **Publicação:** migrations pelo fluxo GitHub/Supabase da ADR 0056; Edge Functions e secrets pelo procedimento próprio do ambiente; frontend pelo Vercel. Vercel não é mecanismo de deploy de SQL/Edge. Confirmar artefatos de cada camada antes de liberar.
4. **Migração de consumidores:** caller novo usa contrato novo; atualizações de segurança podem negar cliente antigo com mensagem de recarga. Nunca manter caminho antigo vulnerável indefinidamente para compatibilidade. Remover permissões de escrita direta financeira com estratégia conhecida para abas antigas.
5. **Ativação:** jobs/worker primeiro inativos; segredo no Vault e Edge por ambiente, autenticação e simulação validadas; ativação auditada. Sem habilitar chave global de envio nesta execução de plano nem por efeito colateral de migration.
6. **Contração:** retirar contrato/coluna legado somente após observar consumidores e preservar backup específico; DROP RESTRICT. Não reescrever 001–008 ou migrations_archive, não executar reset em produção e não usar ferramenta que gere migration timestamp fora da convenção numerada.

Os arquivos protegidos requerem a autorização de §9 na sessão de execução. Não usar variável de override do hook como substituto de autorização.

### 7.2 Rollback por domínio

| Mudança | Contenção imediata | Reversão segura / limite |
|---|---|---|
| Guards/grants | manter deny, corrigir wrapper defeituoso | migration corretiva; nunca reabrir PUBLIC ou revogação |
| Parser | suspender formato/import afetado, manter preview | reverter código se voltar a aceitar só formatos seguros; dados já aplicados exigem análise/auditoria, não rollback automático |
| RPC de import | pausar entrada se contrato falhar | compatibilidade de wrapper; transações falhas já desfazem unidade; não desproteger import para “destravar” |
| Outbox/inbox | pausar worker/claim, manter recepção durável | corrigir consumidor e retomar mesma identidade; não apagar fila nem recriar tentativas entregues |
| Email | desligar envio real, preservar ingestão de eventos e supressões | reverter consumidor compatível; enviado não se desfaz e não pode virar simulado retroativamente |
| PTAX | desativar job nominal, manter última cotação e alerta | restaurar Edge/config compatível; correção financeira por evento/reprocessamento autorizado, não apagar histórico |
| Financeiro | bloquear mutação afetada e manter leitura | migration de correção + ajuste auditado; não recalcular pago, reabrir invoice ou inventar recebimento |
| Read-only/UX | voltar consumidor compatível, preservar segurança | rollback de frontend normalmente possível; não remover RPC enquanto abas dependem dela |
| DROP legado | abortar se preflight/RESTRICT indicar uso | restaurar corpo/coluna em migration nova a partir de backup; dados de coluna removida não reaparecem só recriando schema |

### 7.3 Sinais e critérios de parada

Por PR, anexar baseline e janela de observação compatível com a cadência do domínio. Cron diário exige pelo menos uma execução agendada confirmada; dunning/inbox exige execução com falha e retry controlados em Preview. Produção monitora métricas existentes por procedimento operacional, sem agendar automações nesta sessão.

Sinais mínimos: efeitos pendentes mais antigos que a janela de retry, dead-letter/bloqueados, lease expirada, webhook sem tentativa resolvida, discrepância total/PIX/ledger, cotação sem atualização esperada, falha de autorização inesperada, comunicação parcial e request/bytes/p95 das listas. Correlacionar por action_id/entidade/versão, nunca email em claro ou arquivo bruto.

**Parar ativação** se surgir destinatário fora do recorte, dupla invoice/baixa, mutação financeira sem auditoria, acesso Portal cruzado, projeto de Preview incorreto ou novo estado sem leitor compatível. Contenção não apaga evidência. Ausência de incidente em base vazia não satisfaz aceite.

### 7.4 Documentação a atualizar durante a implementação

Cada PR altera documentação viva somente do contrato que entrega: módulos de import/Granito/Viagens, Demurrage/Faturamento/Portal/Comunicação, rastreabilidade e procedimentos de ambiente. Jobs/secrets atualizam WORKFLOW/ADR 0063; mudança de autoridade de cálculo exige ADR nova supersedendo parte da 0026; mudança de tolerância/volume/exceção de email requer decisão correspondente. Consultar `docs/README.md` antes de mudanças amplas.

Não repetir as correções factuais da #659: `/line-up-tv` continua catch-all, `billingLedger.ts` continua serviço real e os nomes de testes já corrigidos permanecem. O residual documental é cobertura/prevenção e descrição de comportamento novo. Atualizar índice deste plano apenas quando autorizado a editar documentação viva; ao concluir todas as tarefas, seguir ciclo de arquivamento do CLAUDE.

## 8. Riscos residuais e itens aceitos

| Item aceito | Justificativa atual | Gatilho para reabrir / responsável funcional |
|---|---|---|
| #655 — continuidade da régua | CONTEXT: semanal até quitação, sem limite de semanas. D11 aprovou agrupar mensagens por cliente/ciclo, preservando essa continuidade; o agrupamento já está no código. | Provar limites/provedor e obter D10 antes de ativação; não consolidar débitos nem descartar faturas |
| #658 F4 — modelo atual em transição | ADR 0026 aceitou integridade interna do payload; D02 foi implementada como autoridade server-side e formalizada na ADR 0065. Não é risco aceito como destino final. | Provar runtime/worker autônomo e manter fail-closed até aceite; não reimplementar S08-B |
| #658 F6 — CE simultâneo dos irmãos | Complemento final da ADR 0020 rejeita automação residual por premissa operacional. | Documentação/Financeiro: ocorrência real de irmão tardio; consultar soma dos rateios e decidir alerta/ajuste, sem mudar pagos |
| #658 F13 — gaps e tabelas sobrepostas | Não são equivalentes a valores negativos; regras de gaps de Demurrage e vigência informativa de taxa local são deliberadas. | Nova política de tarifas/acordos; não generalizar EXCLUDE |
| Disputa não congela PTAX | ADR 0014: apenas régua pausa; pagamento e atualização continuam. | Financeiro decide regra diferente em ADR, fora deste plano |
| Juros/multa/vencimento local | Não praticados; ADR 0055 retirou vencimento de taxas locais. | Nova necessidade comercial explícita; não restaurar overdue/due_date por auditoria |
| #660.5 — rate limit por CNPJ | ADR 0049 aceita risco de DoS sobre dono para evitar bypass por IP não confiável. | Evidência de abuso/impacto ou infraestrutura confiável nova; preservar erro genérico |
| #660 — TOCTOU de contato | Troca de tenant não é capacidade do fluxo atual; cliente é bloqueado no snapshot. | Introdução de transferência de contato entre clientes; revisão da operação e lock |
| Programação pública / HSTS sem preload | Programação não expõe carga privada; HSTS já entregue, preload é decisão distinta. | Mudança de payload ou política de domínios, sem nova implementação agora |
| #659 — `port_calls` adiado | ADRs 0027/0035 aceitam projeção sobre persistência histórica. | Necessidade concreta que exceda projeção atual; exige plano próprio, não limpeza de literal |
| #659 — duas colunas write-only | Baixo custo e potencial forense; `received_at` dá idade ao inbox. | Política de retenção fundamentada, sem DROP por ausência de SELECT |
| #656 — sem virtualização/memoização global | Ausência de técnica não comprova problema; páginas pequenas são adequadas. | Profiler, lista >300 linhas ou long task persistente |
| #654 — worker/aliases persistidos adiados | Limites atuais, template conhecido e função canônica podem resolver com menos risco. | Baplie >3 MB autorizado ou benchmark bloqueante; aliases ambíguos recorrentes |
| #659 — tetos distantes | `useTransshipments` N+1 por viagem, alertas por página, ATD sequencial por auditoria, Vault por disparo e ZIP sem Zip64 não tiveram teto atual demonstrado. | Request/p95/volume acima de orçamento; ZIP próximo de 65535 entradas/4 GB exige outro desenho, não elevar limite silenciosamente |
| Histórico de teste do squash | Archive é evidência histórica útil; removê-lo não melhora prova ativa. | Migrar invariantes críticas incrementalmente para catálogo/replay executado |

Os riscos aceitos não autorizam chamar itens pendentes de corrigidos. D02 já foi implementada no núcleo server-side e formalizada na ADR 0065; o que permanece é runtime/worker e a prova normativa independente de F8. A premissa operacional de F6 permanece aceita; a decisão do centavo em D05 não a altera. Sem consultar a norma vigente não declarar “PIX conforme BCB”. F2 tem correção de código, mas qualquer conclusão de explorabilidade ainda exige prova sob roles reais.

## 9. Lacunas e decisões que exigem confirmação na execução

D02, D04, D05 (centavo local) e D11 foram respondidas pelo usuário após a revisão da PR 662 e estão registradas abaixo. O código correspondente está implementado nos itens marcados acima; as decisões continuam sem autorizar deploy, envio real ou alterações em arquivos protegidos por si só. As confirmações restantes bloqueiam apenas as tarefas correspondentes.

| Decisão | Recomendação concreta | Quem confirma / o que bloqueia |
|---|---|---|
| D01 — convenção de arquivos e ambiguidades | Usar formato declarado por template/coluna; bloquear ambiguidade, não inferir número/data de alto impacto. IMO primeiro, aliases por tokens e conflito explícito. | Operação/Documentação valida exemplos de arquivos, datas/ano e dialetos Baplie; bloqueia aceitação de formatos ambíguos, não correção de `1e3→13` |
| D02 — autoridade do cálculo de Demurrage | **Aprovada pelo usuário e implementada:** núcleo server-side com preview versionado, preservando precedência de tarifas/acordos/overrides; supersessão parcial da ADR 0026 formalizada na ADR 0065. | Decisão respondida; falta validar runtime e worker autônomo, sem nova confirmação da escolha |
| D03 — unidade de import | Atomicidade por B/L em datas/CE, por cliente em cadastro e conjunto físico por viagem em Baplie; relatório por unidade. | Operação; se exigir arquivo inteiro, contrato muda antes do SQL, nunca simular all-or-nothing no modal |
| D04 — aviso de bounce e chave global | **Decidida e implementada:** o aviso externo também é silenciado pela chave de Comunicados; supressão, reparo e alerta interno permanecem ativos. | Decisão respondida; manter regressão e não ativar envio real sem D10 |
| D05 — centavo local e compartilhamento tardio | **Decidida e implementada no ledger:** manter qualquer saldo positivo em aberto, sem baixa automática; R$ 0,01 importa. Tolerância de Demurrage permanece separada. A premissa de CE simultâneo não foi alterada. | F14 entregue; F6 continua diagnóstico e qualquer automação adicional exige ocorrência/decisão específica |
| D06 — câmbio manual e sanidade | Positivo/finito obrigatório; limite de variação e eventual override exigem justificativa/ator e parâmetro aprovado, sem transformar toda escrita em admin. | Financeiro/Administrativo; bloqueia valor do teto, não procedência/cron/erro de fonte |
| D07 — retenção de PII e dados históricos | Payload mínimo de inbox e relatório, acesso restrito, prazo conforme política da organização; manter chaves antigas que sustentam dedup sem reenvio. | Responsável de dados/Administrativo; bloqueia expurgo/pseudonimização destrutiva, não chave nova sem email |
| D08 — arquivos protegidos e deploy | Obter autorização explícita para os arquivos protegidos que a entrega realmente precisa e para rollout com dados/segredos do ambiente. | Usuário na sessão de implementação; `AGENTS.md` e `.claude/hooks/protect-files.sh` proíbem bypass sem autorização |
| D09 — DV e dados sintéticos | Inventariar documentos vigentes, separar fixture e validar formatos aceitos antes de endurecer login; sem revelar existência de CNPJ. | Administrativo/Produto; bloqueia restrição de login e DROP documental de `consignee_address` |
| D10 — liberação de email real | Manter estado atual da chave; autorizar canário e recorte real somente após S06/S07/readiness validados. | Administrativo conforme ADR 0059; nenhum envio nesta sessão |
| D11 — volume de cobrança por cliente | **Decidida e implementada em S06/S07:** agrupar cobranças elegíveis por cliente/ciclo e destinatário, preservando faturas individuais, suas condições e repetição semanal até quitação. Não consolidar débitos nem descartar cobranças. | Decisão respondida; validar composição/limites/provedor, retry e rastreabilidade antes de liberar envio real |

**Investigações técnicas sem decisão comercial:** efeito do gateway JWT no cron e execução real (S09); decoder/norma BR Code vigente (S08-C); contraste e roteiro manual de P3-03/teclado/leitor de tela (S13); profiler/benchmark (S12/S13); dependências/uso externo das 14 funções e quatro colunas e DV (S14). O antigo `skipped` de S02 já possui tratamento fail-closed e não é pendência desta linha. Cada investigação termina com evidência e classificação atualizada, não com mudança especulativa.

### Checklist de revisão do plano

- [x] Nesta revisão, reconferir a linha atual de `main`/PR 670 e reclassificar entregas já resolvidas; não repetir trabalho concorrente.
- [x] Manter vínculo de cada PR com IDs da matriz e critérios objetivos do subprojeto.
- [x] Registrar decisões D01–D11 somente quando aplicáveis; preservar explicitamente as aceitas enquanto não supersedidas.
- [ ] Comprovar contrato SQL final, comportamento sob roles reais, rollback/upgrade e runtime necessário antes de marcar entrega concluída.
- [ ] Ao encerrar o roadmap, distinguir corrigido, aceito e investigação ainda aberta; não arquivar como totalmente executado enquanto houver tarefa obrigatória pendente.
