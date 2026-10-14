# 2026-10-14 — Modelo de permissões por perfil

Plano vivo das correções de código decididas pelo dono em 2026-10-14
([ADR 0085](../adr/0085-modelo-de-permissoes-por-perfil.md)). A regra vigente,
ação por ação, está na
[matriz de Segurança](../operations/seguranca.md#modelo-de-permissões-por-perfil);
o inventário e a evidência de cada caso, no
[relatório de 2026-10-14](../archive/reports/2026-10-14-modelo-de-permissoes-por-perfil.md).

Cada item é uma mudança separada: migration nova (nunca editar migration
existente), ajuste da tela, teste de RLS por perfil e a troca de "correção
pendente" por "vigente" na matriz, na mesma mudança. Antes de corrigir,
reproduza no Postgres local (`scripts/setup-local-pg.sh`) como o perfil
citado; os itens P1 a P3 já têm a reprodução descrita no relatório.

Itens da ADR 0083 que tocam permissão continuam no
[plano de correções](2026-10-14-correcoes-decididas-na-revisao-geral.md):
ROE (item 3), Administrativo ativo mínimo (item 5), exclusão de perfil
interno (item 6), fatura avulsa (item 12), console do Portal para Operações
(item 16), escala com B/L (item 17) e trava dos Vazios e Local/serviço do
depot (item 25).

## Ordem

Por impacto: P1 a P3 são falhas de segurança confirmadas por execução (o
banco aceita pela API o que a regra proíbe); depois as permissões que a regra
abre ou fecha; por último o texto e a bateria de testes.

| # | Item | O que muda | Decisão |
|---|---|---|---|
| P1 | Exclusão só pela RPC | Revogar o DELETE direto de `authenticated` em `voyage_export_schedules`, `vessels`, `ports`, `carriers` e `charge_tables` (hoje policy `is_admin()` sem motivo nem Trava; a escala de exportação travada pelo CE sai pela API). A tela não apaga essas tabelas direto; se um cadastro precisar de exclusão, ela entra em `delete_catalog_row`, com motivo. Teste: o Administrativo apaga pela API → recusado; `delete_escala` continua apagando a escala sem trava. | ADR 0071; ADR 0085, falha 4 |
| P2 | Valores de cobrança só pelas RPCs | Revogar INSERT, UPDATE e DELETE de `authenticated` em `demurrage_invoice_items` e INSERT e UPDATE em `charge_calculations` (o navegador só lê as duas; conferir de novo os chamadores antes). Teste: Operações altera dias e diária de item de Invoice emitida, move o item para outra invoice, muda o THC do cálculo e zera taxa manual → recusado; emissão, recálculo, `add_manual_bl_charge` e `delete_manual_bl_charge` seguem funcionando. | ADR 0077; ADR 0071, item 11; ADR 0085, falha 1 |
| P3 | Contatos e situação financeira do B/L | Revogar INSERT e UPDATE de `authenticated` em `customer_contacts` (a tela usa `internal_save_customer_contact_configuration`; apagar `upsertCustomerContact` e `deleteCustomerContact`, sem chamador em `src/services/customers.ts`). Gatilho BEFORE INSERT/UPDATE OF `financial_status` em `bls` que recusa a mudança quando `current_user = 'authenticated'` (as RPCs de faturamento rodam como dono); um REVOKE de coluna não basta enquanto existir o grant de UPDATE da tabela. Teste: Financeiro troca o e-mail do contato principal e Operações marca B/L como faturado → recusado. | ADR 0060; ADR 0085, falhas 2 e 3 |
| P4 | Emissão por qualquer Departamento | Trocar `is_admin()` por usuário interno ativo em `mark_bl_ready_and_create_invoice`, `mark_bls_ready_and_create_invoice`, `create_invoice_from_bls*`, `create_local_consolidated_invoice`, `issue_demurrage_invoice_for_bl` (e o caminho de `create_demurrage_invoice_authoritative`), `retry_pending_consolidated_reissue`, `retry_invoice_basis_changes` e `resolve_stale_invoice`. Tela: Emitir fatura da ficha do B/L, Gerar Invoice da Demurrage, Tentar reemitir, Tentar aplicar correção e Resolver alerta para todos; a emissão automática pela Revisão deixa de receber `42501`. "Preparar cancelamento financeiro" continua só do Administrativo. | ADR 0085, D3 |
| P5 | Baixa, Restituição, desconto e Conciliação PIX | Baixa manual local (`register_verified_invoice_payment`, `register_invoice_payment`, `register_ledger_invoice_payment`) para Financeiro e Administrativo. Autorizar restituição excepcional e cancelar autorização pendente (`request_financial_refund`, `cancel_financial_refund_authorization`) para qualquer Departamento, com motivo. Desconto de Demurrage (`apply_demurrage_discount`) para qualquer Departamento. Conciliação PIX: leitura (RPCs `list_*` e `itau_pix_monitor`, página `/reconciliacao`) para todos; conciliar (vincular, confirmar, tratar exceção, marcar recebimento Itaú) para Financeiro e Administrativo, com guarda própria em `confirm_unified_pix_matches`. Cancelar baixa e cancelar fatura seguem só do Administrativo. Ajustar textos como "Somente o Administrativo registra recebimentos". | ADR 0085, base, D2, D4 e D5 |
| P6 | Viagens | `reopen_agency_departure_report` e `_by_report_id` para qualquer Departamento, com motivo obrigatório gravado no Histórico; `revert_voyage_omission` para qualquer Departamento, com motivo. Botões para todos. | ADR 0085, D8 e D9 |
| P7 | Reprocessar efeito de importação | `retry_import_effect` aceita Equipamentos. | ADR 0085, D10 |
| P8 | Central de Informações do Portal | `internal_save_portal_information` aceita qualquer Departamento em todos os tipos; `/clientes/informacoes` libera a edição. | ADR 0085, D7 |
| P9 | Tarifas de Demurrage e Granito | Policies de INSERT e UPDATE de `demurrage_rates` e `customer_demurrage_agreements` para usuário interno ativo (a troca de `active` segue com o gatilho da migration `091`); telas de tarifa, acordo e Granito mostram Nova e Editar a todos e Ativar, Desativar e Excluir só ao Administrativo. | ADR 0085, D6; ADR 0073, item 4 |
| P10 | Funções sem tela | Remover `archive_vessel_schedule` (ADR 0071, item 12) e a RPC legada `add_agency_report_occurrence`, que perdeu a tela quando as Ocorrências viraram observações por seção (ADR 0030) e ainda recusa o Financeiro. Conferir chamadores e testes antes. | ADR 0071, item 12; ADR 0030 |
| P11 | Autor é quem está logado | `_assert_actor_is_caller` (migration `106`) deixa de aceitar outro autor para o Administrativo; jobs com `service_role` seguem assinando `sistema`. Conferir que a tela passa o próprio usuário ou nada em `add_manual_bl_charge`, `calculate_bl_local_charges`, `run_billing_for_import_batch` e `reject_customer_reconciliation`. | ADR 0085, regra base 2 |
| P12 | Leitura global nas telas restantes | Desbloqueio de CE: `ce_unlock_private.actor()` e `ce_unlock_read` em `useAuth` aceitam Equipamentos na leitura (sem documentos, como Financeiro e Operações). Portal: `portal_list_provisioning_events` aceita Operações e a seção Histórico do console deixa de falhar para esse perfil (o mascaramento do console é o item 16 do plano de correções). | ADR 0085, D11 e D12 |
| P13 | Texto do perfil e bateria por perfil | Atualizar `PROFILE_SCOPES` (`src/services/adminUsers.ts`), que ainda descreve só as três exceções da ADR 0046, e esconder da Validação o que o perfil não pode. Criar uma suíte `local-pg` que percorre a matriz de Segurança e, para cada linha, executa a ação como cada perfil e confere permitido ou recusado, inclusive a escrita direta pela API nas tabelas de P1 a P3. Registrar a suíte em `scripts/local-pg-suites.txt`. | ADR 0085, Consequências |

## Fim

Quando o último item for entregue e a matriz de Segurança não tiver mais
"correção pendente" vinda da ADR 0085, mova este plano para
`docs/archive/plans/` e retire-o do [índice](README.md).
