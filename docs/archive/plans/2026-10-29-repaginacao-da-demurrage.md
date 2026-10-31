# Repaginação da Demurrage

## Estado

Proposto em 2026-10-29 a partir das decisões do dono na
[ADR 0112](../../adr/0112-repaginacao-da-demurrage.md) (D1 a D21), tomadas sobre a
[revisão de Demurrage de 2026-10-29](../../archive/audits/2026-10-29-revisao-demurrage-telas-elegibilidade-relatorios.md).
Executado de 2026-10-29 a 2026-10-30 na PR luccafwlog/vela#1113. As seis decisões complementares (P1 a P6) foram respondidas
pelo dono no mesmo dia (D22 a D27 da ADR) e estão em
[Decisões complementares](#decisões-complementares). As de tipos de container e
tarifas (D28 a D34) entram no lote 0B.

| Lote | Situação |
|---|---|
| 0 — Correções que não esperam a repaginação | Feito em 2026-10-29 |
| 0B — Tipos de container e tarifas por grupo | Feito em 2026-10-29 (migration `514`) |
| 1 — Classificação da cobrança no banco | Feito em 2026-10-29 (migration `515`) |
| 2 — Aba Containers, cartões e aviso do cabeçalho | Feito em 2026-10-30 (migration `516`; Exportar entra no lote 6) |
| 3 — B/L cancelado e dispensa da cobrança | Feito em 2026-10-30 (migration `517`) |
| 4 — Faturas, Pagas e Canceladas | Feito em 2026-10-30 (migration `519`; a `518` completa o lote 3) |
| 5 — Por Cliente e extrato do Cliente | Feito em 2026-10-30 (sem migration; Esperando sem coluna, como em D11) |
| 6 — Relatórios | Feito em 2026-10-30 (sem migration; Exportar em cada aba da central) |
| 7 — Disputas | Feito em 2026-10-30 (migration `520`) |
| 8 — Caixa dividida entre Clientes (rateio) | Feito em 2026-10-30 (migration `521`; item emitido antes fica cheio) |
| 9 — Container que vira SOC depois de faturado | Feito em 2026-10-30 (migration `522`) |
| 10 — Fechamento | Feito em 2026-10-30 (revisão independente; migration `523` corrige os gatilhos do rateio) |

## Resultado pretendido

Na página **Demurrage**:

- **Aba Containers.** Tem as divisões **Correndo**, **A emitir**, **Esperando**
  e **Travado**, cada uma com o número de caixas e o US$ previsto. Cada caixa
  aparece num lugar só.
  - A caixa entra no dia seguinte ao fim do free time, ou na hora em que o free
    time muda.
  - Sai quando a Invoice que a cobra é emitida.
  - A caixa que o sistema não consegue cobrar fica em **Travado**, com o motivo
    e o botão que destrava.
  - A linha do B/L mostra B/L, Cliente, Navio / Viagem, Containers (fora,
    devolvidos e total do grupo), US$ previsto hoje e **Próximo passo / motivo**.
- **Cartões do topo.** **Correndo**, **A emitir**, **Travado**, **Aguardando
  pagamento** e **Disputas aguardando resposta**.
- **Abas de Invoice.**
  - **Faturas** ganha Desconto, Em aberto há e os filtros rápidos.
  - **Pagas** ganha Meio de pagamento, ROE do pagamento e Dias até pagar.
  - **Canceladas** mostra motivo, quem cancelou e o destino das caixas.
- **Por Cliente.** Mostra também o que ainda não foi faturado. **Imprimir
  relatório** vira o extrato de um Cliente.
- **Disputas.** Viram tabela, com a conversa embaixo da linha. A Disputa é
  cancelada junto com a Invoice, e o prazo de resposta é de 1 dia útil, com
  Alerta.

Fora da página Demurrage:

- **`/relatorios`** tem Exposição, Invoices (corrigido) e Itens por container,
  e cada aba da central exporta o que mostra.
- **Cancelar B/L** é recusado enquanto houver sobreestadia de caixa devolvida
  sem Invoice.
- **Caixa dividida entre Clientes:** cada um paga uma parte igual (D19).
- **Container que vira SOC depois de faturado:** segue a regra das datas
  alteradas (D20).
- **Tarifas e acordos:** mostra uma linha por grupo de tarifa, com os códigos
  que cada um cobre, e ganha o cadastro **Tipos de container** com os códigos
  dos B/Ls. Todo container dos B/Ls de hoje acha tarifa, e o tipo novo é
  avisado na importação (D28 a D34).

**Fora do escopo:**

- Mostrar Demurrage no Portal antes da Invoice (D21).
- Relatório de recebimentos.
- Mudar a Régua de Cobrança, o recálculo pela PTAX ou a conciliação.
- Busca unificada entre as abas (não decidida).
- Achados da revisão que não foram decididos: exportação do Portal com USD
  bruto, link das notificações do Portal, histórico da Conciliação sem a baixa
  cancelada.

## Fontes de verdade e restrições

- **Regra vigente.** [Demurrage](../../modules/demurrage.md),
  [Portal do Cliente](../../modules/portal-cliente.md) (Disputas),
  [Operação e Suporte](../../modules/operacao-suporte.md) (`/relatorios`) e a
  [matriz de permissões](../../operations/seguranca.md#demurrage-e-granito).
  Decisões nas ADRs 0014, 0079, 0080, 0085, 0088 e 0112.
- **Código que manda hoje.** As definições vigentes estão na `staging`.
  - **Classificação da aba Containers:** feita no navegador.
    - `listDemurrageContainers` lê `bl_containers` com `demurrage_status IN
      ('overdue','returned')`, mais as caixas com item de Invoice viva.
    - `buildBillingGroups` e `blBillingState` montam o grupo.
    - O filtro `monitored` de `DemurrageContainersTab.tsx` tira o devolvido no
      free time.
  - **Status do container:** `_container_demurrage_status` (migration `211`)
    pelo gatilho de `bl_containers` (`197`). Também pelo job
    `container-demurrage-status` (`17 3 * * *` UTC) e pelo gatilho de
    cancelamento de B/L e Viagem (`200`).
  - **Emissão:**
    - `issue_demurrage_invoice_for_bl` e `create_demurrage_invoice_authoritative`
      (`472`; a `509` só troca mensagens);
    - `_calculate_demurrage_invoice_authoritative` (`191`);
    - `_demurrage_billed_container_keys` (`214`);
    - trava de emissão `_demurrage_issue_block_reason` (`484`).
  - **Reconciliação de datas:** `_after_container_dates` (`214`) e
    `_reconcile_demurrage_after_dates` (`484`).
  - **Cancelamento:** `cancel_bl` (`372`) com `bl_open_financial_reasons`
    (`362`); `cancel_demurrage_invoice` (`012`/`509`).
  - **Disputas:**
    - lista interna `_list_demurrage_disputes_internal_impl_20260920` (`472`);
    - Portal `portal_add_dispute_message` (`473`) e
      `portal_request_dispute_reopen` (`426`);
    - interno `add_demurrage_dispute_message` e `reopen_demurrage_dispute`.
  - **Leituras do navegador:**
    - KPIs e Por Cliente em `demurrageKpis.ts`, sem paginação;
    - abas de Invoice em `listDemurrageInvoices`, sem paginação;
    - relatório em `fetchDemurrageReport` e `exportDemurrageReportWorkbook`;
    - ficha do B/L em `BlDemurrageSection.tsx`;
    - ficha do Cliente em `customerContainers.ts`.
  - **SOC/COC:** `set_bl_container_ownership` (`205`) e a importação do Baplie
    (`194`).
  - **Tipo do container e tarifa:**
    - a importação de B/L grava o tipo como vem no arquivo, sem conferir
      (`parseContainers` em `blParser.ts`);
    - o grupo de tarifa vem de uma lista fixa de 26 códigos, igual no
      navegador (`DEMURRAGE_ALIAS_GROUPS` em `demurrageRates.ts`) e no banco
      (`_demurrage_canonical_type`, `138`);
    - o cálculo, o status e o Portal usam uma tarifa por grupo
      (`_active_demurrage_rates`, `138`; `_portal_information_core`, `138`),
      e a tela `DemurrageRates.tsx` lista todas as linhas;
    - a tarifa aceita qualquer texto como tipo (`DemurrageRateModal.tsx`).
- **Dados de produção** (leitura de 2026-10-29, autorizada pelo dono;
  staging tem os mesmos dados): 867 containers em B/Ls, com os tipos 48FR
  (347), 40HC (317), 40FM (132), 40FP (55) e 20GP (16). Os 534 de 48FR, 40FM e
  40FP não acham tarifa; nenhum tinha descarga gravada. As 12 linhas de
  `demurrage_rates` são as da carga inicial (migration `006`), e o cálculo usa
  6: 20HC, 20RF, 20FR, 40GP, 40RF e 40OT.
- **Restrições do repositório** (`AGENTS.md`):
  - Migrations existentes e `src/types/database.ts` são protegidos. RPC nova
    segue o padrão já usado nos serviços de Demurrage (`supabase.rpc('…' as
    never, …)`), ou pede autorização para regenerar os tipos.
  - Migration que reescreve linhas existentes declara no cabeçalho que depende
    da linha "Data status" do `AGENTS.md`.
  - PR de cada lote contra `staging`.
  - Toda mudança visível ao operador atualiza o
    [Manual do Operador](../../manual/README.md) e a matriz de cobertura no mesmo
    PR (ou no PR do manual, enquanto ele estiver aberto).

## Decisões complementares

Respondidas pelo dono em 2026-10-29 (D22 a D27 da ADR 0112).

- **P1 — Caixa que passa a ser dividida depois da emissão (lote 8; D22).** Segue
  a regra das datas alteradas: a Invoice sem pagamento, desconto ou disputa é
  cancelada e reemitida com a parte nova; a paga, com desconto ou em disputa
  sai da Régua com Alerta para restituir ou cobrar a diferença. Vale também
  quando o B/L de um dos Clientes é cancelado.
- **P2 — Condições diferentes entre os Clientes da caixa (lote 8; D23).** Cada
  Cliente calcula a caixa pela própria condição (B/L, acordo ou tabela) e paga
  a parte igual desse valor.
- **P3 — Quem dispensa a cobrança de uma caixa (lote 3; D24).** Qualquer
  Departamento, com justificativa, como o desconto.
- **P4 — Alerta de Travado (lote 2; D25).** Abre na hora em que a caixa entra
  em Travado, para o setor do motivo:
  - Documentação: sem CE, sem Cliente ou Portal fechando o faturamento, como o
    `review_portal_not_ready`;
  - Administrativo: tipo sem tarifa ou fora do cadastro, e B/L cancelado.
- **P5 — B/L cancelado com container ainda fora e em atraso (lote 3; D26).**
  Recusado também, até a devolução e a Invoice, ou a dispensa.
- **P6 — Tipo sem tarifa (lote 1; D27).** Entra em Travado desde a descarga, com
  o motivo "tipo sem tarifa" e **Cadastrar tarifa**.

## Lotes

### 0 — Correções que não esperam a repaginação

Defeitos da revisão que contrariam o ciclo decidido (D3) e não mudam o desenho.

- **Ficha do B/L › Faturamento › Demurrage.**
  - A caixa já cobrada mostra a Invoice e a situação dela ("DEM-… emitida", "…
    paga"), não "a faturar".
  - O B/L que não emite a Invoice do grupo mostra a Invoice do grupo.
  - O dado principal separa cobrado, a emitir e correndo.
- **Ficha do Cliente › Contêineres.** Não mostra "correndo" para container de
  Viagem cancelada.
- **Paginação.** As abas Faturas, Pagas e Canceladas, Por Cliente e o cartão
  **Aguardando pagamento** leem todas as páginas, sem corte em 1000.
- **Código morto.** Sai a consulta de `draft` dos KPIs (`draftInvoicesTotalUsd`).

**Aceite:**

- Num grupo de dois B/Ls com container compartilhado, as fichas dos dois
  mostram a mesma Invoice.
- A caixa paga não aparece como "a faturar".
- Com mais de 1000 Invoices emitidas no banco local, a aba conta todas.

**Arquivos:**
`BlDemurrageSection.tsx`, `BlDetalhe.tsx`, `customerContainers.ts`,
`demurrageInvoices.ts`, `demurrageKpis.ts` e os testes deles.

### 0B — Tipos de container e tarifas por grupo

Sai antes do lote 1, porque a classificação lê o grupo de tarifa daqui.

- **Cadastro Tipos de container** (D29, D34). Fica em **Tarifas e acordos**,
  com código, descrição, grupo de tarifa e situação (ativo ou inativo).
  - Qualquer Departamento inclui e edita; desativar e excluir, só o
    Administrativo, como nas tarifas.
  - Tabela nova no banco; o banco recusa código repetido e grupo inexistente.
- **Carga inicial** (D30, D33).
  - 20' dry: 20GP e 20HC.
  - 20' especial: 20OT.
  - 40' dry: 40HC.
  - 40' especial: 40FR, 40OT, 40FH, 40FM, 40FP, 40FW, 40EW, 48FR e 48FP.
  - Os códigos da lista fixa antiga que não estão nos B/Ls (22G1, 45G1, 45R1,
    20RF, 40RF…) entram também, no mesmo grupo de hoje, para nada que já
    calculava deixar de calcular. Os grupos de reefer ficam.
- **Grupo de tarifa vem do cadastro.**
  - `_demurrage_canonical_type` lê o cadastro no lugar do `CASE`.
  - O navegador carrega o mesmo cadastro, e a lista `DEMURRAGE_ALIAS_GROUPS`
    sai de `demurrageRates.ts`.
  - O tipo fora do cadastro não tem grupo, e portanto não tem tarifa.
- **Uma tarifa por grupo** (D28).
  - `demurrage_rates` passa a guardar o grupo, e o banco recusa duas tarifas
    ativas no mesmo grupo com vigência sobreposta, como já faz com os acordos.
  - A migration tira as linhas repetidas (20GP, 20RQ, 20OT, 40FR, 40HC e
    40RQ), mantendo a linha que o cálculo usa hoje, sem mudar nenhum valor.
    Declara no cabeçalho que depende da linha "Data status" do `AGENTS.md`.
  - A tela mostra uma linha por grupo, com os códigos que ele cobre. O Portal
    passa a mostrar o nome do grupo e os códigos, em vez de um código só
    ("40FR").
- **Tipo novo na importação** (D31, D32).
  - A prévia da importação do B/L avisa "tipo … sem tarifa de Demurrage:
    cadastre o tipo em Tarifas e acordos".
  - O B/L entra mesmo assim, e o container cai em Travado com Alerta (lotes 1
    e 2).
  - Os 13 códigos atuais ficam nos grupos de D30. 45 pés, tanque e os demais
    ganham grupo próprio quando aparecerem, com tarifa cadastrada.

**Aceite:**

- No banco local com os dados de produção (tipos 48FR, 40FM, 40FP, 40HC e
  20GP), todo container acha tarifa: os 534 dos três primeiros cobram como
  40' especial (US$ 100/140).
- Editar a tarifa do grupo 40' dry muda o cálculo de um 40HC.
- Uma segunda tarifa ativa do mesmo grupo na mesma vigência é recusada.
- Importar um B/L com o tipo 45HC mostra o aviso na prévia e grava o B/L.
- O Portal mostra os mesmos grupos e valores da tela do Vela.

**Checks:** `npm run migrations:check`, `npm run rpc:check`, gates de aplicação e
tela; `calculateDemurrage.test.ts` e `DemurrageRates.behavior.test.tsx` refeitos;
`portalInformation.local-pg.test.ts`, `tariffDeactivate.local-pg.test.ts`,
`permissoesPorPerfil.local-pg.test.ts` (linha nova na matriz) e
`demurrageAuthority.local-pg.test.ts`.

**Documentos:**
- [Demurrage](../../modules/demurrage.md): `/demurrage/taxas`, Tarifa, free time,
  P1 e P2, e aliases ISO;
- o glossário (`CONTEXT.md`: Tipo de container, Grupo de tarifa);
- a [matriz de permissões](../../operations/seguranca.md#demurrage-e-granito);
- o Manual do Operador.

### 1 — Classificação da cobrança no banco

Fundação dos lotes 2, 5 e 6. Cumpre a promessa dos `ponytail:` de
`demurrageContainers.ts` ("RPC de leitura que devolva o estado do grupo por
B/L").

**Leitura nova.** Uma leitura para usuário interno ativo (nome a definir no
lote, por exemplo `list_demurrage_billing_board`) devolve, por grupo de
cobrança (`demurrage_group_bl_ids`):

- âncora e B/Ls do grupo;
- Cliente e Viagem;
- as caixas não-SOC sem Invoice viva, cada uma com descarga, devolução, tipo,
  dias, free time e origem (B/L, acordo, tabela), 1º e 2º período e US$ previsto
  hoje;
- a divisão e o motivo do grupo;
- os totais por divisão.

O cálculo usa a mesma resolução da emissão (`_calculate_demurrage_invoice_authoritative`,
com a data de hoje no lugar da devolução para a caixa fora). A classificação é
lida na hora, sem depender do status gravado.

**Regras da divisão, pela ordem:**

1. **Travado**, para o grupo em que:
   - alguma caixa tem tipo sem tarifa (fora do cadastro do lote 0B, ou grupo
     sem tarifa vigente) e nem o B/L nem o acordo dão free time, desde a
     descarga (D27); ou
   - todas as caixas voltaram e a emissão está travada (`_demurrage_issue_block_reason`:
     sem CE Mercante ou Gate do Portal fechado); ou
   - falta o Cliente; ou
   - o B/L está cancelado (só casos antigos ou com dispensa pendente, depois do
     lote 3).

   O motivo vai junto.
2. **Correndo:** alguma caixa do grupo está fora e passou do free time.
3. **Esperando:** nenhuma caixa fora passou do free time, alguma caixa fora está
   no free time e alguma caixa devolvida tem sobreestadia sem Invoice. O motivo
   nomeia a caixa que falta e o último dia livre.
4. **A emitir:** todas as caixas não-SOC do grupo voltaram, e alguma caixa sem
   Invoice tem sobreestadia maior que zero.
5. **Fora da aba:** o resto. Tudo coberto por Invoice viva, nenhuma caixa
   passada do free time e nenhuma devolvida com sobreestadia, ou só devolvidas
   no free time.

Em Correndo e Esperando, o motivo que vai travar a emissão (sem CE, sem Cliente)
já aparece como aviso no **Próximo passo**, para a equipe resolver antes da
devolução.

**Status gravado na hora (D2).** Gatilhos novos refazem `demurrage_status` dos
containers sem devolução afetados quando muda:

- `bls.free_time_override` ou `bls.customer_id`;
- um acordo de `customer_demurrage_agreements` (inclusão, alteração ou
  exclusão);
- uma tarifa de `demurrage_rates` (tipo, free time, ativa, vigência).

O job da madrugada fica como rede de segurança. O cartão, o aviso do cabeçalho e
a ficha do Cliente passam a concordar com a aba.

**Aceite (Teste local-pg, suíte nova):**

- Cada cenário da [revisão](../../archive/audits/2026-10-29-revisao-demurrage-telas-elegibilidade-relatorios.md)
  (A12, casos 1 a 17) cai na divisão esperada.
- O free time do B/L reduzido, o acordo desativado e a tarifa criada põem o
  container em Correndo na mesma transação.
- A caixa com Invoice viva não aparece.
- A caixa de Invoice cancelada volta para A emitir.

**Checks:** `npm run migrations:check`, `npm run rpc:check`, suíte local-pg
nova e as de Demurrage existentes (`demurrageCobrancaPorCaixa`,
`auditoriaFaturasDemurrageComunicado`, `revisaoFinalDemurrage`,
`correcoesRevisaoImportacoes`, `permissoesPorPerfil`).

**Risco.** A leitura varre todos os grupos com caixa sem Invoice: medir no banco
local com um volume parecido com o de produção. Paginar por grupo se passar de
alguns segundos.

### 2 — Aba Containers, cartões e aviso do cabeçalho

- **Divisões.** **Correndo · A emitir · Esperando · Travado**, com a contagem e
  o US$ de cada uma. A divisão fica na URL (`?divisao=`). O link antigo
  `?lente=atraso` abre Correndo, e as lentes saem.
- **Linha do B/L** (D5): B/L, Cliente, Navio / Viagem, Containers (fora ·
  devolvidos · total do grupo), US$ previsto hoje e **Próximo passo / motivo**.
  - O próximo passo pode ser uma ação (**Gerar Invoice**, **Gerar
    complementar**), um motivo com atalho (**Cadastrar CE** e **Vincular
    Cliente** abrem a ficha do B/L; **Cadastrar tarifa** abre
    `/demurrage/taxas` com o tipo) ou uma espera ("aguarda TGHU… até 05/11").
  - **Gerar Invoice** só aparece onde o banco aceita.
  - A linha aberta mantém as colunas por container e **Editar datas**.
- **Cartões** (D6). Correndo (US$ e caixas), A emitir (US$), Travado (US$),
  Aguardando pagamento (R$ hoje) e Disputas aguardando resposta. Cada um leva à
  divisão ou aba dele. O aviso do cabeçalho ("N containers em atraso") conta as
  caixas de Correndo.
- **Exportar** em cada divisão: a planilha de Exposição do recorte (lote 6).
- **Alerta de Travado** (D25). Tipo novo no catálogo de Alertas, que abre na
  hora em que a caixa entra em Travado, para o setor do motivo (P4), e fecha
  pela origem quando a caixa sai de Travado.
- **Sai do navegador:** `buildBillingGroups`, `blBillingState`, o filtro
  `monitored` e a leitura atual de `listDemurrageContainers`. `effectiveDemurrage`
  continua na ficha do B/L.

**Aceite.** Com os dados de exemplo do protótipo:

- o B/L sem CE aparece em Travado com **Cadastrar CE**, e nunca com **Gerar
  Invoice**;
- o grupo com caixa no free time aparece em Esperando, nomeando a caixa;
- a caixa cobrada não aparece;
- os cartões batem com as divisões.

**Checks:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
`npm run design:check`, `npm run a11y:contrast`, `Demurrage.behavior.test.tsx`
e `DemurrageContainersTab.test.tsx` refeitos.

### 3 — B/L cancelado e dispensa da cobrança

- `bl_open_financial_reasons` ganha o motivo "Demurrage a faturar". Ele vale para
  caixa devolvida com sobreestadia sem Invoice viva e sem dispensa (D7) e para
  o container ainda fora e em atraso (D26). **Cancelar B/L** mostra o motivo e o
  caminho: devolver e emitir, ou dispensar.
- **Dispensar cobrança** (qualquer Departamento, D24). Ação nova na linha
  Travado, na linha Correndo e na recusa do cancelamento.
  - Exige justificativa de 10 caracteres ou mais.
  - Grava a dispensa por caixa (Viagem, Cliente, número) com autor e motivo, e
    `audit_logs`.
  - A caixa dispensada sai da aba Containers e não entra na emissão; a
    conferência da emissão e `_demurrage_billed_container_keys` a tratam como
    coberta.
  - **Desfazer dispensa** também exige justificativa.

**Aceite (Teste local-pg):**

- O cancelamento de QV-12C (devolvido com sobreestadia, sem Invoice) é recusado
  com o motivo, e o de um B/L com container ainda fora em atraso também.
- Depois da dispensa, o cancelamento passa e a caixa não volta à aba.
- O B/L com Invoice paga continua cancelável.

**Checks:** `migrations:check`, `rpc:check`, `permissoesPorPerfil.local-pg.test.ts`
(linha nova na matriz de permissões) e `blCancel.local-pg.test.ts`.

### 4 — Faturas, Pagas e Canceladas

- **Faturas** (D8).
  - Colunas novas: **Desconto** (US$, com o motivo ao passar o mouse) e **Em
    aberto há** (dias desde a emissão, pelo dia de Brasília).
  - Filtros rápidos: **Em disputa**, **Fora da Régua** (`dunning_suspended_reason`
    ou pausa da Régua) e **Com desconto**, mais **Cliente** e **Navio /
    Viagem**.
- **Pagas** (D9).
  - **Meio de pagamento**: Pix Itaú, extrato, manual ou isenção.
  - **ROE do pagamento**: a foto `source='payment'` de
    `demurrage_invoice_history`.
  - **Dias até pagar**: `paid_at − billed_at`.
  - Escolha de implementação: gravar o meio na baixa (coluna nova, preenchida
    por `register_demurrage_payment` conforme quem chama, e pela isenção de
    `apply_demurrage_discount`), com o preenchimento das linhas antigas pela
    origem conhecida (Itaú, `conciliated_by_extract`, `discount_exemption`). A
    migration declara a linha "Data status".
- **Canceladas** (D10).
  - Colunas: **Motivo** e **Cancelada por** (do `audit_logs` de
    `cancel_demurrage_invoice`, da reemissão por datas ou da troca de CNPJ) e
    **Destino das caixas**: reemitida na DEM-… (`replaces_invoice_id`), cobrada
    na DEM-…, aguardando nova Invoice (em A emitir) ou dispensada.
  - O cancelamento à mão continua sem enfileirar a emissão.
  - O texto de **Cancelar Invoice…** passa a dizer que as caixas voltam para A
    emitir.
- **Rótulos.** "USD a cobrar" só em Faturas; "USD pago" e "USD cancelado" nas
  outras abas.

**Aceite:**

- Os filtros reduzem a lista e o resumo junto.
- Uma Invoice paga por Pix Itaú, uma pelo extrato e uma isenta mostram o meio
  certo.
- A cancelada para reemissão diz "reemitida na DEM-…" com link.

**Checks:** gates de aplicação e tela; `DemurrageInvoicesTab.behavior.test.tsx`;
`demurrageMoney.local-pg.test.ts` e `reguaCobrancaDemurrage.local-pg.test.ts`
(o meio gravado na baixa e na isenção).

### 5 — Por Cliente e extrato do Cliente

- **Por Cliente** (D11). Lê a classificação do lote 1 junto com as Invoices em
  aberto.
  - Colunas: Correndo, A emitir e Travado (US$), Invoices em aberto, Faturado
    em aberto (US$ e R$ hoje).
  - Entra o Cliente só com sobreestadia ainda não faturada.
- **Imprimir relatório** (D12). Escolhe um Cliente e imprime o extrato: as
  Invoices em aberto (USD líquido, R$ hoje) e as caixas sem Invoice (B/L,
  container, descarga, devolução, dias, free time, US$ previsto), com a nota de
  que o valor previsto muda até a devolução e a emissão. Substitui o
  `CustomerSummaryReport` de uma linha por Cliente.

**Aceite.** No banco local, os Clientes só com exposição aparecem, e a soma da
coluna Correndo bate com o cartão Correndo.

**Checks:** gates de aplicação e tela; `CustomerSummaryReport.test.tsx`
refeito.

### 6 — Relatórios

- **`/relatorios?visao=demurrage`** passa a ter três recortes (D13):
  - **Exposição** (lote 1): uma linha por caixa sem Invoice, com divisão e
    motivo. Filtros: Cliente, Navio / Viagem, divisão. Totais por divisão e por
    Cliente.
  - **Invoices**:
    - USD líquido e desconto;
    - R$ hoje (em aberto) separado do R$ pago (congelado);
    - emissão por `billed_at`, o dia de Brasília, no filtro, na coluna e na
      ordem;
    - sai o filtro **Vencidas** e a situação **Rascunho**, e o cartão Faturas
      deixa de contar canceladas;
    - entram as colunas Tipo (Normal, Complementar, Substitui), Navio / Viagem,
      Disputa e Paga em.
  - **Itens por container**: cada item de Invoice viva, com Invoice, datas,
    dias, free time, 1º e 2º período e US$.
- **Planilha** (D14): uma aba por recorte, mais **Filtros**. O **Exportar** de
  cada aba da central exporta o recorte da tela com as mesmas colunas.
- **Documentos.** [Operação e Suporte](../../modules/operacao-suporte.md) (tabela
  de filtros e cartões) e os itens do Manual do Operador sobre "Vencidas"
  mudam junto.

**Aceite:**

- A soma de US$ da Exposição bate com Correndo, A emitir, Esperando e Travado.
- O US$ do recorte Invoices bate com Faturas e Pagas (líquido).
- Uma Invoice emitida às 22h de Brasília cai no dia de Brasília.

**Checks:** gates de aplicação; `reports.test.ts`, `exports.test.ts`,
`Relatorios.behavior.test.tsx` e `relatoriosListState.test.ts` atualizados.

### 7 — Disputas

- **Tabela** (D15). Uma linha por Disputa, com Invoice, situação da Invoice,
  Cliente, valor em disputa (USD líquido e R$ hoje), aberta há e vez de quem.
  - A conversa abre embaixo da linha; as que aguardam a nossa resposta vêm
    primeiro.
  - Filtros **Abertas**, **Resolvidas**, **Canceladas** e **Todas**.
  - **Responder** e o campo de resposta só aparecem com a vez nossa;
    **Reabrir** só em Invoice emitida ou paga.
  - A lista interna passa a devolver a situação da Invoice.
- **Invoice cancelada** (D16). `cancel_demurrage_invoice` e o cancelamento pela
  troca de CNPJ (`484`) cancelam a Disputa aberta da Invoice:
  - estado `cancelada`, `dispute_open` falso e `dispute_status` `cancelado`;
  - mensagem de sistema na conversa com o motivo;
  - notificação ao Cliente no Portal, com link para a aba Demurrage;
  - o Alerta `portal_dispute_opened` fecha.
- **Uma conversa por Invoice** (D17).
  - `portal_add_dispute_message` recusa abrir Disputa nova quando a Invoice já
    teve uma resolvida, e indica **Solicitar reabertura**.
  - O Portal esconde **Abrir disputa** nesse caso.
  - **Reabrir Disputa** recusa Invoice cancelada.
- **Prazo de 1 dia útil** (D18). Disputa aberta aguardando Equipamentos há mais
  de 1 dia útil abre o Alerta novo de prazo para Equipamentos, que fecha quando
  a equipe responde.
  - O dia útil usa o calendário do Vela (`business_holidays`, o mesmo do Pix
    Itaú).
  - A linha fica em âmbar.
  - A verificação roda no detector de Alertas ou num job.

**Aceite (Teste local-pg):**

- Cancelar a DEM-… com Disputa aberta deixa a Disputa cancelada, e o Cliente vê
  o motivo.
- O Portal recusa Disputa nova depois da resolvida.
- Disputa aberta sexta às 17h vence segunda às 17h, e na véspera de feriado
  pula o feriado.

**Checks:** gates de aplicação e tela; `DemurrageDisputeConversation.test.tsx`
refeito; suítes local-pg de Disputa e de Portal; o
[Portal do Cliente](../../modules/portal-cliente.md) atualizado, corrigindo
também os dois trechos que a revisão achou desatualizados: o que diz que o CE
não define a emissão interna (vale desde a `472`) e o prefixo `[Portal]` que a
Disputa não grava mais.

### 8 — Caixa dividida entre Clientes (rateio)

- **Emissão.** Para cada caixa, conta os Clientes distintos com B/L ativo e a
  mesma caixa na Viagem (`n`). O item da Invoice de cada Cliente leva a fração
  `1/n` e o subtotal, calculado pela condição daquele Cliente (D23),
  multiplicado por ela.
- **Item da Invoice.** Ganha a fração (coluna nova em
  `demurrage_invoice_items`).
- **Onde aparece.** O detalhe, o documento impresso, o detalhe do Portal e o
  relatório Itens por container mostram "1/2 da caixa".
- **Mudança de `n` depois da emissão** (D22). O B/L de outro Cliente que chega
  com a caixa, ou o B/L cancelado de um dos Clientes, passa por
  `_reconcile_demurrage_after_dates` como uma data alterada.

**Aceite (Teste local-pg):**

- QV-18A e QV-18B (mesma caixa, Clientes diferentes, mesma condição) recebem
  US$ 470,00 cada, em vez de US$ 940,00.
- Com o Cliente de QV-18A num acordo de 40 dias, a parte dele sai pela conta
  com 40 dias.
- A Invoice cheia de QV-18A, sem pagamento, é cancelada e reemitida pela metade
  quando chega QV-18B; paga, fica fora da Régua com Alerta.

**Checks:** `demurrageCobrancaPorCaixa`, `demurrageAuthority` e
`demurrageMoney`, mais a suíte nova.

### 9 — Container que vira SOC depois de faturado

- **Disparo.** `set_bl_container_ownership` e a gravação de SOC pelo Baplie
  chamam a mesma reconciliação de `_after_container_dates` para os B/Ls da caixa
  quando ela está em Invoice viva.
- **Reconciliação.** `_reconcile_demurrage_after_dates` passa a tratar a caixa
  SOC como diferença:
  - Invoice sem pagamento, desconto ou disputa: cancelada e reemitida sem a
    caixa;
  - com pagamento, desconto ou disputa: suspensa, com o Alerta
    `demurrage_invoice_dates_changed` dizendo que a caixa virou SOC.
- **Texto do Alerta.** A caixa que saiu por SOC não é tratada como "cobrança
  perdida".

**Aceite (Teste local-pg):**

- QV-06B (faturado e depois SOC) tem a Invoice reemitida sem a caixa.
- A versão paga fica fora da Régua com Alerta.

**Checks:** `auditoriaFaturasDemurrageComunicado` e `demurrageCobrancaPorCaixa`.

### 10 — Fechamento

- **Documentos:** [Demurrage](../../modules/demurrage.md) (Anatomia das telas,
  Catálogo de ações, Fluxos e invariantes), [Portal do Cliente](../../modules/portal-cliente.md),
  [Operação e Suporte](../../modules/operacao-suporte.md), a
  [rastreabilidade](../../RASTREABILIDADE.md), o glossário (`CONTEXT.md`: Correndo,
  A emitir, Esperando, Travado, Dispensa da cobrança, rateio da caixa), o Manual
  do Operador e a matriz de cobertura, e o `CHANGELOG`.
- **ADR.** O índice da [ADR 0112](../../adr/0112-repaginacao-da-demurrage.md)
  passa a "implementada".
- **Revisão independente** (`vela-code-review`) antes do PR final.
- **Arquivo.** O plano vai para `docs/archive/plans/`.

## Ordem e dependências

1. O lote 0 sai primeiro e sozinho.
2. O lote 0B vem antes do lote 1, que lê o cadastro de tipos e o grupo de
   tarifa.
3. O lote 1 vem antes de 2, 5 e da Exposição do 6.
4. Os lotes 3, 4 e 7 são independentes entre si e do lote 1.
5. Os lotes 8 e 9 mexem na emissão e na reconciliação. Ficam depois do 1, um
   de cada vez, para não haver duas migrations redefinindo as mesmas funções
   ao mesmo tempo.

Cada lote é um PR contra `staging`.

## Riscos e rollback

- **Semântica da aba Containers.** Ela passa a vir do banco. A suíte do lote 1
  com os 17 cenários da revisão é a rede.
- **Volume.** A leitura do lote 1 e os gatilhos do status rodam em tabelas
  grandes. Medir no banco local e manter o job da madrugada.
- **Rateio** (lote 8). Muda o valor cobrado e reemite Invoices: entra só com o
  `demurrageMoney` e o `demurrageCobrancaPorCaixa` verdes.
- **Rollback.** Cada migration traz no cabeçalho as definições anteriores a
  reaplicar. A tela de cada lote volta pelo revert do PR. O lote 1 só muda
  leitura e gatilho de status, sem regravar Invoice.
