# 2026-10-14 — Correções decididas na revisão geral e no modelo de permissões

Plano vivo das correções de código decididas pelo dono em 2026-10-14: as da
revisão geral ([ADR 0083](../adr/0083-decisoes-da-revisao-geral-da-documentacao.md);
itens A e B) e as do modelo de permissões por perfil
([ADR 0085](../adr/0085-modelo-de-permissoes-por-perfil.md); itens P). Os
casos práticos e a evidência estão no
[plano arquivado da revisão](../archive/plans/2026-10-13-revisao-geral-documentacao.md)
e no [relatório do modelo de permissões](../archive/reports/2026-10-14-modelo-de-permissoes-por-perfil.md);
a regra de quem faz o quê está na
[matriz de Segurança](../operations/seguranca.md#modelo-de-permissões-por-perfil).
Cada item é uma mudança separada: código, teste de regressão e a troca de
"correção pendente" pela regra entregue no módulo dono, na matriz de Segurança
quando o item aparece nela e no manual financeiro quando a coluna Responsável
diz "hoje", na mesma mudança. Mudança de banco é migration nova; migration
existente não se edita. Cite os itens pelo código (A9, B14, P5), não pela
posição na fila, que muda quando entra item novo. Os códigos P deste plano não
são as faixas P1 e P2 da Demurrage; fora daqui e da matriz, escreva "item P2
do plano".

A evidência dos itens A e B e dos itens P4 a P12 e P14 é leitura estática;
reproduza antes de corrigir (`AGENTS.md`, "Start with the affected behavior"),
no Postgres local de `scripts/setup-local-pg.sh`. O que está marcado como
**Suspeita** pode não se confirmar. P1, P2, P3, P13 e P15 já foram
reproduzidos no Postgres local como o perfil citado (relatório do modelo de
permissões). Item de permissão leva teste `local-pg`
que executa a ação como cada perfil, inclusive a escrita direta pela API.

## Ordem

Por impacto: segurança e dados primeiro, depois o que bloqueia uma ativação,
depois o que o usuário vê errado, por último o que é só texto. O B1 fica à
frente porque bloqueia a ativação do Desbloqueio de CE.

| # | Item | O que muda | Decisão |
|---|---|---|---|
| 1 | B1 | Trocar o CE de um B/L com Desbloqueio conferido abre `ce_trocado_com_desbloqueio` e avisa na prévia (o código procura a confirmação removida na migration `160`). Bloqueia a ativação do Desbloqueio de CE. | ADR 0078, item 4 |
| 2 | P2 | **Valores de cobrança só pelas RPCs.** Revogar INSERT, UPDATE e DELETE de `authenticated` em `demurrage_invoice_items` e INSERT, UPDATE e DELETE em `charge_calculations`, removendo a policy `charge_calculations_delete_admin` (o navegador só lê as duas; conferir de novo os chamadores antes). Teste: Operações altera dias e diária de item de Invoice emitida, move o item para outra invoice, muda o THC do cálculo e zera taxa manual, e o Administrativo apaga linha de `charge_calculations` → recusado; emissão, recálculo, `add_manual_bl_charge` e `delete_manual_bl_charge` seguem funcionando. | ADR 0077; ADR 0071, item 11; ADR 0085, falha 1 |
| 3 | P3 | **Contatos e situação financeira do B/L.** Revogar INSERT e UPDATE de `authenticated` em `customer_contacts` (a tela usa `internal_save_customer_contact_configuration`; apagar `upsertCustomerContact` e `deleteCustomerContact`, sem chamador em `src/services/customers.ts`). Gatilho BEFORE INSERT/UPDATE OF `financial_status` em `bls` que recusa a mudança quando `current_user = 'authenticated'` (as RPCs de faturamento rodam como dono); um REVOKE de coluna não basta enquanto existir o grant de UPDATE da tabela. Antes do gatilho, conferir as funções `SECURITY INVOKER` que gravam a coluna: `register_invoice_payment` (migration `002`) é INVOKER, grava `payments`, `invoices` e `bls.financial_status`, e só tem o chamador sem uso `registerInvoicePayment` em `src/services/billing.ts`; removê-la ou torná-la DEFINER. Teste: Financeiro troca o e-mail do contato principal e Operações marca B/L como faturado → recusado. | ADR 0060; ADR 0085, falhas 2 e 3 |
| 4 | P15 | **Faturas, pagamentos e recebíveis só pelas RPCs.** Revogar INSERT e UPDATE de `authenticated` em `invoices`, `invoice_items`, `payments`, `ledger_settlements` e `bl_receivables` e remover as policies `is_admin()` de escrita (migration `002`); conferir antes que o navegador só lê essas tabelas e quais funções `SECURITY INVOKER` as escrevem (`register_invoice_payment`, ver P3). Teste: o Administrativo lança pagamento sem referência bancária, dá a fatura como paga, cancela sem motivo, muda o valor de item de fatura emitida e quita o recebível pela API → recusado; as RPCs de emissão, baixa, cancelamento e correção seguem funcionando. | ADR 0077; ADR 0085, falha 5 |
| 5 | A21 | Remover `upsert_customer_portal_account`, `set_customer_portal_account_active`, o job `cleanup-portal-sessions` e `customer_portal_sessions`; fechar a escrita direta de `cpa_admin_all`. Migration declara que se apoia no "Data status". | ADR 0083, item 21 |
| 6 | A7 + P1 | Banco recusa excluir escala com B/L. **Exclusão só pela RPC (P1).** Revogar o DELETE direto de `authenticated` e remover as policies de DELETE `is_admin()` em todas as tabelas que as têm, gerando a lista pelo catálogo (`pg_policies` × grants). No Postgres local de 2026-10-14 eram: `voyage_export_schedules`, `vessels`, `ports`, `carriers`, `charge_tables`, `baplie_containers`, `billing_batches`, `bl_breakbulk_items`, `bl_freight_lines`, `ended_vessels`, `granite_bl_charges`, `granite_bls`, `granite_manifests`, `import_batches`, `import_errors`, `vazios_bookings`, `vazios_export_operations`, `vazios_importacao_containers`, `vazios_importacao_manifests`, `vazios_manifests`, `vessel_schedules` e `voyage_route_ce_master` (as de fatura ficam no P15, `charge_calculations` e `demurrage_invoice_items` no P2 e `user_profiles` no A3). Hoje não têm motivo nem Trava: a escala de exportação travada pelo CE e o Baplie de viagem com CE saem pela API. A tela não apaga essas tabelas direto; se um cadastro precisar de exclusão, ela entra em `delete_catalog_row`, com motivo. Teste: o Administrativo apaga pela API → recusado; `delete_escala`, `delete_records` e `delete_catalog_row` continuam apagando o que não tem trava. | ADR 0083, item 7; ADR 0071; ADR 0085, falha 4 |
| 7 | A14 | Só o job do BCB e o Informar PTAX gravam a referência cambial (ROE); o cabeçalho e a API deixam de gravar. | ADR 0083, item 14 |
| 8 | P13 | **Baplie sem container recusado no banco.** `import_baplie_staging_transactional` recusa `p_rows` vazio, com mensagem; hoje apaga o Baplie da viagem (reproduzido no Postgres local). A tela já bloqueia (`canImportPreview`). Teste: lista vazia como qualquer perfil → recusada, Baplie anterior intacto. | ADR 0085, D15 |
| 9 | B27 + A23 | `resolve_billing_alert` recomputa a origem no servidor; alertas fecham pela origem quando há fato verificável; tipos de conferência sem fato (ex.: `portal_abuso_login`) ganham "Resolver com justificativa" com motivo e histórico; "Reenviar Comunicado de CE e Taxas" fecha com o reenvio. | ADR 0053; ADR 0083, item 23 |
| 10 | A2 | Banco recusa rebaixar ou desativar o último Administrativo ativo; a tela explica. | ADR 0083, item 2 |
| 11 | A3 | Revogar a exclusão de perfil interno no banco. | ADR 0083, item 3 |
| 12 | P11 | **Autor é quem está logado.** `_assert_actor_is_caller` (migration `106`) deixa de aceitar outro autor para o Administrativo; jobs com `service_role` seguem assinando `sistema`. As RPCs de faturamento que gravam `COALESCE(p_actor, auth.uid())` sem conferir (`create_invoice_from_bls`, `create_invoice_from_bls_with_ledger` e, por elas, `mark_bl(s)_ready_and_create_invoice`, `create_local_consolidated_invoice`, `register_invoice_payment`, `register_ledger_invoice_payment`, `cancel_invoice`, `obsolete_consolidated_invoice`, `reverse_demurrage_payment`) passam a conferir ou perdem `p_actor`; isso vem antes do P4 e do P5, que abrem essas RPCs a outros Departamentos. Conferir que a tela passa o próprio usuário ou nada em `add_manual_bl_charge`, `calculate_bl_local_charges`, `run_billing_for_import_batch` e `reject_customer_reconciliation`. | ADR 0085, regra base 2 |
| 13 | A16 | Plano B pelo extrato acha Invoice de Demurrage e fatura avulsa pelo TXID; "Escolher fatura…" lista essas faturas. | ADR 0083, item 16 |
| 14 | B3 | Uma regra única para NOB com B/L misto ou exceção de terminal na produtora, na conferência manual, na Edge Function e na RPC. | ADR 0067 e 0068 |
| 15 | B4 | Cliente do NOB sem contato não aborta a produtora automática (Suspeita). | ADR 0064 |
| 16 | A22 + B18 + B20 | Edge Function aceita as caixas Documentação/Operação e Financeiro no Comunicado de CE e Taxas; o mapa caixa → modelo sai do navegador; a produtora deixa de ler `customer_contact_preferences`. | ADR 0064; ADR 0083, item 22 |
| 17 | B19 | Catalogar `caixa_sem_destinatario` e `cliente_sem_contato_principal`, com verbete em `/alertas/regras`. | ADR 0064 |
| 18 | A9 + P4 | `create_manual_invoice` aceita qualquer usuário interno ativo, com motivo e rastro; o botão já aparece para todos os setores e hoje o banco recusa. **Emissão por qualquer Departamento (P4).** Trocar `is_admin()` por usuário interno ativo em `mark_bl_ready_and_create_invoice`, `mark_bls_ready_and_create_invoice`, `create_invoice_from_bls*`, `create_local_consolidated_invoice`, `issue_demurrage_invoice_for_bl` (e o caminho de `create_demurrage_invoice_authoritative`), `retry_pending_consolidated_reissue`, `retry_invoice_basis_changes` e `resolve_stale_invoice`. Tela: Emitir fatura da ficha do B/L, Gerar Invoice da Demurrage, Tentar reemitir, Tentar aplicar correção, Tentar emitir para o novo Cliente e Resolver alerta para todos; a emissão automática pela Revisão deixa de receber `42501`. "Preparar cancelamento financeiro" continua só do Administrativo. | ADR 0083, item 9; ADR 0085, D3 |
| 19 | P5 | **Baixa, Restituição, desconto e Conciliação PIX.** Baixa manual local (`register_verified_invoice_payment`, `register_invoice_payment`, `register_ledger_invoice_payment`) para Financeiro e Administrativo; trocar a guarda não basta em `register_invoice_payment`, que é INVOKER e escreve sob as policies `is_admin()` (ver P3). Autorizar restituição excepcional e cancelar autorização pendente (`request_financial_refund`, `cancel_financial_refund_authorization`) para qualquer Departamento, com motivo. Desconto de Demurrage (`apply_demurrage_discount`) para qualquer Departamento. Conciliação PIX: leitura (RPCs `list_*` e `itau_pix_monitor`, página `/reconciliacao`) para todos; conciliar (vincular, confirmar, tratar exceção, marcar recebimento Itaú) para Financeiro e Administrativo, com guarda própria em `confirm_unified_pix_matches`. Alertas "Pix não conciliado" (`pix_unreconciled`, migration `078`), "Restituição pendente" (`128`) e "Fatura desatualizada" (`124`) passam a incluir o Financeiro na audiência (`alert_type_catalog`); o Administrativo continua, e o Pix não conciliado mantém Documentação e Equipamentos. Cancelar baixa e cancelar fatura seguem só do Administrativo. Ajustar textos como "Somente o Administrativo registra recebimentos". | ADR 0085, base, D2, D4, D5 e D18 |
| 20 | A10 | Lançamento manual e "Item da tabela" da avulsa escolhem tabela e Condição de Cliente pela regra do cálculo automático. | ADR 0040; ADR 0083, item 10 |
| 21 | A11 | O painel de COD deixa de pedir "Cancelar e reemitir"; o Ajuste de COD se liquida com a fatura sucessora. | ADR 0083, item 11 |
| 22 | A19 | `portal-daily-digest` inclui a exceção crítica de fatura (abertura e fechamento). | ADR 0083, item 19 |
| 23 | A18 + P12 | Console `/clientes/portal` deixa de mascarar Email de Recuperação, origem, entrega e candidatos para Operações. **Leitura global nas telas restantes (P12).** Desbloqueio de CE: `ce_unlock_private.actor()` e `ce_unlock_read` em `useAuth` aceitam Equipamentos na leitura; documentos do pedido abertos a todos (`ce_unlock_document_access` deixa de exigir `actor(true)` na leitura, `ce_unlock_documents` em `useAuth` e a Edge `ce-unlock-document-download` aceitam qualquer Departamento). Demurrage: `list_demurrage_disputes_internal` e a aba Disputas para todos; responder, reabrir e anexar seguem de Equipamentos e do Administrativo. Portal: `portal_list_provisioning_events` aceita Operações e a seção Histórico do console deixa de falhar para esse perfil. | ADR 0045; ADR 0083, item 18; ADR 0085, D11, D12, D16 e D17 |
| 24 | P6 | **Viagens.** `reopen_agency_departure_report` e `_by_report_id` para qualquer Departamento, mantendo a justificativa obrigatória que já existe (vai para `audit_logs`); `revert_voyage_omission` para qualquer Departamento, com motivo. Botões para todos. | ADR 0085, D8 e D9 |
| 25 | P7 | **Reprocessar efeito de importação.** `retry_import_effect` aceita Equipamentos. | ADR 0085, D10 |
| 26 | P8 | **Central de Informações do Portal.** `internal_save_portal_information` aceita qualquer Departamento em todos os tipos; `/clientes/informacoes` libera a edição. | ADR 0085, D7 |
| 27 | P9 | **Tarifas de Demurrage e Granito.** Policies de INSERT e UPDATE de `demurrage_rates` e `customer_demurrage_agreements` para usuário interno ativo (a troca de `active` segue com o gatilho da migration `091`); telas de tarifa, acordo e Granito mostram Nova e Editar a todos e Ativar, Desativar e Excluir só ao Administrativo. | ADR 0085, D6; ADR 0073, item 4 |
| 28 | A8 | Unicidade da omissão de escala só entre não revertidas. | ADR 0083, item 8 |
| 29 | A13 | E-mail da Régua de Cobrança mostra o USD líquido. | ADR 0083, item 13 |
| 30 | A15 | Régua retoma após disputa ancorada no último envio. | ADR 0083, item 15 |
| 31 | B29 | Invoice de Demurrage não vence: a ficha do Cliente deixa de contar Demurrage vencida. | ADR 0014 |
| 32 | B30 | Detalhe da Invoice de Demurrage no Portal mostra o valor por período (P1/P2) de cada container; o free time já aparece desde o lote 1 da identidade. O recibo impresso ganha o free time. | ADR 0083, item 26 |
| 33 | B2, B5, B6, B8, B9 | ADR operacional: carga por terminal e exceção de terminal do B/L; sign-off recusa seção Pendente na RPC; escala sem terminal não cai no ADR legado; Linha do Tempo mostra o ATD; prazo em dia útil local. | ADR 0029, 0035, 0036, 0039, 0068 |
| 34 | B7, B10, B11, B12, B26 | Vazios e viagem: seção Veículos fora do painel de Documentação; Embarque de Vazios em viagem só de embarque; Total do Embarque sem percentual legado; atalho de armazenagem reconhece serviço sem condição; importações e Embarque abertos pela viagem não a travam. | ADR 0018, 0033, 0035 |
| 35 | B13, B14, B15, B31 | Ações sobre registros: reativar tarifa e usuário pedem motivo e dizem "Reativar"; trava de Vazios pelo ADR de Saída e motivo em Excluir unidade; Local, terminal e serviço do depot com diálogo, papel e motivo; Salvar do depot mostra antes e depois. | ADR 0071, 0072, 0073 |
| 36 | B16, B17 | Revisão: sugestão de Cliente por nome também na Revisão e na ficha; B/L com CNPJ de Cliente desativado mostra o motivo. | ADR 0043, 0073 |
| 37 | B21, B22, B23 | Importações: peso de faturamento do B/L misto; planilha-modelo de CE com 15 dígitos; exemplo de 13 caracteres no Nº do manifesto. | ADR 0017, 0078 |
| 38 | B24 | Markup 1,065 num ponto canônico só. | ADR 0014 |
| 39 | B25 | `portal_provisioning_backfill` sai do catálogo. | Migration arquivada `203` |
| 40 | P10 | **Função sem tela.** Remover a RPC legada `add_agency_report_occurrence`, que perdeu a tela quando as Ocorrências viraram observações por seção (ADR 0030) e ainda recusa o Financeiro. Conferir chamadores e testes antes. (`archive_vessel_schedule`, do item 12 da ADR 0071, já saiu na migration `087`.) | ADR 0030; ADR 0085 (funções sem tela) |
| 41 | B28 | O diálogo "Vincular cliente ao grupo" avisa que o e-mail do manifesto entra como contato. | ADR 0083, item 26 |
| 42 | P14 | **Texto do perfil e bateria por perfil.** Atualizar `PROFILE_SCOPES` (`src/services/adminUsers.ts`), que ainda descreve só as três exceções da ADR 0046. Criar uma suíte `local-pg` que percorre a matriz de Segurança e, para cada linha, executa a ação como cada perfil e confere permitido ou recusado, inclusive a escrita direta pela API nas tabelas de P1, P2, P3 e P15. Registrar a suíte em `scripts/local-pg-suites.txt`. | ADR 0085, Consequências; relatório do modelo de permissões, seção 3.1 |
| 43 | A4 | `.claude/hooks/protect-files.sh` bloqueia só migrations existentes. | ADR 0083, item 4 |

## Operação (fora do código)

| Item | O que fazer | Quem |
|---|---|---|
| A6 | Heartbeat do backup diário no Better Stack agora; executor sempre ligado antes de revogar o "Data status". O script já avisa o heartbeat quando `BETTERSTACK_HEARTBEAT_BACKUP_URL` existe. | Dono: heartbeat `backup-r2-diario` ligado e **Up** em 2026-10-14 ([Serviços externos](../operations/servicos-externos.md#backup)); falta o executor sempre ligado, antes de revogar o "Data status" |

B32 (apagar a Edge Function antiga de aviso de fatura emitida) foi feito pelo
dono em 2026-10-14; a listagem de produção conferida depois não a tem
([Serviços externos](../operations/servicos-externos.md#edge-functions)).

## Só documentação (já aplicado com as ADRs 0083 e 0085)

A1 (Restituição), A5 (exceção ao cofre), A12 (excedente à mão), A17 (exceção
sem TXID), A20 (desenho de GO LIVE arquivado), A24 (audiência), A25
(reconsolidação) e C1 ([ADR 0084](../adr/0084-registro-de-decisoes-ja-em-producao.md)). Da ADR 0085: D1 (cancelar fatura, só Administrativo), D13 (cobertura do Administrativo no ADR de Saída) e D14 (desmarcar exportação da escala), que confirmam o comportamento atual.

## Fim

O plano vai para `docs/archive/plans/` quando o último item estiver entregue
e a matriz de Segurança não tiver mais "correção pendente" vinda das ADRs 0083
e 0085.
