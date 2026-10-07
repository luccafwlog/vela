# Desbloqueio de CE Mercante — plano de implementação

> **Para execução por agentes:** usar `superpowers:executing-plans` para executar as tarefas e seus checks. Etapas em checkbox registram avanço; este documento não autoriza publicação.

**Objetivo:** introduzir a solicitação no Portal e a página Importação → Desbloqueio de CE no Vela, com quatro requisitos por B/L e exportação assistida para ZPT.

**Arquitetura:** pedido com múltiplos B/Ls, documentos comuns por pedido ou cobertura anual VIP por CNPJ; pagamento derivado do ledger e entrega física por B/L. RPCs mantêm autorização e transições; exportação ZPT tem cinco colunas.

**Stack:** React 19, TypeScript, React Router 7, TanStack Query 5, Supabase Auth/PostgreSQL/Storage/Edge Functions, Vitest e Testing Library já existentes.

**Spec:** [desenho funcional](../spec/2026-10-04-desbloqueio-ce-mercante-design.md).

**Estado reconciliado em 2026-10-07:** implementação integrada no código da
`main`; publicação e operação remotas não conferidas nesta reconciliação.
PDF oficial e homologação externa seguem sem evidência de conclusão.

**Como ler o checklist:** `[x]` registra o resultado específico comprovado pela
fonte indicada; `[ ]` registra trabalho ou evidência ainda necessários. Um teste
existente não equivale a execução recente, e código integrado não comprova deploy.
Itens que misturavam implementação e aceite foram separados.

Contratos executados usam tipos snake_case, `ce_unlock_read` e dispatchers
`ce_unlock_command`/`portal_ce_unlock_command` com allowlists. Os serviços do
Portal estão em `ceUnlockService.ts`; regras/layout e seus testes estão em
`ceUnlockRules.ts` e `ceUnlockRules.test.ts`. Os nomes de interfaces/arquivos
propostos nas tarefas abaixo são referência do desenho inicial, não arquivos
faltantes quando substituídos por esses donos. O bloco CE atual é `139`–`149`;
`137`–`138` pertencem à Central de Informações. Tipos gerados preservados.

Fontes da reconciliação:

- **Código:** [módulo vivo](../modules/desbloqueio-ce.md),
  [serviço](../../src/services/ceUnlockService.ts),
  [tipos](../../src/types/ceUnlock.ts) e migrations `139`–`149` no checkout.
- **Teste:** [suíte SQL local](../../src/integration/ceUnlock.local-pg.test.ts)
  contém cenários de isolamento, financeiro, VIP, concorrência e histórico;
  exige ambiente descartável e habilitação explícita. Não executada novamente
  nesta reconciliação.
- **Teste:** 20 testes focados em nove arquivos de regras, PDF, serviços, cache,
  páginas e componentes passaram na análise desta sessão em 2026-10-07.
- **Teste/Runtime históricos:** [relatório local de 2026-10-05](../archive/reports/2026-10-04-desbloqueio-ce-implementacao.md)
  registra gates, 21 cenários SQL e navegador local com shims. Sua descrição
  de branch sem push/PR e numeração antiga de migrations é histórica; não
  descreve a integração atual na `main`. Não comprova ambiente remoto.

## Restrições globais

- Todos os B/Ls de importação com CE aparecem na página interna, mesmo sem pedido.
- Pagamento confirmado obrigatório no envio; quatro requisitos obrigatórios para aptidão.
- Sem comprovação de desbloqueio por aprovação documental ou exportação.
- Um cliente por pedido, até 100 B/Ls, um pedido ativo por B/L.
- PDFs até 10 MiB por documento; 20 uploads/24h e 100 MiB ativos por cliente.
- Documentos comuns compartilhados dentro do pedido; documentos anuais VIP entre pedidos do mesmo CNPJ, somente aprovados/vigentes. Alterações versionadas.
- VIP não dispensa pagamento nem entrega física, e selo VIP sem cobertura não dispensa anexos/documentação.
- Documentos VIP válidos até 31/12 do ano correspondente, inclusive, em America/Sao_Paulo; sem renovação automática em janeiro.
- Planilha ZPT: somente BL, Termo, Procuração, Entrega de BL, Pagamento das taxas; VIP usa os mesmos quatro indicadores.
- Preservar sessões interna/Portal, inspeção somente leitura e autorização no banco.
- Migrations novas seguem `WORKFLOW.md` §5; escolher o próximo NNN na execução.
- Não editar migrations existentes nem `src/types/database.ts` sem autorização explícita exigida pelo guard; usar tipos de domínio próprios para os contratos novos.
- Não instalar bibliotecas, aplicar migrations ou publicar funções durante este planejamento.

## Foco da revisão

1. Fatura consolidada parcialmente paga: somente liquidações reais por B/L contam.
2. Cancelamento de baixa entre seleção e exportação: recusar aptidão na transação.
3. IDs e caminhos de outro CNPJ, incluindo inspeção: negar leitura, escrita e download.
4. Retry/concorrência/reenvio: evitar pedido duplicado e aprovação de documento antigo.
5. CE corrigido ou B/L compartilhando pedido com outro pendente: preservar andamento individual e snapshot.

## Mapa do código atual

Portal e Vela têm páginas, hooks e componentes de Desbloqueio de CE, ligados
às rotas, permissões e famílias de cache existentes. O dono de acesso é
`ceUnlockService.ts`; o banco revalida pagamento e transições. Pagamento usa
`bl_receivables`, liquidações e vínculos de invoice do Cliente atual, sem usar
um booleano do navegador ou status isolado de invoice como prova.
A ausência do módulo descrita no levantamento inicial foi superada pela implementação.

## Tarefa 1 — Homologar regras e contratos de domínio

**Arquivos:** atualizar a spec e este plano; criar `src/types/ceUnlock.ts`.

**Interfaces propostas:** `CeUnlockRequest`, `CeUnlockItem`, `CeUnlockDocument`,
`CeUnlockEligibility`, `CeUnlockExport`; IDs de pedido/anexo/lote como UUID,
`blId: string`, `customerId: number`, datas ISO UTC, `expectedVersion: number`.
`CeUnlockEligibility` contém `canSubmit`, `canExport`, os quatro requisitos e
`reasons: string[]`. Distinção de estados conforme tabela da spec.
Adicionar `CeUnlockVipCoverage` com `customerId`, `vipEnabled`, documentos por
tipo, status, `coverageYear`, `validFrom`, `validUntil` e versão; origem `request`/`vip_annual`
e referências documentais em cada item. VIP só permite envio sem anexos quando
os dois documentos anuais estiverem aprovados e vigentes.
`CeUnlockPage<T> = {items:T[]; total:number; page:number; page_size:25}`;
`CeUnlockFilters = {search?:string; customerId?:number; voyageId?:number;
pod?:string; situation?:string; pendingRequirement?:'termo'|'procuracao'|'taxas'|'bl_fisico'}`.
Filtros públicos não recebem `customerId`; listas públicas retornam somente
dados autorizados pela sessão. Datas de negócio usam timezone do cliente na
apresentação; timestamps persistidos continuam UTC.

- [x] Registrar os defaults de execução autorizados para entrega, papéis, retenção e indicadores Sim/Não, conforme decisões do relatório local. Isso não substitui aceite operacional/jurídico.
- [x] Registrar a decisão de execução de não criar entidade distinta “CS”, conforme relatório local.
- [x] Registrar as cinco colunas ZPT, documentos anuais VIP por CNPJ e validade até 31/12 sem renovação automática.
- [x] Implementar tipos, versões, requisitos e motivos públicos separados do andamento externo. **Código:** `ceUnlock.ts`; layout usa `layout_version`, e o pedido referencia `model_id`, em vez de exigir os nomes `layoutVersion`/`modelVersion` inicialmente propostos.
- [ ] Obter/reconciliar aceite operacional de entrega, matriz de papéis, assinatura/validade, retenção, isenção e ajustes locais na spec; cadastrar o PDF oficial fornecido pelo responsável.
- [ ] Homologar a amostra XLSX e os indicadores Sim/Não com responsável/ZPT; revisar spec/plano no aceite.

## Tarefa 2 — Persistência, autorização e requisito financeiro

**Arquivos:** novas migrations em `supabase/migrations/` para fundação e RPCs;
criar `src/integration/ceUnlock.local-pg.test.ts` e
`src/services/__tests__/ceUnlockMigration.test.ts`.

**Interfaces SQL:** `ce_unlock_bl_eligibility(p_bl_id text) -> jsonb` (helper
privado); `portal_list_ce_unlock_bls(p_filters jsonb, p_page integer) -> jsonb`;
`portal_list_ce_unlock_requests(p_filters jsonb, p_page integer) -> jsonb`;
`portal_get_ce_unlock_request(p_request_id uuid) -> jsonb`; leituras com
wrappers `portal_inspect_*` e `p_customer_id bigint`, seguindo o dispatcher.
Resposta paginada `{items, total, page, page_size:25}`.
`portal_create_ce_unlock_draft(p_bl_ids text[], p_request_key uuid) -> jsonb`;
`portal_submit_ce_unlock_request(p_request_id uuid, p_expected_version bigint, p_request_key uuid) -> jsonb`.

- [x] Implementar entidades, FKs, RLS/grants, eventos, seleção até 100 B/Ls, reserva ativa, locks, versões e idempotência. **Código:** migrations CE e dispatchers.
- [x] Implementar cobertura anual por CNPJ e referências documentais por item; envio revalida a elegibilidade, sem congelar o pagamento no rascunho.
- [x] Implementar pagamento pelo ledger do Cliente atual, com liquidação real e saldo exigível zero; bloquear pendências financeiras de troca de CNPJ. **Código:** migration `149`.
- [x] Disponibilizar testes SQL de escopo/papéis, pagamento parcial, cobertura VIP, revogação, troca de Cliente, versões e confirmação por B/L. **Teste:** `ceUnlock.local-pg.test.ts`; existência conferida, sem nova execução nesta revisão.
- [x] Registrar replay local descartável, testes SQL e gates de migrations/RPC da entrega original; registrar limitações dos shims. **Teste histórico:** relatório local, sem aplicação remota.
- [x] Integrar a fundação e correções na `main`; a antiga etapa de commit isolado está superada.
- [ ] Completar/demonstrar a matriz SQL originalmente prevista: anonymous, B/L sem importação/CE/recebível, consolidada parcialmente paga e obrigação de COD.
- [ ] Demonstrar concorrência de dois pedidos para o mesmo B/L e cancelamento de baixa durante envio/exportação; os testes existentes de reversão na confirmação e cancelamento no registro de envio não cobrem essas mesmas transições.
- [ ] Completar matriz VIP de ausência, vencimento, perda de VIP e documento de outro CNPJ; preservar bloqueio por pagamento e original.
- [ ] Demonstrar cancelamento de B/L, remoção/correção do CE e reconferência completa; teste de CE divergente na confirmação não encerra a matriz.

## Tarefa 3 — Documentos e análise interna auditável

**Arquivos:** nova migration de documentos/transições; criar
`supabase/functions/portal-ce-unlock-document/index.ts`,
`supabase/functions/ce-unlock-document-download/index.ts`,
`src/services/ceUnlockService.ts`, `src/services/portalCeUnlock.ts`,
`src/services/__tests__/ceUnlockService.test.ts`; atualizar `supabase/config.toml`.

**Interfaces:** upload multipart com `{documentType:'termo'|'procuracao', file}`
e contexto exclusivo `{requestId}` ou `{vipCoverageId}`
retorna `CeUnlockDocument`; download `{documentId}` retorna `{url, expiresIn:60}`.
`reviewCeUnlockDocument({requestId, blIds, documentId, decision:'approved'|'changes_requested', reason, expectedVersion, requestKey}) -> Promise<CeUnlockRequest>`;
`setCeUnlockBlDelivery({blId, delivered, reason, expectedVersion, requestKey}) -> Promise<CeUnlockItem>`;
`cancelCeUnlockRequest({requestId, reason, expectedVersion, requestKey}) -> Promise<CeUnlockRequest>`.
RPCs internas correspondentes `review_ce_unlock_document`,
`set_ce_unlock_bl_delivery`, `cancel_ce_unlock_request`; reenvio Portal usa
`portal_submit_ce_unlock_request` com versão atual.
Upload anual não exige pedido. Adicionar `setCeUnlockVip({customerId, enabled, reason, expectedVersion,
requestKey})`, `reviewCeUnlockVipDocument({documentId, decision, coverageYear, validFrom,
validUntil, reason, expectedVersion, requestKey})` e
`applyCeUnlockVipCoverage({requestId, blIds, expectedVersion, requestKey})`;
RPCs internas `set_ce_unlock_vip`, `review_ce_unlock_vip_document`,
`apply_ce_unlock_vip_coverage`. Portal cria rascunho documental anual via
`portal_create_ce_unlock_vip_coverage(p_request_key uuid)` e consulta
`portal_get_ce_unlock_vip_coverage()` com wrapper de inspeção.

- [x] Implementar bucket privado, upload autenticado, PDF até 10 MiB, assinatura, hash, caminho server-side, quotas/rate limit e ausência de upsert. **Código:** handler, helper de arquivo e RPCs documentais.
- [x] Implementar download com autorização atual e URL curta, leitura em inspeção e modelo versionado; análise/versionamento por B/L e análise anual por CNPJ.
- [x] Implementar entrega/reversão independente por B/L e cancelamento auditado que libera reserva, preservando histórico e separando ação externa.
- [x] Implementar expurgo server-only com reivindicação antes de remoção via Storage API e preservação de modelo/anuais vigentes; agendamento é etapa operacional separada.
- [x] Disponibilizar testes de PDF falso/vazio/tamanho/corpo, falha de upload, resposta de finalização perdida, versão antiga/substituída, reenvio, revogação e expurgo sob lock. **Teste:** suites CE, handler Deno e suíte SQL; execução histórica conforme relatório, sem afirmar falha inicial de todos os casos.
- [ ] Completar/demonstrar matriz de quota/rate limit, caminhos de outro CNPJ, sessão revogada e downloads/papéis no serviço gerenciado real.
- [ ] Completar matriz anual: termo vigente/procuração vencida, pedido atravessando vencimento e renovação aplicada a múltiplos itens sem alterar snapshots antigos. Limites 31/12–01/01 e ano inválido já têm teste unitário.
- [ ] Demonstrar retry sem eventos duplicados e preservação de documentos enviados/anuais no expurgo, incluindo anuais sem pedido e quotas VIP.
- [ ] Homologar retenção e configurar segredo/job de expurgo no ambiente autorizado; validar remoção física e retry no Storage real.

## Tarefa 4 — Portal: selecionar, solicitar e acompanhar

**Arquivos:** criar `src/pages/PortalDesbloqueioCe.tsx`,
`src/hooks/usePortalCeUnlock.ts`, componentes em `src/components/ce-unlock/`
para seleção, documentos e requisitos; modificar `src/AppPortal.tsx`,
`src/AppInterno.tsx` (rota aninhada de inspeção),
`src/components/layout/PortalLayout.tsx`, `src/lib/portalPageTitle.ts`,
`src/pages/PortalOperacao.tsx`, `src/services/portalRpcContracts.ts`,
`src/services/queryKeys.ts`, `src/services/cacheEffects.ts`.
Testes: `src/pages/__tests__/PortalDesbloqueioCe.test.tsx` e dispatcher existente.

**Interfaces:** `listPortalCeUnlockBls(scope, filters, page)`,
`listPortalCeUnlockRequests(scope, filters, page)`,
`getPortalCeUnlockRequest(scope, requestId)` nos serviços da tarefa 3;
`createPortalCeUnlockDraft(scope, {blIds, requestKey})` e
`submitPortalCeUnlockRequest(scope, {requestId, expectedVersion, requestKey})`.
`usePortalCeUnlock(scope)` usa esses contratos; famílias de query keys incluem
modo, cliente de inspeção, filtros, paginação e ID, sem compartilhar caches entre CNPJs.

- [x] Implementar seleção, rascunho, envio/correção/reenvio, requisitos, histórico e aba Documentos anuais VIP, com cobertura vigente dispensando reanexação. **Código:** página Portal, hook e painel VIP.
- [x] Integrar menu, rotas, preload, título, atalho e inspeção somente leitura; registrar RPCs e caches, incluindo refetch no foco e invalidação financeira.
- [x] Disponibilizar testes de seleção paga, cobertura VIP, inspeção sem seleção, anexos obrigatórios, reenvio parcial e remoção de seleção inelegível. **Teste:** `PortalDesbloqueioCe.test.tsx` e serviço; passaram nos checks focados desta sessão.
- [x] Registrar observação local de seleção/rascunho, envio bloqueado sem anexos e mobile a 390 px. **Runtime histórico:** relatório; login por CNPJ e gateway real não foram cobertos.
- [x] Integrar Portal na `main`; typecheck da entrega original registrado no relatório.
- [ ] Completar testes de modelo disponível, confirmação, correção completa e retry de rede preservando chave idempotente; demonstrar VIP expirado/pendente e renovação em análise na UI.
- [ ] Validar teclado, login real por CNPJ, upload/reenvio e perda de pagamento entre seleção e envio, com atualização visível e URLs de inspeção.

## Tarefa 5 — Vela: página de gestão por B/L

**Arquivos:** criar `src/pages/DesbloqueioCe.tsx`, `src/hooks/useCeUnlock.ts`,
`src/components/ce-unlock/CeUnlockRequestDetail.tsx`,
`src/pages/__tests__/DesbloqueioCe.test.tsx`; modificar `src/AppInterno.tsx`,
`src/components/layout/appLayoutNav.ts`, `src/hooks/useAuth.tsx`,
`src/services/cacheEffects.ts`, `src/pages/ClienteFicha.tsx`; criar
`src/components/ce-unlock/CeUnlockVipCoveragePanel.tsx` e testes; novas RPCs
de leitura interna em migration.

**Interfaces:** `listCeUnlockBls(filters, page) -> Promise<CeUnlockPage<CeUnlockItem>>`,
`getCeUnlockRequest(requestId) -> Promise<CeUnlockRequest>` em `ceUnlockService.ts`;
RPCs `list_ce_unlock_bls(p_filters jsonb, p_page integer)` e
`get_ce_unlock_request(p_request_id uuid)`; ações conforme tarefa 3.
Capacidades novas `ce_unlock_read`, `ce_unlock_manage`, `ce_unlock_documents`
aplicam matriz da spec tanto em UI quanto em servidor.

- [x] Implementar item Desbloqueio de CE em Importação, filtros, requisitos, protocolo/histórico, análise, entrega/reversão, cancelamento e confirmações. Pagamento somente leitura.
- [x] Implementar seção VIP na ficha do Cliente, documentos anuais, aprovação/vigência, renovação e aplicação aos itens pendentes, conforme permissões.
- [x] Integrar cache financeiro/carga, refetch no foco e limpeza do cache privado no logout do Portal. **Código/Teste:** efeitos de cache e teste de atualização financeira CE.
- [x] Disponibilizar testes de B/L sem pedido, dívida, ações restritas para Financeiro/Operações e remoção de seleção inelegível. **Teste:** página interna e componentes; passaram nos checks focados desta sessão.
- [x] Integrar gestão na `main`; execução local original de navegação/gates registrada no relatório.
- [ ] Completar matriz de filtros Sem solicitação, exclusão sem CE, paginação e pedidos mistos, incluindo projeção de anexos sensíveis por papel.
- [ ] Demonstrar aplicação anual e invalidação de ficha/fila/Portal entre CNPJs; validar atualização observável entre as duas SPAs, não apenas invalidação no mesmo cache.

## Tarefa 6 — Exportação ZPT e confirmação de desbloqueio

**Layout definido pelo usuário:** cinco colunas — BL, Termo, Procuração,
Entrega de BL, Pagamento das taxas. Adotar XLSX e Sim/Não como proposta técnica,
validando um exemplo antes do aceite. Não criar coluna CE/VIP nem exigir API ZPT.

**Arquivos:** nova migration para lotes/confirmar envio/confirmar desbloqueio;
criar `supabase/functions/ce-unlock-export/index.ts`,
`src/services/ceUnlockZptLayout.ts` (descrição tipada do layout homologado),
`src/services/__tests__/ceUnlockZptLayout.test.ts`; modificar página/hook internos.
Amostra fictícia em `test-fixtures/ce-unlock/`, ainda sem homologação externa.

**Interfaces:** `createCeUnlockExport({blIds, layoutVersion, requestKey}) -> Promise<CeUnlockExport>`;
`markCeUnlockExportSent({exportId, reference, requestKey}) -> Promise<CeUnlockExport>`;
`confirmCeUnlock({requestId, blId, ceMercante, externalReference, expectedVersion, requestKey}) -> Promise<CeUnlockItem>`.
RPCs `create_ce_unlock_export`, `mark_ce_unlock_export_sent`, `confirm_ce_unlock`.

- [x] Implementar layout em `ceUnlockRules.ts` e teste de cinco colunas, ordem, B/L textual e sanitização. **Teste:** `ceUnlockRules.test.ts`, aprovado nesta sessão; amostra gerada/reaberta no runtime local histórico, sem homologação externa.
- [x] Implementar lote/snapshot, geração server-side, download preservado, reexportação deliberada e registro explícito de envio.
- [x] Implementar confirmação individual por B/L/CE/referência externa, separada de aprovação/exportação. **Teste:** suíte SQL cobre exportação sem desbloqueio, confirmação individual, CE divergente, revogação e concorrência em confirmação/registro de envio; não reexecutada nesta revisão.
- [ ] Demonstrar bloqueio por cada requisito e baixa cancelada concorrente à criação da exportação, snapshot imutável e retry do mesmo lote.
- [ ] Completar teste de vencimento/revogação entre pedido e exportação e preservação de lote anterior; conferir a rastreabilidade de origem/versão/vigência no snapshot.
- [ ] Reconciliar o requisito inicial de estado explícito de falha recuperável: a geração pode ser repetida sobre o lote preservado, mas isso não comprova um estado persistido de falha do arquivo.
- [ ] Resolver/aceitar a limitação registrada de hash do lote sem preenchimento; diferenciar do hash de PDF já implementado.
- [ ] Homologar a amostra com responsável/ZPT no ambiente autorizado e registrar aceite externo. Código e amostra já estão integrados; não falta um commit separado de exportação.

## Tarefa 7 — Validação completa, documentação e entrega

**Arquivos:** atualizar `CONTEXT.md`, `docs/modules/portal-cliente.md`,
`docs/modules/manifesto-edi.md`, `docs/ARCHITECTURE.md`,
`docs/RASTREABILIDADE.md`, `docs/operations/seguranca.md`,
`docs/operations/servicos-externos.md`, `docs/CHANGELOG.md` e catálogo RPC aplicável.

- [x] Integrar documentação de rotas, autorização, retenção, bucket, funções, modelos e procedimento ZPT, distinguindo geração, envio e confirmação. Homologação externa não foi registrada como concluída.
- [x] Registrar gates da entrega local original: docs, tipos, lint, testes, build, migrations e RPC, com skips e limites do banco/shims no relatório. Não equivale à execução atual de todos os gates na árvore integrada.
- [x] Documentar ordem backend → funções → frontend e reversão preservando consulta/histórico. Preview e publicação são itens separados, ainda sem evidência nesta reconciliação.
- [ ] Conferir histórico remoto e publicar/validar migrations CE `139`–`149`, funções e frontends compatíveis no ambiente especificamente autorizado; não inferir deploy pela presença na `main`.
- [ ] Cadastrar PDF oficial, configurar segredo/agendamento e validar expurgo em Preview antes da ativação operacional.
- [ ] Executar fluxo completo com clientes A/B e papéis internos no ambiente controlado: modelo, anexos, envio, correção/reenvio, aprovação, entrega parcial, exportação e confirmação com evidência externa.
- [ ] Validar matriz integrada de pagamento parcial/consolidado, baixa cancelada, troca de Cliente, CE corrigido, múltiplas abas/retry, inspeção, downloads entre CNPJs e mobile/teclado.
- [ ] Validar fluxo VIP completo no ambiente controlado, incluindo dois pedidos sem reanexação, vencimento/renovação e preservação de histórico.
- [ ] Registrar gates da árvore integrada no fechamento técnico e validação de Preview/gateway/Storage; distinguir testes locais, skips e observação remota.
- [ ] Resolver/aceitar apresentação de versões documentais anteriores na UI interna (persistidas, mas a UI mostra as atuais) e avaliar teto O(n) da fila conforme volume; registrar decisão sem alegar refatoração necessária para o aceite.
- [ ] Concluir aceite operacional/ZPT; arquivar plano/spec e remover entradas dos índices na mesma mudança. Permanecem ativos enquanto faltarem aceites.

## Verificação da reconciliação

Reconciliação editorial em 2026-10-07, baseada em código/testes do checkout e
registros históricos, sem alteração de aplicação ou acesso ao ambiente remoto.
O plano continua ativo pelo aceite e pela evidência operacional pendentes.
As propostas originais de contratos acima não substituem o módulo vivo nem
exigem recriar arquivos/RPCs já atendidos pelos dispatchers existentes.
