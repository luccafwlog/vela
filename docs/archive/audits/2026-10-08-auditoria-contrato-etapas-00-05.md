# Auditoria de conformidade das etapas 00–05 da revisão visual

- **Data:** 2026-10-08  
- **Base auditada:** `main` em `2bddc66` (merge da PR 902, etapa 05), sem diff local antes desta auditoria.
- **Critério:** contrato comum, "Contrato visual" e prompts das etapas 00–05 em [`docs/plans/2026-10-07-revisao-visual-ux-prompts.md`](../../plans/2026-10-07-revisao-visual-ux-prompts.md), lidos na revisão-base.
- **Pergunta:** algumas sessões podem ter começado sem o contrato comum colado. Isso deixou desvios reais? Onde?
- **Fora do escopo:** a etapa 06 e as seguintes não foram executadas. Desvios que pertencem a etapas futuras ficaram como pendência com dono.

## Conclusão

**A ausência do contrato colado não prejudicou o que é estrutural.** Nas seis etapas:
- nenhuma mexeu em regra de negócio, autorização, RLS, RPC, schema, parser, integração bancária, clientes de autenticação ou arquivo protegido;
- todos os toques fora dos donos estão declarados;
- todos os registros de entrega têm base, decisões, checks, evidência rotulada, pendências com dono e limites;
- a lógica nova tem teste.

**Prejudicou o acabamento**, em cinco pontos que o contrato comum pede explicitamente e as etapas aplicaram só ao que redesenharam. Estes desvios foram confirmados em Runtime ou Código. Os pequenos foram corrigidos nesta auditoria e os demais ficaram com dono.

1. **CSS herdado que a etapa não abriu (01, 03).** A 01 migrou as primitivas que reescreveu, mas deixou sem declarar:
   - texto de 11 px em `FilterBar`, `WorkspaceNav`, `PreviewBox`/KPI e no aviso "Deslize para ver mais";
   - caixa alta espaçada nos fatos do `ConfirmDialog`.

   A 03 mediu as abas da Viagem, mas não mediu o modal **Editar escala**, que tinha 11 px, caixa alta, Syne em modal e tamanhos fora da escala.
2. **Estados de erro e toast (03, 05).** O contrato pede "erro com Tentar novamente" e "toast nunca como única explicação". Encontramos:
   - lista de Viagens com erro mostrando "Nenhuma viagem";
   - detalhe da Viagem e efeitos pós-importação pedindo para "recarregar a página";
   - leitura da planilha de Chegadas e Saídas só em toast;
   - cancelamento de B/L bloqueado só em toast;
   - falha parcial do Histórico do B/L escondida.
3. **Comportamento observado só em runtime (01, 05).** A barra de ações em massa ficava debaixo do cabeçalho fixo. A barra de salvar de Detalhes do B/L não grudava no rodapé. Nenhuma das duas aparecia nos testes de DOM.
4. **Contraste e alvo de toque (01, 03, 05).** "Pendente" na faixa de viagens tinha 2,85:1; "atracada" no Line-Up tinha 3,3:1. Itens de menu tinham 36–39 px no toque, e a regra global de botão-ícone tem 40 px (o contrato pede 44).
5. **Documento vivo (04, 05).** O índice `docs/plans/README.md` continuou dizendo "próxima: etapa 04".

O registro não permite afirmar quais sessões começaram sem o contrato colado. Os desvios acima se concentram nos itens do contrato comum que não estão repetidos nos prompts por etapa: estados, toast, 360 px, alvo de toque, documentos vivos e "Não invente…". Isso é compatível com sessões que leram o plano, onde está o contrato visual, mas não tinham o texto do contrato comum como checklist. A autorização de commit e PR de cada etapa ficou nas conversas e **não é verificável** pelo repositório.

## Método, ambiente e limites

- **Código:**
  - `git show` de cada commit de etapa contra sua revisão-base registrada:

    | Etapa | Commit | Base |
    |---|---|---|
    | 00 | `af01b26` | `ba7cd09` |
    | 01 | `8fd98f4` | `74d8256` |
    | 02 | `1271b32` | `59dd88d` |
    | 03 | `1b2b7fc` | `521183d` |
    | 04 | `6032ff4` | `834cc37` |
    | 05 | `5e14c61` | `e04950d` |

    Cada etapa é um único commit cujo pai é a base registrada. O merge da 01 (`59dd88d`) também traz a PR 897 (`fd34bfb`, documentação do Pix), que não é da campanha.
  - Leitura dos arquivos em `HEAD` e varredura de `uppercase`, `tracking-*`, `text-[9–11px]`, hex e classes do tema escuro nos donos de cada etapa, como triagem.
  - Três leituras independentes por subagente, uma para 01–02, uma para 03–04 e uma para 05. Os achados usados aqui foram reconferidos no código ou no runtime.
- **Teste:** suítes focadas durante as correções e, ao fim, os gates do `AGENTS.md` (ver "Gates").
- **Runtime** em ambiente local descartável, nesta sessão:
  - **Sistema e banco:** contêiner Linux (não macOS), Postgres 16 em diretório temporário com `LC_ALL=C`, `--auth=trust --no-locale`, porta 55432 e socket em `/tmp/vaud`.
  - **Bootstrap:** `bootstrap.sql` sem `create extension pg_cron`, mais os shims cron/vault/net/storage de `setup-local-pg.sh`. As migrations 003/005 só criam `pg_cron` se a extensão existir, então nenhum stub foi gravado no diretório de extensões.
  - **Carga:** 160 migrations, os grants de `local-stack.ps1`, `validation_seed.sql` e `seed_audit.sql`. CNPJs normalizados para a forma de `canonicalizeDocument` com `session_replication_role=replica`.
  - **Aplicação:** `sb-shim.cjs` com `pg@8` instalado fora do repositório, e Vite com `.env.development.local` (`/sb-proxy`).
  - **Navegador:** Chromium 1194 (`/opt/pw-browsers/chromium`) e Playwright 1.63 do repositório. Login de auditoria `auditor@local.test` (Administrativo).
  - **Dados sintéticos acrescentados só nesse banco:**
    - B/L `COSU6401234506` cancelado, com motivo;
    - fatura de Demurrage `DEM-AUD-0001` com disputa aberta no B/L `COSU6401234501`;
    - 45 B/Ls `AUDX…` para lista longa;
    - Cliente 109 com nome de 101 caracteres, para conteúdo longo.

    O erro de consulta foi simulado por teste de componente, não por interceptação no navegador.
  - **Ocorrência na execução:** às 10:57 as permissões do diretório da sessão mudaram, e o Postgres parou com `PANIC: could not open pg_control`. Os dados foram movidos para `/tmp/vaud-data`, e as medições afetadas (360 px a partir da ficha do B/L e a rodada 1440 com alvos) foram refeitas.
  - Nenhuma gravação, envio, emissão ou baixa foi confirmada. As capturas ficaram fora do repositório.
- **Não verificado:**
  - leitor de tela real e zoom de 200%;
  - login real do Portal: as telas autenticadas foram vistas pelo Modo Inspeção, e as públicas sem sessão;
  - impressão;
  - TV com mais de oito escalas;
  - gravações reais;
  - erro de consulta no navegador: só por teste;
  - chip "Omitida" do ADR em runtime: o seed não tem escala omitida;
  - autorização de commit e PR de cada etapa.

## Medidas de runtime

### Rotas (antes das correções)

Todas as rotas das etapas 01–05 foram medidas nas três larguras:
- `/login`, `/perfil`, rota inexistente;
- `/viagens`, `/viagens/10` e as quatro abas, `/viagens/11`, `/viagens/999`;
- `/chegadas-saidas`, `/line-up-tv/display`;
- `/bls`, e a ficha do B/L em contêiner, cada aba, cancelado, carga solta, sem cliente e inexistente;
- inspeção do Portal: painel, perfil e operação;
- as cinco telas públicas do Portal.

As larguras foram 1440×900, 768×1024 com toque e 360×780 com toque.

| Medida | Resultado (**Runtime**) |
|---|---|
| Rolagem horizontal da página | 0 em todas as rotas e larguras |
| Erros de console | 0 nas rotas, salvo a queda do Postgres registrada acima |
| Texto abaixo de 12 px | 0 nas rotas das etapas 01–05. No Painel, 17 ocorrências: 16 de `Painel.tsx` (dono 19) e 1 do chip "Escalas ativas" de `FilterBar` (dono 01, corrigido) |
| Caixa alta | Só nos cards do Painel do Portal (`PortalDashboard.tsx`, dono 19). Nos modais: "Consequência"/"Desfazer" (`ConfirmDialog`, 01) e "Carga de exportação", "Atracações por terminal", "Restow" e o nome do porto ("VITORIA") no modal Editar escala (03) |
| Primeira linha de dado, `/bls` | 429 px (1440), 558 px (768), 555 px (360, cartão). Linha de 49 px na tabela e cartão de 155 px; igual ao registro da 05 |
| Primeira linha, planejamento de `/viagens/10` | 1146 px (1440), 1495 px (768), 2146 px (360). É a divergência intencional declarada pela 03 (ficha master-detail) |
| Primeira linha, ficha do B/L | Trilho em 119 px. Carga 729 px, Faturamento 886 px e Detalhes 746 px (1440) |
| Syne | Uma linha de título por tela, mais o wordmark "Vela" do shell. No `/login`: "Vela" e "Acesso interno" (ver pendência 02) |
| Tema escuro (`data-visual-theme="dark"`) | `/viagens/10`, `/chegadas-saidas`, `/bls`, Faturamento do B/L e `/perfil`: sem texto pequeno, sem caixa alta, sem rolagem e sem erros |
| Portal público | 15 medições (5 telas × 3 larguras): sem rolagem, sem texto pequeno, sem erros, uma linha em Syne por tela |

### Modais e menus (antes das correções)

| Superfície | Foco inicial | Escape e retorno de foco | Observação |
|---|---|---|---|
| Alterar minha senha | Primeiro campo | Fecha, volta a "Alterar senha" | 480 px; 360 px em folha |
| Nova Viagem | Primeiro campo | Fecha, volta ao botão | — |
| Editar escala | Campo ETA | Fecha, volta a "Editar planejamento da escala BRVIX" | 6 textos de 11 px, 4 em caixa alta e rádio Sim/Não de 26 px (1440) ou 34 px (toque) |
| Adicionar navio (Chegadas) | Campo Navio | Fecha, volta ao botão | — |
| Menu Importar de `/bls` | Primeiro item | Fecha, volta a "Importar" | Itens de 36–39 px no toque |
| B/L de contêiner, CE Mercante, Manifesto BB | Primeiro campo | Fecha, volta a "Importar" | — |
| ⋮ da linha de `/bls` e "Mais ações do B/L" | Primeiro item | Fecha, volta ao gatilho | Itens de 36–39 px no toque |
| Base de clientes | Título | Fecha, volta a "Importar base" | Título em Title Case |
| Datas de descarga e Baplie (Viagem) | Área de arquivo | Fecha, volta ao botão | — |
| Reativar B/L (`ConfirmDialog`) | Justificativa | Fecha, volta a "Mais ações do B/L" | "Consequência"/"Desfazer" em caixa alta |
| Cancelar B/L com fatura aberta | — | — | Não abre confirmação: o motivo aparece só num toast |
| Menu móvel (360) | "Painel" | Fecha, volta a "Menu" | — |

### Sondas específicas

As medidas abaixo são de 1440 px.

| Sonda | Antes (**Runtime**) | Depois (**Runtime**) |
|---|---|---|
| "Pendente" na faixa de viagens | `#d4882e` sobre branco, **2,85:1** | `--app-warning-fg`, **6,5:1** |
| "Atracada" no Line-Up do Painel | `#16a34a`, **3,3:1** | `--app-success-fg`, **5,38:1** |
| Barra de salvar de Detalhes do B/L, com alteração e no topo da página | `top` 1729 px numa janela de 900 px: fora da vista | `top` 793 px e `bottom` 900 px: grudada no rodapé |
| Barra de ações em massa em `/bls`, rolada 600 px | `top` 29 px, sob o cabeçalho (`bottom` 57 px); o clique cai no cabeçalho | `top` 64 px; o clique cai na barra |

A rodada "depois" das rotas e modais está em "Correções feitas".

## Tabelas por etapa

Legenda: **Conforme**; **Corrigido** (desvio corrigido nesta auditoria); **Pendente → dono**; **Não verificável**.

### Etapa 00: direção visual e inventário (só documentação)

| Critério | Veredicto | Evidência |
|---|---|---|
| A. Limites | Conforme | **Código:** `af01b26` altera só o plano, `docs/plans/README.md` e uma linha de `docs/ARCHITECTURE.md`. Nenhuma tela foi tocada |
| B. Contrato visual | Não se aplica | A etapa produz o contrato |
| C–E. Estados, acessibilidade, larguras | Não se aplica | Só documentação. A linha de base de runtime está registrada com limites |
| F. Processo | Conforme, com ressalva | **Código:** o registro tem base, Runtime rotulado, lacunas e complementos da matriz. Ressalva: o alvo "lente Modalidade duplica o filtro do painel (**Código**)" não existia, como a 05 registrou. O inventário afirmou uma duplicação que o código não tinha |
| G. Regressões | Não se aplica | — |

### Etapa 01: tokens e primitivas

| Critério | Veredicto | Evidência |
|---|---|---|
| A. Limites | Conforme | **Código:** fora dos donos, só `app-shell--*` em `AppLayout`/`PortalLayout` (declarado), `lib/pagination.ts` (novo, declarado) e `scripts/check-theme-contrast.mjs`. Nada em services, hooks, RPC, migrations ou arquivos protegidos |
| B. Tipografia e caixa | **Corrigido** | **Código + Runtime:** 11 px em `.app-filter-bar__count`, `.app-filter-bar__applied` ("Escalas ativas" no Painel), `.app-workspace-nav__count`, `.app-table-scroll--sticky::after`, `.app-kpi-card__label`/`__sub`; caixa alta em `.app-kpi-card__label` (0,10 em) e `.app-confirm__fact dt` (0,06 em, visto no Reativar B/L). Nenhum estava declarado como pendência |
| B. Cor do tema antigo | **Corrigido** | **Código:** `PreviewBox` `surface` com `uppercase tracking-wider text-slate-500` e `text-white`. Sem consumidor hoje; no Portal, sem o remapeamento claro de `index.css:6072`, sairia branco sobre papel |
| B. Escala fora dos 7 degraus | Pendente → 01 | **Código:** `.app-confirm__message` e `.app-empty-state__title` (15 px), `.app-workspace-nav__label` (0,9 rem), título do Portal a 28/36 abaixo de 640 px (registrado pela 01 sem justificativa). Hex fixos nos toasts |
| C. Estados | Conforme | **Teste:** `QueryStateGate.test.tsx` (erro com Tentar novamente, offline), `TableFooterPagination.test.tsx` ("Nenhum registro"), `AccessiblePrimitives.test.tsx` (botão em andamento) |
| D. Foco do modal | **Corrigido** | **Código + Teste:** com o foco inicial no título (modal de leitura), Shift+Tab saía do modal. `Modal.tsx` passou a tratar o título; o teste novo falha sem a correção |
| D. Campo e abas | Pendente → 01 | **Código:** `Field` põe ajuda, erro e controle dentro do `<label>` (`Input.tsx:52-60`), com o "Mostrar senha" do `PasswordInput` dentro dele. `TabButton` sem tabindex itinerante. `Textarea` sem `ref` |
| E. Larguras e alvo | **Corrigido** em parte; resto Pendente → 01 | **Runtime:** a barra de ações em massa ficava sob o cabeçalho (corrigido) e os itens de `.app-floating-menu` tinham 36–39 px no toque (corrigido para 44). Pendentes: regra global `button[aria-label]:has(> svg:only-child)` com 40 px no toque, anterior à campanha, enquanto o contrato pede 44 (a faixa de avisos fica com 40 px por causa dela); opções do `SegmentedControl` com 38 px no toque; `.app-table__icon-button` com 44 px fixos, que levou a 03 a sobrescrever para 36 e a 05 para 32 |
| F. Processo | Conforme, com ressalva | **Código:** registro completo e testes de regressão das primitivas. Ressalvas: sem lista de arquivos e sem declarar as sobras do item B |
| G. Regressões posteriores | Conforme | **Código:** 03, 04 e 05 não alteraram `:root`, `.app-btn`, `.app-table` base nem `.app-tabs`. A 04 mudou só `order: -2` em `.app-summary-strip` (declarado e correto). A falta de primitiva de menu levou a 05 a criar `BlMenu` local (declarado, com `ponytail:`) → pendência 01 |

### Etapa 02: shells, acesso, perfil e notificações

| Critério | Veredicto | Evidência |
|---|---|---|
| A. Limites | Conforme | **Código:** `ProtectedRoute` mantém as mesmas condições (`loading`, `!user`, `!profile`, `adminOnly`, `permission`) e só troca a apresentação. Sem mudança em `services/supabase.ts`, sessão ou RPC. O CSS do shell em `index.css` está declarado |
| B. Contrato visual | Conforme, com pendências | **Código:** sem `text-[9–11px]`, `uppercase`, hex ou tema escuro nos TSX donos. **Teste:** `DesignSystemCssContract.test.ts` (shell sem texto abaixo de 12 px, dourado só na ativa). Pendências: título de acesso a 28/36 no celular; "Vela" em Syne junto do título no `/login`; `departmentLabel` diverge de `PROFILE_LABELS` |
| C. Estados | **Corrigido** em parte; resto Pendente → 02 | **Código + Teste:** o sino do Portal fazia `await markRead.mutateAsync` sem tratamento, e uma falha virava rejeição silenciosa. Corrigido com aviso, como no sino do Vela; teste novo. Pendentes: "Recarregar perfil" sem estado em andamento; "Marcar todas" só desativado; toast "A lista de notificações mudou" como única explicação |
| D. Acessibilidade | **Corrigido** em parte; resto Pendente → 02 | **Código:** `StatusScreen` usava `id="app-status-title"` fixo; passou a `useId()`. **Runtime:** menu móvel com foco no primeiro item, e Escape devolve a "Menu"; Alterar senha com foco inicial e retorno. Pendente: erro da regra de senha no fim do formulário em `PortalAtivacao` e `PortalResetPassword` |
| E. Larguras | Conforme, com pendência | **Runtime:** cinco telas públicas e `/perfil` sem rolagem nas três larguras. A faixa de avisos tem 28 px com mouse e 40 px no toque: decisão declarada pela 02 sobre a regra global de 40 px (ver 01) |
| F. Processo | Conforme | **Código:** registro com base, decisões, pendências (01, 18, Negócio) e "Não verificado"; docs vivos atualizados; testes novos |
| G. Regressões posteriores | Conforme | **Código:** 03–05 não tocaram `components/layout` nem os seletores do shell |

### Etapa 03: Viagens, escalas, programação e TV

| Critério | Veredicto | Evidência |
|---|---|---|
| A. Limites | Conforme | **Código:** `useVoyageDetail` com `maybeSingle` só para leitura; `voyageSummaries` só repassa `ata`, que já existia; a legenda do Painel é texto. `lineUpStatus.ts` unifica a apresentação do status de CE sem mudar a origem. **Teste:** `LineUpTVDisplay.behavior.test.tsx` (CEs iguais ao Painel). Tudo declarado |
| B. Modal Editar escala | **Corrigido** (tipografia); Pendente → 03 (colunas) | **Runtime + Código:** 11 px e caixa alta em `.app-escala-subsection-title`, `.app-escala-berth__front`/`__restow`; nome do porto em caixa alta; Syne no título e no código do terminal dentro do modal; 15 e 12,5 px. Corrigido para os degraus e DM Sans. "Nº MANIFESTO" passou a "Nº do manifesto". Pendente: três colunas no modal (`md:grid-cols-3`, `app-escala-field-grid--three`) e o segmentado local Sim/Não de 26 px |
| B. Cor e contraste | **Corrigido** | **Runtime:** "Pendente" no rail com 2,85:1 e "atracada" no Line-Up com 3,3:1, agora 6,5:1 e 5,38:1. **Código:** o chip "Omitida" do ADR usava `text-white`, remapeado para tinta escura no tema claro sobre o botão azul; agora herda o branco do botão. `text-[26px]` passou a `text-2xl` |
| B. Textos e botões | **Corrigido** em parte; resto Pendente → 03 | **Código:** "Adicionar Navio", "Baixar Planilha Modelo" e "Fazer Upload" passaram a "Adicionar navio", "Baixar planilha modelo" e "Enviar planilha"; "ja nao" passou a "já não". Pendentes: o botão do modal Cancelar viagem diz "Continuar" e abre um `ConfirmDialog` sobre o modal; quadro dentro de quadro e `MetricPanel` com gradiente na aba ADR |
| C. Estados | **Corrigido** | **Código + Teste:** a lista de Viagens com erro mostrava "Nenhuma viagem para os filtros atuais" e um texto pedindo para recarregar; agora mostra "Não foi possível carregar as viagens" com Tentar novamente (o teste novo falha sem a correção). O detalhe com erro ganhou Tentar novamente. A falha de leitura da planilha de Chegadas e Saídas aparece no conteúdo (teste novo) |
| D. Acessibilidade | **Corrigido** em parte; Conforme | **Runtime:** Nova Viagem, Editar escala e Adicionar navio com foco inicial, Escape e retorno. **Código:** `aria-controls` das abas inativas apontava para painéis inexistentes; agora só a aba ativa aponta |
| E. Larguras e alvo | Pendente → 03 | **Runtime:** sem rolagem da página. Lápis do rail com 28 px com mouse; atalhos "Baplie EDI" e "B/Ls da viagem" com 32 px no toque; busca com 42 px no toque. A tabela de planejamento rola dentro da área a 360 px (limite declarado) |
| F. Processo | Conforme, com ressalva | **Código:** registro completo; `escalaPresentation.test.ts`, `ShipScheduleWidget.test.tsx`; docs de Viagens e Chegadas atualizados. Ressalva: a medida "texto abaixo de 12 px → 0" não incluiu o modal Editar escala |
| G. Regressões | Conforme | **Código:** as remoções em `index.css` são dos próprios blocos `.voyage-rail*`, `.app-voyage*` e `.app-lineup*`. Sobrou CSS morto em `.app-voyage-actions .app-btn` |

### Etapa 04: experiência comum de importações

| Critério | Veredicto | Evidência |
|---|---|---|
| A. Limites | Conforme | **Código:** `fileGuard.ts` só exporta `MAX_UPLOAD_BYTES`. Em `Bls.tsx`, `Clientes.tsx` e `VaziosImportacao.tsx` há só ligação, declarada. Payloads de gravação, parsers, matchers e `importCore.ts` estão inalterados |
| B. Contrato visual | **Corrigido** | **Runtime:** título "Importar Base de Clientes" em Title Case, agora "Importar base de clientes". Restante conforme: `.app-import*` com tokens e aliases, códigos em mono, botões com verbo e objeto |
| C. Estados | **Corrigido** | **Código + Teste:** `ImportResultPanel` com erro pedia para recarregar a página; agora tem Tentar novamente (teste novo). Os relatórios de problemas de Vazios e do Manifesto BB perderam o nome próprio ao sair o painel duplicado; voltaram a `vazios-importacao-issues.csv` e `manifesto-bb-issues.csv`. Os resultados parciais existem no código (**Teste:** B/L e datas) |
| D. Acessibilidade | Conforme | **Runtime:** sete modais de importação com nome, foco inicial, Escape e retorno. **Código:** `ImportFilePicker` com input focável, `aria-label` e `aria-describedby` |
| E. Larguras | Conforme | **Runtime:** modais em folha a 360 px, sem rolagem da página |
| F. Processo | **Corrigido** | **Código:** o commit não atualizou `docs/plans/README.md`, que ficou em "próxima: etapa 04"; corrigido. Faltam testes de resultado parcial de veículos e da base de clientes (Pendente → 04) |
| G. Regressões | Conforme | **Código:** a 05 não reintroduziu painel duplicado, não usou input nativo nem editou `.app-import*` |

### Etapa 05: BLs internos e ficha do B/L

| Critério | Veredicto | Evidência |
|---|---|---|
| A. Limites | Conforme | **Código:** os três cards leem os mesmos campos de `operational_list_bl_summary` (migration 064), e o antigo "Faturados" era o mesmo `chargeReady`. `useBlDetail` com `maybeSingle` mais um embed de leitura. Componentes 07, 10, 11 e 04 não alterados. Não declarado, mas sem efeito de regra: o filtro "Taxas locais" passou a listar os 6 valores do CHECK |
| B. Contrato visual | Conforme | **Código + Runtime:** número em DM Sans 24/600, códigos em mono, três cards que filtram, uma ação secundária e ⋮ por linha, até três colunas em Detalhes, "Voltar" em todas as confirmações, sem texto pequeno nem caixa alta |
| C. Estados | **Corrigido** em parte; resto Pendente → 05 | **Runtime + Teste:** cancelar B/L com fatura aberta só mostrava um toast; agora o motivo fica na ficha (teste novo, falha sem a correção). Resumo com erro mostrava "—" sem saída; ganhou "Resumo indisponível" com Tentar novamente. Falha parcial do Histórico escondida quando os comunicados carregavam; agora avisa que a lista está incompleta. "Marcar COD" e "Remover exceção" ganharam estado em andamento. Pendentes: "Excluir B/L" bloqueado só em toast (`Bls.tsx:220`); erro da consulta do Portal preso em "Verificando situação do Portal…" (`BlClienteSection`); `?page=` além do total mostra "Nenhum B/L cadastrado ainda" |
| D. Acessibilidade | **Corrigido** em parte; Conforme | **Runtime:** menus com foco no primeiro item e Escape com retorno. **Código:** `aria-controls` das abas inativas corrigido; grupo de cards com `role="group"`. **Teste:** `Bls.test.tsx` (menu e lente) |
| E. Larguras e alvo | **Corrigido** em parte; resto Pendente → 05 | **Runtime:** barra de salvar de Detalhes presa no fim do cartão (`overflow: hidden` de `.app-surface`); agora gruda no rodapé, com margem de 18 px abaixo de 480 px. Itens do `BlMenu` passaram a 44 px no toque (via 01). Pendentes: tabela de 960 px sem primeira coluna fixa a 768 px; lente com opções de 38 px no toque (primitiva 01) |
| F. Processo | **Corrigido** | **Código:** `docs/plans/README.md` desatualizado (ver 04). O título de teste "refletindo na URL" não conferia a URL; foi ajustado ao que o teste verifica |
| G. Regressões | Conforme, com pendência 01 | **Código:** `index.css` só acrescenta `.app-bl-*`. Sobrescritas locais não declaradas: `.app-bl-metrics .app-metric-tile`, botão-ícone de 32 px e `.app-floating-menu--start` (pendência 01) |

## Correções feitas

A evidência "antes" é da base `2bddc66`, e a "depois" é deste checkout. Nenhuma correção mudou regra de negócio, RPC, schema ou cache.

| # | Etapa dona | Antes → depois | Evidência | Arquivos |
|---|---|---|---|---|
| 1 | 01 | 11 px nas contagens de `FilterBar` e `WorkspaceNav`, no chip "Escalas ativas", no aviso "Deslize para ver mais" e no KPI → 12 px | Runtime (Painel 17 → 16 textos, os restantes são da 19); Código | `src/index.css` |
| 2 | 01 | Caixa alta espaçada no rótulo do KPI e nos fatos do `ConfirmDialog` → caixa normal | Runtime (Reativar B/L); Código | `src/index.css` |
| 3 | 01 | `PreviewBox surface` com `slate`/`text-white` e caixa alta → tokens | Código | `src/components/ui/PreviewBox.tsx` |
| 4 | 01 | Barra de ações em massa sob o cabeçalho → abaixo dele | Runtime (sonda) | `src/index.css` |
| 5 | 01 | Itens de `.app-floating-menu` com 36–39 px no toque → 44 px | Runtime | `src/index.css` |
| 6 | 01 | Shift+Tab escapava do modal de leitura → fica preso | Teste novo (falha sem a correção) | `src/components/ui/Modal.tsx`, `__tests__/Modal.test.tsx` |
| 7 | 02 | Falha ao marcar notificação do Portal sem aviso → aviso de erro, e o conteúdo abre | Teste novo | `src/components/portal/NotificationBell.tsx`, `__tests__/NotificationBell.behavior.test.tsx` |
| 8 | 02 | `id` fixo em `StatusScreen` → `useId()` | Código | `src/components/layout/StatusScreen.tsx` |
| 9 | 03 | Modal Editar escala: 11 px, caixa alta, Syne em modal, 15 e 12,5 px → degraus do contrato e DM Sans; "Nº do manifesto" | Runtime; Teste ajustado | `src/index.css`, `src/components/shared/VoyageScheduleModals.tsx` e teste |
| 10 | 03 | Contraste de "Pendente" (2,85 → 6,5:1) e de "atracada" (3,3 → 5,38:1) | Runtime (sonda) | `src/components/voyages/VoyageRail.tsx`, `src/index.css` |
| 11 | 03 | Chip "Omitida" com `text-white` remapeado; `text-[26px]` | Código | `src/components/voyages/VoyageAgencyReportTab.tsx` |
| 12 | 03 | Erro da lista e do detalhe de Viagens sem Tentar novamente; erro aparecendo como lista vazia | Teste novo (falha sem a correção) | `src/pages/Viagens.tsx`, `__tests__/Viagens.behavior.test.tsx` |
| 13 | 03 | Leitura da planilha de Chegadas e Saídas só em toast → aviso no conteúdo; rótulos em caixa normal e com verbo | Teste novo; testes ajustados | `src/pages/ChegadasSaidas.tsx` e teste |
| 14 | 03 | "ja nao" → "já não"; `aria-controls` só na aba ativa | Código | `VoyageVisaoTab.tsx`, `VoyageCard.tsx` |
| 15 | 04 | "Importar Base de Clientes" → "Importar base de clientes" | Runtime; teste ajustado | `src/components/customers/ImportBaseModal.tsx`, `Clientes.behavior.test.tsx` |
| 16 | 04 | Erro de efeitos pós-importação pedia para recarregar → Tentar novamente | Teste novo | `src/components/shared/ImportResultPanel.tsx` e teste |
| 17 | 04 | Relatórios de problemas voltaram ao nome próprio | Código (comparação com `834cc37`) | `src/pages/VaziosImportacao.tsx`, `src/components/bl/BlBreakbulkManifestModal.tsx` |
| 18 | 05 | Barra de salvar de Detalhes não grudava → gruda no rodapé | Runtime (sonda) | `src/components/bl/BlOperacionalTab.tsx`, `src/index.css` |
| 19 | 05 | Cancelamento bloqueado só em toast → aviso na ficha com o motivo | Runtime (antes); teste novo (falha sem a correção) | `src/pages/BlDetalhe.tsx`, `__tests__/BlDetalhe.test.tsx` |
| 20 | 05 | Resumo com erro sem saída; falha parcial do Histórico escondida | Código | `src/pages/Bls.tsx`, `src/components/bl/BlHistoricoTab.tsx` |
| 21 | 05 | "Marcar COD" e "Remover exceção" sem estado em andamento; `aria-controls`; `role="group"`; título de teste | Código | `BlTransshipmentCard.tsx`, `BlTerminalOverrideCard.tsx`, `BlDetalhe.tsx`, `Bls.tsx`, `Bls.test.tsx` |
| 22 | 04/05 | Índice de planos em "próxima: etapa 04" → estado atual | Código | `docs/plans/README.md` |

### Rodada "depois" (**Runtime**, mesmo ambiente, mesmas rotas e modais)

- **Rotas:** as 28 rotas internas e de inspeção foram medidas em 1440, 768 e 360 px; as telas públicas do Portal em 1440 e 360; o tema escuro nas mesmas 5 amostras.
  - Rolagem horizontal da página: 0. Erros de console: 0.
  - Posições de primeira linha e alturas de linha idênticas às de antes: `/bls` 429/558/555 px; `/viagens/10` 1146/1495 px; ficha do B/L 119 px. Nenhuma correção mudou o layout das listas.
  - Texto abaixo de 12 px no Painel: 17 → 16 (o que sobra é de `Painel.tsx`, dono 19).
- **Modais e menus:** os 35 casos (1440 e 360) mantiveram nome acessível, foco inicial, fechamento por Escape e retorno de foco.
  - Editar escala: 0 texto abaixo de 12 px e 0 caixa alta (antes 6 e 4).
  - Reativar B/L: os fatos do `ConfirmDialog` saíram da caixa alta.
  - "Importar base de clientes" em caixa normal.
  - Itens dos menus do B/L sem alvo abaixo de 44 px no toque (antes 36–39 px).
  - Cancelar B/L com fatura aberta mostra na ficha "O B/L … não pode ser cancelado agora: fatura em aberto, recebível em aberto, fatura de Demurrage em aberto…" com "Fechar aviso".
  - Restam, no modal Editar escala, o segmentado Sim/Não com 26 px (1440) e 34 px (toque) e as caixas Granito/Embarque com 38 px no toque (pendência 03).

## Pendências com dono

| Dono | Pendência | Evidência |
|---|---|---|
| 01 | Mover `a { color: inherit }` (`index.css:295`) para `@layer base`. Hoje vence `text-[var(--app-link)]` em cerca de 20 arquivos (pendência da 02 e da 05). Não corrigido aqui porque muda a cor de links em telas de 06–23 | Código |
| 01 | `Field` com ajuda, erro e controle dentro do `<label>`; o "Mostrar senha" do `PasswordInput` também fica dentro. Mudar exige ajustar nomes acessíveis em consumidores e testes | Código |
| 01 | Primitiva de menu ("Mais ações"); depois, a 05 migra o `BlMenu` e a 03 tira Omitir/Excluir da linha | Código |
| 01 | Densidade de `.app-table__icon-button` (44 px fixos, travados em `DesignSystemCssContract.test.ts`), sobrescrita para 36 px pela 03 e 32 px pela 05. Incorporar ao primitivo as sobrescritas locais da 05 (`.app-bl-metrics .app-metric-tile`, `.app-floating-menu--start`) | Código |
| 01 | Regra global de botão-ícone com 40 px no toque contra os 44 px do contrato; ela também deixa a faixa de avisos com 40 px. Opções do `SegmentedControl` com 38 px no toque | Runtime |
| 01 | Tamanhos fora da escala: 15 px (`.app-confirm__message`, `.app-empty-state__title`), 0,9 rem (`.app-workspace-nav__label`), título do Portal a 28/36 no celular. Hex nos toasts. `TabButton` sem tabindex itinerante. `Textarea` sem `ref`. `StepRail` sem estado de desvio. `PreviewBox metric-strip` sem CSS | Código |
| 02 | "Recarregar perfil" sem estado em andamento. "Marcar todas" só desativado. Toast "A lista de notificações mudou" como única explicação. Erro da regra de senha longe do campo em `PortalAtivacao` e `PortalResetPassword`. `departmentLabel` diverge de `PROFILE_LABELS`. Título de acesso a 28/36 no celular | Código |
| 02 / Negócio | Decidir se o wordmark "Vela" em Syne conta como a única linha em Syne. Hoje aparece junto do título no `/login` e no shell | Runtime |
| 03 | Modal Editar escala com três colunas, seções em cartões com borda dentro do modal e segmentado local de 26 px (migrar para `SegmentedControl`); caixas Granito/Embarque com 38 px no toque. Botão "Continuar" e `ConfirmDialog` sobre o modal em Cancelar viagem. Quadro dentro de quadro e `MetricPanel` com gradiente na aba ADR. Lápis do rail com 28 px; atalhos com 32 px no toque. Input nativo em Chegadas e Saídas (pode usar `ImportFilePicker`). CSS morto em `.app-voyage-actions .app-btn` | Runtime e Código |
| 03 / Negócio | O modal de cancelamento diz que a viagem "sai do Line-Up", mas a TV continua mostrando viagens canceladas (`LineUpTVDisplay.tsx:86`, `lineup.ts:735`). Confirmar a regra antes de mudar texto ou filtro | Código |
| 04 | Testes de resultado parcial de veículos e da base de clientes | Código |
| 05 | "Excluir B/L" bloqueado só em toast (`Bls.tsx:220`). Erro da consulta do Portal preso em "Verificando…" (`BlClienteSection`). `?page=` além do total mostra o vazio inicial. Tabela de 960 px sem primeira coluna fixa a 768 px. Números da `DetailTable` em `BlRowDetail` sem alinhamento à direita | Código e Runtime |
| 13 | `AgencyReportDocument` com título em caixa alta; não corrigido por pertencer à 13 | Código |
| 19 | `Painel.tsx` com 16 textos de 11 px; `PortalDashboard.tsx` com rótulos em caixa alta espaçada | Runtime |
| 21 | Título "Importar Planilha de Vazios (Importacao)" em `VaziosImportacao.tsx`, além da pendência já registrada pela 04 | Código |

## Gates

Executados neste checkout depois das correções. Ambiente: Node 22.22, Linux.

| Gate | Resultado (**Teste**) |
|---|---|
| `npm run docs:check` | Passou: 187 arquivos Markdown, 63 rotas e cobertura do índice de ADR |
| `npm run typecheck` | Passou (`tsc -b` sem erros) |
| `npm run lint` | Passou (`eslint .` sem avisos) |
| `npm test` | Passou: 716 arquivos, 4.078 testes; 57 arquivos e 412 testes pulados: integrações de banco que só rodam com `LOCAL_PG_INTEGRATION=1`, não habilitadas aqui |
| `npm run build` | Passou |
| `npm run a11y:contrast` | Passou: 34 de 34 pares. As cores novas usam aliases já verificados (`--app-warning-fg`, `--app-success-fg`, `--app-danger-fg`) |
| `git diff --check` | Sem problemas |

Testes novos que falham sem a correção:
- `Modal.test.tsx`: Shift+Tab no modal de leitura;
- `Viagens.behavior.test.tsx`: erro da lista;
- `BlDetalhe.test.tsx`: cancelamento bloqueado.

Testes novos de comportamento:
- `NotificationBell.behavior.test.tsx`: falha ao marcar como lida;
- `ImportResultPanel.test.tsx`: Tentar novamente;
- `ChegadasSaidas.behavior.test.tsx`: falha de leitura no conteúdo.

Testes de rótulo ajustados ao novo texto: Chegadas e Saídas, Editar escala, base de clientes e o título do teste de cards de `/bls`.
