# Regras de negócio

> Regras **não óbvias** que atravessam módulos ([ADR 0082](../adr/0082-governanca-documental-dono-unico-e-adr-historica.md)). A regra de um só domínio fica no doc do módulo ([índice documental](../README.md)); termos e distinções, no [glossário](../../CONTEXT.md); o motivo de cada decisão, na ADR citada. Número de migration sem qualificação é da cadeia ativa (`supabase/migrations/`); o da cadeia anterior à consolidação é escrito "migration arquivada `NNN`".

---

## Gate de faturamento

A emissão exige cliente reconciliado, cálculo elegível, revisão sem pendências
bloqueantes, CE Mercante e o Gate de faturamento do Portal aberto.
`047_bl_documental_gates.sql` guarda a promoção e a emissão
individual/consolidada; `056` inclui as duas tabelas do B/L misto. O CE também
participa da liberação documental para leitura no Portal
([Gate de CE Mercante no Portal](#gate-de-ce-mercante-no-portal)).
Cálculo provisório não equivale a emissão. As pendências são derivadas no banco;
a Revisão resolve vínculo e correções, sem uma aprovação em lote obrigatória. Na
Validação, o que ainda impede a emissão aparece na coluna **Motivo**
([Faturamento § Motivo de bloqueio de faturamento](../modules/faturamento.md#motivo-de-bloqueio-de-faturamento)).

**O Portal trava toda emissão** — manual, consolidada ou automática pela
transição do CE ([ADR 0070](../adr/0070-portal-trava-toda-emissao-e-liberacao-por-cliente.md)).
O gate (`customer_billing_access_ready`, definição vigente na migration `084`)
passa quando a Conta de Portal do Cliente está pronta — ativa, com acesso
criado e Email de Recuperação válido, entregável e fora da lista de bloqueio
([Portal do Cliente § Gate de faturamento e Dispute](../modules/portal-cliente.md#gate-de-faturamento-e-dispute)) —
ou quando há [Liberação de faturamento sem Portal](#liberação-de-faturamento-sem-portal)
vigente. Para Cliente sem gate aberto, o CE calcula e **retém** a fatura no B/L
(`billing_hold_reason = 'Acesso ao portal nao provisionado'`), sem tratar isso
como falha; a Validação mostra *Conta do Portal não ativa*. A ativação do Portal e
a concessão da Liberação reprocessam o Cliente e emitem as retidas pelo mesmo
caminho da transição do CE, com o cálculo gravado no registro do CE, sem
recalcular pela tabela vigente; o USD converte pelo ROE do dia da emissão
([Faturamento § Propósito e escopo](../modules/faturamento.md#propósito-e-escopo)).

A exceção da migration `051_ce_mercante_auto_billing.sql` (a automação do CE
emitia sem depender do provisionamento, num contexto interno) foi revogada pela
`083_portal_trava_universal_liberacao_faturamento.sql`; o contexto da `051` não
muda mais nenhum gate. O e-mail de contato não é condição de faturamento, com
ou sem Portal: a fatura de Taxas Locais chega ao Cliente pelo Portal ou
impressa e entregue por um usuário interno (migration `085`, que desfez a
exigência da `084`). O e-mail de contato continua servindo à cobrança de
Demurrage e aos Comunicados.

Fontes: ADRs [0038](../adr/0038-taxa-local-valor-congelado-ancorado-na-escala.md),
[0042](../adr/0042-ce-mercante-confirma-calculo-em-todos-os-modos.md),
[0054](../adr/0054-portal-como-gate-de-faturamento.md),
[0069](../adr/0069-resolucao-de-tabela-de-taxas-e-funcao-unica-compartilhada.md) e
[0070](../adr/0070-portal-trava-toda-emissao-e-liberacao-por-cliente.md); [Faturamento](../modules/faturamento.md).

### Liberação de faturamento sem Portal

Decisão do Administrativo, por Cliente, que abre o Gate de faturamento do
Portal enquanto o Portal não fica pronto (ADR 0070; migrations `083` a `085`,
`167` e `168`).

- **Quem e onde.** Só o Administrativo concede (**Conceder liberação**, com a
  confirmação **Liberar e emitir**) e revoga (**Revogar liberação**); o banco
  recusa os demais papéis. O card "Liberação de faturamento sem Portal" fica na
  ficha do Cliente (aba Financeiro) e na revisão do Cliente no console
  `/clientes/portal` ([Portal do Cliente § Provisionamento e ativação do convite](../modules/portal-cliente.md#provisionamento-e-ativação-do-convite));
  os outros Departamentos só consultam, e Operações não vê o card no console.
  O Portal não enxerga a Liberação.
- **Condições.** Justificativa (mínimo de 3 caracteres) e data de revisão
  futura de até 30 dias, contados em dias de Brasília; a tabela tem um teto de
  31 dias como defesa. Não depende de contato com e-mail. Há uma Liberação
  aberta por Cliente: conceder outra revoga a anterior, e a tela só oferece
  **Conceder nova liberação** quando não há Liberação vigente. Autor e datas
  ficam registrados; a revogação pede motivo (mínimo de 3 caracteres) e fica em
  `audit_logs`.
- **Efeito.** Conceder abre o gate na hora: os B/Ls não faturados do Cliente
  saem da Revisão (gatilho da migration `167`) e as faturas retidas pelo CE são
  emitidas, com as taxas do dia do CE. A tela informa quantas faturas saíram e
  quantos B/Ls seguem com outro bloqueio. A Liberação **não ativa a conta do
  Portal nem dá acesso ao Cliente**: sem Portal, um usuário interno entrega a
  fatura. Fatura emitida com Liberação vigente não abre a exceção crítica de
  fatura sem Portal.
- **Revogação.** A trava volta na hora; os B/Ls não faturados do Cliente voltam
  à Revisão com o motivo do Portal (migration `167`) e o Alerta de Portal não
  provisionado é reconciliado. Faturas já emitidas continuam emitidas.
- **Vencimento.** Passada a data de revisão, a trava volta no mesmo instante:
  o gate compara a data com a hora atual. O job diário
  `billing-release-expiry-review` (03:13 UTC, 00:13 de Brasília; migration
  `168`) devolve à Revisão, com o Alerta de Portal não provisionado, os B/Ls não
  faturados do Cliente cuja Liberação venceu nos últimos 7 dias, se ele não tem
  outra Liberação vigente nem Portal pronto. O B/L volta à fila até a madrugada
  seguinte ao vencimento.

**Código:** `src/components/clientes/BillingPortalReleaseCard.tsx`; RPCs
`grant_customer_billing_portal_release` (definição vigente na migration `085`)
e `revoke_customer_billing_portal_release` (migration `083`).
**Teste:** `src/integration/portalBillingRelease.local-pg.test.ts` (retenção,
permissão, concessão com emissão, revogação, vencimento e ativação do Portal).

## Numeração de invoices

A numeração sequencial é atômica no banco, via RPC `assign_invoice_number` sobre `invoice_counters`. Nunca gerar número no cliente — garante unicidade fiscal mesmo sob concorrência. Detalhes em [Faturamento](../modules/faturamento.md).

## Ledger local e ciclo de vida

Taxas locais usam um **ledger local** ([ADR 0007](../adr/0007-ledger-local-ciclo-vida-invoices.md)) como fonte de saldo; as tabelas e o que cada uma possui estão em [Faturamento § Ownership financeiro](../modules/faturamento.md#ownership-financeiro).

Demurrage **não** entra no ledger local — mantém persistência própria (`demurrage_invoices`), com operação própria em `/demurrage` e consultas em Conciliação PIX e Portal (ADRs [0008](../adr/0008-demurrage-integrado-sem-unificar-persistencia.md)/[0050](../adr/0050-financeiro-segregado-por-processo-faturavel.md)).

## Vencimento e inadimplência

**A fatura de taxas locais não tem vencimento praticado** ([ADR 0055](../adr/0055-taxa-local-sem-vencimento-praticado.md),
migration arquivada `348`). A operação nunca cobrou prazo nessa fatura, então
`invoices.due_date` e o status `overdue` foram removidos, junto com o job
`mark-overdue-invoices`, o detector `detect_overdue_invoices` e o gatilho
`fn_block_invoice_overdue_customer` que bloqueava novas emissões. O estado da
fatura local é regido só por emissão e pagamento: "em aberto" é saldo positivo.

Não existe bloqueio comercial persistido no Cliente. A retenção de faturamento
é por B/L (`bls.billing_hold_reason`, que a Validação mostra na coluna
**Motivo**; ver [Faturamento § Motivo de bloqueio de faturamento](../modules/faturamento.md#motivo-de-bloqueio-de-faturamento)).
As decisões humanas por Cliente que afetam a emissão são a
[Liberação de faturamento sem Portal](#liberação-de-faturamento-sem-portal) e o
Cliente desativado ([Cadastro usado](#cadastro-usado)).

**A Invoice de Demurrage também não vence** nem fica `overdue`
([ADR 0014](../adr/0014-demurrage-recalculo-diario-substitui-roe-congelado.md);
a retirada do `overdue` é da migration arquivada `157`): a coluna
`demurrage_invoices.due_date` é remanescente, e a emissão atual
(`create_demurrage_invoice_authoritative`, migration `214`) não a preenche. Ver
[Demurrage](../modules/demurrage.md).

## Câmbio (ROE / PTAX)

Cobranças em moeda estrangeira usam o ROE obtido da PTAX Venda do Banco Central (`olinda.bcb.gov.br`) pelo serviço compartilhado `fetchROE`, com markup canônico de `1,065`. O header interno consome esse contrato por `useRoeHeaderRate`; sem ROE/dados fiscais suficientes, a emissão da invoice é bloqueada. Aplica-se a Faturamento e Demurrage. O Recálculo Diário e o congelamento no pagamento da Invoice de Demurrage estão em [Demurrage § Recálculo diário e congelamento no pagamento](../modules/demurrage.md#recálculo-diário-e-congelamento-no-pagamento); a taxa local em dólar, em [Faturamento § Taxa local em dólar](../modules/faturamento.md#taxa-local-em-dólar).

## Reconciliação de cliente

O consignatário importado (B/L de container, carga solta e Granito) só se vincula sozinho ao Cliente pelo CNPJ exato; nome, nome canônico ou similaridade apenas sugerem, e a decisão é da Revisão. Regra completa em [Clientes § Reconciliação de cliente em B/L e Granito](../modules/clientes.md#reconciliação-de-cliente-em-bl-e-granito).

## Ações sobre registros

O vocabulário — Excluir, Corrigir, Cancelar, Reativar, Desativar, Remover,
Revogar, Reverter e Dispensar — está no
[glossário § Ações sobre registros](../../CONTEXT.md#ações-sobre-registros).
Esta seção diz quem pode, quando se exige motivo, o que trava a exclusão e por
quanto tempo cada dado fica. A matriz de quem pode cada operação está em
[Permissões internas](#permissões-internas).

### Vocabulário e rótulos

O vocabulário foi decidido em 2026-09-24. Cada termo tem um único efeito, e o
rótulo de um botão corresponde ao efeito que ele produz.

- **Excluir** serve só para erro de cadastro em registro que ainda não tem
  vínculo. Não é a saída para um registro que já não pode ser excluído: depois
  da [Trava de exclusão](#trava-de-exclusão), o caminho é corrigir, substituir,
  reemitir ou cancelar.
- **Corrigir** é o caminho para erro de cadastro em registro com vínculo; o
  valor anterior fica só na Auditoria.
- **Cancelar** registra, com motivo, que um fato de negócio deixou de valer: o
  armador cancelou a viagem, a fatura foi anulada, uma baixa foi lançada por
  engano. O registro permanece e continua visível como cancelado; não é
  correção de erro de cadastro.
- **Reativar** desfaz, com motivo e rastro, um cancelamento ou uma desativação,
  e o Histórico mostra os dois eventos. Documento fiscal cancelado (fatura,
  Invoice de Demurrage) não se reativa: emite-se outro, que referencia o
  cancelado.
- **Remover** tira um item de um lugar ou de um vínculo sem apagá-lo; uma ação
  que apaga o registro do banco se chama Excluir, não Remover.
- **Reverter** desfaz, com motivo, uma marcação sobre algo que continua ativo
  (omissão de escala, transbordo).
- **Dispensar** não muda o dado e só existe em Alertas e Notificações
  ([Operação e Suporte § Leitura, dispensa e Eco de Tratamento](../modules/operacao-suporte.md#leitura-dispensa-e-eco-de-tratamento)).
- Baixa lançada por engano se cancela (**Cancelar baixa**:
  `reverse_invoice_payment` e `reverse_demurrage_payment`); devolver dinheiro
  ao Cliente é outro ato, com registro próprio (`invoice_refunds` e
  `demurrage_refunds`;
  [Faturamento § Pagamento, saldo e restituição](../modules/faturamento.md#pagamento-saldo-e-restituição),
  [Demurrage § Baixa, cancelamento da baixa e restituição](../modules/demurrage.md#baixa-cancelamento-da-baixa-e-restituição)).

Devolver ao Cliente o que ele pagou a maior é **Restituição**, como as telas,
o módulo Faturamento e a ADR 0077 dizem; "estorno" é sinônimo a evitar, e
Cancelar baixa é outra ação ([ADR 0083](../adr/0083-decisoes-da-revisao-geral-da-documentacao.md), item 1, que
substitui o "Estorno" do vocabulário de 2026-09-24).

Divergências de rótulo que ainda existem na interface (**Código**): usuário
interno em `/admin/usuarios` (`src/pages/Admin.tsx`) e acordo de Demurrage
(`CustomerDemurrageAgreementsTab.tsx`) dizem **Ativar** em vez de **Reativar**
(B13, correção pendente); o aviso do serviço do Local diz "Serviço inativado."
(B15, correção pendente); e textos de
tela usam "estorno" no sentido de Cancelar baixa — a reversibilidade de
`ValidacaoTab.tsx`, `ConsolidatedInvoiceModal.tsx` e
`PortalConsolidatedModal.tsx` diz que pagamentos seguem o "fluxo de estorno", e
a faixa de `BlDetalhe.tsx` diz "cancela ou estorna". O levantamento original está na
[revisão da exclusão de dados](../archive/audits/2026-09-24-revisao-exclusao-de-dados.md).

### Confirmação de ação

Toda ação que grava ou altera dado, envia algo a alguém (e-mail, Portal,
Comunicado) ou tira um registro de circulação abre um diálogo antes de executar
([ADR 0072](../adr/0072-toda-escrita-confirmada-com-consequencia.md)). Busca,
filtros, ordenação, abas e navegação não abrem; remover linha ainda não salva,
limpar filtro, desfazer seleção ou fechar uma edição sem salvar também não. O
diálogo diz:

- o que será feito e em quais registros, inclusive a cascata;
- a consequência visível: onde muda, se o Cliente ou o Portal vê, se
  recalcula, emite ou envia;
- se dá para desfazer e como;
- e pede **motivo obrigatório** em Excluir, Cancelar, Reativar, Reverter e
  Revogar, gravado junto com a ação.

Salvar uma edição mostra cada campo com o valor anterior e o novo. A prévia de
importação vale como o diálogo quando mostra o que entra, muda e sai
([Leitura de planilhas](#leitura-de-planilhas)). Ação em massa mostra os
totais, os bloqueados com o motivo e a lista sob demanda, com um motivo para o
lote. A prévia vem do banco que executa (`p_dry_run`), não de uma conta feita
no navegador. O botão que fecha o diálogo sem executar se chama **Voltar**, para
não confundir com a ação Cancelar.

**Código:** `src/components/ui/ConfirmDialog.tsx` (Voltar por padrão, campo
"Motivo (obrigatório)") e `useConfirmWithReason`. Implementação concluída em
2026-10-05 (nota de encerramento da ADR 0072), com as lacunas B13, B14 e B15
abaixo; fora delas, **Salvar** do Local e do serviço em
`/embarquevazios/depots` grava sem diálogo de antes e depois
(`src/pages/DepotCadastro.tsx`; B31, correção pendente no
[plano de correções](../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md)).

**Correção pendente (B13):** pela regra acima, Reativar tarifa (tabela e item
de Taxas Locais, Condição de Cliente, tarifa e acordo de Demurrage, tarifa de
Granito) e reativar usuário interno pedem motivo e dizem "Reativar"; hoje não
pedem motivo, e as telas de usuário e de acordo de Demurrage dizem "Ativar".
Correção pendente no [plano de correções](../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md)
([ADR 0083](../adr/0083-decisoes-da-revisao-geral-da-documentacao.md), item 26).

### Hard delete controlado

Excluir apaga o registro do banco; não há soft delete generalizado
([ADR 0009](../adr/0009-hard-delete-controlado-bloqueios-fiscais-auditoria.md),
que segue como origem — critério, papel e auditoria são os da
[ADR 0071](../adr/0071-ce-mercante-como-trava-de-exclusao.md)). A exclusão é do
Administrativo, com motivo, enquanto o registro não estiver travado
([Trava de exclusão](#trava-de-exclusão)), e passa sempre por uma RPC que
confere a trava no banco:

- **Viagem, B/L, container e Cliente:** `delete_records` (migration `087`,
  definição vigente na `088`). Cada item sai por inteiro, com os filhos, ou
  volta intacto com o motivo do bloqueio; a mesma RPC em modo prévia alimenta o
  diálogo. A viagem sai em cascata pela lista explícita do que é dela, e viagem
  cancelada fica retida ([Viagens § Catálogo de ações](../modules/viagens.md#catálogo-de-ações)).
  Cliente com CNPJ não se exclui ([Cadastro usado](#cadastro-usado)). O DELETE
  direto em `bls`, `bl_containers` e `vehicles` saiu da API na migration `088`,
  e o de `voyages`, na `109`.
- **Escala e atracação:** `delete_escala` (Administrativo, motivo e trava no
  porto) e a remoção de atracação, que também exige o Administrativo e respeita
  a trava (migration `088`; [Viagens § Catálogo de ações](../modules/viagens.md#catálogo-de-ações)).
- **Cadastros** (item de taxa, Condição de Cliente, tarifa de Granito, tarifa e
  acordo de Demurrage, Local, serviço do Local) e linha de serviço de vazios:
  `delete_catalog_row` (migration `096`), que exige o motivo e o grava na
  auditoria; o DELETE direto dessas tabelas saiu da API. Tarifa usada não se
  exclui ([Cadastro usado](#cadastro-usado)).
- **Exceções de autoria:** veículo avulso é excluído na página Veículos por
  qualquer Departamento ativo, com motivo, mesmo com CE no B/L, e as Taxas
  Locais do B/L são refeitas (`delete_vehicles_with_reason`, migration `184`;
  [ADR 0078](../adr/0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md),
  item 23); `delete_records` ainda remove veículos junto com o B/L ou o
  container. Unidade manual e linha de serviço do Embarque de Vazios: qualquer
  usuário ativo ([Trava de exclusão](#trava-de-exclusão)).
- **Nunca se exclui:** documento fiscal e baixa — `invoices`, `invoice_items`,
  `payments`, `bl_receivables` e `ledger_settlements` não têm DELETE pela API
  (migration `086`); fatura se cancela e baixa se cancela. O recebível sem
  fatura nem baixa sai junto com o B/L excluído, pelo próprio banco (ADR 0078,
  item 12). A auditoria (`audit_logs`) não se altera nem se apaga pela API; só
  a rotina de guarda a expurga ([Guarda e recuperação](#guarda-e-recuperação)).
  Usuário interno não se exclui.

Toda exclusão grava em `audit_logs`, na mesma transação, a linha excluída e o
motivo (`src/services/deleteRecords.ts`, `deleteDependencies.ts`). Exclusões de
uma linha só (`deleteOneById`, que chama `delete_catalog_row`) tratam 0 linhas
apagadas como erro ("Nada foi excluído"), em vez de anunciar sucesso.

### Trava de exclusão

O marco a partir do qual um dado de viagem deixa de ser excluível é o **CE
Mercante** do B/L, porque é ele que permite emitir a fatura e mostrar a fatura
e o B/L no Portal ([ADR 0071](../adr/0071-ce-mercante-como-trava-de-exclusao.md);
migrations `086` a `090`). O CE trava o B/L, a carga dele e tudo de que ele
depende — escala, atracação e viagem; B/Ls sem CE da mesma viagem continuam
excluíveis. Também travam o que referenciam (`bl_delete_lock_reasons` e
`delete_lock_reasons`, definição vigente na migration `191`):

- fatura de Taxas Locais do B/L, individual ou consolidada, em qualquer
  situação, e Invoice de Demurrage;
- recebível com baixa ou ligado a fatura viva. Recebível sem fatura viva nem
  baixa não é documento emitido e não trava: sai com o B/L excluído ou é
  anulado no cancelamento ([ADR 0078](../adr/0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md),
  item 12);
- na escala, na atracação e na viagem, o ADR de Saída fechado daquele porto e
  terminal;
- na viagem, também o Granito com CE ou faturado e o Comunicado ao Cliente
  ancorado na viagem.

Escala com B/L, com ou sem CE, também não se exclui: primeiro saem os B/Ls,
depois a escala ([ADR 0083](../adr/0083-decisoes-da-revisao-geral-da-documentacao.md), item 7, que supersede
parcialmente a ADR 0071 quanto à escala). A tela já recusa; o banco ainda
aceita: correção pendente no [plano de correções](../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md).

Antes da trava, excluir cabe ao Administrativo, com motivo
([Hard delete controlado](#hard-delete-controlado)); depois, o caminho é
corrigir, substituir, reemitir ou cancelar — B/L com CE se cancela
([Manifestos & EDI § B/L Cancelado e exclusão](../modules/manifesto-edi.md#bl-cancelado-e-exclusão)).
Corrigir o CE mantém a trava. **Remover CE Mercante**, na ficha do B/L, solta a
trava do CE: qualquer Departamento ativo, com motivo, e só sem fatura viva — com
fatura emitida, o Administrativo cancela a fatura antes
(`remove_bl_ce_mercante`, definição vigente na migration `209`; a ADR 0078
substituiu o item 5 da ADR 0071).

**Vazios**, que não têm CE, travam com o ADR de Saída fechado da escala e do
terminal, e reabrir o ADR solta a trava (ADR 0071, item 4); antes dela,
qualquer usuário ativo exclui unidade manual e linha de serviço de vazios.

**Correção pendente (B14):** o banco ainda não impõe a trava dos vazios —
unidade manual e linha de serviço do Embarque de Vazios são excluídas por
qualquer usuário ativo mesmo com o ADR de Saída fechado, e **Excluir unidade**
não pede motivo; só a exclusão de viagem, escala e atracação considera o ADR
fechado. Correção pendente no [plano de correções](../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md)
([ADR 0083](../adr/0083-decisoes-da-revisao-geral-da-documentacao.md), item 26).

### Cadastro usado

Um cadastro de referência — tarifa, Cliente, Local (terminal ou depot) e
serviço do Local — só pode ser excluído se nunca foi usado; depois de usado, só
se desativa, para que todo valor cobrado mantenha a origem
([ADR 0073](../adr/0073-cadastro-usado-so-se-desativa.md)). Excluir e desativar
são do Administrativo. Desativado, o cadastro sai das listas de escolha e
continua no histórico e nos documentos que o referenciam.

- **Tarifa** (tabela e item de Taxas Locais, Condição de Cliente, tarifa de
  Granito, tarifa e acordo de Demurrage): usada é a referenciada por cálculo,
  item de fatura, versão de regra de preço ou cobrança de Granito. O banco
  recusa excluí-la ("desative em vez de excluir"), e só o Administrativo muda o
  estado ativo (migration `091`). Desvio aceito: tarifa e acordo de Demurrage
  contam como usados quando já entraram em vigor, porque o cálculo não guarda o
  id da tarifa. Telas em [Taxas Locais](../modules/taxas-locais.md) e
  [Demurrage § Tarifa, free time, P1 e P2](../modules/demurrage.md#tarifa-free-time-p1-e-p2).
- **Cliente:** Cliente com CNPJ só se desativa (`delete_records` o recusa com
  "cliente com CNPJ: desative em vez de excluir"), e conta do Portal
  provisionada também conta como uso. Desativar e reativar pedem motivo, e não
  se desativa Cliente com fatura, recebível ou Invoice de Demurrage em aberto.
  Cliente desativado perde o acesso ao Portal, e B/L novo com o CNPJ dele vai
  para a Revisão em vez de se vincular (migration `092`;
  [Clientes § Desativação e exclusão](../modules/clientes.md#desativação-e-exclusão)).
- **Local e serviço do Local** (`/embarquevazios/depots`): Excluir é do
  Administrativo, com motivo (`delete_catalog_row`). Pela ADR 0073 (item 8),
  desativar e reativar também são do Administrativo, com diálogo.

Implementada em 2026-09-25 para tarifas e Clientes (migrations `087`, `088`,
`091` e `092`); o item 8, de Local e serviço, não está implementado:

**Correção pendente (B15):** desativar e reativar Local, terminal e serviço do
Local ainda é feito por qualquer usuário ativo, sem diálogo de confirmação nem
motivo, e o aviso diz "Serviço inativado.". Correção pendente no
[plano de correções](../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md) ([ADR 0083](../adr/0083-decisoes-da-revisao-geral-da-documentacao.md), item 26).

### Guarda e recuperação

Decidido na [ADR 0074](../adr/0074-usuarios-retencao-e-backup-diario.md),
implementada (migrations `093` e `094`; backup encerrado em 2026-10-05).

- **Usuário interno nunca é excluído, só desativado**, porque é o autor na
  auditoria. O papel `admin` foi retirado e os perfis passaram a Administrativo
  (migration `093`).
- **Auditoria** (`audit_logs`) é guardada por 5 anos. Ficam fora do expurgo as
  marcas de escala (`voyage_pod_schedule`, `voyage_pol_schedule`), que são dado
  operacional — a programação das viagens é reconstruída a partir delas — e o
  primeiro porto brasileiro indicado da viagem, que só existe na auditoria.
- **Eventos e tentativas do Portal** (provisionamento, eventos de e-mail,
  Inspeção do Portal, tentativas de login e de resolução de login) são
  guardados por 1 ano; o estado dos envios (`portal_email_attempts`) fica.
- O expurgo é a rotina diária `run_retention` (job `data-retention` do
  `pg_cron`, 06:30 UTC; migration `094`). Os documentos do Desbloqueio de CE têm
  guarda própria ([Desbloqueio de CE § Documentos, upload e expurgo](../modules/desbloqueio-ce.md#documentos-upload-e-expurgo)).
- **Dados pessoais não são anonimizados:** ficam enquanto o registro existir
  (decisão de 2026-09-25).
- **Recuperação:** não há PITR. A recuperação do banco é o backup lógico
  diário, cifrado, no Cloudflare R2 — restauração testada em 2026-10-05 e
  cópias diárias conferidas a partir de 2026-10-06
  ([Backup lógico em R2](backup-r2.md#estado-operacional-conferido-em-2026-10-05));
  a de uma exclusão pontual é a cópia do registro na auditoria.

**Perfil interno não se exclui, nem pela API** ([ADR 0083](../adr/0083-decisoes-da-revisao-geral-da-documentacao.md),
item 3): o banco revoga a exclusão de perfil interno, como a migration `086`
fez com documento fiscal. **Correção pendente:** hoje o banco ainda permite ao
Administrativo apagar um perfil interno por chamada direta à API (policy de
DELETE em `user_profiles`); a tela `/admin/usuarios` só desativa. Quando o
DELETE passa, o Log de Ações mostra o id em vez do nome do autor. Correção
pendente no [plano de correções](../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md).

Pela regra decidida, o banco recusa rebaixar ou desativar o último
Administrativo ativo; a regra e
a correção pendente estão em
[Operação e Suporte § Administrativo ativo mínimo](../modules/operacao-suporte.md#administrativo-ativo-mínimo)
([ADR 0083](../adr/0083-decisoes-da-revisao-geral-da-documentacao.md), item 2).

## Importações

### Leitura de planilhas

Toda importação de planilha passa pelo leitor comum `readSheet`
(`src/services/importCore.ts`;
[ADR 0078](../adr/0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md),
item 22): B/L, Manifesto BB, CE Mercante, Granito, Veículos, Vazios de
Importação, Embarque de Vazios, datas de container, Base de Clientes,
Programação, Chegadas e Saídas, KPIs de Demurrage e a conciliação do
Desbloqueio de CE; o extrato da Conciliação PIX usa os avisos do mesmo núcleo
(`readSpreadsheetNotices`). As aplicações próprias de cada importação ficam no
módulo, por exemplo em [Manifestos & EDI § Propósito e escopo](../modules/manifesto-edi.md#propósito-e-escopo).

- **Célula tipada.** Texto chega como texto (CSV é sempre texto: o SheetJS não
  converte `12,5` nem `05/03/2026`); número como número, exceto a máscara de
  zeros (CNPJ `00000000000000`, CEP `00000-000`, também com o literal escapado
  `00000\-000` ou entre aspas), que entrega o texto exibido; data do Excel como
  data civil `AAAA-MM-DD` (ou `AAAA-MM-DD HH:MM`), calculada do serial sem o fuso
  do navegador e no sistema de datas da pasta — pasta gravada no sistema 1904
  (Excel antigo de Mac) é lida com o dia certo. Célula só de hora (`hh:mm`)
  chega como o texto da hora, não como célula vazia, e a coluna de data a recusa
  com motivo.
- **Datas e números.** Toda data de importação passa pelo parser único
  `src/lib/importDate.ts` (`AAAA-MM-DD` ou `DD/MM/AAAA`, ano de quatro dígitos);
  números, por `parseImportNumber` (`src/lib/importNumber.ts`), com o formato
  decidido pela evidência do arquivo (célula numérica tipada não é evidência nem
  é ambígua). CE, CNPJ e CEP em célula numérica que perdeu dígitos voltam com a
  causa ("formate a coluna como texto").
- **Cabeçalho.** O mesmo cabeçalho duas vezes não bloqueia a leitura (a
  repetição ganha sufixo, `Unit_1`); duas colunas que casam o mesmo campo do
  importador bloqueiam ("A coluna … aparece duas vezes" ou "As colunas … são o
  mesmo campo"), e a coluna repetida que nenhum campo usa passa.
- **Linhas e abas ocultas** são ignoradas, e o seletor de arquivo mostra, por
  aba, "N linhas ocultas ignoradas" e as abas ocultas; linha oculta acima do
  cabeçalho (título, instruções) não conta como dado ignorado. Se o dado só
  existe em linha ou aba oculta, o erro diz isso em vez de "Planilha vazia.". A
  importação que substitui dados pede confirmação antes de gravar quando há
  linhas ou abas ocultas (ver o módulo de cada uma).
- **CSV** fora de UTF-8, em Windows-1252 (o "CSV" salvo pelo Excel), é aceito
  com aviso, salvo quando o importador o proíbe.
- Linhas realmente vazias são descartadas sem renumerar os dados, e cada linha
  leva o número físico da planilha (a partir de 1).

**Prévia e confirmação.** Os modais de importação seguem um percurso comum
(`src/components/shared/ImportParts.tsx`): destino (viagem, manifesto) →
arquivo → leitura → prévia → confirmação → resultado.

- A área de arquivo aceita clique ou arraste, informa os formatos e o limite de
  10 MB do `assertUploadSize` e fica desativada, com o motivo, enquanto faltar a
  viagem de destino; escolher de novo o mesmo arquivo relê o conteúdo.
- A leitura mostra fases, não porcentagem; com vários arquivos, a barra conta
  arquivos lidos. A leitura pode ser cancelada antes da gravação: o
  cancelamento descarta prévias parciais, e uma resposta tardia não publica
  prévia.
- A prévia resume o que entra, muda e fica de fora e vale como o diálogo de
  [Confirmação de ação](#confirmação-de-ação). Os erros de linha são
  normalizados em `ImportIssue`: o painel mostra a lista completa, distingue
  erro (impede ou exige aceite) de aviso e permite baixar um CSV sanitizado, sem
  o payload bruto. Erro de linha bloqueia a confirmação, salvo onde o
  importador permite decisão manual; erro documental ou de viagem bloqueia
  sempre.
- Falha de leitura ou de gravação aparece no próprio modal, sem perder a
  prévia, e o rodapé diz se algo já foi gravado. Resultado parcial fica na tela
  com **Concluir**, sem oferecer reenviar o mesmo lote.

### Rastro das importações

Toda importação deixa no Histórico, em cada registro que cria, altera ou
exclui, quem fez, a data e a hora, o valor anterior e o novo e o contexto da
importação ([ADR 0078](../adr/0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md),
item 9; migration `189`). O contexto é gravado como justificativa da linha que
não tem outra, no formato "Importação de <tipo> · Viagem <navio> <número> ·
Manifesto <Nº>" — por exemplo, "Importação de Vazios de Importação · Viagem
<navio> <número> · Manifesto <Nº>"; o motivo de uma exclusão, quando há,
prevalece. Não se guarda lote, arquivo nem linha da planilha.

- **Importações com rastro:** B/L, Manifesto BB, CE Mercante, Baplie (e a
  aplicação das marcas do Baplie), Veículos, Granito, Vazios de Importação,
  Vazios pelo Baplie, Embarque de Vazios, Base de Clientes, datas de container
  e Programação. Cada RPC pública define o contexto e chama a função original,
  que ficou como `<nome>_legacy_189`, sem mudança de comportamento nem de
  privilégios.
- **O primeiro contexto vale até o fim:** quando uma importação chama outra na
  mesma transação, fica o contexto da primeira (migration `190`).
- **CE Mercante:** a planilha de CE completa o contexto com a rota (POL → POD)
  e, na troca de CE, com o motivo informado na prévia (migrations `195` e
  `212`).
- **Origem não é motivo.** No Histórico do B/L, esse contexto aparece como
  **Origem**, e a linha não conta como Auditoria; a exceção é a linha que traz o
  motivo informado pela pessoa (troca de CE pela planilha), que é alteração
  deliberada e aparece como **Motivo**
  (`src/components/bl/blTimelinePresentation.ts`).

## Conciliação Baplie ↔ B/L

- Match key: `container_number` + `voyage_id`. `bl_ref` do Baplie é sinal secundário, não critério de bloqueio.
- **Gate de cobertura por rota:** uma rota (POL→POD) de containers cheios prevista pelo Baplie só entra na conciliação quando tem pelo menos um B/L **com containers** naquela rota — B/L sem container não cobre rota. O gate é por rota: uma rota ainda sem B/L fica fora da conciliação, sem silenciar as demais rotas da viagem. Em D-7 do primeiro ETA brasileiro todas as rotas são conciliadas, inclusive as sem B/L.
- Códigos de porto são normalizados antes da comparação (`public.normalize_port_code` no banco, `src/services/portCode.ts` no app). Zhoushan (`CNZOS`/`ZOS`) e Ningbo (`CNNGB`) são o mesmo complexo portuário: o Baplie costuma codificar `CNZOS` onde o B/L declara Ningbo. Variações como `QINDGAO` e `TSINGTAO` resolvem canonicamente para Qingdao (`CNTAO`).
- Divergências — de existência (container cheio no Baplie e em nenhum B/L, ou no B/L e ausente do Baplie), SOC/COC e perfil IMO/OOG corrigido à mão — são avisos, sem bloqueio. Os tipos, a única resolução (**Vale o B/L**, com motivo) e a aplicação das marcas físicas do Baplie estão em [Manifestos & EDI § Baplie: marcas, SOC/COC e divergências](../modules/manifesto-edi.md#baplie-marcas-soccoc-e-divergências). Dados documentais e financeiros vêm do B/L e permanecem protegidos.

Definições em [CONTEXT.md](../../CONTEXT.md).

## Conciliação PIX

- Invoices locais são conciliadas por TXID via `reconcile_invoice_payment_by_txid`, que registra ledger/payment/settlement e marca a invoice com `pix_txid` e `conciliated_by_extract`.
- Demurrage é baixado por `register_demurrage_payment`, chamado por `confirm_demurrage_pix_matches`, na persistência própria (`demurrage_invoices`); o navegador não grava a baixa diretamente ([Demurrage § Baixa, cancelamento da baixa e restituição](../modules/demurrage.md#baixa-cancelamento-da-baixa-e-restituição)).
- **Casos ambíguos** (TXID repetido, valor divergente, múltiplos candidatos) **não** são confirmados automaticamente — ficam para revisão humana. Ver [Conciliação PIX](../modules/reconciliacao-pix.md).

## Gate de CE Mercante no Portal

O Portal do Cliente só expõe dados de B/Ls que tenham `ce_mercante` preenchido (`bl_has_portal_release`, definição vigente na migration `002`; a origem é a migration arquivada `123`). Evita mostrar carga ainda não declarada no Mercante. O gate vale para a visibilidade e as ações self-service no Portal; não define elegibilidade de cálculo nem de emissão no sistema interno. Ver [Portal do Cliente § Login e escopo da sessão](../modules/portal-cliente.md#login-e-escopo-da-sessão).

## Chave de envio e supressão de e-mail

A chave global de envio (`app_settings.communications_enabled`, desligada por padrão e ligada só pelo Administrativo) silencia, além dos Comunicados, a Régua de Cobrança de Demurrage, o aviso de bounce em cascata e o aviso do Desbloqueio de CE; os demais e-mails transacionais do Portal, como convite e recuperação de senha, não dependem dela. O bounce permanente suprime o endereço nos dois canais; a reclamação, só no canal em que aconteceu. Regra completa em [Clientes § Chave de envio de Comunicados](../modules/clientes.md#chave-de-envio-de-comunicados) e [Clientes § Comunicados ao Cliente](../modules/clientes.md#comunicados-ao-cliente).

## Permissões internas

A leitura interna é global e a escrita operacional é liberada a todo Departamento ativo, com rastro; as exceções por Departamento são aplicadas pelo banco e estão em [Segurança § Roles internas](seguranca.md#roles-internas). Rota e botão escondido são navegação, não autorização.

## Escritas best-effort

Algumas escritas (alertas, eventos operacionais, payload PIX) **logam e seguem** em vez de falhar a operação principal. É proposital para não travar o fluxo financeiro, mas pode mascarar falhas — monitorar via [Sentry](seguranca.md).

## Referências de verificação dos contratos

Fontes executáveis para conferir as distinções mais sujeitas a regressão. Não substituem a leitura da última definição na cadeia ativa de migrations.

| Contrato | Fonte executável |
|---|---|
| Peso e cubagem de B/L misto | [cargoMode.ts](../../src/lib/cargoMode.ts) |
| Motivos exibidos na Validação, incluindo Granito | [validacaoPipeline.ts](../../src/components/billing/validacaoPipeline.ts) |
| CE obrigatório e fronteiras de emissão | [migration 047](../../supabase/migrations/047_bl_documental_gates.sql) |
| Gate do Portal na emissão automática e Liberação de faturamento sem Portal | [migration 083](../../supabase/migrations/083_portal_trava_universal_liberacao_faturamento.sql); gate vigente em [084](../../supabase/migrations/084_liberacao_portal_email_e_teto.sql) (`customer_billing_access_ready`) e concessão em [085](../../supabase/migrations/085_email_fora_do_faturamento_taxas_do_ce.sql) |
| Conceder ou revogar a Liberação reavalia a Revisão dos B/Ls do Cliente | [migration 167](../../supabase/migrations/167_liberacao_reavalia_revisao.sql) |
| Liberação vencida devolve os B/Ls do Cliente à Revisão (job diário) | [migration 168](../../supabase/migrations/168_liberacao_vencida_reavalia_revisao.sql) |
| B/L cancelado fora dos Alertas de revisão do Cliente | [migration 169](../../supabase/migrations/169_alerta_revisao_ignora_bl_cancelado.sql) |
| Reavaliação da Revisão em lote reconcilia o Alerta do Cliente uma vez | [migration 170](../../supabase/migrations/170_revisao_em_lote_reconcilia_alerta_no_fim.sql) |
| Permissões por Departamento | Autoridade: `is_admin()`, `is_financeiro_user()`, `is_active_read_user()` e `is_active_user()` na [base consolidada](../../supabase/migrations/002_business_logic_and_security.sql) e as guardas de cada RPC, com a matriz em [Segurança § Roles internas](seguranca.md#roles-internas); navegação: [useAuth.tsx](../../src/hooks/useAuth.tsx) e [rotas internas](../../src/AppInterno.tsx) |
| Edição interna dos contatos e caixas | [migration 008](../../supabase/migrations/008_portal_contact_boxes.sql) |
| Calendário do prazo do ADR | [agencyReportDeadline.ts](../../src/services/agencyReportDeadline.ts) |
| ATD do terminal e prontidão do Portal | Funções `reconcile_agency_report_alerts` e `customer_portal_access_ready` na [base consolidada](../../supabase/migrations/002_business_logic_and_security.sql) |
| Ajuste de COD | Função `apply_cod_financial_effect`, definição vigente na [migration 130](../../supabase/migrations/130_correcao_faturamento_pix_e_cod.sql) |
| Trava de exclusão | `bl_delete_lock_reasons` e `delete_lock_reasons` na [migration 191](../../supabase/migrations/191_demurrage_grupo_e_container_compartilhado_correcoes.sql); `delete_records` na [migration 088](../../supabase/migrations/088_trava_exclusao_ce_mercante.sql) |
| Rastro das importações | [migration 189](../../supabase/migrations/189_rastro_das_importacoes.sql) e [migration 190](../../supabase/migrations/190_revisao_importacoes_seguranca_fila_e_viagem_cancelada.sql) |
| Inbox e resposta a webhook duplicado | [portal-email-webhook](../../supabase/functions/portal-email-webhook/index.ts) |
