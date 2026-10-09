# Revisão das importações e do CE Mercante — 2026-10-09

> **Nota editorial — 2026-10-09.** As decisões da seção 6 foram tomadas pelo
> dono no mesmo dia e registradas na
> [ADR 0078](../../adr/0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md),
> exceto a D-11, que segue pendente no plano. Na rodada surgiu a D-23 (Invoice de
> Demurrage única para B/Ls do mesmo Cliente que dividem container). O dono
> também esclareceu que Clientes diferentes não dividem container FCL; por isso
> o cenário 2 da checagem de M03 (Clientes diferentes) foi retirado, e as
> checagens novas somam 43 `it.fails`. O texto abaixo preserva o estado da
> revisão.

## Escopo e conclusão

Revisão do fluxo de importação de arquivos e cadastro de informações do Vela no
checkout `fa5f238`, com prioridade para a planilha de CE Mercante. Cobre a
leitura dos arquivos, a identificação e a normalização dos campos, a
correspondência com registros existentes, a gravação, os vínculos e os efeitos
nas telas, no faturamento, nos documentos, nos comunicados e no Portal Fwlog.
Abrange: planilha de CE Mercante (carga e Granito), Importar B/L (planilha,
PDF e DOCX de container), Manifesto BB e B/L avulso de carga solta, Baplie EDI,
planilha de veículos, datas de descarga e devolução, vazios de importação,
Embarque de Vazios, manifesto de Granito, Base de Clientes, programação de
navios, extrato PIX, edições manuais na ficha do B/L, COD, cancelamento e
reativação de B/L, Revisão e a fila de efeitos pós-importação.

**Conclusão.** A hipótese de que o CE Mercante é o fluxo de maior impacto se
confirma **pelo alcance** e não **pela fragilidade da própria planilha**:

- O valor de `bls.ce_mercante` tem 14 consumidores. A transição vazio →
  preenchido calcula as Taxas Locais do dia do CE, emite a fatura e o recebível
  na mesma transação, libera o B/L no Portal, trava a exclusão, aprova a Escala
  e destrava o Comunicado de CE e Taxas e o Desbloqueio de CE. Com o
  `import-effects-runner` pausado, é hoje a única via que cria fatura sem
  clique.
- A planilha de CE é das portas mais protegidas: tudo ou nada, travas em
  ordem, rota única, viagem conferida e reimportação idempotente.
- O risco ao CE vem de **outras portas** que gravam o mesmo campo sem as
  regras da planilha (ficha do B/L, Manifesto BB, API), da **unicidade não
  imposta** e da **sobrescrita silenciosa**. O dano mais grave ao próprio CE
  vem da reimportação de carga solta, que o apaga.
- Os fluxos que hoje **destroem dado válido ou cobram errado** são outros: a
  reimportação de B/L (container e carga solta), a leitura de datas em XLSX
  (dia e mês trocados, com efeito em Demurrage) e o container compartilhado
  (só o primeiro B/L é faturado). A fila de efeitos acumulada é um risco
  latente que dispara no dia em que o runner for ligado.

A revisão confirmou cerca de 200 achados individuais, agrupados em 25
problemas-raiz (seção 5). Para os defeitos cujo comportamento correto já está
decidido por regra existente, esta revisão deixou **44 checagens executáveis**
(`it.fails`) que reproduzem cada defeito e passam a exigir o comportamento
correto quando a correção entrar (seção 7.3). Nenhuma correção de produto ou
migration foi feita: o plano está em
[2026-10-09 — Correção das importações e do CE Mercante](../../plans/2026-10-09-correcao-importacoes-ce-mercante.md).

## Método e limites

Rótulos conforme [CONVENCOES.md](../../CONVENCOES.md#labels-de-evidência).

- **Runtime (banco local):** PostgreSQL 16.15 descartável, replay das 168
  migrations por `scripts/setup-local-pg.sh` (shims Supabase; sem PostgREST,
  Edge Functions, `pg_cron`/`pg_net` reais ou Vault). Usuários internos ativos
  simulados por claims, com `SET ROLE authenticated` para exercitar grants e
  RLS. O worker da fila foi simulado com `claim_import_effects` e
  `process_import_effect` como `service_role`. Cada investigador usou um banco
  clonado exclusivo.
- **Runtime (parsers):** os parsers reais (`readSheet`, CE, datas, veículos,
  Baplie, B/L, Manifesto BB, PIX, programação) rodaram com arquivos forjados
  (XLSX com `numFmtId` reais, CSV, EDIFACT, PDF/DOCX do repositório).
- **Teste:** as suítes existentes relacionadas e as 7 suítes novas desta
  revisão (seção 7). Componentes React exercitados em jsdom com Supabase
  simulado.
- **Código:** definições **efetivas** das 927 funções e gatilhos extraídas do
  banco replicado (não versões intermediárias das migrations).
- **Organização:** 11 frentes de investigação, cada uma seguida de um
  verificador independente que tentou reproduzir e refutar cada achado em
  outro banco; depois, para os problemas-raiz principais, um agente tentou
  refutar e desenhou a correção, e um revisor independente reexecutou e
  endureceu cada checagem (mutações de fixture, motivo da falha, limpeza);
  por fim, um crítico de completude procurou áreas não cobertas.

**Não verificado** (seção 9): produção e Preview (nenhum acesso remoto foi
feito, por regra), PostgREST real e o `statement_timeout` efetivo do papel
`authenticated` (8 s é o valor citado no código, não medido), Edge Functions,
envio de e-mail, navegador real e arquivos reais dos operadores e armadores
(todos os arquivos foram sintéticos). A linha "Data status" do
[AGENTS.md](../../../AGENTS.md) afirma que produção só tem dados de teste: os
defeitos descritos ainda não produziram dano real conhecido, e passam a
produzir no dia em que dados reais entrarem.

## 1. Respostas diretas

**Podemos perder ou sobrescrever silenciosamente uma informação válida?** Sim.
O CE é apagado pela reimportação de carga solta (M01) e trocado pela planilha
sem aviso (M07). A reimportação de B/L de container apaga descarga, devolução,
status de Demurrage, local de desova e SOC/COC manual (M02). Uma devolução em
branco na planilha de datas apaga a devolução gravada (M10). A correção manual
de IMO/OOG é desfeita pelo Baplie e pela reimportação do B/L (M11). O Cliente
confirmado na Revisão é desfeito pelo Manifesto BB (M01). A natureza dos vazios
é apagada pelo recadastro do Baplie (M17). Todos observados em Runtime.

**Podemos criar registros duplicados?** Sim para B/Ls de Granito e vazios
reimportados (M17), manifestos Mercante com caixa ou separador diferente
(M13), Viagens pela programação por planilha, B/L com número em caixa
diferente, efeitos na fila (M04) e o mesmo CE em vários B/Ls (M06). Clientes
não: a importação nunca cria Cliente e o CNPJ é único. Veículos não na mesma
Viagem (índice único), mas o mesmo chassi é aceito em Viagens diferentes.

**Podemos vincular uma informação à entidade errada?** Sim. O e-mail do novo
consignatário vira contato do Cliente antigo (M14). O Manifesto BB troca o
Cliente sem aceite e move B/L de outra Viagem (M01). A heurística `…00` grava
veículo em outro B/L sem aviso. O mesmo CE fica em dois B/Ls e a conciliação
ZPT marca os dois como desbloqueados (M06). A Base de Clientes vincula B/L que
o operador rejeitou (M16). Um B/L continua no Manifesto Mercante da rota
antiga depois de mudar de POD ou Viagem (M13). A data trocada (M05) fica no
container certo, mas com o dia errado.

**O resultado final depende da ordem de importação?** Sim, em quatro pontos
estruturais: container compartilhado (a primeira linha da planilha é a
faturada, M03), Base de Clientes antes ou depois do B/L (M16), Baplie × Part
Lot ou B/L cancelado (M11) e Manifesto Mercante (o primeiro número digitado
prende o B/L, M13). Entre as portas do CE, vence a última escrita (planilha,
ficha, BB). A fila pausada faz intenções antigas agirem sobre dados posteriores
(M04). Não dependem da ordem: CE antes do B/L (recusado inteiro) e CE → COD →
nova planilha (seção 4).

**O CE Mercante pode modificar dados já usados em processos posteriores? Como
o sistema trata?** Pode. A planilha troca o CE de B/L já faturado, comunicado
ou desbloqueado sem prévia de antes → depois e sem aviso (M07). A fatura
emitida não muda (correto: o gatilho só dispara na transição vazio →
preenchido), o Comunicado já enviado fica com o CE antigo, o Portal passa a
mostrar o novo e o Desbloqueio de CE perde a conciliação ZPT (proteção
correta). Para B/L retido sem Portal, o efeito da sobrescrita recalcula pela
tabela do dia do worker, quebrando as taxas do dia do CE (M04). Apagar o CE só
é impedido quando há fatura emitida.

**Uma correção manual pode ser desfeita por uma importação?** Sim: CE (planilha
e Manifesto BB), Cliente reconciliado (Manifesto BB), perfil IMO/OOG (Baplie e
reimportação do B/L), SOC/COC manual (reimportação do B/L sem declaração),
datas e desova (reimportação do B/L), desova manual (planilha de veículos). A
justificativa digitada na ficha do B/L nem é gravada (M07), então a correção
manual não deixa rastro do motivo.

**O sistema distingue informação ausente de explicitamente removida?** Não, na
maioria dos caminhos: o Manifesto BB sem CE apaga o CE; a devolução vazia apaga
a devolução; a aba VIN ausente apaga veículos (com override); Laden on Board
ilegível ou vazio apaga a data e move o ATD do POL; o Baplie sem EQD 8077 apaga
o SOC anterior do Baplie. Em sentido oposto, o container ausente do novo Baplie
mantém flags antigas. A planilha de CE trata célula vazia como erro (seguro,
mas bloqueia o lote).

**As datas preservam seu significado e sua consistência?** Não. XLSX com data
curta do Excel troca dia e mês (dia ≤ 12) e recusa sem explicar o resto (M05);
CSV é convertido pelo SheetJS antes do parser; hora a partir das 21h em
Brasília vira o dia seguinte; ano `126` vira 2126. A ATA da Escala não chega à
descarga, e a reimportação do B/L volta a descarga à ATA legada em UTC (M10).
`demurrage_status` tem três semânticas e nada marca `overdue` para container
fora. A Demurrage emitida não é revista quando as datas são corrigidas, e o
job de PTAX e a Régua continuam sobre o valor antigo (M21).

**Uma importação pode parecer bem-sucedida e deixar relações incompletas?**
Sim: o segundo B/L do container compartilhado fica sem fatura com o toast
"CE Mercante atualizado em 2 B/L(s)" (M03); o Baplie diz "aplicados" sem
aplicar ao Part Lot (M11); VINs descartados não aparecem; o B/L de carga solta
fica no Manifesto Mercante sem CE (M01); efeitos ficam pendentes sem tela
(M04/M09); a Base de Clientes diz "vinculado" e deixa `missing_customer` (M16).

**Os erros esclarecem o que foi gravado, o que falhou e como resolver?** Não.
Há "Linha 0", `23503 … demurrage_invoice_items_container_id_fkey`,
`deadlock detected`, "Corrija o número" para quem não enviou CE, "Reative para
corrigir" induzindo a reativar B/L cancelado, "autorize Windows-1252" sem
caminho na tela, "Lote gravado em parte" quando nada foi gravado, e "Falha ao
importar" genérico que esconde a causa porque o erro do PostgREST não é
`instanceof Error` (M09).

**Os testes verificam as relações entre importações e suas consequências?**
Antes desta revisão, não: 12 suítes Postgres reais ficavam fora do CI
(inclusive a única que prova CE → fatura), 251 de 339 referências a migrations
em testes apontam para arquivos arquivados, e o teste de que a carga solta
preserva o CE passava lendo uma migration morta enquanto o banco apaga o CE.
Esta revisão acrescenta 44 checagens de relação e reimportação (seção 7).

**Até onde um erro no CE pode se propagar?** Um CE errado (ou o CE certo no
B/L errado) emite fatura em nome de quem importou, cria recebível, expõe o B/L,
suas faturas e sua Demurrage no Portal, entra no Comunicado de CE e Taxas,
aprova a Escala, trava a exclusão e faz a conciliação ZPT marcar o B/L como
desbloqueado. Não altera fatura já emitida nem valores de Demurrage.

## 2. Mapa dos fluxos e dependências

### 2.1 Portas de entrada

Cada linha é uma porta que grava dados de Viagem, B/L, container, veículo ou
Cliente. "Síncrono" acontece na mesma transação; "fila" depende do
`import-effects-runner`, hoje pausado em produção
([servicos-externos.md](../../operations/servicos-externos.md), decisão de
2026-10-08).

| Porta (tela → ação) | Serviço | Escrita no banco | O que grava | Efeitos síncronos | Efeitos na fila / rotinas |
|---|---|---|---|---|---|
| `/bls`, cartão da Viagem → Importar → **CE Mercante** | `ceMercanteImport.ts` | `apply_ce_mercante_rows_atomic` → `apply_ce_mercante_update` por linha | `bls.ce_mercante`, `manifestos_mercante`, `bls.manifesto_mercante_id`, `audit_logs` | `trg_auto_bill_bl_after_ce_mercante`: cálculo, fatura, recebível, razão, notificação no Portal; retenção sem Portal; status documental da Escala (no COMMIT) | `local_billing` por CE alterado; Comunicado de CE e Taxas (cron 15 min); alerta de CE pendente (15 min); Desbloqueio de CE/ZPT |
| `/granito` → **CE Mercante (Granito)** | `ceMercanteImport.ts` (`target='granite'`) | `apply_granite_ce_mercante_update` | `granite_bls.ce_mercante` | nenhum cálculo | — |
| `/bls`, ficha → **Importar B/L** (planilha/PDF/DOCX de container) | `blFreightImport.ts` | `import_bl_freight_with_metadata` em lotes → cadeia `legacy_205/284/322/357/070/123` | `bls`, `bl_containers` (apaga e recria), `vehicles` (aba VIN), contatos do Cliente, `import_batches`, sugestão de Cliente | cálculo provisório, reemissão automática (ADR 0077), flags do Baplie no lote | `provisional_charges`, `physical_flags` |
| `/bls`, Viagem → **Manifesto BB** e **B/L de carga solta** (PDF/DOCX) | `breakbulkImport.ts` | `import_breakbulk_manifest_transactional` | `bls` por upsert, inclusive `ce_mercante`, `customer_id`, `voyage_id`, `notes`, Revisão | gatilhos de cliente/CE (auto-faturamento) | `local_billing` |
| `/baplie`, Viagem → **Importar Baplie EDI** | `baplieParser.ts` (worker), `baplieImport.ts`, `baplieReconciliation.ts` | `import_baplie_staging_transactional`, `apply_baplie_physical_flags_atomic`, `replace_vazios_from_baplie_transactional` | `baplie_containers`; `bl_containers.is_imo/is_oog/ownership`; vazios de importação | reemissão de fatura (ADR 0077); cobertura e alertas; status documental | `physical_flags` |
| `/veiculos`, Viagem → **Importar veículos** | `vehicleImport.ts` | `import_vehicle_rows_transactional` | `vehicles`, `bl_containers.unpacking_location` | base de fatura (ADR 0077) no COMMIT | `vehicle_followup` |
| `/containers`, `/demurrage` → **Importar datas** | `containerDatesImport.ts` | `apply_container_dates_atomic` (uma chamada por B/L) | `discharge_date`, `return_date`, `demurrage_status` | modalidade de carga (pode acender "Carga alterada após faturamento") | `demurrage_billing` |
| `/vazios-importacao` | `vaziosImportacaoImport.ts` | `import_vazios_importacao_transactional` | manifesto `vazio` e containers | — | — |
| Embarque de Vazios | `vaziosImport.ts` | `import_vazios_bookings_transactional` | unidades da operação (substitui a lista) | — | — |
| `/granito` → manifesto COSCO | `graniteImport.ts` | `import_granite_manifest_transactional` | novo `granite_manifest` + `granite_bls` | — | `granite_billing` |
| `/clientes` → **Importar base** | `customerBase.ts` | `apply_customer_base_row_atomic` | `customers`; liga B/Ls sem Cliente pelo CNPJ | auto-faturamento se o B/L tiver CE | — |
| `/chegadas-saidas` → planilha | `voyageFromSchedule.ts` | várias chamadas por linha | Viagens e datas (vão ao Portal) | — | — |
| Reconciliação → extrato PIX | `demurrageKpis.ts` | baixa de pagamento | pagamentos | — | — |
| Ficha do B/L → Salvar | `useBlEditForm.ts` | `save_bl_review` | inclusive `ce_mercante`, POD, Cliente | auto-faturamento quando o CE passa a existir | — |
| Ficha → aba Carga | `vaziosNatureza.ts` | `set_bl_container_profile`, `set_bl_container_ownership` | perfil IMO/OOG, SOC/COC | recálculo (recusado em B/L faturado) | — |
| `/demurrage` → editar datas | `demurrageContainers.ts` | `UPDATE` direto em `bl_containers` | datas e status | modalidade de carga | — |
| Viagem → Rotas e Manifestos → **Informar Nº** | `voyageRouteSchedules.ts` | `set_voyage_route_ce_master` | tabela legada `voyage_route_ce_master` | — | — |
| COD, Cancelar/Reativar B/L, Excluir, Revisão | `set_bl_cod`, `cancel_bl`, `reactivate_bl`, `delete_records`, `save_bl_review`, `complete_review_customer_group` | — | disposição, estado, vínculo de Cliente | COD limpa `manifesto_mercante_id` | — |

### 2.2 Alcance do CE Mercante

O valor de `bls.ce_mercante` tem 14 consumidores (Código e Runtime, fluxo
`ce_downstream`). Uma escrita, venha de onde vier, pode acionar:

```text
bls.ce_mercante (planilha de CE, ficha, Manifesto BB, API direta)
├── síncrono, na mesma transação (só na transição vazio → preenchido,
│   ou quando o B/L ganha Cliente/reconciliação com CE presente)
│   ├── cálculo "confirmado" das Taxas Locais (taxas do dia do CE)
│   ├── fatura individual por B/L + recebível + razão
│   │   └── notificação "Nova fatura" no Portal (sai com R$ 0.00 — M18)
│   ├── retenção sem Portal pronto (sai na Liberação ou ativação)
│   └── efeito local_billing quando falha ou o CE muda
├── status documental da Escala (Aprovado quando todos os B/Ls ativos têm CE)
├── leitura viva
│   ├── liberação do B/L no Portal (bl_has_portal_release = CE não vazio):
│   │   Operação, Faturas, Consolidação, Demurrage do Cliente
│   ├── trava de exclusão (ADR 0071)
│   ├── LineUp, Validação, exportações, resumos de Viagem, rail da ficha
│   └── Comunicado de CE e Taxas (prontidão por Cliente × Viagem, cron 15 min)
├── Desbloqueio de CE: elegibilidade, retratos e conciliação ZPT pelo número
└── alerta "CE Mercante pendente" (detector a partir de D-5)
```

O CE não altera fatura já emitida: a sobrescrita não dispara o gatilho e o
efeito nasce `superseded` (Runtime). Reimportar B/L ou Baplie, ao contrário,
cancela e reemite (ADR 0077).

### 2.3 Rotinas posteriores que leem o que foi importado

| Rotina | Cadência | Depende de | Situação |
|---|---|---|---|
| `import-effects-runner` | a cada 5 min | toda a fila `import_pending_effects` | pausado; segredo não provisionado de propósito |
| `alerts-foundation-detectors` | 15 min | CE, cobertura do Baplie, efeitos bloqueados | ativo |
| `customer-communication-auto-runner` | 15 min | CE, faturamento, Cliente × Viagem | ativo; chave global de envio desligada |
| `recalc-demurrage-ptax` | dias úteis | referência cambial da Demurrage | ativo desde 07/10 |
| `ce-unlock-notify-email` e conciliação ZPT | 5 min / manual | CE do B/L | ativo |

## 3. Matriz dos principais campos

"Vence" descreve o comportamento observado, não a regra. Onde a regra existe,
a coluna "Regra" cita a fonte; "—" significa sem regra documentada.

### 3.1 Identidade

| Entidade | Chave efetiva | Normalização observada | Fragilidade |
|---|---|---|---|
| B/L | `bls.id` (texto, PK) | planilha de container: só `trim` (mantém caixa e espaço interno); documento PDF/DOCX: maiúsculas sem espaços; CE e taxas: `upper(btrim)` | o mesmo B/L pode existir duas vezes (`cosu…` e `COSU…`) e não receber CE (BL-15) |
| Container do B/L | `(bl_id, container_number)`; `id` substituto | maiúsculas, sem espaço, regex ISO sem dígito verificador | o `id` muda a cada reimportação do B/L, quebrando vínculos (M02) |
| Container físico | `voyage_id + upper(btrim(container_number))` | só nos guardas e no rateio | flags, datas e SOC/COC ficam por linha de B/L e divergem (M03, M11) |
| CE Mercante | `bls.ce_mercante` (texto, índice **não** único) | planilha: 15 dígitos; BB: só dígitos; ficha: texto livre | duplicidade e formato livre (M06, M08) |
| Manifesto Mercante | `manifestos_mercante.numero` (único, sensível a caixa) + rota | só `btrim` | `MCE-1`, `mce-1`, `MCE 1` viram três (M13) |
| Cliente | `customers.cnpj_cpf` (único) | canonizado por gatilho; CPF recusado | PF impossível (BL-17) |
| Veículo | `(voyage_id, chassis)` | maiúsculas; VIN validado só no cliente da planilha | mesmo chassi em outra viagem aceito |
| Staging do Baplie | nenhuma chave (identity) | o parser deduplica; a RPC aceita duplicata | — |
| B/L de Granito | `(manifest_id, bl_number)`; manifesto novo a cada importação | maiúsculas | reimportação duplica (M17) |

### 3.2 Campos e fontes concorrentes

| Campo | Fontes que gravam | Transformação | Vence hoje | Sobrescrita observada | Regra |
|---|---|---|---|---|---|
| `bls.ce_mercante` | planilha de CE; ficha; Manifesto BB/B/L avulso; API | planilha: 15 dígitos; BB: só dígitos (XLSX Geral vira `1514`); ficha: livre | a última escrita | planilha sobrescreve sem aviso (até faturado); BB sem CE **apaga**; ficha apaga se não há fatura | CE entra só pela planilha (CONTEXT, 2026-10-08); 1:1 entre não cancelados (ADR 0071 item 9) |
| `bls.manifesto_mercante_id` | planilha de CE; COD; API | número com `btrim` | o primeiro vínculo | nunca revisto quando rota/Viagem mudam; outro número recusa o lote | manifesto = Viagem + rota + número (CONTEXT) |
| `bls.customer_id` + reconciliação | importação de container; Manifesto BB; Base de Clientes; Revisão | casamento por CNPJ no navegador | container: vínculo existente; BB: o arquivo | BB desfaz Cliente confirmado e troca dono sem aceite; Base liga sem atualizar o status | vínculo só por documento (ADR 0043); troca só com aceite (CONTEXT, Troca de Consignatário) |
| `bls.suggested_customer_id` | importação de container | nome normalizado | arquivo | BB nunca grava; nenhuma tela mostra a sugestão de B/L | sugestão revisada por humano (ADR 0043) |
| contatos do Cliente (e-mail do B/L) | importação de container | 1º e-mail do bloco | arquivo | entra no Cliente **atual**, antes da troca (vazamento) | E-mail Capturado do B/L (CONTEXT) |
| `bls.pol`/`pod` | importação de container; ficha; BB (não atualiza) | `normalizePortCode` (lista); desconhecido = nulo | arquivo, faturado só com override | POD nulo sem aviso; BB ignora correção | — |
| `bls.laden_on_board` → ATD do POL | importação de container | `normalizeDate`; ilegível = nulo | arquivo | nulo apaga a data e move o ATD | B/L fonte documental (ADR 0025) |
| `bls.ncm_codes` | importação; ficha | extração da descrição | documento quando declara | substitui a lista manual (aparece no diff) | ADR 0057 |
| `bls.voyage_id` | importação de container; Manifesto BB | Viagem escolhida | container: só com override; BB: sempre | BB move B/L de outra Viagem | — |
| linhas de `bl_containers` | importação de B/L; API | ISO, primeira duplicata vence | arquivo | apagadas e recriadas em toda reimportação | arquivo de B/L é a fonte da carga (ADR 0071 item 10) |
| `is_imo`/`is_oog` | B/L (DG no conhecimento); Baplie; ficha; API | Baplie: DGS/DIM; B/L reimportado copia o atual | Baplie > manual > B/L, só se o container estiver em **um** B/L | Baplie desfaz a correção manual; container compartilhado nunca recebe | Baplie refina IMO (CONTEXT, Flags Operacionais) |
| `ownership` (SOC/COC) | B/L; Baplie (EQD 8077); ficha; API | só SOC/COC | B/L > manual > Baplie | reimportação do B/L apaga o manual; Baplie sem 8077 apaga o SOC do Baplie anterior | B/L soberano (CONTEXT, SOC/COC) |
| `discharge_date` | planilha de datas; `/demurrage`; gatilho na inserção (`voyages.ata`) | DD/MM fixo sobre texto formatado | a última escrita | reimportação do B/L volta à ATA; XLSX numFmt 14 troca dia/mês | — (fonte padrão não definida) |
| `return_date` | planilha de datas; `/demurrage`; aba do B/L | idem; vazio = nulo | a última escrita | célula vazia **apaga**; reimportação do B/L apaga | — |
| `demurrage_status` | planilha (`returned`); edição manual (`overdue`/`within`); gatilho SOC | três semânticas | o último caminho | nada marca `overdue` para container fora | — |
| `unpacking_location` | planilha de veículos; tela | `trim` | planilha | planilha sobrescreve o manual; reimportação do B/L apaga | — |
| `vehicles` | planilha de veículos; aba VIN do B/L | VIN no cliente da planilha | B/L com override substitui a lista | aba ausente + override apaga | arquivo de B/L é a fonte da carga (ADR 0071 item 10) |
| faturas/recebíveis de Taxas Locais | gatilho do CE; ficha; Validação; Liberação; efeitos | cálculo do dia do CE | o primeiro emitido | CE não reemite; B/L, Baplie e veículos reemitem (ADR 0077) | taxas do dia do CE (ADR 0070); fatura emitida não muda de valor (ADR 0077) |
| `baplie_containers` | Baplie | lista fixa de portos | último arquivo | substituído inteiro | staging substituído (CONTEXT) |
| natureza dos vazios | tela de vazios | — | manual | apagada pelo recadastro do Baplie | — |
| `granite_bls` | planilha COSCO | maiúsculas | acumula | duplica a cada importação | — |

## 4. Ordens de importação e consistência do resultado

Todas as sequências abaixo foram executadas no banco local (Runtime), como
usuário interno ativo com `SET ROLE authenticated`; o worker da fila foi
simulado com `claim_import_effects`/`process_import_effect` quando indicado.
"Consistente" significa: o estado final é o mesmo da ordem natural e respeita
a regra de negócio.

| # | Sequência | Resultado final | Consistente? | Achado |
|---|---|---|---|---|
| 1 | CE antes de o B/L existir | planilha recusada inteira ("BL … não encontrado"); nada gravado | sim (recusa explícita) | — |
| 2 | B/L → CE → reimportação idêntica do B/L de container | CE e manifesto preservados; containers recriados (datas, devolução, status de Demurrage e desova perdidos); B/L faturado volta à Revisão com "Carga alterada após faturamento" | **não** | M02 |
| 3 | B/L → CE → reimportação com outro consignatário | troca só com aceite, mesmo valor (ADR 0017); e-mail do novo titular entra como contato do Cliente antigo | parcial | M14 |
| 4 | B/L → CE → reimportação com outro POD/Viagem (override) | fatura reemitida quando o valor muda; manifesto continua o da rota antiga; nova planilha de CE é recusada; sem tela para revincular | **não** | M13 |
| 5 | Manifesto BB → CE → reimportação do BB (layout do armador, sem CE) | CE apagado, B/L sai do Portal, trava cai, Escala volta de Aprovado; com B/L faturado o arquivo inteiro é recusado | **não** | M01 |
| 6 | BB → Revisão vincula Cliente → reimportação do BB sem CNPJ | Cliente confirmado desfeito, Revisão reaberta, nota humana apagada | **não** | M01 |
| 7 | BB com CNPJ de outro Cliente sobre B/L faturado | Cliente trocado, fatura cancelada e reemitida (até com outro valor), sem prévia nem aceite | **não** | M01 |
| 8 | B/L de container na Viagem A → BB da Viagem B com o mesmo número | B/L movido para B, vira misto, perde CE e Cliente; manifesto da A mantido | **não** | M01 |
| 9 | Planilha de CE com B/Ls que dividem container (mesmo Cliente ou não) | só o primeiro da planilha é faturado; o segundo fica bloqueado; invertendo as linhas, inverte o faturado | **não** (depende da ordem das linhas) | M03 |
| 10 | B/L irmão importado depois de o primeiro ser faturado | lote inteiro de B/L recusado ("container compartilhado já faturado") | **não** | M03 |
| 11 | CE → planilha corrigida com outro CE (B/L faturado) | CE trocado em silêncio; fatura intacta; Comunicado enviado fica com o CE antigo; Desbloqueio reabre | parcial (troca permitida, sem aviso) | M07 |
| 12 | Mesmo CE em duas linhas, em duas planilhas ou carga × Granito | aceito; os dois B/Ls faturados e liberados; ZPT desbloqueia os dois | **não** | M06 |
| 13 | Ficha corrige o CE → reimportação da planilha antiga | correção manual desfeita, sem rastro de quem a fez (justificativa descartada) | **não** | M07 |
| 14 | Mesma planilha de CE duas vezes | idempotente (`unchanged`); toast "atualizado em 0" | sim | — |
| 15 | Mesmo arquivo, Nº de Manifesto com outra caixa/separador | manifesto novo na mesma rota; o B/L fica preso ao primeiro | **não** | M13 |
| 16 | CE → COD → nova planilha de CE | COD limpa o vínculo; a planilha revincula ao manifesto informado | sim | — |
| 17 | Baplie antes do B/L, depois B/L | flags aplicadas ao B/L importado (container em um só B/L) | sim | — |
| 18 | B/L → Baplie com IMO/OOG/SOC divergente → correção manual → Baplie idêntico ou reimportação do B/L | correção manual de perfil desfeita; SOC manual preservado | **não** para perfil | M11 |
| 19 | Baplie com container em dois B/Ls (Part Lot) ou B/L cancelado + substituto | nenhuma flag aplicada; resultado depende da ordem B/L × Baplie; tela diz "aplicados" | **não** | M11 |
| 20 | Datas importadas → reimportação do B/L | datas, devolução e status perdidos; descarga volta à ATA | **não** | M02 |
| 21 | Invoice de Demurrage → reimportação do B/L | falha por FK; o lote inteiro cai | **não** | M02 |
| 22 | Veículos → reimportação do B/L com override ou sem cálculo | veículos da planilha e desova apagados (com aviso só dos veículos) | parcial | M02 |
| 23 | Veículos antes do CE → CE (fatura) → runner ligado | `vehicle_followup` antigo cancela a fatura emitida depois, inclusive de B/L FCL | **não** (latente) | M04 |
| 24 | CE de Cliente sem Portal (retido) → veículo LCL → Liberação | fatura emitida sem a isenção do veículo | **não** | M15 |
| 25 | CE retido → tabela de taxas muda → efeito processado | cálculo trocado pela tabela do dia do worker; Liberação fatura o valor novo | **não** (latente) | M04 |
| 26 | Base de Clientes antes × depois do B/L | antes: `matched_document` e emissão normal; depois: `customer_id` gravado com `missing_customer`, faturamento bloqueado | **não** (depende da ordem) | M16 |
| 27 | Duas planilhas de CE simultâneas na mesma Viagem com manifesto novo | uma falha com `deadlock detected` ou `duplicate key`; nada parcial | sim (atômico), mensagem técnica | P2 |
| 28 | Dois Baplies simultâneos | staging com a união dos dois arquivos | **não** | P2 |
| 29 | Planilha de datas sem devolução para container devolvido | devolução apagada, status continua `returned` | **não** | M10 |
| 30 | Reimportação de Granito ou de Vazios | B/Ls/containers duplicados; CE de Granito passa a ser "ambíguo" | **não** | M17 |

### 4.1 O que a análise de ordens mostra

- **A planilha de CE é a porta mais robusta**: tudo ou nada, travas em ordem,
  validação de rota e idempotência funcionam (Runtime). O dano ao CE vem
  sobretudo de **outras portas** que gravam o mesmo campo (BB, ficha, API) e da
  ausência de unicidade.
- **As reimportações são a principal causa de perda silenciosa**: o B/L de
  container apaga dados que não vêm do B/L (datas, desova, SOC manual); o
  Manifesto BB apaga o CE e desfaz decisões humanas; o Baplie desfaz correções
  manuais de perfil.
- **O resultado depende da ordem** em quatro pontos estruturais: container
  compartilhado (ordem das linhas), Base de Clientes (antes ou depois do B/L),
  Baplie × Part Lot e manifesto (primeiro número digitado prende o B/L).
- **A fila pausada transforma intenção antiga em ação futura**: quando o runner
  for ligado, efeitos acumulados agirão sobre faturas e cálculos que mudaram
  depois (cenários 23 e 25).

## 5. Problemas priorizados

Cada problema-raiz lista o que acontece, a evidência, como reproduzir, a
consequência operacional e o encaminhamento (etapa do plano e decisões da
seção 6). Os ids entre colchetes são os achados individuais (índice na seção
10). "Checagem" aponta o caso `it.fails` que reproduz o defeito.

### 5.1 Crítico

#### M01 — Reimportar carga solta apaga o CE, desfaz o Cliente e move B/L de Viagem

- **O que acontece:** `import_breakbulk_manifest_transactional` (Manifesto BB
  nos layouts do armador, legado e resumido; B/L avulso PDF/DOCX) faz `INSERT …
  ON CONFLICT (id) DO UPDATE` gravando o arquivo por cima do B/L existente:
  `ce_mercante = EXCLUDED.ce_mercante` vale NULL quando o arquivo não traz CE
  (os layouts do armador e o B/L avulso nunca trazem), antes do `UPDATE` que
  deveria preservá-lo. O mesmo `SET` regrava `customer_id`, reconciliação,
  `review_status`, `notes` e `voyage_id`. Com B/L faturado no arquivo, o
  `guard_bl_state_and_ce` recusa o NULL e o **lote inteiro** cai com "Corrija o
  número".
- **Evidência:** Runtime em quatro frentes independentes e duas verificações;
  Código: definição efetiva linhas 119-150; regressão das migrations
  `060:494` e `064:542` sobre a intenção da `migrations_archive/304`. O teste
  `breakbulkImportCeMigration.test.ts` passa porque `src/test/setup.ts`
  redireciona a leitura para a migration arquivada.
- **Reprodução:** planilha de CE num B/L de carga solta → reimportar o mesmo
  Manifesto BB (layout do armador) ou o mesmo PDF. Checagem:
  `auditoriaImportacaoCargaSolta` cenários 1–6.
- **Consequência:** o B/L perde o CE sem aviso, sai do Portal (faturas e
  Demurrage ocultas), perde a trava de exclusão, a Escala volta de Aprovado e
  o B/L fica no Manifesto Mercante sem CE. O Cliente confirmado na Revisão
  volta a `missing_customer` e a nota humana some. Com CNPJ de outro Cliente, a
  fatura é cancelada e reemitida para o outro Cliente (até com outro valor) sem
  prévia nem aceite. Um B/L de container de outra Viagem com o mesmo número é
  movido, vira misto e perde CE e Cliente. A correção de carga solta de B/L
  faturado fica impossível.
- **Encaminhamento:** Etapa 1. Decisões D-10.
- [BL-01, CED-03, OUT-01, OUT-02, OUT-03, ORDCE-02, ORDCE-03, ORDCE-V02,
  TST-01, BL-16, OUT-V01, BL-12, OUT-12, TST-11, OUT-V03]

#### M02 — Reimportar B/L de container recria os containers e apaga o que não vem do B/L

- **O que acontece:** a prévia marca `override_billing = true` em toda linha
  sem impacto, inclusive "Sem mudança", e envia essas linhas. A cadeia
  `import_bl_freight_transactional_legacy_205` faz `DELETE` + `INSERT` de
  `bl_containers` (e de veículos) do B/L inteiro.
- **Evidência:** Runtime em cinco frentes, inclusive com a prévia e a
  confirmação reais do serviço; Código: `blFreightImport.ts:406`, legacy_205
  linhas 508-579.
- **Reprodução:** importar o B/L → importar datas (ou SOC manual, desova) →
  reimportar o mesmo arquivo. Checagem: `auditoriaImportacaoBlContainer`
  cenários 1–4.
- **Consequência:** perde descarga (volta à ATA), devolução, status de
  Demurrage, local de desova, SOC/COC manual (Drop Off e Damage voltam a ser
  cobrados), `id` do container (quebra o histórico por container e apaga em
  cascata as resoluções do Baplie) e, com override, os veículos da planilha.
  Com Invoice de Demurrage, a reimportação falha com `23503` cru e derruba o
  lote de até 20 B/Ls; com irmão de container faturado, falha com `P0003`. B/L
  faturado reimportado idêntico volta à Revisão com "Carga adicionada após
  faturamento", `charge_status = not_calculated` e a orientação inexequível
  "Cancele e reemita"; um `provisional_charges` fica na fila.
- **Encaminhamento:** Etapa 2. Decisões D-11.
- [BL-02, BL-04, BL-05, DAT-03, ORDCT-01, ORDCT-02, ORDCT-03, VEI-04,
  ORDCE-06, BL-13, BL-20, ORDCT-19, BL-V01, ORDCE-11, ORDCT-13]

#### M03 — Container compartilhado: só o primeiro B/L da planilha de CE é faturado

- **O que acontece:** o gatilho do CE emite uma Invoice Individual por B/L.
  Dentro da mesma planilha, o primeiro B/L fica `invoiced` antes da linha do
  segundo; `guard_shared_container_invoice` (migration `066`) recusa o segundo
  com `P0003`, mesmo com rateio 1/2 + 1/2 correto. A exceção é engolida, o
  cálculo do segundo é desfeito e a planilha devolve `ok:true`.
- **Evidência:** Runtime em quatro frentes; protótipo da correção validado
  (o caso 150% continua recusado). Código: `066:348-389`; intenção em
  `066:344-346`.
- **Reprodução:** dois B/Ls com o mesmo container recebem o CE na mesma
  planilha. Checagem: `auditoriaCeContainerCompartilhado` cenários 1–4.
- **Consequência:** a cota de um dos Clientes nunca é cobrada; a carga dele
  trava (fatura paga é condição de retirada); o Comunicado de CE e Taxas nunca
  fica pronto; a Liberação conta o P0003 como bloqueio sem alerta; datas e
  desova do B/L irmão não podem ser gravadas; o B/L irmão que chega depois do
  faturado derruba o lote de importação de B/L. Contraria CONTEXT (Faturamento:
  "B/Ls que dividem um mesmo container recebem o CE no mesmo momento … garante
  o rateio correto") e a ADR 0020.
- **Encaminhamento:** Etapa 5. Decisões D-09.
- [CED-01, ORDCE-01, ORDCT-V03, ORDCE-V03, CED-09, DAT-10, ORDCT-09]

#### M05 — A leitura de planilhas troca dia e mês e converte números antes do parser

- **O que acontece:** `readSheet` entrega o texto que o SheetJS renderiza: a
  data curta do Excel (numFmt 14) chega como `m/d/yy` e os parsers DD/MM a
  invertem (dia ≤ 12) ou a recusam sem explicar (dia > 12). No CSV, os modos
  `cru`/`date` deixam o SheetJS converter antes do parser (`12,5` → 125;
  `05/03/2026` → 3 de maio). Datas com hora viram `Date` local e são lidas em
  UTC.
- **Evidência:** Runtime (parsers reais com XLSX gerados com `numFmtId=14`);
  Código: `importCore.ts:73-137`; prova de conceito do leitor tipado corrige 5
  de 8 casos sem mudar parser.
- **Reprodução:** checagem `auditoriaLeituraPlanilhas` (9 casos).
- **Consequência:** descarga e devolução trocadas mudam free time e Demurrage
  (a prévia mostra a data trocada sem aviso); Embarque de Vazios troca datas
  quando nenhuma passa de 12; cubagem de veículo ×10 gravada; ETA/ETD com dia e
  mês trocados publicados no Portal (alimentam NOA/NOR e a data de referência
  da tabela de Taxas Locais); tara 2,2 kg em vez de 2.200; extrato PIX com
  valor ×10/×100 e pagamento das 22h no dia seguinte; CE e CNPJ numéricos
  recusados com mensagem obscura.
- **Encaminhamento:** Etapa 3. Decisões D-16.
- [DAT-01, INF-01, INF-02, VEI-13, INF-19, INF-V02, DAT-14, CE-05, INF-15,
  CE-V05]

### 5.2 Crítico latente

#### M04 — A fila de efeitos pausada acumula intenções que agirão sobre dados posteriores

- **O que acontece:** CE, veículos, carga solta, datas e Importar B/L
  enfileiram efeitos sem validade; o runner está pausado. Os consumidores
  executam a intenção registrada sem revalidar: `vehicle_followup` cancela
  toda fatura do B/L com o motivo "BL isento" sem testar a isenção nem
  reemitir (contra a ADR 0077); `local_billing` recalcula B/L retido pela
  tabela do dia do worker (contra as taxas do dia do CE, ADR 0070); o efeito
  de B/L de carga solta recalcula todos os B/Ls pendentes da Viagem;
  `physical_flags` reaplica o Baplie à Viagem inteira desfazendo correções.
  Erro transitório vira bloqueio definitivo com código `invalid_effect_payload`;
  lease esgotado e dependência bloqueada não abrem Alerta.
- **Evidência:** Runtime com o worker simulado; protótipo dos consumidores
  validado (10/10). Código: `_run_import_effect_vehicle_followup` (128),
  `_run_import_effect_local_charges` (056), `claim_import_effects` (017).
- **Reprodução:** checagem `auditoriaEfeitosImportacao` (5 casos).
- **Consequência:** ao ligar o runner, faturas FCL corretas são canceladas em
  massa, B/Ls retidos mudam de valor, correções de perfil são desfeitas e
  falhas viram bloqueios invisíveis. Ligado, o mesmo vale para cada efeito
  novo, cinco minutos depois da importação.
- **Encaminhamento:** Etapa 4, que precede a ativação do runner. Decisões
  D-12.
- [VEI-01, VEI-02, BAP-V01, INF-05, INF-06, INF-07, INF-V01, CE-V04, CED-14,
  ORDCE-07, ORDCE-V04, TST-V01, DAT-06, DAT-V01, INF-14]

### 5.3 Alto

#### M06 — A unicidade CE × B/L não é imposta em nenhuma camada

- **O que acontece:** `idx_bls_ce_mercante` não é único; o parser só recusa
  B/L repetido; nenhuma porta consulta outros B/Ls; `reactivate_bl` não
  confere o CE. A ADR 0071 item 9 decidiu a unicidade entre B/Ls não
  cancelados; a nota de implementação registra a não imposição no banco como
  "desvio aceito", e nenhuma outra camada a impõe.
- **Evidência:** Runtime em cinco frentes; protótipo do índice parcial com
  gatilho validado (15/16; o caso restante depende do parser).
- **Reprodução:** checagem `auditoriaCeUnicidadeValidacao` (8 casos).
- **Consequência:** o mesmo CE fica em vários B/Ls (mesma planilha, outra
  planilha, ficha, Manifesto BB, carga × Granito, reativação); os B/Ls são
  faturados e liberados no Portal com o CE de outro; a conciliação ZPT marca
  todos como desbloqueados.
- **Encaminhamento:** Etapa 6. Decisões D-04.
- [CE-01, CED-06, ORDCE-05, TST-07, CE-V03, OUT-10]

#### M07 — A planilha sobrescreve o CE sem prévia de antes → depois

- **O que acontece:** a prévia mostra só o CE do arquivo; `overwritten` é
  somado a `inserted` no toast; nada distingue correção de erro de digitação;
  em corrida, a última planilha vence e as duas mostram sucesso. A ficha
  exige justificativa, mas `save_bl_review` a descarta; o Histórico do B/L não
  mostra a correção manual.
- **Evidência:** Runtime e Teste (modal real em jsdom).
- **Consequência:** correção legítima e erro ficam indistinguíveis; o
  Comunicado já enviado fica com o CE antigo sem pendência; a planilha antiga
  desfaz a correção manual sem rastro de quem a fez nem por quê.
- **Encaminhamento:** Etapa 8 (contrato da importação de CE). Decisões D-01,
  D-05, D-06.
- [CE-02, CED-02, ORDCE-09, TST-08, INF-18, CE-V02, OUT-08]

#### M08 — O CE entra por quatro portas sem as regras da planilha

- **O que acontece:** a ficha grava texto livre (com espaços), o Manifesto BB
  grava só dígitos de qualquer tamanho (célula XLSX Geral `1,5E+14` vira
  `1514`), `apply_ce_mercante_update` e o `UPDATE` direto aceitam `''` e
  `'XYZ'`. Nenhuma porta valida 15 dígitos no servidor nem exige Nº de
  Manifesto.
- **Evidência:** Runtime (CE `abc` emitiu INV de R$ 2.470 e liberou o B/L no
  Portal).
- **Consequência:** CE inválido é fato gerador e libera o Portal; B/L fica sem
  manifesto. Contraria "o CE Mercante entra só por planilha" (CONTEXT, decisão
  de 2026-10-08), que por sua vez diverge de `manifesto-edi.md:157` e da ADR
  0071 item 5.
- **Encaminhamento:** Etapas 6 e 8. Decisões D-02, D-03.
- [CED-11, OUT-04, ORDCE-04, TST-13, CE-14, ORDCE-16, OUT-15]

#### M09 — A importação de CE não informa o que faturou, reteve ou bloqueou

- **O que acontece:** a RPC devolve só contagens; o modal fecha com "CE
  Mercante atualizado em N B/L(s)"; a falha do auto-faturamento vira efeito
  `blocked/invalid_effect_payload` com Alerta genérico sem o B/L; a nova
  tentativa só existe em `/granito`; o alerta por B/L da ADR 0041 só existe em
  código morto (`maybeAutoBillAfterCeMercante`). B/L em Revisão que recebe o CE
  gera dois alertas críticos permanentes e nunca fatura depois de corrigido
  pela ficha. A Validação mostra "Pronto para emitir" sem botão Emitir.
- **Evidência:** Runtime e Teste (modal e serviço reais).
- **Consequência:** a cobrança fica parada sem dono; o operador não sabe que
  precisa agir.
- **Encaminhamento:** Etapa 8. Decisões D-07.
- [CE-04, CED-04, ORDCE-10, TST-09, INF-08, CED-V01, CED-V02, CED-12,
  ORDCE-13]

#### M10 — Datas e Demurrage: apagamento, semânticas conflitantes e cobrança impossível

- **O que acontece:** devolução vazia ou coluna ausente apaga a devolução e
  mantém `returned`; `demurrage_status` é gravado de três formas e nada marca
  `overdue` para container fora (a tela interna diverge do Portal); B/L com um
  container devolvido no free time e outro em atraso nunca é faturável (as
  regras das migrations `023` e `066` se contradizem); SOC conta como
  devolução pendente e derruba a fatura do COC; "Gerar Fatura" só pega
  `overdue` e as devoluções importadas não têm caminho manual; datas mudam
  depois da Invoice de Demurrage emitida sem alerta; registrar data em B/L
  faturado acende "Carga alterada após faturamento" e reabre a Revisão.
- **Evidência:** Runtime em três frentes; protótipo das correções decididas
  (12/12).
- **Reprodução:** checagem `auditoriaFaturasDemurrageComunicado` cenários 3–6.
- **Consequência:** Demurrage devida não é cobrada; Demurrage em curso é
  invisível internamente; B/Ls faturados voltam à Validação.
- **Encaminhamento:** Etapa 7. Decisões D-13.
- [DAT-02, ORDCT-06, DAT-05, ORDCT-07, DAT-04, DAT-07, ORDCT-18, DAT-V02,
  ORDCT-V04, DAT-09, ORDCT-08, DAT-11, VEI-V02, ORDCT-V02, DAT-12, DAT-15,
  DAT-16]

#### M11 — Baplie: Part Lot ignorado, correção manual desfeita, reemissão sem aviso

- **O que acontece:** `apply_baplie_physical_flags_atomic` só aplica quando o
  número casa com exatamente um container da Viagem, contando B/L cancelado:
  Part Lot e B/L reemitido não recebem IMO/OOG/SOC e a tela diz "aplicados". A
  correção manual de perfil é desfeita pelo Baplie idêntico, pela
  reimportação do B/L e por "Aplicar IMO/OOG agora", e a tela a chama de
  falha. O Baplie cancela e reemite fatura sem informar a tela. O ADR da escala
  classifica IMO/OOG pelo Baplie enquanto a cobrança usa `bl_containers`.
- **Evidência:** Runtime em três frentes.
- **Consequência:** THD errado (normal × IMO +50% × OOG +100% × ambos ×2,5),
  SOC e COC simultâneos no mesmo container físico, Cliente notificado de nova
  fatura que o operador não viu.
- **Encaminhamento:** Etapa 9. Decisões D-15.
- [BAP-01, ORDCT-05, BAP-02, ORDCT-10, ORDCT-11, BAP-11, BAP-V02, BAP-12,
  BAP-08, BAP-V03, BAP-10, ORDCT-14, ORDCT-17, ORDCT-12]

#### M14 — O e-mail do novo consignatário vira contato do Cliente antigo

- **O que acontece:** a captura usa o `customer_id` do momento, antes do
  relink, e não compara o CNPJ do arquivo; com ou sem aceite da troca, o
  e-mail do outro titular entra no Cliente antigo (caixa Documentação e
  Operação).
- **Evidência:** Runtime em duas frentes. O envio real não foi exercitado
  (chave global desligada).
- **Reprodução:** checagem `auditoriaImportacaoBlContainer` cenário 5.
- **Consequência:** Comunicados de um Cliente enviados a terceiros.
- **Encaminhamento:** Etapa 2. Decisão D-11.
- [BL-03]

#### M15 — Veículo importado depois do CE: Liberação fatura sem isenção

- **O que acontece:** sem fatura viva, a importação de veículos não recalcula
  (o efeito está pausado); a Liberação reaproveita o cálculo do dia do CE e
  emite fatura para B/L LCL que deveria ser isento. B/L isento por veículo
  mantém o Recebível aberto e consolidável no Portal.
- **Evidência:** Runtime.
- **Encaminhamento:** Etapa 11. Decisões D-17.
- [VEI-03, VEI-V01]

#### M20 — Viagem Cancelada continua recebendo datas, CE de Granito e comunicados

- **O que acontece:** `guard_voyage_cancelled_mutation` só existe em tabelas
  com `voyage_id`; `bl_containers`, `granite_bls`, faturas e comunicados ficam
  abertos. Depois de `cancel_voyage`, a planilha de datas gravou e enfileirou
  Demurrage (emitida pelo worker simulado, com notificação no Portal), o CE de
  Granito foi aceito e a automação gerou NOA.
- **Evidência:** Runtime (crítico de completude).
- **Consequência:** cobrança e aviso de uma Viagem que não aconteceu
  (CONTEXT: Viagem Cancelada preserva registros e não é operação ativa).
- **Encaminhamento:** Etapa 10.

#### M21 — Demurrage emitida não é revista quando as datas são corrigidas

- **O que acontece:** após a emissão, a planilha corrige a devolução para
  dentro do free time; a fatura fica com o valor e as datas antigos, o novo
  efeito termina `succeeded` por idempotência, `recalculate_demurrage_invoices`
  (job de PTAX) reajusta o valor em BRL e a Régua de cobrança seleciona a
  fatura dias depois. Nenhum Alerta.
- **Evidência:** Runtime (crítico de completude).
- **Consequência:** combinado com M05, uma data trocada vira dinheiro cobrado
  e recobrado sem revalidação.
- **Encaminhamento:** Etapa 7. Decisão D-13.

#### M22 — A reimportação de B/L desfaz o COD; B/L importado após a omissão fica fora

- **O que acontece:** reimportar o arquivo original com override devolve o
  POD ao porto omitido, cancela a fatura do COD e reemite pelo porto omitido;
  `bl_transshipments` continua `cod` e o Portal mantém a notificação "Destino
  alterado". B/L importado depois da Omissão de Escala não entra no
  transbordo e o CE o fatura pelo porto omitido.
- **Evidência:** Runtime (crítico de completude).
- **Encaminhamento:** Etapa 10. Decisão D-22.

### 5.4 Médio

| Id | Problema | Evidência | Etapa / decisão |
|---|---|---|---|
| M12 | Planilha de CE com faturamento síncrono custa 40–133 ms por B/L faturado (varredura sequencial em `assert_bl_ce_mercante` e `_sync_local_charge_receivable_before_correction_123`); acima de ~150 B/Ls com a correção, ou abaixo de 100 sem ela a partir de 50 mil B/Ls na base, passa de 8 s e nada é gravado. Flags do Baplie passam de 8 s com ~350–400 B/Ls recalculados. Runtime com 600 a 100 mil B/Ls na base e tempo-limite de 8 s simulado. | Runtime; 8 s é Suspeita | Etapa 8 / D-07 |
| M13 | Nº de Manifesto só com `btrim` (caixa e separador criam outro manifesto); quatro cadastros sem sincronia (`manifestos_mercante`, `voyage_route_ce_master`, `import_batches.ce_master`, marca `linked` do LineUp); vínculo não revisto quando rota ou Viagem mudam; sem tela para mover ou desvincular; B/L cancelado vinculado; rota comparada como texto. | Runtime | Etapa 8 / D-08 |
| M16 | Base de Clientes liga B/Ls retroativamente gravando só `customer_id` (fica `missing_customer` ou `rejected`, fila e retenção incoerentes); antes ou depois do B/L dá estados diferentes; telas de Revisão e Faturamento não são invalidadas; sobrescreve a razão social. | Runtime | Etapa 11 / D-18 |
| M17 | Reimportar Granito duplica B/Ls e peso e torna o CE "ambíguo"; Vazios de Importação duplicam; o recadastro de vazios do Baplie apaga a natureza e deixa órfãos; Embarque de Vazios substitui unidades manuais e deixa manifestos órfãos. | Runtime | Etapa 11 / D-19 |
| M18 | A notificação "Nova fatura emitida" do Portal sai com "R$ 0.00" em toda Invoice Individual (`notify_invoice_issued` roda no INSERT, antes do total). | Runtime; checagem cenário 1 | Etapa 7 |
| M19 | B/L Cancelado bloqueia para sempre a prontidão e o conteúdo do Comunicado de CE e Taxas e conta no alerta de CE: os filtros usam `financial_status <> 'cancelled'`, valor que nenhuma rotina grava; o NOA automático lista B/L cancelado. O recebível nasce no cálculo (antes do CE e da fatura) e torna `cancel_bl` inalcançável para quase todo B/L com Cliente. | Runtime; checagem cenário 2 | Etapa 7 / D-14 |
| M23 | O detalhe e a impressão da fatura (interna e Portal) leem razão social e POL/POD vivos: Base de Clientes, reimportação, Manifesto BB e COD alteram o documento de faturas já emitidas. | Runtime | Etapa 10 / D-21 |
| M24 | Excluir o B/L irmão de um container compartilhado depois do faturamento deixa a fatura do outro com 1/2 do container, sem alerta. | Runtime | Etapa 5 / D-09 |
| M25 | Os seis Departamentos ativos executam todas as importações, inclusive a planilha de CE que emite fatura em nome de quem importou (CONTEXT: emissão é ato do Financeiro); as reimportações apagam registros, enquanto excluir é ato do Administrativo (ADR 0046). | Runtime | Etapa 10 / D-20 |

### 5.5 Menor (P2)

| Grupo | Achados | Encaminhamento |
|---|---|---|
| Cabeçalhos: duas colunas para o mesmo campo resolvidas pela ordem (o helper do CE fica com a primeira; outros com a última); linhas filtradas e aba oculta importadas; só a 1ª aba lida | CE-06, INF-03, INF-04 | Etapa 3 / D-16 |
| CE numérico em XLSX; modelo oficial com CE de 9 dígitos em coluna Geral | CE-05, INF-15, CE-V05 | Etapa 3 |
| Importar B/L: Laden on Board ilegível ou vazio apaga a data e move o ATD; 8 portos do cadastro não reconhecidos por nome (POD nulo impede o CE); número do B/L sem normalização; peso/CBM com locale fixo; CPF impossível; extração frágil do consignatário; Viagem `V001`; override global por lote; recálculo de irmãos entre importações inexistente; servidor confia no vínculo enviado | BL-06, BL-07, BL-15, BL-14, BL-17, BL-19, BL-21, BL-08, BL-09, BL-11, BL-18 | Etapa 2 / D-11 |
| Veículos: chassi duplicado (1ª linha vence); heurística `…00`; desova da planilha sobrescreve a manual; regras só no cliente; VIN do B/L em conflito derruba o lote; sem correção de veículo após o CE; tipo/lacre estritos; INSERT/UPDATE direto liberado | VEI-05 a VEI-12, VEI-V03, ORDCT-04 | Etapa 11 / D-17 |
| Baplie: porto fora da lista fixa bloqueia o arquivo; diff limitado a 1000 linhas; qualquer DIM vira OOG; 2º EQD sem rota; staging sem trava; RPC aceita duplicata; ISO 6346 não validado; TDT não conferido; NAD/8249/UNA ignorados; divergência SOC/COC sem resolução; tabela de resoluções inerte; `WARNING permission denied` engolido sem usuário ativo | BAP-03, BAP-07, BAP-09, BAP-13 a BAP-20, ORDCT-16 | Etapa 9 / D-15 |
| Concorrência: deadlock entre transações que gravam B/Ls da mesma Viagem (status documental diferido); corrida no manifesto novo (`23505`); dois Baplies simultâneos | CE-09, INF-10, ORDCE-13, BAP-14 | Etapa 8 |
| Paginação (`max_rows` 1000) em prévias de B/L, datas e diff do Baplie | BAP-07, DAT-13, INF-13 | Etapas 2, 7, 9 |
| Proveniência: sem arquivo, linha ou lote em CE, datas, veículos e Clientes; criação de manifesto não auditada; CE auditado em dobro | CE-11, INF-09, CED-15 | Etapa 8 |
| ATA da Escala não alimenta a descarga; gatilhos legados com `::date` em UTC | DAT-08 | Etapa 7 / D-13 |
| Programação por planilha sem prévia, não atômica (Viagem duplicada) | OUT-14 | Etapa 11 |
| Mensagens cruas ou orientação inexequível; campo do problema adivinhado por palavra-chave | INF-11, INF-12, OUT-11 | Etapas 1, 2, 8 |
| Granito: CE não aciona cálculo (a documentação diz que aciona); resolução pela ordem da resposta | CE-08, CE-07 | Etapa 11 / D-19 |
| A inspeção de encoding lê o arquivo inteiro antes do limite de 10 MB | TST-14 | Etapa 3 |
| Refutados ou sem caminho de usuário: caches da auditoria (CE-13); vários arquivos no `FileImportModal` (INF-16); limite de taxa (INF-17, evento morto) | CE-13, INF-16, INF-17 | — |

## 6. Decisões de negócio pendentes

Os defeitos com regra já decidida (CONTEXT, ADR ou documentação viva) têm
checagem e não dependem destas decisões. As decisões abaixo cobrem o que
nenhuma regra fixa hoje, ou onde regras vigentes se contradizem. Cada uma traz
um exemplo, o comportamento atual (Runtime), as opções com a consequência e a
recomendação técnica. A recomendação não substitui a decisão.

### 6.1 CE Mercante

**D-01 — A planilha pode trocar um CE já gravado? Com que confirmação e por
quem, depois de faturado, comunicado ou desbloqueado?** (M07)

- Exemplo: B/L faturado com o CE `…201`; a planilha seguinte traz `…999`.
- Hoje: grava sem prévia de antes → depois e conta como "atualizado". A fatura
  continua emitida, o Comunicado enviado fica com o CE antigo e a conciliação
  ZPT deixa de casar.
- Opções: (a) recusar a troca depois do faturamento, do Comunicado ou do
  Desbloqueio, e exigir correção auditada; (b) prévia de antes → depois com
  confirmação e motivo, para qualquer importador; (c) manter.
- Consequência: (a) protege documentos já enviados, mas um erro do armador
  exige um passo a mais; (b) é rápida, mas um erro de digitação confirmado
  passa; (c) mantém a troca invisível.
- Recomendação: prévia de antes → depois sempre; antes do faturamento,
  confirmação explícita; depois de faturado, comunicado ou desbloqueado,
  somente o Administrativo, com motivo gravado e pendência de reenvio do
  Comunicado.

**D-02 — A ficha do B/L pode editar o CE?** (M08)

- Exemplo: o operador digita `CE-ABC` ou cola o CE de outro B/L.
- Hoje: aceita texto livre, sem Nº de Manifesto, e descarta a justificativa.
  O CONTEXT diz que o CE entra só por planilha (decisão de 2026-10-08);
  `manifesto-edi.md:157` e a ADR 0071 item 5 descrevem a edição pela ficha.
- Opções: (a) somente leitura, como diz o CONTEXT; (b) edição com as regras
  da planilha (15 dígitos, unicidade, Nº de Manifesto), restrita ao
  Administrativo e com justificativa gravada.
- Consequência: (a) uma correção pontual exige planilha de uma linha; (b)
  mantém a correção rápida, mas exige uma segunda porta com as mesmas regras.
- Recomendação: (b) se a correção pela ficha é usada; senão (a), corrigindo
  `manifesto-edi.md` e a ADR por nota editorial.

**D-03 — O Manifesto BB pode trazer CE?** (M01, M08)

- Exemplo: o modelo BB exige a coluna CE; a célula `1,5E+14` vira o CE `1514`
  e libera o B/L no Portal.
- Hoje: grava só dígitos, de qualquer tamanho, sem manifesto e sem unicidade;
  sem CE, apaga o existente (este apagamento é defeito e sai na Etapa 1 de
  qualquer forma).
- Opções: (a) tirar o CE do BB; (b) aplicar as regras da planilha e exigir o
  Nº de Manifesto; (c) o BB só preenche CE vazio.
- Recomendação: (a), coerente com "CE só por planilha".

**D-04 — A unicidade CE × B/L passa a ser imposta pelo banco? Vale entre B/L
de carga e B/L de Granito?** (M06)

- Exemplo: o mesmo CE em dois B/Ls ativos, os dois faturados; a ZPT
  desbloqueia os dois.
- Hoje: a ADR 0071 item 9 decidiu a unicidade entre B/Ls não cancelados e a
  nota de implementação registrou a não imposição como "desvio aceito";
  nenhuma camada impõe.
- Opções: (a) índice único parcial em `bls` e gatilho que confere
  `granite_bls`; (b) só aviso na prévia; (c) permitir com justificativa.
- Consequência: (a) recusa as quatro portas e a reativação; duplicatas já
  existentes precisam ser resolvidas antes do índice (em produção, hoje,
  dados de teste); (b) e (c) mantêm o risco na conciliação ZPT.
- Recomendação: (a). As checagens de M06 assumem (a).

**D-05 — "Liberado no Portal" impede apagar o CE?** (ADR 0071 item 5)

- Exemplo: B/L com o CE visível no Portal e sem fatura; o CE é apagado.
- Hoje: só a fatura emitida impede.
- Opções: (a) proibir apagar quando o Cliente tem conta no Portal; (b)
  proibir sempre (só troca); (c) manter.
- Recomendação: apagar somente pelo Administrativo com motivo, nunca por
  importação.

**D-06 — Que proveniência cada valor importado precisa ter?** (P2
Proveniência, M07)

- Exemplo: de qual arquivo e linha veio o CE de um B/L faturado.
- Hoje: só ator, data e justificativa fixa; a justificativa da ficha é
  descartada.
- Opções: (a) lote de importação genérico (arquivo, hash, aba, linha)
  referenciado na auditoria; (b) só ator e data.
- Recomendação: (a); é pré-requisito para responder "quem trocou e por quê".

**D-07 — A emissão pelo CE continua síncrona e em nome de quem importa?**
(M09, M12, M25)

- Exemplo: uma usuária de Documentação importa o CE e a fatura sai em nome
  dela; uma planilha com 200 B/Ls faturáveis passa do tempo e nada é gravado.
- Hoje: emite na mesma transação, com `issued_by` = importador. O CONTEXT diz
  que a emissão é ato do Financeiro.
- Opções: (a) manter a emissão na transação da planilha, otimizada, e
  corrigir o CONTEXT; (b) gravar o CE e calcular na transação e emitir em
  fatias logo em seguida, conduzidas pela tela, com a fila como rede; (c)
  gravar o CE e deixar a emissão para o Financeiro confirmar em lote. Em
  qualquer opção, registrar a emissão como automática ("Sistema — CE
  Mercante"), com o importador como autor do CE, ou atribuí-la ao Financeiro.
- Consequência (Runtime, banco local): (a) teto de ~150 B/Ls faturáveis por
  planilha mesmo otimizada (~40 ms por B/L); (b) planilha de 200 B/Ls grava em
  ~2,5 s e emite em ~1 s por fatia de 25, capacidade ~500, mas o tudo-ou-nada
  passa a valer para o CE e não para as faturas; (c) muda a operação e atrasa
  a cobrança.
- Recomendação: (b), com relatório pós-importação (faturas emitidas, retidas e
  bloqueadas por B/L) e emissão atribuída ao sistema.

**D-08 — Qual é o Nº de Manifesto canônico e quem corrige o vínculo?** (M13)

- Exemplo: `MCE-1`, `mce-1` e `MCE 1` viram três manifestos; um número
  informado no modal da rota e outro na planilha coexistem sem sincronia.
- Hoje: só `btrim`; quatro cadastros; nenhuma tela para mover ou
  desvincular; a planilha correta é recusada; B/L cancelado é vinculado; uma
  linha sem CE bloqueia o lote inteiro; as demais abas são ignoradas.
- Opções: forma canônica (maiúsculas sem separadores, ou validação de formato
  fixo); `manifestos_mercante` como cadastro único e os demais só leitura;
  ação Mover/Desvincular do Administrativo com motivo; B/L cancelado recusado
  ou ignorado com aviso; linha sem CE recusada com mensagem que a nomeia ou
  ignorada pela prévia; várias abas: erro.
- Recomendação: maiúsculas sem separadores; cadastro único; Mover/Desvincular
  com motivo; B/L cancelado ignorado com aviso; linha sem CE nomeada na
  prévia, com opção de ignorá-la; erro com mais de uma aba com dados.

### 6.2 Faturamento e documentos

**D-09 — Como faturar B/Ls de Clientes diferentes que dividem um container, e
o que acontece quando um deles é excluído?** (M03, M24)

- Exemplo: B1 (Cliente A) e B2 (Cliente B) no mesmo container.
- Hoje: só o primeiro da planilha é faturado; o segundo fica bloqueado para
  sempre. Excluir B2 depois deixa a fatura de B1 com 1/2 do container.
- Opções: (a) faturar cada B/L com o rateio vigente; a guarda recusa só
  quando a soma passa de um container ou o rateio muda (protótipo validado);
  (b) emissão conjunta por container; (c) revisão manual obrigatória.
- Recomendação: (a), que é o que CONTEXT e ADR 0020 já descrevem; impedir a
  exclusão do irmão com fatura viva no outro B/L, ou abrir Alerta de
  sub-cobrança.

**D-14 — O recebível calculado antes da fatura deve travar exclusão e
cancelamento do B/L?** (M19)

- Exemplo: B/L sem CE com Taxas calculadas: "documento financeiro emitido" e
  `cancel_bl` recusado.
- Hoje: trava, e o recebível aparece como elegível no Portal quando há CE.
- Opções: (a) travar só com fatura emitida e anular o recebível sem fatura ao
  cancelar o B/L; (b) manter.
- Recomendação: (a).

**D-21 — O documento da fatura emitida congela razão social e rota?** (M23)

- Exemplo: a Base de Clientes muda a razão social; a impressão da fatura
  antiga passa a mostrar o nome novo.
- Hoje: detalhe e impressão leem os dados vivos.
- Opções: (a) congelar Cliente, CNPJ, POL/POD e Viagem na emissão; (b)
  manter.
- Recomendação: (a).

### 6.3 Reimportações

**D-10 — A reimportação de carga solta pode desfazer decisões humanas, trocar
o dono ou mover o B/L?** (M01)

- Exemplo: arquivo sem CNPJ depois da Revisão; CNPJ de outro Cliente sobre B/L
  faturado; número repetido de B/L de outra Viagem.
- Hoje: desfaz o vínculo, troca o dono e reemite sem prévia, move o B/L; e
  ignora correções de POL/POD e shipper.
- Opções: (a) o mesmo contrato do B/L de container (ADR 0017): campos do
  documento atualizam, decisões humanas ficam, troca de dono só com aceite,
  B/L de outra Viagem recusado; (b) só acrescentar B/Ls novos.
- Recomendação: (a). As checagens de M01 assumem preservação, aceite e
  recusa; a atualização de rota e partes depende desta decisão.

**D-11 — Na reimportação de B/L de container, o que o documento pode mudar?**
(M02, M14, P2 de Importar B/L)

- Exemplo: corrigir o shipper apaga a devolução de 10/03; o arquivo sem aba
  VIN apaga os veículos da planilha.
- Hoje: apaga e recria containers e veículos; Laden on Board ilegível apaga a
  data; o e-mail do novo titular vai para o Cliente antigo; o override é
  global por lote; POD fora do catálogo entra nulo como "reviewed"; o NCM
  manual cede ao documento; CPF é impossível.
- Opções e recomendação: preservar por (B/L, container) tudo o que não vem do
  documento e remover só containers ausentes, mostrados na prévia; ausência
  de aba ou campo ilegível = não alterar, com aviso; e-mail vira contato só
  quando o CNPJ do arquivo é o do Cliente vinculado; override por linha; POD
  fora do catálogo bloqueia com mensagem; NCM manual prevalece (ou união);
  Cliente pessoa física só se o negócio atender PF.

**D-22 — Mudar o POD depois do CE é correção ou COD? A reimportação pode
desfazer o COD?** (M22)

- Exemplo: B/L reemitido de BRSSA para BRVIX após o CE; reimportar o arquivo
  original depois do COD.
- Hoje: reemite pelo novo valor e mantém o manifesto antigo; a reimportação
  desfaz o COD; B/L importado depois da Omissão de Escala fica fora do
  transbordo.
- Recomendação: depois do CE, POD só muda pelo fluxo de COD; a reimportação
  não altera o POD de B/L com COD; B/L importado depois da omissão entra no
  transbordo ou é recusado com aviso.

### 6.4 Fila de efeitos, datas e Demurrage

**D-12 — O que fazer com os efeitos acumulados antes de ligar o runner?**
(M04)

- Exemplo: um `vehicle_followup` de semanas atrás cancelaria fatura emitida
  depois; um `demurrage_billing` emitiria Demurrage com datas já corrigidas.
- Hoje: a ativação processa tudo, sem filtro de idade.
- Opções: (a) expirar tudo; (b) revisar a lista antes; (c) processar só os
  recentes; (d) revalidar as pré-condições no consumidor.
- Recomendação: (d) como correção permanente (Etapa 4) e, na ativação,
  expirar os acumulados com uma lista para o Financeiro revisar.

**D-13 — Datas de container: ausência, fonte, alteração depois da cobrança e
unidade.** (M10, M21)

- Exemplo: planilha do terminal só com descarga para container devolvido em
  10/07; planilha nova muda a devolução depois da Invoice de Demurrage.
- Hoje: a devolução vazia apaga; só planilha e edição manual alimentam a
  descarga (a ATA não chega); a alteração depois da Demurrage é aceita sem
  Alerta; as datas são por B/L e podem divergir entre B/Ls do mesmo
  container; a emissão automática está pausada e o botão manual exige
  `overdue`.
- Opções e recomendação: vazio mantém, limpar só com marcador explícito;
  ATA local do POD como padrão, planilha e manual como correção marcada;
  alteração depois da Demurrage emitida aceita com Alerta e pendência de
  cancelamento e reemissão pelo Financeiro (ADR 0077: fatura emitida não muda
  de valor); datas por unidade física (Viagem + container); emissão manual a
  partir da devolução completa enquanto o runner estiver pausado.

### 6.5 Baplie, veículos e demais importações

**D-15 — Regras do Baplie.** (M11, P2 do Baplie)

- Exemplo: container Part Lot em dois B/Ls com IMO no Baplie; operador marca
  "standard" depois de o armador confirmar e o Baplie idêntico volta a OOG.
- Hoje: Part Lot não recebe nada e a tela diz "aplicados"; a correção manual
  é desfeita; a ausência de 8077/DGS apaga SOC/IMO do Baplie anterior; porto
  fora da lista bloqueia o arquivo; qualquer DIM é OOG; navio do TDT não é
  conferido; divergência SOC/COC sem resolução; ISO 6346 não validado.
- Recomendação: aplicar a todas as linhas ativas (ignorando canceladas);
  correção manual protegida, com divergência visível em vez de sobrescrita;
  ausência preserva; importar só PODs das escalas, com aviso não bloqueante;
  OOG só com DIM 5–9 e valor > 0; TDT diferente pede confirmação; resolução
  "vale o B/L" persistida; ISO 6346 como aviso.

**D-17 — Regras de veículos.** (M15, P2 de veículos)

- Exemplo: B/L reimportado sem aba VIN apaga 40 veículos; chassi gravado em
  outro B/L pela heurística `…00` depois do CE.
- Hoje: o B/L substitui a lista; não há correção depois do CE; a desova da
  planilha sobrescreve a manual; o mesmo chassi entra em Viagens diferentes;
  tipos e lacres exigem igualdade estrita.
- Recomendação: a planilha de veículos é a autoridade e o B/L só acrescenta;
  correção auditada pelo Administrativo; desova da planilha só preenche
  vazio; aviso para chassi em outra Viagem; sinônimos ISO (40HQ × 40HC) e
  lacre sem zeros à esquerda; heurística `…00` só com o mesmo Cliente e
  mostrada na prévia; B/L isento anula o recebível sem fatura.

**D-16 — Regras comuns de leitura de planilhas.** (P2 Cabeçalhos)

- Exemplo: "Container" e "Numeração" na mesma planilha; planilha filtrada
  para uma Viagem; CSV Windows-1252 salvo pelo Excel.
- Hoje: escolha silenciosa da coluna; linhas e abas ocultas entram; CSV
  Windows-1252 recusado com instrução sem caminho na tela.
- Recomendação: bloquear colunas duplicadas para o mesmo campo; ignorar
  linhas e abas ocultas com aviso; aceitar Windows-1252 com aviso.

**D-18 — A Base de Clientes vincula B/Ls retroativamente?** (M16)

- Exemplo: B/L rejeitado porque o CNPJ era do despachante.
- Hoje: vincula todo B/L sem Cliente com o CNPJ, inclusive o rejeitado, e não
  muda o estado da reconciliação.
- Recomendação: vincular só os pendentes de Cliente, mostrados na prévia, como
  vínculo por documento; nunca o rejeitado; razão social só com confirmação.

**D-19 — Granito e vazios: a nova planilha substitui a anterior? O CE de
Granito calcula?** (M17, P2 Granito)

- Exemplo: a planilha COSCO da mesma Viagem chega dias depois com o peso
  real.
- Hoje: cria manifesto novo e duplica os B/Ls; o CE de Granito não aciona
  cálculo (a documentação diz que aciona); vazios exigem número novo e
  duplicam.
- Recomendação: atualizar por número de B/L na Viagem preservando CE e
  Cliente; manter o cálculo de Granito manual e corrigir a documentação, a
  menos que o negócio queira emissão no CE; vazios substituem o manifesto da
  mesma rota preservando a natureza.

**D-20 — Quem pode importar o quê?** (M25)

- Exemplo: um usuário de Equipamentos importa veículos e origina
  cancelamento de fatura; a planilha de CE emite fatura em nome de quem
  importou.
- Hoje: qualquer usuário ativo executa todas as importações.
- Recomendação: restringir a planilha de CE e as reimportações com override
  aos Departamentos que o negócio indicar; manter as demais para todo usuário
  ativo.

### 6.6 Decisões por etapa

| Etapa do plano | Decisões que a destravam por inteiro |
|---|---|
| 1 — Carga solta | D-03, D-10 (a preservação já tem checagem e não espera) |
| 2 — B/L de container | D-11 |
| 3 — Leitura de planilhas | D-16 (as datas e números já têm checagem) |
| 4 — Fila de efeitos | D-12 |
| 5 — Container compartilhado | D-09 |
| 6 — Unicidade e portas do CE | D-02, D-03, D-04 |
| 7 — Faturas, Demurrage e Comunicado | D-13, D-14 |
| 8 — Contrato da importação de CE | D-01, D-05, D-06, D-07, D-08 |
| 9 — Baplie | D-15 |
| 10 — Viagem Cancelada, COD, documento e papéis | D-20, D-21, D-22 |
| 11 — Veículos, Base de Clientes, Granito, vazios | D-17, D-18, D-19 |

## 7. Testes

### 7.1 O que a cobertura existente não prova

- **12 suítes Postgres reais ficam fora do CI**, 8 delas de importação:
  `baplieFlagsOnBlImport`, `blCbmSemantics`, `blDocumentalGates`,
  `ceMercanteAutoBilling` (a única que prova CE → fatura), `containerOwnership`,
  `containerProfile`, `cronDispatchTimeout`, `customerCommunicationPartial`,
  `customerCommunicationReadinessGuards`, `pixBrCode`, `portalBillingRelease`
  e `voyageHardDeleteGuard`. Todas passam isoladas (Runtime); `blCbmSemantics`
  falha depois de `containerOwnership` (próximo item). [TST-02]
- **Isolamento:** `containerOwnership` apaga o Cliente em modo réplica sem
  apagar `customer_portal_accounts`; o órfão com CNPJ fixo quebra o
  `beforeAll` de `blCbmSemantics` e `pr698ClaudeReview`. Incluir a suíte no
  CI na ordem errada deixaria o gate vermelho. [TST-03]
- **Ordem:** o CI diz que a bateria financeira roda por último, mas o Vitest
  reordena os arquivos (com cache, falhas e lentas primeiro; sem cache, as
  maiores). Na lista atual ela roda em 3º. [TST-V03]
- **Sondas que se autoexcluem:** blocos com `describe.skip` quando a função
  sondada não existe, mesmo com `LOCAL_PG_INTEGRATION=1`; renomear uma RPC de
  importação apaga a cobertura sem falhar o gate. O bloco 080 de
  `alinhamentoPermissoes` está pulado para sempre. [TST-04]
- **Contratos textuais de migrations mortas:** `src/test/setup.ts` redireciona
  a leitura para `migrations_archive`; 251 de 339 referências a migrations em
  testes apontam para arquivos arquivados. `breakbulkImportCeMigration.test.ts`
  passa lendo a `304` arquivada, que preserva o CE, enquanto a função efetiva
  o apaga (M01). [TST-01, TST-05]
- **Código sem chamador testado:** `maybeAutoBillAfterCeMercante` (8 casos) e
  os hooks de manifesto. O alerta por B/L da ADR 0041 só existe nesse
  caminho. [TST-06]
- **Relações entre importações quase sem teste em banco real:** CE
  sobrescrito depois da fatura, do Portal ou da ZPT; CE duplicado; BB depois
  do CE; CE de Granito; CE → Comunicado; RPCs de veículos, Granito e vazios.
  [TST-15, BL-22]

### 7.2 Cenários ainda sem checagem

Ficam sem `it.fails` os defeitos cujo comportamento correto depende de decisão
(seção 6) e os que exigem navegador ou Edge Function:

- troca de CE depois de faturado ou comunicado (D-01), apagamento de CE
  liberado no Portal (D-05), proveniência (D-06);
- Manifesto Mercante canônico e mover/desvincular (D-08);
- prévia de antes → depois de CE e de datas; relatório pós-importação (M07,
  M09), que exigem UI;
- desempenho da planilha de CE (M12): a medida está na seção 5, mas um teste
  de tempo no CI seria instável; a aceitação é por medida no banco local;
- Baplie Part Lot e correção manual (D-15), veículos (D-17), Base de Clientes
  (D-18), Granito e vazios (D-19);
- Viagem Cancelada (M20), Demurrage revista (M21), COD (M22), documento da
  fatura (M23), exclusão de irmão (M24), papéis (M25);
- Edge Functions reais (`import-effects-runner`, envio de comunicados, Régua).

### 7.3 Checagens novas desta revisão

Cada `it.fails` reproduz um defeito confirmado e **passa enquanto o defeito
existir**. Cada caso traz, no título, os ids dos achados e a regra que fixa o
comportamento esperado. Ao lado de cada `it.fails` há um `it` de cenário que
confere as pré-condições, para que o `it.fails` não passe por motivo errado
(fixture quebrada, função renomeada). A correção que resolver o defeito troca
`it.fails` por `it`; a troca é o critério de aceitação da etapa.

| Arquivo | Casos | Problema |
|---|---|---|
| `src/integration/auditoriaImportacaoCargaSolta.local-pg.test.ts` | 6 `it.fails` + 1 guarda de regressão | M01 |
| `src/integration/auditoriaImportacaoBlContainer.local-pg.test.ts` | 6 | M02, M14 |
| `src/integration/auditoriaCeContainerCompartilhado.local-pg.test.ts` | 4 | M03, M10 (datas do irmão) |
| `src/integration/auditoriaEfeitosImportacao.local-pg.test.ts` | 5 | M04 |
| `src/integration/auditoriaCeUnicidadeValidacao.local-pg.test.ts` | 8 | M06, M08 |
| `src/integration/auditoriaFaturasDemurrageComunicado.local-pg.test.ts` | 6 | M18, M19, M10 |
| `src/services/__tests__/auditoriaLeituraPlanilhas.test.ts` | 9 | M05 |

Total: 44 `it.fails`. As seis suítes `local-pg` foram acrescentadas ao passo
"Run SQL contract suites" do CI, antes da bateria financeira, cada uma com ids
e CNPJs sintéticos do próprio namespace (`A201`–`A207`). A suíte unitária roda
em `npm test`.

Para rodar localmente:

```bash
sudo scripts/setup-local-pg.sh --reset
LOCAL_PG_INTEGRATION=1 \
LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vela_test \
  npx vitest run --no-file-parallelism src/integration/auditoria*.local-pg.test.ts
npx vitest run src/services/__tests__/auditoriaLeituraPlanilhas.test.ts
```

### 7.4 Resultado das execuções

- **Teste (local-pg):** as 46 suítes do CI mais as 6 novas, num banco recém
  recriado, `--no-file-parallelism`: 377 passaram, 35 falhas esperadas
  (`it.fails`), 1 pulado (o bloco 080 de TST-04). Repetido em ordem invertida
  com o mesmo resultado, para descartar dependência de ordem e resíduo de
  fixture.
- **Teste (`npm test`):** 720 arquivos passaram e 64 foram pulados (os
  `local-pg` sem a variável); 4.173 testes passaram, 9 falhas esperadas (a
  suíte unitária nova) e 493 pulados.
- `npm run typecheck` e `npm run lint` limpos nos arquivos novos.

## 8. Documentação viva divergente

Corrigido nesta mudança (comportamento atual confirmado por Código ou
Runtime):

| Documento | Antes | Agora |
|---|---|---|
| `docs/operations/regras-de-negocio.md` (prontidão do Portal) | a exceção da `051` deixava o CE emitir sem Portal | a `083` e a ADR 0070 revogaram a exceção: sem Portal, o CE calcula e retém |
| `docs/RASTREABILIDADE.md` (`/granito`, `apply_granite_ce_mercante_update`) | o CE de Granito dispara `runGraniteBatch`; "o chamador agenda o workflow" | o CE de Granito não dispara cálculo; o cálculo roda pela Validação (D-19) |
| `docs/RASTREABILIDADE.md` (`apply_ce_mercante_update`) | "o chamador agenda cálculo + emissão" | o gatilho do banco emite na mesma transação e a função enfileira `local_billing` |
| `docs/RASTREABILIDADE.md` (Baplie, texto e catálogo de RPCs) | a RPC exige administrador | exige usuário interno ativo desde a `077` (ADR 0046) |
| `docs/modules/demurrage.md` (Importar Datas, texto e tabela) | emissão no navegador por `createInvoiceForReturnedBL`; "falha interrompe o import" | atômico por B/L; enfileira `demurrage_billing`; runner pausado; função sem chamador |
| `docs/modules/manifesto-edi.md` (datas) | "falha interrompe"; "sem auditoria própria" | atômico por B/L, auditado e enfileirado; devolução vazia apaga (M10) |
| `docs/modules/manifesto-edi.md` (B/L avulso e BB) | "CE ausente não apaga"; "service filtra B/Ls incompatíveis"; "B/L existente como container reverte" | regra mantida e marcada como defeito conhecido (M01); `invalidBls` nunca preenchido |

A corrigir junto com a correção ou a decisão correspondente (o texto descreve a
regra desejada, e a correção a tornará verdadeira, ou depende de decisão):

| Documento | Divergência | Quando |
|---|---|---|
| `CONTEXT.md` — Faturamento (irmãos de container recebem o CE juntos e o rateio fica correto) | só o primeiro é faturado | Etapa 5 |
| `CONTEXT.md` — CE × B/L 1:1 | não imposto | Etapa 6 (D-04) |
| `CONTEXT.md` — "CE só por planilha" × `manifesto-edi.md:157` e ADR 0071 item 5 (ficha) | regras vigentes se contradizem | Etapa 6 (D-02) |
| `CONTEXT.md` — emissão é ato do Financeiro | a planilha de CE emite em nome de quem importa | Etapa 8 (D-07) |
| `CONTEXT.md` — Trava de exclusão | implementação segue as regras antigas | Etapa 6 |
| `CONTEXT.md:2172-2179` — indicação de devolução | indicação removida | Etapa 7 (D-13) |
| `docs/modules/manifesto-edi.md:91,281` (CE e manifesto) | Nº de Manifesto e cadastros | Etapa 8 (D-08) |
| `docs/modules/granito.md:104,106` | sugere atualização entre importações; reimportação duplica | Etapa 11 (D-19) |
| `docs/modules/demurrage.md:310-313,371-376` | emissão síncrona e semântica de `demurrage_status` | Etapa 7 |
| `docs/modules/viagens.md:70,122` | CE Master e marca `linked` como manifesto | Etapa 8 (D-08) |
| ADR 0041 decisão 3 | o alerta `billing_auto_issue_failed` só existe em código sem chamador | Etapa 8, por nota editorial |

## 9. Não verificado

- **Produção e Preview:** nenhum acesso remoto foi feito. Antes de ligar o
  `import-effects-runner`, o dono do projeto deve contar, em leitura, os
  efeitos pendentes por tipo e idade e os B/Ls com o mesmo CE (Etapa 0 do
  plano).
- **PostgREST e tempo-limite reais:** o `statement_timeout` de 8 s é o valor
  citado em `blFreightImport.ts:541-543`, não medido (Suspeita). Rede e
  tabelas infladas além de `bls` não foram medidas.
- **Edge Functions e envio:** `import-effects-runner`,
  `customer-communication-auto-runner`, `send-customer-communication`,
  `portal-daily-digest` e `demurrage-dunning` não rodaram; só as RPCs
  produtoras. A renderização de `{{bl_list}}` com B/L cancelado, o digest com
  "R$ 0.00" e o lease real do runner ficam por provar.
- **Arquivos reais:** todos os arquivos foram sintéticos. Confirmar com
  amostras anonimizadas: CE em célula numérica ou Geral, data curta
  (numFmt 14), DIM/NAD/8249 no Baplie, abas ocultas e cabeçalhos duplicados.
- **Navegador real:** as telas foram exercitadas em jsdom com Supabase
  simulado; o fluxo de usuário completo não foi observado.
- **Concorrência entre tipos:** reimportação de B/L × planilha de datas ou de
  veículos, flags do Baplie × reimportação, BB × planilha de CE (Suspeita).
- **Reativação de Viagem cancelada** depois de efeitos bloqueados e
  comunicados "simulados" (Suspeita).
- **Relatórios** (`/relatorios`) e totais do Relatório de Partida da Agência:
  só leitura de código; o ADR não filtra B/L cancelado e soma duplicatas de
  Granito e vazios (Código).
- **Portal:** cache de 30 s sem foco; uma importação interna não invalida a
  tela aberta do Cliente (Código; risco de exibição, os valores são
  revalidados no banco).

## 10. Índice dos achados

Os ids individuais vêm das frentes de investigação (CE- planilha de CE, CED-
efeitos do CE, BL- Importar B/L, BAP- Baplie, VEI- veículos, DAT- datas, INF-
leitura e infraestrutura comum, OUT- outras importações e edição manual,
ORDCE- e ORDCT- ordens de importação, TST- testes e documentação); o sufixo
`-V` indica achado novo do verificador; `F5-N01` veio do revisor das
checagens. Os relatórios completos de cada frente ficam fora do repositório
(pasta de trabalho da sessão); este índice preserva a rastreabilidade de cada
id até o problema-raiz.

| Problema | Achados |
|---|---|
| M01 | BL-01, BL-12, BL-16, CED-03, OUT-01, OUT-02, OUT-03, OUT-12, OUT-V01, OUT-V03, ORDCE-02, ORDCE-03, ORDCE-V02, TST-01, TST-11 |
| M02 | BL-02, BL-04, BL-05, BL-13, BL-20, BL-V01, DAT-03, ORDCT-01, ORDCT-02, ORDCT-03, ORDCT-13, ORDCT-19, ORDCE-06, ORDCE-11, VEI-04 |
| M03 | CED-01, CED-09, DAT-10, ORDCE-01, ORDCE-V03, ORDCT-09, ORDCT-V03 |
| M04 | VEI-01, VEI-02, BAP-V01, INF-05, INF-06, INF-07, INF-14, INF-V01, CE-V04, CED-14, ORDCE-07, ORDCE-V04, TST-V01, DAT-06, DAT-V01 |
| M05 | DAT-01, DAT-14, INF-01, INF-02, INF-19, INF-V02, VEI-13, F5-N01 |
| M06 | CE-01, CE-V03, CED-06, ORDCE-05, OUT-10, TST-07 |
| M07 | CE-02, CE-V02, CED-02, INF-18, ORDCE-09, OUT-08, TST-08 |
| M08 | CE-14, CED-11, ORDCE-04, ORDCE-16, OUT-04, OUT-15, TST-13 |
| M09 | CE-04, CED-04, CED-12, CED-V01, CED-V02, INF-08, ORDCE-10, ORDCE-13, TST-09 |
| M10 | DAT-02, DAT-04, DAT-05, DAT-07, DAT-09, DAT-11, DAT-12, DAT-15, DAT-16, DAT-V02, ORDCT-06, ORDCT-07, ORDCT-08, ORDCT-18, ORDCT-V02, ORDCT-V04, VEI-V02 |
| M11 | BAP-01, BAP-02, BAP-08, BAP-10, BAP-11, BAP-12, BAP-V02, BAP-V03, ORDCT-05, ORDCT-10, ORDCT-11, ORDCT-12, ORDCT-14, ORDCT-17 |
| M12 | CE-V01, CED-10, ORDCE-V01, BAP-04 |
| M13 | CE-03, CE-10, CE-12, BL-10, ORDCE-08, ORDCE-12, ORDCE-15, OUT-09, TST-10 |
| M14 | BL-03 |
| M15 | VEI-03, VEI-V01 |
| M16 | OUT-05, INF-V03, INF-20 |
| M17 | OUT-06, OUT-07, OUT-13, OUT-V02, BAP-05, BAP-06, ORDCT-15 |
| M18 | CED-05, ORDCT-V01 |
| M19 | CED-07, CED-08, ORDCE-14, BAP-V04; crítica: B/L cancelado nos comunicados |
| M20 | crítica: Viagem Cancelada |
| M21 | crítica: Demurrage depois de corrigir datas |
| M22 | crítica: COD × reimportação |
| M23 | crítica: documento da fatura lido de dados vivos |
| M24 | crítica: exclusão do irmão de container compartilhado |
| M25 | crítica: permissões por Departamento |
| P2 — cabeçalhos e abas | CE-06, INF-03, INF-04 |
| P2 — CE numérico | CE-05, INF-15, CE-V05 |
| P2 — Importar B/L | BL-06, BL-07, BL-08, BL-09, BL-11, BL-14, BL-15, BL-17, BL-18, BL-19, BL-21 |
| P2 — veículos | VEI-05 a VEI-12, VEI-V03, ORDCT-04 |
| P2 — Baplie | BAP-03, BAP-07, BAP-09, BAP-13 a BAP-20, ORDCT-16 |
| P2 — concorrência | CE-09, INF-10, ORDCE-13, BAP-14 |
| P2 — paginação | BAP-07, DAT-13, INF-13 |
| P2 — proveniência | CE-11, INF-09, CED-15 |
| P2 — ATA e fuso | DAT-08 |
| P2 — programação | OUT-14 |
| P2 — mensagens | INF-11, INF-12, OUT-11 |
| P2 — Granito | CE-07, CE-08 |
| P2 — limite de upload | TST-14 |
| Testes | TST-02 a TST-06, TST-15, TST-V03, BL-22 |
| Documentação | TST-12, DAT-17, CE-08, OUT-V03 |
| Refutados ou sem caminho de usuário | CE-13, INF-16, INF-17 |
