# Plano — Correção de B/L depois da fatura de Taxas Locais

Data: 2026-10-01. Estado: implementação local concluída e arquivada em 2026-10-01. Fases 1 e 3 já estavam na branch; demais fases concluídas nesta execução. Publicação e observação em Preview não realizadas.

## Resultado pretendido

Uma fatura emitida não muda mais de valor. A emissão é o momento em que ela
aparece no Portal; daí em diante, qualquer diferença de valor vira outro
documento:

| Situação da fatura de Taxas Locais | Correção do B/L com impacto no valor | Cobrança de serviço (Correction Letter, B/L Reissuing, Late Correction Request, Booking Cancelation Fee ou outra) |
| --- | --- | --- |
| Emitida, sem pagamento (individual ou consolidada) | **Cancelar e reemitir**, sempre | Dois caminhos: cancelar e reemitir com o item junto das Taxas Locais, **ou** fatura avulsa vinculada ao B/L |
| Paga ou parcialmente paga | Valor aumenta: fatura avulsa. Valor diminui: **restituição registrada** no sistema | Só fatura avulsa |

O que a pessoa verá:

- No detalhe de uma fatura emitida, a seção “Outras cobranças (manuais)” deixa
  de existir; a fatura passa a oferecer **Cancelar e reemitir** quando não tem
  pagamento.
- Em **Nova fatura avulsa**, o campo **Tipo de cobrança** lista os itens
  manuais da tabela vigente do B/L (hoje Correction Letter, B/L Reissuing, Late
  Correction Request e Booking Cancelation Fee) e **Outra**. Item da tabela
  exige B/L e traz o valor da tabela, com a condição do Cliente quando houver;
  **Outra** mantém nome, descrição e valor digitados, com B/L opcional.
- A cobrança de serviço nem sempre é feita: nada é lançado automaticamente;
  o operador decide emitir.
- Correção com impacto em B/L já faturado (reimportação com override, flags do
  Baplie) gera o Alerta **Fatura desatualizada**, com o caminho a seguir.
- Fatura paga cuja correção reduz o valor ganha **Registrar restituição por
  correção**; a restituição segue o fluxo de liquidação que já existe.

Fora de escopo: vencimento (fatura de Taxas Locais não tem), nota de crédito
fiscal, Demurrage, Granito, e a ativação real da API Itaú (PR #827).

## Decisões confirmadas (2026-10-01)

1. A cobrança de serviço nem sempre é cobrada; é decisão do operador.
2. Em fatura não paga, correção com impacto sempre cancela e reemite.
3. Fatura de Taxas Locais não tem vencimento; a reemissão não herda prazo.
4. A fatura é considerada disponibilizada na emissão (quando aparece no Portal).
5. Parcialmente paga segue a regra da paga: só fatura avulsa.
6. Correção que reduz o valor de fatura paga gera registro de restituição.
7. Item já cadastrado traz o valor da tabela; item customizado é digitado.
8. B/L é obrigatório para os quatro itens da tabela.
9. B/L em fatura consolidada: cancela a consolidada e reemite com a correção.

## Escolhas de execução (rotineiras; podem ser revistas)

- O Tipo de cobrança lista os itens `manual_only` da tabela resolvida para o
  B/L, sem fixar os quatro nomes no código. Um item novo na tabela aparece
  sozinho.
- Valor de item da tabela não é editável na avulsa; quem precisa de outro
  valor usa **Outra** ou ajusta a condição do Cliente.
- Item em USD (Booking Cancelation Fee, por TEU) converte para BRL na emissão
  com a mesma regra das Taxas Locais (ADR 0038, decisão 6), registrando USD e
  ROE no item.
- Com a cobrança Itaú ativa, a reemissão aguarda a confirmação do cancelamento
  da COB anterior, para evitar dois Pix pagáveis para a mesma cobrança. Com o
  Pix estático atual, a reemissão é imediata.

## Estado atual (inspeção estática da `main` em 2026-10-01)

- `add_manual_invoice_charge`/`delete_manual_invoice_charge`
  (`supabase/migrations/002_business_logic_and_security.sql`,
  `086_exclusao_protecoes_fiscais_e_auditoria.sql`) alteram total e saldo de
  invoice individual `draft`/`issued`/`overdue` sem pagamento, apagam
  `pix_payload` e não tocam `bl_receivables`. UI:
  `src/components/billing/InvoiceDetailModal.tsx` (`canEditCharges`).
- `calculate_bl_local_charges` e `add_manual_bl_charge` recusam B/L com
  `financial_status` faturado/pago (`091`, `106`).
- Reimportação: mudanças com impacto exigem override
  (`src/services/blFreightImport.ts`, `computeBillingImpact`); o recálculo
  pula B/L faturado (`072`, `118`). Nenhum aviso de fatura desatualizada.
- `cancel_invoice` (`052_financial_battery_guards.sql`) recusa fatura com
  pagamento e devolve o B/L a `pending` (ou `invoiced`/`paid` se houver outra
  fatura viva).
- Fatura avulsa: `create_manual_invoice` (`097`, ADR 0075), B/L opcional, sem
  recebível. UI: `src/components/billing/ManualInvoiceModal.tsx`.
- `invoice_refunds` aceita só origem `payment_id` ou `cod_adjustment_id`
  (`invoice_refunds_origin_check`); a criação hoje vem do excedente de
  pagamento.
- PR #827 (aberta): trigger `track_pix_invoice_change` revisa a COB no mesmo
  TXID quando o saldo muda e marca `cancel_pending` no cancelamento.

## Fases

### Fase 0 — Registro das decisões

- ADR nova (próximo número livre) “Fatura emitida não muda de valor”, citando
  ADR 0038 e 0075; nota editorial na 0075 sobre B/L obrigatório para itens da
  tabela.
- `CONTEXT.md`: Cancelar e reemitir, Fatura desatualizada, Restituição por
  correção.

### Fase 1 — Fatura emitida não muda de valor

- Migration: `add_manual_invoice_charge` e `delete_manual_invoice_charge`
  aceitam somente `draft`. Antes, confirmar se algum fluxo ainda cria `draft`;
  se nenhum criar, revogar o `EXECUTE` das duas e remover o serviço/hook.
- `InvoiceDetailModal`: retirar a seção “Outras cobranças (manuais)” e o botão
  Remover de faturas não rascunho.
- Aceite: fatura emitida sem pagamento não oferece inclusão de item; chamada
  direta à RPC é recusada no banco.
- Check: teste de contrato SQL + teste de comportamento do modal.

### Fase 2 — Tipo de cobrança na fatura avulsa

- `create_manual_invoice` recebe `p_charge_item_id` opcional. Com item:
  exige B/L do Cliente; resolve tabela, condição do Cliente e quantidade
  (base `bl` = 1; `teu` = TEUs do B/L) pelo mesmo resolvedor de
  `add_manual_bl_charge` (`resolve_bl_local_charge_table_ids`); ignora valor
  vindo do navegador; grava `charge_item_id`, tabela, override e, em USD, ROE
  no `snapshot_payload` do item. Sem item: comportamento atual.
- Leitura dos itens elegíveis por B/L: reutilizar
  `queryKeys.bls.manualChargeItems(blId)` e o serviço que alimenta a aba
  Cobranças.
- `ManualInvoiceModal`: campo Tipo de cobrança; B/L obrigatório e valor somente
  leitura quando há item; **Outra** mantém o formulário atual.
- Aceite: Correction Letter para um B/L traz 600,00 (ou o valor da condição do
  Cliente) e a fatura aparece no Portal do Cliente do B/L; sem B/L o botão de
  emitir fica bloqueado com a mensagem do campo.
- Check: teste de banco local (`*.local-pg.test.ts`) do valor resolvido e da
  recusa sem B/L; teste do modal.

### Fase 3 — Cancelar e reemitir

- No detalhe de fatura de Taxas Locais (individual ou consolidada) sem
  pagamento: ação **Cancelar e reemitir**, com motivo obrigatório e a lista de
  B/Ls afetados no diálogo de confirmação.
- O cancelamento usa `cancel_invoice`. A fatura nova guarda a referência à
  anterior (`invoices.replaces_invoice_id`, nova coluna) e o detalhe das duas
  mostra o vínculo (“Substitui …” / “Substituída por …”).
- Entre cancelar e reemitir, o operador corrige o B/L, reimporta ou lança a
  cobrança manual na aba Cobranças (o B/L volta a aceitar recálculo). A
  pendência “Reemissão pendente” fica nos B/Ls até a nova emissão; consolidada
  reemite pela emissão consolidada com os mesmos B/Ls pré-selecionados.
- Verificar antes de implementar: o que `cancel_invoice` faz com
  `invoice_receivable_links` e com faturas individuais `covered` pela
  consolidada cancelada.
- Aceite: B/L em consolidada corrigido → consolidada cancelada, nova
  consolidada com o valor atualizado, Portal mostra só a vigente e o histórico
  de ambas.
- Check: teste de banco local cobrindo individual e consolidada.

### Fase 4 — Alerta Fatura desatualizada

- Ao gravar, com override, mudança com impacto em B/L com fatura viva
  (`import_bl_freight_*`) e ao aplicar flags do Baplie em B/L faturado
  (`apply_baplie_physical_flags_atomic`), registrar Alerta
  `fatura_desatualizada` via `upsert_alert_item`, apontando para a fatura e
  indicando o caminho (cancelar e reemitir, avulsa ou restituição).
- Preview da reimportação: a linha de impacto passa a dizer qual fatura ficará
  desatualizada.
- O Alerta resolve com a reemissão, ou manualmente com justificativa (avulsa
  emitida ou restituição registrada).
- Check: catálogo de Alertas (`alertRulesCatalog.ts` e testes de catálogo) e
  teste de banco local da criação.

### Fase 5 — Restituição por correção

- Migration: nova origem em `invoice_refunds` (`origin = 'correction'`, com
  motivo), ajustando `invoice_refunds_origin_check`; valor limitado ao total
  pago menos restituições não canceladas.
- Detalhe de fatura paga: **Registrar restituição por correção** (valor e
  motivo); liquidação segue `settle_invoice_refund`. Fatura e itens não mudam.
- Check: teste de banco local do limite e da liquidação.

### Fase 6 — Documentação viva

`docs/modules/faturamento.md`, `taxas-locais.md`, `manifesto-edi.md`,
`portal-cliente.md`, `docs/RASTREABILIDADE.md`, `docs/CHANGELOG.md`.

## Ordem e dependências

0 → 3 e 1 na mesma janela de deploy (a edição só sai quando o cancelamento
guiado existir) → 2 e 5 independentes → 4 (aponta para os caminhos da 3 e da
5) → 6 junto de cada fase. Uma PR por fase. Com a Fase 1, deixa de existir mudança de
valor de fatura emitida; a PR #827 continua revisando a COB apenas para PTAX e
baixa parcial. Quem entrar por último entre esta Fase 3 e a #827 confere o
cancelamento pendente da COB antes de liberar a reemissão.

Migrations não reescrevem linhas existentes; não dependem da declaração de
dados descartáveis do `AGENTS.md`.

## Checks por PR

`npm run docs:check`, `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`, `npm run migrations:check`, `npm run rpc:check`, e a suíte
local-pg das fases com migration. Teste SQL de texto comprova contrato, não
execução nem RLS; registrar o que foi observado em Preview.

## Riscos e rollback

- Fatura emitida hoje com item manual: continua como está (não há reescrita).
- Operador sem caminho durante a transição: evitado pela ordem acima.
- Rollback de cada fase: migration reversa restaurando as definições
  anteriores das RPCs; colunas novas são nullable e podem ficar.

## Decisão complementar confirmada nesta execução

Redução após pagamento parcial abate primeiro o saldo aberto e restitui somente
o excedente já recebido. Total/itens originais permanecem intactos. Operador
informa total correto por B/L e motivo; o sistema mostra abatimento, restituição
e saldo antes da confirmação. Registrar pagamento explica o impedimento de
cancelar/reemitir e confirma valor recebido/saldo. Esta decisão substitui a
pendência original e complementa a Fase 5 com `invoice_corrections` e saldo do
recebível, inclusive em consolidada.

Adaptação mecânica: execução em patch local na branch existente; nenhuma PR ou
publicação solicitada. Nova cadeia `122`/`123`, respeitando os prefixos numéricos
do WORKFLOW. Fases 1/3 não foram reimplementadas. O alerta do import compara
snapshots reais antes/depois, para não alertar em reimportação idêntica.

## Evidência de encerramento local

Typecheck, lint, build, docs:check, migrations:check, rpc:check e diff sem
erros. Suíte geral: 3.792 testes passaram (245 testes dependentes de ambiente
foram ignorados), incluindo a confirmação de baixa parcial.
Replay completo das migrations em Postgres local descartável e seis suítes
financeiras/importação/Portal: 30 testes passaram. Cenários incluem abatimento
antes da restituição, pagamento subsequente, estorno bloqueado quando compromete
a restituição, consolidada, preço/ROE da avulsa e alerta apenas em alteração real.
Mocks de componentes verificam a orientação e confirmação ao operador.
Não houve observação de navegador, publicação das migrations, mutação de
produção, integração real Itaú ou prova de runtime em Preview.
