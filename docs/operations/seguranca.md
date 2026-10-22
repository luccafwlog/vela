# Segurança

> A fronteira de autorização vive no **banco** (RLS + RPCs `SECURITY DEFINER`). Checagens no cliente são apenas UX.

---

## RLS-first

- **RLS ativo em todas as tabelas.** Acesso segmentado por role via helpers `is_admin()`, `is_active_user()`, `current_user_role()` (ADR 0004).
- **Dados financeiros:** leitura interna usa `is_active_read_user()`; a escrita segue o [modelo de permissões por perfil](#modelo-de-permissões-por-perfil). Não presumir restrição universal a admin.
- **Helper de policy entre `(select ...)`:** escreva `USING ((select public.is_active_read_user()))`, não `USING (is_active_read_user())`, e o mesmo dentro de expressão composta (`recipient_id = (select auth.uid()) AND (select public.is_active_read_user())`). Na forma nua o Postgres roda a função a cada linha lida ou gravada; com 12 mil B/Ls a lista de B/Ls levava 72 s por página. A regra de acesso é a mesma: o helper não recebe argumento da linha. A migration `283` converteu as policies cuja expressão inteira é a chamada e a `286`, as chamadas dentro de expressão composta; a suíte local-pg `auditSecurityBoundaries` falha, com o nome da policy, se qualquer chamada sem argumentos a função não volátil de `public` ou `auth` voltar à forma nua.
- A lógica financeira sensível (criar invoice, numerar, consolidar, PIX) roda em **RPCs `SECURITY DEFINER`** transacionais. Desde as migrations `232` e `233`, nenhum perfil escreve direto nas tabelas de fatura, pagamento e recebível nem em `bls.financial_status`, e `register_invoice_payment` roda como dono. `mark_bl(s)_ready_and_create_invoice` seguem `SECURITY INVOKER` sobre RPCs `SECURITY DEFINER` (P4 na [matriz](#modelo-de-permissões-por-perfil)).
- **Default-deny em funções** (ADR 0011, reforçada pela ADR 0047): desde a migration arquivada `297` — hoje nas migrations `001` e `006`, com a varredura de `PUBLIC`/`anon` da `003` —, o `ALTER DEFAULT PRIVILEGES` de `public` **revoga** `EXECUTE` de `PUBLIC`, `anon` e `authenticated`. Função nova nasce fechada e o acesso é concedido caso a caso na própria migration (`GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO authenticated;`) — esquecer quebra fechado, com erro de permissão em teste, em vez de abrir em silêncio. Antes disso o default do Supabase concedia `EXECUTE` a `anon`/`authenticated` em toda função criada, o que gerou as correções das migrations arquivadas `078`, `088`, `093`, `152` e `257` e deixou 51 funções executáveis por `anon` até a arquivada `297` varrê-las. `PUBLIC` faz parte da revogação por necessidade: sem ela, `anon` e `authenticated` herdariam o EXECUTE do default embutido do PostgreSQL. Atenção ao recriar função: `CREATE OR REPLACE` preserva o ACL, mas `DROP FUNCTION` + `CREATE` exige o `GRANT` de volta.
- **`search_path` fixo em toda função**, não só nas `SECURITY DEFINER` (lint 0011 do advisor). Função que só usa `pg_catalog` ou nomes qualificados recebe `SET search_path = ''`; 19 das 23 que faltavam receberam na migration `320`. **Exceção de desempenho, decidida pelo responsável em 2026-10-19:** função `LANGUAGE sql` com `SET` deixa de ser expandida inline pelo planejador e passa a custar uma chamada por linha (de 5 a 18 vezes mais lenta no Postgres 16 local). Por isso `bl_cargo_mode_matches_filter`, `normalize_port_code`, `bl_operation_front_modalidade` e `_import_effect_priority`, que rodam linha a linha nas listas de B/L e containers, nas importações, nos comunicados automáticos e na fila de efeitos, ficam sem `SET`; o advisor continua listando as quatro. O risco é pequeno porque nenhuma é `SECURITY DEFINER` e o corpo só chama `pg_catalog`. A suíte `advisorFuncoesFechadas` aceita só essas quatro e confere no plano que continuam inline. Função SQL nova chamada em volume segue a mesma regra: sem `DEFINER`, nomes qualificados e entrada na lista da suíte.
- **Nenhuma função pré-autenticação:** desde a migration `320` ([ADR 0090](../adr/0090-programacao-de-navios-so-com-sessao.md)) nenhuma função do projeto é executável por `anon`. A única exceção, desde a `407` ([ADR 0096](../adr/0096-corte-do-token-interno-na-revogacao.md)), é `check_internal_token_cutoff()`: o PostgREST a chama antes de toda requisição com o papel da requisição, e sem sessão ela não faz nada ([revogação de sessões internas](#revogação-de-sessões-internas)). `portal_ship_schedule()`, que a ADR 0047 mantinha como vitrine pública, só atende sessão (Portal ou interna), porque o Portal só a chama depois do login. Desde a migration `337` o corpo confere o chamador: usuário interno ativo, conta ativa do Portal com credencial não revogada ou `service_role`; outra conta `authenticated` recebe 28000. O grant sozinho não bastava, porque o cadastro público do Auth fica fora do app: contas só nascem pelas Edge Functions `admin-users` e `portal-invite-activate` (`auth.admin.createUser`), e o cadastro público tem de ficar desligado em produção ([serviços externos](servicos-externos.md#supabase)). A `320` também fechou dez funções de trigger que em produção tinham `EXECUTE` para `PUBLIC`, resíduo da cadeia arquivada que a varredura da `003` não alcançou (ela nunca rodou em produção). A suíte local-pg `advisorFuncoesFechadas` varre o catálogo e falha com função executável por `anon`, trigger executável por cliente ou função sem `search_path` fixo; a `320` também recusa o deploy se sobrar função aberta a `anon`. A exceção `anon` da ADR 0013 (`portal_resolve_login`) foi encerrada pela migration arquivada `182`, quando o login passou a ser resolvido pela Edge Function `portal-login` com `service_role`, que lê `customer_portal_accounts` diretamente; `portal_resolve_login` ficou no catálogo sem grant e sem chamador.
- **Helpers de revisão privilegiados:** `compute_bl_review_pendencies` lê `customer_portal_accounts`, relação administrativa protegida por RLS. Por isso roda como `SECURITY DEFINER` com `search_path` fixo e sem `EXECUTE` direto para `PUBLIC`, `anon` ou `authenticated`; somente RPCs/triggers autorizados o invocam.
- **Tabelas lidas pelo navegador ganham `GRANT` explícito:** tabelas seguem o default da plataforma Supabase (`authenticated` recebe privilégios em tabela nova de `public`) e a fronteira real é a RLS. Banco montado só pelas migrations — replay do CI, design-audit, `setup-local-pg.sh` — não tem esse default, então tabela que o navegador lê direto precisa do grant na própria migration; sem ele a leitura falha com 42501 fora de produção (VELA-16, corrigida pela `166` para `baplie_reconciliation_resolutions`). Esse default também dá `TRUNCATE`, `TRIGGER` e `REFERENCES` a `authenticated` (89 tabelas na conferência de 2026-10-18) e, em 4 tabelas, a `anon`; `TRUNCATE` não passa pela RLS nem pelos gatilhos de `DELETE`. A migration `312` tirou os três das tabelas de Comunicado e de e-mail (plano dos e-mails, 5.3), e a `340`, de todas as tabelas de `public` para `anon` e `authenticated`, inclusive do default privilege do papel das migrations. A branch `staging`, criada em 2026-10-19 só pelas migrations, recusava com 42501 leituras que produção aceitava (VELA-22, VELA-23): a `340` dá a `service_role` o SELECT/INSERT/UPDATE/DELETE que ele tem em produção (sem `DELETE` nas append-only `invoices`, `invoice_items`, `payments`, `ledger_settlements` e `bl_receivables`; `audit_logs` só `INSERT`/`SELECT`) e a `authenticated` só o `SELECT` que as telas usam (embeds do Relatório Próprio de Agência e `customer_portal_accounts`, lida pela policy de `customer_communication_box_kinds`/`_boxes`). Os demais privilégios de `authenticated` que só produção tem não são usados pela Data API e não entram na cadeia. A `340` também tira de `anon` o SELECT/INSERT/UPDATE/DELETE que produção dava em `financial_payment_attempts`, `demurrage_refunds`, `invoice_corrections` e `invoice_customer_changes` (RLS sem policy para `anon`; o `TRUNCATE` dessas tabelas passava por cima da RLS). A suíte local-pg `grantsDoReplay` falha quando o replay sai desse contrato: `service_role` sem `SELECT` numa tabela de `public` ou sem `INSERT`/`UPDATE`/`DELETE` fora das append-only, `anon` com qualquer privilégio de tabela, `anon`/`authenticated` com `TRUNCATE`, `TRIGGER` ou `REFERENCES`. Ela não sabe quais tabelas o navegador lê: o `SELECT` de `authenticated` numa tabela nova continua dependendo do grant na migration e do teste da tela.
- **Edge Functions do Portal:** chamadas que usam `service_role` validam ator e escopo no servidor. As migrations `101` e `102` concedem a esse role somente as operações diretas de runtime necessárias em `customer_portal_accounts`, `customers`, `portal_invites`, `portal_email_attempts` e `alerts`, incluindo uso das sequences; não alteram grants de `PUBLIC`, `anon` ou `authenticated`.

> Checagens no front (`can()`, `isAdmin`, `roleHasPermission`) servem só para esconder UI. Nunca são a fronteira real.

**Dupla proteção RBAC:** a interface usa `can(permission)` para orientar a
navegação e esconder exceções, mas a autoridade está nas policies RLS, nas RPCs
e nas Edge Functions; toda permissão precisa valer também para chamada direta à
API, e o rastro obrigatório responsabiliza as operações auditadas. No
navegador, a recusa do banco é lida por `classifyDbError` (`src/lib/errors.ts`),
a tabela compartilhada de códigos Postgres/PostgREST para tipo e mensagem em
português; quem a consome não mostra `details`, `hint` nem dados sensíveis do
erro bruto.

## Roles internas

As policies de leitura e marcação de notificações internas exigem destinatário
igual a `auth.uid()` e perfil interno ativo (`is_active_read_user()`, migration
`131`), inclusive para acesso direto com um JWT ainda válido após desativação.

`administrativo` · `financeiro` · `operacoes` · `documentacao` · `equipamentos`, em `user_profiles` (`role`, `active`). Geridas em `/admin/usuarios`. Ver [Admin Usuários](../modules/operacao-suporte.md#admin). O papel legado `operator` é tratado como Documentação, inclusive no envio de alertas desde a migration `328`; o papel `admin` (Administrador) deixou de existir (migration `093`).

- **Usuário interno ativo:** identidade do Supabase Auth com perfil ativo em
  `user_profiles` e papel reconhecido (`is_active_user()` no banco; o app recusa
  perfil inativo ou papel desconhecido). Identidade Auth sem perfil ativo não
  tem acesso interno. Quantidade e identidade dos usuários são dados do
  ambiente, não regra.
- **Departamento:** o papel do usuário interno, usado como assinatura de
  responsabilidade: identifica o autor no registro de eventos e define quem
  assina cada seção do ADR de Saída ([Viagens](../modules/viagens.md)). O papel
  também autoriza as operações da [matriz](#modelo-de-permissões-por-perfil);
  Departamento não é acesso irrestrito.
- **Rastro obrigatório** ([ADR 0046](../adr/0046-escrita-interna-global-com-rastro-obrigatorio.md)):
  toda escrita registra autor e Departamento no instante do evento
  (`audit_logs.actor_role`/`actor_department`); o Departamento é gravado com o
  evento, nunca derivado do cadastro atual. Ações automáticas assinam
  `sistema`.
- **Histórico só pelo banco** (migration `404`; F-46 da
  [revisão das importações](../archive/audits/2026-10-21-revisao-importacoes.md)):
  `authenticated` e `anon` não têm `INSERT` em `audit_logs` e a tabela não tem
  política de INSERT; só gatilhos e funções `SECURITY DEFINER` gravam. Até a
  `404`, qualquer usuário ativo inseria uma linha no próprio nome e forjava,
  por exemplo, um "CE Mercante … · Origem: Importação de CE Mercante" no
  Histórico do B/L. A tela (agenda de POL/POD, Viagem, eventos operacionais) e
  a Edge Function `admin-users` gravam pela RPC `record_audit_entries`, que
  aceita só esses assuntos e campos (usuário só para o Administrativo), toma
  autor, Departamento e hora da sessão e recusa o resto com `42501`.
  `update_customer_with_audit` passou a `SECURITY DEFINER` pela mesma razão.
  `service_role` mantém `INSERT`/`SELECT` (`340`).

### Visualização global interna

Todo perfil interno ativo lê dado operacional e financeiro, inclusive de
tarifação (`is_active_read_user()`;
[ADR 0044](../adr/0044-leitura-interna-global-departamento-restringe-escrita.md)).
A tela `/admin` — Usuários, Falhas de entrega de alertas, Histórico de ações,
Sistema e Prazo do ADR — só abre para o Administrativo (rota `adminOnly`; o item
Admin do menu só aparece para ele), mas só a lista de usuários é recusada aos
demais no banco (`admin_list_users`); os dados das outras abas, como
`audit_logs` e `alert_notification_failures`, seguem a leitura global
([matriz](#modelo-de-permissões-por-perfil)). Desbloqueio de CE, documentos do pedido, fila de Disputas,
Histórico do console do Portal e Comunicados passaram à leitura global na
migration `250` (P12; [matriz](#modelo-de-permissões-por-perfil)).

A matriz do frontend está em `roleHasPermission` (`src/hooks/useAuth.tsx`) e
nos gates de cada tela; a autorização real fica nas policies, nas RPCs e nas
Edge Functions.

### Escrita interna global e exceções

A escrita interna é liberada a todo Departamento ativo, com rastro obrigatório
([ADR 0046](../adr/0046-escrita-interna-global-com-rastro-obrigatorio.md)), e o
autor é sempre quem está logado. A
[ADR 0085](../adr/0085-modelo-de-permissoes-por-perfil.md) fixou a base e a
lista fechada das exceções:

- exceções da base: excluir registro operacional (Administrativo, com motivo e
  Trava), provisionamento do Portal (Administrativo e Documentação), `/admin`
  e usuários (Administrativo), cancelar fatura e Invoice de Demurrage
  (Administrativo), baixa manual e registro da Restituição (Financeiro e
  Administrativo);
- as demais exceções aceitas, com o motivo de cada uma, estão na ADR 0085.

Restrição por perfil fora da matriz abaixo é defeito. A matriz não substitui
as validações de estado e de escopo de cada RPC.

## Modelo de permissões por perfil

Regra vigente de quem faz o quê, ação por ação. Os módulos apontam para cá.

- **Colunas de perfil:** Adm = Administrativo, Fin = Financeiro, Ope =
  Operações, Doc = Documentação, Equ = Equipamentos; ✔ pode, — não pode;
  "dono" = só o Departamento dono da seção (no ADR de Saída: Operações,
  Documentação e Equipamentos).
- **Onde o banco aplica:** a guarda que decide hoje (RPC, policy RLS,
  gatilho ou Edge Function). Botão escondido e guarda de rota não são
  permissão.
- **Hoje:** "vigente" quando o banco já cumpre a regra inteira; "correção
  pendente" diz o que o banco faz hoje e aponta, pelo código, o item do
  [plano de correções](../archive/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md)
  (P*n* para a ADR 0085; A*n* e B*n* para a ADR 0083). Os códigos P do plano
  não são as faixas P1 e P2 da Demurrage.
- **Evidência:** leitura estática da definição mais recente de cada objeto
  na cadeia ativa (**Código**, 2026-10-14). As falhas de escrita direta pela
  API foram executadas no Postgres 16 local, como o perfil citado
  (**Teste**, não produção). O inventário completo está no
  [relatório de 2026-10-14](../archive/reports/2026-10-14-modelo-de-permissoes-por-perfil.md).
- **Bateria por perfil:** `src/integration/permissoesPorPerfil.local-pg.test.ts`
  (em `scripts/local-pg-suites.txt`) executa as ações da matriz como cada um
  dos cinco perfis no Postgres local, inclusive a escrita direta pela API nas
  tabelas de P1, P2, P3 e P15; as exceções sem caso próprio passam pela tabela
  `MATRIX_EXCEPTIONS` (P14), que confere a recusa por `42501` fora dos perfis
  da linha; as ações de todos os setores sem caso próprio passam pela tabela
  `MATRIX_GLOBAL`.
- **Matriz da tela:** "O que cada setor pode", em `/admin/usuarios`, e a lista
  "Com este setor, ... pode" das janelas de usuário vêm do catálogo único
  `src/services/permissionMatrix.ts` (lote 5b da identidade visual): 39 linhas
  que resumem as ações desta matriz, cada uma citando os casos da bateria que a
  provam. `permissionMatrix.test.ts` falha se uma linha ficar sem caso ou citar
  caso inexistente; a bateria falha se o banco divergir do catálogo. Mudar uma
  permissão muda as três coisas na mesma alteração: o banco, esta matriz e o
  catálogo.

### Leitura, administração e rastro

| Ação | Adm | Fin | Ope | Doc | Equ | Onde o banco aplica | Decisão | Hoje |
|---|---|---|---|---|---|---|---|---|
| Ler dado operacional e financeiro | ✔ | ✔ | ✔ | ✔ | ✔ | Policies `is_active_read_user()` | ADR 0044 | vigente |
| `/admin`: usuários, falhas de entrega de alertas, histórico de ações, sistema e Prazo do ADR | ✔ | — | — | — | — | Usuários: `admin_list_users` (`is_admin`). As demais abas: só a navegação (rota `adminOnly`); os dados por trás, como `audit_logs`, têm leitura global (ADR 0044) | ADR 0046 | vigente (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, P14) |
| Criar usuário, mudar setor, ativar e desativar, trocar e-mail e senha | ✔ | — | — | — | — | Edge `admin-users` (`is_admin`); policy de `user_profiles` e gatilho `prevent_user_profile_privilege_escalation` | ADR 0046 | vigente (**Teste** local da troca de setor e da situação: `permissoesPorPerfil.local-pg.test.ts`) |
| Desativar ou rebaixar o último Administrativo ativo | — | — | — | — | — | Gatilho `guard_last_active_administrativo` (migration `239`) | ADR 0083, item 2 | vigente (**Teste** local) |
| Excluir perfil interno | — | — | — | — | — | Sem DELETE em `user_profiles` para `authenticated` (migration `240`) | ADR 0083, item 3 | vigente (**Teste** local) |
| Registrar escrita em nome de outro usuário | — | — | — | — | — | `_assert_actor_is_caller` sem exceção para o Administrativo, chamado no início de toda RPC `SECURITY DEFINER` com `p_actor` executável por `authenticated` (migration `241`); sem usuário na sessão (`service_role`), o autor informado vale | ADR 0085, regra base 2 | vigente (**Teste** local) |

### Viagens e ADR de Saída

| Ação | Adm | Fin | Ope | Doc | Equ | Onde o banco aplica | Decisão | Hoje |
|---|---|---|---|---|---|---|---|---|
| Criar e editar viagem, escala, programação e exportação; omitir escala; fechar ADR de Saída | ✔ | ✔ | ✔ | ✔ | ✔ | Policies `is_active_user()`; RPCs com `is_active_user()` | ADR 0046 | vigente |
| Desmarcar a exportação de uma escala | ✔ | ✔ | ✔ | ✔ | ✔ | Gatilho `guard_export_schedule_removal` (migration `066`): recusa quando o porto tem Granito importado ou Embarque de Vazios aberto | ADR 0085, D14 | vigente (**Teste**, Postgres local, 2026-10-14) |
| Cancelar e reativar Viagem e B/L, com motivo | ✔ | — | — | — | — | `cancel_voyage`, `reactivate_voyage`, `cancel_bl`, `reactivate_bl` (`is_admin`) e gatilhos das migrations `066` e `089` | ADR 0071, itens 8 e 9 | vigente |
| Excluir viagem, escala (inclusive de exportação), atracação, B/L e container, com motivo e Trava | ✔ | — | — | — | — | `delete_records`, `delete_escala` (migrations `088` e `235`: escala com B/L recusada); sem DELETE direto pela API (`235`) | ADR 0046; ADR 0071; ADR 0083, item 7 | vigente (**Teste** local) |
| Excluir Cliente, com motivo | ✔ | — | — | — | — | `delete_records('customer', …)`, com a guarda do Administrativo antes do tipo | ADR 0046; ADR 0071 | vigente (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, P14) |
| Excluir taxa manual do B/L | ✔ | — | — | — | — | `delete_manual_bl_charge` (`is_admin`) | ADR 0071, item 11 | vigente: escrita direta em `charge_calculations` revogada (migration `231`, **Teste** local) |
| Reverter omissão de escala, com motivo | ✔ | ✔ | ✔ | ✔ | ✔ | `revert_voyage_omission` | ADR 0085, D9 | migration `251` |
| Reabrir ADR de Saída fechado, com motivo no Histórico | ✔ | ✔ | ✔ | ✔ | ✔ | `reopen_agency_departure_report*` | ADR 0085, D8 | migration `251`; a justificativa é obrigatória e vai para o rastro |
| Assinar e observar seção do ADR de Saída | ✔ | — | dono | dono | dono | `set_agency_report_*signoff*`, `set_agency_report_section_observation*`; terminal legado `set_agency_report_terminal` (Ope e Adm) | ADR 0046; ADR 0085, D13 | vigente |

### Manifesto, importações e cadastros

| Ação | Adm | Fin | Ope | Doc | Equ | Onde o banco aplica | Decisão | Hoje |
|---|---|---|---|---|---|---|---|---|
| Importar arquivos (B/L, CE, Baplie, veículos, Vazios, Granito, datas, Base de Clientes, programação) | ✔ | ✔ | ✔ | ✔ | ✔ | RPCs de importação com `is_active_user()` | ADR 0078, item 10; ADR 0085, D15 | vigente; Baplie sem container recusado no banco (migration `237`, **Teste** local) |
| Gravar direto (API) nas tabelas de carga: `bl_containers`, `baplie_containers`, `vehicles`, `vazios_*` (salvo `vazios_export_*`) e `granite_*` | — | — | — | — | — | Só as funções do sistema (importações, correções, RPCs); por coluna, a tela grava `bl_containers.unpacking_location` e `vazios_importacao_containers.natureza` | ADR 0094, B1 | vigente desde a migration `380`, como a `366` fez em `bls` (**Teste** local: `escritaDiretaFechada.local-pg.test.ts`). Container e veículo de B/L cancelado são somente leitura (`guard_cancelled_bl_cargo`, B4); desde a `385`, a passagem do chassi ao B/L reemitido vale só dentro do arquivo de B/L (`vela.vin_reissue`), e "Mover veículos" recusa B/L cancelado |
| Refixar o preço das Taxas Locais de B/L não faturado | — | — | — | — | — | `refix_bl_local_charge_prices` só com `service_role` até existir o aceite da reimportação | ADR 0094, A2 | vigente desde a migration `385` (**Teste** local: `revisaoFinalFrenteFinanceira.local-pg.test.ts`) |
| Chamar pela API as RPCs de importação e vínculo de Cliente antigas e as funções internas de cálculo | — | — | — | — | — | Só o servidor: a `366` revogou `import_bl_freight_transactional`, `import_bl_freight_with_metadata`, `apply_customer_base_row_atomic`, `apply_container_dates_atomic`, `approve_customer_reconciliation` e as de emissão por B/L; a `384` fechou `charge_table_in_use` e `bl_calculation_is_current` | ADR 0093; ADR 0094, B2 | vigente (**Teste** local: `faturamentoFechadoNaApi.local-pg.test.ts`; `scripts/security/verificar_guardas.py`) |
| Reprocessar efeito de importação, com justificativa | ✔ | ✔ | ✔ | ✔ | ✔ | `retry_import_effect` | ADR 0085, D10 | migration `252` |
| Excluir ou mover veículo, com motivo | ✔ | ✔ | ✔ | ✔ | ✔ | `delete_vehicles_with_reason` (migration `184`), `move_vehicles_to_bl` (migration `202`) | ADR 0078, item 23 | vigente |
| Excluir unidade manual e linha de serviço de vazios antes do ADR de Saída fechado | ✔ | ✔ | ✔ | ✔ | ✔ | RPCs de Vazios e `delete_catalog_row` | ADR 0071, item 4 | migration `262` (B14): o banco recusa com o ADR de Saída fechado; Excluir unidade pede motivo |
| Remover o CE Mercante do B/L sem fatura viva, com motivo | ✔ | ✔ | ✔ | ✔ | ✔ | `remove_bl_ce_mercante` | ADR 0078, item 5 | vigente |
| Criar e editar navio, armador, porto, Local e serviço | ✔ | ✔ | ✔ | ✔ | ✔ | Policies `is_active_user()` | ADR 0046 | vigente |
| Excluir cadastro sem uso, com motivo | ✔ | — | — | — | — | `delete_catalog_row` (migration `096`), que ainda não aceita navio, armador, porto nem tabela de Taxas Locais | ADR 0046; ADR 0073 | vigente: sem DELETE direto pela API (migration `235`, **Teste** local); navio, armador, porto e tabela de Taxas Locais não têm exclusão |
| Desativar e reativar Local, terminal e serviço | ✔ | — | — | — | — | Gatilho `guard_catalog_active_change` e `reactivate_catalog_row` | ADR 0073, item 8 | migration `263` (B15): gatilho `guard_catalog_active_change`; reativar com motivo por `reactivate_catalog_row` |
| Registrar Ocorrência do ADR (legado) | — | — | — | — | — | Nenhuma: `add_agency_report_occurrence` saiu do banco (migration `266`) | ADR 0030; ADR 0085 (funções sem tela) | vigente desde a migration `266` (P10) |
| Publicar na Central de Informações do Portal | ✔ | ✔ | ✔ | ✔ | ✔ | `internal_save_portal_information` | ADR 0085, D7 | migration `253` |

### Taxas Locais e Faturamento

| Ação | Adm | Fin | Ope | Doc | Equ | Onde o banco aplica | Decisão | Hoje |
|---|---|---|---|---|---|---|---|---|
| Criar e editar tabela, item e Condição de Cliente; lançar taxa manual | ✔ | ✔ | ✔ | ✔ | ✔ | Policies `is_active_user()`; `add_manual_bl_charge` | ADR 0046; decisão R6 de 2026-09-23 | vigente |
| Desativar, reativar e excluir tarifa | ✔ | — | — | — | — | Gatilho `guard_tariff_active_change` (migration `091`); reativar com motivo por `reactivate_catalog_row` (migration `261`); item e Condição de Cliente saem por `delete_catalog_row`, com motivo (migration `096`); a tabela (`charge_tables`) não tem exclusão desde a migration `235` | ADR 0073, item 4 | vigente |
| Alterar valores do cálculo do B/L e a situação financeira do B/L | — | — | — | — | — | Só as RPCs de cálculo e faturamento | ADR 0077; ADR 0085 | vigente: `charge_calculations` sem escrita direta (migration `231`) e `bls.financial_status` recusado na escrita pela API pelo gatilho `guard_bl_financial_status_port` (migration `232`) (**Teste** local) |
| Emitir fatura fora do automático: ficha do B/L, Validação, consolidada | ✔ | ✔ | ✔ | ✔ | ✔ | `mark_bl(s)_ready_and_create_invoice`, `create_invoice_from_bls*`, `create_local_consolidated_invoice` | ADR 0085, D3 | vigente desde a migration `246` (emissão por todos) e `272` (motivo interno obrigatório) (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, A9 e P4; `manualInvoice.local-pg.test.ts`) |
| Corrigir fatura emitida: Tentar reemitir, Tentar aplicar correção, Tentar emitir para o novo Cliente, Resolver fatura desatualizada | ✔ | ✔ | ✔ | ✔ | ✔ | `retry_pending_consolidated_reissue`, `retry_invoice_basis_changes`, `resolve_stale_invoice` | ADR 0085, D3 | vigente desde a migration `246` (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, A9 e P4) |
| Emitir fatura avulsa, com motivo | ✔ | ✔ | ✔ | ✔ | ✔ | `create_manual_invoice` | ADR 0083, item 9 | vigente desde a migration `246` (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, A9 e P4) |
| Registrar pagamento (baixa manual) | ✔ | ✔ | — | — | — | `register_verified_invoice_payment`, `register_invoice_payment`, `register_ledger_invoice_payment` | ADR 0085, base e D4 | vigente desde a migration `247` (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, P5). A escrita direta em `payments` saiu (migration `233`). |
| Cancelar baixa, com motivo | ✔ | — | — | — | — | `reverse_invoice_payment` (`is_admin`) | ADR 0071, item 13 | vigente |
| Cancelar fatura, com motivo | ✔ | — | — | — | — | `cancel_invoice`, `obsolete_consolidated_invoice` (`is_admin`) | ADR 0085, base e D1; ADR 0071, item 13 | vigente: a escrita direta em `invoices` saiu (migration `233`, **Teste** local) |
| Alterar fatura, item, pagamento ou recebível fora das RPCs | — | — | — | — | — | Sem grant de INSERT, UPDATE ou DELETE para `authenticated` em `invoices`, `invoice_items`, `payments`, `ledger_settlements`, `bl_receivables`, `invoice_counters`, `invoice_bls`, `invoice_granite_bls`, `invoice_receivable_links`, `invoice_lifecycle_events` e `billing_batches` (migration `233`) | ADR 0077; ADR 0085, falha 5 | vigente (**Teste**, Postgres local) |
| Autorizar restituição excepcional (avulsa e Demurrage) e cancelar a autorização pendente | ✔ | ✔ | ✔ | ✔ | ✔ | `request_financial_refund`, `cancel_financial_refund_authorization` | ADR 0085, D2 | vigente desde a migration `247` (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, P5) |
| Registrar a Restituição: confirmar a devolução com comprovante, favorecido e data | ✔ | ✔ | — | — | — | `confirm_invoice_refund`, `confirm_demurrage_refund` (`is_financeiro_user`) | ADR 0085, base e D2; ADR 0077 | vigente |
| Confirmar a Restituição pelo caminho antigo, sem comprovante | — | — | — | — | — | `settle_invoice_refund` sempre recusava e saiu do alcance de `authenticated` (migration `328`); só o dono do banco a executa (o cabeçalho da `328` cita `service_role`, que nunca teve o grant) | Achado P5 do lote 5b | vigente desde a migration `328` |
| Receber os alertas "Pix não conciliado", "Restituição pendente" e "Fatura desatualizada" | ✔ | ✔ | — | — | — | Audiência em `alert_type_catalog` (migrations `078`, `124` e `128`) | ADR 0085, D18 | vigente desde a migration `247` (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, P5). O Pix não conciliado também vai à Documentação e a Equipamentos. |
| Preparar cancelamento financeiro de B/L em fatura paga | ✔ | — | — | — | — | `prepare_bl_financial_cancellation` (`is_admin`) | ADR 0077, exceções controladas | vigente |
| Liquidar Ajuste de COD (vincular, abatimento, restituição) | ✔ | ✔ | — | — | — | `settle_cod_adjustment` (`is_financeiro_user`) | ADR 0051, decisão 3 | vigente |

### Demurrage e Granito

| Ação | Adm | Fin | Ope | Doc | Equ | Onde o banco aplica | Decisão | Hoje |
|---|---|---|---|---|---|---|---|---|
| Gerar Invoice de Demurrage e complementar | ✔ | ✔ | ✔ | ✔ | ✔ | `issue_demurrage_invoice_for_bl` | ADR 0085, D3 | vigente desde a migration `246` (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, A9 e P4) |
| Editar a condição de Demurrage do B/L (free time e diárias do B/L) | ✔ | ✔ | ✔ | ✔ | ✔ | `save_bl_demurrage_config` (`is_active_user()`, autor igual ao da sessão) | ADR 0046 | vigente (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, MATRIX_GLOBAL) |
| Registrar pagamento de Invoice de Demurrage | ✔ | ✔ | — | — | — | `register_demurrage_payment` (`is_financeiro_user`) | ADR 0085, base e D4 | vigente |
| Aplicar ou alterar desconto | ✔ | ✔ | ✔ | ✔ | ✔ | `apply_demurrage_discount` | ADR 0085, D4 | vigente desde a migration `247` (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, P5) |
| Cancelar Invoice e cancelar baixa de Demurrage | ✔ | — | — | — | — | `cancel_demurrage_invoice`, `reverse_demurrage_payment` (`is_admin`) | ADR 0085, base; ADR 0071, item 13 | vigente |
| Reabrir Invoice de Demurrage paga | — | — | — | — | — | `reopen_demurrage_invoice` não tinha tela e saiu do alcance de `authenticated` (migration `328`); a baixa se desfaz por `reverse_demurrage_payment` | Achado P5 do lote 5b | vigente desde a migration `328` |
| Alterar itens de Invoice emitida (dias, diária, subtotal) | — | — | — | — | — | Só as RPCs de emissão e recálculo | ADR 0077; ADR 0085 | vigente: escrita direta em `demurrage_invoice_items` revogada (migration `231`, **Teste** local) |
| Informar PTAX | ✔ | ✔ | — | — | ✔ | `recalculate_demurrage_invoices_manual` (migration `110`) | Decisão do dono de 2026-09-29; ADR 0085 | vigente |
| Gravar a referência cambial (ROE) | — | — | — | — | — | Só o job do BCB e o Informar PTAX | ADR 0083, item 14 | vigente: `save_exchange_rate_reference(_v2)` só para `service_role` e o Informar PTAX grava como dono (migration `236`, **Teste** local) |
| Criar e editar tarifa e acordo de Demurrage | ✔ | ✔ | ✔ | ✔ | ✔ | Policies `is_active_user()` de INSERT e UPDATE em `demurrage_rates` e `customer_demurrage_agreements` (migration `254`) | ADR 0085, D6 | vigente desde a migration `254` (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, P9) |
| Criar e editar taxa de Granito | — | — | — | — | — | Não existe: a tabela `granite_rates` saiu do banco (migration `329`) | ADR 0085, D6; decisões do responsável de 2026-10-19 ([Granito](../modules/granito.md)) | saiu em 2026-10-19: o Granito não tem Cliente nem cálculo de taxas; a tabela foi apagada na `329` (**Teste** local: `granitoSemCliente.local-pg.test.ts`) |
| Gravar ou alterar snapshot de taxa de Granito (`granite_bl_charges`) | — | — | — | — | — | Nenhum caminho: sem policy nem grant de escrita para `authenticated` (migration `330`); a leitura continua (`is_active_read_user()`) e a exclusão do B/L de Granito apaga os snapshots em cascata | Revisão da PR do lote 5b | vigente desde a migration `330`: antes, qualquer pessoa ativa podia gravar pelo PostgREST o valor por trás de uma fatura antiga de Granito (**Teste** local: `granitoSemCliente.local-pg.test.ts`) |
| Desativar, reativar e excluir tarifa de Demurrage | ✔ | — | — | — | — | Gatilho da migration `091`; `delete_catalog_row` | ADR 0073, item 4 | vigente; a tarifa de Granito saiu da tela em 2026-10-19 e do banco na migration `329` (`delete_catalog_row` e `reactivate_catalog_row` recusam `granite_rates`) |
| Responder, reabrir e anexar na Dispute | ✔ | — | — | — | ✔ | `add_demurrage_dispute_message`, `reopen_demurrage_dispute` (migration `081`); anexo e storage (migration `106`) | Migration `081` (decisão R13); ADR 0085 | vigente |
| Ver a fila de Disputas e a conversa | ✔ | ✔ | ✔ | ✔ | ✔ | `list_demurrage_disputes_internal` (migration `081`); as tabelas `demurrage_disputes*` já têm leitura `is_active_user()` | ADR 0044; ADR 0085, D17 | vigente desde a migration `250` (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, P12 e A18) |
| Editar os dados da disputa (assunto, motivo, notas) e o vencimento | ✔ | ✔ | ✔ | ✔ | ✔ | Grant de coluna em `demurrage_invoices` (migration `012`, reduzido pelas `028` e `106`): `due_date`, `dispute_subject`, `dispute_reason`, `dispute_notes`, `notes` | ADR 0046 | vigente |
| Mudar o intervalo da Régua de Cobrança | ✔ | — | — | — | — | `set_demurrage_dunning_interval_days` | Spec arquivada de 2026-08-27; ADR 0085 | vigente |

### Conciliação PIX

| Ação | Adm | Fin | Ope | Doc | Equ | Onde o banco aplica | Decisão | Hoje |
|---|---|---|---|---|---|---|---|---|
| Ver a fila, as exceções e o monitor Itaú | ✔ | ✔ | ✔ | ✔ | ✔ | RPCs `list_*` da conciliação e `itau_pix_monitor` | ADR 0044; ADR 0085, D5 | vigente desde a migration `247` (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, P5) |
| Conciliar: vincular, confirmar, tratar exceção, marcar recebimento Itaú | ✔ | ✔ | — | — | — | `link_pix_reconciliation_candidate`, `confirm_unified_pix_matches` (SECURITY DEFINER com guarda de setor desde a `329`), `upsert`/`resolve_pix_reconciliation_exception(s)`, `itau_pix_mark_receipt_handled`. A baixa por TXID (`reconcile_invoice_payment_by_txid`) não é executável pela API desde a `329`: só a confirmação do lote e a baixa automática Itaú (`itau_pix_settle`, `service_role`) a chamam | ADR 0085, D5; decisão do responsável de 2026-10-19 (achado P5 do lote 5b) | vigente desde a migration `247`; baixa por TXID fechada na `329` (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, P5) |

### Clientes, Comunicação e Portal

| Ação | Adm | Fin | Ope | Doc | Equ | Onde o banco aplica | Decisão | Hoje |
|---|---|---|---|---|---|---|---|---|
| Criar e editar Cliente | ✔ | ✔ | ✔ | ✔ | ✔ | Policies `is_active_user()`; `create_customer_with_contacts`, `update_customer_with_audit` | ADR 0046 | vigente |
| Desativar e reativar Cliente | ✔ | — | — | — | — | `deactivate_customer`, `reactivate_customer` (`is_admin`) e gatilho da migration `092` | ADR 0073, item 5 | vigente |
| Editar contatos e Caixas de Comunicação | ✔ | — | — | ✔ | ✔ | `internal_save_customer_contact_configuration` (migration `008`), `internal_fill_empty_contact_boxes` | ADR 0060; ADR 0046, nota de 2026-09-18 | vigente: sem escrita direta em `customer_contacts` (migration `232`, **Teste** local) |
| Consultar o histórico de Comunicados (`/clientes/comunicacao?tab=historico`) | ✔ | ✔ | ✔ | ✔ | ✔ | Policies `is_active_read_user()` de `customer_communications` e `customer_communication_bls`; a rota abre a todos; a vista Disparo exige `customer_communications` (`canSend` em `src/pages/ClientesComunicacao.tsx`) | ADR 0044; ADR 0085, D19 | vigente: a rota abre a todos e a vista Disparo fica com quem envia (**Teste:** `ClientesComunicacao.test.tsx`) |
| Disparar Comunicado e salvar modelo | ✔ | — | — | ✔ | ✔ | Edge `send-customer-communication`; `save_customer_communication_saved_template` | ADR 0060 | vigente |
| Ligar e desligar a chave global de envio | ✔ | — | — | — | — | `set_communications_enabled` | ADR 0059 | vigente |
| Provisionar o Portal: enviar e cancelar convite, conta, Email de Recuperação, endereço bloqueado, reabrir análise | ✔ | — | — | ✔ | — | Edges `portal-invite-send`, `portal-account-suspend` e `portal-recovery-email-change`; RPCs `portal_cancel_invite`, `portal_assisted_email_change`, `portal_release_suppressed_email`, `portal_return_to_analysis` (migration `002`) | ADR 0046 | vigente (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, P14) |
| Trocar o CNPJ do Portal | ✔ | — | — | — | — | `portal_admin_change_cnpj` | Plano arquivado de 2026-08-13; ADR 0085 | vigente |
| Conceder e revogar a Liberação de faturamento sem Portal | ✔ | — | — | — | — | `grant_`/`revoke_customer_billing_portal_release` | ADR 0070 | vigente |
| Ler o console de provisionamento completo e o Histórico | ✔ | ✔ | ✔ | ✔ | ✔ | `portal_list_provisioning_console`, `portal_list_provisioning_events` | ADR 0045; ADR 0083, item 18; ADR 0085, D12 | vigente desde a migration `250` (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, P12 e A18) |

### Desbloqueio de CE

| Ação | Adm | Fin | Ope | Doc | Equ | Onde o banco aplica | Decisão | Hoje |
|---|---|---|---|---|---|---|---|---|
| Ver pedidos, situação e solicitações do Cliente | ✔ | ✔ | ✔ | ✔ | ✔ | `ce_unlock_private.actor()` (definição vigente na migration `250`) | ADR 0085, D11 | vigente desde a migration `250` (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, P12 e A18) |
| Abrir e baixar documentos do pedido (procuração, termo, anexos) | ✔ | ✔ | ✔ | ✔ | ✔ | `ce_unlock_document_access` com `ce_unlock_private.actor()` (migration `250`); Edge `ce-unlock-document-download` | ADR 0085, D16 | vigente desde a migration `250` (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, P12 e A18) |
| Gerir pedidos, documentos, exportação para a ZPT e conciliação | ✔ | — | — | ✔ | — | `ce_unlock_private.actor(true)` (definição vigente na migration `250`) | ADR 0085, D11 | vigente (**Teste** local: `permissoesPorPerfil.local-pg.test.ts`, P12 e P14) |

### Administrativo ativo mínimo

O banco recusa rebaixar de setor ou desativar o último Administrativo ativo
([ADR 0083](../adr/0083-decisoes-da-revisao-geral-da-documentacao.md), item 2; migration `239`). A regra está em
[Operação e suporte § Administrativo ativo mínimo](../modules/operacao-suporte.md#administrativo-ativo-mínimo).
Limite conhecido: o gatilho olha UPDATE de `user_profiles`; apagar o usuário no
Supabase Auth (painel ou `service_role`) remove o perfil em cascata sem passar
por ele. A API do navegador não apaga perfil (migration `240`).

## Duas fronteiras de autenticação

| Fronteira | Hook | Mecanismo |
|---|---|---|
| **Interna** | `src/hooks/useAuth.tsx` | Supabase Auth + perfil em `user_profiles`; timeout de inatividade de **8 horas**; role → permissões. |
| **Portal** | `src/hooks/usePortalAuth.tsx` | Supabase Auth. Login exclusivo por CNPJ normalizado via Edge Function `portal-login`. |

> **Logout fail-closed:** tanto `useAuth` quanto `usePortalAuth` utilizam `removeLocalSessionFallback` (`src/services/supabaseAuth.ts`). Se a revogação remota falhar ou exceder o timeout de 5 segundos (por partição de rede ou indisponibilidade do Auth), a sessão local (localStorage e memória) é purgada forçadamente no cliente de forma isolada, removendo estritamente o `storageKey` da respectiva aplicação (`td-portal-auth` no Portal e a chave padrão no app interno), preservando o isolamento de sessões no mesmo domínio. Na interface do Portal, o botão de logout desabilita durante o processo (`isSigningOut`) e exibe aviso contextual na tela de login caso a revogação no servidor não tenha sido confirmada (G-PAF3). O aviso vem do estado vivo do provider (`signOutError`): aparece quando a falha é confirmada, até 5 s depois do redirecionamento para o login, e é limpo ao iniciar um novo login; não é persistido em `sessionStorage`, para nunca reaparecer num logout posterior bem-sucedido.

> **Portal login:** o navegador envia apenas CNPJ, senha e o token do desafio Cloudflare Turnstile para `portal-login`; a identidade técnica fica no servidor. A Edge Function confere o Turnstile (ação `portal_login`; `portal_recovery` na recuperação) antes de qualquer outra verificação e recusa com HTTP `404` token ausente ou inválido; sem `TURNSTILE_SECRET_KEY`, só o stack local passa ([serviços externos](servicos-externos.md#cloudflare-turnstile)). As demais recusas do login — CNPJ desconhecido, conta inativa, senha errada e bloqueio — recebem o mesmo `401` genérico; o email técnico aparece no claim `email` do JWT depois do login, então a senha guardada no GoTrue é derivada com pepper e só as Edge Functions sabem calculá-la. Para não transformar o custo da verificação em oráculo de CNPJ, conta elegível e conta inexistente fazem exatamente um lookup administrativo e as mesmas tentativas no Auth (primeiro a senha derivada `HMAC(PORTAL_PASSWORD_PEPPER, senha)`, depois a senha pura de conta legada, que migra para a derivada quando acerta); o caso inexistente usa a identidade sem vínculo configurada em `PORTAL_LOGIN_DUMMY_AUTH_USER_ID`, e qualquer sessão dummy é descartada. As Edge Functions do Portal chamadas pelo navegador compartilham uma allowlist de origens em `supabase/functions/_shared/cors.ts` (`vela.app.br`, `portalfwlog.com.br` e localhost de dev); os previews dos dois projetos Cloudflare Pages são aceitos por padrões restritos aos nomes `vela-internal` e `vela-portal`, e domínios adicionais entram somente como URLs HTTPS exatas em `CLOUDFLARE_PAGES_PREVIEW_ORIGINS`. Origem fora da allowlist recebe a **ausência** de `Access-Control-Allow-Origin`, nunca a string `null` — `null` é uma origem real (iframe `sandbox`, documento `data:`, alguns redirecionamentos) e devolvê-la liberaria justamente o contexto mais anônimo; `Vary: Origin` acompanha para que cache compartilhado não sirva o header de uma origem a outra.

> **Senha do Portal:** a ADR 0019 vale para as duas fronteiras. `supabase/functions/_shared/passwordPolicy.ts` espelha `src/lib/passwordPolicy.ts` e é a única regra aplicada em `admin-users`, `portal-invite-activate` e `portal-password-reset` — mínimo de 8 caracteres com maiúscula, minúscula e dígito, igual ao `password_requirements` de `supabase/config.toml`. As Edge Functions validam antes de chamar o GoTrue para que a recusa chegue ao cliente como regra explicada, e não como erro genérico de ativação.

### Revogação de sessões internas

Desde a migration `407` ([ADR 0096](../adr/0096-corte-do-token-interno-na-revogacao.md)),
Editar acesso (troca de e-mail ou senha) e Desativar cortam na hora o access
token já emitido, como o Portal faz desde a `069`. `internal_revoke_sessions`
apaga sessões e refresh tokens e grava o marco (`clock_timestamp()`, sob lock
do perfil) em `internal_credential_revocations`, tabela sem grant para os
clientes. Depois disso, o token do próprio usuário com `iat` ausente, não
numérico ou anterior ao marco é recusado:

- os helpers de papel (`is_active_user`, `is_active_read_user`, `is_admin`,
  `is_financeiro_user`, `_portal_actor_role`, `current_actor_role`) e
  `ce_unlock_private.actor` respondem como se o usuário não estivesse ativo;
- as políticas que liam `user_profiles` direto passaram a chamar os helpers;
- `check_internal_token_cutoff()`, o `pgrst.db_pre_request` do PostgREST,
  responde `28000` antes de qualquer RPC ou tabela. Ela cobre também as
  funções que ainda leem `user_profiles` no corpo.

Rotina de serviço que age em nome do usuário (troca só `request.jwt.claim.sub`
e carrega o JWT do `service_role`) não é cortada. Reativar o usuário não devolve
a autoridade ao token antigo. No app interno, perfil que não carrega com `28000`
encerra a sessão local. Quando o Administrativo troca a própria credencial, a
`admin-users` audita antes de revogar, e a tela encerra a sessão e pede um novo
login. A troca da própria senha em Meu perfil segue o contrato do Supabase Auth
e não grava marco. Prova: `src/integration/corteTokenInterno.local-pg.test.ts`.

A troca da própria senha em Meu perfil (`AlterarMinhaSenhaModal`) confere a
senha atual na tela e também a envia ao Auth (`current_password`). A tela
sozinha não protege contra um token roubado chamando o Auth direto: a proteção
no servidor depende de "Require current password when changing password"
ligado no projeto ([serviços externos](servicos-externos.md#conferência-supabase-auth--2026-10-22)).

### Rotinas reservadas ao sistema

As funções que só o `service_role` e o pg_cron chamam e que elevam
`request.jwt.claim.role` ou agem como ator do sistema (`itau_pix_settle`,
`itau_pix_receipt_failed`, `itau_pix_record_untracked`,
`reconcile_http_job_failures_alert`, `reconcile_import_effects_queue_alert`,
`reconcile_itau_pix_checkpoint_alert`, `reevaluate_expired_billing_releases`)
não dependem só do GRANT: um envelope com o mesmo nome chama
`_assert_service_caller()`, que recusa com `42501` qualquer chamador com JWT
que não seja `service_role` (migration `413`). Guardas de permissão vêm antes de
travas: a baixa de 8 argumentos (`register_ledger_invoice_payment`) confere o
Financeiro antes de travar os B/Ls. Prova:
`src/integration/guardasAntesDoTrabalho.local-pg.test.ts`.

## Rate limiting

- **Login, recuperação e ativação do Portal:** contados por hash do CNPJ em
  `portal_login_attempts`, em baldes separados: login (5 erros em 15 minutos,
  também usado pela verificação da senha atual na troca do Email de
  Recuperação), recuperação (5 pedidos em 15 minutos) e ativação (10 recusas em
  5 minutos). O balde do Supabase, chaveado só pelo CNPJ
  ([ADR 0049](../adr/0049-rate-limit-do-portal-chaveado-somente-por-cnpj.md)),
  sempre decide, e falha da RPC conta como bloqueio; trocar de IP não contorna o
  bloqueio. Só a credencial recusada pelo Auth (`invalid_credentials`) entra no
  balde do login; limite de taxa, erro 5xx ou falha de rede do Auth respondem
  `503` sem cobrar o CNPJ (`_shared/authRefusal.ts`, auditoria run-3). A tentativa
  de login é reservada no balde antes de a senha ser conferida, sob trava do
  CNPJ (migration `410`), para pedidos simultâneos não passarem do limite. A camada opcional no Upstash Redis (par IP+CNPJ, chaves HMAC) só
  acrescenta bloqueio. Contrato, segredos, validação e rollback em
  [Rate limit do Portal](portal-rate-limit.md); comportamento das telas em
  [Portal do Cliente](../modules/portal-cliente.md#autenticação-e-sessão).
- **Ações self-service do Portal:** consolidar, desfazer consolidada e abrir
  disputa usam `check_portal_rate_limit` sobre `portal_rate_limits` (3 tentativas
  em 10, 15 e 30 minutos), executável só pelas RPCs do Portal desde a migration
  `106`. `portal_login_resolution_attempts` pertence ao resolver legado
  `portal_resolve_login`, que o login não usa.
- **Convites e recuperação:** tokens opacos de uso único, com expiração e hash
  persistido.
- **Anexos de disputa de demurrage:** cota máxima cumulativa de 100 MB por cliente em disputas abertas e limite de taxa de 20 uploads a cada 24 horas por cliente (G-PAF1), verificados pela RPC `add_demurrage_dispute_attachment` sob lock transacional por cliente para prevenir condições de corrida (TOCTOU).

## Invariante de provisionamento do portal

Uma conta de `customer_portal_accounts` só pode ficar ativa quando possui `auth_user_id`. A identidade é criada na ativação do convite. Suspender revoga as sessões e bloqueia a conta (Suspensa) sem mudar a decisão de provisionamento; reativar uma conta Suspensa devolve o Cliente a Aguardando análise, desfaz o vínculo e bane o usuário técnico antigo, para um novo convite ([Portal do Cliente](../modules/portal-cliente.md#provisionamento-e-ativação-do-convite)). O Portal pronto é trava de toda emissão, inclusive a automática pela transição do CE; a saída é a ativação ou a Liberação de faturamento sem Portal ([Regras de negócio](regras-de-negocio.md#gate-de-faturamento), [ADR 0070](../adr/0070-portal-trava-toda-emissao-e-liberacao-por-cliente.md)).

Troca/redefinição de senha, recuperação assistida, troca de Email de Recuperação (self-service ou assistida, migration arquivada `195`) e suspeita de comprometimento revogam as sessões existentes via `portal_revoke_sessions` (criada na migration arquivada `194`, definição vigente na migration `132`; delete direto em `auth.sessions`/`auth.refresh_tokens` — o endpoint admin `/admin/users/{id}/logout` do GoTrue retorna 404 nesta versão). O reset self-service revoga antes da mudança, instala uma quarentena futura em `credentials_revoked_at`, altera a senha e revoga novamente; falha intermediária mantém o fluxo negado fechado.
O corte de `iat` é estrito desde a migration `069`: qualquer access
token emitido antes do marco final é recusado, inclusive dentro dos cinco
segundos antes tolerados. Token sem `iat` válido também é recusado enquanto o
marco estiver ativo.

A migration `132` faz `portal_revoke_sessions` adquirir o lock da conta antes
de revogar sessões e gravar o marco final com `clock_timestamp()`. JWTs emitidos
durante a espera também ficam anteriores ao corte; `now()` representaria o
início da transação e deixaria essa janela aberta.

Desde a migration `131`, reset e confirmação do Email de Recuperação usam RPCs
exclusivas de `service_role` com lock por conta. O reset aceita somente convite
pendente, não expirado e destinado ao email atual, consome-o e registra
`recovery_reset_invite_id` antes de chamar o Auth. A confirmação aplica o email,
cancela os links de recuperação anteriores e revoga sessões na mesma transação.
O trigger cobre também a troca assistida. Enquanto o reset está em andamento,
qualquer alteração do Email de Recuperação é recusada; o marcador só é removido
depois da alteração da senha e da revogação final confirmadas.

Na confirmação pública, reset em andamento retorna HTTP `423` e a tela informa
que o novo email ainda não foi confirmado, orientando reabrir o link depois.
HTTP `409` permanece reservado ao pedido já resolvido por outro caminho.

**Publicação:** aplicar as migrations `131` e `132` antes de publicar `portal-password-reset`
e `portal-recovery-email-change`. **Falha de reset:** não há desbloqueio por tempo.
O operador deve confirmar nos logs que a execução terminou e que nenhuma chamada
ao Auth continua pendente, verificar o resultado da alteração e revogar as sessões
antes de concluir a operação com `portal_finish_password_reset(account_id,
invite_id)` usando `service_role`. Não reutilizar o convite consumido: depois de
resolver a operação, emitir uma nova recuperação. Sem confirmação desses passos,
manter o bloqueio e investigar. A quarentena de credenciais permanece válida.

As RPCs `SECURITY DEFINER` de provisionamento vigentes (`portal_return_to_analysis`, `portal_admin_change_cnpj`, `portal_cancel_invite`, `portal_assisted_email_change`, `portal_release_suppressed_email`) autorizam em duas camadas: EXECUTE concedido só a `authenticated`/`service_role` (o herdado do `PUBLIC` foi revogado na migration arquivada `192`) e guarda NULL-safe sobre `_portal_actor_role()`, negando role indefinido — inclusive clientes do Portal, que também são role `authenticated`. `portal_set_exception` restou apenas como função que recusa, sem grant a `authenticated`. A migration arquivada `203` revogou e removeu as RPCs temporárias de pré-voo e backfill. Correção da falha *fail-open* encontrada em teste de isolamento por CNPJ (2026-07-14): a comparação com role NULL não disparava o `permission denied`, e o `REVOKE ... FROM anon` original não removia o EXECUTE do `PUBLIC`.

A migration `068` estende a mesma disciplina NULL-safe às RPCs internas de
Dispute, modelos de comunicação e terminal do ADR. As implementações de negócio
ficam privadas e os wrappers concedidos a `authenticated` negam um cliente do
Portal antes de qualquer leitura ou mutação. A mesma migration faz as RPCs de
detalhes financeiros projetarem allowlists JSON explícitas: notas internas,
identidade de operadores, justificativas, aprovadores, TXID e snapshots de
cálculo não atravessam a fronteira do Portal. A interface mostra o ROE aplicado,
sem decompor no navegador o fator comercial da cotação.

## Edge Functions

- **Convite/ativação e recuperação** — criam a identidade técnica somente na ativação do convite, sem expor email técnico ou senha ao operador; suspensão revoga as sessões do usuário.
- **`portal-password-recovery`** — responde imediatamente `{ accepted: true }` (HTTP 200) após checagem de rate limit e delega processamento (busca de conta, supressão, convite reusável e envio de email) para background com `EdgeRuntime.waitUntil` (G-PAF4), eliminando canal lateral de temporização (TTFB uniforme para CNPJs válidos e inexistentes). O processamento em background opera em melhor esforço (best-effort); caso o isolate seja encerrado antes da conclusão, novo pedido pode ser feito pelo cliente após expirar a janela de rate limit.
- **`portal-dispute-attachment`** — recebe uploads multipart de clientes do Portal com `verify_jwt = false` no gateway para garantir a passagem de requisições de preflight CORS (`OPTIONS`), validando o token JWT da sessão explicitamente no início da função via `authClient.auth.getUser()`. Valida tipo/tamanho do arquivo (máx 10 MB) e magic bytes em memória (PDF, JPG, PNG, TXT), confirma autoria da mensagem (`author_type = 'cliente'` e `author_id = auth.uid()`), grava no storage via `service_role` no caminho `<customer_id>/disputes/<dispute_id>/<message_id>/...` e invoca a RPC `add_demurrage_dispute_attachment` com o cliente autenticado do usuário para registro de metadados, verificação física do objeto no storage e verificação de quota (100 MB em disputas abertas) e limite diário (20 uploads/24h por cliente). Em caso de falha no registro de metadados, remove imediatamente o objeto órfão do storage. Anexos do Portal só são aceitos em Disputes abertas (`add_demurrage_dispute_attachment` e `portal_check_dispute_attachment_eligibility`, migration `075`), para que nenhum upload fique fora da quota. No fluxo interno de Demurrage, a remoção imediata do órfão usa a policy `demurrage_dispute_objects_delete`, que permite ao usuário interno ativo apagar pelo Storage API apenas o objeto que ele mesmo enviou e que ainda não tem metadado; anexo registrado é imutável. A RPC `list_orphaned_dispute_attachments(p_older_than)` (somente `service_role`, somente leitura) lista órfãos por idade; a remoção dos caminhos listados deve ser feita pelo Storage API, porque apagar linhas de `storage.objects` por SQL não remove o arquivo físico. Clientes do Portal não possuem permissão de escrita direta no bucket `demurrage-disputes` (policy `demurrage_dispute_objects_insert` restrita a Equipamentos/Administrativo, autoria da sessão e caminho de mensagem em Dispute aberta, migration `106`). A RPC `portal_check_dispute_attachment_eligibility` permite pré-validação de cota e rate limit no front-end antes da inserção da mensagem na conversa.
- **`send-customer-communication`** — valida sessão interna, perfil ativo,
  natureza, contato, preferência e supressões antes de registrar a tentativa;
  a chave global desligada registra simulação e não chama o provedor de e-mail.
  A automação (`customer-communication-auto-runner`) autentica só pelo
  `X-Communication-Automation-Secret` e manda no `Authorization` a chave
  pública (`SUPABASE_ANON_KEY`), nunca a de serviço; as duas funções têm
  `verify_jwt = false`. Assunto do livre e do institucional e nome de anexo
  saem sem CR/LF (`singleLine`).
- **Corpo com teto** (auditoria run-3) — `_shared/boundedBody.ts` conta os
  bytes do stream e para no limite, com ou sem Content-Length; acima dele a
  função responde 413. `admin-users`, `portal-invite-send`,
  `portal-account-suspend`, `portal-login`, `portal-password-recovery`,
  `portal-password-reset` e `portal-invite-activate` leem até 16 KiB de JSON
  (as três primeiras só depois do papel e da sessão de quem chama);
  `portal-email-webhook` recusa sem `svix-id`, `svix-timestamp` ou
  `svix-signature` antes de ler e lê até 256 KiB. A leitora multipart
  (`boundedMultipart.ts`) usa a mesma contagem.
- **`recalc-demurrage-ptax`** — só `POST` (o job chama por `net.http_post`);
  outro método recebe 405 antes da conferência do segredo.
- **`demurrage-dunning`** — aceita somente o bearer de
  `DEMURRAGE_DUNNING_SECRET` em comparação *timing-safe*, usa `service_role`
  apenas no servidor e reivindica cada cobrança antes de renderizar/enviar,
  evitando concorrência entre execuções do cron.

## Headers HTTP / CSP

Gerados em `_headers` pelo staging do Cloudflare Pages:

- `X-Frame-Options: DENY` · `X-Content-Type-Options: nosniff` · `Referrer-Policy`
- **CSP** sem `unsafe-inline` em scripts; `connect-src` restrito a Supabase, `olinda.bcb.gov.br`, Sentry, PostHog EU e Turnstile; `script-src`/`frame-src` só abrem o Turnstile e a configuração do PostHog. O browser não chama o provedor de e-mail (MillionSend) diretamente; o envio permanece nas Edge Functions. Ver [Deploy](../setup/deploy.md#headers-rotas-e-cors).

## Outras defesas

- **Upload guard:** `assertUploadSize` (`src/lib/fileGuard.ts`) limita tamanho antes de `XLSX.read` (mitiga a vulnerabilidade conhecida do `xlsx`).
- **Injeção em filtros PostgREST:** input de usuário em `.or()/.ilike()` é escapado por `escapeFilterTerm` / `sanitizeLikeTerm` (`src/lib/utils.ts`) e termos que ficam vazios após o escape não geram cláusula. A fronteira cobre as buscas de clientes (lista, lookup e export), faturamento, Granito e bookings de Vazios.
- **Injeção de fórmula em planilhas:** `src/lib/spreadsheetSafe.ts` é o sanitizador canônico. `src/services/exports.ts`, `src/lib/csv.ts` e `src/services/reconciliacao.ts` o reutilizam antes de gerar XLSX/CSV, nos valores e nos cabeçalhos. O CSV também põe entre aspas o campo com `;` ou tab, porque o Excel em pt-BR separa por `;` e o pedaço depois do separador abriria outra célula.
- **Higienização de artefatos de build:** `scripts/clean-build-artifacts.mjs` remove `.map` e `.vite` ao final de cada build (`cleanProductionArtifacts`) e executa varredura recursiva estrita pós-build (`assertNoForbiddenArtifacts`), falhando fechado (`process.exit(1)`) se qualquer mapa de código-fonte ou diretório de cache vazar no diretório final de distribuição.
- **Segredos de servidor** ficam **apenas** em env vars de Edge Functions, nunca no bundle do cliente. No Portal, `service_role` e a chave do provedor de e-mail (`RESEND_API_KEY`) nunca vão ao navegador nem a logs ou auditoria, e o frontend não os usa para contornar RLS e permissões.

### Read model do Console

`portal_list_provisioning_console` (definição vigente na migration `103`) usa `SECURITY DEFINER` com `search_path` fixo, sem execução para `PUBLIC`/`anon`, e restringe a RPC por perfil. Antes da leitura, chama o reparo idempotente `portal_repair_missing_accounts`, sem grants diretos e sem criação de credenciais. Desde a migration `250` (A18 e P12), Operações recebe o console completo e o Histórico, sem ações ([matriz](#clientes-comunicação-e-portal)). Os eventos são limitados entre 1 e 50 registros. O read model nasceu nas migrations arquivadas `migrations_archive/196_portal_provisioning_console_read_model.sql`, `197_portal_provisioning_console_fixes.sql` (vínculo de alertas de invoice seguro para identificadores textuais; `financial_status` nulo em `has_active_process`) e `198_portal_provisioning_queue_self_heal.sql`. Telas e ações em [Portal do Cliente](../modules/portal-cliente.md#console-clientesportal).

## Riscos de segurança monitorados

- A leitura de planilhas usa `@e965/xlsx` com limite de upload antes do parsing e acesso restrito a usuários autenticados. O `npm audit` do repositório estava limpo em 2026-08-26; manter o limite e revalidar a dependência em atualizações. Ver [ROADMAP](../ROADMAP.md).
- Snapshots de auditoria de segurança ficam em [archive/](../archive/README.md).

## Desbloqueio de CE Mercante

As migrations do Desbloqueio (`139`–`149`, `160`, `161`, `173` e `220`; as `137`–`138` são da Central de Informações) usam schema privado para implementação e RPCs públicas
com allowlists e `search_path` fixo. Não há grants de tabela para o navegador.
Portal resolve CNPJ pela sessão/conta ativa, nunca pelo payload. Administrativo
e Documentação gerenciam; todos leem, inclusive os documentos (migration
`250`; [matriz](#desbloqueio-de-ce)). Inspeção
consulta pelo cliente selecionado e recusa comandos de escrita.

`portal-ce-unlock-document` limita o corpo multipart mesmo sem Content-Length
(leitora compartilhada `_shared/boundedMultipart.ts`, que desde a auditoria run-3
também lê o anexo de Dispute em `portal-dispute-attachment`, com 10 MiB mais a folga do envelope),
aceita PDFs de até 10 MiB com extensão, MIME e assinatura `%PDF-`, e reserva
caminho/quota no servidor (20 tentativas/24 h; 100 MiB ativos por cliente).
Autentica com `getUser`, grava com cliente de serviço e finaliza com RPC do
usuário que revalida autoria, contexto e metadados reais do objeto. PDF inválido
é recusado antes da reserva; falha de armazenamento reivindica e compensa a
reserva pendente sem remover um PDF já registrado. Tentativas nunca finalizadas
não entram na projeção dos documentos nem substituem a versão submetida. Download
autorizado em RPC gera URL privada com 60 segundos; nunca há leitura direta
no bucket `ce-unlock-documents`. O modelo oficial é o único PDF global do Portal.

Comandos exigem UUID idempotente; repetição com payload diferente é recusada.
Versões otimistas protegem pedido, revisão documental e entrega. Exportação
revalida os requisitos em transação e registra snapshot; download ou aprovação
não confirmam desbloqueio. Arquivos gerados usam sanitização canônica para
evitar fórmulas de planilha.

`ce-unlock-cleanup` e `ce-unlock-notify-email` usam bearer dedicado `CE_UNLOCK_CLEANUP_SECRET` e falham
fechado se ausente. Envio à ZPT e conciliação (`ce_unlock_zpt_status`, `exported_at`) são
visíveis só ao desk: o Portal os recebe removidos por `ce_unlock_private.portal_view`. `service_role` é usado apenas dentro do servidor, nunca
como segredo do cron ou no navegador. A agenda nasce desativada. Consulte
[serviços externos](servicos-externos.md#desbloqueio-de-ce-mercante) para rollout
e retenção. Código no checkout não comprova publicação destas funções/policies.

`itau-pix` usa bearer dedicado `ITAU_PIX_ADMIN_SECRET`, sem JWT da plataforma,
e falha fechado se ele ou a configuração Itaú estiverem ausentes. O
certificado mTLS e o client_secret ficam só em secrets das Edge Functions;
respostas e erros nunca contêm o token de acesso. As ações de diagnóstico
consultam somente TXIDs com prefixo `VELA` (a mesma chave Pix é usada por um
sistema de terceiro) e só alteram ou cancelam cobranças de teste (`VELAT…`,
até R$ 1,00); a cobrança de uma fatura só muda pela própria fatura. A
listagem de Pix recebidos devolve apenas os do Vela, sem `infoPagador`, e só
a contagem dos demais. O motivo de erro gravado na cobrança leva no máximo 300
caracteres do corpo de erro do Itaú, sem `devedor`, `pagador`, `infoPagador`,
os identificadores dentro deles nem o valor recusado das violações
(`redactPayerData`, auditoria run-3).

A baixa automática (`itau_pix_settle`, só `service_role`) assume dentro da
transação a identidade da conta Admin dedicada "API Itaú" configurada em
`app_settings.itau_pix_settlement_actor` e a restaura ao sair (em produção,
`auth.uid()` lê `request.jwt.claim.sub` antes de `request.jwt.claims`;
conferido em 2026-10-06). Assim, as
mesmas checagens de `auth.uid()`/`is_admin()` das baixas manuais continuam
valendo. Conta inativa ou ausente faz o Pix ir para análise, sem baixa. Pix
do sistema de terceiro e dados do pagador não são gravados.

`itau_pix_monitor` (leitura) aceita qualquer usuário interno ativo e
`itau_pix_mark_receipt_handled` (encerrar Pix em análise com motivo), o
Financeiro e o Administrativo, conferidos dentro da função (migration `247`;
[matriz](#conciliação-pix)); as tabelas Itaú
continuam sem acesso direto para `authenticated`.

A evidência externa de confirmação permanece restrita ao desk também no
histórico: motivos legados de eventos `confirm` são omitidos no Portal e nas
leituras resumidas de Financeiro/Operações. A UI envia a referência em campo
próprio, sem copiá-la para o motivo público.

### Leitura RLS de Disputes e Storage

A migration `158_dispute_storage_internal_session.sql` usa `CASE` nas políticas
de leitura para que identidades internas não executem
`current_portal_customer_id()`, contrato estrito que exige sessão válida do
Portal. A política INSERT continua exigindo Equipamentos/Administrativo,
mensagem própria, Dispute aberta e caminho do cliente/disputa/mensagem.
Validação SQL local confirma essas restrições. Correção aplicada com autorização
do dono em produção em 2026-10-06; upload físico e metadados confirmados na
sessão real de Equipamentos. Interface na sessão real de Financeiro conferida sem resposta/anexo; em
2026-10-08, um `POST` direto ao Storage com essa sessão foi recusado com `404
AccessDenied` (RLS). Ver o relatório da retomada run-2 e o
[plano arquivado](../archive/plans/2026-09-28-remediacao-auditoria-seguranca-run-2.md).
