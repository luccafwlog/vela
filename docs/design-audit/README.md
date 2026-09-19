# Auditoria de design — Vela (novas implementações)

- **Data:** 2026-07-20
- **Commit base:** `fca90b7`
- **Método:** app real bootada contra stack local (Postgres 16 + `scripts/design-audit/bootstrap.sql` + 216 migrations + seeds sintéticos + dados sintéticos adicionais para os módulos novos + `sb-shim.cjs`), navegada via Playwright em 1440×900 (desktop) e 390×844 (mobile). Screenshots em [`assets/`](assets/). Login `auditor@local.test` (admin).
- **Escopo:** revisão focada nas implementações entradas depois da auditoria de 2026-07-17 ([arquivada](../archive/audits/design-audit-2026-07-17.md)): **aba ADR** no detalhe da viagem (agregação, sign-offs, ocorrências, fechamento com snapshot e impressão), **Ficha BL** (rails + hub de abas), **Ficha do Cliente** (hub de abas), **VAZIOS EXP** (edição inline de dados ADR e operação da escala), **Vazios Importação** (natureza cama/cover plate), **Veículos** (local de desova), **alertas pós-ATD** e **papel Equipamentos**.

Artefatos de ambiente que **não** são bugs do produto: Google Fonts e API PTAX
do BCB bloqueados pelo proxy de egress, websockets realtime falham contra o
shim. Consoles limpos em todas as rotas visitadas (apenas PTAX bloqueado);
nenhuma falha silenciosa de query no log do shim. **Runtime**.

## Auditoria focalizada — Atracações e Terminais (2026-08-25)

- **Commit base:** `9733a71`
- **Método:** app real bootada contra o stack local (Postgres 16 + `bootstrap.sql` +
  **345 migrations aplicadas limpas** + `validation_seed.sql` + `seed_audit.sql` +
  `sb-shim.cjs`), navegada via Playwright em 1440×900 e 390×844. Login
  `auditor@local.test` (admin).
- **Escopo:** as superfícies tocadas pela fragmentação Escala → Atracação →
  Terminal: `/painel`, `/line-up-tv/display`, `/viagens/:id` (Planejamento por
  escala e modal de escala), `/alertas`, mais varredura das demais rotas em busca
  de erro de console e falha silenciosa de query.
- **Cenário exercitado:** escala BRVIX da viagem 10 com **duas Atracações** — TVV
  (ATB 20/08, ATD 23/08, já desatracou) e PORTMAC (ATB 23/08, sem ATD). É o
  cenário em que Escala e Atracação divergem, e onde os defeitos aparecem.

### Preparação do stack (tooling, não produto)

O seed da auditoria não exercitava terminais e estava defasado do schema:

| Item | Correção |
|---|---|
| `seed_audit.sql` inseria `voyage_export_schedules.eta`/`etb`, colunas removidas quando a Escala passou a ser dona da chegada e a Atracação das datas de berço | Insert atualizado para o schema vigente (`tem_exportacao`) |
| Subselects `(select id from ports where locode='BRSSZ')` quebravam com LOCODE duplicado | `order by id limit 1`, mesmo desempate que a RPC usa |
| Nenhum terminal, Atracação, frente ou ADR no seed — a área nunca foi auditada | Bloco novo: depots TVV/PORTMAC, escala BRVIX, duas Atracações, quatro frentes e dois ADRs |
| `sb-shim.cjs` devolvia `SETOF jsonb` embrulhado (`[{ list_alert_queue_page: {...} }]`) em vez de desembrulhar como o PostgREST real — `/alertas` quebrava na error boundary | Shim desembrulha retorno escalar em conjunto |

**A quebra de `/alertas` era artefato do shim, não bug do produto**: `alerts.type` e
`alert_items.item_type` são `NOT NULL`, então a linha malformada que derrubava
`alertEntityLinkLabel` não existe com dado real. Nenhuma correção de produto foi
feita por causa dela — registrado aqui para quem reencontrar o sintoma.

### Corrigido nesta auditoria

| # | Problema | Eixo | Fix | Evidência |
|---|---|---|---|---|
| 1 | **Código de terminal cortado na TV vira outro código.** A coluna Terminal do painel de TV tinha 6fr (~80px) e `PORTMAC` precisa de 117px. Com `overflow: hidden` + `text-align: center`, o Chromium corta simétrico e **sem reticências**: a parede exibia `ORTMA`, que não é terminal nenhum. Dois terminais no mesmo sentido (`TVV / PORTMAC`, 186px) cortariam bem pior. | Confiança | Coluna Terminal 6fr → 10fr (134px, cabe um código com folga) e quebra no separador em vez de corte silencioso (`--terminal`). O fallback CSS de `--lineup-display-columns`, parado em 14 valores para 15 colunas, foi alinhado. | [antes](assets/atracacao-tv-terminal-clipped.png) · [depois](assets/atracacao-tv-terminal-fixed.png) |
| 2 | **"Atracada" só existia como cor, e a cor já significava outra coisa.** O estado vinha de `color: #16a34a` em `td:not(...)`, que perde para células com cor própria — numa linha atracada só *algumas* células ficavam verdes. Pior: verde já marca "esta data é a real" (ATA) na coluna ao lado. Sem pista não-cromática, falha o WCAG 1.4.1 e não se lê de longe na parede. | Entendimento | Barra verde à esquerda da linha (`box-shadow: inset`) nas três superfícies — tabela, painel de TV e card. Legenda do `/painel` passou a nomear o estado. | [`atracacao-tv-terminal-fixed.png`](assets/atracacao-tv-terminal-fixed.png) |
| 3 | **`Restow 0` para restow ausente.** A linha de Atracações do Planejamento renderizava `{atracacao.rtw ?? 0}`: um terminal sem restow informado declarava zero restow. É exatamente o anti-padrão que o domínio nomeia — ausência de dado não é conclusão. | Confiança | `?? '—'`. | [`atracacao-planejamento.png`](assets/atracacao-planejamento.png) |
| 4 | **Campo derivado com cara de campo editável.** O "ATD derivado" tinha borda e fundo idênticos aos inputs de ETA/ATA ao lado, convidando o operador a clicar e digitar num campo que o sistema calcula. | Entendimento | Fundo esmaecido e borda tracejada para `readonly` dentro do editor de escala; valor passa a ser `—` e a explicação vive na dica, sem duplicar a frase. | [`atracacao-escala-modal-fixed.png`](assets/atracacao-escala-modal-fixed.png) |

### Verificado em runtime (correções da PR #586)

As quatro correções da revisão de código foram confirmadas no app real, não só em teste:

- **Código do terminal na projeção:** o Planejamento por escala lista `TVV` e
  `PORTMAC` (antes, toda Atracação atribuída se apresentava como `TBC`).
- **ATD por sentido:** com o TVV já desatracado e a PORTMAC não, a linha de
  importação **não** é mais marcada como atracada e **sai do painel de TV**;
  a de exportação permanece atracada. Confirmado por `className` no DOM:
  a linha do TVV sem `--berthed`, a da PORTMAC com.
- **ATD derivado:** o modal mostra `—` com a dica "Aguardando o ATD de PORTMAC."
- **Escala nova:** cobertura de teste em `VoyageVisaoTab.atracacoes.test.tsx`.

### Sem achado

- **Rodapé fixo do modal de escala:** medido em 390×844 — o conteúdo rola por
  baixo do rodapé `sticky` e o último bloco fica integralmente alcançável
  (sobreposição de 2px, arredondamento de borda). Comportamento conforme a spec.
- **Console e shim:** nenhum erro de produto e nenhuma falha silenciosa de query
  em todas as rotas visitadas.
- **Grade responsiva do modal:** colapsa para uma coluna em 390px sem overflow
  horizontal do body.

### Recomendação (não aplicada — fora do que a auditoria pode tocar)

**`public.ports` não tem unicidade de LOCODE** — só PK em `id`. O stack local
terminou com Santos em dois `id` (2 e 22), e foi isso que quebrou o seed. A RPC
`save_voyage_escala_terminal_state` já se defende com `ORDER BY p.id LIMIT 1` e
um advisory lock, mas isso protege apenas o caminho dela; nada impede a duplicata
de entrar por seed, admin ou importação. O risco concreto para terminais: `depots`
aponta para um `ports.id` específico, e o modal só oferece terminais cujo
`port_id` bate com o da escala — com LOCODE duplicado, um terminal legítimo
some do seletor ou é recusado pela FK composta `(terminal_id, port_id)`.
Correção sugerida: índice único sobre `upper(btrim(locode))`, em migration
própria com deduplicação prévia.

## Auditoria focalizada — ADR por terminal: aba, estrutura e impressão (2026-08-25)

- **Commit base:** `7662c15`
- **Método:** app real bootada contra o stack local (Postgres 16 + `bootstrap.sql`
  + migrations + `validation_seed.sql` + `seed_audit.sql` + `sb-shim.cjs`),
  navegada via Playwright em 1440×900. Login `auditor@local.test` (admin).
- **Escopo:** a aba ADR de `/viagens/:id`, a estrutura de dados do ADR
  terminalizado e o documento impresso — conformidade com a confecção por
  terminal.
- **Cenário exercitado:** escala BRVIX da viagem 10 com **duas Atracações** — TVV
  (ATB 20/08, ATD 23/08) e PORTMAC (ATB 23/08, sem ATD) — e um ADR por terminal.
  O ADR do TVV foi assinado nas 6 seções, nos 3 departamentos, fechado e impresso
  pela própria interface; o do PORTMAC permaneceu aberto.

### O que está correto na confecção por terminal

Verificado em runtime, não só no código:

- **Identidade e seleção.** A aba lista "ADR por terminal" e resolve o relatório
  por `report_id`; alternar TVV ↔ PORTMAC troca ATB/ATD/Restow, frentes atribuídas
  e sign-offs.
- **Relógio por Atracação.** T0 do prazo é o ATD **daquela** Atracação, sem
  fallback para outro terminal nem para o ATD documental do POL.
- **Fechamento independente.** Fechar o ADR do TVV deixou o do PORTMAC aberto
  (`status` por linha em `agency_departure_reports`).
- **A partição das frentes é garantida pelo banco.** O índice
  `uq_voyage_escala_operation_front UNIQUE (voyage_id, port, sentido, modalidade)`
  faz cada frente pertencer a exatamente um terminal da escala — dois ADRs da
  mesma escala **não conseguem** imprimir a mesma carga. Confirmado tentando
  inserir `importacao/carga_cheia` no PORTMAC com a frente já no TVV: rejeitado.
- **Impresso terminalizado.** Número do documento `ADR · BRVIX · TVV`, linha
  "Terminal" no bloco de metadados, ATA/ATB/ATD/Restow da Atracação e nome de
  arquivo com o código do terminal.
  Evidência: [`assets/adr-impresso-terminal-tvv.png`](assets/adr-impresso-terminal-tvv.png).

### Corrigido nesta auditoria

| # | Achado | Evidência | Correção |
|---|--------|-----------|----------|
| 1 | **Toda escrita do ADR terminalizado era inerte.** `callReportIdAwareRpc` guardava `supabase.rpc` numa variável antes de chamar, o que desliga a função do cliente; o supabase-js lê `this.rest` e estourava `TypeError: Cannot read properties of undefined (reading 'rest')` **antes de sair na rede**. O erro morria no `mutationFn` do react-query sem toast. Assinar seção, assinar departamento, observar, fechar e reabrir um ADR por terminal não faziam nada — a interface só voltava ao estado anterior. | Console do navegador na aba ADR; nenhum POST `set_agency_report_*_by_report_id` no log de rede; a mesma RPC chamada direto por `fetch` respondeu 200 e gravou. | Chamada pelo objeto (`(supabase.rpc as …)(nome, args)`), como já fazia `resolveActorNames` no mesmo arquivo. Regressão coberta por `agencyReportTerminalizedRpc.test.ts`, com dublê que também depende de `this` — o dublê antigo, uma função solta, não conseguia flagrar isto. |
| 2 | **O Prazo de Conclusão do ADR nunca era calculado.** `terminal_atd` é `TIMESTAMPTZ` (migration 306) e chega como `2026-08-23T00:00:00+00:00`; `calculateAgencyReportDeadlineDate` só aceitava `YYYY-MM-DD` e devolvia `null`. A aba exibia o ATD e, logo abaixo, "Aguardando a saída do navio", com os 3 departamentos em "Sem prazo". O agregado de SLA (ADR 0039) lia o mesmo valor. | Linha do tempo do ADR do TVV com ATD 23/08/2026 e prazo "aguardando". | Normalização ISO no ponto compartilhado de `agencyReportDeadline.ts`, usada pelas três funções exportadas. Passa a mostrar "Vence em 26/08/2026 (3 dias úteis após o ATD)" e os departamentos em "No prazo". Formato ambíguo (`08/03/2026`) continua recusado de propósito. |
| 3 | **`Restow 0` para restow ausente**, na aba e no impresso — o mesmo defeito já corrigido no Planejamento por escala, nestes dois call sites. Zero restows é uma afirmação; a ausência do dado não é. | PORTMAC, `terminal_rtw` nulo, exibia `0`. | `—` quando nulo, nos dois lugares. |
| 4 | **Faixa de seção vazia no impresso.** Um bloco sem dado cuja resolução já saiu num bloco anterior da mesma seção imprimia só o título ("MATRIZ DE DESCARGA" solto). No ADR por terminal isso deixou de ser raro: cada terminal responde por parte das frentes. | Impresso do TVV antes da correção. | `Section` não renderiza quando não há dado nem linha de resolução. |
| 5 | **Barra no nome do arquivo impresso.** O rótulo da viagem é `NAVIO / 088E`, então o nome saía `ADR - COSCO SHIPPING ARIES / 088E - BRVIX - TVV.pdf`; `/` é separador de caminho e o navegador não salva com ele. | `data-print-filename` no documento. | Caracteres proibidos viram hífen no `buildAgencyReportPrintFilename`. |

### Achado estrutural — correção aplicada

**O impresso não distingue "nada operado neste terminal" de "esta frente não é
deste terminal".** Na tela, uma seção sem frente atribuída diz "Não há frente
atribuída a este terminal."; no papel, a mesma seção sai como
"Nada a declarar — <assinante>". No cenário auditado o ADR do TVV declara
"Nada a declarar" em *Embarque de vazios*, uma frente que é do PORTMAC e que
**teve** operação. Quem lê o ADR do TVV isolado conclui que não houve embarque de
vazios em Vitória.

A opção (b) foi aplicada: o snapshot fechado congela `header.terminalScope`.
Quando uma seção não tem frente atribuída ao terminal, o impresso mostra
"Sem frente atribuída a este terminal" e não repete a resolução "Nada a
declarar". Uma seção atribuída continua imprimindo sua resolução própria,
inclusive "Nada a declarar". A regressão está coberta por
`AgencyReportDocument.test.tsx`.

### Mesmo defeito do #1 em outros três módulos — recomendação

A chamada destacada de `supabase.rpc` aparece em mais três lugares, todos
quebrados pelo mesmo `TypeError`, todos invisíveis para os testes atuais (que
dublam `supabase` como objeto simples):

| Arquivo | RPC | Efeito |
|---------|-----|--------|
| `src/services/reconciliacao.ts:58` | todas as RPCs de PIX (destaque em nível de módulo) | conciliação PIX |
| `src/services/billingLedger.ts:214` | `settle_cod_adjustment` | baixa de ajuste COD |
| `src/services/transshipments.ts:110` | `revert_voyage_omission` | reverter omissão de escala |

Não corrigi: os dois primeiros mexem em dinheiro e o terceiro em semântica de
dado — fora do que esta auditoria pode tocar. A correção é a mesma do #1 (chamar
pelo objeto, ou `supabase.rpc.bind(supabase)`), e vale confirmar em produção
antes, porque hoje esses caminhos **sempre** lançam: corrigi-los passa a
executar RPCs que nunca executaram.

### Sem achado

- **Partição de carga entre terminais**: investigada a hipótese de dois ADRs da
  mesma escala imprimirem a mesma carga. O índice único de frentes impede.
  Vale registrar o teto: a partição é por `(sentido, modalidade)`, então uma
  única modalidade fisicamente dividida entre dois terminais não é
  representável — ela pertence a um terminal e o ADR dele carrega tudo.
- **Marcadores de vazio divergentes** (`-` do `formatDate` × `—` do resto da
  interface): convenção de repositório com centenas de call sites, não defeito
  do ADR.

## Auditoria focalizada — revisão manual orientada a cliente (2026-08-20)

- **Evidência inicial:** captura fornecida pelo usuário a partir de uma preview
  da implementação desta branch. A captura não representa o `main` nem uma tela
  em produção; foi usada apenas para localizar problemas de UI/UX.
- **Escopo:** `/revisao`, com foco no grupo de cliente, evidências documentais,
  onboarding e tabela de B/Ls.
- **Diagnóstico:** contraste insuficiente em textos de alerta no tema claro,
  cores hardcoded do antigo dark mode, badges repetindo a mesma pendência,
  cabeçalho sem hierarquia e ação `Corrigir` comprimida na tabela.
- **Correções aplicadas:** tokens de tema para todas as superfícies da revisão,
  hierarquia de grupo reorganizada, pendências de cliente removidas das linhas
  quando já estão tratadas no onboarding, painel de evidências com contraste
  acessível e campos brutos legíveis, tabela com largura mínima e ação protegida,
  toolbar e avisos com superfícies consistentes, além de ajustes responsivos.
- **Validação:** testes focados, `npx tsc -b`, `npm run lint` e `git diff --check`.

## P0 — encontrado no boot (fora da UI)

| Problema | Evidência | Status |
|---|---|---|
| **Migration 211 (`equipamentos_rbac_hardening`) não aplicava em nenhum Postgres**: na query do `FOR p IN SELECT * FROM pg_policies ...`, as linhas `AND p.permissive = 'PERMISSIVE'` e `p.cmd IN (...)` referenciavam o alias `p` que não existia no SQL — o PL/pgSQL substituía pela record variable ainda não atribuída e abortava (`record "p" is not assigned yet`). | Reproduzido ao aplicar as migrations no stack local (`ON_ERROR_STOP=1`) na data da auditoria. | ✅ **Corrigido** — a query passou a usar `FROM pg_policies AS policy` com `policy.permissive`/`policy.cmd`, chegou ao `main` (PR #409/#410) e foi herdada nesta branch via merge. Migrations 211–220 aplicam limpo no stack local. |

## Corrigido nesta auditoria

| # | Problema | Eixo | Fix | Evidência |
|---|---|---|---|---|
| 1 | **`/veiculos`: "Local de desova" nunca salvava.** O `onBlur` comparava o valor do campo com `unpackingLocations[id] ?? persisted`, mas o `onChange` já tinha gravado o draft com o mesmo texto digitado — a guarda de no-op sempre disparava e o update jamais ia ao banco. Sem toast, sem erro: o usuário via o texto no campo e perdia o dado no reload (e o ADR seguia mostrando "local de desova não informado"). | Confiança | Call site passa o valor persistido (`row.container.unpacking_location`) como base de comparação (`src/pages/Veiculos.tsx`). Verificado em runtime: valor persiste em `bl_containers.unpacking_location` após blur. | [`veiculos-desova-fixed.png`](assets/veiculos-desova-fixed.png) |
| 2 | Ficha BL, card Financeiro exibia os enums crus `ready_for_billing` / `invoiced`. | Entendimento | Reuso de `resolveChargeStatusLabel` + `FINANCIAL_STATUS_LABELS` (`src/components/bl/BlVisaoGeralTab.tsx`). | antes [`ficha-bl-desktop.png`](assets/ficha-bl-desktop.png) · depois [`ficha-bl-desktop-fixed.png`](assets/ficha-bl-desktop-fixed.png) |
| 3 | Rails da Ficha BL sem acento ("PROXIMA ACAO", "SAIDA DO POL", "DEVOLUCAO", "REVISAO & CLIENTE", "Sem previsao", "Nao emitida") e status de fatura em inglês ("#201 issued"). | Confiança | Copy + `INVOICE_STATUS_LABELS` em `src/services/blRails.ts` e `src/components/bl/BlRailsPipeline.tsx` ("#201 Emitida"). Também "Baplie não importado", "divergência(s)", "Saída do POL" e "Máquinas" em `BlVisaoGeralTab`. | [`ficha-bl-desktop-fixed.png`](assets/ficha-bl-desktop-fixed.png) |
| 4 | Alertas pós-ATD do ADR renderizavam o tipo cru `agency_report_section_pending`, entidade `agency_departure_report` sem label e **sem ação de navegação** (todos os outros tipos têm "Ver Fatura"/"Abrir B/L"). | Entendimento / Conversão | `TYPE_LABELS` + `ENTITY_TYPE_LABELS` + deep-link "Abrir Viagem" parseando o `entity_id` (`voyageId::porto::secao`) em `src/pages/Alertas.tsx`. | antes [`alertas-adr-pendentes.png`](assets/alertas-adr-pendentes.png) · depois [`alertas-adr-fixed.png`](assets/alertas-adr-fixed.png) |
| 5 | `/admin/usuarios`: a legenda "Descrição dos perfis de acesso" não incluía o novo papel **Equipamentos** (presente no dropdown desde a migration 210) — quem atribui o papel não sabia o que ele concede. | Entendimento | Linha descrevendo o escopo (leitura geral + escrita em Vazios EXP/Veículos + sign-off ADR) em `src/pages/Admin.tsx`. | antes [`admin-usuarios.png`](assets/admin-usuarios.png) · depois [`admin-usuarios-fixed.png`](assets/admin-usuarios-fixed.png) |
| 6 | VAZIOS EXP: hint de autosave dizia "Salvamento no blur" (jargão de dev) e os 5 checkboxes do editor inline exibiam o texto fixo "Marcado" mesmo desmarcados. | Entendimento | "Salva automaticamente ao sair do campo" + texto dinâmico Sim/Não (`src/pages/EmbarqueVazios.tsx`). | antes [`vazios-exp-expandido.png`](assets/vazios-exp-expandido.png) · depois [`vazios-exp-expandido-fixed.png`](assets/vazios-exp-expandido-fixed.png) |
| 7 | Aba ADR: "1 BLs · 3 VINs" (plural errado) e botão "Fechar ADR" desabilitado sem nenhuma explicação do que falta. | Entendimento | Pluralização correta + `title` no botão ("Confirme as 7 seções…") em `src/components/voyages/VoyageAgencyReportTab.tsx`. | [`viagem-adr-tab.png`](assets/viagem-adr-tab.png) |
| 8 | Ficha do Cliente: recebíveis com status crus `open`/`partially_settled` na mesma tela em que invoices aparecem traduzidas; atividade recente com enum cru "Portal: aguardando_analise"; pendências com plural "(s)" ("1 invoice(s) vencida(s)"); "Email de Recuperação" com "Não informado" duplicado. | Confiança | Label map de recebíveis (`FinanceiroTab`), reuso de `provisioningDecisionLabel`/`accountSituationLabel` na timeline (`customerFicha.ts`), pluralização real das pendências (`VisaoGeralTab`) e supressão da linha de origem vazia (`CadastroContatosTab`). | antes [`ficha-cliente-visao-geral.png`](assets/ficha-cliente-visao-geral.png), [`ficha-cliente-financeiro.png`](assets/ficha-cliente-financeiro.png) · depois [`ficha-cliente-visao-geral-fixed.png`](assets/ficha-cliente-visao-geral-fixed.png), [`ficha-cliente-financeiro-fixed.png`](assets/ficha-cliente-financeiro-fixed.png) |

Verificação após os fixes: `npx tsc -b`, `npm run lint`, `npm test`
(1243 passed), `npm run docs:check`, `npm run build` — todos verdes; telas
re-verificadas em runtime (evidência "depois" acima), incluindo o persist do
local de desova no banco. **Runtime**.

## Pendências priorizadas

### P1 — mina a confiança no fluxo core

| Problema | Eixo | Status |
|---|---|---|
| ~~Ficha do Cliente: "Saldo pendente (local + demurrage) R$ 0,00" para cliente devendo R$ 3.315.~~ | Confiança | ✅ **Corrigido** (2026-07-21). `buildConsolidatedBalance` agora soma `issued` + `overdue` + `partially_paid`, alinhado à definição de "Saldo Pendente do Cliente" em `CONTEXT.md`. |
| ~~ADR fechado/impresso é ilegível para o destinatário.~~ | Conversão | ✅ **Corrigido** no `main` (PR #409, antes deste plano) — `AgencyReportDocument` foi reescrito com layout próprio por seção. |
| ~~Mensagem dos alertas pós-ATD vem do banco com chave crua e sem acento.~~ | Entendimento | ✅ **Corrigido** (2026-07-21). Migration 219 reescreve `detect_agency_report_pending()` com labels pt-BR e nomeia o departamento dono, com backfill dos alertas abertos; a coluna Entidade é formatada no cliente ("Viagem 10 · BRVIX · Ocorrências"). |

### P2 — atrito moderado

| Problema | Eixo | Status |
|---|---|---|
| ~~Aba ADR: sign-offs não mostram quem confirmou nem quando; ocorrências assinam com o papel em vez do nome.~~ | Confiança | ✅ **Corrigido** (2026-07-21). RPC `get_agency_report_actor_names` (migration 220) + atribuição inline "Confirmado por {nome} em {data}" nas 7 seções e "{nome} ({departamento})" nas ocorrências. |
| Aba ADR: chip de estado ("Pendente"/"Confirmado") e botões de ação têm o mesmo peso visual — parece um grupo de 3 botões; "Fechar ADR" fecha com um clique, sem confirmação (reversível via "Reabrir", mas congela e é o gatilho de impressão). | Entendimento | Em aberto. Segmented control com estado ativo destacado; diálogo de confirmação leve no fechamento. |
| ~~VAZIOS EXP: "Serviços de reorganização" mostra "Sem tarifa" em todas as linhas e não existe UI para cadastrar `vazios_reorg_rates`.~~ | Conversão | ✅ **Corrigido** (2026-07-21). Página `/embarquevazios/taxas` (padrão `/granito/taxas`, admin-only); "Sem tarifa" agora é link para lá. |
| ~~VAZIOS EXP: o card "Operação da escala" só aparece depois de filtrar por viagem — invisível no primeiro uso.~~ | Conversão | ✅ **Corrigido** (2026-07-21). Card sempre visível, com `VoyageCombobox` embutido quando não há viagem selecionada. |
| ~~`/veiculos`: sem atribuição de local de desova em massa.~~ | Conversão | ✅ **Corrigido** (2026-07-21). Ação "Definir local de desova" na barra de seleção, aplicando aos containers das linhas selecionadas. |
| Aba ADR: "Container com veículo — local de desova não informado" não linka para `/veiculos`, onde o dado é preenchido. | Conversão | Em aberto. Link direto para `/veiculos` com a viagem pré-selecionada. |
| ~~Ficha BL, aba Faturamento: chips "PRONTO PARA FATURAR" convivem com "Este B/L já foi faturado…" e fatura ativa — sinais de estado conflitantes.~~ | Entendimento | ✅ **Corrigido** (2026-07-21). Com fatura ativa, o chip de fase mostra "Faturado" e os CTAs "Marcar revisado"/"Pronto para faturar" somem. |
| ~~Copy sem acento remanescente na Ficha BL/Faturamento.~~ | Confiança | ✅ **Corrigido parcialmente** (2026-07-21): "Motor Etapa A: cálculo automático…", "Este B/L já foi faturado. As taxas estão bloqueadas para edição…". "Razão social", "OBSERVAÇÃO", "DATA/LOCAL DE EMISSÃO", "TELEFONE DO CONSIGNATÁRIO" e "Conciliação: MATCH CNPJ" seguem em aberto (fora do escopo deste plano). |

### P3 — polimento

| Problema | Eixo | Status |
|---|---|---|
| Peso total `48500` / CBM `112.5` sem formatação pt-BR na Ficha BL (herdado da auditoria anterior). | Confiança | Em aberto. |
| ~~TARA `3800` sem formatação pt-BR em `/vazios-importacao`.~~ | Confiança | ✅ **Corrigido** (2026-07-21): `Number(tare_kg).toLocaleString('pt-BR')`. |
| ~~Cabeçalho da aba ADR: grid aperta "Navio / viagem" em 3 linhas.~~ | Entendimento | ✅ **Corrigido** (2026-07-21): grid ganhou o degrau `lg:grid-cols-3` antes do `2xl:grid-cols-4`. |
| ~~Seção "Embarque de vazios" do ADR mostra cards zerados de Serviço extra/Storage/Overtime mesmo com "Nenhum dado informado".~~ | Entendimento | ✅ **Corrigido** (2026-07-21): cards só renderizam quando há bookings ou operação cadastrada. |
| ~~Mobile: setas "→" dos rails da Ficha BL quebram sozinhas no início da linha.~~ | Entendimento | ✅ **Corrigido** (2026-07-21): setas ocultas abaixo do breakpoint `sm`. |
| Ficha Cliente, aba Operacional: coluna "Financeiro: Pago" convive com recebível em aberto do mesmo B/L na aba Financeiro (dado sintético inconsistente no seed; em produção triggers mantêm). **Suspeita**. | Confiança | Em aberto. Se ocorrer em produção, derivar o status exibido dos recebíveis em vez de `bls.financial_status`. |
| Datas `mm/dd/yyyy` nos inputs nativos com navegador em locale EN (herdado, aceito para uso interno). | Confiança | Sem ação; reavaliar se incomodar. |

## Resumo por dimensão (módulos novos)

| Dimensão | Avaliação |
|---|---|
| Primeira impressão | Boa. Os hubs (Ficha BL, Ficha Cliente) organizam muita informação com hierarquia clara; a aba ADR é densa mas navegável. |
| Navegação | Boa. Rails clicáveis na Ficha BL levam à viagem/faturamento; pendências da Ficha Cliente são acionáveis. Lacunas de deep-link (ADR→veículos) anotadas em P2. |
| Hierarquia visual | Boa nos hubs; cabeçalho do ADR e o trio chip+botões dos sign-offs precisam de polimento (P2/P3). |
| Consistência de componentes | Boa base (Badges, Cards, tabelas compartilhadas), mas os módulos novos estrearam com enums crus onde o resto do app traduz — o `statusLabels.ts` existe e não estava sendo usado (corrigido nesta auditoria). |
| Loading/empty/error | Muito boa. Empty states orientados a ação em VAZIOS EXP/IMP e Veículos; "Somente leitura" para papéis sem escrita. |
| Sinais de confiança | O ponto fraco desta leva: bug real de persistência (desova), saldo "R$ 0,00" enganoso, snapshot de ADR ilegível, sign-off sem atribuição. Dois dos quatro corrigidos/encaminhados aqui. |
| Caminho de conversão | O fluxo ADR (confirmar 7 seções → fechar → imprimir) completa de ponta a ponta, mas o produto final (documento impresso) não está à altura do fluxo que o gera (P1). |

## Top 5 — impacto em conversão

1. ~~Deploy travado pela migration 211~~ — **corrigido** no `main` antes deste plano.
2. ~~Documento ADR fechado/impresso ilegível~~ — **corrigido** no `main` (PR #409).
3. ~~Saldo pendente R$ 0,00 com dívida em aberto na Ficha Cliente~~ — **corrigido**.
4. ~~Local de desova nunca salvava~~ — **corrigido** (alimenta diretamente o bloco de veículos do ADR).
5. ~~Tarifas de reorganização sem UI de cadastro~~ — **corrigido** (`/embarquevazios/taxas`).

Todos os itens do top 5 de 2026-07-20 estão resolvidos. Restam do P2/P3: segmented control dos sign-offs, deep-link ADR→Veículos, e a passada de copy remanescente na Ficha BL (Detalhes do B/L).

## Top 5 — quick wins

1. ~~Enums crus (`ready_for_billing`, `open`, `aguardando_analise`, tipo de alerta ADR)~~ — **corrigidos** com os label maps que já existiam.
2. ~~Acentos e inglês nos rails da Ficha BL~~ — **corrigidos**.
3. ~~Legenda do papel Equipamentos~~ — **corrigida**.
4. ~~Mensagem legível nos alertas pós-ATD~~ — **corrigida** (migration 219).
5. ~~"Confirmado por {nome} em {data}" nos sign-offs do ADR~~ — **corrigido** (migration 220).
