# Correção das importações e do CE Mercante — plano de implementação

> **Para execução por agentes:** usar `executing-plans`. Cada etapa é uma
> mudança própria (uma PR), executável sozinha na ordem da tabela de
> dependências. Este plano não autoriza mudança em produção, publicação nem
> ativação do `import-effects-runner`.

**Origem:** [revisão das importações e do CE Mercante de 2026-10-09](../archive/audits/2026-10-09-revisao-importacoes-ce-mercante.md).
Os ids `M01`–`M25` são os problemas-raiz da seção 5 do relatório; `D-01`–`D-22`
são as decisões de negócio da seção 6.

**Objetivo:** fazer as importações deixarem de apagar dado válido, de cobrar
errado e de esconder o que gravaram, começando pelos defeitos com regra já
decidida, e preparar as mudanças que dependem de decisão.

**Estado em 2026-10-09:** nenhuma etapa iniciada. As checagens de aceitação
das Etapas 1 a 7 já estão no repositório como `it.fails` e rodam no CI.

## Regras comuns a todas as etapas

- **Critério de aceitação executável.** A etapa só termina quando os
  `it.fails` nomeados viram `it` e passam, e as suítes vizinhas continuam
  verdes. Não apagar nem afrouxar um caso para fazê-lo passar: se a decisão de
  negócio mudar o comportamento esperado, ajustar o caso e registrar a decisão.
- **Gates locais:** `npm run docs:check`, `npm run typecheck`,
  `npm run lint`, `npm test`, `npm run build`; com migration, também
  `npm run migrations:check`, `npm run rpc:check` e o replay local
  (`sudo scripts/setup-local-pg.sh --reset` e as suítes `local-pg` do CI com
  `--no-file-parallelism`, duas vezes seguidas, sem resíduo de namespace).
- **Migrations:** sempre arquivo novo, no próximo número livre (hoje `171`);
  nunca editar migration existente (protegida por
  `.claude/hooks/protect-files.sh`). Redefinir a função a partir da definição
  **efetiva** no banco replicado, não da primeira migration que a criou. Se a
  migration reescrever ou apagar linhas, declarar no cabeçalho que depende da
  linha "Data status" do `AGENTS.md`.
- **Documentação viva no mesmo change:** os trechos listados na seção 8 do
  relatório para a etapa, mais `RASTREABILIDADE.md` e o módulo afetado.
- **Um dono por correção:** corrigir na RPC ou no gatilho que é dono do
  contrato, não com guarda por tela.
- Marcar simplificações com `ponytail:` e o teto conhecido.

## Ordem e dependências

| Etapa | Problemas | Depende de | Decisões |
|---|---|---|---|
| 0 — Salvaguardas | M04 | — | — |
| 1 — Carga solta | M01 | — | D-03, D-10 (só os passos 5 e 6) |
| 2 — B/L de container | M02, M14 | — | D-11 (passos 5 e 6) |
| 3 — Leitura de planilhas | M05 | — | D-16 (passo 6) |
| 4 — Fila de efeitos | M04 | — | D-12 |
| 5 — Container compartilhado | M03, M24 | — | D-09 (passo 4) |
| 6 — Unicidade e portas do CE | M06, M08 | — | D-02, D-03, D-04 |
| 7 — Faturas, Demurrage e Comunicado | M18, M19, M10, M21 | — | D-13, D-14 |
| 8 — Contrato da importação de CE | M07, M09, M12, M13 | 6 | D-01, D-05, D-06, D-07, D-08 |
| 9 — Baplie | M11 | 2 | D-15 |
| 10 — Viagem Cancelada, COD, documento, papéis | M20, M22, M23, M25 | 2 | D-20, D-21, D-22 |
| 11 — Veículos, Base de Clientes, Granito, vazios | M15, M16, M17 | 3, 4 | D-17, D-18, D-19 |
| 12 — Testes e CI | testes da seção 7 | — | — |
| 13 — Encerramento | — | todas | — |

As Etapas 1, 2, 3, 5 e 6 são independentes e podem correr em paralelo, cada
uma com seu número de migration. Prioridade sugerida: 1, 2, 3 e 5 (dano ativo
hoje), depois 6 e 4, depois as demais.

## Etapa 0 — Salvaguardas (sem código)

- [ ] Manter `IMPORT_EFFECTS_RUNNER_ENABLED` desligado até a Etapa 4 estar em
  produção. Registrar a condição na seção do runner em
  [`servicos-externos.md`](../operations/servicos-externos.md).
- [ ] O dono do projeto roda, **em leitura**, no banco de produção:
  efeitos pendentes por `effect_kind` e idade em `import_pending_effects`;
  B/Ls não cancelados com o mesmo CE; CEs fora de `^[0-9]{15}$`; containers
  com `demurrage_status = 'returned'` e `return_date` nula; containers
  compartilhados com só um B/L faturado. O resultado orienta as Etapas 4, 5 e
  6 (com dados de teste, hoje, o resultado só confirma a dimensão).
- [ ] Orientar a operação até as correções: não reimportar Manifesto BB, B/L
  avulso nem B/L de container de B/L já com CE; em XLSX, digitar datas como
  texto `DD/MM/AAAA`; conferir na prévia de datas o dia e o mês.

**Aceitação:** condição de ativação registrada no manual; consultas
executadas e anexadas à PR da Etapa 4.

## Etapa 1 — Reimportação de carga solta (M01)

**Dono:** `import_breakbulk_manifest_transactional` (definição efetiva das
migrations `060`/`064`), `src/services/breakbulkImport.ts`,
`src/services/blDocumentImport.ts`.

- [ ] Migration nova redefinindo a RPC: B/L existente só atualiza os campos
  que o arquivo traz; a chave de CE ausente não toca `ce_mercante`; Cliente
  vinculado (Revisão ou documento), `review_status`, reconciliação e nota
  humana preservados, com a divergência devolvida em
  `customer_changes_ignored`; B/L existente em outra Viagem recusa o lote com
  mensagem que nomeia o B/L e as duas Viagens; sugestão por nome grava
  `suggested_customer_id`.
- [ ] Serviço e modais (`BlBreakbulkManifestModal.tsx`,
  `BlDocumentImportModal.tsx`, `VoyageImportActions.tsx`): prévia do que
  fica e do que muda; recusa de outra Viagem já na prévia; remover a promessa
  de `invalidBls` ou implementá-la.
- [ ] Trocar os 6 `it.fails` de `auditoriaImportacaoCargaSolta` por `it`;
  remover `src/services/__tests__/breakbulkImportCeMigration.test.ts` (lê a
  `304` arquivada e mascara a regressão).
- [ ] Depois de D-10: troca de Cliente com aceite (mesmo contrato de
  `relink_bl_customer`) e atualização de rota e partes.
- [ ] Depois de D-03: tirar o CE do BB ou aplicar as regras da planilha.
- [ ] Docs: `manifesto-edi.md` (B/L avulso, BB e item 11), retirando o
  "defeito conhecido" desta revisão.

**Aceitação:** os 6 casos passam como `it`; o caso-guarda (reimportar com
CNPJ tira a pendência de Cliente) continua verde; reimportar BB sem CE não
grava linha de `audit_logs` para `ce_mercante`; um lote com B/L faturado e
B/L novo é aceito sem cancelar nem reemitir a fatura; `pr698ClaudeReview`,
`importEffects` e `auditoriaRun2` verdes.

## Etapa 2 — Reimportação de B/L de container (M02, M14)

**Dono:** `import_bl_freight_transactional_legacy_205` (núcleo efetivo),
`_import_bl_freight_before_invoice_alert_123`, `guard_shared_container_mutation`,
`import_bl_freight_with_metadata`, `apply_bl_review_gate_after_import`,
`src/services/blFreightImport.ts`, `src/components/shared/BlImportModal.tsx`.

- [ ] Migration nova: reconciliar containers e veículos por número em vez de
  `DELETE` + `INSERT`; atualizar só as colunas do documento e só quando mudam;
  preservar `id`, `created_at`, descarga, devolução, `demurrage_status`, local
  de desova e SOC/COC manual; container ausente do arquivo sai só quando a
  prévia mostra a remoção (ADR 0071 item 10), com mensagem de negócio se
  houver Invoice de Demurrage.
- [ ] A guarda de container compartilhado olha só mudança de participação.
- [ ] Import idêntico de B/L faturado não recalcula, não enfileira
  `provisional_charges` e não acende "Carga alterada após faturamento".
- [ ] M14: o e-mail do arquivo vira contato só do Cliente final e só quando o
  CNPJ do arquivo é o dele.
- [ ] Retorno e modal informam, por B/L, containers inseridos, atualizados e
  removidos e VINs descartados.
- [ ] Depois de D-11: aba VIN ausente, Laden on Board ilegível, POD fora do
  catálogo, override por linha, NCM manual.
- [ ] Trocar os 6 `it.fails` de `auditoriaImportacaoBlContainer` por `it`.

**Aceitação:** os 6 casos passam; reimportação "Sem mudança" não gera
`audit_logs` de exclusão ou criação em `bl_containers` nem em `vehicles`;
`containerOwnership`, `invoiceAutoReissue`, `invoiceBasisCorrection`,
`baplieFlagsOnBlImport`, `blCbmSemantics`, `thdImoOog`, `importAtomicity`,
`blFreightImport.test.ts` e `BlImportModal.test.tsx` verdes.

## Etapa 3 — Leitura de planilhas (M05)

**Dono:** `readSheet` em `src/services/importCore.ts`; parser de data único
novo em `src/lib/importDate.ts` (análogo a `src/lib/importNumber.ts`).

- [ ] `readSheet` entrega a célula tipada (número, data serial, texto) e não
  deixa o SheetJS converter CSV.
- [ ] Parser de data único com data civil, sem fuso, e recusa de ano fora de
  quatro dígitos; migrar datas, Embarque de Vazios, programação, Granito,
  PIX, ZPT.
- [ ] Números sempre por `parseImportNumber`, com o formato decidido pela
  evidência do arquivo; identificadores numéricos (CE, CNPJ, CEP) com causa
  explícita quando a célula é número.
- [ ] Revisar os modelos em `public/templates/` (coluna CE como texto).
- [ ] Trocar os 9 `it.fails` de `auditoriaLeituraPlanilhas` por `it`.
- [ ] Depois de D-16: colunas duplicadas, linhas e abas ocultas,
  Windows-1252.

**Aceitação:** os 9 casos passam; nenhum parser de importação usa
`toISOString`, `getUTC*` ou `cellDates` para converter célula (busca
estática); o modelo `veiculos-modelo.csv` continua aceito.

## Etapa 4 — Fila de efeitos (M04)

**Dono:** `_run_import_effect_vehicle_followup`,
`_run_import_effect_local_charges`, `claim_import_effects`,
`process_import_effect`, produtores em `import_bl_freight_with_metadata`;
`src/services/alertRulesCatalog.ts`.

- [ ] Consumidor de veículos revalida e só recalcula B/L sem fatura viva; a
  fatura de B/L com fatura viva é tratada no COMMIT da importação (ADR 0077).
- [ ] `local_billing` reaproveita o cálculo do dia do CE e não toca outros
  B/Ls da Viagem.
- [ ] Erros 40001/40P01/55P03 viram `retry_wait`; lease esgotado e
  dependência bloqueada abrem o Alerta `import_effect_blocked`; P0001 de
  domínio deixa de ser `invalid_effect_payload`.
- [ ] Produtores param de enfileirar `physical_flags` redundante; efeito novo
  da mesma entidade e tipo substitui o pendente.
- [ ] Métrica e Alerta de fila parada; procedimento de ativação do runner
  (inventário, triagem em dry-run, ativação em Preview, rollback) em
  `servicos-externos.md`.
- [ ] Depois de D-12: tratamento dos efeitos acumulados antes da ativação.
- [ ] Trocar os 5 `it.fails` de `auditoriaEfeitosImportacao` por `it`.

**Aceitação:** os 5 casos passam; `invoiceBasisCorrection`, `importEffects`,
`portalBillingRelease`, `ceMercanteAutoBilling`, `localBillingIntegrity`,
`invoiceAutoReissue` e `demurrageAuthority` verdes; runbook executado em
Preview com rollback testado. A ativação em produção é decisão separada do
dono.

## Etapa 5 — Container compartilhado (M03, M24)

**Dono:** `guard_shared_container_invoice` e `guard_shared_container_mutation`
(migration `066`); vínculo em `invoice_receivable_links`.

- [ ] Função única que diz se o rateio cobrado de um B/L ainda é o atual; a
  guarda de emissão só recusa rateio desatualizado (a proteção contra cobrar
  150% fica), com SQLSTATE próprio e mensagem que nomeia o B/L irmão.
- [ ] A guarda de mutação olha só participação no container; datas e desova
  do irmão passam.
- [ ] Mesma checagem na consolidada.
- [ ] Depois de D-09: B/L irmão que chega depois do faturado e exclusão do
  irmão (M24).
- [ ] Trocar os 4 `it.fails` de `auditoriaCeContainerCompartilhado` por `it`.

**Aceitação:** os 4 casos passam em qualquer ordem de linhas; o caso de
fração diferente (150%) continua recusado; `maritimeAuditRemediationMigration`
verde.

## Etapa 6 — Unicidade e portas do CE (M06, M08)

**Dono:** banco (`bls`, `granite_bls`), `ce_unlock_reconcile`,
`src/services/ceMercanteImport.ts`, `src/hooks/useBlEditForm.ts`.

- [ ] Antes: consulta da Etapa 0 sobre CEs repetidos; a migration aborta
  listando os B/Ls se houver repetição, sem reescrever linhas.
- [ ] Migration nova: chave normalizada do CE e unicidade entre B/Ls não
  cancelados, cruzando com Granito, num gatilho que cobre todas as portas e
  `reactivate_bl`; a conciliação ZPT usa a mesma chave.
- [ ] Prévia da planilha acusa CE repetido; mensagens amigáveis nas telas (sem
  `duplicate key` cru).
- [ ] Depois de D-02 e D-03: formato de 15 dígitos e porta única do CE (a
  ficha só lê ou usa a porta; o BB perde a coluna ou segue as regras).
- [ ] Ajustar fixtures de `ceUnlock` e `ceMercanteAutoBilling`.
- [ ] Trocar os 8 `it.fails` de `auditoriaCeUnicidadeValidacao` por `it`.

**Aceitação:** 16/16 na suíte; transações concorrentes com o mesmo CE
recebem a mensagem amigável; a planilha de CE como `authenticated` grava o
manifesto sem `permission denied`.

## Etapa 7 — Faturas, Demurrage e Comunicado (M18, M19, M10, M21)

**Dono:** `notify_invoice_issued`; `customer_local_charges_communication_readiness`
e `reconcile_voyage_ce_mercante_missing_alerts`; gatilho de modalidade de
carga em `bl_containers`; `_calculate_demurrage_invoice_authoritative`;
`apply_container_dates_atomic`; `_run_import_effect_demurrage`.

- [ ] Notificação "Nova fatura emitida" no COMMIT, com o total gravado.
- [ ] B/L Cancelado fora da prontidão e do conteúdo do Comunicado de CE e
  Taxas e do alerta de CE (gravar ou deixar de usar
  `financial_status = 'cancelled'`).
- [ ] Datas, desova e status de Demurrage não reabrem a Revisão de B/L
  faturado; só mudanças na base de cálculo (B/L, container, IMO, OOG,
  SOC/COC) recalculam.
- [ ] Invoice de Demurrage com container devolvido no free time; SOC fora da
  devolução pendente e da emissão.
- [ ] Depois de D-13: devolução vazia, caminho manual de emissão para
  devoluções importadas, alteração depois da Demurrage emitida (M21) com
  Alerta, `demurrage_status` com uma semântica.
- [ ] Depois de D-14: recebível sem fatura não trava exclusão nem
  cancelamento.
- [ ] Trocar os 6 `it.fails` de `auditoriaFaturasDemurrageComunicado` por `it`.

**Aceitação:** os 6 casos passam (12/12 na suíte); nenhuma notificação nova
com "R$ 0.00" para fatura de total positivo; suítes `demurrage*` e
`communicationEligibility` verdes.

## Etapa 8 — Contrato da importação de CE (M07, M09, M12, M13)

Sequência interna (cada item pode ser uma PR):

- [ ] **8.1 Desempenho:** `assert_bl_ce_mercante` e
  `_sync_local_charge_receivable_before_correction_123` por igualdade em `id`
  em vez de varredura. Aceite: o custo por B/L faturado deixa de depender do
  tamanho de `bls` (200 B/Ls com 50 mil B/Ls na base em no máximo 1,3× o
  tempo com 600, no banco local; hoje é 2,2×), e `ceMercanteAutoBilling` no
  CI.
- [ ] **8.2 Erros traduzidos:** 23505, 40P01 (uma nova tentativa), 57014,
  42501 e P0099 com mensagem de negócio; sem "Linha 0"; o erro do PostgREST
  reconhecido mesmo sem ser `instanceof Error` (`src/lib/errors.ts`).
- [ ] **8.3 Nº de Manifesto canônico** (D-08): normalização, reescrita dos
  números existentes (declarar "Data status"), `CHECK`, busca canônica e
  rota por `normalize_port_code`.
- [ ] **8.4 Cadastro único** (D-08): `manifestos_mercante` como fonte;
  `voyage_route_ce_master`, `import_batches.ce_master` e a marca `linked` do
  Line-Up passam a ler dele.
- [ ] **8.5 Mover, desvincular, renomear, juntar** com motivo, dry-run e
  trava da Viagem; desvínculo automático na mudança de rota ou Viagem.
- [ ] **8.6 Porta única do CE** (D-02, D-05): função interna que valida e
  audita; `UPDATE` direto de `ce_mercante` recusado fora dela.
- [ ] **8.7 Prévia no servidor** (D-01): estado por B/L (CE atual → novo,
  faturas, Portal, Comunicado, Desbloqueio, manifesto) e confirmação com
  motivo para sobrescrita.
- [ ] **8.8 Lote e proveniência** (D-06): arquivo, hash, aba, linha e motivo
  na auditoria; trava da Viagem contra o deadlock.
- [ ] **8.9 Emissão em fatias e resultado por B/L** (D-07): gravar e calcular
  na transação, emitir em fatias logo depois, fila como rede; relatório de
  emitidas, retidas e bloqueadas; alerta por B/L da ADR 0041.
- [ ] **8.10 Documentação:** ADR nova para prévia com estado, porta única,
  número canônico e emissão em fatias; `CONTEXT.md`, `manifesto-edi.md`,
  `faturamento.md`, `viagens.md`.

**Aceitação:** suítes `local-pg` novas por item (manifesto canônico, prévia,
lote) no CI; planilha de 200 B/Ls faturáveis grava sem tempo-limite no banco
local com 50 mil B/Ls; a prévia mostra antes → depois e a sobrescrita exige
confirmação.

## Etapa 9 — Baplie (M11)

**Dono:** `apply_baplie_physical_flags_atomic`, `set_bl_container_profile`,
`src/services/baplieImport.ts`, parser do Baplie.

- [ ] Casamento por container entre B/Ls ativos (ignorar cancelados); Part Lot
  conforme D-15; a tela informa o que não aplicou.
- [ ] Correção manual de perfil protegida, com divergência visível em vez de
  sobrescrita; "Aplicar IMO/OOG agora" respeita a origem manual.
- [ ] Reemissão por mudança de base informada na tela.
- [ ] Ausência de 8077/DGS, portos fora das escalas, DIM, TDT, resolução
  SOC/COC e ISO 6346 conforme D-15; diff paginado além de 1000 linhas.
- [ ] Checagens `local-pg` novas para Part Lot, correção manual e Baplie sem
  8077, escritas a partir da decisão.

**Aceitação:** checagens novas verdes; `baplieFlagsOnBlImport`,
`containerOwnership`, `containerProfile` e `thdImoOog` verdes; ADR da escala e
cobrança leem a mesma fonte de IMO/OOG.

## Etapa 10 — Viagem Cancelada, COD, documento da fatura e papéis (M20, M22, M23, M25)

- [ ] Viagem Cancelada: guarda em `bl_containers`, `granite_bls`, faturas e
  comunicados; `cancel_voyage` encerra efeitos pendentes; comunicados
  automáticos ignoram Viagem Cancelada.
- [ ] COD (D-22): reimportação não altera POD de B/L com COD; B/L importado
  depois da Omissão de Escala entra no transbordo ou é recusado.
- [ ] Documento da fatura (D-21): congelar Cliente, CNPJ, POL/POD e Viagem na
  emissão.
- [ ] Papéis (D-20): permissões das importações no banco e nas telas.

**Aceitação:** checagens `local-pg` novas por item, a partir dos roteiros da
crítica de completude do relatório (Viagem Cancelada com datas, Granito e
NOA; COD × reimportação; documento lido de dados vivos; permissões).

## Etapa 11 — Veículos, Base de Clientes, Granito e vazios (M15, M16, M17)

- [ ] Veículos (D-17): Liberação recalcula quando há veículo novo; B/L isento
  anula o recebível sem fatura; correção auditada depois do CE; regras do
  cliente também no servidor; heurística `…00` mostrada na prévia.
- [ ] Base de Clientes (D-18): vínculo só de pendentes, como vínculo por
  documento, com prévia; telas de Revisão e Faturamento invalidadas.
- [ ] Granito e vazios (D-19): atualização por número de B/L na Viagem;
  vazios por rota preservando a natureza; documentação do cálculo de
  Granito.
- [ ] Programação por planilha com prévia e atômica.
- [ ] Primeiras suítes `local-pg` das RPCs de veículos, Granito e vazios.

**Aceitação:** suítes novas verdes no CI; reimportar a mesma planilha de
Granito ou de vazios não duplica linhas.

## Etapa 12 — Testes e CI

- [ ] Incluir no CI as 12 suítes `local-pg` hoje fora da lista, depois de
  corrigir o isolamento (`containerOwnership` apaga
  `customer_portal_accounts` e usa CNPJ sintético).
- [ ] Ordem explícita no CI (sequenciador ou passo próprio para a bateria
  financeira) e limpeza de resíduo global no teardown.
- [ ] Sonda negativa com `LOCAL_PG_INTEGRATION=1` falha o teste em vez de
  `describe.skip`; remover o bloco 080 obsoleto de `alinhamentoPermissoes`.
- [ ] Converter os contratos textuais críticos de importação que leem
  `migrations_archive` em `local-pg`, ou aposentá-los.
- [ ] Remover ou religar o código sem chamador (`maybeAutoBillAfterCeMercante`,
  hooks de manifesto, `createInvoiceForReturnedBL`) e seus testes.
- [ ] Checagem que falha quando surge `*.local-pg.test.ts` fora da lista do
  CI.

**Aceitação:** todas as suítes `local-pg` no CI, verdes em ordem natural e
invertida; nenhuma suíte pulada por sonda com a variável ligada.

## Etapa 13 — Encerramento

- [ ] Nenhum `it.fails` restante nas suítes `auditoria*`.
- [ ] Documentação viva da seção 8 do relatório atualizada.
- [ ] Mover este plano para `docs/archive/plans/` e retirar a linha de
  `docs/plans/README.md` na mesma mudança que concluir a última etapa.
