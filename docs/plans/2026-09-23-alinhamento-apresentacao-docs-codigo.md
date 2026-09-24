# Alinhamento entre apresentação, documentação e código — Plano de Implementação

> Origem: revisão da `apresentacao-vela.html` contra a documentação e o código,
> seguida de questionário com o dono do produto em 2026-09-23. As decisões abaixo
> foram tomadas nesse questionário; este plano não as reabre.

## Resultado pretendido

Ao final, a apresentação, a documentação viva e o comportamento do Vela dizem a
mesma coisa sobre quem faz cada ação, quando uma fatura sai e o que fica no
Histórico. Na prática, a equipe passa a ver:

- **Baplie EDI:** qualquer Departamento importa e reimporta o Baplie, na Viagem
  ou na tela Baplie, com confirmação antes de substituir o Baplie anterior.
- **Alerta "PIX sem conciliação segura":** fica na fila do Administrativo, que é
  quem abre a Conciliação PIX. Documentação e Equipamentos continuam avisados.
- **Carga solta sem CE Mercante:** aparece na Validação como *Aguardando CE
  Mercante*, não mais como *Pronto para emitir*.
- **Portal não provisionado:** bloqueia **toda** emissão, inclusive a automática
  no registro do CE. O Alerta crítico chega ao Administrativo, que pode liberar
  a emissão de um Cliente específico com justificativa. Quando o Portal fica
  Ativo, as faturas retidas saem sozinhas.
- **Disputa de Demurrage:** Equipamentos e Administrativo respondem, e a
  conversa mostra quem respondeu.
- **Escala sem vínculo:** qualquer Departamento remove, tanto em Viagens quanto
  em Chegadas e Saídas, com confirmação e registro no histórico da Viagem.
- **Granito:** continua como apoio operacional, sem fatura. O Alerta *Granito
  sem cliente* passa de Crítico para Normal.
- **CE Mercante por planilha:** passa a ser "tudo ou nada", como o EDI. A prévia
  lista todos os erros antes da confirmação.
- **Viagem:** as abas ficam na URL, então um link copiado abre na aba certa. Os
  atalhos voltam: *Resolver divergências* leva ao Baplie quando a Viagem está
  Divergente, e há links para BLs e Granito já filtrados na viagem.
- **Histórico do B/L:** passa a mostrar as mudanças feitas nos containers do
  B/L, como datas de descarga e devolução e IMO/OOG aplicados pelo Baplie.

## Fora de escopo

- **Chave global de envio de Comunicados (ADR 0059).** Está desligada por
  decisão temporária de desenvolvimento e não entra na apresentação.
- **Tabelas de Taxas Locais e condições negociadas.** Continuam editáveis por
  qualquer Departamento, com auditoria por linha. A decisão mantém a ADR 0046.
- **Manifesto BB na aba Importação da Viagem.** Não volta. Fica só em BLs.
- **Faturas já emitidas.** Não são reabertas nem recalculadas por nenhuma das
  mudanças.

## Decisões registradas (2026-09-23)

| # | Decisão | Tipo de mudança |
|---|---|---|
| R1 | Todo Departamento importa e reimporta o Baplie | Banco + tela |
| R2 | *PIX sem conciliação segura* é tratado pelo Administrativo | Catálogo de Alertas |
| R3 | Carga solta exige CE Mercante para faturar | Tela (Validação) |
| R4 | Portal não provisionado bloqueia sempre, inclusive a emissão automática | Banco (faturamento) |
| R5 | Sem Portal, o Alerta sobe ao Administrativo, que libera a emissão por Cliente com justificativa; a ativação emite o que estava retido | Banco + tela |
| R6 | Preços seguem editáveis por todos (ADR 0046) | Somente documentação |
| R7 | Granito não fatura; Alerta *Granito sem cliente* passa a Normal | Catálogo + ADR 0042 |
| R8 | Escala sem vínculo pode ser removida por todos, com confirmação | Tela |
| R9 | A aba Importação da Viagem fica como está no código | Documentação + apresentação |
| R10 | Religar os atalhos da Viagem (Baplie, BLs, Granito) | Tela |
| R11 | O Histórico do B/L mostra as mudanças nos containers | Banco (`bl_timeline`) |
| R12 | CE Mercante por planilha é "tudo ou nada" | Banco + tela |
| R13 | Equipamentos e Administrativo respondem disputa de Demurrage | Banco + tela + Portal |
| B1–B10 | Correções da documentação desatualizada, confirmadas item a item | Documentação |

Revisões de diagnóstico feitas durante o planejamento:

- **P1/P2 não é lacuna.** `save_bl_demurrage_config` já grava a configuração e
  a auditoria na mesma transação. Quem está errado é a documentação
  (`demurrage.md` e `manifesto-edi.md:304`).
- **Datas de container e marcações do Baplie são registradas.** A migration
  `015` grava o evento semântico, e o gatilho `audit_row_changes` grava cada
  coluna. O problema é de exibição: o gatilho grava `entity_type =
  'bl_containers'` (nome da tabela), e `bl_timeline` procura `'bl_container'`.

## Fontes de verdade

- `CONTEXT.md`: vocabulário, **Motivo de Bloqueio de Faturamento**, **Gate de
  faturamento do Portal**, **Escrita interna global**.
- ADRs 0042, 0046, 0054 e 0065, e a migration ativa `051_ce_mercante_auto_billing.sql`.
- `docs/modules/`: `viagens.md`, `manifesto-edi.md`, `taxas-locais.md`,
  `faturamento.md`, `demurrage.md`, `clientes.md`, `portal-cliente.md`,
  `chegadas-saidas.md`, `granito.md` e `operacao-suporte.md`.
- Catálogo de Alertas: tabela `alert_type_catalog` (semente em
  `002_business_logic_and_security.sql`), com espelhos em
  `src/services/alertRulesCatalog.ts` e `src/services/alerts.ts`.

## Ordem de entrega

A entrega é em três PRs, nesta ordem. A mudança do Portal (3.6) é a de maior
risco e fica numa PR própria dentro do Bloco 3.

### Bloco 1 — Documentação e apresentação (PR #719, `codex/apresentacao-vela`)

Corrige apenas o que já diverge do código atual. O que depende dos Blocos 2 e 3
é atualizado na PR que muda o comportamento.

1. **Lista B:**
   - **B1:** `manifesto-edi.md`, invariante 17. A importação de B/L calcula as
     taxas (migration 072).
   - **B2:** `manifesto-edi.md`, linha 232 e invariante 13. O Baplie é soberano
     sobre IMO, classe, ONU e OOG, sem a opção "manter".
   - **B3:** `viagens.md:157`. No ADR, Veículos é assinado por Equipamentos.
   - **B4:** `viagens.md`. Nova Viagem, Editar e Cancelar são de todo
     Departamento; excluir continua com o Administrativo.
   - **B5:** fica para o Bloco 2, onde as abas passam a ir para a URL.
   - **B6:** `viagens.md`, invariante 17. A escala omitida aparece no Portal
     como `OMIT`.
   - **B7:** `chegadas-saidas.md` e `manifesto-edi.md`. Retirar a restrição
     "papel diferente de Equipamentos".
   - **B8:** `taxas-locais.md:16`. Retirar as capacidades `charge_tables` e
     `charge_overrides`, que não existem. Corrigir também o comentário de
     `src/services/charges/chargeOperationsService.ts:16`.
   - **B9:** `demurrage.md`. As abas reais são Containers, Faturas, Pagas,
     Canceladas e Por Cliente, e não há rascunho.
   - **B10:** `clientes.md:7`. Documentação e Administrativo gerenciam o Portal.
2. **Diagnóstico revisado:**
   - Em `demurrage.md` (linhas 143 e 144) e em `manifesto-edi.md:304`, P1/P2
     são gravados de forma atômica por `save_bl_demurrage_config`.
   - Em `manifesto-edi.md:306`, a importação de datas em lote grava evento e
     auditoria. O que falta é a exibição no Histórico, tratada no Bloco 3.
3. **ADR 0042:** nota editorial dizendo que o Granito não fatura (decisão R7) e
   remetendo a `granito.md`.
4. **Apresentação, só o que já diverge do código atual:**
   - **ADR:** "fechado não muda" vira "reabrir exige o Administrativo e uma
     justificativa".
   - **Chegadas e Saídas:** "não escala", na edição, remove a escala quando não
     há vínculo.
   - **Importação:** "tudo de uma vez" deixa de valer para todo arquivo;
     explicar as exceções (lote de Chegadas, importação aceitando erros de linha).
   - **Aba Importação da Viagem:** sem Manifesto BB (R9).
5. **Checks:** `npm run docs:check`, `git diff --check` e o roteiro Playwright
   do deck (sem sobreposição, sem erro de JS).

### Bloco 2 — Correções de tela (branch nova)

1. **R3, CE na carga solta:** `src/components/billing/validacaoPipeline.ts`.
   *Aguardando CE Mercante* passa a valer para todo modo, exceto Granito
   (Granito já retorna antes). Regressão em `validacaoFunnel`/`validacaoPipeline`:
   carga solta sem CE, com cliente e cálculo completos, deve dar `aguardando_ce`.
2. **B5, abas na URL:** `src/pages/Viagens.tsx` e `VoyageCard.tsx`. Trocar de
   aba grava `?tab=`; a aba padrão remove o parâmetro, como na ficha do B/L.
   Preservar `escala`, `report` e `terminal`.
3. **R10, atalhos:** religar `NavigationCard`, ou substituí-lo e remover o
   código morto.
   - *Resolver divergências* leva a `/baplie?voyage=<id>` quando a conciliação
     é `divergente`.
   - Os links de BLs e Granito levam a `/bls?voyage=<id>` e `/granito?voyage=<id>`.
   - Antes, confirmar que `Bls.tsx` e `Granite.tsx` leem `?voyage=`.
   - Atualizar `viagens.md` (linhas 160 a 165 e 187) e a apresentação (slides
     Baplie e Viagem, nas abas).
4. **R8, remover escala (parte de tela):** em `ChegadasSaidas.tsx`, a edição
   que marca "não escala" num porto de descarga que tinha data pede confirmação
   (`clearedPodLabels`). A lixeira de `VoyageVisaoTab.tsx` continua exclusiva do
   Administrativo neste bloco: ela pode apagar `voyage_export_schedules`, cuja
   policy de DELETE exige `is_admin()`. A liberação foi para o Bloco 3 (item 7).
5. **Checks:** `npm run docs:check`, `npm run typecheck`, `npm run lint`,
   `npm test` e `npm run build`.

### Bloco 3 — Banco e contratos (branch nova; 3.6 numa PR separada)

Migrations novas a partir de `077_` (a `074`–`076` entraram pelo `main`; a `074`/`075` tratam anexos de disputa e devem ser relidas antes de R13). Toda migration que reescreva linhas
existentes (por exemplo, rerrotear Alertas ativos) declara no cabeçalho que se
apoia na linha "Data status" do `AGENTS.md`.

1. **R1, Baplie:**
   - `import_baplie_staging_transactional` deixa de exigir `is_admin()` e
     mantém `is_active_user()` e `auth.uid()`.
   - Em `src/pages/Baplie.tsx`, `canUploadManifests` passa a valer para usuário
     ativo.
   - Pedir confirmação explícita antes de substituir um Baplie existente
     (verificar se já existe).
   - Atualizar `manifesto-edi.md` (linhas 197 e 308), `CONTEXT.md` (Escrita
     interna global) e a nota da ADR 0046.
2. **R2 e R7, catálogo de Alertas:**
   - `pix_unreconciled` passa a ter o Administrativo como responsável, com
     audiência Administrativo, Documentação e Equipamentos.
   - `review_granite_customer_unlinked` passa a severidade Normal.
   - Rerrotear os itens ativos. Espelhar em `alertRulesCatalog.ts` e `alerts.ts`.
   - Atualizar os slides de Alertas: 18 críticos e 13 normais; PIX com o
     Administrativo.
3. **R13, disputa:**
   - As RPCs de responder e reabrir disputa (`002`, linhas 931 e 16840) aceitam
     `administrativo`.
   - O `author_type` ganha `administrativo`, com ajuste da constraint; o Portal
     exibe "Administrativo".
   - `DemurrageDisputeConversation.tsx` libera a resposta para os dois
     Departamentos.
   - Atualizar `CONTEXT.md` e `demurrage.md`.
4. **R12, CE planilha "tudo ou nada":**
   - Nova RPC transacional para as linhas da planilha, com o mesmo contrato de
     resultado do EDI (`ok=false` e nada gravado quando há qualquer erro).
   - A prévia lista todos os erros antes de confirmar.
   - Em `ceMercanteImport.ts`, deixar de chamar `apply_ce_mercante_update` linha
     a linha.
   - Atualizar `manifesto-edi.md:180` e a apresentação (slide Importação).
5. **R11, Histórico:**
   - `bl_timeline` passa a aceitar `entity_type IN ('bl_container',
     'bl_containers')` para os containers do B/L.
   - Teste de contrato SQL mais execução no Postgres local descartável.
   - Atualizar `manifesto-edi.md` (linhas 306 e 307) e confirmar a frase "tudo
     tem autor, data e motivo" da apresentação.
6. **R4 e R5, Portal como bloqueio universal (PR isolada):**
   - Retirar de `customer_billing_access_ready` a exceção
     `is_internal_auto_billing_context()` (migration 051). A transição do CE
     retém a emissão com `billing_hold_reason = 'Acesso ao portal nao
     provisionado'` e mantém o efeito recuperável.
   - Criar a **Liberação de faturamento sem Portal**, por Cliente, concedida
     pelo Administrativo, com justificativa, autor e data em auditoria. Com ela
     ativa, o bloqueio do Portal não se aplica àquele Cliente. Exibir e conceder
     na ficha do Cliente e no Console do Portal.
   - Garantir que `reprocess_customer_billing_after_portal_activation` emita as
     faturas retidas quando o Portal fica Ativo e quando a liberação é
     concedida. Teste no Postgres local.
   - Fazer o Alerta do Portal sem provisionamento chegar ao Administrativo como
     responsável.
   - Documentação:
     - nova ADR (supersede a exceção da 051 e a nota da 0054);
     - `CONTEXT.md` (Gate de faturamento do Portal; Desacoplamento financeiro do
       Portal);
     - `taxas-locais.md:216`, `portal-cliente.md:341` e `faturamento.md`;
     - apresentação: slide "Quatro perguntas" e jornada.

7. **R8, lixeira da escala para todos:** a exclusão de agendamento de
   exportação sem vínculo passa por uma RPC auditada (ou a policy de DELETE de
   `voyage_export_schedules` passa a aceitar `is_active_user()` com rastro); em
   `VoyageVisaoTab.tsx`, tirar o `isAdmin` da lixeira e manter a confirmação.
   Registrar como exceção à regra de exclusão da ADR 0046 e atualizar
   `viagens.md` (linha "Excluir snapshot/POD").

**Checks do Bloco 3:**

- `npm run docs:check`, `npm run typecheck`, `npm run lint`, `npm test` e
  `npm run build`.
- `npm run migrations:check` e `npm run rpc:check`.
- Testes `*.local-pg.test.ts` afetados, rodados no Postgres descartável.
- Não usar o Supabase compartilhado.

## Critérios de aceite

- Qualquer Departamento importa o Baplie pela Viagem sem erro de permissão, e a
  substituição pede confirmação.
- Na fila de Alertas, *PIX sem conciliação segura* aparece com o Administrativo
  como responsável.
- B/L só de carga solta, sem CE, aparece como *Aguardando CE Mercante* na
  Validação.
- Registrar o CE de um Cliente sem Portal Ativo não emite fatura. O B/L fica
  como *Portal não provisionado*, e o Administrativo recebe o Alerta. Conceder
  a liberação ou ativar o Portal emite a fatura sem outra ação.
- O Administrativo responde uma disputa, e o Portal mostra "Administrativo".
- A planilha de CE com uma linha inválida não grava nenhuma linha e mostra o
  erro na prévia.
- Uma data de devolução importada em lote aparece no Histórico do B/L com autor
  e data.
- O link copiado na aba Rotas e Manifestos abre nessa aba.
- Com a Viagem Divergente, *Resolver divergências* abre o Baplie da viagem.
- A documentação e a apresentação não contêm nenhuma das divergências listadas
  na origem deste plano.

## Riscos e rollback

- **3.6 muda quando o dinheiro é cobrado.** Clientes sem Portal passam a ter
  faturas retidas. Mitigação: a liberação por Cliente e o Alerta ao
  Administrativo. Rollback: migration que devolve a exceção interna de
  `customer_billing_access_ready`, sem tocar faturas já emitidas.
- **R12 pode atrasar faturas.** Uma linha ruim segura o lote inteiro. É o custo
  aceito pela decisão; a prévia completa reduz o retrabalho.
- **R1 aumenta a exposição a reimportações por engano.** A confirmação de
  substituição é obrigatória.
- **Não verificado em runtime:** o reprocessamento na ativação do Portal e os
  crons no ambiente remoto. A evidência final precisa dizer o que foi executado
  e onde.

## Pendências de decisão

- **Nomes das branches dos Blocos 2 e 3:** confirmar com o dono antes do
  primeiro push. A instrução da sessão restringe pushes a
  `codex/apresentacao-vela` sem permissão explícita.
- **Liberação de faturamento sem Portal:** a decisão R5 fixa o escopo por
  Cliente. Validade (permanente ou com data de revisão) é escolha de execução.
  Proposta: com data de revisão, reaproveitando o padrão da dispensa temporária
  de Alertas (ADR 0053).

## Registro de execução

- **2026-09-23 · Bloco 1 (PR #719):** feitas as correções B1–B4 e B6–B10, a
  revisão de diagnóstico (P1/P2, datas em lote, Baplie), a nota editorial na
  ADR 0042 e os ajustes da apresentação (ADR fechado, "não escala", gravação em
  bloco, aba Importação da Viagem, tabela de importadores). Checks:
  `docs:check`, `git diff --check`, `eslint` no arquivo alterado e roteiro
  Playwright dos slides alterados, sem sobreposição e sem erro de JS. B5 segue
  para o Bloco 2.
- **2026-09-23 · Bloco 2 (`codex/alinhamento-telas`):** feitos R3 (CE
  exigido na carga solta e no misto), B5 (abas da Viagem na URL), R10 (faixa
  "Atalhos da viagem"; `NavigationCard` removido por estar sem uso) e a parte de
  tela de R8 (confirmação em Chegadas e Saídas). Checks: `typecheck`, `lint`,
  `build`, `docs:check` e suíte completa; a única falha, em
  `VoyageCard.kpis.test.tsx` (falta de roteador para os novos `Link`), foi
  corrigida e reexecutada. Não houve verificação visual no app rodando.
