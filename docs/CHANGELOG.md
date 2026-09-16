# Changelog

> Histórico curado de entregas relevantes. Sintetizado dos planos de execução (arquivados em [archive/](archive/README.md)) e do histórico git. Não substitui o `git log`.

## 2026-09
- **QA adversarial — correções pós-caos:** o primeiro e-mail da importação de
  clientes passa a ser principal (com reparo determinístico dos clientes
  legados sem principal), o resumo da ficha não promove contatos adicionais,
  e a invalidação pós-importação cobre os KPIs e leitores de B/L, físico e
  faturamento. O salvamento da ETA/ATA na escala terminalizada agora mantém o
  snapshot POD na mesma transação (`049_terminalized_schedule_persistence.sql`).
  Também foram corrigidos a prévia institucional, a emissão em Modo Inspeção e
  o marcador `OMIT` no planejamento interno. O orçamento de bundle passou a
  medir os chunks realmente pré-carregados pelas superfícies interna e portal.
- **QA adversarial — Portal e candidatos financeiros:** o convite do Portal
  agora reprova e-mails inválidos antes de habilitar qualquer ação de envio;
  a fila de provisionamento passa a listar contatos ativos do cadastro
  canônico de caixas mesmo quando o `purpose` legado é nulo, omitindo contatos
  desativados (`050_portal_provisioning_active_contact_candidates.sql`).
  A validação focada cobriu os dois contratos; a execução manual usou somente
  registros sintéticos `.test`, sem endereço real. Após confirmação explícita,
  o convite foi enviado para `qa-financeiro-20260915@example.test` e a conta
  ficou em `Ativação pendente`, sem caixa/token disponível para concluir a
  ativação.
- **QA adversarial — erro de faturamento acionável:** a falha da emissão
  automática no botão `Pronto para faturar` deixa de virar um toast genérico.
  O cliente agora lê `code`, `message`, `details` e `hint`, reconhece gates de
  revisão/cliente/Portal sem depender de acentos e exibe a razão operacional
  devolvida pelo backend (BUG-09).
- O dispatch manual de Comunicados também preserva o corpo de erro devolvido
  por `send-customer-communication` quando a Edge Function responde não-2xx,
  evitando o diagnóstico genérico do cliente (BUG-10).
- **QA adversarial — links de ativação após cutover:** overrides legados de
  `PORTAL_URL` e `PORTAL_SUPPORT_EMAIL` agora são normalizados para o domínio e
  suporte atuais do Portal, evitando convites com link 404 mesmo quando um
  segredo antigo ainda estiver implantado (BUG-11).
- **QA adversarial — Portal autenticado:** após a ativação do usuário sintético,
  o login por CNPJ abriu o painel do cliente e as áreas de Operação, Faturas e
  Perfil. O Portal exibiu o B/L `QABL002`, o container devolvido
  `CSNU2049996`, a escala publicada e as notificações sintéticas; o saldo e as
  faturas permaneceram zerados porque nenhuma emissão ou liquidação financeira
  foi executada.
- **B/L — trilho Documental:** detalhe do B/L passa a exibir os quatro gates de Cliente, Taxas Locais, CE Mercante e Fatura, com resumo e próxima ação sem card de Revisão, Pagamento ou vencimento. O CE agora bloqueia emissão para contêiner e carga solta também nas ligações individuais e consolidadas (`047_bl_documental_gates.sql`), e a fatura consolidada fica identificada no trilho. Verificado com testes focados, suíte completa, typecheck, lint, build, `rpc:check`, contraste e `docs:check`.
- **Caixas de Comunicação, Salvamento Atômico e Auditoria de Contatos (Issue 609 / ADR 0064):**
  substituição do modelo legado de preferências (`customer_contact_preferences` e `purpose` como roteador)
  por 3 Caixas de Comunicação oficiais (`documentacao_operacao`, `financeiro`, `demurrage`) com matriz de modelos extensível.
  Salvamento atômico de contatos via `_apply_customer_contact_configuration` com bloqueio pessimista do cliente,
  obrigatoriedade de exatamente um contato principal ativo com e-mail, e desativação lógica (`deactivated_at`)
  em vez de exclusão física. Trilha de auditoria append-only agrupada por ação em `customer_contact_change_events`.
  Auto-captura e auto-vinculação de e-mails em B/L (`ensure_customer_contact_email`) sem sobrescrever dados
  cadastrais. Fallback e reparo de caixas esvaziadas por bounce ou desativação (`repair_customer_contact_box_fallbacks`).
  Atualização das interfaces na Ficha do Cliente, Portal do Cliente, conferência e disparo de comunicados, régua de
  Demurrage e webhook do Resend. Migration `008`.
- **Bloco 3 — Comunicação financeira com clientes:** readiness por cliente/viagem
  para CE Mercante e Taxas Locais, disparo automático após a prontidão, reenvio
  assistido com histórico e resumo sem PIX/anexo; Régua de Cobrança de Demurrage
  semanal, sem teto, ancorada em `first_billed_at`, com pausas por disputa ou
  falta de contato válido. A coluna financeira de Taxas Locais e a coluna da
  Régua em Demurrage expõem os estados operacionais. Migrations `376`–`383`;
  a antiga integração de invoice emitida foi removida, o runner automático recebeu
  lease transacional e tratamento resiliente de simulação/bounces, e a exceção de Portal
  passou a ter audiência explícita para Documentação e Administrativo.

## 2026-08
- **Revisão e correção da rolagem da tela Line-up TV (Issue #582):**
  correção do loop contínuo de rotação no quadro `/line-up-tv/display`. A condição
  de ativação do carrossel foi ajustada de `> DISPLAY_VISIBLE_ROWS + 1` para
  `> DISPLAY_VISIBLE_ROWS` (8 linhas), eliminando a inacessibilidade da 9ª escala;
  a detecção mobile/touch foi calibrada para responder reativamente por largura de
  tela (`window.innerWidth <= 1024`), impedindo que computadores desktop com tela touch
  exibam cards mobile; e o shell desktop recebeu contenção estrita de altura contra
  overflow vertical do documento.
- **Branching automático Supabase ↔ GitHub ↔ Vercel:** o fluxo de Preview volta
  a usar uma branch Supabase efêmera por PR. A integração de branching atualiza
  `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no Preview correspondente, e
  `main` continua sendo o único destino de produção; a configuração anterior
  baseada em `stagingtdesk` foi descartada. Os aliases de Preview do projeto
  Vercel também passaram a ter CORS restrito na allowlist das Edge Functions.
- **Varredura de totais em `/viagens` (auditoria 2026-08-26):** alinhamento das
  fontes por trás dos números exibidos. O KPI `vazios embarcados` passa a somar
  os bookings agregados por `summarizeExportByEmbarkPort`, a mesma fonte da faixa
  da aba Exportação, em vez de `vazios_manifests.total_bookings`; o KPI
  `CE Master` passa a contar as rotas de `collectVoyageManifestBatchRows` com
  número preenchido, lendo `import_batches.ce_master` além de
  `voyage_route_ce_master` (antes zerava em viagens cujo CE Master veio do
  arquivo, contradizendo a aba Rotas e Manifestos); o filtro de período do rail
  vira janela fechada de hoje até hoje + N dias (estava escondendo justamente as
  escalas dos próximos 7/30 dias); e o ADR volta a registrar o destino dos
  containers descarregados (`sections.cargaDescarregada.destino`), que sumia do
  fechado/impresso desde a separação entre natureza e transbordo. Achados sem
  correção estão em [archive/audits/viagens-totais-2026-08-26.md](archive/audits/viagens-totais-2026-08-26.md).
- **Redesenho da página `/viagens` (PRs #588, #591–#599):**
  reestruturação visual e operacional da página de Viagens e seus componentes,
  fatiada e entregue em 7 blocos a partir dos artboards do canvas:
  - **Bloco 0 — Fundação:** inclusão de `is_oog` na seleção do ADR (`AgencyReportDischargeContainer`),
    suporte a `oog` em `MatrixCategory` com prioridade declarada (`transbordo > veiculos > oog > imo > carga_geral`),
    preservação da compatibilidade com snapshots históricos e harmonização de tokens nos modais e avisos de divergência.
  - **Bloco 1 — Visão geral e planejamento por escala:** cabeçalho de dois níveis na chegada (`ETA` e `ATA`),
    painel recolhível de atracações com suporte a adicionar nova atracação e editar atracações existentes diretamente
    na visão geral (`VoyageScheduleModals`), centralização e limpeza de rótulos (`ATD derivado` → `ATD`).
  - **Bloco 2 — Aba Importação:** reorganização da estrutura por escala/POD com painéis lado a lado (`Containers` e `Carga solta`),
    faixas de `Veículos` e `Vazios IMP`, e nova barra de ações com separadores e agrupamento unificado (`VoyageImportActions`).
  - **Bloco 3 — Aba Exportação:** correção do eixo de agregação de vazios para agrupar por terminal de embarque
    (`summarizeExportByEmbarkPort` em `voyageSummaries.ts`), suporte a múltiplos depots por terminal,
    painéis de `Granito` e `Vazios EXP` por escala/terminal e fluxo orientado ao Embarque de Vazios.
  - **Bloco 4 — Aba Rotas e Manifestos:** renomeação da aba ("Escalas & Manifestos" → "Rotas e Manifestos"),
    grupo de cabeçalho `Mercante` com cobertura de CE Mercante e Nº de manifesto Mercante, chip de ação rápida para
    informar manifesto não preenchido e remoção da sub-linha de arquivos/avisos sintéticos.
  - **Bloco 5 — Aba ADR:** seções organizadas por departamento responsável com acompanhamento de prazos de conclusão
    (ADR 0039), totais independentes por modo de carga (container e carga solta), desduplicação de containers vazios entre
    carga descarregada e divergência de vazios, e callouts padronizados para divergências, dados órfãos e observações.
  - **Bloco 6 — Página e Cards:** barra de comando em linha única para busca e filtros com chips removíveis,
    números dominantes em Syne nos cartões de direção (`DirectionKpiTile`), adoção do padrão `.app-tab`, rodapé ancorado
    no rail (`B/L · CNTR · CE`) e refinamentos de conciliação e hover.
- **Chaves surrogate fora da interface — sino, Demurrage, Reconciliação e
  Embarque de Vazios:** varredura do mesmo defeito corrigido em `/alertas`. O
  sino de notificações internas chamava `formatAlertEntity` sem o mapa de
  rótulos e mostrava "Viagem 1"/"Fatura 7"/"Cliente 3"; agora
  `useInternalNotificationEntityLabels` resolve a página inteira em lote, com a
  chave sob o prefixo `internal-notifications` (invalidada junto com a lista) e
  acompanhando o conteúdo da página, para uma notificação nova não esperar o
  `staleTime`. O modal de cancelar baixa do Demurrage intitulava-se
  "Demurrage #37" (`demurrage_invoices.id`) e passa a citar o `doc_number`. Em
  `/reconciliacao` a linha "ID 42" abaixo do `doc_number` saiu — a chave natural
  já era o título. Em `/embarquevazios` o `aria-label` da observação expunha o
  uuid da linha de serviço e passa a usar o nome do serviço. O formato
  `navio / viagem` com fallback para o id, duplicado em três módulos, virou
  `voyageLabel`/`voyageDisplayName` em `src/lib/utils.ts`.
  Continuam fora de escopo as mensagens montadas pelos detectores em PL/pgSQL
  (`326_voyage_operation_alerts.sql:208/253/343/395` citam a viagem pelo id;
  `117`/`121`/`123` registram "fatura consolidada #<id>"): corrigi-las exige
  reescrever os produtores numa migration nova.
- **Alertas — regras aposentadas fora do manual e entidade legível na fila:**
  `/alertas/regras` listava os dois tipos aposentados (`invoice_payment_invalid`
  e `invoice_cancel_blocked`) atrás de um filtro de situação, ou seja, a tela
  continuava oferecendo alertas que nenhum produtor emite desde a `327`. O
  manual passou a documentar somente os tipos ativos do `alert_type_catalog`: o
  filtro "Situação", o estado `AlertRuleStatus`/`statusNote` e o parâmetro
  `?situacao=` foram removidos, e um tipo aposentado sai de `ALERT_RULES` na
  mesma mudança que o desativa no catálogo SQL. `TYPE_LABELS` mantém o rótulo
  dos dois, porque itens históricos continuam legíveis na fila.
  Em `/alertas`, a coluna Entidade mostrava a chave surrogate gravada em
  `alert_items` ("Viagem 1", "Fatura 7", "Cliente 3"). Ela agora resolve o
  rótulo humano — navio/viagem, `invoice_number`, nome do cliente, `doc_number`
  do Demurrage, `bl_number` do Granito e o txid do PIX (já disponível no
  `metadata`) — por uma consulta em lote paralela à fila, caindo no id quando a
  tradução não volta. A mensagem do alerta continua vindo pronta do detector
  SQL e ainda cita o id da viagem; corrigi-la exige reescrever os produtores em
  PL/pgSQL e ficou fora desta mudança.
- **Regras de Alertas — setores notificados e regras aposentadas:** o manual
  `/alertas/regras` descrevia cada regra com um único setor responsável,
  enquanto `fanout_alert_item_for_department` notifica a união entre
  `alert_type_catalog.audience_departments` e o departamento gravado no item.
  Com isso o ADR pendente de Equipamentos — que o detector emite como item
  próprio de Equipamentos desde a `323` — aparecia como regra de Documentação e
  sumia ao filtrar por Equipamentos (o filtro devolvia 1 regra em vez de 4).
  O verbete passou a separar setor responsável de setores notificados, o filtro
  de setor considera todos os notificados e as seções do ADR por setor vêm de
  `AGENCY_REPORT_SECTIONS`. Também foram corrigidos os textos de datas, que
  ainda descreviam o modelo anterior à `342` (o ETD virou data do terminal, e a
  Atracação cobra ATB, ETD e ATD), e o gatilho de exportação pós-ATD.
  `invoice_payment_invalid` e `invoice_cancel_blocked`, sem produtor desde a
  `327`, foram desativados no catálogo pela migration `347` e passam a aparecer
  como aposentados atrás do novo filtro de situação. Revisão completa em
  [archive/audits/2026-08-26-revisao-alertas-e-regras.md](archive/audits/2026-08-26-revisao-alertas-e-regras.md).
- **ADR por terminal — aba, estrutura e impressão:** toda escrita do ADR
  terminalizado estava inerte. `callReportIdAwareRpc` guardava `supabase.rpc`
  numa variável antes de chamar, o que desliga a função do cliente; o supabase-js
  lê `this.rest` e lançava `TypeError` antes de a requisição sair, com o erro
  morrendo no react-query sem toast — assinar seção, assinar departamento,
  observar, fechar e reabrir não faziam nada. O Prazo de Conclusão do ADR também
  nunca era calculado: o ATD agora nasce da Atracação (`TIMESTAMPTZ`) e a regra de
  prazo só aceitava `YYYY-MM-DD`, então a aba mostrava o ATD e, abaixo, "Aguardando
  a saída do navio", com os departamentos em "Sem prazo"; a normalização ISO passou
  para o ponto compartilhado de `agencyReportDeadline.ts`, que também alimenta o
  agregado de SLA. No impresso, faixa de seção sem dado e sem resolução deixou de
  sair como título solto e a barra do rótulo da viagem deixou de ir para o nome do
  arquivo. Restow ausente virou `—` na aba e no impresso.
  O impresso agora distingue seção sem frente atribuída ao terminal de seção
  atribuída com resolução "Nada a declarar"; o seed da auditoria resolve o POL
  por LOCODE e os testes de RPC não compartilham estado entre casos.
- **Revisão de Atracações e Terminais — correções:** a projeção de Atracações
  passou a resolver o código do terminal (`depots.code`), que era sempre nulo:
  o Planejamento por escala rotulava como `TBC` toda Atracação já atribuída e o
  desempate da ordem derivada caía no UUID em vez do código. No Line-Up, Painel
  e TV, a linha de cada sentido passou a usar o ATD das Atracações daquele
  sentido — antes cruzava o ATB do terminal com o ATD derivado da Escala e
  mantinha "atracada" um terminal que já havia desatracado. Escala nova nasce
  com `tem_importacao = true`, coerente com o modo "Importação" que o modal já
  exibia (antes gravava `false`). O campo ATD derivado passou a mostrar a data
  formatada e a nomear a Atracação de origem ou o terminal que falta.
- **PR #579 — datas de Escala e Atracação por terminal:** a projeção passou a
  manter ETA/ATA na Escala e ETB/ATB/ETD/ATD/Restow por Atracação, com ATD da
  Escala derivado apenas quando todas as Atracações concluíram. O modal, Visão
  Geral, Line-Up/Painel/TV, Chegadas e Saídas e ADR foram alinhados ao novo
  grão; as migrations `341` e `342` adicionam a RPC transacional, constraints,
  status e reconciliação de alertas terminalizados.
- **Bloco 6 — Transversal e Portal do Cliente (#525 / Épico #519):**
  Entrega das superfícies transversais de consumo de Alertas e Notificações Internas (`339_treatment_echo_and_transversal_surfaces.sql`):
  - **Eco de Tratamento:** evento `dismissed` em `alert_item_events` e fan-out de Notificação Interna com severidade normal entregue aos demais destinatários da ocorrência corrente (excluindo o autor da dispensa), sem falhas de roteamento espúrias e com idempotência garantida.
  - **Sino de Notificações Internas:** componente montado no cabeçalho do `AppLayout` com consulta e badge paginados/otimizados, baixa individual e em massa (`mark_all_internal_notifications_read`), identificação explícita de entregas por fallback administrativo e de Eco de Tratamento, sem efeitos colaterais sobre a fila coletiva.
  - **Fila `/alertas` completa:** catálogo integral de rótulos de tipos e entidades, filtro server-side por departamento integrado a query params, formulário de dispensa com validação de motivo e data de revisão futura, e projeção de motivo, autor e data de revisão na linha dos itens dispensados.
  - **Resumo de Pendências por Setor no `/painel`:** agregação dedicada do banco sem o teto de 200 linhas da fila, cartões com pendências ativas e dispensadas separadas por departamento, e atalhos diretos pré-filtrados para a fila `/alertas`.
  - **Observabilidade de Falhas de Roteamento:** aba dedicada em `/admin/usuarios` listando ocorrências de `alert_notification_failures`, transparência sobre a audiência dos papéis do catálogo e preservação das fronteiras de segurança (sem atribuição individual).
  - **Contratos Negativos e Fronteira do Portal:** testes formais garantindo que `/perfil`, `/line-up-tv/display` e `/login` não disparam alertas operacionais internos e que o escopo do Portal do Cliente (`portalScope.ts`) não alcança RPCs nem tabelas internas.
- **PR #576 — correções da revisão independente da integração:** o fan-out de
  notificações agora respeita a união de `audience_departments`; os
  reconciliadores de viagem são server-only; alertas terminalizados usam
  `depots.code` e alertas de exportação sem granularidade documental ficam no
  nível da escala. Avanços de marco geram nova ocorrência/notificação,
  mutações de escala têm reconciliação imediata, a Conciliação PIX é
  administrativa-only, Disputes só aparecem para Equipamentos e falhas
  best-effort passam pela telemetria compartilhada (`338_alerts_review_hardening.sql`).
- **PR de Integração Transversal — Épico de Alertas e Operação (#519, Blocos 520–524):**
  Unifica as implementações dos 5 blocos operacionais em uma sequência linear de migrações (`323` a `332`):
  - **Bloco 1 (#520 — B/L e Revisão Manual):** Ciclo de vida e reconciliação de pendências de B/L e Granito (`324_review_bl_alerts_lifecycle.sql`), painel de contexto de revisão e bloqueio de faturamento de B/L pendente.
  - **Bloco 2 (#521 — Clientes, Portal e Disputes):** Modelo auditável de conversas de disputas de Demurrage (`demurrage_disputes`), triggers de gating de faturamento do portal (`portal_billing_gate`, `325_clientes_portal_disputes_alerts.sql`) e reprocessamento pós-ativação.
  - **Bloco 3 (#522 — Financeiro e Reconciliação PIX):** Persistência de pendências PIX (`pix_reconciliation_exceptions`, `328`), detector server-only otimizado de faturas vencidas (`329`), guards de status financeiro de Granito (`330`), resolução autoritativa de PIX (`331`) e sincronização condicional de alertas de disputas por respondente (`327`).
  - **Bloco 4 (#523 — Operação e Viagem):** Detectores e reconciliação de B/L esperado, Baplie ausente e cobertura documental, CE Mercante, datas de escala/terminal e exportação pós-ATD (`326_voyage_operation_alerts.sql`).
  - **Bloco 5 (#524 — Alertas do ADR):** Fundação de alertas por departamento para o Relatório de Agência, prazos de saída e deep links preservando escala, terminal e report (`323_agency_report_alerts_foundation.sql`).
  - **Runner Consolidado (`332_unified_alerts_runner.sql`):** Orquestrador server-only `public.run_alert_detectors()` executando todos os detectores do sistema com permissões e auditoria estritas.
- **PR #569 — revisão manual orientada a cliente (#562):** a fila passou a
  separar grupos por identidade documental segura, exibir evidências brutas do
  consignatário/carga e bloquear vínculos quando há CNPJs conflitantes. O novo
  onboarding transacional cria/resolve cliente, cadastra e-mail de forma
  idempotente, vincula todos os B/Ls do grupo e preserva somente exceções
  específicas. O convite do Portal é opcional e é enviado para o mesmo e-mail
  informado, enquanto o ciclo de vida permanece no Console de Provisionamento.
- **Fundação de Alertas e Notificações:** migrations `317`–`320` centralizam
  catálogo de severidade/audiência, agregado por entidade, itens com histórico,
  dispensa temporária auditável, fan-out de notificações internas por usuário e
  fallback crítico para Administrativo/Admin. Os detectores existentes passam a
  rodar server-side a cada 15 minutos pela Edge Function `alerts-detector`;
  `/alertas` consulta a fila sem detectar, reconhecer ou fechar manualmente e
  mantém alertas legados visíveis durante a migração dos produtores. O tipo ADR
  obsoleto `agency_report_section_pending` foi encerrado e o dead code
  `needsCeMercante` removido. *(plano `2026-08-11-alertas-e-notificacoes`;
  issue #519)*
- **PR #565 — correções da revisão de código da revisão de UI/UX:** o
  relatório de Demurrage por consignatário ainda podia imprimir vazio quando
  o modal era filho direto de `.app-main` (caso da Demurrage, sem wrapper de
  página); a regra de impressão em `src/index.css` passou a excluir
  `.app-modal-backdrop` da ocultação e a mantê-lo visível nesse cenário. O
  indicador de foco por teclado das notificações do Portal, removido sem
  substituto, voltou a existir. O botão de atualizar câmbio no cabeçalho
  deixou de dobrar a altura da faixa de PTAX ao ganhar alvo de toque de
  40×40 px — a área de toque agora é um pseudo-elemento fora do fluxo.
- **Revisão completa de UI/UX e Portal do Cliente:** notificações passaram a
  usar painel responsivo e legível, com hierarquia, datas e estados explícitos;
  navegação ganhou skip link e alvos mínimos de 40 px; o cabeçalho mobile e a
  cópia pt-BR do Portal foram refinados; tokens compartilhados de link/hover e
  redução de movimento foram consolidados. O relatório de Demurrage por
  consignatário deixou de imprimir vazio. A verificação percorreu 31
  superfícies desktop e 25 rotas autenticadas mobile sem overflow ou erros de
  console no passe final. Evidências em
  `docs/archive/audits/2026-08-19-revisao-completa-ui-ux.md`.
- **PR #553 — transbordo e COD:** a omissão de escala passou a preservar os
  dados globais de transbordo, exigir confirmação com resumo, permitir reversão
  administrativa justificada e invalidar as projeções afetadas. COD passou a
  exigir justificativa, reprecificar a Taxa Local no destino final e registrar
  ajustes em `cod_adjustments`, com abatimento antes de restituição e settlement
  manual do Financeiro. O Line-Up, a programação e o Portal exibem `OMIT`
  separadamente de `X`; o Portal não publica o motivo interno do COD. A
  migration `316` removeu `onward_*` morto de `bl_transshipments`, eliminou o
  card duplicado e reduziu auditoria sem mudança.
- **PR #550 — correções da revisão de múltiplos terminais:** o Cadastro de
  Terminais passou a exigir porto brasileiro para novos terminais e ganhou
  preflight do legado; a projeção preserva frentes persistidas; ADRs
  terminalizados filtram cada conteúdo pela frente atribuída e mantêm o
  cabeçalho da escala; alertas e remoção são escopados por `report_id`; a
  gravação terminalizada de datas do POD ficou atômica com a RPC da escala;
  caches, deep-links, auditoria por código/departamento e queries chunked foram
  alinhados. A migration 306 recupera a declaração legada de vazios sem
  substituir a decisão explícita futura; a rodada seguinte terminaliza as
  chaves dos alertas, evita fan-out entre ADRs, fecha sign-offs por terminal,
  filtra `vazio` por sentido no snapshot e remove estados órfãos. Plano
  arquivado em
  `docs/archive/plans/2026-08-18-pr-550-review-fixes.md`.
- **Financeiro segregado por processo faturável:** `/taxas-locais` passa a ser
  a operação de Taxas Locais, `/taxas-locais/tabelas` concentra tabelas e
  overrides, `/demurrage` permanece separado e Relatórios sai do dropdown.
  A faixa agregada de Demurrage sai da operação legada, e `/faturamento`
  continua como redirect compatível com os deep links antigos.
- **Carga solta passa a aceitar o B/L do armador, sem perder o manifesto:**
  `/carga-solta` ganha o modal **Importar B/Ls (PDF/DOCX)** ao lado da
  importação de Manifesto BB, que continua igual. O PDF do formulário com
  campos numerados é lido pelos próprios rótulos impressos; o modelo em Word —
  onde o formulário é uma imagem escaneada e cada campo é uma caixa de texto
  por cima — é lido por conteúdo (unidade do peso, número de viagem, CNPJ,
  endereço) e pela ordem do documento. Os dois desembocam no mesmo caminho de
  persistência do manifesto BB, com a mesma reconciliação de cliente, o mesmo
  lote e o mesmo disparo de taxas locais. Divergência entre o navio/viagem do
  documento e a viagem escolhida bloqueia o arquivo, como já acontecia na
  importação documental de B/L de container; o que não impede a importação
  (CNPJ ausente, peso ou cubagem não encontrados, volumes divergentes do total
  por extenso) vira aviso na prévia e fica registrado nos erros do lote. No
  caminho compartilhado, importar carga solta sem CE Mercante deixa de apagar o
  CE já gravado: a autoridade sobre esse dado é a importação de CE Mercante, e
  nenhum layout além do resumo o carrega.
  A definição da RPC mantém o CE no target quando o payload não declara esse
  campo, o serviço revalida a viagem escolhida, vários arquivos entram no
  mesmo lote, e a leitura DOCX limita a saída descomprimida e preserva as
  reservas do navio. O chunk de PDF usa uma versão compatível com Node 20, o
  runtime do CI.
- **Documento comprido deixa de virar CNPJ válido, e a linha do tempo credita
  quem importou:** `isValidCnpj` passa a validar sobre a forma canônica
  completa (`canonicalizeDocument`, igual ao `normalize_cnpj` do banco) em vez
  da forma truncada em 14 usada como máscara de digitação — a guarda bruta
  aceita de 14 a 18 caracteres para deixar passar a pontuação, então um
  documento sem pontuação e comprido era aparado até 14 e entregue aos dígitos
  verificadores já no formato que eles esperam. Na aba Visão da viagem, os
  eventos de importação passam a exibir **quem importou e de qual
  departamento**: o par já era consultado e chegava a `buildVoyageTimeline`,
  que o descartava, então a viagem creditava toda mudança de escala e deixava
  anônimo o evento que originou os dados. E os embeds ambíguos entre
  `customers` e `bls` (duas FKs desde a `285`) ganham a varredura de
  código-fonte que a documentação já prometia, cobrindo o embed aninhado e o de
  primeiro nível a partir do `.from(...)`.
- **Rate limit do Portal, trava da troca de email e saída da lista de
  bloqueio:** o balde de tentativas volta a chavear pelo `normalize_cnpj`
  compartilhado (migration `298`) — o `regexp_replace(…, '\\D', …)` inline das
  migrations `183`/`191` apagava as letras do CNPJ alfanumérico, então
  `12ABC34501DE35` e `12XYZ34501FG35` dividiam o mesmo balde e cinco falhas em
  um trancavam o login do outro. A verificação da senha atual na troca de Email
  de Recuperação passa a consultar **o contador do login** antes de verificar a
  senha (429) e encerra a sessão de verificação, fechando a porta paralela à
  trava. A confirmação lê a conta **antes** de consumir o convite e devolve 409
  com mensagem verdadeira quando o pedido já foi resolvido, em vez de queimar um
  link válido para dizer "link inválido"; a troca assistida invalida os convites
  `confirmacao_email` **e `recuperacao`** pendentes (`300`) — o link de
  recuperação redefine a senha e tinha ido para a caixa que o operador está
  justamente trocando. `credentials_revoked_at` (`301`) faz
  `current_portal_customer_id()` recusar token emitido antes da última
  revogação, fechando a janela de até 1 hora em que a sessão antiga sobrevivia à
  troca de senha. Conta ativa com Email de Recuperação quebrado ganha sinal em
  coluna própria (`299`, `recovery_email_status`) sem rebaixar
  `account_situation`, com alerta deduplicado; a lista de bloqueio de emails
  ganha saída pelo operador, com justificativa e rastro (`302`) — restrita ao
  endereço do próprio Cliente, e com registro no histórico de cada Cliente que
  compartilha a caixa. A recuperação de senha reusa o convite vivo em vez de
  enviar um email por pedido (teto de um por hora por conta), mas só quando o
  convite está endereçado ao email vigente e seu envio não falhou nem voltou
  como bounce — inclusive o bounce brando, que não suprime o endereço nem marca
  a conta: pendente não é prova de entrega, e tratá-lo assim transformava uma
  queda passageira do provedor em uma hora sem recuperação. O caminho bloqueado do login responde
  antes de consultar a conta e abrir o alerta, e a deduplicação desse alerta
  passa a ser garantida por índice único parcial (`303`) em vez de
  check-then-insert. *(ADR 0049, nota editorial; migrations `298`–`303`)*
- **Confirmação do Email de Recuperação em rota pública:** o link enviado ao
  endereço novo passa a apontar para `/portal/confirmar-email`, sem exigir
  sessão. Antes ele levava a `/portal/perfil`, rota protegida, e quem abrisse
  sem estar logado era redirecionado ao login por `PortalProtectedRoute` — que
  navega sem preservar a query string, descartando o token em silêncio. A
  autorização da troca continua no pedido (sessão ativa **e** senha atual); a
  confirmação prova apenas posse da caixa nova. `PortalProfile` mantém o
  parâmetro antigo enquanto os convites de 48 horas já enviados não expiram.
  *(ADR 0048)*
- **Mensagens do login e da recuperação do Portal:** a tela de confirmação de
  `/portal/esqueci-senha` passa a afirmar o envio do link em vez de condicioná-lo
  a "se houver uma conta para este CNPJ" — o condicional devolvia ao cliente o
  sinal de enumeração que o backend já não dava (achado 3.2). Falha de rede
  deixa de reaproveitar esse texto e mostra erro real, e CNPJ com menos de 14
  caracteres é reprovado na própria tela, em `/portal/login` e
  `/portal/esqueci-senha`, por `src/lib/portalCnpjLogin.ts`. A validação cobre só
  o comprimento: metade dos `login_cnpj` reais não fecha dígito verificador.
- **Escrita interna global com rastro obrigatório:** migrations `294` e `295`
  congelam autor/departamento em `audit_logs`, registram mudanças por trigger,
  congelam a rota da importação e abrem a escrita interna aos cinco
  departamentos. Exclusão operacional, provisionamento do Portal,
  administração de usuários e sign-off departamental permanecem exceções;
  frontend, tipos, timeline e ADR 0046 foram alinhados. *(PR 533)*
- **Investigação da lentidão de inicialização:** adiciona harness autenticado
  frio/quente e checkpoints sanitizados de startup, impede cache de uma hora no
  shell `/` do Firebase Hosting e mantém Auth, banco e waterfalls pendentes até
  existir baseline autenticado e acesso administrativo ao Supabase.
- **Inspeção do Portal:** documentada a rota interna somente leitura
  `/clientes/portal/inspecao/:customerId/*`, com `PortalLayout` compartilhado
  entre cliente e inspeção, modo visual identificado, navegação por `basePath`,
  bloqueio das escritas do cliente e abertura auditada. A fidelidade usa
  núcleos parametrizados compartilhados pelas RPCs do cliente e de inspeção;
  `portal_get_session_overview_v2` é exceção por atualizar `last_login_at`.
  Equipamentos passa a descobrir o console sem disparar o self-heal gravável.
  *(ADR 0045; plano da PR 529)*
- **Remediação de segurança do Portal do Cliente:** `import_manifest_transactional`
  ganha guarda de identidade (sessão interna ativa + `p_uploaded_by = auth.uid()`,
  migration `290`), `/portal/esqueci-senha` deixa de enumerar CNPJs cadastrados,
  o token de reset/ativação é removido da URL e da telemetria, o CORS do
  `portal-invite-activate` passa a usar a allowlist, e o grant residual a
  `anon` em `portal_invoice_details` é revogado. *(plano arquivado
  `2026-08-12-remediacao-seguranca-portal`; origem: auditoria
  `security-audit-portal-2026-08-12`)*
  - **Revisão de código na mesma PR:** o envio de email de
    `portal-password-recovery` deixa de ser aguardado antes da resposta (roda
    em segundo plano via `EdgeRuntime.waitUntil`), fechando um oráculo de
    enumeração por *timing* que sobrevivia à equalização do corpo da
    resposta; `beforeSend` da telemetria passa a redigir também
    `breadcrumb.data` (não só `breadcrumb.message`), fechando o vazamento do
    token de reset/ativação pelo breadcrumb de navegação do Sentry que a
    própria remoção do token da URL disparava; e um teste de invariante
    (`portalInvoiceDetailsAnonGrantInvariant.test.ts`) passa a travar, em
    todas as migrations, que `anon` nunca retenha `EXECUTE` em
    `portal_invoice_details`, para o grant residual não voltar a ser
    reintroduzido silenciosamente por uma futura edição da função.

- **Leitura interna volta a ser global; departamento só restringe escrita
  (ADR 0044):** migration `291` corrige `014`/`020`/`066`/`111`, que haviam
  restringido o `SELECT` de 13 tabelas financeiras (`charge_tables`,
  `invoices`, `payments`, ledger de recebíveis etc.) a `is_admin()` — um
  resquício do modelo antigo admin/operator. Taxas Locais, Faturamento,
  Relatórios, Conciliação PIX e a aba Financeiro da Ficha do Cliente voltam a
  funcionar para Financeiro, Operações, Documentação e Equipamentos.
  `charge_tables`/`charge_table_items`/`customer_rate_overrides` também
  ganham `can_edit_local_charges()` no INSERT/UPDATE/DELETE, alinhando a RLS à
  permissão que Documentação já tinha no frontend. `/taxas-locais` separa
  visualização (sempre visível) de edição; `PROFILE_SCOPES` corrigido; gates
  de escrita de Viagens e Baplie alinhados a `voyages_edit`/`manifests_upload`
  em vez de `isAdmin`. *(plano `2026-08-13-rbac-leitura-global-por-departamento`,
  auditoria `2026-08-13-rbac-departamentos-visualizacao`)*

- **Spec comportamental na edição `2026-08-12`:** rebuild diferencial contra as
  migrations `001`–`289`, 42 rotas, 103 RPCs e 12 Edge Functions — 36 linhas
  novas (ADR, provisionamento e autenticação do Portal, `admin-users`, cadastro
  de depot e RPCs de CE master, omissão, granito, recebíveis, vencimento e ROE),
  3 linhas removidas por comportamento que não existe mais (gerador de EDI
  Mercante, redirect `/line-up-tv`, `provision-portal-user`) e 8 referências
  reparadas. A edição `2026-07-02` foi arquivada.

- **Controles de vencimento e COD:** administrador pode ajustar o vencimento de
  uma invoice aberta (RPC `update_invoice_due_date`, migration `282`), com o
  detector de atraso mantido como única rotina que transiciona para `overdue`;
  a ação Transbordo/COD do B/L passa a aparecer sempre que existe omissão, ainda
  sem disposição persistida. *(plano `2026-08-11-billing-adr-controls`)*

- **Fixture QA de exibição encerrada como engenharia:** os scripts
  `scripts/qa-display-production/` seguem disponíveis, a execução contra
  produção não foi realizada e o catálogo parcial saiu do repositório.
  *(plano `2026-08-09-fixture-qa-display-producao`)*

- **Desempenho de carregamento:** removidos canais Realtime sem consumidor,
  pré-carregados os chunks das rotas durante a autenticação, adicionados
  preconnects externos, índice linear do Line Up e orçamento de bundle alinhado.

- **CE Mercante confirma o faturamento do Granito:** Granito passa a importar
  CE para `granite_bls`, aguardar CE na Validação e emitir automaticamente após
  o cadastro; CEs preenchidos são únicos por B/L, resolvidos por viagem e
  auditados pela RPC. *(ADR 0042)*

- **Vínculo de cliente por documento:** CPF/CNPJ exato é o único vínculo
  automático; match por nome vira sugestão visível na fila de revisão para
  B/Ls de container, carga solta e Granito. Sugestões ficam em colunas próprias,
  não liberam faturamento, e o backfill preserva faturados e decisões humanas.
  *(ADR 0043; migrations 284–287)*
- **Correções da fila de bloqueios de faturamento:** restaura o fluxo de Granito, corrige a classificação de B/L pronto, toasts, invalidações e truncamento da fila. *(PR #512)*

- **Validação do Faturamento vira fila de bloqueios:** a aba passa a derivar
  três causas fechadas (cliente, cálculo e CE Mercante), remove o funil e os
  atos de aprovação/marcação em lote, mantém recálculo e emissão por linha,
  exporta a conferência em XLSX e registra falhas de emissão automática em
  Alertas. *(ADR 0041; plano arquivado `2026-08-10-validacao-fila-de-bloqueios`)*

- **Impresso do ADR padronizado na fatura:** o documento impresso do Agency
  Departure Report passa a usar a mesma linguagem visual da fatura de taxas
  locais — Arial 13px sobre branco, cabeçalho com a logo e identificação da
  escala, título centralizado com régua, fatos da escala no bloco de metadados
  (rótulo/valor), tabelas com cabeçalho navy `#1A2744` e texto branco, zebra
  `#f9fafb`, barra de total âmbar `#F59E0B` no fim de cada listagem (antes o
  total vinha no topo) e faixa clara `#e8edf5` como título de seção. A paleta e
  os estilos de tabela viraram tokens em
  `src/components/shared/invoiceFormat.ts`, consumidos pelos três documentos
  (taxas locais, Demurrage e ADR); o bloco CSS próprio do ADR
  (`agency-report-document__*`, paleta bege com grade cheia) saiu de
  `src/index.css`. Junto, correção de impressão: com o modal aberto, a
  pré-visualização do ADR na aba deixa de sair impressa em duplicidade.
  Mudança só de apresentação — snapshot, RPCs e cálculos intactos.
  *(plano arquivado `2026-08-08-impresso-adr-linguagem-visual-fatura`)*
- **Vigência da tabela de taxas vira informativo:** a vigência da Tabela de
  Taxas Locais deixa de participar do cálculo — `resolve_local_charge_table_id`
  resolve por escopo (modo de carga + POD) e por `active`, desempatando entre
  ativas pela vigência inicial mais recente; inativar passa a ser a única forma
  de tirar uma tabela do ar. Junto sai a trava do ETA: `review:no_eta` deixa de
  existir e o cálculo não para mais por falta de ETA da escala. A Data de
  Referência da Tarifa sobrevive só para resolver a Condição de Cliente (cuja
  vigência continua valendo), com precedência ETA da escala → ETA da viagem →
  data de hoje. Em `/taxas-locais`, a vigência ganha avisos no lugar da trava:
  vencida ou futura em tabela ativa, e "não aplicada" quando outra tabela ativa
  do mesmo POD e modo de carga vence o desempate. O gate de
  `ready_for_billing`, que exigia tabela vigente em `CURRENT_DATE` desde a
  migration `019`, passa a usar o mesmo critério de escopo + `active` — sem
  isso a trava só mudaria de lugar. Migrations `274` e `275`. *(ADR 0040;
  supersede parcialmente a decisão 3 da ADR 0038)*
- **Prazo de Conclusão do ADR — linha do tempo e medição por departamento:** a aba ADR ganha uma Linha do Tempo (ATD da escala unificada, POD canônico com fallback do POL, e o momento do seu registro; o Prazo de Conclusão — 3 dias úteis, segunda a sexta, feriados contam, dia do ATD nunca conta — calculado por uma função pura compartilhada entre tela, alerta e agregado; as 3 assinaturas departamentais com data/hora/assinante e reaberturas com justificativa; Fechamento sem prazo próprio). Sem ATD ou em escala omitida, a linha do tempo fica sem cor — nunca vencida por omissão. Novo alerta `agency_report_deadline_missed` (migration `261`), um por departamento vencido sem assinatura vigente, independente do alerta de pendência pós-ATD existente e fechado junto com o Fechamento; vigência própria não retroage a ADRs anteriores à feature. No fechamento, os marcos são congelados dentro das chaves já existentes de `closed_snapshot` (nenhuma chave de topo nova); o impresso mostra só as datas de assinatura e as reaberturas — nunca o veredito de prazo, cor ou contagem de dias, que ficam só nas telas. Agregado de calibração por (viagem, porto) em `/admin/usuarios` (aba "Prazo do ADR"), somando cumprimento **por departamento**, nunca por pessoa, para o prazo de 3 dias poder ser ajustado com dado real. *(plano arquivado `2026-08-06-adr-prazo-conclusao-linha-do-tempo`; ADR 0039)*
- **Faturamento: ADR 0038 completa e consolidação de `/faturamento`:** taxa
  local vira valor congelado ancorado na escala do POD, nas 13 etapas do
  plano. Fatura consolidada congela `invoice_items` na consolidação, não só a
  individual; recálculo é recusado para B/L já faturado; promoção automática
  `calculated → ready_for_billing` sai, e o cálculo passa a ter duas fases —
  provisório no import (antes do CE Mercante), confirmado e emitido no CE.
  Situações que cobravam zero em silêncio (item sem implementação no motor,
  THD com perfil `any`, B/L sem containers) agora param e sinalizam
  `review_required`. Isenção de veículo passa a exigir prova positiva de
  LCL/CFS em `movement_to` — corrige um bug que isentava 100% dos B/Ls com
  veículo por o motor escrever e ler seu próprio `container_load_type`. Data
  de referência da tarifa passa a ser a ETA da escala do POD, não o upload do
  lote. Condições de Cliente sobrepostas viram restrição de exclusão no
  banco. Taxa local em USD converte para BRL na emissão pelo ROE vigente, sem
  o Recálculo Diário do Demurrage — e a mesma migration corrige um bug
  pré-existente de emissão automática de fatura sem checar CE Mercante
  (trigger `trg_emit_invoice_on_bl_ready`, removido). Rateio de container
  compartilhado fecha exatamente o valor cheio do item (o último B/L do grupo
  absorve o centavo de arredondamento). `/faturamento` perde as abas
  Pendências (subconjunto literal da Validação) e Demurrage (duplicava
  `/demurrage`); a segunda vira uma faixa de métricas com link para o módulo
  real. Migrations `261`–`269`. *(plano arquivado
  `2026-08-06-faturamento-ajuste-completo`; ADR 0038, nota editorial na
  ADR 0008)*

- **Criação e gestão de usuários internos em `/admin/usuarios`:** administrador cadastra nome, e-mail, setor e senha (`email_confirm: true`, login imediato, sem convite por e-mail — diverge deliberadamente do fluxo do Portal do Cliente, ADR 0037); altera e-mail/senha a qualquer momento; cada usuário troca a própria senha mediante revalidação da senha atual. Setor passa a ser obrigatório no cadastro (papéis legados `admin`/`operator` recusados). Escrita privilegiada isolada na Edge Function `admin-users`, que reserva `service_role` às operações de autenticação e usa o cliente do chamador para escrever em tabela, preservando RLS e o autor na auditoria; leitura via RPC `admin_list_users` (`SECURITY DEFINER`, restrita a `authenticated`). Tela ganha busca por nome/e-mail, colunas de e-mail e último acesso, e confirmação ao trocar de setor exibindo o escopo do destino. Corrige dois defeitos pré-existentes: troca de setor/status agora é auditada por trigger no banco (`trg_audit_user_profile_changes`), e desativar um usuário agora encerra a sessão ativa dele (antes só virava o flag, com o token válido até expirar). Migrations `259`/`260` (revoga `EXECUTE` de `anon` em `admin_list_users`, achado numa checagem pós-deploy — o projeto concede `EXECUTE` a `anon` por default privilege a cada função nova, e `REVOKE ... FROM PUBLIC` não atinge esse grant nomeado). *(plano arquivado `2026-08-05-admin-usuarios-criacao`; ADR 0037)*
- **Veículos: local de desova na importação e cards de consolidação no ADR:** planilha de Veículos passa a ler a coluna opcional `Local de desova` (aliases), preenchendo `unpacking_location` no container correspondente; página `/veiculos` filtra por local de desova, com seleção de todas as linhas filtradas e ação em massa; a seção Veículos do ADR ganha os cards "Containers distintos por tipo" e "Veículos por modelo", além dos totais de VINs e locais já existentes. Migration `255`. *(plano arquivado `2026-08-05-vehicles-desova`)*

## 2026-07

- **Escala unificada POL/POD:** a escala passa a ser `(viagem, porto brasileiro)`, unificando linhas POD, POL e EXP na projeção consumida por Viagens, Próxima Escala, Line-Up, ADR e alertas; viagens só de exportação passam a ter escala/ADR/alerta; `voyage_export_schedules` aceita uma linha por `(voyage_id, pol)` e o alerta pós-ATD do ADR lê também o ATD documental do POL. A digitação vira **um botão e um modal por escala**, com a exportação atrás de um toggle explícito (`tem_exportacao`) que não pode ser retirado enquanto houver carga vinculada; as datas passam a ser exclusivamente da escala (`voyage_export_schedules` perde `eta`/`etb`) e o porto é escolhido entre os sete portos brasileiros, recusando estrangeiro. Line-Up, Painel e TV continuam segregando importação e exportação, com as mesmas datas da escala. Migrations `250`–`252`. *(plano arquivado `2026-07-31-escala-unificada-pol-pod`; ADR 0035 e sua nota editorial de 2026-08-03)*
- **ADR: cobertura do transbordo, fontes da descarga e relatório sem zeros:** carga em transbordo passa a contar no ADR do porto onde foi efetivamente descarregada, separada da carga de destino final desse porto; containers cheios saem exclusivamente dos B/Ls (documental, ADR 0025) e vazios do Baplie ganham natureza própria (`vazio`), com avisos de divergência contra o Baplie e contra os vazios descarregados; escala omitida com ADR já fechado antes da omissão continua acessível e imprimível; aba e impresso passam a exibir a Listagem do operado (sem matriz de zeros); impresso ganha resolução por seção (estado + assinante + data) e bloco final de Assinaturas departamentais (`departmentSignoffs`); granito casa por porto normalizado (`normalizePortCode`) com fallback do manifesto-pai; porto do Embarque de Vazios vira seleção entre as escalas da viagem; cálculo da linha de serviço unificado em `totalLinha`; validação do snapshot de fechamento restaurada (migration `249`); aviso informativo de dado órfão para granito/vazios embarcados fora das escalas da viagem. *(plano arquivado `2026-07-31-adr-cobertura-fontes-forma`; ADR 0035)*
- **Fechamento VAZIOS EXP / ADR:** importação de Unidades Embarcadas rejeita containers duplicados no parser e na RPC; inclusão manual é atômica (`243`/`244`), sem manifesto órfão, e suas regras de local/datas retornam mensagens de validação seguras (`245`). O impresso fechado passou a refletir Observações por seção e Linhas de Serviço, sem OS, overtime percentual ou Ocorrências aposentadas.
- **VAZIOS EXP / ADR 0033:** Embarque de Vazios por escala, Lista de Unidades Embarcadas com importação substitutiva de sete colunas, Linhas de Serviço manuais com percentual/preço efetivos, Cadastro de Terminais com free times por condição e catálogo de valores sugeridos; ADR passou a exibir linhas detalhadas e anexo de unidades de armazenagem. Migrations `238`–`240`.
- **Aprofundamento arquitetural:** invalidação de cache por eventos de domínio em `cacheEffects.ts`; classificação centralizada de recusas do banco em `classifyDbError`; leitura e casamento de cabeçalhos de planilha centralizados em `importCore.ts`; `FileImportModal` adotado em Carga Solta e Vazios de Importação; cobertura adicionada para Taxas Locais e Line-Up.

- **Correções pós-PR #424:** reparo do encoding da aba do ADR, reclassificação de `visual_check` como serviço de Quantidade (migration `236`), filtro de ativação e vigência no motor de custo, restauração do fluxo operacional do Vazios EXP, e recuperação da cobertura do ADR, RBAC e parser; migration `237` adiciona índice para `vazios_operation_service_qty(depot_service_id)`.

- **VAZIOS EXP / ADR 0031:** Cadastro de Depot com tarifas e serviços, importação por upsert no grão `(viagem, container)`, parser da planilha real, cálculo por container/operação em duas abas e valores consolidados na Operação de Pátio do ADR; migrations `229`–`233`.

- **ADR sign-off departamental:** aba do ADR reorganizada em 5 faixas na ordem do ciclo da escala (Escala → Importação → Operação de pátio → Exportação → Registro), com barra-resumo dos 3 departamentos no topo; sign-off passou a ser um ato por departamento (não por seção), habilitado só com todas as seções do departamento resolvidas, com reabertura auditada (`set_agency_report_department_signoff`, migration `223`); fechamento exige 3/3 departamentos, não 7/7 seções (migration `224`); alertas de pendência pós-ATD migraram de seção para departamento (migration `225`); Operação de pátio virou a 8ª seção, sob Equipamentos, separada de Embarque de vazios (migration `222`); ocorrências passaram a aceitar os 3 departamentos e tag opcional de seção (migration `226`); números-heróis, IMO destacado à parte e correções de cópia ("Veículos", "Descarga de importação"). Documento impresso (`AgencyReportDocument`) fica temporariamente desalinhado, redesenho em fase seguinte. *(plano arquivado `2026-07-21-adr-signoff-departamental-ciclo`; ADR 0029)*
- **ADR pós-implementação:** correções da revisão pós-merge do Agency Departure Report — carga solta derivada dos campos BB dos B/Ls e presente no snapshot; documento fechado/impresso reescrito fiel ao modelo real (matrizes como tabelas, granito, local de desova, OS/embarque direto/depots, autor do fechamento); chip de sign-off `carga_carregada` movido para Granito e carga solta sob `carga_descarregada`; reabertura do ADR passou a exigir `is_admin()` no servidor (migration `218`); `close_agency_departure_report` valida a forma do snapshot; fechamento/reabertura invalidam caches de alertas. Migrations `211`–`216` (e `217`–`221`) confirmadas aplicadas no remoto. *(plano arquivado `2026-07-20-adr-correcoes-pos-implementacao`; ADR 0027/0028)*
- **Pós-auditoria UX 2026-07-20:** saldo pendente da Ficha do Cliente passou a somar invoices vencidas e parcialmente pagas, não só emitidas (alinhado ao glossário); alertas pós-ATD do ADR ganharam mensagem legível com backfill (migration `219`); sign-offs e ocorrências do ADR mostram autor via RPC dedicada (`get_agency_report_actor_names`, migration `220`); nova página `/embarquevazios/taxas` para tarifas de reorganização; card "Operação da escala" sempre visível com seletor embutido; ação em massa de local de desova em `/veiculos`; aba Faturamento da Ficha BL com estado único "Faturado" quando já emitida fatura. *(auditoria `docs/design-audit/README.md`; plano `2026-07-20-ux-pendencias-pos-auditoria`)*
- **Pós-auditoria PRs #405/#406:** RBAC de COD/transbordo e de escrita de clientes/contatos passou a ser reforçado no banco (`can_edit_voyages()`/`can_edit_customers()`, migration `215`), não só escondido na UI; leitura de recebíveis do cliente migrou para RPC dedicada (`get_customer_receivables`, migration `216`) para não confundir "sem recebível" com "sem permissão"; corrigido overload duplicado de `omit_voyage_escala`; timeline da ficha do cliente passou a incluir pagamentos locais e a ser invalidada por mutação de contato; abas Visão Geral/Financeiro/Histórico da ficha e o card de status Baplie do B/L Cockpit distinguem carregando/erro/vazio; agregados (saldo, pendências) paginam até esgotar em vez de truncar. *(auditoria `docs/archive/audits/2026-07-19-pos-merge-audit-pr405-406.md`)*
- **Ficha do Cliente:** `/clientes/:cnpj` foi reestruturada como hub em cinco abas, com saldo pendente consolidado, demurrage, recebíveis, pagamentos, tarifas, histórico, pendências e deep link para Overrides de Taxas Locais; campos comerciais mortos foram removidos do código e do banco pela migration `207_drop_customer_commercial_fields.sql`.
- **B/L Cockpit 360°:** ficha `/manifestos/:blId` ganhou Visão Geral padrão, trilhos operacional/financeiro com próxima ação, réplica documental com Frete & Despesas, operação de Transbordo/COD no B/L, visibilidade do Portal e divergências Baplie; migrations `205` e `206` são forward-only. *(plano/spec `2026-07-18-bl-cockpit-360`)*
- **Qualidade de código:** formatadores e `PreviewBox` consolidados; serviços de billing/timeline e páginas/abas de Clientes, Demurrage, Taxas Locais e Validação de Faturamento decompostos sem mudança de contrato, com testes comportamentais nos componentes-página. *(plan `2026-07-18-code-quality-audit-remediation`)*
- **Refinamento operacional (WS1–WS4):** ingestão documental de B/L com alias de navio (`canonicalizeVesselName`), ciclo completo de datas por escala com estado derivado (`deriveEscalaState`) no Painel/Line-Up TV, registro global de transbordo com timeline consolidada no Portal (migrations `201`–`202`), e câmbio PTAX/ROE com data efetiva (migration `200`). *(spec `refinamento-operacional-viagens-importacoes-lineup-portal`; plans `2026-07-16-ws1`–`ws4`)*
- **Portal:** fila de provisionamento autorrecuperável (migration `198_portal_provisioning_queue_self_heal`). *(spec/plan `2026-07-16-portal-fila-autorrecuperavel`)*
- **Docs:** reorganização de `docs/` — planos vivos só em `plans/`, specs vivas só em `spec/`, archive achatado (`plans/`, `specs/`, `audits/`, `reports/`); pastas `superpowers/` aposentadas. Ciclo de vida documentado em `CONVENCOES.md`.

## 2026-06

- **Portal:** login visível alterado para CNPJ + senha via Edge Function `portal-login`; o navegador não resolve nem recebe o email técnico. O fluxo anterior de CNPJ/CPF/email com `portal_resolve_login` fica registrado como comportamento superado.

- **Revisão/Portal/Faturamento:** correções pós-PRs 249–251: gate canônico aplicado em importação e faturamento, status/auditoria sob autoridade do banco, portal válido somente com `active + auth_user_id`, UI compatível com RLS e provisionamento em sequência segura. Sem backfill de B/Ls históricos faturados. *(ADR 0006; migration `20260619130000_review_gate_hardening`; specs/plans `2026-06-19-review-gate-pr249-251-corrections`)*
- **Faturamento:** auto-faturamento após correção de cliente na revisão; guarda de estado `invoiceable_ready`. *(specs/plans `2026-06-18-auto-faturamento-apos-revisao`)*
- **Clientes/Importação:** preservar o motivo de bloqueio de faturamento do cliente durante a importação (sem inferência genérica). *(`2026-06-18-preservar-bloqueio-cliente-importacao`)*
- **Viagens:** refactor master-detail com rota dedicada `/viagens/:voyageId`, barra de filtros no topo, rail colapsável, linha do tempo (auditoria + eventos de CE), CE Master por manifesto, exportação de Baplie EDI. *(ADR 0012; `2026-06-17-viagens-refactor`; `docs/archive/plans/0001-viagens-redesign`)*
- **Chegadas/Saídas:** nova tela de schedule de navios por porto (`vessel_schedules`).
- **Portal:** gate por CE Mercante — só expõe B/Ls com CE preenchido. *(`2026-06-15-portal-ce-mercante-gate`)*
- **Portal:** login por CNPJ ou email (`portal_resolve_login`), endurecimento da resolução de login, rate limiting. *(supera o email-only do ADR 0001)*
- **Portal:** área de operação read-only (B/Ls, containers, demurrage), redesign de UX/UI, dashboard, disputas e notificações in-app. *(`2026-06-09-portal-operacao-cliente`, `2026-06-15-portal-cliente-ux-ui`)*

## 2026-06 (início)

- **Pós-auditoria:** correções de segurança e financeiras (demurrage PIX, revogação de anon, default-deny em funções). *(`2026-06-09-correcoes-pos-auditoria`; ADR 0011)*
- **Exclusões:** exclusão controlada de B/Ls, containers, veículos e clientes com enforcement de bloqueio fiscal. *(`2026-06-09-exclusao-bls-containers-veiculos-clientes`; ADR 0009)*
- **Clientes:** melhorias de UX na tabela (ações compactas, filtro, ordenação). *(`2026-06-11-clientes-ux-melhorias`)*
- **Ajustes operacionais/financeiros:** reconciliação Baplie e regras de cliente. *(`2026-06-01-ajustes-operacionais-financeiros`)*

## Manutenção (sprint 2026-06-15)

- Upgrade do toolchain Vite e dependências (fechamento de advisories).
- Endurecimento da resolução de login do portal (rate limit anti-enumeração).
- Correção do filtro de devolvidos na operação do portal.
- Export CSV do billing do portal respeitando filtros ativos.
- Alertas de vencimento do dashboard por dias de calendário.

> Planos e specs completos em [archive/plans/](archive/plans/) e [archive/specs/](archive/specs/).
## 2026-08-07

- Consolida a implementação do ADR 0039, as correções da revisão da PR 503 e
  a documentação da rota `/perfil` em uma única entrega pronta para `main`.
# Próxima entrega

- adiciona harness autenticado frio/quente e checkpoints sanitizados de startup;
- impede cache de uma hora no shell `/` do Firebase Hosting;
- mantém a investigação de Auth, banco e waterfalls pendente até haver baseline
  autenticado e acesso administrativo ao Supabase.
# PR #576 — correções pós-revisão da integração de Alertas

- carriers legados de Dispute consolidados em um único agregado;
- RPCs genéricas e detectores protegidos contra execução pelo browser;
- ciclo de vida de Dispute, rate limit, notificações do Portal e anexos corrigidos;
- roteamento compartilhado, paginação e rastreabilidade atualizados;
- planos/specs concluídos arquivados conforme `docs/CONVENCOES.md`.
# Próxima versão

- Comunicados: motor server-side de elegibilidade, runner protegido por segredo, painel de cobertura de viagens e filtros de origem/status no histórico.
