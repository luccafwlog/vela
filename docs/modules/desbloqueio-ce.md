# Desbloqueio de CE Mercante

> **Status:** publicado em produção (backend e Cloudflare Pages); compatibilidade frontend/backend conferida em 2026-10-13 e fluxo com dois Clientes observado em produção até a exportação no mesmo dia; planilha `zpt-5-v2` homologada com a ZPT em 2026-10-14 (declaração do responsável), com a conciliação por arquivo real dispensada pelo responsável em 2026-10-15; aceite operacional e jurídico em 2026-10-14 ([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md)), implementado nas migrations `279`–`282` (PR 956, em produção após o merge); alerta de troca de CE com Desbloqueio conferido corrigido nas migrations `230` e `277` (PR 954); expurgo de um PDF real comprovado em produção em 2026-10-15; mudanças da PR 956 conferidas e observadas em produção em 2026-10-15, com os ajustes da PR 961; [plano](../archive/plans/2026-10-04-desbloqueio-ce-mercante.md) arquivado; B/L que muda de solicitação (migration `299`, [ADR 0089](../adr/0089-desbloqueio-ce-bl-muda-de-solicitacao.md)) e "Taxas locais aguardando fatura" (migration `298`) ainda não aplicados no Supabase remoto · **Atualizado:** 2026-10-18 · **Rotas:** `/desbloqueio-ce`, `/portal/desbloqueio-ce`, `/clientes/portal/inspecao/:customerId/desbloqueio-ce`

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

- Portal (`/portal/desbloqueio-ce`): abas Nova solicitação, Minhas solicitações (`?aba=solicitacoes`) e
  Documentos anuais (`?aba=anuais`, só VIP); desenho do lote 4 da identidade (2026-10-18).
  **Nova solicitação** abre com o bloco "O que o desbloqueio pede" na situação deste Cliente: VIP vê
  termo e procuração "Coberto(a) pelo … anual até 31/12/AAAA" ou "Falta …" em âmbar, com "Abrir
  Documentos anuais" quando falta; Cliente sem VIP vê "Assinado, em PDF, anexado à solicitação" e
  "Em PDF, anexada à solicitação", com **Baixar modelo do termo** quando há modelo publicado, e
  nenhuma menção a documento anual. Na faixa, **Baixar memorando de liberação**
  (`public/templates/memorando-liberacao-documentos-modelo.docx`), formulário para retirar documentos
  na agência; não é requisito nem entra no pedido. Cartões que filtram ("Podem ser pedidos", "Com
  taxas locais em aberto", "Já em solicitação") e tabela limpa: B/L, CE Mercante, Navio / Viagem, POD,
  Taxas locais ("✓ Pagas", "Em aberto" em âmbar com "Ver faturas", "Aguardando fatura" sem valor,
  "Isentas") e Solicitação (protocolo e situação). A faixa "Pedir desbloqueio de N B/Ls" cria o
  rascunho sem confirmação, pois o cliente pode cancelá-lo; com B/L de outra solicitação ainda não
  validada, antes mostra a confirmação "Mudar N B/Ls e continuar" (B/L, Sai de, O que acontece com a
  antiga; ver [B/L que muda de solicitação](#bl-que-muda-de-solicitação)).
  **Minhas solicitações:** Protocolo (abre o detalhe), Aberta em, B/Ls (primeiro e "+N"), Documentos,
  Prazo para desbloqueio (de `sla_started_at`) e Situação em texto ("Correção pedida · reenvie …" e
  "Rascunho · falta enviar" em âmbar; cancelada em cinza). O **detalhe** (janela) tem os blocos
  Solicitação (situação e próximo passo, B/Ls, prazo e quando ele recomeça), Documentos em tabela
  ("Enviar nova versão" só onde há correção pedida, por botão), B/Ls da solicitação, Histórico
  fechado em tabela e a faixa de reenvio no pé; "Cancelar solicitação" no topo, enquanto o pedido
  está em rascunho ou com correção solicitada. Com tudo atendido, "Documentação validada… consulte o
  Mercante". Não mostra envio, ZPT nem desbloqueio (**Código:** `src/pages/PortalDesbloqueioCe.tsx`).
  Modo Inspeção (`/clientes/portal/inspecao/:customerId/desbloqueio-ce`)
  é somente leitura (aviso global da inspeção).
- Vela (`/desbloqueio-ce`), aba **Solicitações** (com a contagem): bloco "Solicitações aguardando
  análise", uma linha por pedido a validar (protocolo, que abre o detalhe; Cliente, que leva à ficha;
  primeiro B/L e "+n"; termo de devolução e procuração em texto, âmbar quando aguardam análise,
  recusados ou revogados; situação; prazo). O botão **Modelo do termo de devolução** (DOCX oficial,
  sem texto jurídico gerado; o cliente baixa, preenche, assina e anexa em PDF) fica no cabeçalho do
  bloco. Cada documento é aprovado ou recusado para o pedido inteiro; recusa exige motivo. Pedidos VIP
  não passam por aqui.
- Vela, aba **Andamento dos B/Ls** (até 2026-10-16 "Controle ZPT"; `?aba=controle` continua):
  cartões que filtram por situação (Aptos não exportados, Exportados aguardando a ZPT, Divergentes na
  ZPT, Desbloqueados e B/Ls com CE; situações `exported` e `unlocked` da migration `296`; o B/L de
  confirmação externa antiga, `export_state` `confirmed` sem retorno da ZPT, só entra em "B/Ls com
  CE"); Busca, Situação, Viagem e POD abertos (Busca e POD consultam depois da pausa na digitação),
  Requisito pendente em "Mais filtros". Uma linha por B/L com CE, com
  ou sem pedido: B/L, CE Mercante, Cliente (marca "VIP"), Solicitação, Termo de devolução,
  Procuração e Taxas locais como ícones somente leitura (verde = atendido); **B/L original** é a única
  caixa clicável (confirmação ao marcar, motivo ao desmarcar), inclusive antes de existir pedido.
  Prazo numa célula ("Hoje, HH:MM" em âmbar; "Venceu …" em vermelho) e **Na ZPT** só com o estado da
  ZPT (Não exportado, Exportado dd/mm, Desbloqueado, Divergente com a descrição ao passar o mouse) ou
  o impedimento que não é requisito (CE alterado, B/L cancelado, troca de Cliente, Cliente alterado).
  Navio, viagem e POD ficam no filtro e na planilha. Qualquer B/L pode ser selecionado; a faixa diz
  quantos são aptos e quantos estão sem a entrega do original, com **Registrar entrega de N B/Ls**;
  a entrega registrada ou desmarcada na linha renova os dados guardados do B/L selecionado.
  No cabeçalho do bloco: **Exportar planilha** (planilha comum do recorte inteiro, separada da
  planilha da ZPT), **Planilhas enviadas à ZPT** (baixar e reexportar lotes), **Conciliar com a ZPT**
  (importa o "Exportar Tela") e **Exportar N aptos para a ZPT** (só os aptos selecionados, até 100).
- Detalhe da solicitação (janela): blocos Solicitação ("aberta em" pelo primeiro rascunho ou envio; situação e o que falta, Cliente, B/Ls, prazo (corre até a exportação de todos os B/Ls, inclusive na concluída; some só na cancelada),
  origem dos documentos), Documentos (o nome do arquivo abre; **Analisar** abre Aprovar e Recusar;
  documento recusado continua com **Analisar**, só com Aprovar; aprovado tem o menu ⋮ com
  **Recusar aprovação**; versões anteriores no pé, com o motivo), B/Ls da
  solicitação, Histórico (tabela com quem fez, migration `296`) e Confirmações externas, se houver.
- Clientes → ficha → Desbloqueio de CE / VIP: habilitar/revogar VIP, apresentar
  documentos anuais, aprovar vigência e renovar. Portal também permite apresentar
  anuais sem B/L/pagamento; somente o desk aprova. A peça dos documentos anuais é a
  mesma no Portal, na ficha e na análise do pedido VIP (`CeUnlockVipCoveragePanel` e
  `CeUnlockDocuments`, lote 4): cobertura de cada documento como fato ("Coberto até
  31/12/AAAA" / "Falta" em âmbar) e uma tabela Documento | Arquivo | Enviado em |
  Vigência | Situação, com a versão anterior recusada ou revogada em cinza. No Portal, o
  envio é pelos botões "Enviar termo de devolução" e "Enviar procuração"; no Vela,
  **Analisar** só onde há decisão abre "Analisar <documento>" (Ano da cobertura,
  Início da vigência, Fim 31/12) com Aprovar / Solicitar correção / Voltar, e
  **Revogar aprovação** fica no menu ⋮ do aprovado. Ficha de Cliente sem VIP mostra só
  o bloco Condição VIP.

## Catálogo de ações

Gerir é dos papéis Administrativo e Documentação (`ce_unlock_manage`; o alias
legado `operator` vale como Documentação); os demais consultam,
inclusive os documentos do pedido, sem escrita
([matriz de permissões](../operations/seguranca.md#desbloqueio-de-ce),
[ADR 0085](../adr/0085-modelo-de-permissoes-por-perfil.md), itens D11 e D16;
migration `250`). A referência externa da confirmação segue só para quem gere. Os comandos internos
passam por `ce_unlock_command` e os do Portal por `portal_ce_unlock_command`,
ambos em `ce_unlock_private.command`, com chave idempotente (`request_key`) e
versão esperada. Toda escrita do módulo chama `afterCeUnlockChanged`, que
invalida a família `ce-unlock` e a ficha do Cliente (`customer-detail`,
`customer-ficha`).

| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
|---|---|---|---|---|---|---|---|
| `/portal/desbloqueio-ce` › Nova solicitação · **Continuar com N BL(s)** | Sessão do Portal do próprio CNPJ, fora da Inspeção; 1 a 100 B/Ls do Cliente, liberados no Portal, com CE, taxas pagas e sem pedido ativo | `PortalDesbloqueioCe.tsx` | `usePortalCeUnlock` → `portalCeUnlockCommand('draft')` | `portal_ce_unlock_command`: `ce_unlock_requests` (rascunho, origem pedido ou VIP, modelo vigente) e `ce_unlock_request_bls` com o CE do pedido; recibo idempotente | Sem confirmação (o rascunho pode ser cancelado); `afterCeUnlockChanged` | "Selecione de 1 a 100 B/Ls"; B/L de outro Cliente recusado (`42501`); B/L inapto recusado com os motivos | **Teste:** `PortalDesbloqueioCe.test.tsx`, `ceUnlock.local-pg.test.ts`; **Runtime:** produção, 2026-10-13 |
| Solicitação (modal) · anexar ou **Substituir** termo de devolução e procuração | Pedido em rascunho ou com correção solicitada; PDF de até 10 MiB; limite diário e cota do Cliente. Anexar só escolhe o arquivo: ele sobe ao clicar em **Solicitar desbloqueio** / **Reenviar solicitação**, sem botão de envio por documento | `CeUnlockDocuments.tsx` (`CeUnlockDocumentUploader`, anexo adiado), `PortalDesbloqueioCe.tsx` | `uploadCeUnlockDocument` → Edge Function `portal-ce-unlock-document` | `ce_unlock_prepare_upload` reserva; objeto no bucket `ce-unlock-documents`; `ce_unlock_finish_upload` registra nova versão, sem sobrescrever | `afterCeUnlockChanged`; a versão recusada fica preservada | "O arquivo não é um PDF…" com orientação de salvar como PDF (HTTP 422) e "O arquivo passa de 10 MiB"; "Limite de 20 uploads por 24 horas"; cota de 100 MiB; "Pedido não aceita anexos" | **Teste:** `portal-ce-unlock-document/index.test.ts` (Deno), `ceUnlockDocuments.test.ts`; **Runtime:** produção, 2026-10-13 |
| Solicitação · **Solicitar desbloqueio** / **Reenviar solicitação** | Rascunho ou correção solicitada; termo e procuração atuais anexados (VIP: anuais aprovados e vigentes); cada B/L pago, do Cliente, não cancelado e com o mesmo CE do pedido | `PortalDesbloqueioCe.tsx` (confirmação) | Depois de confirmar: `uploadCeUnlockDocument` dos anexos escolhidos (termo, depois procuração), releitura do pedido e `portalCeUnlockCommand('submit')` com a versão nova | Pedido enviado; itens ligados às versões atuais dos documentos (versão nova zera a aprovação daquele documento); evento `submit`; reavalia a conclusão | O prazo parte do envio e recomeça no reenvio; `afterCeUnlockChanged` | "Anexe versões atuais de termo de devolução e procuração"; "Regularize os documentos anuais VIP"; "Condição VIP revogada"; "B/L X perdeu elegibilidade" recusa o envio inteiro; versão desatualizada (`40001`) | **Teste:** `ceUnlock.local-pg.test.ts` (inclui baixa cancelada concorrente ao envio); **Runtime:** produção, 2026-10-13 |
| Solicitação · **Cancelar solicitação** (Portal) | Rascunho ou correção solicitada; nenhum B/L já exportado | `PortalDesbloqueioCe.tsx` | `portalCeUnlockCommand('cancel')` | Pedido cancelado e itens inativos; motivo padrão "Cancelado pelo cliente" | Libera os B/Ls; o Portal recebe só a projeção do cliente | "Pedido não pode ser cancelado pelo cliente. Contate a agência." | **Teste:** `ceUnlock.local-pg.test.ts` (cancelamento pelo cliente) |
| Documentos anuais (Portal, só VIP) e ficha do Cliente · anexar termo e procuração anuais | CNPJ com condição VIP; PDF; mesmos limites de upload | `CeUnlockVipCoveragePanel.tsx` | `uploadCeUnlockDocument` (origem `vip_annual`) → `portal-ce-unlock-document` | `ce_unlock_documents` em análise; não revoga o anual vigente | `afterCeUnlockChanged` | "Cliente sem condição VIP" (`42501`); "Condição VIP revogada" | **Código:** `ce_unlock_prepare_upload` (`173`); matriz VIP incompleta (ver [plano](../archive/plans/2026-10-04-desbloqueio-ce-mercante.md)) |
| Portal · baixar o modelo do termo; Portal e Vela · abrir documento | Modelo: qualquer Cliente; documento: autorização atual (Portal só do próprio CNPJ; interno: qualquer Departamento, migration `250`) | `PortalDesbloqueioCe.tsx`, `CeUnlockDocuments.tsx` | `downloadCeUnlockDocument` → `ce-unlock-document-download` | Não escreve; `ce_unlock_document_access` e URL assinada por 60 s; o PDF abre na aba nova e só o modelo DOCX é baixado com o nome enviado (`ceSignedUrlDownload`) | — | Documento de outro CNPJ: `403` (`42501`); objeto alheio no Storage: 400 "Object not found" | **Runtime:** produção, 2026-10-13 (acesso cruzado recusado) |
| `/desbloqueio-ce` › Solicitações › pedido · **Aprovar** / **Recusar documento** | Gestão; pedido enviado, em análise, com correção solicitada ou concluído; versão mais recente do documento; recusa com motivo | `CeUnlockReviewQueue.tsx` → `CeUnlockRequestDetail.tsx` | `useCeUnlock` → `ceUnlockCommand('review')` | Decisão em todos os B/Ls abertos do pedido; status e motivo no documento; evento | Recusa: aviso no sino e linha em `ce_unlock_email_outbox` com o motivo; reavalia a conclusão; aprovar não recomeça o prazo | "Motivo obrigatório"; "Documento alterado; atualize a página" (`40001`); "Documento não pertence à análise atual" | **Teste:** `CeUnlockRequestDetail.test.tsx`, `ceUnlock.local-pg.test.ts`; **Runtime:** produção, 2026-10-13 (recusa com motivo) |
| Andamento dos B/Ls · caixa **B/L original** (**Registrar entrega** / **Desmarcar entrega**) | Gestão; B/L com CE, com ou sem pedido; desmarcar exige motivo | `DesbloqueioCe.tsx` | `useCeUnlock` → `ceUnlockCommand('delivery')` | `ce_unlock_bl_deliveries` com versão; evento; reavalia a conclusão do pedido ativo | Registrar recomeça o prazo; desmarcar tira o B/L dos aptos e reabre a conclusão | "Entrega alterada; atualize a página" (`40001`); "Motivo obrigatório" | **Teste:** `DesbloqueioCe.test.tsx`, `ceUnlock.local-pg.test.ts`; **Runtime:** produção, 2026-10-13 (entrega parcial) |
| Andamento dos B/Ls · seleção · **Registrar entrega de N B/Ls** | Gestão; B/Ls selecionados sem a entrega do original (os que já têm ficam de fora); confirmação lista os B/Ls | `DesbloqueioCe.tsx` | `ceUnlockCommand('delivery')` um B/L por vez, em sequência; depois `afterCeUnlockChanged` | O mesmo de registrar a entrega de um B/L | Prazo recomeça em cada B/L gravado | Não é atômico: a mensagem diz quantos gravaram e quais falharam (com o motivo), e os que falharam continuam selecionados | **Teste:** `DesbloqueioCe.test.tsx` |
| Andamento dos B/Ls · **Exportar planilha** | Leitura (`ce_unlock_read`) | `DesbloqueioCe.tsx` | `fetchAllCeUnlockBls` (todas as páginas do recorte, quatro por vez, sem repetir B/L) → `exportCeUnlockWorkbook` (`src/services/exports.ts`) | Não escreve | Baixa `desbloqueio-ce-<data>.xlsx` com B/L, CE, Cliente, CNPJ/CPF, Navio, Viagem, POD, Solicitação, Situação, requisitos, Prazo e Na ZPT | Falha de leitura em mensagem | **Código** |
| Pedido · **Versões anteriores** · **Abrir documento** | Gestão; pedido não VIP com termo ou procuração substituídos | `CeUnlockRequestDetail.tsx` (`CeUnlockDocumentList` sem ações de análise) | `downloadCeUnlockDocument` → `ce-unlock-document-download` | Não escreve | — | Cada versão mostra "Enviado em" com data e hora; versão já expurgada mostra "Arquivo removido pela regra de retenção" no lugar do botão (`purged`, migration `282`); reivindicada pelo expurgo e ainda não removida, "Arquivo em remoção pela regra de retenção" (`cleanup_pending`) | **Teste:** `CeUnlockRequestDetail.test.tsx`, `ceUnlock.local-pg.test.ts` |
| Pedido · **Reconferir CE** | Gestão; B/L com o motivo "CE alterado: reconferência necessária"; motivo ("Como o CE foi conferido") | `CeUnlockRequestDetail.tsx` | `ceUnlockCommand('reconfirm_ce')` | O item passa a usar o CE atual; aprovações de termo e procuração do item voltam a pendentes; o envio volta à fila (`export_id` fica) | Reavalia a conclusão | "B/L não pertence ao pedido"; "Motivo obrigatório" | **Código:** `ce_unlock_private.command` (`161`); matriz de CE corrigido incompleta (ver plano) |
| Pedido VIP · **Aplicar renovação VIP** | Gestão; pedido VIP aberto, fora de rascunho; CNPJ VIP com termo e procuração anuais vigentes | `CeUnlockRequestDetail.tsx` | `ceUnlockCommand('apply_vip')` | Itens pendentes passam a apontar os anuais vigentes; histórico preservado | Reavalia a conclusão | "Cobertura VIP indisponível"; "Cobertura anual incompleta" | **Código:** `161` |
| Pedido · **Cancelar pedido** (desk) | Gestão; pedido ativo e não concluído; nenhum B/L já exportado; motivo | `CeUnlockRequestDetail.tsx` | `ceUnlockCommand('cancel')` | Pedido cancelado e itens inativos; evento com o motivo | Libera os B/Ls para nova solicitação; o cliente vê o pedido cancelado | "Documentação validada: a solicitação não pode mais ser cancelada"; "Pedido com B/L já exportado para a ZPT: confirme o tratamento externo antes de cancelar" | **Código:** `161` |
| Andamento dos B/Ls · **Exportar N aptos para a ZPT** (**Exportar para a ZPT**) | Gestão; 1 a 100 B/Ls com os quatro requisitos | `DesbloqueioCe.tsx` (confirmação) | `downloadCeUnlockExport` → Edge Function `ce-unlock-export` → `ce_unlock_command('export')` | `ce_unlock_exports` (layout `zpt-5-v2`, linhas e snapshot); `exported_at`, `exported_by` e `export_id` por B/L; apaga o *Divergente* anterior desses B/Ls | Baixa o XLSX e registra o envio, que mede o cumprimento do prazo; aviso para importar na aba "Planilha desbloqueio" da ZPT | "B/L X não apto" com os motivos recusa o lote inteiro (inclui liquidação perdida durante a exportação; a exportação trava também as faturas avulsas dos B/Ls, migration `279`); "Seleção inválida" | **Teste:** `ceUnlockRules.test.ts` (layout), `ceUnlock.local-pg.test.ts` (reversão concorrente); **Runtime:** produção, 2026-10-13 (`zpt-5-v2`, 3 B/Ls); aceite pela ZPT não comprovado |
| **Planilhas enviadas à ZPT** · **Baixar lote** / **Reexportar** | Gestão | `DesbloqueioCe.tsx` | `listCeUnlockExports`; `downloadCeUnlockExport` com `export_id` ou `reexport_of` | Baixar não escreve (devolve o lote como foi gerado, inclusive `zpt-5-v1`); o lote guarda o hash SHA-256 do conteúdo e não aceita reescrita, só o registro do envio (migration `281`); Reexportar cria lote novo ligado ao anterior, com os requisitos atuais | Reexportar registra novo envio | "Lote não encontrado"; na reexportação, as mesmas recusas de Exportar | **Código:** `ce-unlock-export`; retry do mesmo lote sem teste (ver plano) |
| **Conciliar com a ZPT** · **Conciliar arquivo** | Gestão; arquivo "Exportar Tela" da ZPT (.xls, .xlsx ou .csv) de até 20.000 linhas | `CeUnlockZptImport.tsx` (confirmação com "Fora da conciliação") | `parseCeUnlockZptFile` e `reconcileCeUnlockZpt` (lotes de 5.000) → `ce_unlock_reconcile` | `ce_unlock_zpt_status` por B/L (*Desbloqueio conferido* ou *Divergente*); evento `reconcile`; sem recibo | Resumo: Desbloqueados, Divergentes, ZPT ainda sem atualização, Bloqueados não exportados, CE desconhecido; nada vai ao cliente nem muda o prazo | "Arquivo da ZPT vazio ou grande demais"; linhas e abas ocultas e linhas sem CE ou Status ficam de fora | **Teste:** `ceUnlockZptReconcile.test.ts`, `CeUnlockZptImport.test.tsx`, `ceUnlock.local-pg.test.ts`; arquivo real da ZPT não comprovado |
| **Modelo do termo de devolução** · **Publicar modelo** | Gestão; DOCX de até 10 MiB | `DesbloqueioCe.tsx` (`CeUnlockDocumentUploader` com origem `model`) | `uploadCeUnlockDocument` → `portal-ce-unlock-document` | `ce_unlock_documents` (`model`) e objeto `.docx` no bucket; o mais recente aprovado é o vigente | Disponível no Portal de todos os clientes; rascunhos novos guardam o modelo vigente | "Use o modelo em DOCX de até 10 MiB"; assinatura ZIP ou tipo inválidos recusados | **Remoto:** modelo cadastrado em produção em 2026-10-10 (ver plano) |
| Andamento dos B/Ls e pedido · consultar (Financeiro, Operações e Equipamentos) | `ce_unlock_read` sem `ce_unlock_manage` | `DesbloqueioCe.tsx` | `useCeUnlock`, `ceUnlockRead` | Não escreve | — | Ações de gestão indisponíveis na tela e recusadas no banco; documentos abertos a todos (migration `250`) | **Teste:** `DesbloqueioCe.test.tsx` (ações restritas) |
| Ficha do Cliente › Desbloqueio de CE / VIP · **Habilitar condição VIP** / **Revogar condição VIP** | Gestão; motivo | `CeUnlockVipCoveragePanel.tsx` | `ceUnlockCommand('set_vip')` | `ce_unlock_vip_customers` com versão; evento | Os próximos pedidos usam (ou deixam de usar) os anuais | "Motivo obrigatório"; "Condição VIP alterada" (`40001`) | **Código:** `161` |
| Ficha do Cliente › documentos anuais · **Aprovar** / **Solicitar correção** / **Revogar aprovação** | Gestão; aprovação informa início e ano, com fim em 31/12 do ano; correção e revogação com motivo | `CeUnlockVipCoveragePanel.tsx` | `ceUnlockCommand('review')` | `ce_unlock_documents`: status, `coverage_year`, `valid_from`, `valid_until`; evento | Aprovação cobre os pedidos VIP do CNPJ na vigência; revogação pode tirar o requisito de pedidos não concluídos | "Validade anual deve terminar em 31/12 do ano informado"; "Motivo obrigatório" | **Teste:** limites 31/12–01/01 e ano inválido em `ceUnlockRules.test.ts` |

## Estado e dados

### Tabelas e migrations

Migrations `139`–`149`, `160`, `161`, `173`, `220`, `279` (requisito de
pagamento), `280` (retenção), `281` (lote com hash e imutável) e `282` (documento
expurgado na projeção); a `177` redefine `ce_unlock_reconcile` (chave
do CE) e a `181`/`195`/`230`/`277` o alerta `ce_trocado_com_desbloqueio`. Tabelas `ce_unlock_*` (`ce_unlock_requests`,
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
impedem aptidão. B/L com Taxas Locais isentas (`charge_status = 'exempt'`) e
sem recebível vigente não tem o requisito de pagamento: fica apto com termo,
procuração e entrega, e a planilha ZPT sai "Sim" no pagamento; o Portal mostra "Isento" no lugar de "Pagas" (`paid_exempt`). Fatura avulsa
emitida para o B/L e o Cliente atual (`issued`/`partially_paid` com saldo)
bloqueia com o motivo "Fatura avulsa do B/L em aberto"; rascunho, cancelada e
paga não bloqueiam. Demurrage não faz parte do requisito
([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md), itens 2 e 3;
migration `279`; **Teste:** `ceUnlock.local-pg.test.ts`). Correções para menor
reduzem o valor exigível: a liquidação cobre o valor original menos a correção,
com saldo zero e evidência real no ledger. Fatura consolidada parcialmente paga
libera só o B/L cujo recebível foi liquidado, nunca pelo status da fatura.

No Portal, B/L com Taxas Locais não pagas e sem fatura visível ao Cliente
(emitida, não cancelada nem obsoleta, individual ou consolidada) aparece com
"Taxas locais aguardando fatura", sem valor nem situação de pagamento
(`local_charges_awaiting_invoice` em `ce_unlock_private.portal_view`, migration
`298`; desde a `301`, só pelo motivo de Taxas Locais, não por avulsa em aberto; [ADR 0088](../adr/0088-portal-so-mostra-fatura-emitida.md)). A aptidão
interna não muda: o requisito continua pelo razão.

### B/L que muda de solicitação

Desde a migration `299` ([ADR 0089](../adr/0089-desbloqueio-ce-bl-muda-de-solicitacao.md)),
B/L ativo em solicitação ainda não validada (rascunho, enviada, em análise ou
correção pedida) do mesmo Cliente e ainda não enviado à ZPT pode ser pedido de
novo (`item.can_submit`). Ao criar o rascunho novo (`command('draft')`), o B/L
sai da antiga (`active = false`) com o evento `bl_moved` ("B/L passou para a
solicitação CE-…") e deixa de aparecer nos B/Ls dela, também depois que ela
é cancelada, e de pesar no reenvio dela (migration `301`); a antiga que fica sem B/L
é cancelada com o evento `cancel` ("Todos os B/Ls passaram para a solicitação
CE-…"), e a que mantém outros B/Ls continua com eles, com a versão e a
conclusão recalculadas. Documentos não passam para a nova: termo e procuração
são enviados de novo (o VIP usa os anuais). O Portal mostra antes a
confirmação "Mudar N B/Ls e continuar" com o destino de cada solicitação
antiga, contado pelos B/Ls ativos dela (`bl_ids` de todas as solicitações,
inclusive B/L que o Portal deixou de listar). O comando trava primeiro as solicitações de origem, na ordem dos demais
comandos (pedido antes do Cliente e do B/L); se uma delas mudou entre a leitura
e a criação, recusa com "Solicitação alterada; atualize a página." (`40001`).
B/L de "Documentação validada", de outro Cliente ou já exportado continua
bloqueado, e a trava `ce_unlock_one_active_bl` continua: um B/L, uma
solicitação ativa. **Teste:** `ceUnlockMatriz.local-pg.test.ts`.

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
(reenvio, entrega do original, nova liquidação ou pagamento da avulsa do B/L e do
Cliente atual); aprovar documento não recomeça.
Calculado na tela (`ceUnlockSla.ts`) e no banco (`ce_unlock_private.sla_deadline`,
usado no texto do aviso); o teste SQL confere os dois com os mesmos casos. O
cumprimento é medido pela data da exportação.

### Avisos ao cliente

Recusa de documento (com o motivo) e documentação validada (com o
prazo) geram um aviso no sino do Portal e uma linha na fila `ce_unlock_email_outbox`; a
Edge Function `ce-unlock-notify-email` envia aos contatos da caixa **Documentação e
Operação** e registra cada tentativa em `portal_email_attempts`
(`ce_unlock_notificacao`). Nenhum texto cita ZPT ou desbloqueio confirmado. O Portal mostra
só a data do prazo (nunca "vencido"), e seu histórico omite exportação, entrega e VIP.

Como cada aviso termina na fila (migration `307`):

| Estado | Quando |
| --- | --- |
| `sent` | Todos os contatos da caixa receberam |
| `partial` | Parte recebeu e o restante está na supressão do Portal (bounce ou reclamação); não volta a ser tentado |
| `simulated` | Chave **Canal de envio real** desligada: os destinatários são resolvidos e o envio é registrado como simulado, sem chamar o provedor. O aviso **não** é enviado depois, quando a chave for ligada (D11 do [plano dos e-mails](../plans/2026-10-17-correcao-dos-emails.md)) |
| `skipped` | Nenhum destinatário: sem contato na caixa ou todos suprimidos |
| `pending` | Falha de envio ou erro na linha; a próxima rodada tenta de novo, sem reenviar a quem já recebeu |
| `failed` | Cinco tentativas sem sucesso |

Regras da rodada:

- Erro ao ler a chave de envio responde 500 e não consome a fila.
- Com a chave ligada, sem chave do provedor, remetente ou reply-to, responde 503 e não consome a
  fila. Com a chave desligada, simula mesmo sem essa configuração.
- Um erro numa linha conta a tentativa dela e a rodada segue para a próxima.
- `skipped` e `failed` abrem o alerta **Aviso do Desbloqueio de CE não enviado**
  (`desbloqueio_ce_aviso_nao_enviado`, Administrativo, um por Cliente). Ele fecha sozinho quando
  um aviso seguinte do mesmo Cliente termina `sent`, `partial` ou `simulated`.
- A resposta traz `{ sent, partialSuppressed, simulated, skipped, retry, failed }`; `failed > 0` deixa o
  heartbeat `BETTERSTACK_HEARTBEAT_CE_UNLOCK_NOTIFY_URL` vermelho. Exceções e respostas 5xx vão
  ao Sentry.

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
`ce_trocado_com_desbloqueio`, e a prévia da planilha avisa "Desbloqueio já
conferido". Conferido é a conciliação com a ZPT `unlocked` do CE anterior
(`ce_unlock_zpt_status`, pela chave `ce_mercante_key`) ou a confirmação manual
legada do mesmo CE (`_bl_ce_unlock_conferred`, migration `230`; antes dela o
código só lia a confirmação manual retirada na `160`). Desde a migration `277`,
a confirmação legada também só vale para o CE que confirmou: depois de uma
troca, a troca seguinte do CE que nunca foi desbloqueado não abre o alerta. As
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
uploads/24h e 100 MiB ativos por cliente. Abrir ou baixar exige autorização atual e
URL assinada por 60 s; PDF abre na aba nova, o modelo DOCX é baixado.

O expurgo reivindica/fixa os registros no banco antes de apagar objetos;
rascunho expirado é cancelado sob lock, e falha física permite retry.
O modelo atual e anuais vigentes não são expurgados por mera idade.

Expurgo usa Storage API, preservando metadados e histórico
([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md), item 5;
**Código:** `ce_unlock_cleanup_candidates`, migration `280`; **Teste:**
`ceUnlock.local-pg.test.ts`):

- upload abandonado após 1 dia e rascunho após 7 dias;
- anexos de solicitação 30 dias após o encerramento (concluída ou cancelada,
  pelo último evento `complete` ou `cancel`; concluída só com todos os B/Ls
  exportados); solicitação em andamento mantém
  os PDFs (decisão de 2026-10-15, nota na ADR 0087);
- Termo Anual VIP só quando, além de fora da vigência, há documento anual
  aprovado mais novo do mesmo Cliente e tipo; renovação em análise não substitui;
- modelos anteriores ao vigente após 5 anos.

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
os handlers de upload e de expurgo são exercitados em Deno por `supabase/functions/portal-ce-unlock-document/index.test.ts`
e `supabase/functions/ce-unlock-cleanup/index.test.ts` (falha física no Storage não registra o
expurgo e a rodada seguinte remove);
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
  reconciliação" do [plano](../archive/plans/2026-10-04-desbloqueio-ce-mercante.md).
- O alerta de troca de CE com Desbloqueio conferido tem dois testes em
  `src/integration/ceImportacaoContrato.local-pg.test.ts`: K2, pela confirmação
  manual legada, e B1, pela conciliação ZPT `unlocked` do fluxo vigente
  (alerta na ficha, aviso na prévia; conciliação divergente não alerta).

**Não comprovado:** aceite da planilha `zpt-5-v2` pela aba "Planilha desbloqueio" da ZPT
(sem modelo oficial de importação; o primeiro upload real é o teste), entrega real dos avisos por e-mail (em produção os Comunicados estavam
desligados e, até a migration `307`, a linha ficava `skipped` sem lista de destinatários) e a falha física no Storage seguida de nova
tentativa no expurgo. A migration `220` está em produção desde 2026-10-13. O expurgo removeu
em produção, na rodada de 2026-10-15, um PDF real de 145.648 bytes enviado pelo Portal num
rascunho de teste tornado elegível: rascunho cancelado, documento com `purged_at`, objeto
fora do bucket e `ObjectRemoved:Delete` no log do Storage (detalhes nas "Fontes" do
[plano](../archive/plans/2026-10-04-desbloqueio-ce-mercante.md)).

Evidência da execução original e limitações estão no
[relatório local](../archive/reports/2026-10-04-desbloqueio-ce-implementacao.md); a revisão de
2026-10-07 segue [spec](../archive/specs/2026-10-07-desbloqueio-ce-revisao-fluxo-design.md) e
[plano](../archive/plans/2026-10-07-desbloqueio-ce-revisao-fluxo.md).

## Notas e divergências

- A fila calcula os requisitos dos candidatos antes de paginar; custo O(n),
  indicado como `ponytail` no serviço. Avaliar read model indexado com aumento
  do volume operacional.
- A varredura `ce_unlock_refresh_open()` é O(solicitações abertas); o upgrade
  previsto é uma fila por trigger ([Conclusão](#conclusão)).
- Confirmações externas registradas antes da revisão de 2026-10-07 aparecem no
  pedido como "Confirmações externas (histórico anterior)"; nenhuma ação atual
  as cria.
