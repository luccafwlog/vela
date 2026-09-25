# Plano — Política de exclusão de dados

Data: 2026-09-24. Estado: não iniciado.

Implementa as decisões das
[ADR 0071](../adr/0071-ce-mercante-como-trava-de-exclusao.md),
[ADR 0072](../adr/0072-toda-escrita-confirmada-com-consequencia.md),
[ADR 0073](../adr/0073-cadastro-usado-so-se-desativa.md) e
[ADR 0074](../adr/0074-usuarios-retencao-e-backup-diario.md), tomadas na
revisão da [auditoria de exclusão](../archive/audits/2026-09-24-revisao-exclusao-de-dados.md)
(PR luccafwlog/vela#757). O vocabulário está em `CONTEXT.md`, seção "Ações
sobre registros".

## Resultado pretendido

Ao final, no Vela:

- nenhum botão Excluir aparece para quem o banco não autoriza, e nenhuma
  tela mostra "excluído" quando nada foi apagado;
- toda exclusão com filhos acontece por inteiro ou não acontece;
- fatura, pagamento, recebível e liquidação não podem ser apagados nem pela
  API, e a trilha de auditoria não pode ser alterada;
- dados de viagem são excluíveis até a trava (CE Mercante, documento
  financeiro, ou ADR fechado para vazios) e, depois dela, só corrigidos,
  cancelados ou reemitidos;
- toda ação que grava, envia ou tira de circulação abre o diálogo da ADR
  0072, com motivo onde exigido;
- cadastros usados só se desativam; cliente desativado perde o Portal;
- o papel `admin` deixa de existir; retenção e backup diário funcionam.

**Fora de escopo:** soft delete genérico (rejeitado na ADR 0009); PITR
(rejeitado na ADR 0074); ferramenta de restauração a partir da auditoria;
exclusão ou desativação de navio, porto e armador.

## Restrições e fontes de verdade

- Autorização vale no banco (policy, grant, trigger, RPC); a tela só reflete
  (AGENTS.md). Cada fase entrega a regra no banco antes ou junto da tela.
- Migrations novas começam em `086_`. Migrations existentes e
  `src/types/database.ts` são protegidos; tipos se regeneram pelo
  procedimento do WORKFLOW.md.
- Migration que reescreve ou apaga linhas (ex.: `admin` → `administrativo`)
  declara no cabeçalho que depende do status de dados descartáveis do
  AGENTS.md; `npm run migrations:check` confere.
- Nenhuma parte do sistema faz UPDATE/DELETE em `audit_logs` (verificado em
  2026-09-24: só inserções, inclusive a marca de escala excluída); a trilha
  pode ficar imutável sem migrar dados.
- Cache: toda escrita nova usa `src/services/cacheEffects.ts`.
- Testes de banco usam o harness `src/integration/*.local-pg.test.ts`
  (`scripts/setup-local-pg.sh`); testes de tela, Vitest existente.

## Fases

Cada fase é uma PR independente, na ordem abaixo. As fases 1 e 2 não
dependem de decisões novas e podem começar já.

### Fase 1 — Proteções do banco (P1: A3, A4, A5)

Visível: nada muda na tela; uma tentativa de apagar fatura ou auditoria pela
API passa a falhar com erro.

- Revogar DELETE de `authenticated` e remover as policies de DELETE de
  `invoices`, `invoice_items`, `payments`, `bl_receivables`,
  `ledger_settlements`, com trigger de recusa como em `demurrage_invoices`.
  Conferir cascatas que partem dessas tabelas (itens, eventos, estornos).
- `audit_logs`: revogar UPDATE/DELETE, remover `audit_logs_update_admin` e
  `audit_logs_delete_admin`, trigger de recusa.
- `voyages`: adicionar `audit_row_changes`.
- Aceite: teste local-pg em que Administrativo tenta apagar fatura e
  auditoria e recebe erro; exclusão de viagem gera linha `excluido` em
  `audit_logs`.

### Fase 2 — Falso sucesso e cascata atômica (P1: A1, A2) e código morto

Visível: Excluir some para quem não pode; exclusão bloqueada mostra o motivo;
exclusão de B/L, container ou cliente não deixa filhos apagados pela metade.

- Botões: Clientes, Locais/Terminais e serviços, Taxas Locais (item e
  override) e Embarque de Vazios passam a usar `isAdmin` (Administrativo) em
  vez de `Boolean(profile || user)`.
- Services de exclusão pedem as linhas afetadas (`select` após `delete`) e
  tratam 0 linhas como erro; `logDeletions` só grava após exclusão
  confirmada.
- RPCs transacionais `delete_bls`, `delete_containers`, `delete_customers`:
  pré-checagem no banco (inclui `cod_adjustments`,
  `customer_communication_bls`, comunicações, disputas e anexos, grupos e
  faturas de cobrança), filhos, principal e auditoria na mesma transação;
  retorno com deletáveis e bloqueados com motivo. Os services passam a
  chamá-las; o navegador deixa de encadear DELETEs.
- Linha de serviço de vazios: policy de DELETE passa a `is_active_user()`
  (ADR 0071, item 4).
- Remover código sem tela: `deleteManifestoMercante` e hook (A9),
  `archive_vessel_schedule` e `src/services/vesselScheduleAdmin.ts`,
  `delete_baplie_manifest_for_voyage`.
- Aceite: teste local-pg para cada RPC com um bloqueio fora da pré-checagem
  atual (filhos continuam existindo); teste de tela para o botão oculto.

### Fase 3 — Diálogo de confirmação (ADR 0072) e vocabulário

Visível: toda escrita abre diálogo com o que faz, registros afetados,
consequência, reversibilidade e motivo onde exigido; "Voltar" fecha sem
executar; rótulos seguem `CONTEXT.md`.

- Estender `useConfirm` (ou componente irmão) com: lista de afetados e
  totais, consequência, reversibilidade, campo de motivo obrigatório,
  diff antes/depois para Salvar, lista expansível para lote.
- Consequência vem do mesmo lugar que executa: quando a cascata é decidida
  no banco, a RPC oferece modo de prévia (`p_dry_run`) usado pelo diálogo.
- Rótulos: "Remover cobrança manual" → Excluir; "Inativar tabela" →
  Desativar; "Cancelar convite" → "Revogar convite"; botão de fechar diálogo
  → Voltar.
- Adoção tela a tela, começando pelas ações de exclusão e cancelamento; a
  lixeira de unidade e de linha de serviço de vazios, hoje sem confirmação,
  entra primeiro.
- Aceite: teste de componente do diálogo; nenhuma chamada de escrita sem
  confirmação nas telas cobertas (checklist por tela neste plano).

### Fase 4 — Trava de exclusão e estados de viagem (ADR 0071)

Visível: Excluir viagem mostra tudo que vai junto e funciona com B/Ls sem
CE; escala e atracação ganham Excluir até a trava; B/L ganha Cancelar e
Reativar; viagem ganha Reativar; Chegadas e Saídas perde "Remover do Portal".

- Função de banco `is_delete_locked(entidade, id)` com a regra da ADR
  (CE do B/L, documento financeiro, ADR fechado para vazios) e guardas nas
  RPCs de exclusão.
- `delete_voyage` transacional em cascata, com prévia; substitui a regra
  "sem nenhum vínculo" de `trg_guard_voyage_hard_delete`.
- Excluir escala (importação e exportação iguais) e Excluir atracação, com a
  trava e o Administrativo (A8).
- B/L: estado `cancelled`, `cancel_bl`/`reactivate_bl` com motivo; bloqueio
  com fatura ou recebível aberto; filtros de faturamento e do Portal; Portal
  mostra cancelado se já liberado; unicidade do CE só entre B/Ls não
  cancelados (índice parcial).
- Viagem: `reactivate_voyage` com motivo.
- Apagar CE: permitido só sem fatura emitida e sem liberação no Portal.
- Taxa manual do B/L: `delete_manual_bl_charge` exige Administrativo.
- Chegadas e Saídas: remover a ação e `setVoyageShowOnPortal(false)` da tela.
- Aceite: testes local-pg da trava por entidade e da cascata; testes de
  tela das novas ações.

### Fase 5 — Cadastros (ADR 0073)

Visível: tarifas e locais usados só mostram Desativar; item e override ganham
Desativar; cliente ganha Desativar; cliente desativado não entra no Portal.

- Estado ativo em item de taxa e override; cálculo ignora desativados.
- Tarifa de Granito: FK deixa de ser `SET NULL`; exclusão de tarifa usada
  bloqueada com mensagem legível em todas as tarifas.
- Ativar/desativar tabela de Taxas Locais passa ao Administrativo.
- Cliente: estado desativado; `deactivate_customer` bloqueado com fatura ou
  recebível em aberto; sessão e login do Portal recusados; vínculo automático
  por CNPJ envia o B/L à Revisão com motivo "cliente desativado".
- Locais e serviços: "Inativar" → Desativar, mensagem de bloqueio legível.
- Aceite: testes local-pg de bloqueio e do login do Portal; teste da Revisão.

### Fase 6 — Usuários, retenção e backup (ADR 0074)

Visível: nenhum papel "admin" nas telas de usuários; nada muda no dia a dia.

- Migration: `admin` → `administrativo`, CHECK sem `admin`, remover o mapeamento
  em `src/hooks/useAuth.tsx`. Cabeçalho declara dependência do status de
  dados descartáveis.
- Rotina de retenção (`pg_cron`, configuração no Vault conforme ADR 0063):
  expurgo de `audit_logs` > 5 anos e de eventos/tentativas do Portal > 1 ano;
  anonimização de contatos, contas do Portal e usuários desativados há mais de
  2 anos, inclusive nas cópias em `audit_logs` — exceção controlada à trilha
  imutável, executada só pela rotina.
- Backup diário: agendar o procedimento de `docs/operations/backup-r2.md` e
  testar uma restauração; atualizar `docs/operations/servicos-externos.md`.
- Aceite: teste local-pg da rotina com datas simuladas; registro de uma
  restauração bem-sucedida.

## Decisões pendentes

- **Fase 6, backup:** o agendamento diário é a Etapa 6 do
  [plano de serviços e Cloudflare](2026-09-24-configuracao-servicos-e-migracao-cloudflare.md),
  executada pelo dono no painel; esta fase só confirma que ela foi concluída
  e que uma restauração foi testada.
- **Fase 6, anonimização em `audit_logs`:** confirmar a forma da exceção
  (substituir campos pessoais no JSON guardado) quando a fase começar.
- Nenhuma outra decisão de produto bloqueia as fases 1 a 5.

## Checks por fase

`npm run docs:check`, `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`; com migration, também `npm run migrations:check` e
`npm run rpc:check` e os testes local-pg da fase. Comportamento em runtime por
papel (Financeiro, Administrativo) é verificado no Preview da PR antes do
merge das fases 2, 4 e 5.

## Riscos e rollback

- Cascata de viagem (Fase 4) é a mudança mais destrutiva: só entra depois da
  Fase 1 (auditoria da viagem) e da Fase 3 (prévia no diálogo).
- Revogar DELETE fiscal (Fase 1) pode quebrar algum fluxo que apague itens de
  fatura aberta; `delete_manual_invoice_charge` é SECURITY DEFINER e deve
  continuar funcionando — cobrir com teste.
- Rollback: cada fase é uma migration nova e reversível por outra migration;
  mudanças de tela revertem com a PR.

## Encerramento

Ao concluir a última fase, mover este plano para `docs/archive/plans/`,
tirar a linha de `docs/plans/README.md` e trocar "implementação pendente"
por notas de implementação nas ADRs 0071–0074 e em `CONTEXT.md`.
