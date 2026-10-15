# Desbloqueio de CE Mercante — plano de implementação

> **Para execução por agentes:** usar a skill `executing-plans` do repositório para executar as tarefas e seus checks. Etapas em checkbox registram avanço; este documento não autoriza publicação.

**Objetivo:** introduzir a solicitação no Portal e a página Importação → Desbloqueio de CE no Vela, com quatro requisitos por B/L e exportação assistida para ZPT.

**Arquitetura:** pedido com múltiplos B/Ls, documentos comuns por pedido ou cobertura anual VIP por CNPJ; pagamento derivado do ledger e entrega física por B/L. RPCs mantêm autorização e transições; exportação ZPT tem cinco colunas.

**Stack:** React 19, TypeScript, React Router 7, TanStack Query 5, Supabase Auth/PostgreSQL/Storage/Edge Functions, Vitest e Testing Library já existentes.

**Spec:** [desenho funcional](../spec/2026-10-04-desbloqueio-ce-mercante-design.md).

**Revisão aprovada em 2026-10-07:** [spec](../archive/specs/2026-10-07-desbloqueio-ce-revisao-fluxo-design.md)
e [plano](../archive/plans/2026-10-07-desbloqueio-ce-revisao-fluxo.md), já executados, alteraram validação, envio à ZPT e
confirmação; itens deste plano que conflitem com ela (confirmação por B/L, registro de envio) estão superados.

**Estado reconciliado em 2026-10-07:** implementação integrada no código da
`main`; publicação e operação remotas não conferidas nesta reconciliação.
Modelo oficial e homologação externa seguem sem evidência de conclusão.

**Estado conferido em 2026-10-10:** backend publicado em produção (migrations,
Edge Functions, bucket e agendamentos; ver "Fontes"). O modelo oficial passou a ser DOCX
(código da PR 927; migration `173` e funções de documento conferidas ativas em
produção, ver "Fontes") e foi cadastrado pelo responsável no mesmo dia. O [plano de correção das importações e do CE Mercante](../archive/plans/2026-10-09-correcao-importacoes-ce-mercante.md)
não fecha itens deste plano, mas suas Etapas 6 e 8.7 corrigem defeitos que
afetam o Desbloqueio e passam a bloquear a ativação; ver "Caminho crítico para
ativação".

**Estado conferido em 2026-10-12, após o merge da PR 929:** as Etapas 6 e 8.7 do
plano de 2026-10-09 estão concluídas e publicadas em produção (ver "Fontes");
deixaram de bloquear a ativação. Este plano continua vivo: restam os aceites
(operacional/jurídico e ZPT), as provas que protegem dinheiro e dados, a
compatibilidade dos frontends com o backend atual, o resultado do expurgo e o
fluxo completo com clientes A/B. As demais pendências `[ ]` sem
**[bloqueia ativação]** podem ser aceitas como dívida registrada no aceite.

**Estado conferido em 2026-10-13:** demonstradas no Postgres local as matrizes
de fatura consolidada parcialmente paga e de cancelamento de baixa concorrente ao
envio (Tarefa 2), ambas pelos comandos reais do financeiro. O segundo teste
achou deadlock entre cancelamento de baixa e envio, corrigido pela migration `220` (trava do
Cliente em `FOR NO KEY UPDATE`); a `220` foi aplicada em produção no mesmo dia, após o merge da PR 936. Na leitura de produção do mesmo dia, os sites publicados e o backend
correspondem ao commit `c4a984f` da `main` (compatibilidade conferida no
código). O expurgo roda todo dia sem erro, mas nunca teve documento elegível:
a remoção física continua sem prova; um documento de teste elegível foi criado
em produção para a rodada de 14/10. No mesmo dia, o fluxo A/B foi executado em
produção com os Clientes 1 (A) e 2 (B), operado pelo responsável e conferido no
banco, até a exportação; B não leu, alterou nem baixou nada de A pelo serviço
real. Falta a conciliação com um "Exportar Tela" real da ZPT (Tarefa 6).
A revisão geral da documentação do mesmo dia reabriu o alerta de troca de CE
com Desbloqueio conferido, que o código não abria (B1 do
[plano de correções](../archive/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md); item 8 do caminho crítico). A
correção é a migration `230`, completada pela `277` (a confirmação manual legada vale só
para o CE confirmado), provadas no Postgres local e aplicadas em produção em
2026-10-15 (merge da PR 954).

**Estado conferido em 2026-10-14:** a rodada do expurgo das 06:00 UTC executou o
ciclo completo sobre o documento de teste: rascunho cancelado, documento
revogado com `purged_at` e objeto removido pela Storage API (ver "Fontes"). O
objeto de teste não tinha bytes, então a remoção física de um PDF real segue
sem prova e o item do expurgo continua **[bloqueia ativação]**. Os outros
itens bloqueantes que restam são a conciliação com um "Exportar Tela" real da
ZPT (Tarefa 6) e as mudanças do aceite operacional/jurídico, obtido no mesmo dia
([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md)): B/L isento sem
requisito de pagamento e avulsas no requisito (Tarefa 2) e retenção de 30 dias
(Tarefa 3). No mesmo dia o
responsável informou que combinou com a ZPT e que o modelo atual de exportação
(`zpt-5-v2`) está homologado (declaração do responsável, sem documento anexado).

**Estado conferido em 2026-10-15:** a rodada do expurgo das 06:00 UTC removeu um
PDF real de 145.648 bytes, enviado pelo Portal num rascunho de teste tornado
elegível: rascunho cancelado e B/L liberado, documento com `purged_at`, objeto
fora do bucket e registrado como removido no log do Storage (ver "Fontes"). O
item do expurgo deixa de bloquear a ativação. Continuam bloqueantes a
conciliação com um "Exportar Tela" real da ZPT (item 4 do caminho crítico), as
mudanças da ADR 0087 (item 9) e a correção do alerta de troca de CE com
Desbloqueio conferido (item 8).

**Estado em 2026-10-15, PR 956:** o responsável dispensou a conciliação com um
"Exportar Tela" real (o modelo da ZPT basta). As mudanças da ADR 0087
(migrations `279` e `280`), o lote com hash imutável
(`281`), o documento expurgado na projeção (`282`), a mensagem de recusa do PDF e as matrizes de teste (`ceUnlockMatriz`,
`ceUnlockVip`, Deno do expurgo e telas) estão na PR 956, comprovadas no Postgres
local e em jsdom. Ficam abertos só os itens que se observam no serviço real em
produção depois do merge (caminho crítico, item 10).

**Como ler o checklist:** `[x]` registra o resultado específico comprovado pela
fonte indicada; `[ ]` registra trabalho ou evidência ainda necessários. Um teste
existente não equivale a execução recente, e código integrado não comprova deploy.
Itens que misturavam implementação e aceite foram separados.

Contratos executados usam tipos snake_case, `ce_unlock_read` e dispatchers
`ce_unlock_command`/`portal_ce_unlock_command` com allowlists. Os serviços do
Portal estão em `ceUnlockService.ts`; regras/layout e seus testes estão em
`ceUnlockRules.ts` e `ceUnlockRules.test.ts`. Os nomes de interfaces/arquivos
propostos nas tarefas abaixo são referência do desenho inicial, não arquivos
faltantes quando substituídos por esses donos. O bloco CE atual é `139`–`149`,
mais `160`–`161` do fluxo revisado de 2026-10-07; `137`–`138` pertencem à
Central de Informações. Tipos gerados preservados. A `173` (modelo DOCX) e, da
PR 929, a `177` (unicidade do CE e conciliação ZPT pela chave do CE) e as `181`
e `195` (alerta de troca de CE com Desbloqueio conferido) também afetam o
Desbloqueio, assim como a `220` (trava do Cliente sem deadlock com o cancelamento de baixa).

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
- **Remoto (2026-10-10, leitura no projeto Supabase de produção):**
  `schema_migrations` contém `139`–`149`, `160` e `161`; as funções
  `ce-unlock-export`, `ce-unlock-cleanup`, `portal-ce-unlock-document`,
  `ce-unlock-document-download` e `ce-unlock-notify-email` estão ativas; bucket
  privado existe; jobs `ce-unlock-cleanup` (diário, 06:00 UTC) e
  `ce-unlock-notify-email` (5 min) ativos, com última rodada `succeeded` — isso
  prova só o disparo HTTP do pg_cron, não o resultado da função. Nessa leitura,
  nenhum documento `type='model'` estava cadastrado. Dados: 1 pedido e 1 exportação de teste;
  uma procuração de teste aprovada era um PDF sem relação com o assunto, o que
  confirma que a análise humana é a única conferência de conteúdo. Publicação
  dos frontends (Cloudflare Pages) não conferida nessa leitura.
- **Remoto (2026-10-10, leitura posterior, após o merge da PR 927):**
  `schema_migrations` contém `173`; `ce_unlock_prepare_upload` e
  `ce_unlock_finish_upload` aceitam o modelo DOCX; `portal-ce-unlock-document` (v13) e
  `ce-unlock-document-download` (v12) ativas com o código da `main`. Documento
  `type='model'` `termo-devolucao-container-modelo-2026.docx` com status `approved`,
  objeto `.docx` no Storage com tipo DOCX e tamanho conferido (13.508 bytes).
  Workflow *Cloudflare Pages Production* run 176 (commit `eb0eadb`) com sucesso: prova
  a publicação dos dois sites, não a compatibilidade frontend/backend.
- **Remoto (2026-10-12, leitura no projeto Supabase de produção, após o merge da
  PR 929):** `schema_migrations` contém `174`–`217`; índice único
  `bls_ce_mercante_active_key`; gatilho `guard_ce_mercante_unique` em `bls` e
  `granite_bls` e `guard_bl_ce_mercante_port` em `bls`; `_set_bl_ce_mercante`
  abre o alerta `ce_trocado_com_desbloqueio`; `preview_ce_mercante_rows` existe;
  `ce_unlock_reconcile` casa por `ce_mercante_key`. Dados: 1 pedido e 1
  exportação de teste. Testes não reexecutados; resultado do CI do merge e
  publicação dos frontends depois dele não conferidos.
- **Teste (conferência estática em 2026-10-12):** `ceUnlock.local-pg.test.ts`,
  que roda no CI, tem desde 2026-10-07 os cenários "exportação aguarda reversão
  financeira concorrente e recusa requisito perdido" e "exportação aguarda
  cancelamento concorrente e recusa lote". A reversão é simulada por alteração
  direta do recebível sob transação concorrente, não pelo comando de cancelar
  a baixa.
- **Teste (2026-10-13, Postgres 16 local com replay das 218 migrations, shims
  do `setup-local-pg.sh`):** `ceUnlock.local-pg.test.ts` ganhou "fatura
  consolidada parcialmente paga libera só o B/L efetivamente liquidado"
  (`create_local_consolidated_invoice` + `register_ledger_invoice_payment`
  parcial e depois integral) e "envio do pedido aguarda cancelamento concorrente
  da baixa e recusa o B/L que perdeu a liquidação" (`reverse_invoice_payment` em
  transação aberta enquanto o cliente envia). Sem a `220`, o segundo falhou em
  três de três rodadas com `deadlock detected`; com ela, a suíte passou (33
  testes, duas rodadas) e as 80 suítes `local-pg` do CI passaram (655 testes).
  Não comprova o ambiente remoto.
- **Remoto (2026-10-13, leitura somente SELECT no projeto Supabase de produção,
  logs e GitHub Actions):** *Cloudflare Pages Production* run 184 publicou o
  commit `c4a984f` (HEAD da `main`, CI run 2035 verde). `schema_migrations` vai
  até `219`, como a `main`. As 1.042 funções de `public` e `ce_unlock_private`
  têm o mesmo texto do replay local da `main` (12 funções antigas diferem só por
  fim de linha CRLF); `ce_unlock_private.command` e `ce_unlock_prepare_upload`
  ainda estão na versão anterior à `220`. O deploy das Edge Functions de
  2026-10-13 11:46 UTC conferiu `portal-ce-unlock-document`,
  `ce-unlock-document-download`, `ce-unlock-cleanup` e `ce-unlock-notify-email`
  sem mudança e republicou `ce-unlock-export` a partir da `main`. Expurgo: job
  `ce-unlock-cleanup` com rodadas diárias `succeeded` de 08/10 a 13/10 e a
  função respondendo HTTP 200 às 06:00 UTC de 13/10; `ce_unlock_cleanup_candidates()`
  vazio, nenhum documento com `purged_at`, nenhum rascunho, 4 documentos com
  objeto presente no bucket e nenhum objeto órfão. A remoção física nunca foi
  exercitada em produção. Nenhum dado remoto foi alterado.
- **Remoto (2026-10-13, após o merge da PR 936):** o log da integração do
  Supabase registra "Applying migration… 220_ce_unlock_trava_cliente_sem_deadlock.sql"
  às 14:27:31 UTC; `schema_migrations` contém `220`, e
  `ce_unlock_private.command` e `ce_unlock_prepare_upload` travam o Cliente com
  `FOR NO KEY UPDATE`, mantendo `SECURITY DEFINER` e os mesmos grants.
- **Remoto (2026-10-13, escrita autorizada pelo responsável):** documento de
  teste do expurgo em produção: rascunho `7e57e7e5-0000-4c13-a000-202610130001`
  (Cliente 1, criado com data de 8 dias antes, sem B/L) e termo
  `7e57e7e5-0000-4c13-a000-202610130002` com registro
  `1/teste-expurgo-2026-10-13.pdf` no bucket, inserido por SQL e sem conteúdo
  (sem chave de serviço não há upload real). `ce_unlock_cleanup_candidates()`
  passou a devolvê-lo. A rodada das 06:00 UTC de 14/10 deve cancelar o
  rascunho, revogar o documento, remover o objeto e gravar `purged_at`; prova o
  ciclo do expurgo, não a remoção de bytes de um PDF real.
- **Remoto (2026-10-14, leitura somente SELECT, logs e cron de produção):** job
  `ce-unlock-cleanup` disparou às 06:00:00 UTC (`succeeded`) e a função
  respondeu HTTP 200 às 06:00:08. O rascunho de teste ficou `cancelled` com
  evento `expire_draft` ("Rascunho abandonado há mais de sete dias"); o termo
  de teste ficou `revoked`, com `cleanup_claimed_at` 06:00:07 e `purged_at`
  06:00:08; o objeto `1/teste-expurgo-2026-10-13.pdf` saiu de
  `storage.objects`, e o log do Storage registra
  `ObjectRemoved:Delete` às 06:00:08. Os 9 objetos dos documentos ativos
  (modelo, pedidos de 07/10 e o fluxo A/B) permaneceram;
  `ce_unlock_cleanup_candidates()` voltou vazio. Limite: o objeto de teste não
  tinha bytes, então a exclusão no armazenamento físico de um PDF real segue sem
  observação direta.
- **Remoto (2026-10-14 e 2026-10-15, PDF real):** o responsável criou pelo
  Portal o rascunho CE-E3CADF0B0202 (Cliente 1, B/L `TEST-ITAU-IND-20261007`) e
  enviou um termo em PDF real: documento `de088338-ad78-4cf4-aced-0ca16303acc3`,
  objeto `1/2b698658-dfc2-4e24-9399-070a89f6a2c7.pdf` com 145.648 bytes e eTag
  no Storage. Com autorização do responsável, o `created_at` desse rascunho foi
  recuado 8 dias por SQL em 2026-10-14, e ele passou a ser candidato. Na rodada
  de 2026-10-15 (leitura somente SELECT, logs e `net._http_response`): job
  `succeeded` às 06:00:00 UTC; a função respondeu HTTP 200 com
  `{"removed":1,"expired_drafts":0}`; rascunho `cancelled` com `expire_draft` e
  B/L liberado (`active=false`, B/L de novo apto a pedido); documento `revoked`
  com `cleanup_claimed_at` 06:00:06 e `purged_at` 06:00:08; o objeto saiu de
  `storage.objects`, e o log do Storage registra `ObjectRemoved:Delete` às
  06:00:10. Os 9 objetos dos documentos ativos permaneceram, nenhum documento
  ativo ficou sem objeto, e `ce_unlock_cleanup_candidates()` voltou vazio.
- **Runtime (2026-10-13, produção, operação do responsável no Chrome e
  conferência SQL a cada etapa):** Cliente 2 (B) teve a conta do Portal ativada
  e a fatura INV-2026-0014 emitida automaticamente; antes da baixa, o B/L
  `CSC45160N05G00` ficou recusado por taxas sem liquidação, e depois da baixa,
  apto. Upload de `.docx` renomeado para `.pdf` recusado (HTTP 422). Pedido B
  CE-CFB4766089BF e pedido A CE-766697E301DE (`TEST-ITAU-CONS1/CONS2-20261008`)
  enviados com PDFs gravados no prefixo do próprio Cliente e eventos
  `draft`/`upload_*`/`submit`; B/L não pago de A (`CSC45370901400`) não entrou
  em pedido. Recusa do termo de A com motivo: versão recusada preservada, aviso
  no sino com o motivo, e-mail `skipped` (comunicados desligados); reenvio só
  do termo, procuração aprovada mantida. Entrega parcial: CONS1 apto, CONS2
  aguardando original, pedido sem conclusão; com as entregas, os dois pedidos
  `completed` e aviso de documentação validada com prazo. Exportação `zpt-5-v2`
  com os 3 B/Ls (quatro requisitos = sim) e `exported_at` por B/L. Acesso
  cruzado, sessão do B contra o A: leitura do pedido, cancelamento, rascunho com
  B/L de A, download e upload no pedido de A recusados com 403 (`42501`);
  objeto de A no Storage com 400 "Object not found"; controle (B lendo o próprio
  pedido) com 200; nenhum dado de A alterado. Conciliação ZPT não executada.

## Restrições globais

- Todos os B/Ls de importação com CE aparecem na página interna, mesmo sem pedido.
- Pagamento confirmado obrigatório no envio; quatro requisitos obrigatórios para aptidão.
- Sem comprovação de desbloqueio por aprovação documental ou exportação.
- Um cliente por pedido, até 100 B/Ls, um pedido ativo por B/L.
- PDFs até 10 MiB por documento; 20 uploads/24h e 100 MiB ativos por cliente.
- Documentos comuns compartilhados dentro do pedido; documentos anuais VIP entre pedidos do mesmo CNPJ, somente aprovados/vigentes. Alterações versionadas.
- VIP não dispensa pagamento nem entrega física, e selo VIP sem cobertura não dispensa anexos/documentação.
- Documentos VIP válidos até 31/12 do ano correspondente, inclusive, em America/Sao_Paulo; sem renovação automática em janeiro.
- Planilha ZPT: somente BL, Termo, Procuração, Entrega de BL, Pagamento das taxas; VIP usa os mesmos quatro indicadores. **Superado** pela revisão de 2026-10-07: o layout vigente é `zpt-5-v2`, com os cabeçalhos do "Exportar Tela" da ZPT, descrito no [módulo](../modules/desbloqueio-ce.md#envio-e-conciliação-com-a-zpt), dono da regra.
- Preservar sessões interna/Portal, inspeção somente leitura e autorização no banco.
- Migrations novas seguem `WORKFLOW.md` §5; escolher o próximo NNN na execução.
- Não editar migrations existentes nem `src/types/database.ts` sem autorização explícita exigida pelo guard; usar tipos de domínio próprios para os contratos novos.
- Não instalar bibliotecas, aplicar migrations ou publicar funções durante este planejamento.

## Caminho crítico para ativação

Itens marcados **[bloqueia ativação]** abaixo precisam estar resolvidos antes de
abrir o Desbloqueio a clientes reais; os demais `[ ]` podem ser aceitos como
dívida registrada no aceite, sem impedir a operação. Ordem proposta:

1. ~~Publicar a migration `173` e as funções de documento; cadastrar o DOCX oficial (Tarefa 1).~~ Feito em 2026-10-10.
2. ~~Etapa 6 do plano de 2026-10-09 (unicidade do CE): o mesmo CE podia ser
   aceito em dois B/Ls e a conciliação ZPT pelo número desbloquearia os dois
   (cenário 12 da [revisão de 2026-10-09](../archive/audits/2026-10-09-revisao-importacoes-ce-mercante.md)).~~
   Feito: PR 929, em produção em 2026-10-12 (ver "Fontes").
3. ~~Etapa 8.7 do mesmo plano: troca de CE pela planilha sem prévia reabria o
   Desbloqueio em silêncio (cenários 11 e 13).~~ Feito: PR 929, em produção em
   2026-10-12 (ver "Fontes").
4. ~~Homologar com o responsável/ZPT a planilha exportada (`zpt-5-v2`) e conciliar um "Exportar Tela" real.~~
   Planilha homologada em 2026-10-14 por declaração do responsável; conciliação por
   arquivo real dispensada pelo responsável em 2026-10-15. Aceite operacional em
   2026-10-14 ([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md)).
5. ~~Demonstrar as matrizes que protegem dinheiro e dados: fatura consolidada
   parcialmente paga (Tarefa 2), baixa cancelada concorrente ao envio
   (Tarefa 2) e acesso a IDs/caminhos/downloads de outro CNPJ no serviço real
   (Tarefa 3).~~ Feito em 2026-10-13 (ver "Fontes"), com a `220` em produção.
6. ~~Conferir a compatibilidade dos frontends publicados com o backend atual e
   executar o fluxo completo com clientes A/B no ambiente autorizado
   (Tarefa 7).~~ Feito em 2026-10-13 até a exportação (ver "Fontes"); a
   conciliação com evidência externa fica no item 4.
7. ~~Validar o resultado do expurgo no Storage real (Tarefa 7).~~ Feito em
   2026-10-15 com um PDF real enviado pelo Portal (ver "Fontes").
8. ~~Corrigir o alerta de troca de CE com Desbloqueio conferido (B1).~~ Feito nas
   migrations `230` e `277` (PR 954), aplicadas em produção em 2026-10-15.
9. ~~Implementar as mudanças da ADR 0087.~~ Feito nas migrations `279` e `280`
   (PR 956), com testes no Postgres local.
10. Depois do merge da PR 956: conferir em produção as migrations `279`–`282`,
    republicar a Edge Function `portal-ce-unlock-document` (mensagem do PDF) e
    fazer a observação no serviço real que resta na Tarefa 7.

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
- [x] Obter/reconciliar aceite operacional de entrega, assinatura/validade, retenção, isenção e ajustes locais na spec, incluindo que a análise humana é a única conferência do conteúdo dos PDFs. Em 2026-10-10 o responsável forneceu o termo (`.doc`, modelo COSCO Specialized Carriers) e decidiu que o modelo baixado seja `.docx`, com anexo do cliente só em PDF; o cadastro do modelo passou a aceitar só DOCX (migration `173`), e o modelo foi cadastrado no mesmo dia (ver "Fontes"); o aceite foi obtido em 2026-10-14 ([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md)): entrega independente da solicitação, B/L isento sem requisito de pagamento, avulsas no requisito (sem Demurrage), assinatura e validade por conferência humana e retenção de 30 dias; as mudanças de código estão nas Tarefas 2 e 3. A matriz de papéis saiu deste aceite: foi decidida em 2026-10-14 ([ADR 0085](../adr/0085-modelo-de-permissoes-por-perfil.md), item D11) — leitura para todos, inclusive Equipamentos, e gestão do Administrativo e da Documentação —, e a correção para Equipamentos é o item P12 do [plano de correções](../archive/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md).
- A homologação da amostra XLSX e dos indicadores Sim/Não com responsável/ZPT é registrada na Tarefa 6 (concluída em 2026-10-14).

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
- [x] Demonstrar fatura consolidada parcialmente paga: só o B/L cujo recebível foi liquidado fica pago; o status da fatura não conta. **Teste:** `ceUnlock.local-pg.test.ts` (2026-10-13, ver "Fontes").
- [x] Completar a matriz SQL originalmente prevista: anonymous, B/L sem importação/CE/recebível e obrigação de COD. **Teste:** `ceUnlockMatriz.local-pg.test.ts` (anônimo recusado em toda RPC pública `ce_unlock*` e no schema privado; B/L sem CE não selecionável; sem recebível e não isento não pago; COD pendente a cobrar bloqueia), Postgres local em 2026-10-15.
- [x] Demonstrar reversão financeira concorrente à exportação: a exportação espera a transação e recusa o requisito perdido. **Teste:** `ceUnlock.local-pg.test.ts` (2026-10-07, no CI), com a reversão simulada no recebível (ver "Fontes").
- [x] Demonstrar cancelamento de baixa concorrente ao envio do pedido, pelo comando real `reverse_invoice_payment`. **Teste/Código:** `ceUnlock.local-pg.test.ts` e migration `220`, que corrigiu o deadlock achado pelo teste (2026-10-13, ver "Fontes"). A `220` está em produção desde 2026-10-13 (ver "Fontes").
- [x] Demonstrar concorrência de dois pedidos para o mesmo B/L e o cancelamento de baixa concorrente à exportação pelo comando real. **Teste:** `ceUnlockMatriz.local-pg.test.ts` (rascunhos concorrentes deixam uma reserva; envios concorrentes, um recusado por versão; `reverse_invoice_payment` em transação aberta faz a exportação esperar e recusar).
- [x] Completar matriz VIP de ausência, vencimento, perda de VIP e documento de outro CNPJ; preservar bloqueio por pagamento e original. **Teste:** `ceUnlockVip.local-pg.test.ts`.
- [x] Demonstrar cancelamento de B/L, remoção/correção do CE e reconferência completa. **Teste:** `ceUnlockMatriz.local-pg.test.ts` (cancelamento e remoção bloqueiam a exportação; correção dá "CE alterado: reconferência necessária", `reconfirm_ce` volta termo e procuração para análise e, reaprovado, o B/L sai de novo com o CE novo).

- [x] B/L com Taxas Locais isentas fica apto sem requisito de pagamento (termo, procuração e entrega), e o requisito passa a incluir as faturas avulsas do B/L, sem Demurrage ([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md), itens 2 e 3). **Código:** migration `279` (`ce_unlock_private.item`; motivo "Fatura avulsa do B/L em aberto"; `paid` alimenta Portal e planilha). **Teste:** `ceUnlock.local-pg.test.ts` (isento sem recebível, avulsa aberta, baixa real da avulsa, prazo só com a avulsa do Cliente atual, trava das avulsas na exportação); falha sem a `279` no Postgres local em 2026-10-15. Em produção após o merge.

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
- [x] Demonstrar que outro CNPJ não lê, altera nem baixa IDs, caminhos e documentos no serviço gerenciado real. **Runtime:** produção, 2026-10-13, sessão do Cliente B contra pedido, B/L, documento e objeto do Cliente A: 403 nas RPCs e Edge Functions, 400 "Object not found" no Storage, nada alterado no banco (ver "Fontes").
- [ ] Completar a matriz de quota/rate limit, sessão revogada e downloads/papéis internos no serviço gerenciado real. Quota VIP coberta no banco por `ceUnlockVip.local-pg.test.ts`; falta a observação no serviço real (Edge Functions e gateway), que exige operar em produção.
- [x] Completar matriz anual: termo vigente/procuração vencida, pedido atravessando vencimento e renovação aplicada a múltiplos itens sem alterar snapshots antigos. **Teste:** `ceUnlockVip.local-pg.test.ts`.
- [x] Demonstrar retry sem eventos duplicados e preservação de documentos enviados/anuais no expurgo, incluindo anuais sem pedido e quotas VIP. **Teste:** `ceUnlockVip.local-pg.test.ts` e `supabase/functions/ce-unlock-cleanup/index.test.ts`.
- [x] Publicar a função e o job de expurgo. **Remoto:** `ce-unlock-cleanup` ativo e agendado diariamente em 2026-10-10.
- [x] Retenção e nova tentativa do expurgo. A retenção foi decidida na [ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md) (item 5) e implementada na migration `280`. A remoção de um PDF real pela Storage API foi observada em produção em 2026-10-15 (ver "Fontes"). A falha física com nova tentativa é coberta pelo handler real contra Storage simulado: falha não registra `purged_at`, o documento fica reivindicado e a rodada seguinte remove. **Teste:** `supabase/functions/ce-unlock-cleanup/index.test.ts` (Deno, no CI). Provocar a falha no Storage de produção não foi feito, por ser intrusivo.

- [x] Expurgo dos anexos da solicitação 30 dias após o encerramento (cancelada, ou concluída com todos os B/Ls exportados; em andamento mantém os PDFs, decisão do responsável de 2026-10-15) e dos documentos do Termo Anual VIP só quando um anual aprovado mais novo substitui o vencido ([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md), item 5); upload abandonado (1 dia) e rascunho (7 dias) não mudam; modelos anteriores saem após 5 anos. **Código:** migration `280`. **Teste:** `ceUnlock.local-pg.test.ts` (31 dias do envio em análise fica; 29/31 dias do encerramento, anual vencido sem substituto, renovação em análise, anual aprovado); falha sem a `280` no Postgres local em 2026-10-15. Em produção após o merge.

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
- [x] Completar testes de modelo disponível, confirmação, correção completa e retry de rede preservando chave idempotente; demonstrar VIP expirado/pendente e renovação em análise na UI. **Teste:** `PortalDesbloqueioCe.flow.test.tsx` (hook real, serviço simulado; jsdom, não runtime).
- [x] Validar teclado, perda de pagamento entre seleção e envio, com atualização visível, e URLs de inspeção. **Teste:** `PortalDesbloqueioCe.flow.test.tsx`: seleção e rascunho só por teclado; recusa "perdeu elegibilidade" invalida o cache e a lista volta com taxas pendentes, BL removível da seleção; `/clientes/portal/inspecao/:customerId/desbloqueio-ce` somente leitura. Comportamento em jsdom; navegador real e gateway não foram exercitados. Login real por CNPJ, upload, recusa de não-PDF e reenvio foram observados em produção em 2026-10-13 (ver "Fontes").
- [x] Mensagem de recusa de anexo diz a causa: "O arquivo não é um PDF" com orientação de salvar como PDF (renomear não converte) e "O arquivo passa de 10 MiB". **Código:** `supabase/functions/_shared/ceUnlockFile.ts` e `ceUnlockService.ts`. **Teste:** `ceUnlockDocuments.test.ts`. A Edge Function `portal-ce-unlock-document` precisa ser republicada após o merge.

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
- [x] Completar matriz de filtros Sem solicitação, exclusão sem CE, paginação e pedidos mistos. **Teste:** `ceUnlockMatriz.local-pg.test.ts` (situação, requisito pendente, Cliente, busca por CE, Portal dos dois Clientes; páginas de 25 sem repetir nem perder). A projeção de anexos por papel deixa de existir com o item P12 do plano de correções (ADR 0085, D16).
- [ ] Demonstrar aplicação anual e invalidação de ficha/fila/Portal entre CNPJs; validar atualização observável entre as duas SPAs, não apenas invalidação no mesmo cache. A invalidação no mesmo cache (fila interna, VIP e solicitações da ficha, Portal; comando do desk e do Portal, com sucesso e com erro) está coberta por `src/hooks/__tests__/ceUnlockCacheEffects.test.tsx`.

## Tarefa 6 — Exportação ZPT e confirmação de desbloqueio

**Layout definido pelo usuário:** cinco colunas — BL, Termo, Procuração,
Entrega de BL, Pagamento das taxas. Adotar XLSX e Sim/Não como proposta técnica,
validando um exemplo antes do aceite. Não criar coluna CE/VIP nem exigir API ZPT.

> **Superado pela revisão de 2026-10-07:** o layout vigente é `zpt-5-v2`, com os
> cabeçalhos do "Exportar Tela" da ZPT (`zpt-5-v1` fica só para lotes antigos).
> Exportar registra o envio, e a conciliação com o "Exportar Tela" marca
> *Desbloqueio conferido* ou *Divergente*; o registro de envio separado e a
> confirmação de desbloqueio por B/L (interfaces abaixo) saíram. Regra vigente no
> [módulo](../modules/desbloqueio-ce.md#envio-e-conciliação-com-a-zpt).

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
- [x] Implementar confirmação individual por B/L/CE/referência externa, separada de aprovação/exportação. **Superado** pela revisão de 2026-10-07: as ações `sent` e `confirm` saíram; exportar registra o envio e a conciliação com o "Exportar Tela" da ZPT marca *Desbloqueio conferido* ou *Divergente* ([módulo vivo](../modules/desbloqueio-ce.md)). Confirmações antigas ficam como histórico do desk.
- [x] Conciliação ZPT pela chave normalizada do CE, sem desbloquear dois B/Ls com o mesmo número. **Código/Remoto:** migration `177` (PR 929), em produção em 2026-10-12.
- [x] **[bloqueia ativação]** Troca ou remoção de CE com Desbloqueio conferido abre o alerta `ce_trocado_com_desbloqueio` e aparece na prévia. Reaberto em 2026-10-13: a definição da `195` lia a confirmação manual retirada na `160`, não o status da conciliação. Corrigido nas migrations `230` e `277` (B1 do [plano de correções](../archive/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md)), provado no Postgres local pelos testes B1 e 277; aplicadas em produção em 2026-10-15 (item 8 do caminho crítico; a troca de CE em produção não foi exercitada).
- [x] Demonstrar baixa cancelada concorrente à criação da exportação. **Teste:** "exportação aguarda reversão financeira concorrente…" em `ceUnlock.local-pg.test.ts` (ver "Fontes").
- [x] Demonstrar bloqueio por cada requisito, snapshot imutável e retry do mesmo lote. **Teste:** `ceUnlockMatriz.local-pg.test.ts` (pagamento, termo, procuração e entrega perdidos e restabelecidos pelos comandos reais; mesma chave devolve o mesmo lote; snapshot inalterado) e migration `281`.
- [x] Completar teste de vencimento/revogação entre pedido e exportação e preservação de lote anterior; rastreabilidade de origem/versão/vigência no snapshot. **Teste:** `ceUnlockVip.local-pg.test.ts`.
- [x] Reconciliar o requisito inicial de estado explícito de falha recuperável. **Decisão técnica (2026-10-15):** não há estado de falha persistido porque a geração da planilha não tem efeito externo: o lote (`ce_unlock_exports`) é gravado antes, é imutável desde a migration `281` e a planilha é gerada de novo a partir dele quantas vezes for preciso; o envio só fica registrado quando o desk o informa. Um estado de falha não acrescentaria recuperação.
- [x] Hash do lote preenchido: SHA-256 de `layout_version` e das linhas, calculado no banco ao gravar o lote, com backfill dos lotes existentes; distinto do hash de cada PDF. O lote não aceita reescrita (só `sent_at` e `reference`). **Código:** migration `281`. **Teste:** `ceUnlock.local-pg.test.ts` ("lote da exportação ZPT nasce com hash…").
- [x] Homologar a amostra XLSX (`zpt-5-v2`) e os indicadores Sim/Não com responsável/ZPT. **Aceite:** o responsável informou em 2026-10-14 que combinou com a ZPT e que o modelo atual de exportação está homologado (declaração, sem documento da ZPT anexado).
- [x] Conciliação com o "Exportar Tela": o responsável decidiu em 2026-10-15 que o modelo da ZPT usado no código e nos testes basta e dispensou a conciliação com um arquivo real antes da ativação. **Teste:** `ceUnlockZptReconcile.test.ts`, `CeUnlockZptImport.test.tsx` e `ceUnlock.local-pg.test.ts`; o primeiro arquivo real fica como observação da operação.

## Tarefa 7 — Validação completa, documentação e entrega

**Arquivos:** atualizar `CONTEXT.md`, `docs/modules/portal-cliente.md`,
`docs/modules/manifesto-edi.md`, `docs/ARCHITECTURE.md`,
`docs/RASTREABILIDADE.md`, `docs/operations/seguranca.md`,
`docs/operations/servicos-externos.md`, `docs/CHANGELOG.md` e catálogo RPC aplicável.

- [x] Integrar documentação de rotas, autorização, retenção, bucket, funções, modelos e procedimento ZPT, distinguindo geração, envio e confirmação. Homologação externa não foi registrada como concluída.
- [x] Registrar gates da entrega local original: docs, tipos, lint, testes, build, migrations e RPC, com skips e limites do banco/shims no relatório. Não equivale à execução atual de todos os gates na árvore integrada.
- [x] Documentar ordem backend → funções → frontend e reversão preservando consulta/histórico. Preview e publicação são itens separados, sem evidência na reconciliação de 2026-10-07; em 2026-10-10 a publicação em produção foi conferida (ver "Fontes"), e a validação em Preview e a compatibilidade frontend/backend seguem sem evidência.
- [x] Conferir histórico remoto e publicar migrations CE `139`–`149` e `160`–`161` e as cinco funções. **Remoto:** leitura de produção em 2026-10-10 (ver "Fontes").
- [x] Conferir que os frontends publicados no Cloudflare Pages são compatíveis com o backend atual. **Remoto:** em 2026-10-13 os sites, as migrations, as funções do banco e as Edge Functions do Desbloqueio correspondiam ao commit `c4a984f` da `main`, com CI verde (ver "Fontes"). Conferência de código, não de uso: o fluxo na tela é o item A/B abaixo. Refazer se um merge mudar só um dos lados. A Vercel ficou só como rollback manual.
- [x] Configurar agendamento de expurgo e de aviso por e-mail. **Remoto:** jobs ativos em 2026-10-10.
- [x] Conferir a migration `220` (trava do Cliente sem deadlock com o cancelamento de baixa) aplicada em produção depois do merge. **Remoto:** aplicada pela integração do Supabase às 14:27 UTC de 2026-10-13, após o merge da PR 936 (ver "Fontes").
- [x] Validar o resultado do expurgo antes da ativação operacional. **Remoto:** em 2026-10-14 a rodada das 06:00 UTC comprovou o ciclo com um objeto sem bytes, e em 2026-10-15 removeu um PDF real de 145.648 bytes enviado pelo Portal: rascunho cancelado, documento com `purged_at`, objeto fora do bucket e `ObjectRemoved:Delete` no log do Storage, sem afetar os documentos ativos (ver "Fontes").
- [x] Concluir as Etapas 6 (unicidade do CE) e 8.7 (prévia da troca de CE com alerta de Desbloqueio) do [plano de 2026-10-09](../archive/plans/2026-10-09-correcao-importacoes-ce-mercante.md). **Código/Remoto:** PR 929; migrations `174`–`217` em produção em 2026-10-12 (ver "Fontes").
- [x] Executar fluxo completo com clientes A/B e papéis internos no ambiente controlado: modelo, anexos, envio, correção/reenvio, aprovação, entrega parcial e exportação. **Runtime:** produção, 2026-10-13 (ver "Fontes"). A confirmação com evidência externa (conciliação com o "Exportar Tela" real) fica no item bloqueante de homologação da Tarefa 6; papel Financeiro e Operações nas telas não foram exercidos.
- [ ] Validar matriz integrada de pagamento parcial/consolidado, baixa cancelada, troca de Cliente, CE corrigido, múltiplas abas/retry, inspeção, downloads entre CNPJs e mobile/teclado.
- [ ] Validar fluxo VIP completo no ambiente controlado. No banco, o fluxo completo (dois pedidos sem reanexação, vencimento, renovação, reexportação e histórico) está em `ceUnlockVip.local-pg.test.ts`; falta a observação nas telas em produção.
- [ ] Registrar gates da árvore integrada no fechamento técnico e validação de Preview/gateway/Storage; distinguir testes locais, skips e observação remota.
- [x] Versões documentais anteriores na UI interna: `request_json` já devolve todas as versões, e `CeUnlockRequestDetail` as mostra em "Versões anteriores", só para consulta: arquivo, data de envio, situação, motivo e **Abrir documento** (tela aprovada pelo responsável em 2026-10-15, por captura); versão já expurgada mostra "Arquivo removido pela regra de retenção" (campo `purged`, migration `282`); reivindicada e ainda não removida, "Arquivo em remoção pela regra de retenção" (`cleanup_pending`). **Teste:** `CeUnlockRequestDetail.test.tsx` e `ceUnlock.local-pg.test.ts`. Teto O(n) da fila: **decisão técnica (2026-10-15)** manter como está, marcado `ponytail` no serviço, porque o volume previsto é de dezenas de pedidos abertos; o upgrade (read model indexado) entra quando a fila passar de algumas centenas de candidatos ou a tela ficar lenta.
- [ ] Concluir aceite operacional/ZPT; arquivar plano/spec e remover entradas dos índices na mesma mudança. Permanecem ativos enquanto faltarem aceites.

## Verificação da reconciliação

Reconciliação editorial em 2026-10-07, baseada em código/testes do checkout e
registros históricos, sem alteração de aplicação ou acesso ao ambiente remoto.
O plano continua ativo pelo aceite e pela evidência operacional pendentes.

Atualização em 2026-10-10: leitura (somente SELECT) do banco, das funções e do
pg_cron no projeto Supabase de produção, confronto com o plano de 2026-10-09 e
sua revisão de origem, e marcação dos itens que bloqueiam a ativação. Nenhum
teste foi reexecutado e nenhum dado remoto foi alterado.

Atualização em 2026-10-13: dois cenários novos na suíte SQL local e a migration
`220`, validados no Postgres local descartável (ver "Fontes"); a `220` chega à
produção pelo fluxo normal de merge. Depois, leitura somente SELECT de produção,
logs e GitHub Actions: fechou a compatibilidade dos frontends com o backend e
registrou que o expurgo nunca teve documento elegível. Por fim, com
autorização do responsável, foi criado em produção o documento de teste do
expurgo, e o fluxo A/B foi executado em produção pelo responsável, com
conferência no banco a cada etapa; esses são os únicos dados remotos criados ou
alterados nesta atualização.

Atualização em 2026-10-14: leitura somente SELECT, logs e cron de produção
depois da rodada do expurgo das 06:00 UTC, que removeu o documento de teste.
Nenhum dado remoto foi alterado nesta atualização.

Atualização em 2026-10-15: leitura somente SELECT, logs e resposta HTTP do job
depois da rodada do expurgo das 06:00 UTC, que removeu o PDF real do rascunho
de teste CE-E3CADF0B0202. Escritas remotas do teste, todas em 2026-10-14 e
depois da leitura daquele dia: o responsável criou o rascunho e enviou o PDF
pelo Portal (pedido, reserva do B/L, documento, objeto no Storage e eventos
`draft`/`upload_termo`), e o `created_at` do rascunho foi recuado 8 dias por
SQL, com autorização do responsável; essa foi a única escrita direta por SQL.
Na rodada de 2026-10-15, o próprio expurgo cancelou o rascunho, liberou o B/L,
revogou o documento e removeu o objeto.

Atualização em 2026-10-12, após o merge da PR 929: leitura (somente SELECT) do
banco de produção e conferência estática da suíte SQL do Desbloqueio. Fechou os
itens das Etapas 6 e 8.7, a reversão financeira concorrente à exportação e a
confirmação individual superada; acrescentou a homologação do "Exportar Tela" e
a nova conferência de compatibilidade. Nenhum teste foi reexecutado, nenhum dado
remoto foi alterado, e o CI do merge e a publicação dos frontends depois dele
não foram conferidos.
As propostas originais de contratos acima não substituem o módulo vivo nem
exigem recriar arquivos/RPCs já atendidos pelos dispatchers existentes.
