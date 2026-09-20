# Planos executados (archive)

Todos os planos de implementação **já executados**, consolidados aqui em
2026-07-18 (antes divididos entre `docs/archive/plans/` e
`docs/archive/superpowers/plans/`). O que cada entrega produziu está resumido
no [CHANGELOG](../../CHANGELOG.md); planos vivos ficam em
[`docs/plans/`](../../plans/README.md).

## Conteúdo

- [`2026-09-20-remediacao-fronteira-seguranca-portal`](2026-09-20-remediacao-fronteira-seguranca-portal.md)
  — fecha guards NULL-safe em RPCs internas, minimiza payloads financeiros do
  Portal, revoga sessões em modo fail-closed, equaliza o login contra enumeração
  por tempo e neutraliza curingas nos filtros de Comunicados. Migrations `067` e `068`.
- [`2026-09-17-unificacao-bls-carga-mista-e-manifesto-mercante`](2026-09-17-unificacao-bls-carga-mista-e-manifesto-mercante.md)
  — unificação de B/Ls com suporte a carga mista, rota canônica `/bls`, fatura
  adaptativa modular, modelo de lançamento de Manifesto Mercante (`manifestos_mercante`),
  descontinuação do termo "CE Master", e agregação de escalas. Migrations `053`–`058`.
- **Planos datados** (`YYYY-MM-DD-<tema>.md`) — features e correções de
  2026-06-01 a 2026-07-18, na maioria gerados pelas skills
  brainstorming/writing-plans.
- [`2026-07-18-code-quality-audit-remediation`](2026-07-18-code-quality-audit-remediation.md)
  — consolidação de formatadores e `PreviewBox`, decomposição de serviços,
  páginas e abas monolíticas, com cobertura comportamental dos pais.
- [`2026-07-20-adr-correcoes-pos-implementacao`](2026-07-20-adr-correcoes-pos-implementacao.md)
  — correções pós-merge do Agency Departure Report (carga solta derivada,
  documento fechado fiel ao modelo, mapeamento seção×bloco, RBAC de
  reabertura, validação de forma do snapshot, invalidação de alertas). ADR 0027;
  Task 0 (migrations `211`–`216` no remoto) concluída — remoto em `221`.
- [`2026-07-21-adr-signoff-departamental-ciclo`](2026-07-21-adr-signoff-departamental-ciclo.md)
  — sign-off do ADR por departamento (não por seção), operação de pátio como
  8ª seção, fechamento por 3/3 departamentos, alertas por departamento,
  ocorrências abertas aos 3 departamentos com tag opcional de seção, layout em
  5 faixas do ciclo com barra-resumo, números-heróis e correções de cópia.
  ADR 0029; migrations `222`–`226`.
- [`2026-07-24-correcoes-pr-424-cadastro-depot`](2026-07-24-correcoes-pr-424-cadastro-depot.md)
  — correções da PR #424 sobre o Cadastro de Depot por tipo de cálculo (ADR
  0032; migrations `236`/`237`). **Encerrado sem execução completa:** a ADR 0033
  aposentou o modelo de tipos de cálculo que o plano preservava, e as tarefas
  pendentes foram absorvidas pelo plano do Embarque de Vazios.
- [`2026-07-31-adr-cobertura-fontes-forma`](2026-07-31-adr-cobertura-fontes-forma.md)
  — transbordo passa a contar no ADR do porto de descarga real; containers
  cheios saem dos B/Ls e vazios do Baplie ganham natureza própria, com
  avisos de divergência e de dado órfão; aba e impresso passam a listar só
  o operado, sem zeros; impresso ganha resolução por seção e as 3
  assinaturas departamentais; granito casa por porto normalizado; porto do
  Embarque de Vazios vira seleção entre escalas; cálculo da linha de
  serviço unificado. ADR 0035 (blocos 2–4); migration `249`.
- [`2026-08-06-adr-prazo-conclusao-linha-do-tempo`](2026-08-06-adr-prazo-conclusao-linha-do-tempo.md)
  — Linha do Tempo do ADR (ATD unificado e seu registro, prazo, as 3
  assinaturas departamentais com reaberturas/justificativa, Fechamento sem
  prazo próprio); Prazo de Conclusão de 3 dias úteis por departamento (função
  pura compartilhada entre tela, alerta e agregado); alerta de vencimento
  independente do de pendência; marcos congelados no `closed_snapshot`
  (impresso mostra só datas de assinatura, nunca o veredito); agregado de
  calibração por departamento em `/admin/usuarios`. ADR 0039; migration `261`.
- [`2026-08-07-adr-0039-correcoes-pr503`](2026-08-07-adr-0039-correcoes-pr503.md)
  — correções da revisão pós-implementação: SLA sem assinatura, autores de
  reabertura, timeline fechada, carregamento antes do fechamento, escalas
  deletadas e `colSpan` do agregado.
- [`2026-08-09-fixture-qa-display-producao`](2026-08-09-fixture-qa-display-producao.md)
  — scripts idempotentes da fixture sintética `QA-DISPLAY-2026`/`QAD26`
  (inventário, criadores operacional/ADR/financeiro/Portal, validação e limpeza
  seletiva em dry-run). **Encerrado com a engenharia concluída e a execução
  contra produção não realizada:** os "Step 5" de cada task dependiam de
  credenciais que nunca foram configuradas. Os scripts seguem utilizáveis;
  o artefato parcial de 2026-08-09 foi removido do repositório.
- [`2026-08-11-billing-adr-controls`](2026-08-11-billing-adr-controls.md)
  — vencimento de invoice aberta editável por administrador (RPC
  `update_invoice_due_date`, migration `282`, detector de atraso preservado como
  única rotina que transiciona para `overdue`) e ação Transbordo/COD alcançável
  no B/L quando existe omissão sem disposição persistida.
- [`2026-08-13-rbac-leitura-global-por-departamento`](2026-08-13-rbac-leitura-global-por-departamento.md)
  — corrige o eixo de leitura de `014`/`020`/`066`/`111`, que restringia 13
  tabelas financeiras a `is_admin()`: migration `291` libera SELECT para todo
  perfil interno ativo (`is_active_read_user()`) e alinha INSERT/UPDATE/DELETE
  de `charge_tables`/`charge_table_items`/`customer_rate_overrides` à
  permissão `charge_tables`/`charge_overrides` já concedida a Documentação.
  Taxas Locais separa visualização (sempre visível) de edição (`canEdit`);
  `PROFILE_SCOPES` corrigido; gates de escrita de Viagens/Baplie alinhados a
  `voyages_edit`/`manifests_upload` em vez de `isAdmin`. ADR 0044.
- [`2026-08-14-rate-limit-portal-normalizador-compartilhado`](2026-08-14-rate-limit-portal-normalizador-compartilhado.md)
  — rate limit do Portal volta ao `normalize_cnpj` compartilhado (migration
  `298`; o regexp inline das `183`/`191` apagava as letras do CNPJ
  alfanumérico e fazia dois clientes dividirem o balde); sinal próprio para
  Email de Recuperação quebrado (`299`); troca assistida invalida os convites
  `confirmacao_email` pendentes (`300`); `credentials_revoked_at` fecha a
  janela de até 1 hora da sessão antiga (`301`); saída da lista de bloqueio de
  emails com rastro de quem liberou (`302`). Nas Edge Functions: trava de
  tentativas na verificação de senha da troca de email, confirmação que só
  consome o convite quando há o que aplicar, reuso do convite de recuperação
  vivo e caminho bloqueado do login em segundo plano. ADR 0049 (nota
  editorial).
- [`2026-08-13-correcao-regressao-inicializacao-login-navegacao`](2026-08-13-correcao-regressao-inicializacao-login-navegacao.md)
  — **arquivado por superação, não por conclusão.** Escrito para Firebase
  Hosting; a PR #552 migrou o hosting para Vercel e esvaziou a Task 4C. A
  Task 2 chegou a descartar o banco como gargalo e as PRs #554/#555
  substituíram o diagnóstico por Vercel Speed Insights. O harness
  `npm run perf:authenticated-startup` segue vivo. Nota editorial no topo do
  plano.
- [`2026-08-15-implementacao-bloco-520-bl-revisao.md`](2026-08-15-implementacao-bloco-520-bl-revisao.md), [`2026-08-15-implementacao-bloco-521-clientes-portal-alertas.md`](2026-08-15-implementacao-bloco-521-clientes-portal-alertas.md), [`2026-08-17-implementacao-bloco-524-adr-alertas.md`](2026-08-17-implementacao-bloco-524-adr-alertas.md)
  — planos dos Blocos 1, 2 e 5 concluídos pela integração da PR #576.
- [`2026-08-16-bloco-4-operacao-viagem-alertas.md`](2026-08-16-bloco-4-operacao-viagem-alertas.md)
  — implementação dos alertas e reconciliação de B/L esperado, Baplie ausente e cobertura,
  CE Mercante pendente, datas de escala/terminal pendentes e exportação pendente pós-ATD
  do Bloco 4 (#523). Migration `326_voyage_operation_alerts.sql`.
- [`2026-08-20-implementacao-bloco-525-transversal-portal.md`](2026-08-20-implementacao-bloco-525-transversal-portal.md)
  — entrega das superfícies transversais de Alertas e Notificações (sino interno, fila `/alertas` completa,
  resumo do `/painel`, falha de roteamento em `/admin/usuarios`, contratos negativos e Eco de Tratamento) do Bloco 6 (#525). Migration `339_treatment_echo_and_transversal_surfaces.sql`.
- [`2026-08-26-redesenho-da-pagina-viagens.md`](2026-08-26-redesenho-da-pagina-viagens.md)
  — redesenho estrutural e visual da página `/viagens` aba por aba, com base nos artboards do PR #588
  (Bloco 0: fundação e `is_oog`/`oog` no ADR; Bloco 1: Visão geral e planejamento por escala com atracações editáveis;
  Bloco 2: Importação organizada por escala/POD e nova barra de ações; Bloco 3: Exportação com agregação por terminal de
  embarque e suporte a multi-depot; Bloco 4: Rotas e Manifestos com grupo Mercante e ação de preenchimento; Bloco 5: ADR
  organizado por departamentos com acompanhamento de prazos; Bloco 6: barra de comando de filtros, cards em Syne e rail aprimorado).
  PRs #588, #591–#599.
- [`2026-09-03-issue-609-contatos-caixas-comunicacao.md`](2026-09-03-issue-609-contatos-caixas-comunicacao.md)
  — Autoatendimento do Cliente para contatos e Caixas de Comunicação (ADR 0064, Issue 609): 3 caixas oficiais
  (`documentacao_operacao`, `financeiro`, `demurrage`), salvamento atômico (`_apply_customer_contact_configuration`),
  desativação lógica (`deactivated_at`), captura de e-mails em B/L (`ensure_customer_contact_email`), reparo por fallback
  (`repair_customer_contact_box_fallbacks`), auditoria append-only agrupada (`customer_contact_change_events`),
  UI na Ficha do Cliente e Portal do Cliente, e migração de conferência e disparo de comunicados. Migration `008`.
- [`2026-09-12-plano-transicao-marca-vela.md`](2026-09-12-plano-transicao-marca-vela.md)
  — Transição de marca: Transhipping Desk → Vela e separação das superfícies de entrega (ADR 0066, PR #688).
  Renomeação do sistema interno para Vela com entrada em `index.html` e domínio `https://vela.app.br`, separação
  do Portal Fwlog em entrada dedicada `portal.html` e domínio `https://portalfwlog.com.br`, preservação da identidade
  jurídico-financeira Transhipping, e configuração de roteamento/CORS multi-host no Vercel e Edge Functions.
- **Planos numerados** (`001`–`006`, `0001`) — sprint de manutenção 2026-06-15
  ([README-2026-06-15-maintenance-sprint.md](README-2026-06-15-maintenance-sprint.md)),
  redesign de Viagens e correções pós-auditoria.
- **Subprojetos** (pastas com README próprio):
  - [`2026-07-08-transhipping-desk-edi-taxas/`](2026-07-08-transhipping-desk-edi-taxas/README.md)
  - [`cadastro-unico-navio-viagem/`](cadastro-unico-navio-viagem/README.md) (ADR 0021)
  - [`security-audit-2026-07-07/`](security-audit-2026-07-07/README.md)

As specs que originaram estes planos estão em [`../specs/`](../specs/).
Links internos podem refletir os caminhos anteriores à consolidação — o
conteúdo dos planos não é editado retroativamente.
