# Alterar, excluir e isentar as Taxas Locais do B/L

## Estado

Proposto em 2026-10-28, a partir da
[spec aprovada pelo dono](../spec/2026-10-28-alterar-taxa-calculada-do-bl-design.md)
(decisões D1 a D14). O dono aprovou no mesmo dia os refinamentos R1 e R2 da
regra de descarte (registrados na D5 da spec). Execução em andamento.

| Lote | Situação |
|---|---|
| 1 — Alterar e excluir taxa em B/L sem fatura | Feito (migration `491`). Drift mecânico: os eventos da aba Histórico vão para `audit_logs` com `entity_type = 'charge_calculation'` e `field_name = 'charge_adjustment'`, que `bl_timeline` já lê na família Taxas, em vez de um `entity_type` próprio |
| 2 — Isentar Taxas Locais | Feito (migration `492`). Drift mecânico: o cálculo e a trava das ações viraram invólucros (`_calculate_bl_local_charges_impl_491`, `_lock_bl_for_charge_change_491`) em vez de reescritos; a cobrança manual guarda o valor por unidade durante a isenção e volta como quantidade × unidade (ou o total alterado) |
| 3 — B/L faturado | Feito (migration `493`). Drift mecânico: o efeito é aplicado pelo invólucro de `_record_bl_charge_event` (a ação marca a transação com `vela.bl_charge_change`); no B/L faturado o cálculo só atualiza as linhas gravadas; a cobrança manual excluída que a fatura aponta fica Excluída em vez de apagada; `portal_invoice_details` tira a marca do item. Fica para o lote 6 conferir "Pix no QR antigo" e o Desbloqueio com "Diferença de valor a faturar", que são da correção já existente |
| 4 — Leituras: Validação, fatura, Cliente, Históricos | Feito (migration `494`, uma leitura só para Validação, consolidada, Revisão e ficha do Cliente). Drift mecânico: a marca da fila vem dessa leitura, anexada pelo serviço, e não de uma mudança na RPC da fila; a edição da cobrança manual não grava o nome da taxa no `audit_logs`, então a frase é "Cobrança manual: quantidade 2 → 3" |
| 5 — Eventos: prévias, confirmações e alerta | Feito (migration `495`). Drift mecânico: as prévias não mudaram as RPCs de prévia existentes; a tela chama a simulação genérica `preview_bl_charge_adjustment_impact` com as mudanças que a prévia já conhece. O Baplie pergunta no diálogo depois do **Substituir** (as marcas só são conhecidas ali), e a planilha de CE e a de veículos não mostram a seção: a do CE não muda a base, e a de veículos não tem prévia por B/L; nas duas, o efeito abre o alerta. A audiência ao Financeiro vem do catálogo, que a entrega da `476` já lê. |
| 6 — Fechamento | A fazer |

## Resultado pretendido

Na ficha do B/L, aba **Faturamento**, bloco **Taxas Locais**, qualquer setor
altera o valor de uma taxa (por unidade ou pelo total), exclui uma taxa, isenta
o B/L inteiro e desfaz cada ação, sempre com justificativa e com o **Histórico
das taxas** na própria página. A alteração sobrevive aos recálculos, só se perde
quando o B/L troca de tabela, e em B/L faturado passa pela correção automática
da fatura. O Cliente vê só o valor final. Validação, fatura do Vela, ficha do
Cliente e Históricos mostram a alteração. Eventos que mexem num B/L alterado
avisam pelo tamanho do efeito (prévia, confirmação ou alerta). Detalhe por tela
e mensagens exatas: na spec.

**Fora do escopo** (spec, "Fora do escopo"): Demurrage; virar Condição de
Cliente ou alterar em lote; observação ao Cliente na fatura; cobrança manual
nova em B/L faturado; a cobrança manual que se perde no cancelamento do B/L.

## Fontes de verdade e restrições

- Regra vigente: [Taxas Locais](../modules/taxas-locais.md) e
  [Faturamento](../modules/faturamento.md); decisões em vigor nas ADRs 0038,
  0071, 0077, 0085, 0087, 0088, 0093, 0094 e 0105.
- **Código que manda hoje** (definições vigentes):
  - resolvedor das linhas `resolve_bl_local_charge_items` (migration `470`);
  - cálculo `_calculate_bl_local_charges_impl_106` (`378`), que apaga as linhas
    `auto` no recálculo e recusa B/L faturado;
  - cotação da correção `_quote_bl_local_charges` (`136` → corpo da `129`),
    que soma tabela + cobranças manuais e ignora as linhas automáticas gravadas;
  - correção automática `apply_invoice_basis_changes` (`130` → corpo da `386`),
    que já trata cotação `exempt` (cancela sem reemitir) e B/L pago
    (`_apply_paid_basis_change`);
  - emissão `create_invoice_from_bls_core` (`378`), que copia
    `charge_calculations` para `invoice_items` e o `snapshot_payload`;
  - projeção do Portal `_portal_invoice_details_core` (`068`), que lista os
    campos do item um a um (sem `snapshot_payload`);
  - cobranças manuais: `_add_manual_bl_charge_impl_106` (`385`),
    `update_manual_bl_charge` e `delete_manual_bl_charge` (`241`);
  - Histórico do B/L `bl_timeline` (`470`); Desbloqueio de CE
    `ce_unlock_private.item` (`449`); prévias `bl_file_import_preview` (`392`),
    `preview_breakbulk_billing_changes` (`381`), `preview_ce_mercante_rows`
    (`181`) e `preview_baplie_physical_flags` (`403`).
- **Restrições do repositório** (`AGENTS.md`): migrations existentes e
  `src/types/database.ts` são protegidos. As RPCs novas são chamadas no padrão
  `supabase.rpc('nome' as never, … as never)`, como `set_bl_manual_roe`.
  Migrations novas a partir da `491`. Nenhuma migration deste plano reescreve
  linha existente (se alguma passar a reescrever, o cabeçalho declara o "Data
  status"). Testes de banco só no Postgres local (`sudo
  scripts/setup-local-pg.sh --reset`); suíte nova entra em
  `scripts/local-pg-suites.txt`.
- **Autorização no banco**, nunca só na tela: toda RPC nova é `SECURITY
  DEFINER`, sem `EXECUTE` para `anon`/`PUBLIC`, exige `auth.uid()` com
  `is_active_user()` (usuário interno ativo; o Portal não passa) e chama
  `_assert_actor_is_caller`. As tabelas novas não têm INSERT, UPDATE nem DELETE
  para `authenticated`.

## Decisões do dono no plano (aprovadas em 2026-10-28)

- **R1 — Mudança de modalidade descarta só o que mudou de tabela.** Mudança de
  POD descarta todas as alterações; mudança de modalidade descarta só as da
  tabela que saiu do B/L (o misto que perde a carga solta mantém as de
  container).
- **R2 — Refixar com tabela nova do mesmo escopo remapeia.** A alteração passa
  para a mesma taxa (nome, incidência, perfil e moeda) da tabela nova; sem ela,
  é descartada, e a prévia mostra antes do aceite.

## Desenho

### Dados (lote 1 cria; lotes 2 e 5 acrescentam)

- **`bl_charge_adjustments`** — uma alteração por B/L e taxa, com no máximo uma
  ativa por par (índice único parcial): `bl_id`, `line_key` (a chave da linha:
  `auto:item:<item>`, `auto:item:<item>:imo_oog` ou a chave da cobrança
  manual), `charge_item_id`, `charge_table_id`, `scope`
  (`container`/`carga_solta`), `pod_key` (POD normalizado), assinatura da taxa
  para o R2 (nome, incidência, perfil, moeda), `kind` (`unit`, `total`,
  `excluded`), `currency`, `value`, `reference_quantity`, `justification`,
  `created_by`, `created_at`, `ended_at`, `ended_by`, `end_reason`
  (`restored`, `reincluded`, `discarded`, `remapped`), `end_justification`.
- **`bl_charge_adjustment_events`** — só inclusão; alimenta o **Histórico das
  taxas**: `bl_id`, `event` (`altered`, `excluded`, `restored`, `reincluded`,
  `manual_deleted`, `exempted`, `exemption_removed`, `discarded`,
  `quantity_changed`, `remapped`), `line_key`, `charge_name`, `before`/`after`
  (jsonb), `justification`, `actor` (nulo = Sistema), `created_at`,
  `invoice_effect` (jsonb, lote 3).
- **`bl_local_charge_exemptions`** (lote 2) — isenção à mão por B/L:
  `bl_id`, `justification`, `created_by`, `created_at`, `removed_at`,
  `removed_by`, `removal_justification`; uma ativa por B/L.
- **`bl_charge_adjustment_acks`** (lote 5) — aceite curto da confirmação da
  tela: `bl_id`, `user_id`, `expires_at` (minutos).
- **`charge_calculations`**: colunas `adjustment_id`,
  `table_unit_value_brl/usd`, `table_total_value_brl/usd` (o valor da tabela,
  para a tela) e a situação nova `excluded` no `CHECK`. Linha excluída e linha
  de B/L isento à mão ficam com total zero: toda leitura que soma totais
  continua certa sem mudar.

### Motor (lote 1; isenção no lote 2)

- O corpo atual do resolvedor vira uma função interna; uma função interna nova
  devolve cada linha com o valor da tabela e o valor cobrado (alterações
  ativas e, no lote 2, isenção à mão aplicadas); `resolve_bl_local_charge_items`
  continua com a **mesma assinatura** e passa a devolver o valor cobrado. Com
  isso o cálculo, a cotação da correção, o COD, o Desbloqueio de CE e as
  prévias que simulam o recálculo veem o mesmo valor, sem caminho paralelo.
- Regras de aplicação:
  - **por unidade:** total = quantidade × valor, arredondado no B/L (não por
    container; `ponytail:` o rateio por container só vale para as linhas não
    alteradas);
  - **total:** total = valor; Unitário = total ÷ quantidade, arredondado;
  - **excluída:** situação `excluded`, total zero, Unitário da tabela mantido
    para referência;
  - **linha em revisão ou item desativado:** a alteração fica dormente;
  - **tabela que saiu do B/L:** descarte (R1); tabela nova do mesmo escopo:
    remapeamento ou descarte (R2); evento no histórico.
- **Cobrança manual:** o recálculo já preserva a linha; a alteração grava o
  valor na própria linha, e o valor da tabela nas colunas novas. A cotação já
  soma as manuais.
- **Quantidade de taxa com total alterado que muda** (D7): o cálculo grava o
  evento `quantity_changed`; o alerta entra no lote 5.
- **Recusa da última taxa** (D12): a exclusão que deixaria o B/L sem nenhuma
  linha cobrada é recusada com a mensagem da spec.

### RPCs novas (nomes de trabalho; a assinatura final fica no código)

| RPC | Lote | Faz |
|---|---|---|
| `alter_bl_charge_value(p_bl_id, p_line_key, p_kind, p_value, p_justification, p_actor)` | 1 (faturado no 3) | Grava ou troca a alteração por unidade ou total e recalcula (ou corrige a fatura) |
| `exclude_bl_charge(p_bl_id, p_line_key, p_justification, p_actor)` | 1 (3) | Exclui a taxa calculada |
| `restore_bl_charge(p_bl_id, p_line_key, p_justification, p_actor)` | 1 (3) | **Voltar ao valor da tabela** ou **Incluir taxa de novo** |
| `delete_manual_bl_charge(p_charge_calculation_id, p_justification, p_actor)` | 1 (3) | Nova assinatura: todos os setores, com justificativa; a antiga perde o EXECUTE |
| `list_bl_charge_history(p_bl_id)` | 1 | Linhas do **Histórico das taxas** |
| `list_bl_local_charge_lines` | 1 | Recriada (DROP + CREATE) com marca, valor da tabela, quem, quando e justificativa |
| `set_bl_local_charge_exemption` / `remove_bl_local_charge_exemption(p_bl_id, p_justification, p_actor)` | 2 (3) | Isentar e retirar a isenção |
| `preview_bl_charge_change_effect(p_bl_id, p_change jsonb)` | 3 | Efeito na fatura, simulado numa subtransação desfeita (padrão da `preview_breakbulk_billing_changes`) |
| `list_bl_charge_adjustments(p_bl_ids)` | 5 | Alterações ativas dos B/Ls, para prévias e confirmações |
| `acknowledge_bl_charge_adjustment_changes(p_bl_ids)` | 5 | Registra o aceite da confirmação |

### Cache (lote 1)

Função nova `afterTaxasDoBlAlteradas` em `src/services/cacheEffects.ts`: linhas
e ficha do B/L, lista de B/Ls, Validação (`local-charge-operations`),
pendências, Histórico do B/L (`bl-timeline`), `INVOICE_BASIS_CACHE_KEYS`
(faturas, correção, saldo, Desbloqueio de CE), ficha do Cliente
(`customer-ficha`) e alertas. As três ações de cobrança manual passam a usar a
mesma função. Teste em `src/services/__tests__/cacheEffects.test.ts`.

## Como executar

- **Manual do Operador (pedido do dono, 2026-10-28):** toda mudança deste plano
  fica registrada no trabalho do manual, para o dono não revisitar nada lá. Em
  cada lote: as regras novas ou mudadas entram na matriz de cobertura da área
  (`docs/manual/cobertura/`, com `npm run manual:coverage` passando) e ganham
  uma linha em [atualizações da matriz](../manual/README.md#atualizações-da-matriz)
  (lote, regras tocadas, telas e textos novos). No lote 6, o "Estado" do
  [plano do Manual](2026-10-26-manual-do-operador.md) resume a mudança inteira:
  áreas e capítulos afetados, regras novas e as que mudaram de texto.

- Tudo na branch `claude/blissful-carson-hpjy4j`; um ou mais commits por lote,
  cada lote fechado com os checks dele. A PR contra a `staging` só abre quando
  o dono pedir.
- Em cada lote: migration e RPC com a autorização no banco; tela e invalidação
  de cache; testes de unidade e local-pg que **falham sem a mudança** (rodar
  antes da migration para ver falhar); documentação do lote (módulo, ADR,
  `docs/RASTREABILIDADE.md`, matriz em `docs/manual/cobertura/`,
  `docs/CHANGELOG.md`).
- Checks por lote: `npm run docs:check`, `npm run typecheck`, `npm run lint`,
  `npm test` (focado durante, completo no fim do lote), `npm run build`,
  `npm run migrations:check`, `npm run rpc:check`, `npm run manual:coverage`,
  `npm run localpg:check` e a suíte local-pg do lote. Lote com tela:
  `npm run design:check` e `npm run a11y:contrast`.

## Lote 1 — Alterar e excluir taxa em B/L sem fatura

**Banco (migration `491`).** Tabelas `bl_charge_adjustments` e
`bl_charge_adjustment_events`; colunas novas e situação `excluded` em
`charge_calculations`; resolvedor e cálculo como em "Motor", com o descarte do
R1/R2; RPCs `alter_bl_charge_value`, `exclude_bl_charge`, `restore_bl_charge`,
a nova `delete_manual_bl_charge`, `list_bl_charge_history` e
`list_bl_local_charge_lines` recriada. Nesta etapa as RPCs recusam B/L
faturado com "B/L faturado: a alteração na fatura entra no lote seguinte" (a
recusa some no lote 3). `bl_timeline` lê os eventos novos (família Taxas).
Registro semântico em `audit_logs` (`entity_type` próprio, com `bl_id`).

**Tela.** Bloco **Taxas Locais** (`src/components/bl/BlCobrancasTab.tsx` e
`chargeTableColumns.ts`): marcas **Alterada** e **Excluída**, ações por linha,
modal **Alterar valor — <taxa>** (componente novo em `src/components/bl/`),
confirmações com justificativa (`useConfirmWithReason`), bloco **Histórico das
taxas**; falhas com o motivo do banco (acaba o "Falha ao salvar linha manual de
taxa." genérico). Serviço em `src/services/charges/chargeOperationsService.ts`,
hooks em `src/hooks/useLocalCharges.ts`, frases do histórico em
`src/components/bl/blTimelinePresentation.ts`.

**Testes.**
- Local-pg `taxaAlteradaNoBl.local-pg.test.ts`:
  - permissão por setor e recusas;
  - alteração por unidade e por total;
  - exclusão, voltar e incluir de novo;
  - recusa da última taxa;
  - cada linha da tabela da D5 (CE, Recalcular, container novo, troca de Cliente, correção de item pelo Administrativo, refixar, POD, modalidade);
  - total mantido com quantidade nova (D7);
  - linha IMO/OOG independente;
  - container compartilhado só na parte deste B/L;
  - taxa em dólar;
  - alteração dormente com item desativado;
  - B/L cancelado e reativado;
  - cobrança manual alterada e excluída por setor não Administrativo;
  - histórico com os eventos.
- Unidade:
  - comportamento do bloco (marcas, ações, modal, linha viva, confirmações);
  - serviço;
  - `cacheEffects`;
  - frases do histórico.

**Docs.**
- ADR **0111** (D1 a D7, D10, D11, D13, D14) e o índice de ADRs.
- [Taxas Locais](../modules/taxas-locais.md): superfícies, catálogo de ações, invalidações, invariantes.
- [Segurança](../operations/seguranca.md): matriz de permissões.
- `CONTEXT.md` (Taxa alterada à mão).
- `docs/RASTREABILIDADE.md`, matriz `09a-taxas-locais.md` e `CHANGELOG`.

**Aceite.**
- Num B/L sem fatura, qualquer setor altera a THD para R$ 1.200 por container, com justificativa.
- A linha mostra **Alterada** e o histórico registra.
- Gravar o CE mantém o valor.
- Um container novo dá 3 × R$ 1.200.
- Trocar o POD descarta a alteração e registra "Alteração descartada pelo sistema…".

## Lote 2 — Isentar Taxas Locais

**Banco (`492`).**
- Tabela `bl_local_charge_exemptions` e RPCs de isentar e retirar a isenção.
- O cálculo põe o B/L em **Isento**, com "Isenção manual: <justificativa>", e as linhas ficam Isentas com total zero e o valor da tabela.
- A cotação devolve `exempt`.
- A emissão pelo CE responde "Nada a faturar: B/L isento das Taxas Locais."
- O Desbloqueio de CE considera o requisito atendido, pela regra do isento que já existe.
- A isenção sobrevive a todo recálculo.
- Retirar a isenção recalcula com as alterações e exclusões que o B/L tinha.
- A isenção pelo veículo LCL continua independente.

**Tela.**
- Botões **Isentar Taxas Locais** e **Retirar isenção**.
- Fato **Isenção** com autor e data.
- Linhas em cinza.
- Ações por linha escondidas no B/L isento à mão, com a recusa "B/L isento das Taxas Locais: retire a isenção…" no banco.
- Histórico.
- Validação com **Isento** (fora da fila padrão).

**Testes.**
- Local-pg `isencaoManualTaxasLocais.local-pg.test.ts`:
  - isentar e retirar, por setor;
  - "Nada a faturar" no CE;
  - Validação;
  - Desbloqueio de CE;
  - isenção mantida na troca de POD;
  - convivência com a isenção LCL.
- Unidade: o bloco e a Validação.

**Docs.**
- ADR 0111 acrescenta a D12.
- Taxas Locais (Movimento e Isenção).
- Desbloqueio de CE.
- `CONTEXT.md` (Isenção à mão).
- Matrizes `09a` e `08-desbloqueio-ce.md`.
- `CHANGELOG`.

**Aceite.**
- **Isentar Taxas Locais** tira o B/L da fila da Validação e libera o Desbloqueio de CE.
- O CE não emite fatura.
- **Retirar isenção** devolve as taxas com as alterações que o B/L tinha.

## Lote 3 — B/L faturado

**Banco (`493`).**
- As RPCs dos lotes 1 e 2 aceitam B/L faturado. O cálculo continua recusando B/L faturado; a RPC:
  - aplica a alteração às linhas gravadas daquela taxa;
  - chama `apply_invoice_basis_changes` com a origem nova `charge_adjustment` ("Alteração das taxas do B/L pelo operador");
  - grava em `invoice_effect` do evento o que a correção fez: reemissão, abatimento e Restituição, Fatura desatualizada, ou pendência.
- `preview_bl_charge_change_effect` devolve o efeito antes de gravar, para a confirmação.
- Um gatilho em `invoice_items` copia a marca de alteração para o `snapshot_payload` do item. A projeção do Portal continua sem ela.
- Isentar com fatura:
  - sem pagamento, cancela sem sucessora;
  - com pagamento, Restituição de todo o recebido.

**Tela.**
- Confirmações com o efeito de cada situação (textos da spec), lidas da prévia do servidor.
- Frase do B/L faturado nova.
- Coluna **Efeito na fatura** no histórico.
- Detalhe da fatura com **Origem** **Alterado** (`src/components/billing/InvoiceDetailModal.tsx`, `src/services/billing.ts`).
- Os itens de consolidada reconstruídos passam a respeitar a origem.

**Testes.**
- Local-pg `taxaAlteradaFaturada.local-pg.test.ts`:
  - sem pagamento: reemissão com número novo, aviso "Nova fatura emitida" e consolidada recriada;
  - paga com valor menor: abatimento e Restituição;
  - paga com valor maior: Fatura desatualizada e Desbloqueio de CE com "Diferença de valor a faturar";
  - reemissão travada pelo Portal e por terminais;
  - isenção com e sem pagamento;
  - Pix no QR antigo;
  - Portal sem a marca no dado da fatura;
  - prévia igual ao efeito real.
- Unidade: confirmações e detalhe da fatura.

**Docs.**
- ADR 0111 acrescenta D8 e D9.
- Faixas "Situação atual" nas ADRs [0077](../adr/0077-fatura-emitida-nao-muda-de-valor.md), [0071](../adr/0071-ce-mercante-como-trava-de-exclusao.md) (item 11) e [0085](../adr/0085-modelo-de-permissoes-por-perfil.md) (linha "Excluir taxa manual do B/L").
- [Faturamento](../modules/faturamento.md) (Correção após emissão).
- [Portal do Cliente](../modules/portal-cliente.md).
- [Manual financeiro](../operations/manual-financeiro.md).
- `CONTEXT.md` (Correção de B/L após faturamento).
- Matrizes `09b-faturamento.md`, `10-recebimento.md` e `07-portal.md`.
- `CHANGELOG`.

**Aceite.**
- Num B/L com fatura sem pagamento, alterar a THD reemite a fatura com número novo, e o Portal mostra só o valor novo.
- Na fatura paga, reduzir gera Restituição pendente; aumentar abre Fatura desatualizada.

## Lote 4 — Leituras: Validação, fatura, Cliente e Históricos

**Banco (`494`, se preciso).**
- A leitura da fila operacional traz a marca de alteração por B/L.
- A ficha do Cliente lê os B/Ls com taxa alterada.

**Tela.**
- **Validação:**
  - **Conferência do cálculo** com **alterada** e **excluída** (`conferenciaCalculo.ts`, `ConferenciaCalculo.tsx`);
  - filtro **Com taxa alterada à mão** (`ValidacaoControls.tsx`, `faturasListState`/estado da Validação);
  - coluna **Taxas alteradas à mão** no Exportar (`src/services/exports.ts`, `fetchChargeTotalsByBl`);
  - Subtotal sem linha excluída;
  - avisos em **Recalcular**, **Recalcular selecionados** e **Emitir**.
- Avisos em **Emitir fatura** e na fatura consolidada.
- **Ficha do Cliente › Financeiro**, lista **B/Ls com taxa alterada** (`FinanceiroTab.tsx`, `customerFicha.ts`).
- **Histórico de ações** (`src/components/admin/auditLogPresentation.ts`).
- Edição de cobrança manual legível na aba Histórico.
- Correções de passagem:
  - o aviso "As taxas mudaram depois da emissão" compara só a parte do B/L na consolidada;
  - o **Recalcular** da Revisão atualiza a ficha (`src/pages/Revisao.tsx`).

**Testes.** Unidade:
- `conferenciaCalculo`, `exports`, `validacaoPipeline`/`ValidacaoOperationsTable`;
- ficha do Cliente;
- `auditLogPresentation`, `blTimelinePresentation`;
- aviso da consolidada;
- cache da Revisão.

Local-pg só se a leitura do banco mudar.

**Docs.**
- [Taxas Locais](../modules/taxas-locais.md) e [Faturamento](../modules/faturamento.md) (Validação).
- [Clientes](../modules/clientes.md).
- `docs/RASTREABILIDADE.md`.
- Matrizes `09a`, `09b` e `06-clientes-comunicacao.md`.
- `CHANGELOG`.

**Aceite.**
- O filtro da Validação acha o B/L alterado.
- A planilha traz a coluna nova.
- A fatura no Vela mostra **Alterado**.
- A ficha do Cliente lista o B/L.

## Lote 5 — Eventos: prévias, confirmações e alerta

**Banco (`495`).**
- **Função de simulação.** Aplica numa subtransação desfeita uma mudança de base: POD, modalidade, peso, containers e marcas, veículos. Devolve, por alteração: mantida, quantidade muda (antes → depois), total mantido com quantidade nova, ou descartada.
- **Prévias.** As que já simulam (`bl_file_import_preview`, `preview_breakbulk_billing_changes`) passam a devolver a seção. A do CE lista as alterações como mantidas. A do Baplie e a dos veículos usam a simulação.
- **Aceite.** `bl_charge_adjustment_acks` e a RPC de aceite.
- **Alerta.** O cálculo abre o tipo novo **Taxa alterada à mão mudou** quando descarta, ou muda a quantidade de taxa com total alterado, sem aceite do usuário da sessão para o B/L. Dados do tipo:
  - Normal;
  - setor responsável Administrativo, avisa também o Financeiro;
  - um item por B/L;
  - fecha com **Resolver com justificativa**.
  
  Entra no catálogo `alert_type_catalog`, na audiência de entrega da migration `476` e no resumo.

**Tela.**
- Seção **Taxas alteradas à mão** nas prévias de arquivo de B/L, Manifesto BB, planilha de CE, Baplie e planilha de veículos.
- Diálogo **Taxas alteradas à mão serão afetadas** (**Gravar mesmo assim**). Aparece na prévia e nas gravações da ficha que mudam POD, modalidade, containers, veículos ou peso, na correção de container, no COD e em Veículos (mover, excluir).
- Tipo no `src/services/alertRulesCatalog.ts`.

**Testes.**
- Local-pg `taxaAlteradaEventos.local-pg.test.ts`:
  - simulação igual ao efeito real;
  - prévia do arquivo de B/L e do Manifesto BB com a seção;
  - alerta sem aceite e sem alerta com aceite;
  - alerta pela fila de efeitos (sem usuário);
  - **Resolver com justificativa**.
- Unidade: seções das prévias e diálogo de confirmação nas telas listadas.

**Docs.**
- ADR 0111 acrescenta a D6.
- [Operação e Suporte](../modules/operacao-suporte.md) (alerta).
- [Manifestos & EDI](../modules/manifesto-edi.md) (prévias).
- [Viagens](../modules/viagens.md) (COD).
- Matrizes `12-alertas-rotinas.md`, `03-bl-revisao.md`, `04-ce-baplie.md`, `05-equipamentos.md` e `02-viagens-adr.md`.
- `CHANGELOG`.

**Aceite.**
- A prévia do arquivo de B/L que muda o POD de um B/L alterado mostra "alteração descartada" e pede **Gravar mesmo assim**.
- A mesma mudança pela fila de efeitos abre o alerta para o Administrativo e o Financeiro.

## Lote 6 — Fechamento

- Passada final da documentação contra o código. A ADR 0111 vai a "aceito, implementada".
- `npm run test:local-pg` completo num banco recriado (`sudo scripts/setup-local-pg.sh --reset`).
- Todos os checks do `AGENTS.md`, inclusive `design:check` e `a11y:contrast`.
- Este plano vai para `docs/archive/plans/` e a spec para `docs/archive/specs/`, com os índices.
- No [plano do Manual do Operador](2026-10-26-manual-do-operador.md), o "Estado" registra que esta mudança entrou e quais áreas do manual mudaram.
- Revisão independente com a skill `vela-code-review` e correção do que ela apontar.
- Perguntar ao dono antes de abrir a PR contra a `staging`.

## Riscos e reversão

- **Função central.** O resolvedor é lido por cálculo, correção, COD, prévias e Desbloqueio de CE. Mitigação: mesma assinatura e resultado idêntico sem alteração ativa. Um teste local-pg compara, num B/L sem alteração, o resultado antes e depois.
- **Dinheiro em fatura paga.** O caminho é o da correção que já existe. A prévia do efeito é a mesma correção, desfeita na subtransação, e o teste compara a prévia com o efeito real.
- **Portal.** A marca não pode sair do banco. Há teste no dado de `portal_invoice_details`.
- **Rateio.** A alteração por unidade arredonda no B/L, não por container (`ponytail:` no código). O total do grupo deixa de fechar o valor cheio do container quando um irmão está alterado, de propósito.
- **Reversão.** As migrations novas só acrescentam: tabelas, colunas e funções novas, e funções recriadas com o mesmo resultado sem alteração ativa. Reverter é recriar as funções vigentes antes da `491` e deixar as tabelas novas sem uso. Não há dado de cliente a migrar.
- **Fica para staging:**
  - uma reemissão real com o Pix do Itaú;
  - a Restituição confirmada pelo Financeiro;
  - o aviso "Nova fatura emitida" chegando ao Cliente;
  - a prévia do arquivo de B/L com um B/L alterado;
  - o alerta no sino dos dois setores.
