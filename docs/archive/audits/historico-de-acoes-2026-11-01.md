# Diagnóstico: histórico e Histórico de ações do Vela — 2026-11-01

Auditoria pontual, nascida histórica. A regra vigente da aba fica em
[Operação e suporte § Admin](../../modules/operacao-suporte.md); o contrato da
leitura, em [RASTREABILIDADE](../../RASTREABILIDADE.md) (`admin_action_history`).

Pedido: o histórico de ações tem de dizer quem fez, o quê, quando e em quê,
com nomes (navio, Cliente) e nunca números internos, com a justificativa
escrita pelo operador, e cobrir toda tela que cria, edita ou apaga. A aba
**Histórico de ações** (`/admin/historico`) era o ponto mais fraco.

Evidência: **Código** (leitura da cadeia ativa de migrations e de `src/`).
Nenhum fluxo foi executado em ambiente Supabase; as leituras novas foram
exercitadas em PostgreSQL local descartável (**Teste local-pg**).

## Como o histórico é gravado

Tudo vai para uma tabela, `public.audit_logs`: `entity_type`, `entity_id`,
`field_name`, `old_value`, `new_value`, `changed_by` (usuário do Auth),
`changed_at`, `justification`, `actor_role`/`actor_department` e `bl_id`
(migration `404`). Quatro portas gravam nela:

1. **Gatilho genérico** `audit_row_changes()` (definição vigente na `404`),
   ligado a 45 tabelas (`audit_<tabela>`). Grava `criado` com o registro inteiro
   em JSON, `excluido` com o registro inteiro em JSON, ou uma linha por campo
   alterado. O autor é `auth.uid()`; a justificativa vem de
   `vela.delete_reason` (exclusão) ou `vela.import_context` (contexto da
   importação ou da função que chamou).
2. **Funções do banco** (`SECURITY DEFINER`) que gravam linhas "semânticas"
   próprias (`bl`, `customer`, `voyage`, `invoice`, `charge_calculation`,
   `agency_departure_report`, `alert_item`...), quase sempre com a justificativa
   pedida na tela.
3. **RPC `record_audit_entries`** (`404`, `430`), única escrita da tela: agenda
   de POL/POD, Viagem, evento operacional e usuário; autor tirado da sessão.
4. **Edge Function `admin-users`**, pela mesma RPC.

`audit_logs_force_actor` (gatilho `BEFORE INSERT`, `134`) carimba setor e hora
quando quem grava é uma sessão. O INSERT direto foi fechado na `404` (F-46).

**Manual × automático.** Ação da equipe ou do Cliente pelo Portal grava o
login em `changed_by`; rotina, `pg_cron`, Edge Function com `service_role` e
gatilho disparado por rotina gravam `changed_by` vazio, e a tela mostra
**Sistema**. O que a rotina fez vem no texto da justificativa (contexto). Não
há coluna que diga qual rotina; a distinção é autor vazio + contexto.

## Como é exibido

| Onde | Leitura | Situação em 2026-11-01 |
|---|---|---|
| Admin › Histórico de ações | `audit_logs` direto pela API + `get_user_display_names` | Registro pelo id gravado, encurtado ("37", "99 · BRSSZ", "9f1c…"); De/Para de campo que aponta para outro cadastro com o número; sem e-mail do autor; Cliente pelo Portal aparecia como "Pessoa sem cadastro"; sem filtro de ação |
| Histórico do B/L | RPC `bl_timeline` (`470`) + `_bl_timeline_value` | Cliente, Viagem, Terminal, Manifesto e container pelo nome. Eventos `receivable_voided` e `auto_reissue_invoices` caíam em "Dado do B/L" com o JSON cru (ids de recebível e de fatura) |
| Histórico do Cliente (ficha) | RPC `customer_audit_timeline` (`503`) | `held_billing_reprocessed` aparecia como "Cadastro alterado" com JSON (`customer_id`); fatura sem número virava `INV-<id>` |
| Linha do tempo da Viagem | `audit_logs` direto (`voyageTimeline.ts`) | Sem id na tela. A justificativa não aparecia em edição de campo da Viagem, CE Master, omissão revertida e transbordo |
| Linha do tempo do ADR | assinaturas do ADR | Autor sem nome caía no uuid |
| Taxas do B/L, Desbloqueio de CE, assinatura de seção | trilhas próprias | Sem id; justificativa exibida |

## Lacunas

### Escritas que não deixam linha em `audit_logs`

Por risco (financeiro e Cliente primeiro):

1. **Liberar faturamento no Portal** (`grant_customer_billing_portal_release`,
   `085`): o gatilho de `customer_billing_portal_releases` só cobria UPDATE e
   DELETE (`083`); a justificativa obrigatória ficava só na tabela.
2. **Pix marcado como tratado** (`itau_pix_mark_receipt_handled`) e **exceções
   de Pix** (registrar, vincular, resolver): motivos só nas tabelas de Pix.
3. **Disputas de Demurrage** (mensagem, resolução, reabertura, anexo): só a
   troca de situação da Invoice aparece.
4. **Criação de B/L pela importação** e de `bl_breakbulk_items`, `granite_bls`,
   `manifestos_mercante`: os gatilhos dessas tabelas não cobrem INSERT; fica
   só a linha do lote e a dos containers.
5. **Fechar ADR**, observação de seção e terminal do ADR (a reabertura é
   auditada; o fechamento não).
6. **Contas do Portal** (convite, suspensão, e-mail de recuperação),
   **Comunicado enviado**, ligação contato × caixa: trilhas próprias
   (`portal_provisioning_events`, `customer_communications`,
   `customer_contact_change_events`), fora do Histórico.
7. **Desbloqueio de CE**: trilha própria (`ce_unlock_events`).
8. **Vazios**: criação de booking manual, de embarque e de linha de serviço;
   bookings e containers criados por importação.
9. Menor risco: nome do próprio usuário (`/perfil`), "ciente" de impacto de
   taxa, modelo salvo de Comunicado, alerta de faturamento.

Tabelas cujo gatilho cobre só UPDATE e DELETE (a criação não é registrada):
`bl_breakbulk_items`, `bl_freight_lines`, `bls`, `charge_calculations`,
`granite_bl_charges`, `granite_bls`, `vazios_bookings`,
`vazios_export_operations`, `vazios_export_service_lines`,
`vazios_importacao_containers` (`002`), `manifestos_mercante` (`062`) e
`customer_billing_portal_releases` (`083`).

### Justificativa coletada e não persistida no Histórico

- Escrita feita pelo navegador direto na tabela (cadastros, desativação de
  catálogo, edição de Invoice de Demurrage) grava `justification` vazia: o
  navegador não define `vela.import_context`.
- `revoke_customer_billing_portal_release`: o motivo entra como valor do campo
  `revoke_reason`, não como justificativa.
- Pix tratado (`handled_note`), exceção de Pix, mensagem de disputa e ligação
  contato × caixa: o motivo fica só na tabela da trilha própria.

### Número interno na tela

- Admin › Histórico de ações: coluna Registro e De/Para (acima).
- `voyageLabel` (`src/lib/utils.ts`) devolve "Viagem <id>" quando faltam navio e
  número (raro: os dois são obrigatórios na tabela).
- Históricos do B/L, do Cliente e do ADR: itens da tabela de exibição acima.

### E-mail do autor

A aba não mostrava e-mail de ninguém (só o nome, de `get_user_display_names`,
que por decisão da ADR 0106 devolve só o nome a todos os setores). Não havia
e-mail mascarado: havia e-mail ausente. Para auditoria, o Administrativo, que já
lê o e-mail dos usuários em `admin_list_users`, precisa do e-mail de quem fez.

## Proposta

O modelo aguenta rótulos, justificativa e manual × automático **sem coluna
nova**: o nome do registro sai na leitura, pelo registro atual ou, se ele foi
apagado, pelo JSON gravado na criação/exclusão. Migration só para o que hoje se
perde (escritas sem linha) e para a leitura enriquecida.

| PR | Conteúdo |
|---|---|
| 1. Leitura enriquecida + este diagnóstico | Migration `558`: RPC `admin_action_history` (só Administrativo) com autor (Equipe, Cliente pelo Portal, Sistema; nome, e-mail, setor gravado), ação (criou, alterou, excluiu), registro pelo nome, De/Para pelo nome quando o campo é chave de cadastro, nomes das chaves do JSON e o total; filtros de assunto, autor, ação e período. `fetchActionHistory` no serviço |
| 2. Tela da aba | A aba passa a usar a RPC: coluna Registro com o nome, Motivo como coluna, filtro Ação, Por com Sistema e Cliente pelo Portal, e-mail do autor no detalhe |
| 3. Cobertura no banco | Gatilhos e linhas semânticas para as lacunas 1, 2, 5 e 8 (parcial); motivo gravado numa coluna da própria linha passa a ser a justificativa da linha |
| 4. Históricos por tela | Eventos JSON do B/L e do Cliente em frase; `INV-<id>` e uuid fora da tela; justificativa nas linhas da Viagem que a omitiam |

Ficam para PR seguinte, com dono a decidir: criação de B/L e de carga solta
pela importação (volume), disputas de Demurrage, contas do Portal, Comunicados
e Desbloqueio de CE (já têm trilha própria; a decisão é se o Histórico de ações
também as lista), nome do próprio usuário e bookings de vazios importados.

`ponytail:` os nomes são resolvidos por linha da página (50 linhas). Se ficar
lento, o caminho é gravar o nome do registro na própria linha de `audit_logs`.
