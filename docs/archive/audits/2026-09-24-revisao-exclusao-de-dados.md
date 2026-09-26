# Revisão da exclusão de dados — 2026-09-24

## Resultado executivo

O sistema **não tem uma política única de exclusão**. Convivem seis formas
diferentes de "tirar um dado de circulação" — exclusão física, cancelamento,
inativação, arquivamento por cópia, marcação em `audit_logs` e substituição
automática por reimportação — escolhidas módulo a módulo. A decisão vigente
([ADR 0009](../../adr/0009-hard-delete-controlado-bloqueios-fiscais-auditoria.md),
complementada pela [ADR 0024](../../adr/0024-cancelamento-viagem-estado-retido-exclusao-hard-delete.md))
cobre só B/L, container, veículo, cliente e viagem; o resto ficou sem regra
escrita.

Não existe *soft delete* genérico (`deleted_at`) em nenhuma tabela. Toda
"Exclusão" na interface é **hard delete** (a linha some do banco). O que se
parece com soft delete são estados de negócio: `cancelled`, `active = false`,
`deactivated_at`, `revoked_at`.

Principais riscos encontrados (detalhe em [Achados](#achados-priorizados)):

1. **P1** — Em Clientes, Locais/Terminais, Taxas Locais e Embarque de Vazios o
   botão Excluir aparece para qualquer usuário interno, mas o banco só aceita
   exclusão de Admin/Administrativo. Para os demais, o banco apaga 0 linhas sem
   erro e a tela mostra "excluído" — e em Clientes grava uma auditoria de
   exclusão que não aconteceu.
2. **P1** — As exclusões em cascata feitas pelo navegador não são atômicas:
   veículos (ou contatos e overrides) são apagados antes do registro principal;
   se o banco recusar o principal, os filhos já se perderam.
3. **P1** — Faturas, pagamentos, recebíveis e liquidações não têm botão de
   excluir, mas o banco permite DELETE a Admin via API. A proteção fiscal está na
   ausência de botão, não no banco.
4. **P1** — `audit_logs` pode ser editado e apagado por Admin. A trilha não é
   imutável, e ela também guarda estado operacional (escalas removidas).
5. **P2** — A exclusão de viagem não deixa nenhum rastro.
6. **P2** — Não há caminho de recuperação documentado: o backup lógico em R2
   não está agendado em produção e o PITR não é habilitado por ele.

Escopo: commit `682be9f3`, branch `main`. Leitura estática de `src/`,
`supabase/migrations/` (estado final reconstruído de 001 a 085 por script) e
documentação. Nenhum ambiente Supabase foi consultado e nenhum arquivo de
aplicação foi alterado.

## Como a exclusão funciona hoje

Uma exclusão atravessa até seis camadas. Cada uma é aplicada por um dono
diferente, e o comportamento visível depende da combinação:

| Camada | Onde | O que faz |
|---|---|---|
| 1. Botão na tela | `src/pages/`, `src/components/` | Mostra ou esconde "Excluir" (às vezes por `isAdmin`, às vezes para qualquer usuário). Não é segurança. |
| 2. Pré-checagem | `checkBlDependencies`, `checkContainerDependencies`, `checkCustomerDependencies` (`src/services/`) e `deleteVoyage` | Consulta vínculos fiscais e devolve deletáveis × bloqueados com motivo legível. Existe só para B/L, container, cliente e viagem. |
| 3. Grant de tabela | `GRANT ... DELETE ... TO authenticated` | Se ausente, o banco responde erro de permissão. Revogado em tabelas append-only e em algumas financeiras (ex.: `demurrage_invoices`). |
| 4. Policy RLS de DELETE | quase todas `USING (public.is_admin())` | `is_admin()` = papel `admin` **ou** `administrativo`, ativo. Sem permissão, o DELETE afeta 0 linhas **sem erro**. |
| 5. Chaves estrangeiras e triggers | `ON DELETE CASCADE / SET NULL / RESTRICT`, `trg_guard_*` | Cascateiam filhos, zeram referências ou bloqueiam. Triggers bloqueiam viagem com vínculo, viagem cancelada, container compartilhado já faturado, exportação com carga e tabelas append-only. |
| 6. Rastro | trigger `audit_row_changes` + `logDeletions` | O trigger grava em `audit_logs` a linha inteira (JSON) com `field_name = 'excluido'`; `logDeletions` grava uma segunda linha `deleted` quando há autor. |

A ADR 0009 descreve a auditoria como *best-effort* (`logDeletions`). Na
prática, o registro forte é o trigger de banco `audit_row_changes`, que já
existe em ~50 tabelas e grava o conteúdo completo da linha apagada. A ADR não o
menciona.

## Inventário por entidade

Legenda de nível: **Hard** = linha removida do banco; **Estado** = a linha fica
e muda de estado; **Arquivo** = copiada para outra tabela e removida da
original; **Marca** = registro em `audit_logs` que o leitor interpreta como
removido.

### Operação marítima

| Entidade | Ação na tela | Nível | Quem vê o botão / quem o banco aceita | Bloqueios | O que vai junto | Rastro |
|---|---|---|---|---|---|---|
| **Viagem** (`voyages`) | Cancelar viagem | Estado `cancelled` via RPC `cancel_voyage` com motivo | Quem edita viagens | — | Viagem fica selada: triggers recusam qualquer escrita ou exclusão em tabelas com `voyage_id` | Auditoria na mesma transação |
| **Viagem** | Excluir viagem | Hard | Admin / Admin | `trg_guard_voyage_hard_delete`: recusa se cancelada ou se houver qualquer linha com `voyage_id`/`anchor_voyage_id` | Nada (só passa sem vínculos) | **Nenhum** (ver A5) |
| **Escala de importação (POD)** | Excluir escala do planejamento | Marca em `audit_logs` (`voyage_pod_schedule`, `deleted = true`) | Qualquer usuário / qualquer usuário ativo | — | — | A própria marca |
| **Escala de exportação (POL)** | Mesmo botão | Hard em `voyage_export_schedules` | Qualquer usuário / qualquer usuário ativo (migration 080) | `trg_guard_export_schedule_removal`: recusa se houver manifesto de granito ou operação de vazios no POL | — | `audit_row_changes` |
| **Omissão de escala** | Reverter omissão | Estado (`reverted_by`) | Admin, com justificativa | — | — | Auditoria + notificação |
| **B/L** (`bls`) | Excluir (individual e em massa) | Hard | Admin / Admin | Pré-checagem: fatura, fatura consolidada, recebível, vínculo de recebível, fatura de Demurrage. Banco (RESTRICT): também `cod_adjustments` e `customer_communication_bls` | Veículos (apagados antes pelo navegador); containers, carga solta, fretes, transbordos, cálculos de taxa, logs de faturamento, fila de conciliação (CASCADE) | `audit_row_changes` + `logDeletions` |
| **Container** (`bl_containers`) | Excluir | Hard | Admin / Admin | Pré-checagem: cálculo de taxa, item de Demurrage. Banco: container compartilhado já faturado em outro B/L | Veículos (apagados antes pelo navegador); resoluções de Baplie | `audit_row_changes` + `logDeletions` |
| **Veículo** (`vehicles`) | Excluir | Hard | Admin / Admin | — | — | `audit_row_changes` + `logDeletions` |
| **Manifesto Mercante** | Nenhuma tela usa | Hard (`deleteManifestoMercante`) | — / Admin | — | B/Ls perdem o vínculo (SET NULL) | `audit_row_changes` |
| **Manifesto BAPLIE da viagem** | Excluir manifesto (Vazios importação) | Hard via RPC `delete_baplie_manifest_for_voyage` | Qualquer usuário ativo | — | Containers do manifesto | — |
| **Unidade de vazios manual** | Excluir unidade | Hard via RPC `delete_manual_vazios_booking` | Qualquer usuário ativo | — | — | — |
| **Linha de serviço de vazios** | Lixeira em Embarque de Vazios | Hard | Qualquer usuário / Admin | — | — | `audit_row_changes` |
| **Programação de navios** (`vessel_schedules`) | Encerrar navio | Arquivo: copia para `ended_vessels` e apaga | Admin / Admin (RPC `archive_vessel_schedule`) | — | — | `audit_row_changes` nas duas tabelas |
| **Navio, porto, armador** | Sem exclusão | — | — / Admin via API | FKs NO ACTION/RESTRICT de viagens, B/Ls, locais | — | `audit_row_changes` |
| **Publicação no Portal** | Remover do Portal | Estado (`show_on_portal = false`) | Quem edita | — | — | — |

### Clientes e contatos

| Entidade | Ação na tela | Nível | Quem vê / quem o banco aceita | Bloqueios | O que vai junto | Rastro |
|---|---|---|---|---|---|---|
| **Cliente** (`customers`) | Excluir (menu e em massa) | Hard | **Qualquer usuário** / Admin | Pré-checagem: B/L, fatura, fatura de Demurrage, recebível, lote de faturamento. Banco (RESTRICT) também: comunicações, disputas, grupos de cobrança | Contatos e overrides (apagados antes pelo navegador); contas e sessões do Portal, acordos de Demurrage, notificações, eventos, liberações do Portal (CASCADE); referências em granito e conciliação zeradas | `audit_row_changes` + `logDeletions` |
| **Contato** (`customer_contacts`) | Desativar contato | Estado (`deactivated_at`) | Quem edita | — | — | `audit_row_changes` |
| **Contato**, quando o cliente é excluído | — | Hard | — | — | Preferências | `audit_row_changes` |
| **Conta do Portal** | Cancelar convite (RPC `portal_cancel_invite`, com motivo) | Estado (`active`, status do convite) | Administrativo / Documentação | — | — | Eventos de provisionamento (append-only) |
| **Liberação de faturamento no Portal** | Revogar liberação | Estado (`revoked_at`) | Administrativo | — | — | `audit_row_changes` |
| **Usuário interno** | Desativar | Estado (`user_profiles.active = false`) via Edge Function | Admin | — | — | `audit_user_profile_changes` |

### Cadastros e tarifas

| Entidade | Ação na tela | Nível | Quem vê / quem o banco aceita | Observação |
|---|---|---|---|---|
| **Local / Terminal / Depot** (`depots`) | Checkbox Ativo **e** botão Excluir | Estado **ou** Hard | **Qualquer usuário** / Admin | RESTRICT se usado por B/L, escala, relatório ADR, booking ou serviço; o serviço traduz a mensagem da FK. Exclusão leva os serviços junto (CASCADE). |
| **Serviço do local** (`depot_services`) | Inativar **e** Excluir | Estado **ou** Hard | **Qualquer usuário** / Admin | RESTRICT se usado em linha de serviço de vazios. |
| **Tabela de taxas locais** (`charge_tables`) | Ativar/desativar | Estado (`active`) | Qualquer usuário | Sem exclusão de tabela na tela. |
| **Item de tabela de taxas** | Excluir item | Hard | **Qualquer usuário** / Admin | FK NO ACTION de cálculos e overrides bloqueia item em uso (erro cru). |
| **Override de tarifa por cliente** | Excluir override | Hard | **Qualquer usuário** / Admin | — |
| **Tarifa de Demurrage** | Ativar/desativar **e** Excluir | Estado **ou** Hard | Admin / Admin | — |
| **Acordo de Demurrage do cliente** | Ativar/desativar **e** Excluir | Estado **ou** Hard | Admin / Admin | — |
| **Tarifa de granito** | Excluir | Hard | Admin / Admin | Cobranças perdem a referência (SET NULL). |

### Financeiro

| Entidade | Ação na tela | Nível | Observação |
|---|---|---|---|
| **Fatura local** (`invoices`) | Cancelar fatura | Estado (`cancelled`, `cancelled_at`, `cancelled_by`) | Sem exclusão na tela. **Banco aceita DELETE de Admin** e cascateia itens, eventos de ciclo, estornos e vínculos. |
| **Item manual de fatura** | Remover cobrança manual | Hard via RPC `delete_manual_invoice_charge` | Só fatura em aberto, sem pagamento, Admin. |
| **Taxa manual do B/L** | Excluir linha manual | Hard via RPC `delete_manual_bl_charge` | Só se o B/L não foi faturado. |
| **Fatura de Demurrage** | Cancelar invoice | Estado via RPC | DELETE revogado no grant: o banco recusa exclusão. |
| **Pagamento, recebível, liquidação** | Sem exclusão | — | **Banco aceita DELETE de Admin.** |
| **Disputa e mensagens** | Sem exclusão | — | Mensagens imutáveis por trigger. |

### Dados derivados e substituídos pelo sistema

Estes dados são apagados e recriados automaticamente, sem ação do usuário:

- Reimportação de manifesto e de frete: substitui containers e veículos do B/L
  (`import_manifest_transactional_legacy_165`,
  `import_bl_freight_transactional_legacy_205`), carga solta
  (`import_breakbulk_manifest_transactional`) e bookings de vazios.
- Cálculo de taxas locais: `charge_calculations` automáticos são apagados e
  recalculados (`calculate_bl_local_charges` e migrations 054–064).
- Reimportação BAPLIE: substitui `baplie_containers` da viagem (migration 077).
- Alertas: itens se resolvem por reconciliação; o usuário só dispensa
  (`alert_item_dismissals`).

### Registros append-only (ninguém exclui pelo app)

`demurrage_calculation_snapshots`, `import_effect_attempts`,
`portal_email_event_attempts`, `portal_provisioning_events` e
`demurrage_dispute_messages` têm trigger que recusa UPDATE e DELETE.
`demurrage_invoice_history`, `customer_contact_change_events`,
`exchange_rate_reference_history` e outros têm o DELETE revogado no grant.

## Achados priorizados

### A1 — P1: botão Excluir para quem o banco não autoriza, com falso sucesso

**Código.** Clientes (`canEditCustomers = Boolean(profile || user)`,
`src/pages/Clientes.tsx:53`), Locais/Terminais e serviços
(`src/pages/DepotCadastro.tsx:51`), Taxas Locais — itens e overrides
(`src/pages/TaxasLocaisTabelas.tsx:15-16`) e linha de serviço de vazios
(`src/pages/EmbarqueVazios.tsx:106`) mostram Excluir a qualquer usuário
interno. As policies de DELETE dessas tabelas exigem `is_admin()`. O
PostgREST responde a um DELETE barrado por RLS com 0 linhas e sem erro, e os
services não conferem quantas linhas foram apagadas. Resultado esperado para um
usuário de Financeiro, Operações, Documentação ou Equipamentos: toast de
sucesso, nada apagado. Em Clientes, `logDeletions` ainda grava `deleted` em
`audit_logs` para um cliente que continua existindo.

A tela atual de B/L, container, veículo, viagem e tarifas de Demurrage/granito
usa `isAdmin` e não tem esse problema.

**Suspeita** em runtime: não foi reproduzido em ambiente autenticado.

### A2 — P1: cascata feita pelo navegador não é atômica

**Código.** `deleteBls`, `deleteContainers` e `deleteCustomers` fazem duas ou
três requisições separadas: primeiro apagam veículos (ou contatos e overrides),
depois o registro principal. Se a segunda falhar, a primeira já foi gravada.
Casos em que a pré-checagem passa e o banco recusa:

- B/L com `cod_adjustments` ou `customer_communication_bls` (RESTRICT, fora da
  pré-checagem) → veículos do B/L já apagados.
- Container compartilhado já faturado em outro B/L
  (`trg_guard_shared_container_mutation`) → veículos do container já apagados.
- Cliente com comunicação, disputa ou grupo de cobrança (RESTRICT, fora da
  pré-checagem) → contatos e overrides já apagados; cliente continua existindo.

Em lote, uma única linha bloqueada derruba o `DELETE ... IN (...)` inteiro,
depois de os filhos de todas as linhas terem sido apagados.

### A3 — P1: registros fiscais protegidos só pela ausência de botão

**Código.** `invoices`, `invoice_items`, `payments`, `bl_receivables` e
`ledger_settlements` mantêm `GRANT DELETE` para `authenticated`
(`002_business_logic_and_security.sql:30530-31042`) e policy de DELETE
`is_admin()`, sem trigger de bloqueio. Um Admin com o token da sessão consegue
apagar uma fatura pela API; a exclusão cascateia itens, eventos de ciclo de
vida e estornos. A ADR 0009 declara que dependências fiscais bloqueiam a
exclusão — isso vale para o B/L (as FKs impedem apagá-lo com fatura), não para
o documento fiscal em si. `demurrage_invoices`, com DELETE revogado no grant, já
mostra o padrão correto.

### A4 — P1: a trilha de auditoria é editável

**Código.** `audit_logs` tem policies `audit_logs_update_admin` e
`audit_logs_delete_admin` e grant de UPDATE/DELETE. Qualquer Admin pode apagar o
registro de uma exclusão. Além disso, `audit_logs` é a fonte de leitura do
planejamento de escala (marca `voyage_pod_schedule`/`deleted`): a trilha de
auditoria também é dado operacional, então limpar auditoria altera a
programação.

### A5 — P2: exclusão de viagem sem rastro

**Código.** `voyages` não tem o trigger `audit_row_changes`, e `deleteVoyage`
(`src/services/voyages.ts:90`) não chama `logDeletions`. Depois da exclusão não
se sabe quem apagou, quando, nem qual era a viagem. As datas de escala gravadas
em `audit_logs` para essa viagem continuam lá, órfãs.

### A6 — P2: sem caminho de recuperação

**Código/documentação.** Hard delete é irreversível no app. Segundo
[backup-r2.md](../../operations/backup-r2.md), o backup lógico cifrado não é
agendado em produção e não habilita PITR. Hoje, a única forma de desfazer uma
exclusão seria remontar a linha a partir do JSON gravado por
`audit_row_changes` — sem ferramenta, sem os filhos em cascata quando a tabela
filha não tem trigger, e sem procedimento escrito. **Suspeita:** o estado do
PITR no projeto Supabase não foi consultado.

### A7 — P2: mesma palavra, efeitos diferentes

**Código.** "Excluir escala" grava uma marca na importação e apaga de verdade a
exportação. "Desativar contato" preserva o contato, mas "Excluir cliente" apaga
os contatos. Locais, serviços, tarifas de Demurrage e acordos têm Ativo **e**
Excluir lado a lado, sem regra de quando usar qual. "Encerrar navio" arquiva por
cópia. O usuário não tem como saber pela tela se a ação é reversível.

### A8 — P3: permissões de exclusão fora do padrão Admin

**Código.** Escala (POD e POL), manifesto BAPLIE, unidade manual de vazios e
taxa manual do B/L podem ser removidos por qualquer usuário ativo. A migration
080 torna isso uma decisão explícita para a escala de exportação; para os
demais não há registro de decisão.

### A9 — P3: caminho de exclusão sem tela

**Código.** `deleteManifestoMercante` e `useDeleteManifestoMercante` existem,
com teste, mas nenhuma tela os usa.

### A10 — P3: dados pessoais sem regra de retenção

Contatos desativados, contas do Portal inativas e usuários desativados guardam
nome e e-mail indefinidamente, e `audit_row_changes` copia esses dados para
`audit_logs` a cada alteração ou exclusão. Não há regra de anonimização ou
prazo de retenção (LGPD).

## Base para a política de exclusão

A proposta abaixo organiza todos os dados em seis classes. A classe define
**se** o dado pode sair de circulação, **como** sai e **quem** decide. Ela
aproveita os mecanismos que já existem; o objetivo é torná-los uma regra, não
criar um soft delete genérico (a ADR 0009 já rejeitou `deleted_at` em todas as
tabelas pelo custo em listagens, relatórios e faturamento).

| Classe | Exemplos | Regra proposta | Mecanismo |
|---|---|---|---|
| **1. Fiscal e financeiro** | faturas, itens, pagamentos, recebíveis, liquidações, faturas de Demurrage, estornos, disputas | **Nunca excluir.** Corrigir por cancelamento, estorno ou reemissão. | DELETE revogado no grant + trigger de recusa, como em `demurrage_invoices`. |
| **2. Trilha e eventos** | `audit_logs`, `*_events`, `*_attempts`, snapshots, histórico | **Append-only.** Ninguém edita ou apaga pelo app; expurgo só por rotina de retenção. | Trigger de recusa em UPDATE/DELETE; tirar o estado operacional de dentro de `audit_logs`. |
| **3. Operacional com ciclo de vida** | viagem, B/L, container, veículo, manifestos, escalas | **Excluir só erro de cadastro**, enquanto não houver vínculo. Depois disso, **cancelar** (estado retido). | Uma RPC por entidade, numa transação: pré-checagem no banco, filhos, principal, auditoria e motivo. |
| **4. Cadastro de referência** | cliente, local/terminal, serviço, tabela e item de taxa, tarifas, acordos, navio, porto, armador | **Inativar** é o padrão. Excluir só o que nunca foi referenciado. | `active` / `deactivated_at` existentes; FK RESTRICT como última barreira. |
| **5. Derivado ou reimportável** | cálculos automáticos, staging de importação, BAPLIE, alertas | O **sistema** substitui livremente; o usuário não exclui manualmente. | Funções de importação e recálculo existentes. |
| **6. Dado pessoal** | contatos, contas do Portal, usuários | **Inativar**; anonimizar sob pedido ou após prazo. | Rotina de anonimização a definir. |

Regras transversais propostas:

1. **Autorização no banco.** A tela só mostra a ação quando a policy a permite;
   o service verifica as linhas afetadas e trata 0 como erro (corrige A1).
2. **Uma transação.** Exclusão com filhos vira RPC no banco; o navegador não
   encadeia DELETEs (corrige A2).
3. **Motivo obrigatório** em toda exclusão e cancelamento, gravado junto.
4. **Auditoria no banco.** Toda tabela das classes 1, 3 e 4 tem
   `audit_row_changes`; `logDeletions` deixa de ser a fonte (corrige A5).
5. **Vocabulário fixo na interface:** *Excluir* = irreversível, só erro de
   cadastro; *Cancelar* = fica visível como cancelado; *Inativar* = some das
   escolhas, reversível; *Arquivar* = sai da lista ativa, consultável.
6. **Recuperação:** definir o que restaura um hard delete (PITR, backup ou
   ferramenta sobre `audit_logs`) antes de ampliar a exclusão.

### Decisões que dependem do dono do negócio

1. Administrativo continua com o mesmo poder de exclusão do Admin?
   (`is_admin()` inclui os dois.)
2. B/L e container: manter exclusão física de erro de cadastro, ou passar a
   cancelar também?
3. Classe 3: qual é o "vínculo" que encerra a janela de exclusão? (Hoje varia:
   qualquer `voyage_id` para viagem; só vínculo fiscal para B/L.)
4. Cliente com histórico: deve existir inativação de cliente? Hoje não existe.
5. Prazos de retenção para `audit_logs`, eventos do Portal e dados pessoais
   inativos.
6. Habilitar PITR no Supabase de produção.
7. As exceções de A8 (qualquer usuário ativo remove escala, BAPLIE, unidade de
   vazios e taxa manual) continuam valendo?

## Evidências e lacunas

- **Código:** todos os achados vêm de leitura estática de `src/` e das
  migrations 001–085. O estado final de policies, grants, FKs e triggers foi
  reconstruído por um script que aplica em ordem os `CREATE`/`DROP`/`ALTER`/
  `GRANT`/`REVOKE`. Os triggers criados dentro de blocos `DO` dinâmicos (selo
  de viagem cancelada, migration 066) foram lidos à parte.
- **Teste existente:** `src/integration/voyageHardDeleteGuard.local-pg.test.ts`
  executa o guard de exclusão de viagem em Postgres local. Não foi executado
  nesta revisão.
- **Não verificado:** o comportamento em runtime autenticado por papel (A1, A2);
  o estado real do banco remoto e do PITR (A6); se há linhas órfãs hoje em
  `audit_logs` de viagens excluídas (A5).
