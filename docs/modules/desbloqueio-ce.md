# Desbloqueio de CE Mercante

> **Status:** publicado em produção (backend e Cloudflare Pages); compatibilidade frontend/backend conferida em 2026-10-13 e fluxo com dois Clientes observado em produção até a exportação no mesmo dia; planilha `zpt-5-v2` homologada com a ZPT em 2026-10-14 (declaração do responsável), com a conciliação por arquivo real dispensada pelo responsável em 2026-10-15; aceite operacional e jurídico em 2026-10-14 ([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md)), implementado nas migrations `279`–`282` (PR 956, em produção após o merge); alerta de troca de CE com Desbloqueio conferido corrigido nas migrations `230` e `277` (PR 954); expurgo de um PDF real comprovado em produção em 2026-10-15; mudanças da PR 956 conferidas e observadas em produção em 2026-10-15, com os ajustes da PR 961; [plano](../archive/plans/2026-10-04-desbloqueio-ce-mercante.md) arquivado; B/L que muda de solicitação (migration `299`, [ADR 0089](../adr/0089-desbloqueio-ce-bl-muda-de-solicitacao.md)) e "Taxas locais aguardando fatura" (migration `298`) ainda não aplicados no Supabase remoto; Cliente VIP sem solicitação (migration `581`, [ADR 0119](../adr/0119-vip-desbloqueia-sem-solicitacao.md)) testado só em banco local, não aplicado no Supabase remoto · **Atualizado:** 2026-11-03 · **Rotas:** `/desbloqueio-ce`, `/portal/desbloqueio-ce`, `/clientes/portal/inspecao/:customerId/desbloqueio-ce`

## Propósito e escopo

A ZPT desbloqueia o CE Mercante sozinha quando as quatro colunas de uma carga
estão marcadas. O Vela substitui o controle manual dessas colunas: o cliente
solicita no Portal, o desk valida documentos e marca a entrega, e a planilha
exportada do Vela alimenta a ZPT. O sistema não chama API da ZPT.
Um pedido pode conter até 100 B/Ls do mesmo CNPJ. Termo de devolução e procuração
são comuns por pedido ou anuais de cliente VIP; a entrega física é registrada pelo desk.
O veículo LCL com Taxas Locais isentas não tem pedido: só a entrega do B/L original. O
Cliente VIP com os dois anuais cobrindo o B/L também não: pagas as Taxas Locais e entregue o
original, o B/L fica apto ([B/L dispensado de solicitação](#bl-dispensado-de-solicitação-veículo-lcl-isento-e-vip)).
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
  termo e procuração "Coberto(a) pelo … anual até 31/12/AAAA" ou "Falta …" em âmbar ("Até lá, … anexado(a)
  à solicitação"), com "Abrir Documentos anuais" quando falta. **VIP com anual faltando, vencido, recusado
  ou revogado pede mesmo assim** (ponto 13 das observações de 2026-10-23): a faixa avisa que "os
  documentos anuais não cobrem esta seleção", a solicitação nasce comum (migration `449`), o modelo do
  termo volta a aparecer, e o detalhe explica "Sua condição VIP não cobre esta solicitação: <o que falta,
  ou B/L com o desbloqueio solicitado fora da vigência>" (só enquanto a solicitação está em andamento) e aceita o termo e a
  procuração comuns. Com só um dos anuais válido, a faixa "O que o desbloqueio pede" diz que os dois vão
  anexados ("Termo anual válido… Enquanto falta a procuração anual, …"), porque o pedido é inteiro VIP ou
  inteiro comum. Com os dois anuais vigentes (ou algum B/L com `vip_direct`), o bloco traz a nota
  "Pela condição VIP, você não precisa pedir o desbloqueio." com a regra: Taxas Locais pagas e B/L
  original entregue bastam, o aviso de documentação validada vem por B/L, e só o B/L que os anuais não
  cobrem precisa de solicitação (migration `581`, [ADR 0119](../adr/0119-vip-desbloqueia-sem-solicitacao.md)).
  Logo abaixo, o bloco próprio **Prazo para desbloqueio** diz as
  janelas da regra de [Prazo (SLA)](#prazo-sla) (reunião de testes de 2026-10-26; até 2026-11-02 era uma
  linha dentro de "O que o desbloqueio pede", que ficou com texto demais); para o VIP, acrescenta que, sem
  solicitação, o prazo conta B/L a B/L, da documentação validada. O VIP com os anuais
  cobrindo os B/Ls continua sem anexo avulso (`ce_unlock_prepare_upload` recusa "Pedido não aceita
  anexos"); Cliente sem VIP vê "Assinado, em PDF, anexado à solicitação" e
  "Em PDF, anexada à solicitação", com **Baixar modelo do termo** quando há modelo publicado, e
  nenhuma menção a documento anual. Em "B/L original · Entregue na agência", a palavra **agência**
  é um link que abre o modal "Onde entregar o B/L original", com os endereços das agências que
  recebem o original em Vitória, Salvador e Suape (ponto 6 das observações de 2026-10-23):
  contatos da Central de Informações (migration `447`), preenchidos com Transhipping, Marinav e
  Transglobal (migration `464`) e editados no Vela em Clientes → Portal → **Informações do Portal**
  (`/clientes/informacoes`) → Contato; sem endereço informado, "Endereço a definir". Na faixa,
  **Baixar memorando de liberação**
  (`public/templates/memorando-liberacao-documentos-modelo.docx`), formulário para retirar documentos
  na agência; não é requisito nem entra no pedido. Cartões que filtram ("Podem ser pedidos", "Com
  taxas locais em aberto", "Já em solicitação" e, para o VIP ou com B/L dispensado, "Não precisam de
  solicitação") e tabela limpa: B/L, CE Mercante, Navio / Viagem, POD,
  Taxas locais ("✓ Pagas", "Em aberto" em âmbar, que é o próprio link, em texto, sem borda nem ícone (desde 2026-11-02; antes, ícone "Ver faturas em aberto" ao lado) e abre Faturas filtrada no B/L e no status Emitida (`?tab=local&status=issued&bl=`, desde 2026-11-01), "Aguardando fatura" sem valor,
  "Isentas") e Solicitação (protocolo e situação; no veículo LCL isento, "Não precisa · entregue o B/L
  original" e, com a entrega registrada e o prazo dado, "B/L original entregue. Prazo para desbloqueio
  até dd/mm, HH:MM. Consulte o SISCARGA." (pedido do dono de 2026-11-04; antes, a frase da entrega
  pendente ficava mesmo com o B/L entregue), sem caixa de seleção, e uma linha sob "O que o desbloqueio
  pede" explica a regra; no VIP coberto, "Não precisa (VIP) · " com o que falta ("Falta pagar as taxas
  locais e entregar o B/L original" em âmbar) e, pago e entregue, "Pagamento e entrega confirmados.
  Consulte o SISCARGA." ou "Documentação validada. Prazo para desbloqueio até dd/mm, HH:MM. Consulte o
  SISCARGA." (decisões do dono de 2026-11-04; antes, "Não precisa (VIP) · Validação em até 5 minutos" e,
  por algumas horas, "Apto ao desbloqueio (VIP) · … · consulte o SISCARGA para verificar o desbloqueio"),
  também sem caixa de seleção,
  [B/L dispensado de solicitação](#bl-dispensado-de-solicitação-veículo-lcl-isento-e-vip)). Além de "Buscar B/L ou CE", a barra **Filtros**
  (recolhida, como no resto do Portal) filtra por Navio e Viagem por texto contido, e os cartões contam esse recorte
  (pedido do dono de 2026-11-02). A faixa "Pedir desbloqueio de N B/Ls" cria o
  rascunho sem confirmação, pois o cliente pode cancelá-lo; com B/L de outra solicitação ainda não
  validada, antes mostra a confirmação "Mudar N B/Ls e continuar" (B/L, Sai de, O que acontece com a
  antiga; ver [B/L que muda de solicitação](#bl-que-muda-de-solicitação)).
  **Minhas solicitações:** Protocolo (abre o detalhe), Aberta em, B/Ls (primeiro e "+N"), Documentos,
  Prazo para desbloqueio (de `sla_started_at`, só com os quatro requisitos em todos os B/Ls; antes, "—") e Situação em texto ("Correção pedida · reenvie …" e
  "Rascunho · falta enviar" em âmbar; cancelada em cinza). Na correção pedida, a Situação traz embaixo
  "Motivo (termo de devolução): …" e "Motivo (procuração): …" com o texto inteiro que o operador
  escreveu, com as quebras de linha (ponto 5 das observações de 2026-10-23; antes o Portal cortava o
  motivo em 40 letras e o resto só aparecia ao passar o mouse). O **detalhe** (janela) tem os blocos
  Solicitação (situação e próximo passo, B/Ls, prazo e, enquanto não há prazo, quando ele começa), Documentos em tabela
  ("Enviar nova versão" só onde há correção pedida, por botão; a Situação "Correção pedida" leva o
  motivo inteiro logo abaixo, sem corte), B/Ls da solicitação, Histórico
  fechado em tabela e a faixa de reenvio no pé; "Cancelar solicitação" no topo, enquanto o pedido
  está em rascunho ou com correção solicitada. Com tudo atendido, "Documentação validada… consulte o
  Mercante". Não mostra envio, ZPT nem desbloqueio (**Código:** `src/pages/PortalDesbloqueioCe.tsx`).
  Modo Inspeção (`/clientes/portal/inspecao/:customerId/desbloqueio-ce`)
  é somente leitura (aviso global da inspeção) e mostra a todos os setores os documentos da
  solicitação e os anuais, com datas e motivos, como no Vela (migration `479`; ADR 0085, D16).
- Vela (`/desbloqueio-ce`), aba **Solicitações** (com a contagem): bloco "Solicitações aguardando
  análise", uma linha por pedido a validar (protocolo, que abre o detalhe; Cliente, que leva à ficha;
  primeiro B/L e "+n"; termo de devolução e procuração em texto, âmbar quando aguardam análise,
  recusados ou revogados; situação; **Enviada em**, a hora do último envio, que ordena a fila: documento
  ainda a analisar não dá prazo, migration `448`). O botão **Modelo do termo de devolução** (DOCX oficial,
  sem texto jurídico gerado; o cliente baixa, preenche, assina e anexa em PDF) fica no cabeçalho do
  bloco. Cada documento é aprovado ou recusado para o pedido inteiro; recusa exige motivo. Pedidos VIP
  não passam por aqui.
- Vela, aba **Andamento dos B/Ls** (até 2026-10-16 "Controle ZPT"; `?aba=controle` continua):
  cartões que filtram por situação (Aptos não exportados, Exportados aguardando a ZPT, Divergentes na
  ZPT, Desbloqueados e B/Ls com CE; situações `exported` e `unlocked` da migration `296`; o B/L de
  confirmação externa antiga, `export_state` `confirmed` sem retorno da ZPT, só entra em "B/Ls com
  CE"); Busca, Situação, Viagem e POD abertos (Busca e POD consultam depois da pausa na digitação;
  a Busca acha o B/L ou CE colado com espaço nas pontas ou no meio, `ce_unlock_private.search_compact`,
  e a lista colada separa também por "&", migration `577`), Requisito pendente, Requisito atendido
  (o inverso, `met_requirement`) e VIP (Clientes VIP, Solicitações VIP, Clientes sem VIP; `vip`)
  em "Mais filtros" (os dois últimos desde a `577`, pedido do dono de 2026-11-03). O botão do relógio
  no fim de cada linha abre **Histórico do B/L** (todos os setores; ver
  [Histórico do B/L](#histórico-do-bl)). Uma linha por B/L com CE, com
  ou sem pedido (lista vazia: "Todo B/L com CE aparece aqui, com ou sem solicitação."): B/L, CE Mercante, Cliente (marca "VIP"), Solicitação, Termo de devolução,
  Procuração e Taxas locais como ícones somente leitura (verde = atendido; no veículo LCL isento, termo
  e procuração verdes com "dispensado (veículo LCL isento)" no texto; no B/L sem solicitação de Cliente
  VIP com os dois anuais cobrindo hoje, termo e procuração verdes com "coberto pelo anual VIP", e a
  planilha comum diz "Coberto pelo anual VIP" (migration `576`, pedido do dono de 2026-11-03) e a Solicitação "Dispensada ·
  veículo LCL" ou, no VIP coberto que segue sem solicitação, "Dispensada · VIP" (migration `581`), também na planilha comum); **B/L original** é a única
  caixa clicável (confirmação ao marcar, motivo ao desmarcar), inclusive antes de existir pedido.
  Prazo numa célula ("Hoje, HH:MM" em âmbar; "Venceu …" em vermelho) e **Na ZPT** só com o estado da
  ZPT (Não exportado, Exportado dd/mm, Desbloqueado, Divergente com a descrição ao passar o mouse) ou
  o impedimento que não é requisito (CE alterado, B/L cancelado, troca de Cliente, Cliente alterado).
  Navio, viagem e POD ficam no filtro e na planilha. Qualquer B/L pode ser selecionado; a faixa diz
  quantos são aptos e quantos estão sem a entrega do original, com **Registrar entrega de N B/Ls**;
  a entrega registrada ou desmarcada na linha renova os dados guardados do B/L selecionado. O
  checkbox do cabeçalho da tabela marca todos os B/Ls do filtro, em todas as páginas
  (`fetchAllCeUnlockBls`), e trocar o filtro zera a seleção; no Portal, marca os B/Ls disponíveis
  do filtro inteiro e a seleção do pedido continua entre buscas (revisão de 2026-10-22; regra em
  [Regras de negócio § Seleção em massa](../operations/regras-de-negocio.md#seleção-em-massa)).
  No cabeçalho do bloco: **Exportar planilha** (planilha comum do recorte inteiro, separada da
  planilha da ZPT), **Planilhas enviadas à ZPT** (baixar e reexportar lotes), **Conciliar com a ZPT**
  (importa o "Exportar Tela") e **Exportar N aptos para a ZPT** (só os aptos selecionados, até 100).
- Detalhe da solicitação (janela): blocos Solicitação ("aberta em" pelo primeiro rascunho ou envio; situação e o que falta, Cliente, B/Ls, prazo (só com os quatro requisitos em todos os B/Ls; corre até a exportação de todos eles, inclusive na concluída; nunca na cancelada),
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
  Vigência | Situação, com a versão anterior recusada ou revogada em cinza; a Situação da versão atual
  recusada ou revogada traz o motivo inteiro, com as quebras de linha (a anterior, em cinza, só ao passar o
  mouse). No Portal, o
  envio é pelos botões "Enviar termo de devolução" e "Enviar procuração"; no Vela,
  **Analisar** só onde há decisão abre "Analisar <documento>" (Ano da cobertura,
  Início da vigência, Fim 31/12) com Aprovar / Solicitar correção / Voltar. A tela propõe o
  ano corrente e, como início, o mais tarde entre o dia do envio e 01/01 do ano escolhido
  (recalculado quando o ano muda; `proposedVipStart` em `ceUnlockRules.ts`): o anual enviado
  em dezembro e analisado em janeiro começa em 01/01 do ano novo, como exige a restrição
  `ce_unlock_vip_start_year` (migration `141`). Início digitado fora do ano da cobertura
  mostra "O início da vigência precisa estar em AAAA, o ano da cobertura." e desliga Aprovar
  (`vipStartError`; decisão do dono de 2026-11-03), e
  **Revogar aprovação** fica no menu ⋮ do aprovado. O bloco Solicitações de desbloqueio da ficha
  lista todas as solicitações do Cliente, comuns e VIP (protocolo com "· VIP"), sem o B/L que
  passou para outra solicitação (migration `479`). Ficha de Cliente sem VIP mostra os blocos
  Solicitações de desbloqueio e Condição VIP, sem Documentos anuais
  ([Clientes](clientes.md#clientescnpj)).

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
| `/portal/desbloqueio-ce` › Nova solicitação · **Pedir desbloqueio de N B/Ls** | Sessão do Portal do próprio CNPJ, fora da Inspeção; 1 a 100 B/Ls do Cliente, liberados no Portal, com CE, taxas pagas e sem pedido ativo; nunca o veículo LCL isento (migration `575`) nem o B/L do VIP coberto pelos dois anuais (migration `581`) | `PortalDesbloqueioCe.tsx` | `usePortalCeUnlock` → `portalCeUnlockCommand('draft')` | `portal_ce_unlock_command`: `ce_unlock_requests` (rascunho, origem pedido ou VIP, modelo vigente) e `ce_unlock_request_bls` com o CE do pedido; recibo idempotente | Sem confirmação (o rascunho pode ser cancelado); `afterCeUnlockChanged` | "Selecione de 1 a 100 B/Ls"; B/L de outro Cliente recusado (`42501`); B/L inapto recusado com os motivos; veículo LCL isento recusado com "B/L … não precisa de solicitação: veículo LCL com Taxas Locais isentas é desbloqueado só com a entrega do B/L original na agência."; VIP coberto recusado com "B/L … não precisa de solicitação: pela condição VIP, o termo de devolução e a procuração anuais cobrem este B/L, e o desbloqueio segue com as Taxas Locais pagas e o B/L original entregue na agência." | **Teste:** `PortalDesbloqueioCe.test.tsx`, `ceUnlock.local-pg.test.ts`, `ceUnlockVip.local-pg.test.ts`; **Runtime:** produção, 2026-10-13 |
| Solicitação (janela) · na linha do documento, **Anexar PDF**, **Trocar arquivo** (rascunho ou arquivo escolhido) ou **Enviar nova versão** (correção pedida) do termo de devolução e da procuração | Pedido em rascunho ou com correção solicitada; PDF de até 10 MiB; limite diário e cota do Cliente. Anexar só escolhe o arquivo: ele sobe ao clicar em **Solicitar desbloqueio** / **Reenviar solicitação**, sem botão de envio por documento | `PortalDesbloqueioCe.tsx` (`RequestDocuments`, anexo adiado, com o `CeUnlockFileButton` de `CeUnlockDocuments.tsx`) | `uploadCeUnlockDocument` → Edge Function `portal-ce-unlock-document` | `ce_unlock_prepare_upload` reserva; objeto no bucket `ce-unlock-documents`; `ce_unlock_finish_upload` registra nova versão, sem sobrescrever | `afterCeUnlockChanged`; a versão recusada fica preservada | "O arquivo não é um PDF…" com orientação de salvar como PDF (HTTP 422) e "O arquivo passa de 10 MiB"; "Limite de 20 uploads por 24 horas"; cota de 100 MiB; "Pedido não aceita anexos" | **Teste:** `portal-ce-unlock-document/index.test.ts` (Deno), `ceUnlockDocuments.test.ts`; **Runtime:** produção, 2026-10-13 |
| Solicitação · **Solicitar desbloqueio** / **Reenviar solicitação** | Rascunho ou correção solicitada; termo e procuração atuais anexados (VIP: anuais aprovados que cubram cada B/L pela data da solicitação, migrations `479` e `487`, [ADR 0110](../adr/0110-vip-cobre-pela-data-da-solicitacao.md)); cada B/L pago, do Cliente, não cancelado e com o mesmo CE do pedido | `PortalDesbloqueioCe.tsx` (confirmação) | Depois de confirmar: `uploadCeUnlockDocument` dos anexos escolhidos (termo, depois procuração), releitura do pedido e `portalCeUnlockCommand('submit')` com a versão nova | Pedido enviado; itens ligados às versões atuais dos documentos (versão nova zera a aprovação daquele documento); evento `submit`; reavalia a conclusão | Enviar não dá prazo: ele só começa com os quatro requisitos (migration `448`); `afterCeUnlockChanged` | "Anexe versões atuais de termo de devolução e procuração"; "Regularize os documentos anuais VIP"; "Condição VIP revogada"; "B/L X perdeu elegibilidade" recusa o envio inteiro; versão desatualizada (`40001`); rascunho com B/L do VIP coberto (inclusive o rascunho VIP aberto antes da `581`) recusado com a explicação e "Cancele este rascunho e peça os demais B/Ls em outro." | **Teste:** `ceUnlock.local-pg.test.ts` (inclui baixa cancelada concorrente ao envio), `ceUnlockVip.local-pg.test.ts`; **Runtime:** produção, 2026-10-13 |
| Solicitação · **Cancelar solicitação** (Portal) | Rascunho ou correção solicitada; nenhum B/L já exportado | `PortalDesbloqueioCe.tsx` | `portalCeUnlockCommand('cancel')` | Pedido cancelado e itens inativos; motivo padrão "Cancelado pelo cliente" | Libera os B/Ls; o Portal recebe só a projeção do cliente | "Pedido não pode ser cancelado pelo cliente. Contate a agência." | **Teste:** `ceUnlock.local-pg.test.ts` (cancelamento pelo cliente) |
| Documentos anuais (Portal, só VIP) e ficha do Cliente · anexar termo e procuração anuais | CNPJ com condição VIP; PDF; mesmos limites de upload | `CeUnlockVipCoveragePanel.tsx` | `uploadCeUnlockDocument` (origem `vip_annual`) → `portal-ce-unlock-document` | `ce_unlock_documents` em análise; não revoga o anual vigente | `afterCeUnlockChanged` | "Cliente sem condição VIP" (`42501`); "Condição VIP revogada" | **Código:** `ce_unlock_prepare_upload` (`173`); matriz VIP incompleta (ver [plano](../archive/plans/2026-10-04-desbloqueio-ce-mercante.md)) |
| Portal · baixar o modelo do termo; Portal e Vela · abrir documento | Modelo: qualquer Cliente; documento: autorização atual (Portal só do próprio CNPJ; interno: qualquer Departamento, migration `250`) | `PortalDesbloqueioCe.tsx`, `CeUnlockDocuments.tsx` | `downloadCeUnlockDocument` → `ce-unlock-document-download` | Não escreve; `ce_unlock_document_access` e URL assinada por 60 s; o PDF abre na aba nova e só o modelo DOCX é baixado com o nome enviado (`ceSignedUrlDownload`) | — | Documento de outro CNPJ: `403` (`42501`); objeto alheio no Storage: 400 "Object not found" | **Runtime:** produção, 2026-10-13 (acesso cruzado recusado) |
| `/desbloqueio-ce` › Solicitações › pedido · **Aprovar** / **Recusar documento** | Gestão; pedido enviado, em análise, com correção solicitada ou concluído; versão mais recente do documento; recusa com motivo | `CeUnlockReviewQueue.tsx` → `CeUnlockRequestDetail.tsx` | `useCeUnlock` → `ceUnlockCommand('review')` | Decisão em todos os B/Ls abertos do pedido; status e motivo no documento; evento | Recusa: aviso no sino e linha em `ce_unlock_email_outbox` com o motivo (a confirmação diz "O cliente recebe o motivo no Portal e por e-mail"; com a chave de envio desligada o e-mail vai ao suporte, estado `simulated`, decisão do dono de 2026-10-27, `08-desbloqueio-ce:11`); reavalia a conclusão; a aprovação que completa os quatro requisitos inicia o prazo | "Motivo obrigatório"; "Documento alterado; atualize a página" (`40001`); "Documento não pertence à análise atual" | **Teste:** `CeUnlockRequestDetail.test.tsx`, `ceUnlock.local-pg.test.ts`; **Runtime:** produção, 2026-10-13 (recusa com motivo) |
| Andamento dos B/Ls · **Histórico do B/L** (relógio no fim da linha) | Todos os setores com `ce_unlock_read`; qualquer B/L com CE, com ou sem solicitação | `DesbloqueioCe.tsx`, `CeUnlockBlHistory.tsx` | `useCeUnlockBlHistory` → `ceUnlockRead('bl_history')` | Só leitura: `ce_unlock_private.bl_history` (migration `577`) | Nenhum | "Falha ao consultar o histórico do B/L."; sem registro, "Nenhum registro de requisito para este B/L ainda." | **Teste:** `DesbloqueioCe.test.tsx`, `ceUnlockVip.local-pg.test.ts` |
| Andamento dos B/Ls · caixa **B/L original** (**Registrar entrega** / **Desmarcar entrega**) | Gestão; B/L com CE, com ou sem pedido; desmarcar exige motivo | `DesbloqueioCe.tsx` | `useCeUnlock` → `ceUnlockCommand('delivery')` | `ce_unlock_bl_deliveries` com versão; evento; reavalia a conclusão do pedido ativo; no B/L VIP sem solicitação que fica apto, grava a validação e o aviso ao Cliente (`validate_direct`, migration `581`) | Registrar, se completa os quatro requisitos, inicia o prazo; desmarcar tira o prazo (se o B/L ainda não foi exportado), tira o B/L dos aptos e reabre a conclusão | "Entrega alterada; atualize a página" (`40001`); "Motivo obrigatório" | **Teste:** `DesbloqueioCe.test.tsx`, `ceUnlock.local-pg.test.ts`; **Runtime:** produção, 2026-10-13 (entrega parcial) |
| Andamento dos B/Ls · seleção · **Registrar entrega de N B/Ls** | Gestão; B/Ls selecionados sem a entrega do original (os que já têm ficam de fora); confirmação lista os B/Ls | `DesbloqueioCe.tsx` | `ceUnlockCommand('delivery')` um B/L por vez, em sequência; depois `afterCeUnlockChanged` | O mesmo de registrar a entrega de um B/L | Cada B/L gravado que completa os quatro requisitos ganha prazo | Não é atômico: a mensagem diz quantos gravaram e quais falharam (com o motivo), e os que falharam continuam selecionados | **Teste:** `DesbloqueioCe.test.tsx` |
| Andamento dos B/Ls · **Exportar planilha** | Leitura (`ce_unlock_read`) | `DesbloqueioCe.tsx` | `fetchAllCeUnlockBls` (todas as páginas do recorte, quatro por vez, sem repetir B/L) → `fetchCeUnlockRequirementDates` (leitura `requirement_dates`, migration `590`, 500 B/Ls por chamada) → `exportCeUnlockWorkbook` (`ceUnlockWorkbookRows`, `src/services/exports.ts`) | Não escreve | Baixa `desbloqueio-ce-<data>.xlsx` com B/L, CE, Cliente, CNPJ/CPF, Navio, Viagem, POD, Solicitação, Situação, requisitos, Prazo e Na ZPT. Requisito atendido traz a data e a hora em que se cumpriu, no horário de Brasília (desde 2026-11-04, pedido do dono; antes, "Atendido"): aprovação do termo e da procuração que contam para o B/L (da solicitação enviada ou, sem ela, do par de anuais VIP que o item usa — `annuals_between` do pagamento e entrega até a exportação, migration `582` —, com "· anual VIP"), última baixa das Taxas Locais ou pagamento da avulsa, e a entrega do original; sem o fato na fonte, "Atendido". Pendente segue "Pendente"; isentas, "Isentas"; veículo LCL, "Dispensado"/"Dispensada" | Falha de leitura em mensagem | **Código** |
| Pedido · **Versões anteriores** · abrir a versão (o nome do arquivo é o link) | Gestão; pedido não VIP com termo ou procuração substituídos | `CeUnlockRequestDetail.tsx` (`OpenDocument`, sem ações de análise) | `downloadCeUnlockDocument` → `ce-unlock-document-download` | Não escreve | — | Cada versão diz "…enviada em dd/mm/aaaa…" (só a data), com a situação e o motivo; versão já expurgada mostra o nome com "(arquivo removido pela regra de retenção)" no lugar do link (`purged`, migration `282`); reivindicada pelo expurgo e ainda não removida, "(arquivo em remoção pela regra de retenção)" (`cleanup_pending`) | **Teste:** `CeUnlockRequestDetail.test.tsx`, `ceUnlock.local-pg.test.ts` |
| Pedido · **Reconferir CE** | Gestão; B/L com o motivo "CE alterado: reconferência necessária"; motivo ("Como o CE foi conferido") | `CeUnlockRequestDetail.tsx` | `ceUnlockCommand('reconfirm_ce')` | O item passa a usar o CE atual; aprovações de termo e procuração do item voltam a pendentes; o envio volta à fila (`export_id` fica) | Reavalia a conclusão | "B/L não pertence ao pedido"; "Motivo obrigatório" | **Código:** `ce_unlock_private.command` (`161`); matriz de CE corrigido incompleta (ver plano) |
| Pedido VIP · **Aplicar renovação VIP** | Gestão; pedido VIP aberto, fora de rascunho; CNPJ VIP com termo e procuração anuais aprovados que cubram cada B/L (desbloqueio solicitado dentro da vigência, migrations `479` e `487`) | `CeUnlockRequestDetail.tsx` | `ceUnlockCommand('apply_vip')` | Itens pendentes passam a apontar o anual que cobre cada B/L; histórico preservado | Reavalia a conclusão | "Cobertura VIP indisponível"; "Cobertura anual incompleta" (algum B/L sem anual que o cubra) | **Código:** `161`, `449` |
| Pedido · **Cancelar pedido** (desk) | Gestão; pedido ativo e não concluído; nenhum B/L já exportado; motivo | `CeUnlockRequestDetail.tsx` | `ceUnlockCommand('cancel')` | Pedido cancelado e itens inativos; evento com o motivo | Libera os B/Ls para nova solicitação; o cliente vê o pedido cancelado | "Documentação validada: a solicitação não pode mais ser cancelada"; com B/L já exportado o botão fica desligado e a tela diz "A solicitação não pode ser cancelada depois de exportada para a ZPT." (o banco recusa com o mesmo texto desde a migration `574`; antes, "Pedido com B/L já exportado para a ZPT: confirme o tratamento externo antes de cancelar", que mandava uma ação inexistente); vale também depois de **Reconferir CE** (`sent_to_zpt`, migration `510`) | **Código:** `161`, `510`; **Teste:** `CeUnlockRequestDetail.test.tsx`, `ceUnlockMatriz.local-pg.test.ts` |
| Andamento dos B/Ls · **Exportar N aptos para a ZPT** (**Exportar para a ZPT**) | Gestão; 1 a 100 B/Ls com os quatro requisitos (veículo LCL isento: só a entrega do original) | `DesbloqueioCe.tsx` (confirmação) | `downloadCeUnlockExport` → Edge Function `ce-unlock-export` → `ce_unlock_command('export')` | `ce_unlock_exports` (layout `zpt-5-v2`, linhas e snapshot); `exported_at`, `exported_by` e `export_id` por B/L (B/L sem solicitação: `ce_unlock_direct_exports`, com o CE enviado, migration `575`); apaga o *Divergente* anterior desses B/Ls | Baixa o XLSX e registra o envio, que mede o cumprimento do prazo; aviso para importar na aba "Planilha desbloqueio" da ZPT | "B/L X não apto" com os motivos recusa o lote inteiro (inclui liquidação perdida durante a exportação; a exportação trava também as faturas avulsas dos B/Ls, migration `279`); "Seleção inválida" | **Teste:** `ceUnlockRules.test.ts` (layout), `ceUnlock.local-pg.test.ts` (reversão concorrente); **Runtime:** produção, 2026-10-13 (`zpt-5-v2`, 3 B/Ls); aceite pela ZPT não comprovado |
| **Planilhas enviadas à ZPT** · **Baixar lote** / **Reexportar** | Gestão | `DesbloqueioCe.tsx` | `listCeUnlockExports`; `downloadCeUnlockExport` com `export_id` ou `reexport_of` | Baixar não escreve (devolve o lote como foi gerado, inclusive `zpt-5-v1`); o lote guarda o hash SHA-256 do conteúdo e não aceita reescrita, só o registro do envio (migration `281`); Reexportar cria lote novo ligado ao anterior, com os requisitos atuais | Reexportar registra novo envio | "Lote não encontrado"; na reexportação, as mesmas recusas de Exportar | **Código:** `ce-unlock-export`; retry do mesmo lote sem teste (ver plano) |
| **Conciliar com a ZPT** · **Conciliar N CEs** | Gestão; arquivo "Exportar Tela" da ZPT (.xls, .xlsx ou .csv) de até 20.000 CEs; exemplo aceito em `public/templates/zpt-exportar-tela-exemplo.xlsx` | `CeUnlockZptImport.tsx` (molde do lote 6a: Arquivo, Prévia com os CEs e a contagem das linhas sem CE ou sem situação ignoradas, Resultado) | `parseCeUnlockZptFile` e `reconcileCeUnlockZpt` → uma chamada a `ce_unlock_reconcile` (uma transação; antes, lotes de 5.000 gravados cada um por conta própria) | `ce_unlock_zpt_status` por B/L (*Desbloqueio conferido* ou *Divergente*); evento `reconcile`; sem recibo | Resumo: Desbloqueados, Divergentes, ZPT ainda sem atualização, Bloqueados não exportados, CE desconhecido; nada vai ao cliente nem muda o prazo | CE preenchido que não tem 15 dígitos ou "Data Atualização" preenchida e ilegível é erro da linha, e arquivo com mais de 20.000 CEs é erro do arquivo; com qualquer um, nada é conciliado ([ADR 0092](../adr/0092-importacao-com-erro-e-recusada-inteira.md)); linhas sem CE ou sem situação são ignoradas com a contagem na prévia (D3); linhas e abas ocultas ficam de fora com o aviso de leitura do seletor de arquivo | **Teste:** `ceUnlockZptReconcile.test.ts`, `CeUnlockZptImport.test.tsx`, `ceUnlock.local-pg.test.ts`; arquivo real da ZPT não comprovado |
| **Modelo do termo de devolução** · **Enviar modelo** (confirmação **Publicar modelo**) | Gestão; DOCX de até 10 MiB | `DesbloqueioCe.tsx` (`CeUnlockDocumentUploader` com origem `model`) | `uploadCeUnlockDocument` → `portal-ce-unlock-document` | `ce_unlock_documents` (`model`) e objeto `.docx` no bucket; o mais recente aprovado é o vigente | Disponível no Portal de todos os clientes; rascunhos novos guardam o modelo vigente | "Use o modelo em DOCX de até 10 MiB"; assinatura ZIP ou tipo inválidos recusados | **Remoto:** modelo cadastrado em produção em 2026-10-10 (ver plano) |
| Andamento dos B/Ls e pedido · consultar (Financeiro, Operações e Equipamentos) | `ce_unlock_read` sem `ce_unlock_manage` | `DesbloqueioCe.tsx` | `useCeUnlock`, `ceUnlockRead` | Não escreve | — | Ações de gestão indisponíveis na tela e recusadas no banco; documentos abertos a todos (migration `250`) | **Teste:** `DesbloqueioCe.test.tsx` (ações restritas) |
| Ficha do Cliente › Desbloqueio de CE / VIP · **Habilitar condição VIP** / **Revogar condição VIP** | Gestão; motivo | `CeUnlockVipCoveragePanel.tsx` | `ceUnlockCommand('set_vip')` | `ce_unlock_vip_customers` com versão; evento | Habilitar: o B/L coberto pelos dois anuais segue sem solicitação, e a varredura valida o que já está pago e entregue (migration `581`); a solicitação VIP aberta antes segue com os anuais. Revogar: o B/L ainda não exportado volta a pedir solicitação, os próximos pedidos nascem comuns, e as solicitações VIP em andamento perdem termo e procuração na hora (o B/L sai dos aptos; envio e **Aplicar renovação VIP** recusados); a *Documentação validada* só reabre na rodada seguinte da varredura ([Conclusão](#conclusão)) | "Motivo obrigatório"; "Condição VIP alterada" (`40001`) | **Código:** `161` |
| Ficha do Cliente › documentos anuais · **Aprovar** / **Solicitar correção** / **Revogar aprovação** | Gestão; aprovação informa início e ano, com fim em 31/12 do ano; correção e revogação com motivo | `CeUnlockVipCoveragePanel.tsx` | `ceUnlockCommand('review')` | `ce_unlock_documents`: status, `coverage_year`, `valid_from`, `valid_until`; evento | Aprovação cobre os pedidos VIP do CNPJ na vigência; revogação tira na hora o requisito dos pedidos VIP que o anual cobria, e a *Documentação validada* só reabre na rodada seguinte da varredura ([Conclusão](#conclusão)) | "Validade anual deve terminar em 31/12 do ano informado"; "Motivo obrigatório" | **Teste:** limites 31/12–01/01 e ano inválido em `ceUnlockRules.test.ts` |

## Estado e dados

### Tabelas e migrations

Migrations `139`–`149`, `160`, `161`, `173`, `220`, `279` (requisito de
pagamento), `280` (retenção), `281` (lote com hash e imutável), `282` (documento
expurgado na projeção), `575` (veículo LCL isento sem solicitação), `576` (VIP coberto no B/L sem solicitação), `577` (busca, filtros e histórico do B/L), `578` (envio de rascunho antigo recusa o veículo LCL isento), `579` (rascunho VIP coberto pelo anual), `581` (VIP sem solicitação, validação e aviso por B/L), `582` (anual VIP vigente até a exportação) e `590` (data e hora dos requisitos para a planilha comum, `ce_unlock_private.requirement_dates` e a leitura `requirement_dates`); a `177` redefine `ce_unlock_reconcile` (chave
do CE) e a `181`/`195`/`230`/`277` o alerta `ce_trocado_com_desbloqueio`. Tabelas `ce_unlock_*` (`ce_unlock_requests`,
`ce_unlock_request_bls`, `ce_unlock_documents`, `ce_unlock_vip_customers`,
`ce_unlock_bl_deliveries`, `ce_unlock_events`, `ce_unlock_exports`,
`ce_unlock_zpt_status`, `ce_unlock_email_outbox` (com `bl_id` para o aviso sem solicitação, desde a
`581`), `ce_unlock_direct_exports`, o envio à ZPT do B/L sem solicitação, desde a `575`, e
`ce_unlock_direct_validations`, a validação do B/L VIP sem solicitação, desde a `581`), schema privado de
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

Bucket privado `ce-unlock-documents`, com limite próprio desde a migration `437`
(decisão do dono de 2026-10-22): até 10 MB (10485760 bytes) e só `application/pdf`
e o DOCX do modelo do termo, os mesmos que `portal-ce-unlock-document` aceita
(`_shared/ceUnlockFile.ts`). O Storage recusa o resto mesmo fora da Edge.
Documentos são versionados. Funções:
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
não dispensa documento: exige termo e procuração anuais aprovados que cubram o B/L, do mesmo
CNPJ. Validade até 31/12 do ano declarado, inclusive em America/Sao_Paulo; não renova
em janeiro. **O B/L do VIP coberto pelos dois anuais não tem solicitação** (migration `581`,
decisão do dono de 2026-11-03, [ADR 0119](../adr/0119-vip-desbloqueia-sem-solicitacao.md)): segue
o caminho de [B/L dispensado de solicitação](#bl-dispensado-de-solicitação-veículo-lcl-isento-e-vip),
e o anual o cobre se vigente entre o pagamento e a entrega e a exportação. O que segue vale para o B/L em
solicitação (a VIP enviada antes da `581` e a comum). **Na solicitação, a vigência vale pela data
da solicitação do desbloqueio** (migration `479`,
decisão do dono com a diretoria de 2026-10-27, [ADR 0110](../adr/0110-vip-cobre-pela-data-da-solicitacao.md),
que substitui o vínculo do CE das migrations `449` e `456`, [ADR 0102](../adr/0102-vigencia-anual-pelo-vinculo-do-ce.md)):
o anual, e cada renovação, cobre todo CE cujo desbloqueio foi solicitado dentro da vigência
dele, sem olhar a importação do B/L nem o vínculo do CE, e continua cobrindo o que foi solicitado
nela depois de 31/12, enquanto estiver aprovado (revogado ou recusado não cobre). O dia que vale
é o do primeiro envio da solicitação ativa mais recente do B/L, no calendário de Brasília; antes
do envio (rascunho, seleção no Portal), o de hoje (`ce_unlock_private.request_day`, usada por
`ce_unlock_private.covers`). O B/L que passou de uma solicitação para outra conta pelo primeiro
envio do B/L, inclusive o da solicitação de onde ele saiu (evento `bl_moved`): o rascunho, a
seleção do Portal e o envio usam a mesma data (migration `487`). Na transição da regra anterior,
a solicitação que já tinha o anual ligado pelo vínculo do CE continua coberta, inclusive exportada
(`ce_unlock_annual_kept_by_transition`, migration `487`). A ficha do Cliente mostra, nas
solicitações VIP, a situação do anual ligado no lugar de Termo e Procuração. Trocar o número do CE não muda a cobertura. Exemplos: B/L com o CE
vinculado em 20/12 e o desbloqueio pedido em 05/01, com o VIP começando na virada do ano, é coberto
pelo anual novo; pedido enviado em 20/12 com o anual daquele ano aprovado segue coberto em
janeiro, e o pedido VIP aberto em dezembro não trava: no Portal, **Solicitar desbloqueio** do
pedido VIP segue a cobertura de cada B/L (`vip_covered`), a mesma que o envio confere, e não o
anual vigente hoje (revisão da release, 2026-10-25). Sem anual que cubra a data, o B/L segue as
regras de quem não tem o anual (solicitação comum, `source = 'request'`, com termo e procuração
anexados). A situação VIP do Cliente na tela (anuais vigentes hoje) não muda; a seleção de B/Ls
no Portal segue a cobertura de cada B/L (`vip_covered`). O rascunho só nasce VIP
(`vip_annual`) quando os anuais cobrem todos os B/Ls; um B/L sem cobertura faz o pedido inteiro
seguir comum. O item traz `vip_covered` para o Portal explicar. No B/L ainda sem solicitação,
o mesmo `vip_covered` (os dois anuais cobrindo hoje) devolve termo e procuração atendidos, para a
aba Andamento dos B/Ls, o filtro "Requisito pendente" e a planilha comum (migration `576`, pedido do
dono de 2026-11-03); com só um anual cobrindo, os dois seguem pendentes, porque o pedido seria
comum. O rascunho VIP (`source = 'vip_annual'`, que ainda não aponta os anuais: eles entram no
envio) segue a mesma regra (migration `579`, decisão do dono de 2026-11-03); o rascunho comum e a
solicitação cancelada seguem os documentos deles. Desde a `581`, esse B/L coberto segue sem
solicitação: o rascunho não o segura, e o rascunho VIP só existe se foi aberto antes (o envio o
recusa). **Teste:** `ceUnlockVip.local-pg.test.ts`. **Teste:**
`ceUnlockVigenciaAnual.local-pg.test.ts`. Pagamento e entrega continuam por B/L, também para VIP. A entrega do
original é independente da solicitação: o desk a registra antes ou depois do pedido.
Conteúdo, assinatura e validade do termo e da procuração são conferidos só pela
análise humana do desk ([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md)). Reserva de upload
sem PDF registrado não substitui a versão enviada nem consome quota ativa após
compensação/expurgo. Documento novo em análise não revoga o anterior vigente; renovação
pode ser aplicada aos pedidos pendentes pelo desk, com histórico.

### Histórico do B/L

Pedido do dono de 2026-11-03 (migration `577`): antes, quando e quem cumpriu um
requisito só aparecia no histórico da solicitação, e a entrega do B/L original
sem solicitação não tinha tela. `ce_unlock_read('bl_history')` →
`ce_unlock_private.bl_history` monta, só do que já é gravado, os registros do
B/L, o mais recente primeiro: entrega e desentrega do original (eventos
`delivery`, com motivo), aprovação e recusa do termo e da procuração (eventos
`review` dos documentos das solicitações do B/L e dos anuais VIP que o cobrem),
baixas dos recebíveis de Taxas Locais do B/L (`ledger_settlements`, autor pelo
pagamento ou pela auditoria da baixa) e pagamentos de fatura avulsa do B/L, e,
como contexto, rascunho, envio, cancelamento e validação das solicitações, mudança
de solicitação e geração da planilha da ZPT. Devolve também o item atual, para os
quatro requisitos de hoje. Leitura interna, para todos os setores, como o
histórico da solicitação; o Portal não tem. Limites: baixa estornada some (a linha
é apagada; só a auditoria guarda) e a isenção de Taxas Locais não tem data aqui.
**Teste:** `ceUnlockVip.local-pg.test.ts`, `DesbloqueioCe.test.tsx`.

### B/L dispensado de solicitação (veículo LCL isento e VIP)

Desde a migration `575` (decisão do dono de 2026-11-03,
[ADR 0118](../adr/0118-desbloqueio-do-veiculo-lcl-so-com-o-bl-original.md)), o B/L de veículo
com Taxas Locais isentas pelo Movement To LCL ou CFS, em B/L de modalidade container
([Taxas Locais § Movimento e Isenção](taxas-locais.md#movimento-e-isenção-de-taxas-locais)),
não precisa de termo de devolução, procuração nem solicitação: basta o B/L original entregue.
A regra é lida dos dados atuais do B/L (`ce_unlock_private.documents_dispensed`): `charge_status
= 'exempt'`, modalidade container, com veículo e Movement To LCL/CFS. A isenção à mão
(**Isentar Taxas Locais**) de outro B/L não dispensa os documentos, só o pagamento.

- **Aptidão.** Termo e procuração contam como atendidos (`documents_dispensed`). Sem
  solicitação ativa enviada, o B/L segue o caminho direto (`direct`): fica apto com o CE, a
  entrega registrada pelo desk e nada em aberto do [requisito financeiro](#requisito-financeiro)
  (fatura avulsa, troca de Cliente). O único motivo pendente antes da entrega é "B/L físico
  aguardando entrega".
- **Portal.** `can_submit` é falso: o B/L não entra em "Podem ser pedidos" nem na seleção, e
  o rascunho que o inclua é recusado com a explicação. O envio de um rascunho criado antes de o
  B/L virar dispensado também o recusa (migration `578`): sem isso, a solicitação enviada
  passava a ser o caminho do B/L e o envio direto à ZPT já feito voltava a "Não exportado"; o
  Cliente cancela o rascunho e pede os demais B/Ls em outro. B/L que já estava em solicitação
  enviada continua nela, com termo e procuração atendidos para ele; rascunho e solicitação
  cancelada não o seguram.
- **Envio à ZPT.** O desk exporta como os demais; a planilha leva as quatro colunas "Sim". O
  envio fica em `ce_unlock_direct_exports` (um por B/L, com o CE enviado), não no rascunho
  nem na solicitação antiga; CE trocado volta a "Não exportado" e pode ser exportado de novo.
  A conciliação com a ZPT conta esse envio (`ce_unlock_reconcile`).
- **Prazo.** Começa na entrega do original (ou no pagamento da avulsa, se veio depois) e só
  conta os fatos até a exportação; a janela é a de [Prazo (SLA)](#prazo-sla).

**Teste local-pg:** `desbloqueioVeiculoLcl.local-pg.test.ts`.

Desde a migration `581` (decisão do dono de 2026-11-03,
[ADR 0119](../adr/0119-vip-desbloqueia-sem-solicitacao.md)), o B/L do **Cliente VIP** segue o
mesmo caminho direto quando o termo de devolução e a procuração anuais aprovados, de ano
inteiro, cobrem o intervalo abaixo (`vip_direct`; só um dos dois não basta, e o B/L segue o fluxo
comum). Pagas as Taxas Locais e entregue o original, ele fica apto, sem solicitação.

- **Quando o anual cobre.** O intervalo começa no último ato do Cliente que deixa o B/L pronto:
  a entrega do original, a baixa das Taxas Locais ou o pagamento da avulsa, no calendário de
  Brasília (`ce_unlock_private.direct_day`; depois da exportação, só os fatos até ela; antes de
  pago e entregue, hoje). Vai até a exportação (antes dela, hoje). Basta termo e procuração
  vigentes num mesmo dia dentro dele (`ce_unlock_private.annuals_between`, migration `582`; na
  `581`, só o primeiro dia). Pago e entregue em 20/12 com o anual daquele ano, o B/L segue coberto
  mesmo exportado em janeiro; pago e entregue antes de o anual ser aprovado ou começar, é coberto
  com a aprovação, e o prazo parte dela.
- **Aptidão e Portal.** Termo e procuração são os anuais (`termo`, `procuracao` e
  `vip_covered` verdadeiros); `can_submit` é falso, e o rascunho e o envio de rascunho (inclusive
  o rascunho VIP aberto antes da `581`) recusam o B/L com "B/L … não precisa de solicitação: pela
  condição VIP, …". A solicitação VIP enviada antes da `581` continua sendo o caminho do B/L.
  O motivo pendente é o que falta: Taxas Locais ou "B/L físico aguardando entrega".
- **Validação e aviso.** Na primeira vez que o B/L fica apto, `ce_unlock_private.validate_direct`
  grava `ce_unlock_direct_validations` (uma por B/L e Cliente), o evento `direct_validated` (no
  [Histórico do B/L](#histórico-do-bl): "Documentação validada pela condição VIP, sem
  solicitação") e o aviso "Desbloqueio de CE: documentação validada" do B/L, no sino do Portal e
  na fila de e-mails (`ce_unlock_email_outbox` com `bl_id`, sem solicitação): "A documentação do
  B/L X (CE Y) foi validada pela sua condição VIP: termo de devolução e procuração anuais, Taxas
  Locais pagas e B/L original entregue. Prazo para o desbloqueio: até dd/mm às HH:MM. Consulte o
  SISCARGA para verificar o desbloqueio." Roda na entrega do original e na varredura de 5 minutos
  (`ce_unlock_refresh_open`), que pega a baixa feita fora do módulo, a aprovação do anual e a
  habilitação do VIP. Desmarcar e marcar de novo não repete o aviso.
- **Prazo.** Só depois da validação (ou da exportação), a partir do último fato: entrega,
  baixa, avulsa, aprovação dos anuais, habilitação do VIP ou a validação, até a exportação.
  Entre a baixa fora do módulo e a varredura, o B/L já é apto e ainda não tem prazo (o Portal
  diz "Pagamento e entrega confirmados. Consulte o SISCARGA.", sem prazo).
- **Solicitação automática (estudo de 2026-11-04).** O dono pediu para estudar uma solicitação
  criada pelo sistema para o B/L VIP apto, para espelhar a comunicação da solicitação comum. A
  comunicação já é a mesma: na validação o Cliente recebe o aviso "documentação validada", no sino
  e por e-mail à caixa Documentação e Operação, com o prazo e "Consulte o SISCARGA"; e a coluna
  Solicitação do Portal passou a dizer, como a solicitação validada, que o B/L está apto e deve ser
  conferido no SISCARGA. A solicitação automática acrescentaria só o protocolo e a linha em Minhas
  solicitações, e desfaria a escolha (b) da [ADR 0119](../adr/0119-vip-desbloqueia-sem-solicitacao.md)
  sobre dados reais. O dono decidiu ficar sem solicitação e trocar só a mensagem.
- **Perda da cobertura.** Revogado o VIP ou um anual antes da exportação, o B/L volta ao fluxo
  comum. Depois da exportação, o envio fica (`ce_unlock_direct_exports` com o CE atual mantém o
  caminho direto) e o B/L não passa a pedir solicitação.

**Teste local-pg:** `ceUnlockVip.local-pg.test.ts` (casos "581").

### Requisito financeiro

Taxas locais usam recebíveis/settlements vigentes do Cliente atual, não status
isolado de fatura. Troca de CNPJ com devolução ou reemissão pendente bloqueia
solicitação e atos posteriores; o recebimento antigo permanece no histórico e
não financia o novo Cliente. A nova cobrança precisa de liquidação própria.
Restituição de excedente por redução normal do mesmo Cliente não bloqueia
aptidão quando o valor corrigido já está coberto. Pagamento
parcial, ausência de liquidação, nova obrigação de COD ou cancelamento de baixa
impedem aptidão. B/L com Taxas Locais isentas (`charge_status = 'exempt'`,
pelo veículo LCL ou à mão pelo **Isentar Taxas Locais**, ADR 0111, D12) e
sem recebível vigente não tem o requisito de pagamento: fica apto com termo,
procuração e entrega (o veículo LCL isento, só com a entrega:
[B/L dispensado de solicitação](#bl-dispensado-de-solicitação-veículo-lcl-isento-e-vip)), e a planilha ZPT sai "Sim" no pagamento; o Portal mostra "Isentas" no lugar de "Pagas" (`paid_exempt`). Fatura avulsa
emitida para o B/L e o Cliente atual (`issued`/`partially_paid` com saldo)
bloqueia com o motivo "Fatura avulsa do B/L em aberto"; rascunho, cancelada e
paga não bloqueiam. Demurrage não faz parte do requisito
([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md), itens 2 e 3;
migration `279`; **Teste:** `ceUnlock.local-pg.test.ts`). Correções para menor
reduzem o valor exigível: a liquidação cobre o valor original menos a correção,
com saldo zero e evidência real no ledger. Fatura consolidada parcialmente paga
libera só o B/L cujo recebível foi liquidado, nunca pelo status da fatura.
Correção a maior ainda não faturada — **Fatura desatualizada** ativa com
cotação maior que o cobrado, ou COD a maior pendente — deixa o B/L sem
liquidação com o motivo **Diferença de valor a faturar**; o COD a maior pago
pela fatura sucessora volta a liberar (migration `369`;
[ADR 0093](../adr/0093-tabela-vinculada-ao-bl-e-coerencia-financeira.md),
decisão 20; **Teste local-pg:** `correcaoCodDesbloqueioDemurrage.local-pg.test.ts`).

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
são enviados de novo (o VIP usa os anuais quando eles cobrem os B/Ls da nova, [ADR 0101](../adr/0101-desbloqueio-ce-prazo-e-vigencia-anual.md)). O Portal mostra antes a
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
do módulo, pela varredura `ce_unlock_refresh_open()` que a Edge Function `ce-unlock-notify-email`
executa na rodada do job de 5 minutos (ponytail: O(solicitações abertas); upgrade: fila por
trigger). A mesma varredura valida o B/L VIP sem solicitação que ficou apto fora de um comando
(migration `581`, [B/L dispensado de solicitação](#bl-dispensado-de-solicitação-veículo-lcl-isento-e-vip)). A rodada disparada por cada aviso gravado na fila (migration `458`) só envia a fila,
sem a varredura: o aviso foi gravado por um comando que já reavaliou a própria solicitação, e a
varredura trava todas as abertas numa transação (revisão da release, 2026-10-25).
Dois comandos não reavaliam as solicitações VIP do Cliente: **Revogar condição VIP** e **Revogar
aprovação** de um documento anual. O B/L perde o requisito na hora, mas a solicitação em
*Documentação validada* só reabre na rodada seguinte da varredura.

### Prazo (SLA)

No veículo LCL isento sem solicitação, o prazo parte da entrega do original; no B/L do VIP sem
solicitação, da validação do B/L (migration `581`)
([B/L dispensado de solicitação](#bl-dispensado-de-solicitação-veículo-lcl-isento-e-vip)). Nos demais,
o prazo só começa com os **quatro requisitos cumpridos** — taxas locais liquidadas, termo de
devolução aprovado, procuração aprovada e B/L original entregue — e parte do último que se
cumpriu: o envio, a entrega do original, a liquidação, o pagamento da avulsa, a aprovação do
termo ou da procuração, ou a validação da solicitação (migration `448`, ponto 10 das observações
de 2026-10-23, [ADR 0101](../adr/0101-desbloqueio-ce-prazo-e-vigencia-anual.md), decisão 1). A
validação (evento `complete`, gravado quando todos os B/Ls ativos cumprem os quatro) entra desde a
migration `450`: ela cobre o fato que completa a solicitação sem estar na lista — o B/L pendente
que muda para outra solicitação, as Taxas Locais que viram isentas, a troca de Cliente, o ajuste
COD ou a Fatura desatualizada que se resolvem — e que antes fazia o prazo nascer no passado, já
vencido. Por ela, o prazo da solicitação começa na hora da validação: na hora do fato quando ele
passa por comando do módulo, em até 5 minutos quando vem da liquidação ou de outro fato fora do
módulo (job `ce-unlock-notify-email`). Nesse intervalo, o B/L que já cumpre os quatro mostra o
prazo do último fato da lista, que pode estar no passado; a validação o traz para a hora dela.
Se o job parar, a validação não acontece e esse prazo do B/L fica no fato anterior. Faltando um, não há
prazo em lugar nenhum: o Portal mostra "—" e "O prazo para desbloqueio começa a contar quando os
quatro requisitos estiverem cumpridos…", o Vela mostra a célula vazia e nenhum aviso cita prazo.
A regra está no banco: `ce_unlock_private.item` só dá `sla_started_at` ao B/L com os quatro, e
`ce_unlock_private.request_sla_start` só dá prazo à solicitação com todos os B/Ls ativos
prontos (usada em Minhas solicitações, na fila Solicitações e na ficha do Cliente). Desfazer um
requisito (desmarcar a entrega, recusar ou revogar um documento, perder a liquidação) tira o
prazo; cumpri-lo de novo recomeça a contagem. Depois da exportação o prazo do B/L fica, mesmo que
um requisito caia (a entrega desmarcada, um documento revogado), e nenhum fato posterior à
exportação o move: nem a validação (migration `450`), nem o envio, a entrega, a liquidação, a
avulsa ou a revisão de documento (migration `460`; antes, desmarcar a entrega de um B/L exportado
fora do prazo o fazia passar a "Exportado no prazo"). O aviso "documentação validada" usa o mesmo
`request_sla_start`, lido depois de gravar a validação. A fila Solicitações, que só tem documentos a
analisar, mostra a hora do envio, não prazo; a ficha do Cliente mostra o prazo da concluída até a
última exportação (`exported_at` de `ce_unlock_customer_requests`), como o detalhe.
**Teste:** `ceUnlockPrazoRequisitos.local-pg.test.ts` (as 16 combinações dos requisitos, o pedido
com dois B/Ls, o B/L exportado que perde um requisito, o fato posterior à exportação, a validação
pela mudança do B/L pendente e o aviso "documentação validada").

Só dias úteis, sem feriados. Antes das 12:00 (inclusive antes das 8h) vence às 17:00 do mesmo dia;
a partir das 12:00, às 12:00 do próximo dia útil; sábado/domingo vencem segunda às 12:00 (decisão
do dono de 2026-10-27, da reunião de testes de 2026-10-26, migration `466`; até então a janela da
tarde vencia às 12:30, D16 da spec arquivada de 2026-10-07). O prazo é calculado na leitura, não
gravado: a mudança vale também para as solicitações abertas e para a medição das exportações
anteriores. Calculado na tela (`ceUnlockSla.ts`), no banco (`ce_unlock_private.sla_deadline`,
usado no texto do aviso) e escrito no bloco "O que o desbloqueio pede" do Portal; o teste SQL
confere tela e banco com os mesmos casos. O cumprimento é medido pela data da exportação.

**Alertas do prazo e da análise** (desde 2026-11-06, migration `608`,
[ADR 0131](../adr/0131-decisoes-da-revisao-dos-alertas.md), D1). Da Documentação, com o
Administrativo também avisado; a rotina `ce-unlock-alerts` (5 minutos) abre e fecha:
- `desbloqueio_solicitacao_sem_analise` (Crítico, por solicitação): solicitação do Cliente em
  `submitted` ou `in_review` com B/L ativo de Termo ou Procuração sem aprovar, 2 horas úteis depois do
  último `submit` (`_add_business_hours`: 8h às 17h de Brasília, dia útil de
  `itau_pix_business_day`). **Resolver** abre `/desbloqueio-ce?pedido=<id>`.
- `desbloqueio_prazo_vencendo` (por B/L): com `sla_started_at` do item, Normal 2 horas depois do
  início; Crítico (marco `prazo_critico`) a partir de 2 horas antes de `sla_deadline`. Desde a
  migration `612` (correção do dono de 2026-11-06), exportar não fecha: fecha quando a conciliação
  da ZPT traz o B/L desbloqueado no CE atual (`_ce_unlock_zpt_unlocked`: `ce_unlock_zpt_status`
  `unlocked` com o CE do B/L; o gatilho `trg_ce_unlock_deadline_alert_on_zpt` fecha na hora), quando
  o prazo deixa de correr ou o B/L é cancelado. A mensagem diz se o B/L já foi exportado. A rotina
  abre para todo B/L com prazo e sem desbloqueio conferido, sem limite de idade (migration `613`,
  [ADR 0132](../adr/0132-brechas-restantes-da-revisao-dos-alertas.md), decisão 1; na `612` o corte
  era de 30 dias). **Resolver** abre a aba Controle.
- `desbloqueio_divergente_zpt` (Crítico, por B/L; migration `613`, ADR 0132, decisão 3): a
  conciliação gravou o B/L como `divergent` no CE atual. Mensagem com `zpt_status`, `description` e
  `pending`; marco por `reconciled_at`, então cada conciliação divergente nova avisa de novo. Fecha
  com o B/L desbloqueado, a linha apagada, o CE trocado ou o B/L cancelado. Abre e fecha pelo
  gatilho `trg_ce_unlock_deadline_alert_on_zpt` e pela rotina.
**Teste:** `alertasDoDesbloqueioDeCe.local-pg.test.ts`.

**Anual do VIP enviado** (desde 2026-11-07, migration `614`, [ADR 0132](../adr/0132-brechas-restantes-da-revisao-dos-alertas.md),
decisão 4): quando um `ce_unlock_documents` de `source = 'vip_annual'` passa a `uploaded` por conta do
Portal, o gatilho `trg_notify_ce_unlock_annual_uploaded` manda o aviso **Novo documento anual VIP**
(sem alerta) à Documentação e ao Administrativo, que abre a ficha do Cliente na aba Desbloqueio de CE e
VIP. Envio pela equipe interna não avisa. Sem alerta de vencimento do anual (decisão do dono).
**Teste:** `sinoAvisosDeAcontecimento.local-pg.test.ts`.

### Avisos ao cliente

**Aviso à equipe (migration `595`, [ADR 0126](../adr/0126-sino-avisa-solicitacao-de-desbloqueio-e-pagamento.md)).**
O envio da solicitação comum pelo Cliente (evento `submit`) avisa a Documentação no sino
do Vela: "Nova solicitação de desbloqueio de CE" ou, no envio depois da correção,
"Solicitação de desbloqueio de CE reenviada", com o clique na solicitação. A solicitação
VIP não avisa. O item **Desbloqueio de CE** do menu mostra quantas solicitações estão em
**Solicitações aguardando análise** (`review_queue`), relido a cada 60 s. A regra do
aviso está em [Operação e Suporte](operacao-suporte.md#notificação-interna-e-regra-de-destinatários).

Recusa de documento (com o motivo) e documentação validada (com o
prazo; da solicitação ou, desde a migration `581`, do B/L VIP sem solicitação, com `bl_id` e sem
`request_id`) geram um aviso no sino do Portal e uma linha na fila `ce_unlock_email_outbox`; a
Edge Function `ce-unlock-notify-email` envia aos contatos da caixa **Documentação e
Operação** e registra cada tentativa em `portal_email_attempts`
(`ce_unlock_notificacao`). Nenhum texto cita ZPT ou desbloqueio confirmado. O aviso de
documentação validada, e a situação da solicitação no Portal, mandam o cliente consultar o
**SISCARGA** para verificar o desbloqueio (migration `466`; antes, "o Mercante").

Desde a migration `458`, gravar a linha na fila chama a Edge Function na hora
(gatilho `trg_kick_ce_unlock_notify_email`, depois do COMMIT, com o segredo próprio
`CE_UNLOCK_NOTIFY_SECRET`): o e-mail sai em segundos, não no próximo ciclo do job de
5 minutos, que segue como rede de segurança para reenvios. A leitura da fila
(`ce_unlock_email_pending`) reserva as linhas por 10 minutos (`claimed_until`, com
`FOR UPDATE SKIP LOCKED`), para a rodada do gatilho e a do cron não pegarem a mesma
linha; a linha que volta para nova tentativa fica reservada por 3 minutos (migration `462`;
eram 4 na `458`, e a falha logo depois de um múltiplo de 5 escorregava para a segunda rodada), e
o reenvio segue o passo do cron. As chaves de idempotência por destinatário
(`ce-unlock:{id}:{destinatário}` e o `Idempotency-Key` no provedor) não mudam. O
mecanismo do disparo está em [segredos e cron](../operations/segredos-cron.md#disparo-pelo-evento). O Portal mostra
só a data do prazo (nunca "vencido"), e seu histórico omite exportação, entrega e VIP.

Desde a migration `338` (lote 6b), o motivo da recusa diz de qual documento é:
"Motivo (procuração): …" ou "Motivo (termo de devolução): …", no sino e no e-mail
(antes saía "Motivo: Procuração: …"). O e-mail traz, depois do texto, o bloco
**Solicitação** (com o protocolo) e os B/Ls da solicitação (`ce_unlock_request_bls`,
sem o B/L que passou para outra solicitação, com evento `bl_moved`, como na tela,
e, desde a auditoria run-3, sem o B/L que já é de outro Cliente, como na visão do Portal;
o B/L confirmado continua; sem B/L, o bloco não aparece) e o botão **Abrir Desbloqueio de CE**. O
aviso do B/L VIP sem solicitação (migration `581`) traz, no lugar, o bloco **Condição VIP, sem
solicitação** com o B/L (`ceUnlockNoticeRequest`). Resposta
e rodapé vão para `importacao@fwlog.com.br` (`COMMUNICATIONS_REPLY_TO` e `COMMUNICATIONS_CONTACT_EMAIL`,
os mesmos dos Comunicados; reunião de testes de 2026-10-26); até então iam para o suporte do Portal
(`PORTAL_REPLY_TO` e `PORTAL_SUPPORT_EMAIL`).

Como cada aviso termina na fila (migration `307`):

| Estado | Quando |
| --- | --- |
| `sent` | Todos os contatos da caixa receberam |
| `partial` | Parte recebeu e o restante está na supressão do Portal (bounce ou reclamação); não volta a ser tentado |
| `simulated` | Chave **Canal de envio real** desligada: os destinatários são resolvidos e cada aviso vai ao suporte (`suporte@portalfwlog.com.br`), com o e-mail do Cliente no assunto ([ADR 0104](../adr/0104-marca-dev-e-chave-de-envio-pelo-suporte.md)). O aviso **não** é enviado depois ao Cliente, quando a chave for ligada (D11 do [plano dos e-mails](../archive/plans/2026-10-17-correcao-dos-emails.md)) |
| `skipped` | Nenhum destinatário: sem contato na caixa ou todos suprimidos |
| `pending` | Falha de envio ou erro na linha; a próxima rodada tenta de novo, sem reenviar a quem já recebeu |
| `failed` | Cinco tentativas sem sucesso |

Regras da rodada:

- Erro ao ler a chave de envio responde 500 e não consome a fila.
- Com a chave ligada, sem chave do provedor, remetente ou reply-to, responde 503 e não consome a
  fila. Com a chave desligada e a chave do provedor presente, o envio ao suporte exige o
  remetente; sem chave do provedor (ambiente local), só registra.
- Um erro numa linha conta a tentativa dela e a rodada segue para a próxima.
- `skipped` e `failed` abrem o alerta **Aviso do Desbloqueio de CE não enviado**
  (`desbloqueio_ce_aviso_nao_enviado`, Administrativo, um por Cliente). "Abrir Cliente" leva à ficha
  do Cliente (o CNPJ vai no alerta desde a migration `314`). Ele fecha sozinho quando
  um aviso seguinte do mesmo Cliente termina `sent`, `partial` ou `simulated`; depois de
  corrigir o contato, quando não há aviso seguinte, resolve-se com justificativa na fila
  (migration `316`). Contato da caixa devolvido ou com reclamação não recebe: com outro
  contato que recebeu, o aviso fecha `partial`; sem nenhum, `skipped` com o motivo
  "todos suprimidos", não "sem contato".
- A resposta traz `{ sent, partialSuppressed, simulated, skipped, retry, failed }`; `failed > 0` deixa o
  heartbeat `BETTERSTACK_HEARTBEAT_CE_UNLOCK_NOTIFY_URL` vermelho. Exceções e respostas 5xx vão
  ao Sentry.

### Envio e conciliação com a ZPT

**Solicitação exportada não se cancela** (decisão do dono de 2026-10-27,
`08-desbloqueio-ce:13`): basta um B/L da solicitação ter sido exportado para a ZPT, mesmo
depois de **Reconferir CE**, para **Cancelar pedido** ficar desligado, com "A solicitação não
pode ser cancelada depois de exportada para a ZPT."; o banco também recusa, com o mesmo texto
(migration `574`, decisão do dono de 2026-11-03). A tela lê o
`sent_to_zpt` do item (migration `510`), a mesma condição da trava do banco (`export_id` ou
`exported_at`): Reconferir CE devolve o B/L à fila, mas não apaga o envio. Não há ação de
"tratamento externo": o que a ZPT já recebeu segue pela conciliação.

Só entram na planilha B/Ls com os quatro requisitos. O layout
`zpt-5-v2` usa os cabeçalhos do "Exportar Tela" da ZPT (`BL`, `Financeiro`,
`Term. Devolucao`, `Procuracao`, `BL Entrega`; Sim/Não). **Exportar registra o envio**
(data e usuário por B/L); lotes antigos `zpt-5-v1` mantêm seu layout. Importar o
.xls da ZPT concilia por CE (ignora zeros à esquerda): *Desbloqueado* vira
*Desbloqueio conferido* (mesmo sem exportação pelo Vela); exportado e ainda bloqueado
vira *Divergente* com status, descrição e colunas em "Não"; bloqueado e nunca exportado
não vira *Divergente* (conta em "Bloqueados não exportados"), mas apaga a conciliação anterior do
B/L: o *Desbloqueio conferido* de antes some e a coluna Na ZPT volta a "Não exportado" (ou "Apto,
não exportado"). Linha bloqueada cuja atualização na ZPT é anterior à exportação conta como
"ZPT ainda sem atualização" e não vira *Divergente* (**Código:** `ce_unlock_reconcile`,
migration `177`). O Vela guarda status, descrição, data e colunas em "Não"; nunca o CPF/nome do
operador da ZPT. A conciliação não altera o prazo nem o que o Portal mostra. Linhas e
abas ocultas ficam de fora da leitura, com o aviso de leitura no seletor de arquivo;
linhas sem CE ou sem situação ficam de fora com a contagem na prévia. CE que não tem
15 dígitos, "Data Atualização" preenchida e ilegível (vazia continua vazia) ou mais de
20.000 CEs no arquivo recusam a conciliação inteira
([ADR 0092](../adr/0092-importacao-com-erro-e-recusada-inteira.md)).

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

Desde a migration `427`: o rascunho do Portal confere que todo B/L é do Cliente
da sessão e liberado antes de travar solicitações e B/Ls; a visão sem Cliente das
funções privadas (`list`, `request_json`) exige perfil interno e `vip_json` exige
Cliente; o item do B/L com solicitação de outro Cliente esconde também os motivos
de documentos, entrega e CE daquela solicitação (fica só "Cliente do B/L
alterado"); o `request_id` do contexto de upload só vale para `source = 'request'`;
e o aviso por e-mail não sai para Cliente desativado. **Teste:**
`src/integration/desbloqueioCeGuardasDeDono.local-pg.test.ts` e
`portalAntigoDonoDoBl.local-pg.test.ts`.

### Documentos, upload e expurgo

Upload pela Edge Function valida sessão, PDF/MIME/assinatura, 10 MiB, 20
uploads/24h e 100 MiB ativos por cliente. Abrir ou baixar exige autorização atual e
URL assinada por 60 s; PDF abre na aba nova, o modelo DOCX é baixado.

O expurgo reivindica/fixa os registros no banco antes de apagar objetos;
rascunho expirado é cancelado sob lock, e falha física permite retry.
O modelo atual e anuais vigentes não são expurgados por mera idade. O anual vencido sai
quando há outro aprovado mais novo do mesmo tipo, exceto enquanto ainda cobre B/L do Cliente
não cancelado (desbloqueio solicitado na vigência dele, migrations `457` e `479`): esse fica
guardado até um ano depois do fim da vigência, mesmo com a conciliação da ZPT já em
"Desbloqueado" (decisão do dono de 2026-10-27, `08-desbloqueio-ce:3`, opção B: só a confirmação
externa antiga conta como "conferido" e o libera antes). O B/L exportado e não conferido também segura o anual
(migration `460`): se a ZPT devolver "Divergente", reexportar exige termo e procuração.

Expurgo usa Storage API, preservando metadados e histórico
([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md), item 5;
**Código:** `ce_unlock_cleanup_candidates`, migrations `280`, `457` e `460`; **Teste:**
`ceUnlock.local-pg.test.ts` e `ceUnlockVigenciaAnual.local-pg.test.ts`):

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
`src/integration/desbloqueioVeiculoLcl.local-pg.test.ts` (veículo LCL isento: apto só com a
entrega, exportação com quatro "Sim", conciliação, CE trocado, recusa do rascunho no Portal e
os casos que continuam exigindo termo e procuração);
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
