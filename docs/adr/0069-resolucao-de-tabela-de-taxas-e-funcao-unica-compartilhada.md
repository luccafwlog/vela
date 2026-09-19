# 0069 — A resolução da Tabela de Taxas Locais é uma função única compartilhada

> **Implementação conferida em 2026-09-18 (Código):** 056 unifica resolução e motor; 059 cobre lançamento/catálogo manual; 062 refina quantidades BB e mensagens de pendência.

Status: aceito — 2026-09-17

Estende a [ADR 0040](./0040-vigencia-da-tabela-de-taxas-e-informativa.md) quanto
ao critério de resolução da Tabela de Taxas Locais, e a
[ADR 0038](./0038-taxa-local-valor-congelado-ancorado-na-escala.md) quanto ao
escopo da tabela. Não altera o congelamento do valor na emissão (decisão 2 da
0038) nem o gatilho de confirmação pelo CE Mercante (0020/0042).

## Contexto

A [spec de unificação de B/Ls](../archive/specs/2026-09-16-unificacao-bls-carga-mista-design.md)
institui a modalidade `cargo_mode = 'misto'`: um mesmo conhecimento de embarque
com contêineres e carga solta. A Tabela de Taxas Locais é cadastrada por escopo
(POD, armador, condição de cliente) **e por modalidade de carga** —
`charge_tables_cargo_mode_check` admite `container`, `carga_solta` e `granito`.

O B/L misto não tem uma modalidade. Tem as duas.

### A resolução por igualdade estrita está espalhada

A pergunta *"qual a Tabela de Taxas Locais deste B/L?"* é respondida hoje por
igualdade estrita de modalidade em **seis** lugares, sem função compartilhada:

| Ponto | Onde |
|---|---|
| Motor, função interna | `resolve_bl_local_charge_items` (`002:17274`) |
| Motor, função externa | `calculate_bl_local_charges` (`002:3020`) |
| Gate de faturamento | `mark_bl_ready_for_billing` (`002:10833`, `047:164`) |
| Cobrança manual (lançamento) | `add_manual_bl_charge` (`002:1032`) |
| Cobrança manual (catálogo) | `list_manual_charge_items_for_bl` (`002:10546`) |
| Rateio exibido na tela | `chargeOperationsService.ts:700` |

A duplicação já custou. Três dos quatro defeitos que a spec descreve no motor
existem em **duas cópias**, porque `calculate_bl_local_charges` não delega a
`resolve_bl_local_charge_items`: repete a lógica antes de iterar os itens. Um
teste que exercite só a função interna passa verde com a externa zerando as
quantidades.

### O gate torna o B/L misto inalcançável

`mark_bl_ready_for_billing` procura a tabela por `AND cargo_mode =
v_bl.cargo_mode`. Para `'misto'` não encontra nada e **levanta `P0004`**. O B/L
misto teria as taxas calculadas corretamente e nunca seria liberado para
faturamento. Pelo mesmo mecanismo, `list_manual_charge_items_for_bl` devolveria
catálogo vazio e `add_manual_bl_charge` recusaria o lançamento manual.

Corrigir o motor sem corrigir o gate produz uma spec cujo estado final é
inalcançável — e a spec repete, em várias seções, que as pendências "bloqueiam
`ready_for_billing`", estado que o B/L misto não atingiria de todo modo.

## Decisão

**1. `charge_tables` não ganha a modalidade `'misto'`.**
`charge_tables_cargo_mode_check` permanece em `container|carga_solta|granito`.
Não existe tabela de preços de carga mista.

**2. A resolução vira uma função única, consumida por todos.** A pergunta deixa
de ser *"qual a tabela desta modalidade?"* e passa a ser **"quais tabelas valem
para este B/L, neste POD, nesta data?"**. A função devolve **uma** tabela para
B/L de modalidade única e **duas** — a de contêiner e a de carga solta do mesmo
escopo — para o B/L misto. O contrato é uma lista, não um registro.

**3. Todos os seis consumidores passam a usá-la**, incluindo o gate de
faturamento e as duas funções de cobrança manual. A escolha entre unificar as
duas cópias do motor e corrigir as duas separadamente fica resolvida em favor
de **unificar**: duas cópias é como o defeito nasceu.

**4. A taxa documental incide exatamente uma vez**, vinda da tabela de
contêiner, suprimida na de carga solta **por `application_basis = 'bl'`** —
nunca por nome do item, que é dado de cadastro e varia por porto. A unicidade
física não protege isso: `calculation_key` é `'auto:item:<charge_item_id>'` com
`ON CONFLICT (bl_id, calculation_key)`, e duas taxas documentais de tabelas
distintas têm `charge_item_id` distintos, logo gravam sem colidir.

**5. Resolução parcial é pendência, nunca silêncio.** Resolver duas tabelas
cria um estado que hoje não existe — uma presente, a outra ausente:

| Tabelas do escopo | Comportamento |
|---|---|
| Ambas presentes | Calcula, unindo os itens |
| Apenas uma presente | Calcula a parte coberta **e** emite `review:missing_charge_table:<cargo_mode>`, bloqueando `ready_for_billing` |
| Nenhuma presente | Mantém `review:no_table` |

**6. O ramo silencioso é eliminado.** Hoje o mesmo `NULL` produz resultados
diferentes conforme o ponto de entrada: `calculate_bl_local_charges` grava
`review:no_table` com `status = 'review_required'` (`002:3022`), enquanto
`resolve_bl_local_charge_items` faz `RETURN;` sem registrar nada (`002:17276`).
A função única uniformiza no comportamento que pendencia. **Esta é a única
parte desta decisão que corrige defeito vigente**, independente de carga mista:
é pela função silenciosa que passa a prévia de reprecificação do COD.

### Por que não criar a tabela `'misto'`

A alternativa examinada era admitir `'misto'` em `charge_tables` e cadastrar uma
terceira tabela por escopo. Rejeitada por dois motivos:

- **Move um problema técnico para a operação.** O preço de movimentação de um
  contêiner não muda porque a carga veio no mesmo documento que uma máquina
  solta. Cadastrar de novo é trabalho novo e permanente para o comercial.
- **Cria divergência silenciosa.** Reajustar a THD na tabela de contêiner e
  esquecer a tabela `'misto'` produz dois preços válidos para o mesmo serviço,
  sem nada que acuse. É a mesma classe de falha que esta decisão existe para
  encerrar, acrescentando uma **sétima** cópia da regra em vez de remover seis.

O custo aceito é de implementação: três funções entram no escopo da entrega que
a spec não listava como trabalho — o gate e as duas de cobrança manual.

## Consequências

- A resolução de tabela passa a ter **uma** implementação em SQL, consumida
  pelo motor (as duas funções), pelo gate de faturamento e pelas duas funções
  de cobrança manual. Replicá-la em qualquer consumidor novo é o que esta
  decisão existe para impedir — mesma convenção da ADR 0068 para terminal e da
  0067 para `cargo_mode → modalidade`.
- `chargeOperationsService.ts:700` calcula na tela o mesmo rateio `1/n` que o
  motor calcula no banco, hoje por uma terceira cópia da regra. Com B/L misto
  no sistema as duas divergiriam — tela mostrando um valor e fatura outro — e a
  cópia da tela passa a seguir o mesmo critério, presa por teste à tabela de
  casos do lado SQL.
- `mark_bl_ready_for_billing` deixa de levantar `P0004` para o B/L misto, e o
  fluxo descrito pela spec passa a ter estado final alcançável.
- Nasce a pendência `review:missing_charge_table:<cargo_mode>`, que bloqueia
  `ready_for_billing`. A parte coberta é calculada; a descoberta nunca passa em
  silêncio.
- O COD herda o comportamento **integralmente**, e não só na prévia:
  `apply_cod_financial_effect` chama `resolve_bl_local_charge_items`
  (`002:1894`, `002:1909`), mas o caminho que grava passa por
  `calculate_bl_local_charges`. Com a resolução unificada, a reprecificação no
  destino final cai na mesma regra de resolução parcial, sem tratamento próprio.
- A premissa da ADR 0068 permanece: terminal **não** participa da chave de
  `charge_tables` e a exceção de terminal não reprecifica.
- O `CONTEXT.md` ganha o verbete correspondente **na entrega que implementar
  esta decisão**, não antes.
- Sem operação real, não há backfill nem recálculo de faturas emitidas.
- Fica **fora** desta decisão: unificar o cadastro de itens entre as tabelas de
  contêiner e de carga solta. As duas continuam tabelas independentes, com
  itens próprios; o que se unifica é quem pergunta por elas.
