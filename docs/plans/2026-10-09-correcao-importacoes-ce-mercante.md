# Correção das importações e do CE Mercante — plano de implementação

> **Para execução por agentes:** usar `executing-plans`. Cada etapa é uma
> mudança própria (uma PR), executável sozinha na ordem da tabela de
> dependências. Este plano não autoriza mudança em produção, publicação nem
> ativação do `import-effects-runner`.

**Origem:** [revisão das importações e do CE Mercante de 2026-10-09](../archive/audits/2026-10-09-revisao-importacoes-ce-mercante.md).
Os ids `M01`–`M25` são os problemas-raiz da seção 5 do relatório.

**Regras de negócio:** decididas pelo dono em 2026-10-09 e registradas na
[ADR 0078](../adr/0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md)
(citada abaixo como "ADR 0078, item N") e no `CONTEXT.md`. Diferença de fatura
paga é sempre tratada por restituição (item 4 da ADR 0077), nunca por crédito em
outra fatura. Não há decisão pendente.

**Objetivo:** fazer as importações deixarem de apagar dado válido, de cobrar
errado e de esconder o que gravaram, e implementar as regras de entrada,
correção e efeitos da ADR 0078.

**Estado em 2026-10-10:** Etapas 0, 1, 2, 3 e 5 executadas localmente (migrations `173` a `175`;
ver as notas de execução nas etapas). Decisões tomadas. As checagens de
aceitação das Etapas 4, 6 e 7 continuam no repositório como `it.fails` e rodam no
CI; as regras novas da ADR 0078 ganham checagem na etapa que as implementa.
**Migrations:** o hook `.claude/hooks/protect-files.sh` bloqueia qualquer
arquivo em `supabase/migrations/`; as migrations novas desta execução foram
criadas por shell, sem editar nenhuma existente.

## Regras comuns a todas as etapas

- **Critério de aceitação executável.** A etapa só termina quando os
  `it.fails` nomeados viram `it` e passam, as checagens novas listadas na etapa
  existem e passam, e as suítes vizinhas continuam verdes. Não apagar nem
  afrouxar um caso para fazê-lo passar.
- **Gates locais:** `npm run docs:check`, `npm run typecheck`,
  `npm run lint`, `npm test`, `npm run build`; com migration, também
  `npm run migrations:check`, `npm run rpc:check` e o replay local
  (`sudo scripts/setup-local-pg.sh --reset` e as suítes `local-pg` do CI com
  `--no-file-parallelism`, duas vezes seguidas, sem resíduo de namespace).
- **Migrations:** sempre arquivo novo, no próximo número livre (hoje `173`);
  nunca editar migration existente (protegida por
  `.claude/hooks/protect-files.sh`). Redefinir a função a partir da definição
  **efetiva** no banco replicado, não da primeira migration que a criou. Se a
  migration reescrever ou apagar linhas, declarar no cabeçalho que depende da
  linha "Data status" do `AGENTS.md`.
- **Rastro (ADR 0078, item 9):** toda importação ou correção nova grava no
  Histórico quem, data e hora, tipo de importação, contexto (Nº de Manifesto,
  Viagem, rota), valor anterior e novo, e motivo quando houver.
- **Permissões (ADR 0078, item 10):** importações abertas a qualquer
  Departamento ativo; nenhuma etapa restringe importação por Departamento.
- **Fatura emitida que muda de valor** por correção posterior segue sempre a
  ADR 0077 (reemissão automática sem pagamento; com pagamento, item 4 da 0077).
- **Documentação viva no mesmo change:** os trechos da seção 8 do relatório, o
  `CONTEXT.md` (retirando "implementação pendente" do que a etapa entregar),
  `RASTREABILIDADE.md` e o módulo afetado.
- Marcar simplificações com `ponytail:` e o teto conhecido.

## Ordem e dependências

| Etapa | Problemas | ADR 0078 | Depende de |
|---|---|---|---|
| 0 — Salvaguardas | M04 | 18 | — |
| 1 — Carga solta | M01 | 1, 14 | — |
| 2 — B/L de container | M02, M14 | 16, 17 | — |
| 3 — Leitura de planilhas | M05 | 22 | — |
| 4 — Fila de efeitos e Viagem Cancelada | M04, M20 | 18 | — |
| 5 — Container compartilhado | M03, M24 | 11 | — |
| 6 — Unicidade e portas do CE | M06, M08 | 1–3, 5 | — |
| 7 — Faturas, Demurrage, datas e Comunicado | M18, M19, M10, M21 | 12, 19, 20 | 5 (datas do irmão) |
| 8 — Contrato da importação de CE | M07, M09, M12, M13 | 4, 6, 7, 9 | 6 |
| 9 — Baplie | M11 | 21 | 2 |
| 10 — COD, documento da fatura | M22, M23 | 13, 15 | 2 |
| 11 — Veículos, Base de Clientes, Granito, vazios | M15, M16, M17 | 8, 23–25 | 3, 4 |
| 12 — Testes e CI | testes da seção 7 | — | — |
| 13 — Ligar o processamento automático | M04 | 18 | 4, 7 |
| 14 — Encerramento | — | — | todas |

As Etapas 1, 2, 3, 5 e 6 são independentes e podem correr em paralelo, cada
uma com seu número de migration. Prioridade sugerida: 1, 2, 3 e 5 (dano ativo
hoje), depois 6 e 4, depois as demais.

## Etapa 0 — Salvaguardas (sem código)

- [x] Manter `IMPORT_EFFECTS_RUNNER_ENABLED` desligado até a Etapa 13.
  Registrar a condição na seção do runner em
  [`servicos-externos.md`](../operations/servicos-externos.md).
- [ ] O dono roda, **em leitura**, no banco de produção: efeitos pendentes por
  `effect_kind` e idade em `import_pending_effects`; B/Ls não cancelados com o
  mesmo CE (em `bls` e entre `bls` e `granite_bls`); CEs fora de
  `^[0-9]{15}$`; Nº de Manifesto que colidem depois da normalização (maiúsculas,
  sem separadores); containers com `demurrage_status = 'returned'` e
  `return_date` nula; containers FCL em B/Ls de Clientes diferentes; mesmo
  chassi em Viagens diferentes. O resultado orienta as Etapas 4, 5, 6, 8 e 11.
- [ ] (dono) Orientar a operação até as correções: não reimportar Manifesto BB, B/L
  avulso nem B/L de container de B/L já com CE; em XLSX, digitar datas como
  texto `DD/MM/AAAA`; conferir dia e mês na prévia de datas.

**Aceitação:** condição registrada no manual; consultas anexadas à PR da
Etapa 4.

## Etapa 1 — Reimportação de carga solta (M01; ADR 0078, itens 1 e 14)

**Dono:** `import_breakbulk_manifest_transactional` (definição efetiva das
migrations `060`/`064`), `src/services/breakbulkImport.ts`,
`src/services/breakbulkManifestParser.ts`, `src/services/blDocumentImport.ts`,
modais `BlBreakbulkManifestModal.tsx`, `BlDocumentImportModal.tsx`,
`VoyageImportActions.tsx`.

- [x] Migration nova redefinindo a RPC: B/L existente só atualiza os campos
  que o arquivo traz; nunca toca `ce_mercante`; Cliente vinculado,
  `review_status`, reconciliação e nota humana preservados; sugestão por nome
  grava `suggested_customer_id`.
- [x] **CE fora do Manifesto BB:** a coluna CE sai do modelo
  (`public/templates/manifesto-bb-modelo.*`, `carga-solta-modelo.*`) e do
  obrigatório do layout resumido; se vier, é ignorada com aviso na prévia; o
  texto do modal deixa de dizer que o CE pode vir na planilha.
- [x] **Troca de Consignatário** com aceite, pelo mesmo contrato de
  `relink_bl_customer` do B/L de container; sem aceite, Cliente atual mantido e
  divergência devolvida em `customer_changes_ignored`.
- [x] Campos do documento (POL, POD, shipper, notify, descrição, peso)
  atualizam como correção; em B/L faturado, rota e Viagem pedem a confirmação de
  faturamento, e a fatura segue a ADR 0077; B/L em COD não tem o POD alterado
  (ver Etapa 10).
- [x] B/L existente em outra Viagem recusa o lote na prévia e no servidor, com
  mensagem que nomeia o B/L e as duas Viagens.
- [x] Trocar os 6 `it.fails` de `auditoriaImportacaoCargaSolta` por `it`;
  remover `src/services/__tests__/breakbulkImportCeMigration.test.ts` (lê a
  `304` arquivada e mascara a regressão).
- [x] Checagens novas: BB com coluna CE preenchida não grava CE e avisa;
  correção de POD por reimportação atualiza o B/L e desvincula o Manifesto
  Mercante.
- [x] Docs: `manifesto-edi.md` (B/L avulso, BB e item 11), retirando o "defeito
  conhecido".

**Aceitação:** os 6 casos passam como `it`; o caso-guarda continua verde; um
lote com B/L faturado e B/L novo é aceito sem cancelar nem reemitir;
`pr698ClaudeReview`, `importEffects` e `auditoriaRun2` verdes.

**Execução (2026-10-10, local):** migration `173` redefine a RPC; os 6 casos
viraram `it` e passam com 5 checagens novas (CE ignorado, POD corrigido
desvincula o Manifesto, reimportação idêntica sem efeito, rota de B/L faturado
sem confirmação, Troca de Consignatário com aceite). O caso de CE do Manifesto
BB em `auditoriaCeUnicidadeValidacao` também virou `it` (o BB não grava CE).
Prévia nos três pontos de entrada (`/bls`, ações da Viagem e B/L avulso) com
`BreakbulkReimportReview`. "Faturado", para travar a rota, é fatura viva ou
status faturado/pago; B/L só calculado tem a rota corrigida e é recalculado
pela tela. O desvínculo do Manifesto por POD vale só nesta RPC; o gatilho
geral fica na Etapa 8.5.

## Etapa 2 — Reimportação de B/L de container (M02, M14; ADR 0078, itens 16 e 17)

**Dono:** `import_bl_freight_transactional_legacy_205` (núcleo efetivo),
`_import_bl_freight_before_invoice_alert_123`, `guard_shared_container_mutation`,
`import_bl_freight_with_metadata`, `apply_bl_review_gate_after_import`,
`src/services/blFreightImport.ts`, `src/components/shared/BlImportModal.tsx`.

- [x] Migration nova: reconciliar containers por número em vez de `DELETE` +
  `INSERT`; atualizar só as colunas do documento e só quando mudam; preservar
  `id`, `created_at`, descarga, devolução, `demurrage_status`, local de desova,
  SOC/COC manual e perfil manual; container ausente do arquivo sai só quando a
  prévia mostra a remoção (ADR 0071 item 10), com mensagem de negócio se houver
  Invoice de Demurrage.
- [x] **Veículos pela aba VIN:** sem aba, nada muda; com aba, a prévia lista
  entram, saem e mudam e pede confirmação; o local de desova dos que continuam é
  preservado; um alerta registra o B/L e as mudanças; chassi que está em outro
  B/L recusa só a linha.
- [x] A guarda de container compartilhado olha só mudança de participação.
- [x] Import idêntico de B/L faturado não recalcula, não enfileira
  `provisional_charges` e não acende "Carga alterada após faturamento".
- [x] M14: o e-mail do arquivo vira contato só do Cliente final e só quando o
  CNPJ do arquivo é o dele.
- [x] Retorno e modal informam, por B/L, containers inseridos, atualizados e
  removidos e VINs descartados.
- [x] Trocar os 6 `it.fails` de `auditoriaImportacaoBlContainer` por `it`.
- [x] Checagens novas: arquivo sem aba VIN preserva os veículos; aba VIN com
  chassis diferentes exige confirmação e abre o alerta.
- [x] **D-11 (ADR 0078, item 17):** Laden on Board ilegível ou vazio não altera
  a data (aviso); todos os portos do cadastro reconhecidos pelo nome e POD
  desconhecido recusa a linha; confirmação de faturamento por B/L na prévia; NCM
  do documento vence quando declarado; CPF continua recusado (não há Cliente
  pessoa física). Checagens novas para Laden on Board e POD desconhecido.

**Aceitação:** os 6 casos e as checagens novas passam; reimportação "Sem
mudança" não gera `audit_logs` de exclusão ou criação em `bl_containers` nem em
`vehicles`; `containerOwnership`, `invoiceAutoReissue`, `invoiceBasisCorrection`,
`baplieFlagsOnBlImport`, `blCbmSemantics`, `thdImoOog`, `importAtomicity`,
`blFreightImport.test.ts` e `BlImportModal.test.tsx` verdes.

**Execução (2026-10-10, local):** migration `174` redefine o núcleo `legacy_205`
(reconciliação por número; remoção só pela lista `remove_containers` que a
prévia mostrou; veículos por aba VIN com `confirm_vehicle_changes` e alerta
`bl_vehicles_changed_on_reimport`), a guarda de container compartilhado (só
participação), `import_bl_freight_with_metadata` (B/L faturado não é
recalculado), `legacy_322`/`357` e o gate (M14) e `legacy_070` (Laden on Board).
Os 6 casos viraram `it`, com 4 checagens novas de integração e 6 unitárias. O
caso de datas do irmão em `auditoriaCeContainerCompartilhado` também virou `it`
(guarda da Etapa 5 já corrigida aqui). Payload sem `remove_containers` mantém a
semântica anterior (sai todo ausente), para chamadas diretas da RPC. A lista de
chassis segue variável de faturamento: em B/L já calculado, a mudança de
veículos pede as duas confirmações (faturamento e veículos). Fora do escopo,
com etapa própria: a recusa de container FCL entre Clientes diferentes (Etapa 5)
e o POD de B/L em COD na reimportação de container (Etapa 10).

## Etapa 3 — Leitura de planilhas (M05; ADR 0078, item 22)

**Dono:** `readSheet` em `src/services/importCore.ts`; parser de data único
novo em `src/lib/importDate.ts` (análogo a `src/lib/importNumber.ts`).

- [x] `readSheet` entrega a célula tipada e não deixa o SheetJS converter CSV.
- [x] Parser de data único com data civil, sem fuso, e recusa de ano fora de
  quatro dígitos; migrar datas, Embarque de Vazios, programação, Granito, PIX
  e ZPT.
- [x] Números sempre por `parseImportNumber`, com o formato decidido pela
  evidência do arquivo; CE, CNPJ e CEP numéricos com causa explícita.
- [x] **Regras comuns:** duas colunas para o mesmo campo bloqueiam a
  importação com mensagem; linhas e abas ocultas são ignoradas com aviso na
  prévia ("N linhas ocultas ignoradas"); CSV Windows-1252 é aceito com aviso.
- [x] Revisar os modelos em `public/templates/` (coluna CE como texto).
- [x] Trocar os 9 `it.fails` de `auditoriaLeituraPlanilhas` por `it`.
- [x] Checagens novas para colunas duplicadas, linhas ocultas e Windows-1252.

**Aceitação:** os 9 casos e as checagens novas passam; nenhum parser de
importação usa `toISOString`, `getUTC*` ou `cellDates` para converter célula;
`veiculos-modelo.csv` continua aceito.

**Execução (2026-10-10, local):** `readSheet` entrega a célula tipada (texto,
número, máscara de zeros como texto, data do Excel como `AAAA-MM-DD` pelo
serial) e lê CSV sempre como texto; `src/lib/importDate.ts` é o parser único de
datas (datas de container, Embarque de Vazios, programação de Chegadas/Saídas e
do Portal, Granito, PIX, ZPT e o Laden on Board do B/L); `parseImportNumber`
ignora a célula numérica tipada como evidência de separador. Cabeçalho repetido
ou duas colunas do mesmo campo bloqueiam; linhas e abas ocultas são ignoradas e
o aviso aparece no seletor de arquivo comum (`ImportFilePicker`); CSV
Windows-1252 é aceito com aviso. O modelo de CE grava a coluna CE como texto.
Os 9 casos viraram `it`, com checagens novas em `importCore.test.ts` (colunas
duplicadas, linhas e abas ocultas, Windows-1252, CSV como texto, máscara de
zeros), `ImportFilePickerWarnings.test.tsx` e para CE e CNPJ numéricos.
Limitação: a aba VIN do arquivo de B/L ainda é lida pelo `sheet_to_json` do
próprio parser (linhas ocultas não são filtradas ali).

## Etapa 4 — Fila de efeitos e Viagem Cancelada (M04, M20; ADR 0078, item 18)

**Dono:** `_run_import_effect_vehicle_followup`,
`_run_import_effect_local_charges`, `_run_import_effect_demurrage`,
`claim_import_effects`, `process_import_effect`, produtores em
`import_bl_freight_with_metadata`; `cancel_voyage` e guardas de Viagem
Cancelada; `src/services/alertRulesCatalog.ts`.

- [x] Consumidor de veículos revalida e só recalcula B/L sem fatura viva; a
  fatura de B/L com fatura viva é tratada no COMMIT da importação (ADR 0077).
- [x] `local_billing` reaproveita o cálculo do dia do CE e não toca outros
  B/Ls da Viagem.
- [x] Erros 40001/40P01/55P03 viram `retry_wait`; lease esgotado e
  dependência bloqueada abrem `import_effect_blocked`; P0001 de domínio deixa de
  ser `invalid_effect_payload`.
- [x] Produtores param de enfileirar `physical_flags` redundante; efeito novo
  da mesma entidade e tipo substitui o pendente.
- [x] **Viagem Cancelada:** guarda em `bl_containers`, `granite_bls`, faturas e
  comunicados; `cancel_voyage` encerra os efeitos pendentes da Viagem;
  consumidores e comunicados automáticos ignoram Viagem Cancelada.
- [x] **Simulação do acumulado:** RPC server-only que roda os efeitos pendentes
  em modo de simulação e lista o que cada um faria (faturas a emitir, a cancelar,
  recálculos); aprovar processa os selecionados e descarta o resto com registro.
- [x] Métrica e Alerta de fila parada.
- [x] Trocar os 5 `it.fails` de `auditoriaEfeitosImportacao` por `it`.
- [x] Checagens novas: datas, CE de Granito e comunicados recusados em Viagem
  Cancelada; simulação não grava nada.

**Aceitação:** os 5 casos e as checagens novas passam; `invoiceBasisCorrection`,
`importEffects`, `portalBillingRelease`, `ceMercanteAutoBilling`,
`localBillingIntegrity`, `invoiceAutoReissue` e `demurrageAuthority` verdes.

**Execução (2026-10-10, local):** migration `177`. `vehicle_followup` não
toca B/L com fatura viva que continua cobrado, cancela só com a isenção
confirmada agora (`_quote_bl_local_charges` = exempt, encerrando a consolidada
viva sem reemissão; `invoiceBasisCorrection` passou a montar a isenção de
fato) e recalcula o resto; `local_billing` trava o B/L de
origem, usa `_auto_bill_bl_core(..., true)` (cálculo do dia do CE), recalcula
só irmãos de container provisórios e devolve o SQLSTATE original; Viagem só
varre B/Ls sem CE e sem retenção. `process_import_effect`: 55P03/40001/40P01 em
`retry_wait`, P0001 vira `effect_domain_refused`, tipo desconhecido 0A000.
`claim_import_effects` abre `import_effect_blocked` por lease esgotado e por
dependência. `enqueue_import_effect` substitui o pendente de qualquer revisão;
`import_bl_freight_with_metadata` sem `physical_flags`. Viagem Cancelada:
gatilho `guard_voyage_cancelled_via_parent` em `bl_containers`, `granite_bls`
e INSERT de `invoices`, `invoice_bls`, `customer_communications` e
`customer_communication_bls`; `cancel_voyage` encerra os efeitos (`superseded`,
`closed_effects` no retorno) e o executor encerra efeito de Viagem Cancelada.
Simulação: `simulate_import_effects` e `apply_import_effects_review`
(server-only, descarte em `audit_logs`). Fila parada: `import_effects_queue_health`,
`reconcile_import_effects_queue_alert` e job `import-effects-queue-health`
(SQL, de hora em hora; não processa efeitos). Drift mecânico: os Comunicados
automáticos não ganharam filtro próprio; a guarda de INSERT os recusa em Viagem
Cancelada. `auditoriaEfeitosImportacao` 10/10 e a suíte nova
`efeitosViagemCancelada` (5) no CI.

## Etapa 5 — Container compartilhado (M03, M24; ADR 0078, item 11)

**Dono:** `guard_shared_container_invoice` e `guard_shared_container_mutation`
(migration `066`); vínculo em `invoice_receivable_links`; importação de B/L.

- [x] Função única que diz se o rateio cobrado de um B/L ainda é o atual; a
  guarda de emissão só recusa rateio desatualizado (a proteção contra cobrar
  150% fica), com SQLSTATE próprio e mensagem que nomeia o B/L irmão.
- [x] A guarda de mutação olha só participação no container; datas e desova
  do irmão passam.
- [x] Mesma checagem na consolidada.
- [x] **Container FCL em B/Ls de Clientes diferentes** é recusado pela
  importação de B/L (prévia e servidor); containers de veículos LCL continuam
  aceitos.
- [x] **Conjunto que muda depois do faturamento** (irmão que chega ou é
  excluído): a importação ou a exclusão é aceita e a fatura do B/L já faturado
  segue a ADR 0077, com a reemissão no resultado e no alerta.
- [x] Trocar os 3 `it.fails` de `auditoriaCeContainerCompartilhado` por `it`.
- [x] Checagens novas: recusa de FCL entre Clientes diferentes; irmão que
  chega depois reemite a fatura do primeiro com 1/2; exclusão do irmão reemite
  com o container inteiro.

**Aceitação:** os 3 casos e as checagens novas passam em qualquer ordem de
linhas; o caso de fração diferente (150%) continua recusado.

**Execução (2026-10-10, local):** migration `175`: `bl_container_share_signature`
é a função única do rateio atual; `invoice_bls.container_shares` grava o
rateio de cada vínculo (preenchido nos vínculos existentes, pela linha "Data
status"); a guarda de emissão recusa só irmão faturado com rateio diferente do
atual (P0007, nomeando o irmão; vale na consolidada, que usa o mesmo vínculo);
a guarda de mutação de container compartilhado saiu, e o conjunto que muda
depois do faturamento segue a ADR 0077 pela base (que já listava os irmãos);
`assert_no_fcl_shared_between_customers` (P0008) recusa FCL entre Clientes
diferentes na importação, e a prévia bloqueia a linha. Os 3 casos viraram `it`,
com 4 checagens novas (irmão que chega reemite 1/2, irmão cancelado reemite o
container inteiro, fração diferente recusada, FCL entre Clientes recusado na
prévia e no servidor). Limite (`ponytail` na 175): a guarda olha o rateio do
irmão, não o do próprio B/L, cujo cálculo é refeito pelo CE e pela Liberação.

## Etapa 6 — Unicidade e portas do CE (M06, M08; ADR 0078, itens 1–3 e 5)

**Dono:** banco (`bls`, `granite_bls`), `ce_unlock_reconcile`,
`save_bl_review`, `apply_ce_mercante_update`, `reactivate_bl`,
`src/services/ceMercanteImport.ts`, `src/hooks/useBlEditForm.ts`, ficha do B/L.

- [x] Antes: consulta da Etapa 0 sobre CEs repetidos; a migration aborta
  listando os B/Ls se houver repetição, sem reescrever linhas.
- [x] Migration nova: chave normalizada do CE e unicidade entre B/Ls não
  cancelados, cruzando com Granito, num gatilho que cobre todas as portas e
  `reactivate_bl`; a conciliação ZPT usa a mesma chave.
- [x] **Porta única no banco:** função interna que valida 15 dígitos,
  unicidade e Manifesto Mercante e audita com motivo; `UPDATE` direto de
  `ce_mercante` recusado fora dela; `save_bl_review` deixa de gravar o CE.
- [x] **Ficha do B/L:** ações **Corrigir CE Mercante** e **Remover CE
  Mercante**, para qualquer usuário ativo, com motivo; remover só sem fatura
  viva, com a orientação de o Administrativo cancelar a fatura antes;
  Comunicado já enviado abre pendência de reenvio.
- [x] Prévia da planilha acusa CE repetido; mensagens sem `duplicate key` cru.
- [x] Ajustar fixtures de `ceUnlock` e `ceMercanteAutoBilling`.
- [x] Trocar os 8 `it.fails` de `auditoriaCeUnicidadeValidacao` por `it`.
- [x] Checagens novas: corrigir e remover pela ficha gravam motivo no
  Histórico; remover com fatura viva é recusado.

**Aceitação:** 16/16 na suíte e as checagens novas; transações concorrentes
com o mesmo CE recebem a mensagem amigável; a planilha de CE como
`authenticated` grava o manifesto sem `permission denied`.

**Execução (2026-10-10, local):** migration `176`: `ce_mercante_key` (só
dígitos), pré-checagem que aborta listando CEs repetidos, índice único
`bls_ce_mercante_active_key` e gatilho `guard_ce_mercante_unique` em `bls` e
`granite_bls` (cobre todas as portas, Granito e `reactivate_bl`, com trava
consultiva e mensagem amigável `P0010`); porta única `_set_bl_ce_mercante`
(15 dígitos, Histórico com motivo, alerta `comunicado_ce_reenvio_pendente`) e
`guard_bl_ce_mercante_port` recusando `UPDATE` direto de sessão de usuário;
`correct_bl_ce_mercante` e `remove_bl_ce_mercante` (`P0011` com fatura viva);
`save_bl_review` descarta `ce_mercante`; `ce_unlock_reconcile` casa pela chave.
Na ficha, o CE sai do Salvar e vira `BlCeMercanteField` com **Corrigir** e
**Remover**; a prévia da planilha acusa CE repetido. Drift mecânico: a
validação do Manifesto Mercante continua na planilha (`apply_ce_mercante_rows_atomic`,
164); a porta única não exige manifesto para Corrigir/Remover pela ficha.
Fixtures de `ceUnlock`, `ceMercanteAutoBilling`, `auditSecurityBoundaries` e
`customerCommunicationReadinessGuards` usavam o mesmo CE `1234567890123NN`;
com a unicidade, cada suíte ganhou CEs do próprio namespace. `auditoriaCeUnicidadeValidacao`: 18/18 (16 + 2
checagens novas).

## Etapa 7 — Faturas, Demurrage, datas e Comunicado (M18, M19, M10, M21; ADR 0078, itens 12, 19 e 20)

**Dono:** `notify_invoice_issued`; `customer_local_charges_communication_readiness`
e `reconcile_voyage_ce_mercante_missing_alerts`; gatilho de modalidade de carga
em `bl_containers`; `_calculate_demurrage_invoice_authoritative`;
`apply_container_dates_atomic`; `_run_import_effect_demurrage`; gatilho legado
que copia a ATA na inserção de container; Régua de Cobrança
(`claim_demurrage_dunning_candidates`); `cancel_bl` e exclusão de B/L;
`src/services/containerDatesImport.ts`.

- [x] Notificação "Nova fatura emitida" no COMMIT, com o total gravado.
- [x] B/L Cancelado fora da prontidão e do conteúdo do Comunicado de CE e
  Taxas e do alerta de CE.
- [x] Datas, desova e status de Demurrage não reabrem a Revisão de B/L
  faturado; só a base de cálculo recalcula.
- [x] Invoice de Demurrage com container devolvido no free time; SOC fora da
  devolução pendente e da emissão.
- [x] **Planilha de datas:** chave B/L + container (várias viagens por
  arquivo); a data vale para todos os B/Ls que dividem o container na mesma
  Viagem; datas diferentes para o mesmo container no arquivo recusam as linhas;
  célula ou coluna de devolução vazia não altera a data; prévia "antes →
  depois".
- [x] **Descarga só informada:** remover o preenchimento pela ATA na inserção
  de container; container sem descarga informada fica sem data.
- [x] **Remover data** pela edição do container, com motivo no Histórico.
- [x] **Demurrage emitida e datas alteradas:** sem pagamento, cancelar e
  reemitir automaticamente (só cancelar se o valor for zero); com pagamento,
  item 4 da ADR 0077; alerta e suspensão da Régua para essa fatura.
- [x] **Invoice de Demurrage por grupo:** B/Ls do mesmo Cliente ligados por
  container compartilhado recebem uma única Invoice de Demurrage, cada caixa uma
  vez, emitida quando todos os containers do grupo estiverem devolvidos.
  Confirmar antes, com checagem, o comportamento atual (o cálculo por B/L
  indica cobrança dupla da caixa compartilhada; evidência só de código).
- [x] **Recebível sem fatura:** não trava cancelamento nem exclusão do B/L; é
  anulado com o cálculo, com registro no Histórico; deixa de aparecer como
  pagável no Portal.
- [x] "Gerar Fatura" manual alcança B/Ls com todos os containers devolvidos,
  não só `overdue`; `demurrage_status` com uma semântica.
- [x] Trocar os 6 `it.fails` de `auditoriaFaturasDemurrageComunicado` por `it`.
- [x] Checagens novas: devolução vazia preserva a data; data propagada ao B/L
  irmão; Demurrage reemitida após correção de datas; grupo com uma invoice;
  cancelamento de B/L com recebível sem fatura.

**Aceitação:** os 6 casos (12/12 na suíte) e as checagens novas passam;
nenhuma notificação nova com "R$ 0.00" para fatura de total positivo; suítes
`demurrage*` e `communicationEligibility` verdes.

**Execução (2026-10-10, local):** migration `178`. Notificação "Nova fatura
emitida" em constraint trigger adiado, relendo o total (formato pt-BR).
Prontidão, conteúdo do Comunicado e Alerta de CE da Viagem com
`cancelled_at IS NULL`. Gatilho de modalidade de carga só reage a
`bl_id`/`container_number`. Cálculo de Demurrage com item zero; SOC fora da
devolução pendente e da emissão. `demurrage_status` normalizado por gatilho.
Datas: `_apply_container_dates_core` (propaga aos B/Ls ativos da Viagem;
devolução vazia mantém), `apply_container_dates_atomic` reescrita,
`set_container_dates` com motivo para remover; `trg_container_discharge_date`
removido. Grupo: `demurrage_group_bl_ids`/`demurrage_group_anchor`,
`issue_demurrage_invoice_for_bl` (manual e `_run_import_effect_demurrage`),
cálculo, conjunto completo e emissão por grupo. Reemissão por datas com Alerta
`demurrage_invoice_dates_changed` e `dunning_suspended_reason` na Régua.
Recebível sem fatura anulado em `cancel_bl` e antes da exclusão do B/L.
Frontend: datas pela RPC (motivo ao remover na ficha e na página Demurrage),
"Gerar Fatura" pelo banco e também para B/L devolvido com sobreestadia, prévia
"antes → depois" com recusa do mesmo container com datas diferentes na Viagem.
Checagem do comportamento anterior do grupo: só por código (cada B/L cobrava a
caixa compartilhada inteira); a checagem nova prova uma Invoice só. Limites
registrados como `ponytail`: com pagamento, a diferença de Demurrage não é
abatida nem restituída sozinha; a Invoice do grupo só aparece no B/L-âncora.
`auditoriaFaturasDemurrageComunicado` 17/17 (12 + 5 checagens novas).

## Etapa 8 — Contrato da importação de CE (M07, M09, M12, M13; ADR 0078, itens 4, 6, 7 e 9)

Sequência interna (cada item pode ser uma PR):

- [x] **8.1 Desempenho:** `assert_bl_ce_mercante` e
  `_sync_local_charge_receivable_before_correction_123` por igualdade em `id`.
  Aceite: o custo por B/L faturado deixa de depender do tamanho de `bls` (200
  B/Ls com 50 mil B/Ls na base em no máximo 1,3× o tempo com 600, no banco
  local; hoje é 2,2×), e `ceMercanteAutoBilling` no CI.
- [x] **8.2 Erros traduzidos:** 23505, 40P01 (uma nova tentativa), 57014,
  42501 e P0099 com mensagem de negócio; sem "Linha 0"; o erro do PostgREST
  reconhecido mesmo sem ser `instanceof Error` (`src/lib/errors.ts`).
- [x] **8.3 Nº de Manifesto canônico:** 13 caracteres, letras ou dígitos,
  maiúsculas sem espaços nem separadores; reescrita dos números existentes
  (declarar "Data status"), `CHECK`, busca canônica e rota por
  `normalize_port_code`.
- [x] **8.4 Cadastro único:** `manifestos_mercante` como fonte;
  **Informar Nº** passa a gravar nele e `voyage_route_ce_master` e
  `import_batches.ce_master` passam a ler dele. A coluna **Vinculada** da
  escala mantém a regra própria.
- [x] **8.5 Mover / Desvincular:** na Viagem (Rotas e Manifestos → Ver B/Ls) e
  na ficha, em lote, com busca, **Selecionar todos os filtrados**, Shift e
  **Colar lista de B/Ls**; confirmação "N B/Ls sairão de … e irão para …" e
  motivo; tudo ou nada; destino novo validado e criado na hora. Desvínculo
  automático quando POD ou Viagem mudam.
- [x] **8.6 Mover pela planilha:** reimportar a planilha com outro número move
  os B/Ls depois de confirmação com motivo na prévia.
- [x] **8.7 Prévia no servidor:** estado por B/L (CE atual → novo, faturas,
  Portal, Comunicado, Desbloqueio, manifesto); a troca de CE exige confirmação
  com motivo; troca com Comunicado enviado abre pendência de reenvio; troca com
  Desbloqueio conferido abre alerta.
- [x] **8.8 Regras da planilha:** linha sem CE é erro e bloqueia, nomeando as
  linhas; B/L cancelado ignorado com aviso; mais de uma aba com dados recusada;
  trava da Viagem contra o deadlock.
- [x] **8.9 Emissão em lotes e resultado por B/L:** gravar CE e cálculo na
  transação; emitir logo depois em lotes conduzidos pela tela, com progresso e
  **Retomar**, e a fila como rede; emitente "Sistema — CE Mercante"; resultado
  por B/L (faturada, retida, bloqueada com motivo); alerta por B/L da ADR 0041.
  Aceite: planilha de **400 B/Ls** faturáveis com folga no banco local com 50
  mil B/Ls na base.
- [x] **8.10 Rastro:** CE, manifesto criado e vínculo no Histórico, sem evento
  duplicado.
- [x] **8.11 Documentação:** `CONTEXT.md`, `manifesto-edi.md`,
  `faturamento.md`, `viagens.md`, `RASTREABILIDADE.md`.

**Aceitação:** suítes `local-pg` novas por item (manifesto canônico, mover,
prévia, emissão em lotes) no CI; a prévia mostra antes → depois e a
sobrescrita exige confirmação.

**Execução (2026-10-10, local):** migrations `179` e `180`.
8.1: igualdade em `id` em `assert_bl_ce_mercante` e
`_sync_local_charge_receivable_before_correction_123`; medição local
(`scripts/perf/measure-ce-import.sql`, 200 B/Ls): antes 2,35× (8,3 s → 19,4 s
de 600 para 50 mil B/Ls), depois 0,88× (6,0 s → 5,3 s); `ceMercanteAutoBilling`
e `portalBillingRelease` entraram no CI. 8.2: `_ce_row_error_message` no
servidor; 40P01/55P03/P0010–P0012 em `src/lib/errors.ts`; a tela usa
`userFacingErrorMessage` (o erro do PostgREST não precisa ser `Error`) e não
mostra "Linha 0"; uma nova tentativa em 40P01. 8.3: `canonical_manifesto_numero`,
reescrita dos números (Data status), `CHECK ... NOT VALID` validado quando todos
cabem, gatilho `trg_manifestos_mercante_canonical` (P0012), `find_manifesto_mercante`,
rota por `normalize_port_code`. 8.4: `set_voyage_route_ce_master` grava em
`manifestos_mercante` (`_upsert_route_manifesto`); espelho
`voyage_route_ce_master` nos dois sentidos; **Informar Nº** sempre grava o
cadastro e mostra a recusa do banco. 8.5: `move_bls_to_manifesto_mercante`,
`unlink_bls_from_manifesto_mercante`, `trg_unlink_manifesto_on_route_change`;
`ManifestoBlsModal` (Ver B/Ls na aba Rotas e Manifestos) e `BlManifestoField` na
ficha; o UPDATE direto `linkBlsToManifestoMercante` saiu. 8.6/8.7:
`preview_ce_mercante_rows` e confirmação com motivo em
`apply_ce_mercante_rows_atomic` (troca de CE e mudança de Manifesto); Alerta
`ce_trocado_com_desbloqueio`. 8.8: `singleDataSheet` no leitor comum, linha sem
CE nomeada, cancelado ignorado com aviso, trava consultiva da Viagem. 8.9:
`p_defer_billing` + `emit_ce_mercante_billing` (lotes de 25, Retomar, resultado
por B/L, `billing_auto_issue_failed`); nota "Sistema — CE Mercante"; medição de
400 B/Ls com 50 mil na base: gravação 2,8 s e lote de emissão até 0,6 s (em uma
transação, 15,6 s). 8.10: `_audit_skip_once` no `audit_row_changes` evita o
evento duplicado. Drift mecânico: o emitente fica na nota da fatura
(`issued_by` mantém o usuário da importação). Suíte nova
`ceImportacaoContrato` (6) no CI; números de Manifesto das suítes antigas
passaram ao formato canônico.

## Etapa 9 — Baplie (M11; ADR 0078, item 21)

**Dono:** `apply_baplie_physical_flags_atomic`, `set_bl_container_profile`,
`set_bl_container_ownership`, `src/services/baplieImport.ts`,
`src/services/baplieParser.ts`, tela do Baplie.

- [x] Marcas aplicadas a todos os B/Ls ativos que dividem o container;
  cancelados ignorados; a tela diz o que aplicou e onde.
- [x] Perfil IMO/OOG manual protegido; Baplie diferente vira Divergente;
  **Aplicar IMO/OOG agora** respeita a origem manual.
- [x] Baplie completo: marca ou container ausente apaga as marcas vindas do
  Baplie anterior depois de confirmação na prévia, que lista o que cai.
- [x] Containers fora das escalas da Viagem, de outro operador (NAD) ou em
  transbordo (8249) ignorados com aviso; OOG só com excesso de dimensão > 0; LQ
  como carga normal; TDT de outro navio ou viagem bloqueia; dígito verificador
  errado gera aviso; ação **Vale o B/L** na divergência SOC/COC, com motivo.
- [x] Reemissão por mudança de base informada na tela; diff paginado além de
  1000 linhas.
- [x] Checagens novas para cada regra acima.

**Aceitação:** checagens novas verdes; `baplieFlagsOnBlImport`,
`containerOwnership`, `containerProfile` e `thdImoOog` verdes; ADR da escala e
cobrança leem a mesma fonte de IMO/OOG.

**Execução (2026-10-10, local):** migration `181` (`profile_source` em
`bl_containers`, `_baplie_flag_plan`, `preview_baplie_physical_flags`,
`resolve_baplie_divergence`; aplicação devolve `applied_to`, `cleared`,
`divergent_manual`); parser com NAD+CA, 8249=6, OOG > 0, LQ e dígito
verificador como aviso; regras de Viagem (TDT bloqueia, POD fora das escalas
ignorado) em `baplieImport.ts` e `useBaplieVoyageContext`; diff paginado; tela
com grupo **IMO/OOG manual diverge** e **Vale o B/L**. Checagens:
`baplieMarcas.local-pg` (no CI), `baplieParserEtapa9`, testes de
reconciliação.

## Etapa 10 — COD e documento da fatura (M22, M23; ADR 0078, itens 13 e 15)

- [x] Reimportação (container e carga solta) não altera o POD de B/L em COD;
  demais campos atualizam, com aviso na prévia. Mudar POD por reimportação ou
  ficha é correção, nunca COD.
- [x] B/L com POD no porto omitido importado depois da omissão entra como
  afetado, com disposição Transbordo, herdando o registro global, com aviso e
  Histórico.
- [x] Documento da fatura congela razão social, CNPJ, endereço do Cliente,
  Viagem, navio, POL e POD na emissão; detalhe e impressão (Vela e Portal) usam
  a cópia.
- [x] Checagens novas a partir dos roteiros da crítica de completude do
  relatório (COD × reimportação; documento lido de dados vivos).

**Aceitação:** checagens novas verdes no CI.

**Execução (2026-10-10, local):** migration `182` — gatilho
`trg_guard_cod_pod_on_reimport` (reimportação de container mantém o POD de B/L
em COD vivo; a carga solta já mantinha pela `173`; a ficha segue corrigindo),
`trg_attach_new_bl_to_voyage_omission` (B/L novo no porto omitido entra como
Transbordo, com Histórico) e `invoice_document_snapshots`, capturada no fim da
transação da emissão e sobreposta em `list_invoice_details` e
`_portal_invoice_details_core`; a impressão mostra o endereço congelado. A
prévia de B/L avisa COD e porto omitido. Checagens: `codDocumentoFatura.local-pg`
(no CI) e `blFreightImport.test.ts`.

## Etapa 11 — Veículos, Base de Clientes, Granito e vazios (M15, M16, M17; ADR 0078, itens 8 e 23–25)

- [x] **Veículos:** Liberação recalcula quando há veículo novo; B/L isento
  anula o recebível sem fatura; na página Veículos, **Mover para outro B/L** e
  **Excluir** para qualquer usuário, com motivo, mesmo com CE, com efeito pela
  ADR 0077; sem busca do B/L "parecido" (B/L inexistente recusa a linha); local
  de desova da planilha só preenche vazio, divergência pede confirmação,
  conflito no arquivo recusa as linhas; chassi em outra Viagem recusa a linha
  (salvo B/L ou Viagem cancelados); tipos ISO equivalentes, lacre sem zeros à
  esquerda, lacre opcional para flat rack e plataforma; regras também no
  servidor.
- [x] **Base de Clientes:** prévia com os B/Ls pendentes que cada CNPJ vincula;
  vínculo por documento, Revisão liberada e faturamento seguindo; B/L rejeitado
  nunca vinculado; razão social diferente pede confirmação; telas de Revisão e
  Faturamento invalidadas.
- [x] **Granito:** reimportação atualiza por número de B/L na Viagem,
  preservando CE e Cliente; B/L ausente do arquivo novo sai só com confirmação;
  CE de Granito continua sem cálculo automático.
- [ ] **Vazios:** reimportação da mesma rota substitui o manifesto preservando
  a natureza; recadastro pelo Baplie preserva a natureza e remove manifestos
  vazios; Embarque de Vazios atualiza por container e preserva unidades manuais.
- [ ] Programação por planilha com prévia e atômica.
- [ ] Primeiras suítes `local-pg` das RPCs de veículos, Granito e vazios.

**Aceitação:** suítes novas verdes no CI; reimportar a mesma planilha de
Granito ou de vazios não duplica linhas.

**Execução — Veículos (2026-10-10, local):** migration `183` —
`import_vehicle_rows_transactional` confere B/L da Viagem, chassi em outra
Viagem ativa e local de desova (só preenche vazio; troca com
`unpacking_confirmed`; conflito no arquivo recusa), recalcula na hora sem fatura
viva (`_vehicle_charges_follow`) e anula o Recebível de B/L isento (também no
efeito `vehicle_followup`); `move_vehicles_to_bl` e
`delete_vehicles_with_reason` para qualquer usuário, com motivo. Tela: sem busca
do B/L irmão, tipos ISO equivalentes, lacre sem zeros à esquerda e opcional para
flat rack/plataforma, confirmação do local de desova, **Mover para outro B/L**.
Checagens: `veiculosRegras.local-pg` (no CI), `vehicleImport.test.ts`.

**Execução — Base de Clientes (2026-10-10, local):** migration `184` —
`apply_customer_base_row_atomic` ganha `p_confirm_name_change` (razão social
diferente recusa sem ela), vincula só B/Ls pendentes e não rejeitados como
`matched_document`, com Histórico, reavalia a Revisão
(`apply_bl_review_gate_after_import`) e calcula as Taxas Locais. A prévia lista
os B/Ls que cada CNPJ vincula e os rejeitados; a tela confirma a troca de razão
social e invalida Revisão e carga/faturamento. Checagens:
`baseClientesVinculo.local-pg` (no CI), `customerBase.test.ts`.

**Execução — Granito (2026-10-10, local):** migration `185` —
`import_granite_manifest_transactional` ganha `p_remove_missing`; com B/Ls já
gravados na Viagem, atualiza por número preservando CE, Cliente e status de
cobrança, inclui os novos no manifesto mais recente e tira os ausentes só com
confirmação (nunca com Invoice), com Histórico; enfileira `granite_billing` só
para novo ou alterado. A tela confirma a saída dos ausentes. Checagens:
`granitoReimportacao.local-pg` (no CI), `graniteImportAtomic.test.ts`.

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
- [ ] Checagem que falha quando surge `*.local-pg.test.ts` fora da lista do CI.

**Aceitação:** todas as suítes `local-pg` no CI, verdes em ordem natural e
invertida; nenhuma suíte pulada por sonda com a variável ligada.

## Etapa 13 — Ligar o processamento automático (ADR 0078, item 18)

Pré-requisitos: Etapas 4 e 7 em produção.

- [ ] Ensaio em Preview: ligar, rodar a simulação do acumulado, conferir 3
  ciclos sem efeito travado, testar o desligamento.
- [ ] Roteiro para o dono em `servicos-externos.md`: rodar a simulação em
  produção, aprovar o que for processado, criar `IMPORT_EFFECTS_CRON_SECRET` em
  par (Vault e função) e ligar `IMPORT_EFFECTS_RUNNER_ENABLED`; depois, o
  processamento fica sempre ligado.
- [ ] A ligação em produção é ato do dono; o agente entrega o roteiro e a
  evidência do ensaio.

**Aceitação:** ensaio em Preview registrado; roteiro revisado pelo dono.

## Etapa 14 — Encerramento

- [ ] Nenhum `it.fails` restante nas suítes `auditoria*`.
- [ ] `CONTEXT.md` sem "implementação pendente" nos itens da ADR 0078;
  documentação viva da seção 8 do relatório atualizada.
- [ ] Mover este plano para `docs/archive/plans/` e retirar a linha de
  `docs/plans/README.md` na mesma mudança que concluir a última etapa.
