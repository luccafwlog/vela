# 2026-10-14 — Correções decididas na revisão geral

Plano vivo das correções de código decididas pelo dono em 2026-10-14
([ADR 0083](../adr/0083-decisoes-da-revisao-geral-da-documentacao.md)). Os
casos práticos e a evidência de cada item estão no
[plano arquivado da revisão](../archive/plans/2026-10-13-revisao-geral-documentacao.md).
Cada item é uma mudança separada: código, teste de regressão e a troca de
"correção pendente" pela regra entregue no módulo dono, na mesma mudança.

A evidência dos defeitos é leitura estática; reproduza antes de corrigir
(`AGENTS.md`, "Start with the affected behavior"). O que está marcado como
**Suspeita** pode não se confirmar.

## Ordem

Por impacto: segurança e dados primeiro, depois o que bloqueia uma ativação,
depois o que o usuário vê errado, por último o que é só texto.

| # | Item | O que muda | Decisão |
|---|---|---|---|
| 1 | B1 | Trocar o CE de um B/L com Desbloqueio conferido abre `ce_trocado_com_desbloqueio` e avisa na prévia (o código procura a confirmação removida na migration `160`). Bloqueia a ativação do Desbloqueio de CE. | ADR 0078, item 4 |
| 2 | A21 | Remover `upsert_customer_portal_account`, `set_customer_portal_account_active`, o job `cleanup-portal-sessions` e `customer_portal_sessions`; fechar a escrita direta de `cpa_admin_all`. Migration declara que se apoia no "Data status". | ADR 0083, item 21 |
| 3 | A14 | Só o job do BCB e o Informar PTAX gravam a referência cambial (ROE); o cabeçalho e a API deixam de gravar. | ADR 0083, item 14 |
| 4 | B27 + A23 | `resolve_billing_alert` recomputa a origem no servidor; alertas fecham pela origem quando há fato verificável; tipos de conferência sem fato (ex.: `portal_abuso_login`) ganham "Resolver com justificativa" com motivo e histórico; "Reenviar Comunicado de CE e Taxas" fecha com o reenvio. | ADR 0053; ADR 0083, item 23 |
| 5 | A2 | Banco recusa rebaixar ou desativar o último Administrativo ativo; a tela explica. | ADR 0083, item 2 |
| 6 | A3 | Revogar a exclusão de perfil interno no banco. | ADR 0083, item 3 |
| 7 | A16 | Plano B pelo extrato acha Invoice de Demurrage e fatura avulsa pelo TXID; "Escolher fatura…" lista essas faturas. | ADR 0083, item 16 |
| 8 | B3 | Uma regra única para NOB com B/L misto ou exceção de terminal na produtora, na conferência manual, na Edge Function e na RPC. | ADR 0067 e 0068 |
| 9 | B4 | Cliente do NOB sem contato não aborta a produtora automática (Suspeita). | ADR 0064 |
| 10 | A22 + B18 + B20 | Edge Function aceita as caixas Documentação/Operação e Financeiro no Comunicado de CE e Taxas; o mapa caixa → modelo sai do navegador; a produtora deixa de ler `customer_contact_preferences`. | ADR 0064; ADR 0083, item 22 |
| 11 | B19 | Catalogar `caixa_sem_destinatario` e `cliente_sem_contato_principal`, com verbete em `/alertas/regras`. | ADR 0064 |
| 12 | A9 | `create_manual_invoice` aceita qualquer usuário interno ativo, com motivo e rastro; o botão aparece para todos os setores. | ADR 0083, item 9 |
| 13 | A10 | Lançamento manual e "Item da tabela" da avulsa escolhem tabela e Condição de Cliente pela regra do cálculo automático. | ADR 0040; ADR 0083, item 10 |
| 14 | A11 | O painel de COD deixa de pedir "Cancelar e reemitir"; o Ajuste de COD se liquida com a fatura sucessora. | ADR 0083, item 11 |
| 15 | A19 | `portal-daily-digest` inclui a exceção crítica de fatura (abertura e fechamento). | ADR 0083, item 19 |
| 16 | A18 | Console `/clientes/portal` deixa de mascarar Email de Recuperação, origem, entrega e candidatos para Operações. | ADR 0045; ADR 0083, item 18 |
| 17 | A7 | Banco recusa excluir escala com B/L. | ADR 0083, item 7 |
| 18 | A8 | Unicidade da omissão de escala só entre não revertidas. | ADR 0083, item 8 |
| 19 | A13 | E-mail da Régua de Cobrança mostra o USD líquido. | ADR 0083, item 13 |
| 20 | A15 | Régua retoma após disputa ancorada no último envio. | ADR 0083, item 15 |
| 21 | B29 | Invoice de Demurrage não vence: a ficha do Cliente deixa de contar Demurrage vencida. | ADR 0014 |
| 22 | B30 | Detalhe da Invoice de Demurrage no Portal mostra free time e valor por período de cada container. | ADR 0083, item 26 |
| 23 | B2, B5, B6, B8, B9 | ADR operacional: carga por terminal e exceção de terminal do B/L; sign-off recusa seção Pendente na RPC; escala sem terminal não cai no ADR legado; Linha do Tempo mostra o ATD; prazo em dia útil local. | ADR 0029, 0035, 0036, 0039, 0068 |
| 24 | B7, B10, B11, B12, B26 | Vazios e viagem: seção Veículos fora do painel de Documentação; Embarque de Vazios em viagem só de embarque; Total do Embarque sem percentual legado; atalho de armazenagem reconhece serviço sem condição; importações e Embarque abertos pela viagem não a travam. | ADR 0018, 0033, 0035 |
| 25 | B13, B14, B15, B31 | Ações sobre registros: reativar tarifa e usuário pedem motivo e dizem "Reativar"; trava de Vazios pelo ADR de Saída e motivo em Excluir unidade; Local, terminal e serviço do depot com diálogo, papel e motivo; Salvar do depot mostra antes e depois. | ADR 0071, 0072, 0073 |
| 26 | B16, B17 | Revisão: sugestão de Cliente por nome também na Revisão e na ficha; B/L com CNPJ de Cliente desativado mostra o motivo. | ADR 0043, 0073 |
| 27 | B21, B22, B23 | Importações: peso de faturamento do B/L misto; planilha-modelo de CE com 15 dígitos; exemplo de 13 caracteres no Nº do manifesto. | ADR 0017, 0078 |
| 28 | B24 | Markup 1,065 num ponto canônico só. | ADR 0014 |
| 29 | B25 | `portal_provisioning_backfill` sai do catálogo. | Migration arquivada `203` |
| 30 | B28 | O diálogo "Vincular cliente ao grupo" avisa que o e-mail do manifesto entra como contato. | ADR 0083, item 26 |
| 31 | A4 | `.claude/hooks/protect-files.sh` bloqueia só migrations existentes. | ADR 0083, item 4 |

## Operação (fora do código)

| Item | O que fazer | Quem |
|---|---|---|
| A6 | Heartbeat do backup diário no Better Stack agora; executor sempre ligado antes de revogar o "Data status". O script já avisa o heartbeat quando `BETTERSTACK_HEARTBEAT_BACKUP_URL` existe. | Dono: heartbeat `backup-r2-diario` criado em 2026-10-14; falta a variável no computador da tarefa e a primeira execução, com o [roteiro](../operations/backup-r2.md#heartbeat-do-backup) |

B32 (apagar a Edge Function antiga de aviso de fatura emitida) foi feito pelo
dono em 2026-10-14; a listagem de produção conferida depois não a tem
([Serviços externos](../operations/servicos-externos.md#edge-functions)).

## Só documentação (já aplicado com a ADR 0083)

A1 (Restituição), A5 (exceção ao cofre), A12 (excedente à mão), A17 (exceção
sem TXID), A20 (desenho de GO LIVE arquivado), A24 (audiência), A25
(reconsolidação) e C1 ([ADR 0084](../adr/0084-registro-de-decisoes-ja-em-producao.md)).

## Fim

O plano vai para `docs/archive/plans/` quando o último item estiver entregue.
