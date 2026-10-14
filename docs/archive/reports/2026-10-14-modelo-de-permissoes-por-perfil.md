# 2026-10-14 — Modelo de permissões por perfil: inventário, classificação e decisões

Relatório de execução do lote D da revisão. Nasce histórico: registra o que foi
lido, executado e decidido nesta data. A regra vigente está na
[matriz de Segurança](../../operations/seguranca.md#modelo-de-permissões-por-perfil);
o motivo, na [ADR 0085](../../adr/0085-modelo-de-permissoes-por-perfil.md); as
correções, no [plano do modelo de permissões](../../plans/2026-10-14-modelo-de-permissoes-por-perfil.md).

## 1. Escopo, ambiente e método

- **Ponto de partida:** `main` em `af9ea56` (2026-10-14), que já contém o
  merge da luccafwlog/vela#946 (revisão geral da documentação). Branch de
  trabalho `claude/zealous-mccarthy-0nmjcj`.
- **Fontes:** cadeia ativa `supabase/migrations/` (`001` a `229`; para cada
  função, policy, grant e gatilho, a definição mais recente), `src/services/`,
  `src/hooks/`, `src/pages/`, `src/components/`, `supabase/functions/` e as
  ADRs. A cadeia arquivada só foi lida para contexto.
- **Inventário do banco:** um parser das migrations extraiu a última definição
  de cada função (775), as policies vigentes (270, das quais 157 de escrita em
  64 tabelas) e os grants. Resultado: 277 funções executáveis por
  `authenticated`, 159 delas escrevem (direto ou por função chamada). Os
  grants feitos dentro de blocos `DO` (Desbloqueio de CE, migration `139`;
  envelopes da migration `189`) foram conferidos à mão. Para cada RPC de
  escrita, as condições `IF … THEN RAISE … 42501` foram extraídas também das
  funções chamadas.
- **Frentes paralelas:** escrita direta pelo PostgREST (policies, REVOKEs,
  privilégios de coluna e gatilhos), gates da tela e Edge Functions, e
  levantamento das decisões registradas e das contradições entre documentos.
- **Verificação independente das falhas (iii):** um verificador separado, sem
  as conclusões como premissa, tentou refutar cada candidata executando a
  escrita no Postgres 16 local montado por `scripts/setup-local-pg.sh` (227
  migrations, shims do Supabase), como `authenticated` com o usuário do perfil
  citado, sempre dentro de `BEGIN … ROLLBACK`. Os gatilhos adiados foram
  disparados com `SET CONSTRAINTS ALL IMMEDIATE`, que emula o COMMIT. Ao fim,
  zero linhas de fixture no banco.
- **Produção:** não foi lida nem alterada. Nenhuma ferramenta do Supabase foi
  usada.

Labels conforme [CONVENCOES.md](../../CONVENCOES.md): **Código** = leitura
estática; **Teste** = execução no Postgres 16 local com shims, em 2026-10-14,
não produção.

## 2. Regra de partida

A ADR 0046 dizia: escrita interna liberada a todo Departamento ativo, com
rastro, e três exceções (exclusão de registro operacional, Administrativo;
provisionamento do Portal, Administrativo e Documentação; `/admin/usuarios`,
Administrativo, inclusive leitura). A lembrança do dono era "todo perfil faz
tudo, exceto cancelar faturas e registrar restituições"; nenhum documento, vivo
ou arquivado, continha essa frase ou equivalente. O plano arquivado de
2026-08-13 chegou a registrar o contrário (decisão A4: cancelar fatura e baixa
abertos a todos), que o código nunca seguiu e a ADR 0071 (item 13) reverteu.

O dono escolheu a **união** das duas: escrita global com rastro; exceções da
base são as três da ADR 0046 mais cancelar fatura e registrar a Restituição.
Depois de conversa interna, o dono precisou que "registrar a Restituição" e a
**baixa manual** são do Financeiro e do Administrativo e que, dentro do
Faturamento, os demais Departamentos fazem todo o resto; fora do Faturamento,
as exceções aceitas continuam.

## 3. Classificação das restrições encontradas

Classes do pedido: (i) intencional, com decisão registrada; (ii) acidental, o
código restringe sem decisão; (iii) falha de segurança, a tela esconde e o
banco permite; (iv) contradição entre documentos. Mapeamento para
[CONVENCOES.md](../../CONVENCOES.md#divergência-entre-documento-e-código):
(i) com documento defasado → (a); (ii) e (iii) → (b), código diverge da regra
registrada (a base da ADR 0046 ou uma exceção); (iv) → (c).

Evidência das linhas abaixo: **Código**, salvo onde diz **Teste**.

### 3.1 Intencionais, com decisão registrada (i)

| Ação | Guarda no banco | Decisão |
|---|---|---|
| Excluir registro operacional, com motivo e Trava | `delete_records`, `delete_escala`, `delete_catalog_row`, `delete_manual_bl_charge` (`is_admin`; migrations `088`, `096`) | ADR 0046; ADR 0071, itens 8 e 11 |
| Excluir veículo, unidade e linha de Vazios, remover CE (abertos a todos) | `delete_vehicles_with_reason` (`184`), RPCs de Vazios, `remove_bl_ce_mercante` | ADR 0071, item 4; ADR 0078, itens 5 e 23 |
| Provisionar o Portal | Edges `portal-invite-send` e `portal-account-suspend` (papel em código, `service_role`), RPCs `portal_*` (`administrativo`, `documentacao`) | ADR 0046 |
| Trocar CNPJ do Portal | `portal_admin_change_cnpj` (`administrativo`) | Plano arquivado de 2026-08-13 |
| `/admin` e usuários | Edge `admin-users` (`is_admin`), `admin_list_users`, policy e gatilho de `user_profiles` | ADR 0046 |
| Cancelar fatura, Invoice de Demurrage e baixa | `cancel_invoice` (`126`), `cancel_demurrage_invoice` (`012`), `reverse_invoice_payment` (`136`), `reverse_demurrage_payment` (`002`) — `is_admin` | ADR 0071, item 13 |
| Confirmar devolução da Restituição | `confirm_invoice_refund`, `confirm_demurrage_refund` (`136`, `is_financeiro_user`) | ADR 0077, exceções controladas |
| Preparar cancelamento financeiro | `prepare_bl_financial_cancellation` (`136`, `is_admin`) | ADR 0077, exceções controladas |
| Liquidar Ajuste de COD | `settle_cod_adjustment` (`130`, `is_financeiro_user`) | ADR 0051, decisão 3 |
| Cancelar e reativar Viagem e B/L | `cancel_voyage` (`178`), `reactivate_voyage` (`211`), `cancel_bl` (`179`), `reactivate_bl` (`089`) e gatilhos (`066`, `089`) | ADR 0071, itens 8 e 9 |
| Desativar e reativar Cliente e tarifa | `deactivate_customer`/`reactivate_customer` (`092`), gatilho `guard_tariff_active_change` (`091`) | ADR 0073, itens 4 e 5 |
| Comunicados, contatos e caixas | `internal_save_customer_contact_configuration` (`008`), Edge `send-customer-communication`, `save_customer_communication_saved_template` (`068`) | ADR 0060; nota de 2026-09-18 da ADR 0046 |
| Chave global de envio | `set_communications_enabled` (`administrativo`) | ADR 0059 |
| Liberação de faturamento sem Portal | `grant_`/`revoke_customer_billing_portal_release` (`085`, `083`) | ADR 0070 |
| Dispute: responder, reabrir, anexar | `add_demurrage_dispute_message`, `reopen_demurrage_dispute` (`081`), anexo e storage (`106`) | Migration `081` (decisão R13 de 2026-09-23) |
| Informar PTAX | `recalculate_demurrage_invoices_manual` (`110`) | Decisão do dono de 2026-09-29 (cabeçalho da `110`) |
| Intervalo da Régua | `set_demurrage_dunning_interval_days` (`administrativo`) | Spec arquivada de 2026-08-27 |
| Assinatura do ADR de Saída pelo dono | RPCs de sign-off (`002`) | ADR 0046 (responsabilidade) |

Documentos defasados nessas linhas (a): o texto `PROFILE_SCOPES`
(`src/services/adminUsers.ts:66-72`), mostrado em `/admin/usuarios`, ainda
lista só as três exceções da ADR 0046 (plano, P14); a tabela de exceções de
`seguranca.md` não citava várias destas linhas (corrigido pela matriz).

### 3.2 Acidentais, sem decisão (ii), e decisões já tomadas com correção pendente

| Ação | Código hoje | Resultado |
|---|---|---|
| Emitir fatura local manualmente | `is_admin` (`002`) | Tinha decisão (ADR 0077, item 7); o dono a mudou: D3, qualquer Departamento |
| Emitir consolidada; gerar Invoice de Demurrage; Tentar reemitir; Tentar aplicar correção; Resolver fatura desatualizada | `is_admin` (`002`, `214`, `128`, `136`, `124`) | (ii); D3, qualquer Departamento |
| Botões "Emitir" da Validação e "Gerar fatura consolidada" | Mostrados a todos, banco recusa (`ValidacaoOperationsTable.tsx:191`, `TaxasLocais.tsx:168`) | (ii) na tela; resolvido por D3 |
| Baixa manual local | `is_admin` (`136:250`) | (ii); base revista e D4: Financeiro e Administrativo |
| Pagamento e desconto de Demurrage | `is_financeiro_user` (`027`, `012`) | (ii); D4: pagamento Financeiro e Administrativo (vigente), desconto qualquer Departamento |
| Autorizar e cancelar autorização de restituição excepcional | `is_admin` (`136:316`, `136:479`) | Tinha decisão (ADR 0077); o dono a mudou: D2, qualquer Departamento |
| Conciliação PIX (tela e RPCs, inclusive leitura) | `isAdmin` na página; RPCs `is_admin`; `confirm_unified_pix_matches` sem guarda própria, ramo de Demurrage aceita Financeiro | (ii), contra a leitura global; D5 |
| Tarifa e acordo de Demurrage | Policies `is_admin` (`002`) | (ii), contra a decisão R6; D6 |
| Taxa de Granito | Banco aberto a todos; botões só ao Administrativo | (ii) na tela; D6 |
| Central de Informações do Portal | `internal_save_portal_information` (`137:116`): Administrativo; Equipamentos só depots | (ii); D7 |
| Reabrir ADR de Saída | `is_admin` (`002`) | (ii) (só cabeçalho da migration arquivada `218`); D8 |
| Reverter omissão de escala | `is_admin` (`002`) | (ii); D9 |
| Reprocessar efeito de importação | `retry_import_effect` (`106`) sem Equipamentos | (ii); D10 |
| Desbloqueio de CE | Leitura sem Equipamentos (`139`); gestão Administrativo e Documentação | (ii) na leitura, matriz só "proposta" na spec; D11 |
| Histórico do console do Portal | `portal_list_provisioning_events` recusa Operações; tela mostra a seção | (ii) frente à leitura global e ao item 18 da ADR 0083; D12 |
| Administrativo assina qualquer seção do ADR; terminal legado de Operações e Administrativo | RPCs de sign-off (`002`), `set_agency_report_terminal` (`068`) | (ii); D13, cobertura aceita |
| Administrativo informa outro autor | `_assert_actor_is_caller` (`106`) em quatro RPCs | (ii), contra o rastro; regra base 2 |
| `archive_vessel_schedule` | Segue no banco, sem tela | (b): a ADR 0071 (item 12) manda remover |
| `add_agency_report_occurrence` | RPC sem tela; recusa Financeiro | Resíduo das Ocorrências (ADR 0030); remoção no plano |

Itens da ADR 0083 com correção pendente que entram na matriz sem voltar como
pergunta: fatura avulsa (item 9), ROE (item 14), console do Portal para
Operações (item 18), Administrativo ativo mínimo (item 2) e exclusão de perfil
interno (item 3). Confirmação nesta leitura: `create_manual_invoice` segue
`is_admin` (`125:27`); `save_exchange_rate_reference_v2` aceita qualquer ativo
(`018:116`) e o cabeçalho grava para todos; `portal_list_provisioning_console`
mascara para Operações no banco (`103`) e na tela; nada impede desativar o
último Administrativo; `user_profiles_admin_delete` permite a exclusão pela
API.

### 3.3 Falhas de segurança (iii)

Candidatas levantadas por leitura e reexecutadas pelo verificador
independente. Privilégios testados vêm de grants explícitos das migrations
`002` e `006`, então produção tem pelo menos esses (mais o default da
plataforma, cabeçalho da migration `166`). Usuário inativo recebe zero linhas
em todas as escritas: a RLS barra inativos.

| # | Caso | Veredito | O que a execução mostrou |
|---|---|---|---|
| 1 | `demurrage_invoice_items` por qualquer ativo (policies `002`, grant `006:63`) | **Confirmado (Teste)**; inserir em invoice emitida **refutado** | Operações zerou dias, diária e subtotal de item de Invoice emitida e de paga; passou no COMMIT. O detalhe do Portal mostrou 0,00 no item, com o total da Invoice intacto e o BRL redistribuído. Mover o item (`invoice_id`) para invoice em rascunho ou cancelada passou. Inserir em invoice emitida foi recusado pelo gatilho de conjunto completo. Tudo fica em `audit_logs`. |
| 2 | `customer_contacts` por Financeiro e Operações (policies `002`) | **Confirmado (Teste)** | Financeiro, recusado pela RPC, trocou por UPDATE direto o e-mail do contato principal; os vínculos de caixa seguem o contato e `customer_communication_recipient_allowed` passou a aceitar o novo endereço. Operações desativou o principal e criou outro, que herdou as três caixas. Nenhum evento em `customer_contact_change_events`. |
| 3 | DELETE direto pelo Administrativo (policies `is_admin` sem REVOKE) | **Confirmado (Teste)**; nos cadastros, só linhas sem uso | `delete_escala` recusou a escala de exportação travada pelo CE; o DELETE direto apagou a linha, sem motivo. Navio, armador, porto e tabela sem uso também saíram sem motivo; os usados são barrados por chave estrangeira e `guard_used_tariff_delete`. |
| 4 | `bls.financial_status` por qualquer ativo | **Confirmado (Teste)** para "nunca faturado"; dupla cobrança **refutada** | Operações marcou como `invoiced` um B/L pronto: a emissão passou a recusar ("já faturado"), o automático devolveu `already_invoiced` e o alerta crítico de falha de emissão fechou sozinho. Voltar um B/L faturado para `pending` não fatura de novo (`prevent_duplicate_active_invoice_bl_link`), mas reabre a edição de taxa manual. |
| 5 | `charge_calculations` por qualquer ativo | **Confirmado (Teste)** antes da emissão; mudar fatura emitida **refutado** | Operações, recusado por `delete_manual_bl_charge`, zerou a taxa manual por UPDATE direto. Mudou o THC para 1,00 e inseriu linha manual de 4.999,00: a emissão pelo Administrativo gerou fatura de 5.000,00 em vez de 1.300,00. Depois da emissão, mudar as linhas não altera fatura, itens, recebível nem Portal. |
| 6 | `delete_baplie_manifest_for_voyage` por qualquer ativo | **Refutado (Teste)** | A função foi removida pela migration `087` e não existe mais; restam só referências em `src/types/database.ts` e em dois testes de texto. |

O dono aprovou a correção das falhas 1 a 5 (itens P1 a P3 do plano).

### 3.4 Contradições entre documentos (iv)

| # | Contradição | Resolução |
|---|---|---|
| C1 | Avulsa: `manual-financeiro.md` dizia "Financeiro ou Administrativo"; ADR 0083 e `seguranca.md`, qualquer usuário | ADR 0083, item 9 (já decidido); documentos corrigidos |
| C2 | Quem lança a Restituição de Invoice de Demurrage paga: "o Financeiro" (ADR 0083, item 12; `demurrage.md`) contra "o Administrativo autoriza" (manual, `faturamento.md`, código) | D2: qualquer Departamento autoriza; Financeiro ou Administrativo registra a devolução |
| C3 | Quem fecha "Restituição pendente": Financeiro (`CONTEXT.md`), Financeiro ou Administrativo (`faturamento.md`), Administrativo (ADR 0077, decisão 4) | D2: Financeiro ou Administrativo |
| C4 | Quem cancela a fatura antes de cancelar o B/L ou desativar o Cliente: "o Financeiro" (ADR 0071 item 9, ADR 0073 item 6, `manifesto-edi.md`) contra "o Administrativo" (ADR 0071 item 13, manual) | D1: Administrativo |
| C5 | Leitura da Conciliação PIX: global (ADR 0044) contra "só Administrativo, inclusive leitura" (`seguranca.md`, `reconciliacao-pix.md`, `CONTEXT.md`) | D5: leitura para todos |
| C6 | Console do Portal: `seguranca.md` tratava a máscara para Operações como regra; ADR 0083 e `portal-cliente.md`, como defeito | ADR 0083, item 18; matriz corrigida |
| C7 | Faixa e linha da ADR 0046 no índice listavam poucas exceções e ainda contavam a exclusão de escala de exportação desfeita pela migration `088` | Faixa e índice reescritos; lista fechada na ADR 0085 |
| C8 | Índice dava a ADR 0073 como "implementada", com o item 8 pendente (B15) | Índice: "parcial" |
| C9 | Desbloqueio de CE sem Equipamentos na leitura, contra a leitura global | D11 |
| C10 | Tarifa de Demurrage e Granito só do Administrativo, contra a decisão R6 ("preços seguem editáveis por todos") | D6 |

## 4. Decisões do dono

Perguntas em lotes por domínio, cada uma com caso prático, opções e
recomendação. Onde o dono contrariou a recomendação, está marcado.

| Item | Decisão |
|---|---|
| Base | União da ADR 0046 com a regra lembrada |
| D1 | Cancelar fatura e Invoice de Demurrage: só Administrativo |
| D2 | Restituição: qualquer Departamento autoriza e cancela a autorização pendente; Financeiro e Administrativo registram a devolução |
| D3 | Emitir fora do automático (ficha, Validação, consolidada, Invoice de Demurrage) e corrigir fatura emitida: qualquer Departamento (contra a recomendação, que era só Administrativo) |
| D4 | Baixa manual: Financeiro e Administrativo; desconto de Demurrage: qualquer Departamento. A primeira resposta foi "baixa e desconto por qualquer setor"; o dono a revisou no mesmo dia, depois de conversa interna |
| D5 | Conciliação PIX: leitura para todos; conciliar, Financeiro e Administrativo (primeira resposta, "tudo aberto", revista junto com D4) |
| D6 | Tarifa e acordo de Demurrage e taxa de Granito: qualquer Departamento cria e edita |
| D7 | Central de Informações do Portal: qualquer Departamento (contra a recomendação, que era manter Administrativo e Equipamentos para depots) |
| D8 | Reabrir ADR de Saída: qualquer Departamento, com motivo e registro no Histórico (contra a recomendação, que era só Administrativo) |
| D9 | Reverter omissão de escala: qualquer Departamento, com motivo |
| D10 | Reprocessar efeito de importação: qualquer Departamento |
| D11 | Desbloqueio de CE: leitura para todos; gestão Administrativo e Documentação |
| D12 | Histórico do console do Portal: Operações vê |
| D13 | ADR de Saída: o dono assina; o Administrativo cobre |
| Rastro | O autor é sempre quem está logado |
| Mantidos | Liquidar Ajuste de COD com Financeiro e Administrativo; preparar cancelamento financeiro só com o Administrativo |
| Falhas | Correção aprovada para as quatro famílias da seção 3.3 |

## 5. O que foi verificado e o que não foi

- **Conferido no código (Código):** a última definição de cada RPC de escrita
  executável por `authenticated`, as policies de escrita, os REVOKEs de tabela
  e de coluna, os gatilhos citados, `roleHasPermission`, os gates de tela
  citados e a autorização das Edge Functions chamáveis pela equipe interna.
- **Executado (Teste, Postgres 16 local, não produção):** as seis candidatas a
  falha de segurança da seção 3.3, como `authenticated` com o perfil citado.
- **Não verificado:**
  - ACL, policies e gatilhos de produção; se todas as migrations estão
    aplicadas lá. O comportamento de RLS em produção não foi executado.
  - A camada PostgREST em si (foi executado o SQL que ela executaria).
  - Telas: nenhuma foi aberta; os gates de tela são leitura de código.
  - Edge Functions: só leitura; nenhuma foi chamada, nem envio de e-mail.
  - As linhas "vigente" da matriz que não estão na seção 3.3 não foram
    executadas como cada perfil; os testes `local-pg` existentes que tocam
    permissão (por exemplo `alinhamentoPermissoes`, `auditoriaRun2Reforcos`,
    `blCancel`, `customerDeactivate`, `deleteRecords`) não foram rodados nesta
    data.

## 6. Observações levadas ao dono depois da entrega

As duas primeiras foram respondidas pelo dono no mesmo dia (ADR 0085, itens
D14 e D15).

- Qualquer Departamento ativo pode marcar `tem_exportacao = false` na escala
  de exportação travada pelo CE (**Teste**, verificador, caso 3: a escala não
  tinha Granito nem Vazios). Resposta do dono: a marcação serve à exibição no
  painel; com Granito ou Vazios registrados não se desmarca. Nova execução no
  Postgres local, como Operações: com Granito importado no porto, recusado
  (`P0003`, `guard_export_schedule_removal`, migration `066`); com Embarque de
  Vazios aberto sem unidade, também recusado; sem nenhum dos dois, aceito.
  Perguntado sobre o Embarque sem unidade, o dono manteve a recusa. Regra já
  vigente; sem correção.
- `import_baplie_staging_transactional` com lista vazia apaga o Baplie da
  viagem, com rastro "Baplie substituído" (**Teste**). A tela não importa sem
  container (`canImportPreview`, **Código**). Resposta do dono: recusar.
  Correção no item P13 do plano.
- Viagem, B/L e Cliente podem ser inseridos já cancelados ou desativados por
  INSERT direto. Impacto não avaliado. **Código**.
- RPCs de manutenção sem tela restritas ao Administrativo (`backfill_*`,
  `cleanup_orphaned_dispute_attachments`): fora da matriz de ações do usuário.
