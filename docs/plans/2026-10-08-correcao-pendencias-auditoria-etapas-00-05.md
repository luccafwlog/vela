# Correção das pendências da auditoria das etapas 00–05

- **Data:** 2026-10-08
- **Origem:** "Pendências com dono" da [auditoria de conformidade das etapas 00–05](../archive/audits/2026-10-08-auditoria-contrato-etapas-00-05.md).
- **Campanha:** [revisão visual e UX](2026-10-07-revisao-visual-ux-prompts.md). Este plano não substitui nenhuma etapa. Ele organiza as "execuções focadas ao owner" previstas no item 7 de "Como enviar sem interferência".
- **Estado:** em execução (2026-10-08). R1, R2 (salvo R2.6), R4, R5 e R6 feitos localmente; R3 parcialmente revertido pela decisão do responsável sobre a ficha da viagem (ver registro). N1 e N2 em aberto.
- **Base exigida:** `main` com as correções da auditoria integradas. Hoje elas estão sem commit na branch `claude/auditoria-contrato-etapas-00-05` (passo R0).

## Resultado pretendido

Ao fim do plano, o que a pessoa vê nas telas das etapas 01–05 segue o contrato comum e o "Contrato visual":

- **Links e campos.** Links com cor de link aparecem na cor de link. Clicar na ajuda ou no erro de um campo não move o foco para o controle. O botão "Mostrar senha" não entra no nome do campo.
- **Menus e botões-ícone.** Existe um único menu "Mais ações" no design system, usado na ficha do B/L, em `/bls` e nas escalas da Viagem. Itens de menu, botões-ícone, opções de controle segmentado e caixas de seleção têm alvo de 44 px no toque e densidade de 36 px com mouse. Não sobra sobrescrita por página.
- **Tipografia.** Todo texto usa um dos sete degraus da escala: não sobra 15 px, 0,9 rem nem 28 px. Os toasts usam as cores semânticas do tema.
- **Shells e notificações.** "Recarregar perfil" mostra que está recarregando. "Marcar todas como lidas" mostra o andamento e explica a falha no painel, não só num toast. O erro da regra de senha aparece junto do campo na ativação e na recuperação do Portal. O departamento tem o mesmo nome no menu da conta e na Administração.
- **Viagens.**
  - O modal **Editar escala** tem no máximo duas colunas e não tem cartão dentro do modal. Usa o controle segmentado do design system.
  - **Cancelar viagem** confirma num só modal, sem abrir outro por cima, e o texto descreve o que de fato acontece com o Line-Up.
  - A aba ADR não tem quadro dentro de quadro nem gradiente.
  - Lápis e atalhos atingem o alvo mínimo.
  - Chegadas e Saídas usa a área de arquivo comum.
- **Importações.** O resultado parcial de veículos e da base de clientes tem teste.
- **BLs.**
  - "Excluir B/L" bloqueado explica o motivo na tela, não só num toast.
  - Uma falha ao consultar o Portal mostra erro com Tentar novamente, em vez de "Verificando situação do Portal…" para sempre.
  - `?page=` além do total leva à última página que existe.
  - A tabela de `/bls` mantém o número do B/L visível ao rolar na horizontal em 768 px.
  - Os números do detalhe da linha ficam alinhados à direita.
- **Etapas futuras.** As pendências das etapas 13, 19 e 21 entram no prompt da etapa dona como itens obrigatórios. Não são corrigidas fora de ordem (decisão D3).

## Fora de escopo

- Executar a etapa 06 ou qualquer outra etapa da campanha.
- Regra de negócio, cálculo, autorização, RLS, RPC, schema, parser, cache, clientes de autenticação e arquivos protegidos. Exceção: o filtro de viagens canceladas na TV, se N2 decidir mudar a regra. Nesse caso ele vira uma mudança de domínio separada, fora deste plano.
- Reescrever os registros históricos das etapas ou o relatório da auditoria.
- Redesenhar telas de 06–23. Os itens de R1 mudam primitivas que essas telas consomem. A execução confere esses consumidores, mas não os redesenha.

## Restrições e fontes de verdade

- `AGENTS.md`, contrato comum e "Contrato visual" do plano da campanha. A matriz "Propriedade de superfícies compartilhadas" define quem edita cada arquivo.
- Uma execução por vez, na ordem abaixo. Cada uma parte da base que já integra a anterior (item 4 de "Como enviar").
- Cole o **contrato comum** no início de cada sessão de execução. A auditoria mostrou que a falta dele é a origem dos desvios de acabamento.
- Runtime em ambiente local descartável. Use a seção "Ambiente local para evidência" da campanha ou a pilha da auditoria: Postgres local, `sb-shim` e `/sb-proxy`. Nunca use o Supabase real. Não crie nem altere `.env`.
- Commit, push e PR só com autorização explícita de quem pediu a execução.

## Decisões

### Em aberto (bloqueiam só os itens indicados)

| Id | Pergunta | Alternativas | Recomendação | Itens travados |
|---|---|---|---|---|
| N1 | O wordmark "Vela" em Syne conta como a "única linha em Syne" da tela? | (a) Não conta: é marca, não título. Registrar a exceção no "Contrato visual". (b) Conta: no `/login`, o título "Acesso interno" passa a DM Sans, ou o wordmark sai de perto do título | (a). A marca aparece em todas as telas do shell, e a regra existe para hierarquia de títulos | R2.6 |
| N2 | Viagem cancelada sai do Line-Up na TV? O modal diz que sim, mas `LineUpTVDisplay.tsx:86` e `lineup.ts:735` continuam mostrando a viagem | (a) Sim: a correção é de domínio (filtro da TV), em mudança separada com teste do serviço; o texto do modal fica. (b) Não: a TV mostra a viagem como cancelada, e o texto do modal passa a dizer isso | Perguntar a Operações. Até a resposta, R3.3 só muda a estrutura do modal (Voltar e confirmação única) e mantém o texto atual | Texto de R3.3 |

### Com padrão (seguir a recomendação salvo instrução contrária)

| Id | Escolha | Padrão |
|---|---|---|
| D3 | Quando corrigir as pendências de 13, 19 e 21 | Inserir cada uma no prompt da etapa dona (R6), como item de aceite. Corrigir agora significaria editar arquivos que essas etapas vão redesenhar, contra "Não execute outras etapas" |
| D4 | O que `?page=` além do total faz | Ir para a última página existente com `replace`, sem nova entrada no histórico. A página vazia só aparece quando não há registro nenhum |
| D5 | Onde explicar "Excluir B/L" bloqueado | Aviso na lista, acima da tabela, com os B/Ls bloqueados, o motivo e "Fechar aviso". Mesmo padrão do aviso de cancelamento da ficha (correção 19 da auditoria) |
| D6 | Nome da primitiva de menu | `ActionMenu` em `src/components/ui/`. Antes de criar, confirmar que o nome está livre |

## Ordem de execução

```text
R0 integrar a auditoria
 └─ R1 etapa 01 (primitivas) ── destrava R2.5, R3.1, R3.5, R5.4, R5.6
     ├─ R2 etapa 02 (shells)
     ├─ R3 etapa 03 (Viagens)
     ├─ R4 etapa 04 (importações): independe de R1 e pode ir em qualquer posição depois de R0
     └─ R5 etapa 05 (BLs)
R6 prompts de 13, 19 e 21 + registro: só documentação, ao fim
```

R0 e R1 precisam acontecer **antes da etapa 06**: as etapas 06–23 vão adotar o menu, a densidade de botão-ícone e o `Field`. R2 a R5 devem ir antes da 06, para não misturar acabamento de 01–05 com telas novas. Se precisarem esperar, precisam estar integradas antes da 23.

Cada execução termina com os gates do `AGENTS.md` (`docs:check`, `typecheck`, `lint`, `test`, `build`, mais `a11y:contrast` quando mudar cor ou token, e `git diff --check`). Termina também com uma linha no registro deste plano, descrita em "Registro de execução".

## R0 — Integrar as correções da auditoria

- **O que fazer:** levar à `main` o diff da branch `claude/auditoria-contrato-etapas-00-05`: as 22 correções, o relatório, a nota no plano da campanha, o índice e este plano. É preciso autorização para commit, push e PR.
- **Aceite:** a `main` contém o relatório em `docs/archive/audits/`, e o CI está verde. A partir daí, todas as execuções abaixo usam essa revisão como base.

## R1 — Etapa 01: tokens e primitivas

Arquivos donos: `src/components/ui/*` e base/tokens de `src/index.css`. Toques em CSS de outra etapa só para remover sobrescritas que a primitiva passa a cobrir. Declarar cada toque no registro.

| # | Problema | O que muda | Aceite e evidência |
|---|---|---|---|
| R1.1 | `a { color: inherit }` (`index.css:295`) fica fora de camada e vence `text-[var(--app-link)]` em 16 arquivos TSX | Mover a regra para `@layer base` | **Teste:** `DesignSystemCssContract.test.ts` exige a regra dentro de `@layer base`. **Runtime:** em `/bls`, na ficha do B/L e em `/viagens/10`, um link com utilitário de cor tem a cor de link, e um link sem utilitário continua herdando. Listar os 16 consumidores e conferir um de cada etapa de 06–23 como regressão (sem redesenho). Declarar a mudança de cor nessas telas no registro |
| R1.2 | `Field` põe controle, ajuda e erro dentro do `<label>` (`Input.tsx:52-60`), e o "Mostrar senha" do `PasswordInput` também fica dentro | Contêiner `div.app-field`, `<label htmlFor>` só com o rótulo, `id` injetado no controle via `useId` (respeitando um `id` já passado), e ajuda e erro como irmãos ligados por `aria-describedby`. Mantém o *fallback* quando o filho não é um elemento único | **Teste:** o nome acessível do campo é só o rótulo. Clicar na ajuda não foca o controle. `getByLabelText` continua achando os controles da suíte inteira. O nome do campo de senha não inclui "Mostrar senha". `npm test` completo sem ajuste de consulta. Se algum teste depender do nome antigo, corrigir o teste e citá-lo no registro |
| R1.3 | Não há primitiva de menu. A 05 criou `BlMenu` local (com `ponytail:`), e a 03 deixou Omitir/Excluir na linha | `ActionMenu` (D6): gatilho com `aria-haspopup`/`aria-expanded`, foco no primeiro item, setas, Home/End, Escape e clique fora devolvem o foco ao gatilho, item destrutivo, alinhamento `start`/`end` (absorve `.app-floating-menu--start`) e itens com 44 px no toque | **Teste** de comportamento da primitiva: teclado, Escape com retorno, item desativado ignorado. A migração dos consumidores fica em R3.5 e R5.4 |
| R1.4 | `.app-table__icon-button` tem 44 px fixos (travados no teste de contrato). A 03 sobrescreveu para 36 px (`index.css:8423`) e a 05 para 32 px (`index.css:9316`) | Densidade igual à do `Button`: 36 px com ponteiro fino e 44 px com toque. Atualizar `DesignSystemCssContract.test.ts` para as duas densidades. Levar à primitiva as sobrescritas locais da 05 (`.app-bl-metrics .app-metric-tile`), se forem genéricas | **Teste:** contrato de CSS para fino e toque. **Runtime:** `/bls`, `/viagens/10` e `/clientes` sem botão-ícone abaixo de 36 px (fino) ou 44 px (toque). As sobrescritas locais saem em R3.6 e R5.6 |
| R1.5 | A regra global `button[aria-label]:has(> svg:only-child)` (`index.css:6652`) dá 40 px no toque, e o contrato pede 44. Isso deixa a faixa de avisos com 40 px. As opções do `SegmentedControl` têm 38 px no toque | 44 px no toque nas duas regras, sem alterar a altura com mouse | **Runtime** a 768 e 360 com toque: faixa de avisos, lente de `/bls` e botões-ícone do shell com 44 px. Conferir que a faixa de avisos não cresce com mouse (contrato: até 28 px) |
| R1.6 | Tamanhos fora da escala: `.app-confirm__message` e `.app-empty-state__title` com 15 px; `.app-workspace-nav__label` com 0,9 rem; título do Portal com 28/36 abaixo de 640 px | 15 px → `--app-size-body` ou `--app-size-section`, conforme o papel. 0,9 rem → `--app-size-body`. Título do Portal com 32/40 do contrato em toda largura; se quebrar mal a 360 px, usar `--app-size-page` e registrar o motivo | **Runtime:** nenhum texto fora dos sete degraus nas rotas de 01–05. **Teste:** contrato de CSS cobrindo os seletores |
| R1.7 | Hex fixos nos toasts (`.app-toast*`, `index.css:3779` em diante) | Aliases semânticos com par escuro. Acrescentar o par a `scripts/check-theme-contrast.mjs` se faltar | `a11y:contrast` verde com os pares dos toasts. **Runtime** no tema claro e no escuro |
| R1.8 | `Textarea` sem `ref`. O modal de COD usa o `<textarea>` nativo com as classes para ter foco inicial | `forwardRef` em `Textarea`, como `Input` | **Teste:** `ref` aponta para o elemento. A troca no modal de COD fica em R5.5 |
| R1.9 | `TabButton` sem `tabindex` itinerante: todas as abas entram na ordem do Tab, embora `TabList` já trate setas | Aba ativa com `tabIndex=0` e as demais com `-1` | **Teste:** Tab entra na aba ativa e sai da faixa. Setas continuam ativando a vizinha |
| R1.10 | `StepRail` sem estado de desvio (omissão). A 05 lê o desvio como "Pendente" com o texto da etapa | Novo `StepState` (por exemplo `diverted`), com rótulo em texto e marcador que não dependa só da cor | **Teste** da primitiva. A adoção no trilho do B/L fica em R5.7 |
| R1.11 | `PreviewBox variant="metric-strip"` gera `.app-metric-strip` sem CSS | Sem consumidor fora do teste: remover a variante e o caso de teste, salvo se o grep na execução mostrar consumidor | **Código:** grep sem consumidor. Teste atualizado |

## R2 — Etapa 02: shells, acesso, perfil e notificações

Arquivos donos: `src/components/layout/*`, `src/components/portal/NotificationBell.tsx`, telas de acesso e perfil (matriz da 02).

| # | Problema | O que muda | Aceite e evidência |
|---|---|---|---|
| R2.1 | "Recarregar perfil" (`ProtectedRoute.tsx:36`) sem estado em andamento | `loading` e `loadingLabel` no botão, impedindo repetição | **Teste:** o botão mostra "Recarregando…" e fica desativado durante a chamada |
| R2.2 | "Marcar todas como lidas" só fica desativado, sem andamento, nos dois sinos | Estado em andamento no botão | **Teste** nos dois sinos |
| R2.3 | Toast "A lista de notificações mudou…" (`InternalNotificationBell.tsx:42`) é a única explicação | Aviso dentro do painel do sino, com "Atualizar lista". O toast pode continuar como confirmação | **Teste:** o aviso aparece no painel quando a lista muda |
| R2.4 | Erro da regra de senha no fim do formulário em `PortalAtivacao.tsx` e `PortalResetPassword.tsx` | Erro no `Field` do campo correspondente (senha ou confirmação), via `error`, com o foco indo para o campo | **Teste:** o erro de "As senhas não conferem." fica ligado ao campo de confirmação por `aria-describedby`. **Runtime** a 360 px |
| R2.5 | `departmentLabel` diverge de `PROFILE_LABELS` (`services/adminUsers.ts:57`). O shell mostra "Documentação" para `operator`, e a Administração mostra "Operador (legado)". A equivalência `operator=documentacao` está em `docs/RASTREABILIDADE.md` | Uma fonte só para os perfis geridos. O sufixo "(legado)" fica restrito à Administração, que precisa distinguir o papel antigo | **Teste:** os dois rótulos coincidem nos cinco perfis geridos. Os perfis legados seguem a tabela documentada |
| R2.6 | Título de acesso com 28/36 no celular. Wordmark junto do título em Syne no `/login` | Título conforme R1.6. Wordmark conforme N1 | **Runtime:** `/login` e as telas públicas do Portal a 360 px, com uma linha em Syne por tela, salvo a exceção decidida em N1 |
| R2.7 | Faixa de avisos com 40 px no toque | Nenhuma mudança na 02: herda R1.5. Só conferir | **Runtime** a 768 px com toque |

## R3 — Etapa 03: Viagens, escalas, programação e TV

Arquivos donos: `src/components/voyages/*`, `src/components/shared/VoyageScheduleModals.tsx`, `src/pages/Viagens.tsx`, `src/pages/ChegadasSaidas.tsx`, TV e blocos `.app-voyage*`, `.app-escala*` e `.app-lineup*` de `index.css`.

| # | Problema | O que muda | Aceite e evidência |
|---|---|---|---|
| R3.1 | Modal **Editar escala** com três colunas (`VoyageScheduleModals.tsx:202`, `:1109`, `:1171`, `:1195`), seções em cartões com borda e segmentado local Sim/Não de 26 px | No máximo duas colunas a partir de 640 px e uma no celular. Seções separadas por título e espaço, sem borda de cartão. `SegmentedControl` no lugar do segmentado local. Caixas Granito/Embarque com 44 px no toque (R1.5) | **Runtime** a 1440 e 360: 0 texto abaixo de 12 px, 0 caixa alta, nenhum alvo abaixo de 44 px no toque, ordem de foco igual à visual. **Teste:** `VoyageScheduleModals.test.tsx` lê Sim/Não como grupo de rádio |
| R3.2 | Botão "Continuar" do modal Cancelar viagem (`Viagens.tsx:453`) abre um `ConfirmDialog` por cima do modal | Uma única confirmação, com justificativa, consequência, "Voltar" e "Cancelar viagem" com estado em andamento, sem modal sobre modal | **Teste:** existe um único `dialog` aberto, "Voltar" fecha sem cancelar, e a confirmação chama o mesmo serviço de antes com a mesma justificativa |
| R3.3 | O texto diz que a viagem "sai do Line-Up", mas a TV continua mostrando | Depende de N2. Até lá, manter o texto | Registrar a decisão e o texto final |
| R3.4 | Aba ADR com quadro dentro de quadro e `MetricPanel` com gradiente (`VoyageAgencyReportTab.tsx:877`) | Uma superfície, com seções separadas por título. Métrica sem gradiente, em tokens | **Runtime** a 1440 e 360 e no tema escuro, sem rolagem horizontal |
| R3.5 | Omitir/Excluir escala soltos na linha | Mover para `ActionMenu` (R1.3), mantendo as confirmações atuais | **Teste:** as ações ficam no menu, e a confirmação continua exigida. **Runtime** com teclado |
| R3.6 | Lápis do rail com 28 px com mouse. Atalhos "Baplie EDI" e "B/Ls da viagem" com 32 px no toque. Busca com 42 px no toque. Sobrescrita `.app-voyage-plan .app-table__icon-button` (`index.css:8423`) | Usar as densidades de R1.4 e R1.5 e remover a sobrescrita | **Runtime:** nenhum alvo abaixo de 36 px (fino) ou 44 px (toque) em `/viagens/10` |
| R3.7 | Input nativo em Chegadas e Saídas (`ChegadasSaidas.tsx:208`) | `ImportFilePicker` (dono 04, só reutilizar), com limite de `MAX_UPLOAD_BYTES` e mensagens próprias | **Teste:** os casos de arquivo grande e de falha de leitura continuam passando, agora pelo picker |
| R3.8 | CSS morto em `.app-voyage-actions .app-btn` (`index.css:6064`) | Remover depois de confirmar por grep que não há consumidor | **Código:** grep sem consumidor |

## R4 — Etapa 04: experiência comum de importações

| # | Problema | O que muda | Aceite e evidência |
|---|---|---|---|
| R4.1 | Resultado parcial de veículos sem teste | Teste de comportamento: importação com linhas aceitas e recusadas mostra as duas contagens, a lista de problemas e "Concluir", sem toast como única saída | **Teste** novo, que falha se o painel parcial sumir |
| R4.2 | Resultado parcial da base de clientes sem teste | Mesmo teste no `ImportBaseModal` | **Teste** novo |

Só testes, sem mudança de comportamento. Se um teste revelar defeito, corrigir no owner da 04 e registrar.

## R5 — Etapa 05: BLs internos e ficha do B/L

Arquivos donos: `src/pages/Bls.tsx`, `src/pages/BlDetalhe.tsx`, `src/components/bl/*` (exceto o que a matriz reserva a outras etapas) e blocos `.app-bl-*`.

| # | Problema | O que muda | Aceite e evidência |
|---|---|---|---|
| R5.1 | "Excluir B/L" bloqueado só em toast (`Bls.tsx:220`) | Aviso na lista (D5) com os números bloqueados e o motivo de cada um, a partir do mesmo `checkBlDependencies` | **Teste:** com todos bloqueados, o aviso mostra os motivos, e nenhuma confirmação de exclusão abre. Com parte bloqueada, a confirmação lista os bloqueados, como hoje |
| R5.2 | Erro da consulta do Portal preso em "Verificando situação do Portal…" (`BlClienteSection.tsx:354`) | Separar carregando, erro e sem conta. No erro, `InlineError` com Tentar novamente, chamando `refetch` | **Teste:** com a consulta falhando, aparece o erro e Tentar novamente refaz a consulta |
| R5.3 | `?page=` além do total mostra "Nenhum B/L cadastrado ainda." | D4: com total conhecido e página maior que a última, trocar o parâmetro pela última página com `replace` | **Teste:** `/bls?page=99` com 2 páginas abre a página 2, e a URL passa a `page=2`. Sem registros, continua o vazio inicial |
| R5.4 | `BlMenu` local | Migrar para `ActionMenu` (R1.3), remover `BlMenu` e o comentário `ponytail:` | **Teste:** `Bls.test.tsx` e `BlDetalhe.test.tsx` passam com o menu novo, sem mudar as consultas por papel e nome |
| R5.5 | O modal de COD usa `<textarea>` nativo para ter foco inicial | `Textarea` com `ref` (R1.8) | **Teste:** o foco inicial continua na justificativa |
| R5.6 | Botão-ícone de 32 px e sobrescritas `.app-bl-row-actions .app-table__icon-button` e `.app-bl-card …` (`index.css:9316`), mais `.app-bl-toolbar__lens .app-segmented*` (`index.css:10033`) | Remover as sobrescritas cobertas por R1.4 e R1.5 | **Runtime:** a linha de `/bls` mantém 49 px de altura (medida da auditoria) e alvos de 36 px (fino) e 44 px (toque) |
| R5.7 | O trilho do B/L lê o desvio como "Pendente" | Usar o estado novo de R1.10 em `blRailSteps` | **Teste:** `blRailSteps.test.ts` espera o estado de desvio |
| R5.8 | Tabela de 960 px sem primeira coluna fixa a 768 px | Primeira coluna (número do B/L) fixa na rolagem horizontal, como pede o "Contrato visual" | **Runtime** a 768 px rolando a tabela: o número continua visível, e o cabeçalho continua fixo |
| R5.9 | Números da `DetailTable` em `BlRowDetail` sem alinhamento à direita | Colunas numéricas à direita, com `tabular-nums` | **Runtime** e **Código** |

## R6 — Pendências de etapas futuras e registro

Só documentação, no plano da campanha (seção "Prompts por etapa", que é viva):

- **13:** no prompt, como item de aceite: "`AgencyReportDocument` (`InvoiceDocTitle uppercase`, linha 601) sem título em caixa alta".
- **19:** "`Painel.tsx` sem os textos de 11 px apontados pela auditoria de 2026-10-08 (16 ocorrências no runtime); `PortalDashboard.tsx:88` sem rótulo em caixa alta espaçada".
- **21:** "título do modal de `VaziosImportacao.tsx:435` em caixa normal e com acento: 'Importar planilha de vazios (importação)'".
- No índice `docs/plans/README.md`, atualizar a linha deste plano. Quando R0–R5 estiverem integradas e R6 escrita, arquivar este plano em `docs/archive/plans/` na mesma mudança e remover a linha do índice.

## Riscos e reversão

- **R1.1 (link) muda a cor de links em telas de 06–23.** É a correção pretendida, mas aparece em telas fora de 01–05. *Mitigação:* conferir um consumidor por etapa e declarar no registro. *Reversão:* devolver a regra para fora de camada; nenhuma outra mudança depende dela.
- **R1.2 (`Field`) muda a estrutura de todos os formulários.** *Mitigação:* a suíte inteira roda, e ajustes de teste ficam citados. *Reversão:* o commit de R1.2 isolado volta ao `<label>` envolvente.
- **R1.4 e R1.5 mudam alturas.** As listas podem pular: a linha de `/bls` tinha 49 px, e as primeiras linhas estão medidas na auditoria. *Mitigação:* repetir as medidas de primeira linha e altura de linha da auditoria e explicar qualquer diferença.
- **R3.2 mexe na confirmação de uma ação de negócio.** O serviço, a justificativa e a consequência não mudam, só a apresentação. O teste confirma a mesma chamada.
- **Em todas as execuções:** sem mudança de RPC, schema, cache ou autorização. Se alguma correção exigir isso, parar e registrar como pendência de domínio.

## Registro de execução

| Passo | Estado | Base / revisão | Resumo, arquivos, checks, evidência e pendências |
|---|---|---|---|
| R0 | Em andamento | branch `claude/auditoria-contrato-etapas-00-05` | Commit e push na branch autorizados em 2026-10-08; PR e integração à `main` pendentes |
| R1 | Feito | base `2bddc66` + diff da auditoria | `@layer base` no link; `Field` com `htmlFor` (`labelableControls.ts`); `ActionMenu` (ex-`BlMenu`); botão-ícone e `--sm` com `--app-control-h`; 44 px no toque (ícone, segmentado); escala 7 degraus; toasts semânticos; `Textarea` com ref; `TabButton` itinerante; `StepRail` com `diverted`; `metric-strip` removido. Títulos públicos do Portal 32/40. **Teste** e **Runtime** (44 px no toque, 0 texto fora da escala nas rotas 01–05) |
| R2 | Feito, salvo R2.6 (N1) | idem | Recarregar perfil e Marcar todas com andamento; aviso no painel do sino com Atualizar lista; erro de senha no campo; `DEPARTMENT_LABELS` como fonte única. **Teste** |
| R3 | Parcial | idem | Feitos: R3.1 (Editar escala em 2 colunas, `SegmentedControl`), R3.2 (cancelamento em confirmação única), R3.7 (picker comum em Chegadas e Saídas), R3.8. Revertidos pela decisão do responsável de 2026-10-08 (faixa, ficha e TV voltam ao anterior à etapa 03): R3.4, R3.5 e a parte da ficha/faixa de R3.6. R3.3 aguarda N2 |
| R3 (ficha) | Feito | sobre o R3 acima | Complemento do responsável de 2026-10-08: ficha da viagem com a composição restaurada e melhorias (faixa azul-marinho lisa, filetes `--app-border-soft`, blocos sem sombra nem degradê, `TabList` com atalhos em link, rótulos ≥ 12 px em caixa normal, botões-ícone com a variante e `--app-control-h`, grade com `minmax(0, 1fr)` contra estouro a 360 px). **Teste** (`VoyageCard.kpis`, abas de Viagens) e **Runtime** em `/viagens/10` a 1440, 768 e 360 px e no tema escuro: sem rolagem horizontal, atalhos e "Mostrar todos" com 44 px no toque. Pendente: selo "Informar" e rota em Rotas e Manifestos abaixo de 44 px no toque; ADR com rótulos em caixa alta e abaixo de 12 px (R3.4 revertido) |
| R4 | Feito | idem | Testes de resultado parcial de veículos (`VoyageImportActions`) e da base de clientes (`ImportBaseModal`) |
| R5 | Feito | idem | Exclusão bloqueada explicada na lista; erro da consulta do Portal com Tentar novamente; `?page=` fora do total vai à última página; `ActionMenu`; `Textarea` no COD; sobrescritas removidas; trilho com Desvio; coluna do B/L fixa; números à direita. Linha de `/bls` passou de 49 para 53 px com mouse (botão de 36 px do contrato). **Teste** e **Runtime** |
| R6 | Feito | idem | Itens de aceite nos prompts 13, 19 e 21 |
| N1 | Em aberto | — | — |
| N2 | Em aberto | — | — |
