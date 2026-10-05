# Desbloqueio de CE Mercante — plano de implementação

> **Para execução por agentes:** usar `superpowers:executing-plans` para executar as tarefas e seus checks. Etapas em checkbox registram avanço; este documento não autoriza publicação.

**Objetivo:** introduzir a solicitação no Portal e a página Importação → Desbloqueio de CE no Vela, com quatro requisitos por B/L e exportação assistida para ZPT.

**Arquitetura:** pedido com múltiplos B/Ls, documentos comuns por pedido ou cobertura anual VIP por CNPJ; pagamento derivado do ledger e entrega física por B/L. RPCs mantêm autorização e transições; exportação ZPT tem cinco colunas.

**Stack:** React 19, TypeScript, React Router 7, TanStack Query 5, Supabase Auth/PostgreSQL/Storage/Edge Functions, Vitest e Testing Library já existentes.

**Spec:** [desenho funcional](../spec/2026-10-04-desbloqueio-ce-mercante-design.md).

Estado: execução autorizada pelo usuário; implementação no checkout em validação
local. Publicação, PDF oficial e homologação externa ainda pendentes.

Contratos executados usam tipos snake_case, `ce_unlock_read` e dispatchers
`ce_unlock_command`/`portal_ce_unlock_command` com allowlists, em vez das funções
individuais propostas abaixo. Regras/layout estão em `ceUnlockRules.ts`.
Migrations `134`–`141` são novas; tipos gerados e migrations anteriores preservados.
As listas de testes abaixo são metas do plano: checkbox aberto não comprova
ausência de implementação; a evidência da execução está no módulo e no relatório.

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

## Evidência e mapa do código atual

Inspecionados `src/AppInterno.tsx`, `src/AppPortal.tsx`,
`src/components/layout/appLayoutNav.ts`, `src/components/layout/PortalLayout.tsx`,
`src/services/portalScope.ts`, `src/services/portalRpcContracts.ts`,
`src/services/billingLedger.ts`, `src/services/portalBilling.ts`,
`src/services/queryKeys.ts`, `src/services/cacheEffects.ts` e
`supabase/functions/portal-dispute-attachment/index.ts`.
Não há módulo de solicitação de desbloqueio nesses caminhos. O pagamento local
usa `bl_receivables`, liquidações e vínculos de invoice; não usar um booleano
do navegador ou status de invoice como fonte única.

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

- [ ] Confirmar entrega física, matriz de papéis, modelo oficial e assinatura/validade dos documentos, retenção, isenção e ajustes locais. Registrar cada decisão na spec.
- [ ] Esclarecer “CS”; se for entidade distinta, revisar spec/contratos antes das tarefas afetadas. Não inferir que significa CE.
- [x] Registrar o layout ZPT informado pelo usuário: BL e quatro colunas de requisitos, e a regra de documentos anuais VIP por CNPJ.
- [x] Registrar validade VIP confirmada pelo usuário: até 31/12 do ano correspondente, sem renovação automática em janeiro.
- [ ] Validar um exemplo das cinco colunas ZPT com status propostos Sim/Não e aprovação anual na spec.
- [x] Definir tipos acima e mensagens públicas de impedimento, com requisitos separados do andamento externo. Registrar `layoutVersion` e `modelVersion` obrigatórios nos respectivos contratos.
- [ ] Rever spec/plano com responsável operacional. A confirmação das hipóteses libera execução, não publicação.

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

- [ ] Escrever testes SQL reais: cliente A não acessa B; anonymous/cliente não invocam ação interna; BL sem CE/importação/autorização, sem recebível ou parcialmente pago não envia; consolidada paga liquida os BLs certos; baixa cancelada e obrigação de COD removem aptidão.
- [x] Rodar esses casos no Postgres local descartável conforme `WORKFLOW.md` §5/§11; verificar falha antes das funções novas. Nenhum teste contra produção.
- [x] Criar entidades propostas na spec, FKs, RLS/grants, eventos append-only, índices de filtros, limite de seleção e unicidade do pedido ativo. Reservar B/Ls em ordem estável sob lock; enviar é transação indivisível. Rascunho não congela elegibilidade financeira.
- [x] Criar condição/cobertura anual VIP por CNPJ e referências às versões documentais usadas por item. Guardas cliente/desk aplicam o mesmo escopo a documentos anuais; origem/validade não podem ser declaradas pelo navegador como prova de aprovação.
- [ ] Testar VIP com dois documentos vigentes enviando vários pedidos sem anexos; ausência, análise pendente, vencimento, revogação, perda de VIP ou documento de outro CNPJ bloqueiam envio sem anexos. VIP continua impedido por pagamento parcial e falta de original na exportação.
- [x] Implementar o helper pela última definição executável do ledger e ajustes locais homologados. Cobertura exige liquidação e saldo exigível zero; isenção segue a decisão explícita da tarefa 1. Não duplicar cálculo no frontend.
- [x] Implementar leituras e rascunho/envio; cliente derivado de sessão ativa, payload público por allowlist. Idempotência devolve o mesmo resultado para mesma chave/payload e recusa chave reutilizada com payload diferente.
- [ ] Testar dois pedidos concorrentes para o mesmo B/L e cancelamento de baixa concorrente ao envio. Coordenar locks com o dono financeiro existente, sem lock global; mudança financeira posterior deve aparecer nas leituras.
- [ ] Testar B/L cancelado e B/L com CE removido/corrigido: impedir envio/exportação, preservar pedido/histórico e exigir reconferência explícita do CE corrigido; bloquear nova confirmação usando o CE anterior.
- [x] Rodar `npm run migrations:check`, `npm run rpc:check`, testes focados e replay real do banco local; registrar separadamente limitações dos shims.
- [x] Commit da fundação com evidência local, sem aplicação remota.

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

- [ ] Criar testes para PDF falso, vazio/acima de 10 MiB, quota/rate limit, caminho de outro cliente, sessão revogada, download sem permissão e escrita por papel não autorizado. Falha de upload/registro não gera pedido enviado.
- [ ] Rodar testes focados, confirmando falhas iniciais. Usar padrão de teste existente da função de anexos; não criar framework.
- [ ] Implementar bucket privado e upload server-side autenticado com magic bytes, hash e caminhos gerados no servidor; sem upsert nem escrita direta do Portal. Rate limit atômico cobre tentativas. Limpeza via Storage API, nunca DELETE de `storage.objects`.
- [ ] Implementar download autenticado para cliente dono e desk autorizado; recusar Financeiro/Operações e acesso via IDs adulterados; incluir leitura autorizada em inspeção. Modelo oficial versionado tem download separado do anexo privado.
- [ ] Implementar análise por B/L/versionamento. Nova procuração invalida só aprovação de procuração; novo termo invalida só aprovação de termo. Rejeição pede justificativa pública; metadados internos não vazam.
- [ ] Implementar análise anual separada, com datas explícitas e aprovação/revogação por CNPJ, upload também pelo desk e histórico VIP. Documento novo pendente não substitui documento anual vigente; aplicação de renovação a pedidos pendentes exige ação auditada. Cobertura anual aprovada elimina reaprovação por pedido.
- [ ] Testar aprovação permitindo uso até 31/12 inclusive em America/Sao_Paulo, expiração em 01/01, fim diferente de 31/12 do ano declarado recusado, termo vigente/procuração vencida, revogação, pedido atravessando vencimento e renovação aplicada a múltiplos itens sem alterar snapshots antigos.
- [ ] Registrar entrega física por B/L independente do pedido e reversão com motivo. Cancelar mantém histórico, solta reserva ativa; B/L com exportação já enviada exige tratamento operacional e não promessa de desfazer ação externa.
- [ ] Testar aprovação com versão antiga, reenvio, pedido com dois B/Ls em estados diferentes e retry sem duplicação de eventos.
- [ ] Validar retenção homologada e expurgo de rascunhos após 7 dias em job server-only com teste de preservação de documentos de pedidos enviados; rodar testes e gates SQL, commit.
- [ ] Testar que expurgo de rascunhos não apaga documento anual por estar sem pedido; incluir documentos VIP nas quotas e retenção homologadas.

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

- [ ] Escrever testes de UI: um/múltiplos B/Ls pagos, BL com dívida visível/impedido, modelo disponível, dois anexos obrigatórios para cliente comum, confirmação antes do envio, correção/reenvio e falha de rede preservando chave idempotente.
- [ ] Implementar aba Documentos anuais para VIP: apresentar/corrigir PDFs sem selecionar B/L ou quitar taxas, consultar vigência/status e origem anual nos pedidos. Cliente com cobertura vigente solicita sem campos de upload obrigatório; cobertura irregular orienta regularização. Registrar os contratos de leitura/inspeção e escrita no dispatcher.
- [ ] Testar VIP válido sem anexos, expirado/pendente com orientação clara, cliente comum com anexos obrigatórios e inspeção VIP somente leitura. Renovação em análise mantém cobertura anterior ainda vigente.
- [ ] Rodar testes para verificar falha inicial; implementar página e componentes com estados loading/erro/vazio, desktop/mobile e navegação por teclado.
- [x] Integrar menu/rotas/preload/título, atalho na operação e inspeção. Dispatcher recusa escrita em inspeção; não depender só de botão oculto.
- [x] Registrar contratos novos no mapa Portal/inspeção e catálogo RPC; invalidar pedido/listas após mutação. Recarregar requisito financeiro no foco da janela e após sucesso financeiro na mesma sessão.
- [ ] Testar BL que perde pagamento entre seleção e envio: pedido não enviado e motivo por B/L. Testar inspeção sem ações e URLs construídas por `portalPath`.
- [ ] Rodar testes focados e `npm run typecheck`; commit do Portal.

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

- [ ] Escrever testes de filtro Sem solicitação, exclusão de B/L sem CE, paginação, pedido misto e matriz de ações/documentos. Operações/Financeiro não recebem anexo sensível nem na resposta de detalhes.
- [ ] Rodar testes e implementar item **Desbloqueio de CE** em Importação, filtros, quatro colunas de requisitos e detalhe do protocolo com histórico.
- [x] Integrar análise, entrega/reversão e cancelamento com confirmação; lote mostra B/Ls afetados, bloqueados e consequência. Pagamento sempre somente leitura.
- [x] Implementar seção VIP/documentos anuais na ficha do cliente: habilitar/revogar VIP, registrar documentos, revisar vigência, aprovar/solicitar correção, renovar e aplicar cobertura a itens pendentes, conforme permissões da tarefa 3. Mostrar selo/origem/validade na fila e link à ficha.
- [ ] Testar que aprovar cobertura anual atende termo/procuração nos pedidos do CNPJ sem cliques por pedido, que VIP não permite marcar pagamento, e que mudança de cobertura invalida caches da ficha, fila e Portal sem afetar outro CNPJ.
- [x] Adicionar família CE às invalidações financeiras e de carga, com testes para baixa cancelada e CE corrigido. Refetch ao focar/reabrir tela cobre mudanças vindas da outra SPA; backend continua autoritativo.
- [ ] Rodar testes focados de página, navegação, permissões e cache; commit da gestão.

## Tarefa 6 — Exportação ZPT e confirmação de desbloqueio

**Layout definido pelo usuário:** cinco colunas — BL, Termo, Procuração,
Entrega de BL, Pagamento das taxas. Adotar XLSX e Sim/Não como proposta técnica,
validando um exemplo antes do aceite. Não criar coluna CE/VIP nem exigir API ZPT.

**Arquivos:** nova migration para lotes/confirmar envio/confirmar desbloqueio;
criar `supabase/functions/ce-unlock-export/index.ts`,
`src/services/ceUnlockZptLayout.ts` (descrição tipada do layout homologado),
`src/services/__tests__/ceUnlockZptLayout.test.ts`; modificar página/hook internos.
Fixture anonimizada homologada em `test-fixtures/ce-unlock/`.

**Interfaces:** `createCeUnlockExport({blIds, layoutVersion, requestKey}) -> Promise<CeUnlockExport>`;
`markCeUnlockExportSent({exportId, reference, requestKey}) -> Promise<CeUnlockExport>`;
`confirmCeUnlock({requestId, blId, ceMercante, externalReference, expectedVersion, requestKey}) -> Promise<CeUnlockItem>`.
RPCs `create_ce_unlock_export`, `mark_ce_unlock_export_sent`, `confirm_ce_unlock`.

- [ ] Escrever teste da planilha com exatamente as cinco colunas e ordem definidas, B/L como texto preservando zeros, estados Sim/Não e sanitização canônica. VIP com cobertura vigente gera Sim para termo/procuração, e VIP sem cobertura não é exportado como apto. CE e VIP ficam fora do arquivo.
- [ ] Escrever teste SQL real de bloqueio por cada requisito, cancelamento de baixa concorrente à exportação, CE alterado, snapshot imutável e retry do mesmo lote. Recusar o lote selecionado se ficar inelegível; UI permite revisar seleção e reenviar.
- [ ] Testar documento anual que vence ou é revogado entre envio do pedido e exportação; bloquear item ainda não desbloqueado, preservar lote anterior e exigir cobertura atual. Lote registra internamente origem/versão/vigência documental.
- [x] Implementar lote transacional/snapshot e geração server-side. Falha ao gerar arquivo deixa lote em falha recuperável e nunca como enviado; retry usa snapshot e mesmo lote. Download regenerado não representa nova exportação.
- [x] Implementar reexportação deliberada com chave nova e referência ao lote anterior, revalidando dados atuais. Mostrar data/versão e aviso para arquivo antigo; marcar envio externo somente por ação explícita.
- [x] Implementar confirmação por B/L/CE com evidência e histórico. Testar que exportar/aprovar não confirma, confirmar um B/L não conclui os outros, CE divergente recusa e reversão financeira posterior gera revisão operacional sem apagar confirmação.
- [ ] Rodar testes e validar arquivo com responsável/ZPT no ambiente de homologação; registrar aceite externo, commit.

## Tarefa 7 — Validação completa, documentação e entrega

**Arquivos:** atualizar `CONTEXT.md`, `docs/modules/portal-cliente.md`,
`docs/modules/manifesto-edi.md`, `docs/ARCHITECTURE.md`,
`docs/RASTREABILIDADE.md`, `docs/operations/seguranca.md`,
`docs/operations/servicos-externos.md`, `docs/CHANGELOG.md` e catálogo RPC aplicável.

- [ ] Validar no ambiente controlado com clientes A/B e papéis internos: selecionar dois B/Ls pagos, baixar modelo, anexar, enviar, solicitar correção, reenviar, aprovar, entregar só um B/L, exportar apenas aptos e confirmar por evidência externa.
- [ ] Repetir com pagamento parcial/consolidado, cancelamento de baixa, CE corrigido, múltiplas abas/retry, inspeção, tentativa de download entre CNPJs e experiência mobile/teclado. Verificar atualização visível nas duas SPAs.
- [ ] Executar `npm run docs:check`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run migrations:check`, `npm run rpc:check` e `git diff --check`. Testes de banco em ambiente isolado conforme `WORKFLOW.md`; marcar skips explicitamente.
- [x] Documentar rotas, autorização, retenção, bucket, funções, modelos e procedimento ZPT, separando geração, envio e confirmação. Registrar aprovação documental/financeira e evidência de homologação externa.
- [x] Preparar rollout backend → funções → frontend, validar Preview e definir reversão por desabilitar novas solicitações/exportação mantendo consulta/histórico. Publicação exige autorização específica do ambiente.
- [ ] Validar fluxo VIP completo: apresentar documentos uma vez, aprovar vigência no Vela, solicitar dois pedidos sem reanexação, pagar/entregar cada B/L, exportar cinco colunas e tratar vencimento/renovação sem perder histórico.
- [ ] Quando implementação e aceite terminarem, arquivar plano/spec e remover entradas dos índices na mesma mudança; preservar como ativo se faltar aceite de qualquer requisito.

## Verificação deste planejamento

O planejamento original validou documentação/índices. A execução posterior
implementou o fluxo e registrou evidência local em
[relatório de entrega](../archive/reports/2026-10-04-desbloqueio-ce-implementacao.md).
Checks de cenários ainda abertos acima incluem validações mais amplas do plano;
não foram convertidos em evidência por inferência. Publicação, PDF oficial e
homologação real do arquivo permanecem pendentes, por isso plano/spec continuam
ativos. Contratos específicos executados constam no módulo vivo.
