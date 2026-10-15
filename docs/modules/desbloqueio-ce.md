# Desbloqueio de CE Mercante

> **Status:** publicado em produção (backend e Cloudflare Pages); compatibilidade frontend/backend conferida em 2026-10-13 e fluxo com dois Clientes observado em produção até a exportação no mesmo dia; migration `220` em produção desde 2026-10-13; planilha `zpt-5-v2` homologada com a ZPT em 2026-10-14 (declaração do responsável); aceite operacional e jurídico obtido em 2026-10-14 ([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md)); expurgo de um PDF real comprovado em produção em 2026-10-15; ativação pendente de conciliação com um "Exportar Tela" real, das mudanças de isenção, avulsas e retenção da ADR 0087 e da correção B1 do plano de correções ([Notas e divergências](#notas-e-divergências)) · **Atualizado:** 2026-10-15 · **Rotas:** `/desbloqueio-ce`, `/portal/desbloqueio-ce`, `/clientes/portal/inspecao/:customerId/desbloqueio-ce`

## Propósito e escopo

A ZPT desbloqueia o CE Mercante sozinha quando as quatro colunas de uma carga
estão marcadas. O Vela substitui o controle manual dessas colunas: o cliente
solicita no Portal, o desk valida documentos e marca a entrega, e a planilha
exportada do Vela alimenta a ZPT. O sistema não chama API da ZPT.
Um pedido pode conter até 100 B/Ls do mesmo CNPJ. Termo de devolução e procuração
são comuns por pedido ou anuais de cliente VIP; a entrega física é registrada pelo desk.
Aprovação documental, exportação e conciliação são atos diferentes.

Este módulo usa o CE vigente de cada B/L, mas não é dono dele. A entrada do CE
pela planilha, os 15 dígitos, a unicidade, a correção ou remoção pela ficha do
B/L e os efeitos da troca são regras de
[Manifestos & EDI § CE Mercante](manifesto-edi.md#ce-mercante); o Nº de
Manifesto Mercante é regra de
[Manifestos & EDI § Manifesto Mercante](manifesto-edi.md#manifesto-mercante).

## Anatomia das telas

- Portal (`/portal/desbloqueio-ce`): abas Nova solicitação, Minhas solicitações e Documentos anuais (só VIP).
  Nova solicitação lista os quatro requisitos (no termo, o botão **Baixar modelo do termo de
  devolução**, quando há modelo publicado e o Cliente não é VIP) e uma tabela de BLs.
  Abaixo dos requisitos fica o botão **Baixar memorando de liberação de documentos**
  (`public/templates/memorando-liberacao-documentos-modelo.docx`), formulário para retirar
  documentos na agência; não é requisito nem entra no pedido (**Código:**
  `src/pages/PortalDesbloqueioCe.tsx`). Selecionar e continuar
  cria o rascunho sem confirmação, pois o cliente pode cancelá-lo. A solicitação abre em modal: próximo passo do estado, prazo, documentos
  (anexar/substituir com o motivo da recusa à vista), requisitos por BL e histórico.
  O cliente cancela enquanto o pedido está em rascunho ou com correção solicitada.
  Com tudo atendido, "Documentação validada… consulte o Mercante". Não mostra envio,
  ZPT nem desbloqueio. Modo Inspeção (`/clientes/portal/inspecao/:customerId/desbloqueio-ce`)
  é somente leitura (aviso global da inspeção).
- Vela (`/desbloqueio-ce`), aba **Solicitações**: uma linha por pedido a validar (cliente, BLs, status do
  termo de devolução e da procuração, prazo). Cada documento é aprovado ou recusado
  para o pedido inteiro; recusa exige motivo. Pedidos VIP não passam por aqui.
- Vela, aba **Controle ZPT**: uma linha por B/L com CE, com ou sem pedido. T. de
  Devolução, Procuração e Financeiro são ícones somente leitura (verde = atendido);
  **BL de Entrega** é a única caixa clicável (confirmação ao marcar, motivo ao
  desmarcar), inclusive antes de existir pedido. Filtro padrão *Aptos — não exportados*.
  Coluna Prazo (vencido / vence hoje) e coluna ZPT (exportado, desbloqueado, divergente).
  Exporta até 100 aptos (seleção por linha ou dos aptos da página). No cabeçalho, em
  modais: **Modelo do termo de devolução** (DOCX oficial, sem texto jurídico gerado; o cliente
  baixa, preenche, assina e anexa em PDF),
  **Histórico ZPT** (baixar e reexportar lotes) e **Conciliar com a ZPT** (importa o
  "Exportar Tela").
- Clientes → ficha → Desbloqueio de CE / VIP: habilitar/revogar VIP, apresentar
  documentos anuais, aprovar vigência e renovar. Portal também permite apresentar
  anuais sem B/L/pagamento; somente o desk aprova.

## Catálogo de ações

Gerir é dos papéis Administrativo e Documentação (`ce_unlock_manage`; o alias
legado `operator` vale como Documentação); os demais consultam,
inclusive os documentos do pedido, sem escrita
([matriz de permissões](../operations/seguranca.md#desbloqueio-de-ce),
[ADR 0085](../adr/0085-modelo-de-permissoes-por-perfil.md), itens D11 e D16). Hoje
os demais consultam sem os documentos (`ce_unlock_read`; documentos só com
`ce_unlock_documents`) e Equipamentos ainda não consulta: correção pendente no item P12 do
[plano de correções](../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md). Os comandos internos
passam por `ce_unlock_command` e os do Portal por `portal_ce_unlock_command`,
ambos em `ce_unlock_private.command`, com chave idempotente (`request_key`) e
versão esperada. Toda escrita do módulo chama `afterCeUnlockChanged`, que
invalida a família `ce-unlock` e a ficha do Cliente (`customer-detail`,
`customer-ficha`).

| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
|---|---|---|---|---|---|---|---|
| `/portal/desbloqueio-ce` › Nova solicitação · **Continuar com N BL(s)** | Sessão do Portal do próprio CNPJ, fora da Inspeção; 1 a 100 B/Ls do Cliente, liberados no Portal, com CE, taxas pagas e sem pedido ativo | `PortalDesbloqueioCe.tsx` | `usePortalCeUnlock` → `portalCeUnlockCommand('draft')` | `portal_ce_unlock_command`: `ce_unlock_requests` (rascunho, origem pedido ou VIP, modelo vigente) e `ce_unlock_request_bls` com o CE do pedido; recibo idempotente | Sem confirmação (o rascunho pode ser cancelado); `afterCeUnlockChanged` | "Selecione de 1 a 100 B/Ls"; B/L de outro Cliente recusado (`42501`); B/L inapto recusado com os motivos | **Teste:** `PortalDesbloqueioCe.test.tsx`, `ceUnlock.local-pg.test.ts`; **Runtime:** produção, 2026-10-13 |
| Solicitação (modal) · anexar ou **Substituir** termo de devolução e procuração | Pedido em rascunho ou com correção solicitada; PDF de até 10 MiB; limite diário e cota do Cliente | `CeUnlockDocuments.tsx` (`CeUnlockDocumentUploader`) | `uploadCeUnlockDocument` → Edge Function `portal-ce-unlock-document` | `ce_unlock_prepare_upload` reserva; objeto no bucket `ce-unlock-documents`; `ce_unlock_finish_upload` registra nova versão, sem sobrescrever | `afterCeUnlockChanged`; a versão recusada fica preservada | "Use PDF de até 10 MiB" (arquivo que não é PDF de verdade volta com HTTP 422); "Limite de 20 uploads por 24 horas"; cota de 100 MiB; "Pedido não aceita anexos" | **Teste:** `portal-ce-unlock-document/index.test.ts` (Deno), `ceUnlockDocuments.test.ts`; **Runtime:** produção, 2026-10-13 |
| Solicitação · **Solicitar desbloqueio** / **Reenviar solicitação** | Rascunho ou correção solicitada; termo e procuração atuais anexados (VIP: anuais aprovados e vigentes); cada B/L pago, do Cliente, não cancelado e com o mesmo CE do pedido | `PortalDesbloqueioCe.tsx` (confirmação) | `portalCeUnlockCommand('submit')` | Pedido enviado; itens ligados às versões atuais dos documentos (versão nova zera a aprovação daquele documento); evento `submit`; reavalia a conclusão | O prazo parte do envio e recomeça no reenvio; `afterCeUnlockChanged` | "Anexe versões atuais de termo de devolução e procuração"; "Regularize os documentos anuais VIP"; "Condição VIP revogada"; "B/L X perdeu elegibilidade" recusa o envio inteiro; versão desatualizada (`40001`) | **Teste:** `ceUnlock.local-pg.test.ts` (inclui baixa cancelada concorrente ao envio); **Runtime:** produção, 2026-10-13 |
| Solicitação · **Cancelar solicitação** (Portal) | Rascunho ou correção solicitada; nenhum B/L já exportado | `PortalDesbloqueioCe.tsx` | `portalCeUnlockCommand('cancel')` | Pedido cancelado e itens inativos; motivo padrão "Cancelado pelo cliente" | Libera os B/Ls; o Portal recebe só a projeção do cliente | "Pedido não pode ser cancelado pelo cliente. Contate a agência." | **Teste:** `ceUnlock.local-pg.test.ts` (cancelamento pelo cliente) |
| Documentos anuais (Portal, só VIP) e ficha do Cliente · anexar termo e procuração anuais | CNPJ com condição VIP; PDF; mesmos limites de upload | `CeUnlockVipCoveragePanel.tsx` | `uploadCeUnlockDocument` (origem `vip_annual`) → `portal-ce-unlock-document` | `ce_unlock_documents` em análise; não revoga o anual vigente | `afterCeUnlockChanged` | "Cliente sem condição VIP" (`42501`); "Condição VIP revogada" | **Código:** `ce_unlock_prepare_upload` (`173`); matriz VIP incompleta (ver [plano](../plans/2026-10-04-desbloqueio-ce-mercante.md)) |
| Portal · baixar o modelo do termo; Portal e Vela · baixar documento | Modelo: qualquer Cliente; documento: autorização atual (Portal só do próprio CNPJ; interno hoje só gestão, qualquer Departamento pelo item P12 do plano) | `PortalDesbloqueioCe.tsx`, `CeUnlockDocuments.tsx` | `downloadCeUnlockDocument` → `ce-unlock-document-download` | Não escreve; `ce_unlock_document_access` e URL assinada por 60 s | — | Documento de outro CNPJ: `403` (`42501`); objeto alheio no Storage: 400 "Object not found" | **Runtime:** produção, 2026-10-13 (acesso cruzado recusado) |
| `/desbloqueio-ce` › Solicitações › pedido · **Aprovar** / **Recusar documento** | Gestão; pedido enviado, em análise, com correção solicitada ou concluído; versão mais recente do documento; recusa com motivo | `CeUnlockReviewQueue.tsx` → `CeUnlockRequestDetail.tsx` | `useCeUnlock` → `ceUnlockCommand('review')` | Decisão em todos os B/Ls abertos do pedido; status e motivo no documento; evento | Recusa: aviso no sino e linha em `ce_unlock_email_outbox` com o motivo; reavalia a conclusão; aprovar não recomeça o prazo | "Motivo obrigatório"; "Documento alterado; atualize a página" (`40001`); "Documento não pertence à análise atual" | **Teste:** `CeUnlockRequestDetail.test.tsx`, `ceUnlock.local-pg.test.ts`; **Runtime:** produção, 2026-10-13 (recusa com motivo) |
| Controle ZPT · caixa **BL de Entrega** (**Registrar entrega** / **Desmarcar entrega**) | Gestão; B/L com CE, com ou sem pedido; desmarcar exige motivo | `DesbloqueioCe.tsx` | `useCeUnlock` → `ceUnlockCommand('delivery')` | `ce_unlock_bl_deliveries` com versão; evento; reavalia a conclusão do pedido ativo | Registrar recomeça o prazo; desmarcar tira o B/L dos aptos e reabre a conclusão | "Entrega alterada; atualize a página" (`40001`); "Motivo obrigatório" | **Teste:** `DesbloqueioCe.test.tsx`, `ceUnlock.local-pg.test.ts`; **Runtime:** produção, 2026-10-13 (entrega parcial) |
| Pedido · **Reconferir CE** | Gestão; B/L com o motivo "CE alterado: reconferência necessária"; motivo ("Como o CE foi conferido") | `CeUnlockRequestDetail.tsx` | `ceUnlockCommand('reconfirm_ce')` | O item passa a usar o CE atual; aprovações de termo e procuração do item voltam a pendentes; o envio volta à fila (`export_id` fica) | Reavalia a conclusão | "B/L não pertence ao pedido"; "Motivo obrigatório" | **Código:** `ce_unlock_private.command` (`161`); matriz de CE corrigido incompleta (ver plano) |
| Pedido VIP · **Aplicar renovação VIP** | Gestão; pedido VIP aberto, fora de rascunho; CNPJ VIP com termo e procuração anuais vigentes | `CeUnlockRequestDetail.tsx` | `ceUnlockCommand('apply_vip')` | Itens pendentes passam a apontar os anuais vigentes; histórico preservado | Reavalia a conclusão | "Cobertura VIP indisponível"; "Cobertura anual incompleta" | **Código:** `161` |
| Pedido · **Cancelar pedido** (desk) | Gestão; pedido ativo e não concluído; nenhum B/L já exportado; motivo | `CeUnlockRequestDetail.tsx` | `ceUnlockCommand('cancel')` | Pedido cancelado e itens inativos; evento com o motivo | Libera os B/Ls para nova solicitação; o cliente vê o pedido cancelado | "Documentação validada: a solicitação não pode mais ser cancelada"; "Pedido com B/L já exportado para a ZPT: confirme o tratamento externo antes de cancelar" | **Código:** `161` |
| Controle ZPT · **Exportar N apto(s) para ZPT** (**Exportar planilha**) | Gestão; 1 a 100 B/Ls com os quatro requisitos | `DesbloqueioCe.tsx` (confirmação) | `downloadCeUnlockExport` → Edge Function `ce-unlock-export` → `ce_unlock_command('export')` | `ce_unlock_exports` (layout `zpt-5-v2`, linhas e snapshot); `exported_at`, `exported_by` e `export_id` por B/L; apaga o *Divergente* anterior desses B/Ls | Baixa o XLSX e registra o envio, que mede o cumprimento do prazo; aviso para importar na aba "Planilha desbloqueio" da ZPT | "B/L X não apto" com os motivos recusa o lote inteiro (inclui liquidação perdida durante a exportação); "Seleção inválida" | **Teste:** `ceUnlockRules.test.ts` (layout), `ceUnlock.local-pg.test.ts` (reversão concorrente); **Runtime:** produção, 2026-10-13 (`zpt-5-v2`, 3 B/Ls); aceite pela ZPT não comprovado |
| **Histórico ZPT** · **Baixar lote** / **Reexportar** | Gestão | `DesbloqueioCe.tsx` | `listCeUnlockExports`; `downloadCeUnlockExport` com `export_id` ou `reexport_of` | Baixar não escreve (devolve o lote como foi gerado, inclusive `zpt-5-v1`); Reexportar cria lote novo ligado ao anterior, com os requisitos atuais | Reexportar registra novo envio | "Lote não encontrado"; na reexportação, as mesmas recusas de Exportar | **Código:** `ce-unlock-export`; retry do mesmo lote sem teste (ver plano) |
| **Conciliar com a ZPT** · **Conciliar arquivo** | Gestão; arquivo "Exportar Tela" da ZPT (.xls, .xlsx ou .csv) de até 20.000 linhas | `CeUnlockZptImport.tsx` (confirmação com "Fora da conciliação") | `parseCeUnlockZptFile` e `reconcileCeUnlockZpt` (lotes de 5.000) → `ce_unlock_reconcile` | `ce_unlock_zpt_status` por B/L (*Desbloqueio conferido* ou *Divergente*); evento `reconcile`; sem recibo | Resumo: Desbloqueados, Divergentes, ZPT ainda sem atualização, Bloqueados não exportados, CE desconhecido; nada vai ao cliente nem muda o prazo | "Arquivo da ZPT vazio ou grande demais"; linhas e abas ocultas e linhas sem CE ou Status ficam de fora | **Teste:** `ceUnlockZptReconcile.test.ts`, `CeUnlockZptImport.test.tsx`, `ceUnlock.local-pg.test.ts`; arquivo real da ZPT não comprovado |
| **Modelo do termo de devolução** · **Publicar modelo** | Gestão; DOCX de até 10 MiB | `DesbloqueioCe.tsx` (`CeUnlockDocumentUploader` com origem `model`) | `uploadCeUnlockDocument` → `portal-ce-unlock-document` | `ce_unlock_documents` (`model`) e objeto `.docx` no bucket; o mais recente aprovado é o vigente | Disponível no Portal de todos os clientes; rascunhos novos guardam o modelo vigente | "Use o modelo em DOCX de até 10 MiB"; assinatura ZIP ou tipo inválidos recusados | **Remoto:** modelo cadastrado em produção em 2026-10-10 (ver plano) |
| Controle ZPT e pedido · consultar (Financeiro e Operações) | `ce_unlock_read` sem `ce_unlock_manage` | `DesbloqueioCe.tsx` | `useCeUnlock`, `ceUnlockRead` | Não escreve | — | Ações de gestão indisponíveis na tela e recusadas no banco; hoje o download de anexos também é recusado e Equipamentos não abre a tela (correção pendente, item P12 do plano: ADR 0085, D11 e D16) | **Teste:** `DesbloqueioCe.test.tsx` (ações restritas) |
| Ficha do Cliente › Desbloqueio de CE / VIP · **Habilitar condição VIP** / **Revogar condição VIP** | Gestão; motivo | `CeUnlockVipCoveragePanel.tsx` | `ceUnlockCommand('set_vip')` | `ce_unlock_vip_customers` com versão; evento | Os próximos pedidos usam (ou deixam de usar) os anuais | "Motivo obrigatório"; "Condição VIP alterada" (`40001`) | **Código:** `161` |
| Ficha do Cliente › documentos anuais · **Aprovar** / **Solicitar correção** / **Revogar aprovação** | Gestão; aprovação informa início e ano, com fim em 31/12 do ano; correção e revogação com motivo | `CeUnlockVipCoveragePanel.tsx` | `ceUnlockCommand('review')` | `ce_unlock_documents`: status, `coverage_year`, `valid_from`, `valid_until`; evento | Aprovação cobre os pedidos VIP do CNPJ na vigência; revogação pode tirar o requisito de pedidos não concluídos | "Validade anual deve terminar em 31/12 do ano informado"; "Motivo obrigatório" | **Teste:** limites 31/12–01/01 e ano inválido em `ceUnlockRules.test.ts` |

## Estado e dados

### Tabelas e migrations

Migrations `139`–`149`, `160`, `161`, `173` e `220`; a `177` redefine
`ce_unlock_reconcile` (chave do CE) e a `181`/`195` o alerta
`ce_trocado_com_desbloqueio`. Tabelas `ce_unlock_*` (`ce_unlock_requests`,
`ce_unlock_request_bls`, `ce_unlock_documents`, `ce_unlock_vip_customers`,
`ce_unlock_bl_deliveries`, `ce_unlock_events`, `ce_unlock_exports`,
`ce_unlock_zpt_status` e `ce_unlock_email_outbox`), schema privado de
helpers/receipts, RLS sem acesso direto do navegador e RPCs com escopo
server-side. A `160` acrescenta `exported_at/exported_by/export_id` em
`ce_unlock_request_bls`, `ce_unlock_zpt_status` (conciliação) e
`ce_unlock_email_outbox`. A `173` faz o modelo publicado pelo desk ser `.docx`
(nome, assinatura ZIP e tipo no Storage); termo, procuração e anuais seguem só
PDF.

`ce_unlock_reconcile` é função própria (sem receipts: o payload é grande e a
operação é idempotente) e só aceita escrita interna. Campos de envio/ZPT são
removidos das projeções do Portal (`ce_unlock_private.portal_view`). Inspeção
tem wrappers de leitura. As ações `sent` e `confirm` foram removidas;
confirmações externas antigas permanecem como histórico do desk.

### Armazenamento e funções

Bucket privado `ce-unlock-documents`. Documentos são versionados. Funções:
`portal-ce-unlock-document`, `ce-unlock-document-download`,
`ce-unlock-export`, `ce-unlock-cleanup`, `ce-unlock-notify-email`; config e
operação no [manual externo](../operations/servicos-externos.md). Os jobs
`ce-unlock-cleanup` e `ce-unlock-notify-email` não são criados pela migration;
configurar o segredo no Vault/Edge Functions e então agendá-los como passo
operacional ([segredos e cron](../operations/segredos-cron.md)).

## Fluxos e invariantes

### Requisitos e condição VIP

Os quatro requisitos são termo de devolução aprovado, procuração aprovada, taxas locais
integralmente liquidadas (Financeiro) e B/L original entregue (BL de Entrega). Selo VIP
não dispensa documento: exige termo e procuração anuais aprovados/vigentes para o mesmo
CNPJ. Validade até 31/12 do ano declarado, inclusive em America/Sao_Paulo; não renova
em janeiro. Pagamento e entrega continuam por B/L, também para VIP. A entrega do
original é independente da solicitação: o desk a registra antes ou depois do pedido.
Conteúdo, assinatura e validade do termo e da procuração são conferidos só pela
análise humana do desk ([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md)). Reserva de upload
sem PDF registrado não substitui a versão enviada nem consome quota ativa após
compensação/expurgo. Documento novo em análise não revoga o anterior vigente; renovação
pode ser aplicada aos pedidos pendentes pelo desk, com histórico.

### Requisito financeiro

Taxas locais usam recebíveis/settlements vigentes do Cliente atual, não status
isolado de fatura. Troca de CNPJ com devolução ou reemissão pendente bloqueia
solicitação e atos posteriores; o recebimento antigo permanece no histórico e
não financia o novo Cliente. A nova cobrança precisa de liquidação própria.
Restituição de excedente por redução normal do mesmo Cliente não bloqueia
aptidão quando o valor corrigido já está coberto. Pagamento
parcial, ausência de liquidação, nova obrigação de COD ou cancelamento de baixa
impedem aptidão. Demurrage/avulsas não fazem parte do requisito local.
**Decidido em 2026-10-14, implementação pendente
([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md)):** B/L com Taxas
Locais isentas fica sem o requisito de pagamento (apto com termo, procuração e
entrega), e o requisito passa a incluir as cobranças avulsas do B/L; Demurrage
continua fora. Hoje o B/L isento não tem recebível de Taxas Locais e fica
como não pago. Correções para menor
reduzem o valor exigível: a liquidação cobre o valor original menos a correção,
com saldo zero e evidência real no ledger. Fatura consolidada parcialmente paga
libera só o B/L cujo recebível foi liquidado, nunca pelo status da fatura.

### Conclusão

A solicitação passa a *Documentação validada* quando todos os B/Ls
ativos têm os quatro requisitos; desfazer um requisito a reabre. Solicitação concluída
não pode mais ser cancelada (nem pelo desk). O aviso "documentação validada" sai só na
primeira conclusão. A conclusão é reavaliada nos comandos e, para liquidações feitas fora
do módulo, pela varredura `ce_unlock_refresh_open()` que o job `ce-unlock-notify-email`
executa a cada 5 minutos (ponytail: O(solicitações abertas); upgrade: fila por trigger).

### Prazo (SLA)

Começa no envio; só dias úteis, sem feriados. Antes das 12:00 vence às
17:00 do mesmo dia; a partir das 12:00, às 12:30 do próximo dia útil; sábado/domingo
vencem segunda às 12:00. Recomeça com a pendência do cliente resolvida
(reenvio, entrega do original, nova liquidação); aprovar documento não recomeça.
Calculado na tela (`ceUnlockSla.ts`) e no banco (`ce_unlock_private.sla_deadline`,
usado no texto do aviso); o teste SQL confere os dois com os mesmos casos. O
cumprimento é medido pela data da exportação.

### Avisos ao cliente

Recusa de documento (com o motivo) e documentação validada (com o
prazo) geram um aviso no sino do Portal e uma linha na fila `ce_unlock_email_outbox`; a
Edge Function `ce-unlock-notify-email` envia aos contatos da caixa **Documentação e
Operação**, respeitando a chave global de Comunicados, supressão e bounce, e registra a tentativa
em `portal_email_attempts`. Nenhum texto cita ZPT ou desbloqueio confirmado. O Portal mostra
só a data do prazo (nunca "vencido"), e seu histórico omite exportação, entrega e VIP.

### Envio e conciliação com a ZPT

Só entram na planilha B/Ls com os quatro requisitos. O layout
`zpt-5-v2` usa os cabeçalhos do "Exportar Tela" da ZPT (`BL`, `Financeiro`,
`Term. Devolucao`, `Procuracao`, `BL Entrega`; Sim/Não). **Exportar registra o envio**
(data e usuário por B/L); lotes antigos `zpt-5-v1` mantêm seu layout. Importar o
.xls da ZPT concilia por CE (ignora zeros à esquerda): *Desbloqueado* vira
*Desbloqueio conferido* (mesmo sem exportação pelo Vela); exportado e ainda bloqueado
vira *Divergente* com status, descrição e colunas em "Não"; bloqueado e nunca exportado
é ignorado. Linha bloqueada cuja atualização na ZPT é anterior à exportação conta como
"ZPT ainda sem atualização" e não vira *Divergente* (**Código:** `ce_unlock_reconcile`,
migration `177`). O Vela guarda status, descrição, data e colunas em "Não"; nunca o CPF/nome do
operador da ZPT. A conciliação não altera o prazo nem o que o Portal mostra. Linhas e
abas ocultas e linhas sem CE ou Status ficam de fora da leitura; a confirmação de
**Conciliar** as lista em "Fora da conciliação" antes de gravar.

A conciliação casa o CE pela chave normalizada `ce_mercante_key` (migration
`177`), a mesma da unicidade do CE entre B/Ls ativos e Granito
([CE Mercante](manifesto-edi.md#ce-mercante)); por isso não desbloqueia dois
B/Ls com o mesmo número.

### Troca de CE e reconferência

Cancelamento de B/L e correção do CE também exigem nova conferência: o item do
pedido guarda o CE da solicitação, e o B/L com CE diferente aparece com o motivo
"CE alterado: reconferência necessária" até o desk usar **Reconferir CE**. Trocar o CE de um B/L com
*Desbloqueio conferido*, pela planilha ou pela ficha, abre o alerta
`ce_trocado_com_desbloqueio` (`181`, `195`); hoje o código não cumpre essa regra
(correção pendente B1 em [Notas e divergências](#notas-e-divergências)). As
portas de troca do CE e o alerta de reenvio do Comunicado são regra de
[CE Mercante](manifesto-edi.md#ce-mercante).

### Concorrência, idempotência e autorização

Escritas cliente/internal usam dispatchers distintos com allowlists (Portal: `draft`,
`submit`, `cancel`); retries compartilham chave idempotente e recusam alteração de payload.

Comandos CE do mesmo Cliente se serializam pela trava `FOR NO KEY UPDATE` na linha do
Cliente (`220`; antes `FOR UPDATE`, que entrava em deadlock com o cancelamento de baixa,
cujo aviso no Portal pede `FOR KEY SHARE` no Cliente). Envio e exportação travam os
recebíveis do B/L e revalidam a liquidação depois de esperar uma baixa ou um cancelamento de baixa em
curso: B/L que perdeu a liquidação é recusado.

### Documentos, upload e expurgo

Upload pela Edge Function valida sessão, PDF/MIME/assinatura, 10 MiB, 20
uploads/24h e 100 MiB ativos por cliente. Download exige autorização atual e
URL assinada por 60 s.

O expurgo reivindica/fixa os registros no banco antes de apagar objetos;
rascunho expirado é cancelado sob lock, e falha física permite retry.
O modelo atual e anuais vigentes não são expurgados por mera idade.

Expurgo usa Storage API: uploads abandonados após 1 dia, rascunhos após 7 dias,
registros documentais inativos após 5 anos, preservando metadados e histórico.
Não excluir anuais só por não terem pedido. Os 5 anos contam da criação do
documento e só valem para documento sem pedido ou de pedido concluído ou
cancelado que nenhum pedido aberto ainda use (**Código:**
`ce_unlock_cleanup_candidates`, migration `143`).
**Decidido em 2026-10-14, implementação pendente
([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md)):** todos os
anexos de uma solicitação passam a ser expurgados 30 dias após o envio, e os
documentos do Termo Anual (VIP) ficam até serem substituídos por um novo termo
aprovado depois do vencimento. Upload abandonado (1 dia) e rascunho (7 dias)
não mudam.

### Robustez de finalização

Após mudança de Cliente do BL, o pedido anterior perde aplicabilidade; seu
cancelamento libera uma nova solicitação para o Cliente atual, sem expor
histórico privado. Falha na resposta de finalização do upload não remove PDF
já registrado; compensação e expurgo reivindicam o documento no banco antes
da remoção. O logout do Portal remove seu cache privado de CE.

Ações financeiras de baixa, cancelamento, restituição e retry invalidam também
as consultas de CE no mesmo cliente de cache; os comandos revalidam no banco.

## Testes e validação

Testes SQL reais: `src/integration/ceUnlock.local-pg.test.ts` (inclui cancelamento pelo
cliente, fila de Solicitações, paridade do prazo SQL×tela, conciliação e fila de e-mail);
regras VIP/ZPT, prazo, leitura do arquivo da ZPT e e-mail em `src/services/__tests__/ceUnlock*.test.ts`;
o handler de upload é exercitado em Deno por `supabase/functions/portal-ce-unlock-document/index.test.ts`;
componentes e Portal em seus harnesses existentes. Postgres local usa shims de Auth/Storage/cron,
que não comprovam o gateway Supabase nem o envio real de e-mail.

- **Teste (Postgres 16 local, 2026-10-13):** `ceUnlock.local-pg.test.ts` demonstra a
  fatura consolidada parcialmente paga (só o B/L liquidado fica pago) e o
  cancelamento de baixa concorrente ao envio pelo comando real; sem a `220` o
  segundo terminava em deadlock.
- **Runtime (produção, 2026-10-13):** os sites publicados, as migrations, as
  funções do banco e as Edge Functions correspondiam ao mesmo commit da `main`
  (conferência de código, não de uso). O fluxo com os Clientes A e B, operado
  pelo responsável e conferido no banco, foi até a exportação `zpt-5-v2`:
  recusa por taxas sem liquidação, upload de não-PDF recusado, recusa do termo
  com motivo e reenvio, entrega parcial, conclusão e exportação; a sessão de B
  não leu, alterou nem baixou nada de A (403/400). Detalhes nas "Fontes da
  reconciliação" do [plano](../plans/2026-10-04-desbloqueio-ce-mercante.md).
- O teste K2 de `src/integration/ceImportacaoContrato.local-pg.test.ts`, que
  cobre o alerta de troca de CE com Desbloqueio conferido, monta à força uma
  confirmação que o fluxo vigente não produz; não comprova o caso real (ver B1).

**Não comprovado:** aceite da planilha `zpt-5-v2` pela aba "Planilha desbloqueio" da ZPT
(sem modelo oficial de importação; o primeiro upload real é o teste), conciliação com um
"Exportar Tela" real, entrega real dos avisos por e-mail (em produção os Comunicados estavam
desligados e a tentativa ficou `skipped`) e a falha física no Storage seguida de nova
tentativa no expurgo. A migration `220` está em produção desde 2026-10-13. O expurgo removeu
em produção, na rodada de 2026-10-15, um PDF real de 145.648 bytes enviado pelo Portal num
rascunho de teste tornado elegível: rascunho cancelado, documento com `purged_at`, objeto
fora do bucket e `ObjectRemoved:Delete` no log do Storage (detalhes nas "Fontes" do
[plano](../plans/2026-10-04-desbloqueio-ce-mercante.md)).

Evidência da execução original e limitações estão no
[relatório local](../archive/reports/2026-10-04-desbloqueio-ce-implementacao.md); a revisão de
2026-10-07 segue [spec](../archive/specs/2026-10-07-desbloqueio-ce-revisao-fluxo-design.md) e
[plano](../archive/plans/2026-10-07-desbloqueio-ce-revisao-fluxo.md).

## Notas e divergências

- **Correção pendente (B1):** trocar ou remover o CE de um B/L conciliado como
  *Desbloqueio conferido* não abre `ce_trocado_com_desbloqueio` nem avisa
  "Desbloqueio já conferido" na prévia, porque `_set_bl_ce_mercante` e a prévia
  (`195`) procuram a confirmação manual retirada na `160`, não o status da
  conciliação (`ce_unlock_zpt_status`), e a coluna ZPT some da linha sem aviso;
  bloqueia a ativação. Entra no [plano de correções](../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md) a favor da decisão registrada
  ([ADR 0083](../adr/0083-decisoes-da-revisao-geral-da-documentacao.md), item 26).
- A fila calcula os requisitos dos candidatos antes de paginar; custo O(n),
  indicado como `ponytail` no serviço. Avaliar read model indexado com aumento
  do volume operacional.
- A varredura `ce_unlock_refresh_open()` é O(solicitações abertas); o upgrade
  previsto é uma fila por trigger ([Conclusão](#conclusão)).
- Confirmações externas registradas antes da revisão de 2026-10-07 aparecem no
  pedido como "Confirmações externas (histórico anterior)"; nenhuma ação atual
  as cria.
