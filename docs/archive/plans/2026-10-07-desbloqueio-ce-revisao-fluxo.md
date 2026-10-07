# Desbloqueio de CE Mercante — revisão do fluxo: plano de implementação

> **Estado (2026-10-07): executado localmente e arquivado.** Implementado no checkout,
> validado localmente; publicação, agenda do e-mail e aceite da planilha pela ZPT seguem
> pendentes e estão descritos no [módulo](../../modules/desbloqueio-ce.md) e em
> [serviços externos](../../operations/servicos-externos.md). Resumo da execução ao final.

> **Para execução por agentes:** usar `superpowers:executing-plans`. Etapas em
> checkbox registram avanço; este documento não autoriza aplicar migrations em
> produção, publicar funções nem enviar e-mails reais.

**Objetivo:** alinhar o fluxo implementado em 2026-10-04 ao processo operacional
aprovado em 2026-10-07: validação documental por solicitação, Controle ZPT por
BL, SLA, notificações ao cliente, exportação como registro de envio e
conciliação com o arquivo da ZPT.

**Spec:** [revisão do fluxo](../specs/2026-10-07-desbloqueio-ce-revisao-fluxo-design.md)
(decisões numeradas 1–27, citadas abaixo como D#).
**Base:** migrations `139`–`149`, [módulo](../../modules/desbloqueio-ce.md),
[plano original](../../plans/2026-10-04-desbloqueio-ce-mercante.md).

## Restrições globais

- Nova migration a partir do próximo NNN livre (hoje `160`); não editar `139`–`149`
  nem `src/types/database.ts` (guard). Seguir `WORKFLOW.md` §5.
- A migration pode reescrever linhas `ce_unlock_*` existentes apoiada no bullet
  "Data status" do `AGENTS.md`; declarar isso no cabeçalho
  (`npm run migrations:check`).
- Autorização e escopo do cliente continuam nos dispatchers
  `ce_unlock_command`/`portal_ce_unlock_command` e em `ce_unlock_read`; esconder
  botão não substitui a recusa no banco.
- Portal nunca recebe status ZPT, exportação, conciliação nem desbloqueio (D5).
- Reusar: `src/services/agencyReportDeadline.ts` (dia útil), `importCore.ts`
  (leitura/cabeçalho da planilha), `@e965/xlsx` já instalado,
  `afterCeUnlockChanged` em `cacheEffects.ts`, caixa `documentacao_operacao`
  e o pipeline de comunicações existente.

## Etapa 1 — Banco: documentos por pedido, cancelamento, exportação = envio

- [x] Migration `NNN_ce_unlock_fluxo_revisado.sql`:
  - ação `review` passa a aceitar `document_id` + `decision` sem `bl_ids`,
    aplicando a todos os itens ativos não concluídos do pedido (D8); recusa
    exige `reason` (D9) e não altera o outro documento;
  - `portal_ce_unlock_command` aceita `cancel` do próprio cliente apenas em
    `draft`/`changes_requested`, com motivo opcional (D4);
  - conclusão: pedido vai a `completed` quando todos os itens ativos têm os
    quatro requisitos (D14). Avaliar nos comandos que mudam requisito
    (`review`, `delivery`, `apply_vip`, `reconfirm_ce`) e no `export`.
    ponytail: liquidação financeira posterior não dispara conclusão sozinha;
    o próximo comando ou leitura de fila corrige. Upgrade: trigger em settlements.
  - exportação grava por BL `exported_at`/`exported_by`/`export_id` (D22);
    remover do allowlist `sent` e `confirm`; leitura deixa de projetar
    `confirmation_records`. Colunas antigas (`confirmed_*`,
    `external_reference`, `sent_at`) ficam sem uso, não apagadas.
  - fila interna ganha `exported_at`, `zpt_status` e `sla_started_at` por BL e
    o filtro `situation='ready_not_exported'` (D11).
- [x] SLA no banco (D15–D17): `sla_started_at` derivado na leitura como o maior
  entre o último `submit` do pedido, `ce_unlock_bl_deliveries.updated_at`
  (se entregue) e a última liquidação dos recebíveis do BL — todos só contam
  se posteriores ao primeiro envio. Sem tabela nova.
- [x] Teste SQL em `src/integration/ceUnlock.local-pg.test.ts`: aprovação por
  pedido cobre todos os BLs; recusa sem motivo falha; recusar procuração mantém
  termo; cliente cancela rascunho e não cancela `submitted`; export marca BLs;
  `confirm`/`sent` recusados; `sla_started_at` recomeça após entrega posterior.

## Etapa 2 — Regra de prazo (SLA)

- [x] `src/services/ceUnlockSla.ts`: `ceUnlockDeadline(start: Date): Date`
  com D16 (antes das 12:00 → 17:00 do dia útil; a partir das 12:00 → 12:30 do
  próximo dia útil; fim de semana → como se fosse antes das 08:00 de segunda, janela da manhã), em
  America/Sao_Paulo, reutilizando a regra de dia útil de
  `agencyReportDeadline.ts`.
- [x] `src/services/__tests__/ceUnlockSla.test.ts`: 07:50, 11:59, 12:00, sexta
  14:00 → segunda 12:30, sábado → segunda (janela da manhã).

## Etapa 3 — Vela: abas Solicitações e Controle ZPT

- [x] `src/pages/DesbloqueioCe.tsx` com abas **Solicitações** e **Controle ZPT**
  (estado na URL, `?aba=`). Atualizar `RASTREABILIDADE.md` se a rota mudar.
- [x] Solicitações (D7–D10): uma linha por pedido `source='request'` em análise,
  BLs listados, botões Aprovar/Recusar por documento; reaproveitar
  `CeUnlockRequestDetail` sem a seleção de BLs.
- [x] Controle ZPT (D11–D13, D20–D23): caixas somente leitura para T. de
  Devolução, Procuração, Financeiro; caixa BL de Entrega clicável (confirmação
  curta ao marcar, motivo ao desmarcar); colunas Prazo (vencido/vence hoje) e
  Exportação/ZPT; filtro padrão "Aptos — não exportados"; remover
  "Registrar envio à ZPT", "Confirmar desbloqueio" e "Confirmações externas".
- [x] Rótulo "Termo de devolução" em `ceUnlockLabels.ts`, `CeUnlockRequirements`
  e documentos (D1).
- [x] Atualizar `src/pages/__tests__/DesbloqueioCe.test.tsx`.

## Etapa 4 — Portal

- [x] `PortalDesbloqueioCe.tsx`: botão Cancelar em `draft`/`changes_requested`
  (D4); prazo por BL e aviso de documentação validada (D5); remover textos de
  exportação/ZPT/desbloqueio confirmado (estados `exported`, `sent`,
  `confirmed` não aparecem no Portal); motivo da recusa visível.
- [x] Atualizar `src/pages/__tests__/PortalDesbloqueioCe.test.tsx`, incluindo
  ausência de "ZPT" e "Desbloqueio confirmado" no Portal.

## Etapa 5 — Notificações

- [x] Na mesma transação de `review` recusado e da conclusão (D6), inserir em
  `portal_notifications` (tipo novo, link `/portal/desbloqueio-ce?pedido=`).
- [x] E-mail para a caixa `documentacao_operacao` pelo pipeline de comunicações
  existente (catálogo `customer_communication_kinds`, chave global de
  Comunicados, supressão). Novos kinds: recusa e documentação validada.
  Escolher na execução entre enfileirar para `customer-communication-auto-runner`
  ou fila própria — sem envio síncrono dentro da RPC.
- [x] Teste: recusa gera uma notificação com o motivo; conclusão gera uma;
  repetição idempotente não duplica.
- [x] Atualizar `docs/operations/servicos-externos.md` se surgir job/segredo novo.

## Etapa 6 — Planilha de envio `zpt-5-v2`

- [x] `supabase/functions/ce-unlock-export` e `ceUnlockRules.ts`: cabeçalho
  `BL`, `Financeiro`, `Term. Devolucao`, `Procuracao`, `BL Entrega`; `Sim`/`Não`;
  `layout_version='zpt-5-v2'`; lotes antigos mantêm o layout gravado (D21).
- [x] Regenerar `test-fixtures/ce-unlock/` e atualizar seu README.

## Etapa 7 — Conciliação com o "Exportar Tela" da ZPT

- [x] Parser em `src/services/ceUnlockZptReconcile.ts` sobre `importCore.ts`:
  aba `Worksheet`, cabeçalhos da D24, CE numérico → texto de 15 dígitos, linha
  vazia final ignorada; descarta "Nome Usuario" e horários antes de enviar (D26).
- [x] RPC/ação `reconcile` (Administrativo/Documentação) recebendo
  `[{ce, status, descricao, data_atualizacao, pendentes[]}]`; grava resultado por
  BL e evento com resumo (conferidos, divergentes, ignorados, CE desconhecido)
  (D25). Sem efeito em SLA nem Portal (D27).
- [x] Botão "Importar arquivo da ZPT" no Controle ZPT, resumo da importação e
  filtro "Divergentes".
- [x] Teste do parser com fixtures anonimizadas derivadas dos dois arquivos de
  2026-10-07 (sem CPF/nome de operador); teste SQL da classificação D25.

## Etapa 8 — Documentação e verificação

- [x] `CONTEXT.md` (seção Desbloqueio de CE), `docs/modules/desbloqueio-ce.md`,
  `docs/RASTREABILIDADE.md`, `docs/CHANGELOG.md`.
- [x] Gates: `npm run docs:check`, `typecheck`, `lint`, `test`, `build`,
  `migrations:check`, `rpc:check`; suíte SQL local em ambiente descartável.
- [x] Ao concluir: arquivar este plano e a spec de 2026-10-07; avaliar se o
  plano de 2026-10-04 pode ser arquivado junto.

## Não comprovado ao final deste plano

- Aceitação do arquivo `zpt-5-v2` pela aba "Planilha desbloqueio" da ZPT
  (sem modelo oficial; conferir no primeiro upload real).
- Entrega real dos e-mails em produção.

## Execução (2026-10-07)

Evidência por etapa (ambiente: Windows, PostgreSQL local 16 com shims; CI Linux é a
referência final):

- **Etapa 1 — banco.** Migration `160_ce_unlock_fluxo_revisado.sql`. Suíte SQL real
  `ceUnlock.local-pg.test.ts`: 30/30 contra um banco com as migrations 139–160 (antes da
  mudança, 26/26 no mesmo harness). Testes antigos que dependiam de `confirm`/`sent`
  foram reescritos para exportação/conclusão; dois deles passavam por engano porque ação
  inexistente também lança erro — foram corrigidos para afirmar o efeito.
- **Etapa 2 — SLA.** `ceUnlockSla.ts` + teste; o banco tem `sla_deadline` e o teste SQL
  confere os mesmos casos.
- **Etapas 3–4 — telas.** Abas Solicitações/Controle ZPT, detalhe sem seleção de BL, Portal
  com cancelar, prazo e aviso; testes de componente/página atualizados e ampliados.
- **Etapa 5 — avisos.** Sino (`portal_notifications`) e fila `ce_unlock_email_outbox` na
  mesma transação; envio por `ce-unlock-notify-email` (fila própria, sem envio dentro
  da RPC). Lógica de fila e template testadas em vitest com dependências injetadas;
  **o envio real pela Resend não foi exercitado**.
- **Etapa 6 — planilha.** `zpt-5-v2`; amostra gerada em Node pela mesma função (o handler Deno
  não foi executado; não há Deno nesta máquina).
- **Etapa 7 — conciliação.** Parser validado em teste com .xls BIFF8 sintético e, fora do
  repositório, contra os dois arquivos reais de 07/10/2026 (38 desbloqueadas e 2.038 bloqueadas,
  sem erro de linha).
- **Etapa 8 — documentação e gates.** Ver estado final no CHANGELOG.

Divergências em relação ao plano, todas mecânicas ou decididas durante a execução:

- Sábado/domingo: "antes das 08:00 de segunda" (janela da manhã, 17:00), conforme a spec.
  O responsável também escreveu "até as 12h de segunda"; a constante está isolada em
  `ceUnlockSla.ts` e `sla_deadline` e pode ser trocada sem outra mudança.
- O desk pode cancelar solicitação *concluída* (a conclusão é reversível), desde que nenhum
  B/L tenha sido exportado.
- CE casa ignorando zeros à esquerda (a planilha da ZPT guarda o CE como número; um CE de
  14 dígitos apareceu no arquivo real).
- O harness SQL passou a mandar o SQL por stdin (argv do psql no Windows corrompe acentos).
- O teste temporário contra os arquivos reais não foi versionado (contém dados de clientes).
