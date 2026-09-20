# Auditoria forense de UI, design system e acessibilidade

- **Data:** 2026-09-20
- **Base:** `7052c0bf` (`codex/ui-ux-interface`)
- **Superfícies:** Vela interno e Portal Fwlog
- **Método:** inspeção estática dos componentes e telas solicitados, dos
  tokens em `src/index.css`, dos contratos de domínio e das rotas atuais.
  Razões de contraste calculadas a partir dos valores CSS vigentes.
- **Limite da evidência:** o stack de auditoria visual não foi iniciado nesta
  rodada; portanto, viewport, foco real no navegador, console, rede e leitor de
  tela permanecem sem evidência de runtime. Cenários abaixo são simulações
  derivadas do código, não observações de produção.

## Resumo executivo

Não foi encontrado P0. Foram encontrados **6 P1** e **9 P2**. Os riscos mais
importantes não são estéticos: mensagens técnicas podem chegar cruas à pessoa,
estados críticos perdem a semântica de cor, o fechamento do ADR ocorre sem
confirmação e menus que se anunciam como `menu` não implementam o respectivo
contrato de teclado. No tema escuro, campos e três tons de badge ficam abaixo de
4,5:1.

Pontos corretos confirmados por código: skip link nas duas superfícies;
`aria-current="page"` fornecido pelos `NavLink`; modal com foco inicial, focus
trap, `Escape` e devolução do foco; toasts com fechamento manual, expiração de
4,5 s para sucesso/informação e 8 s para erro; truncamentos principais com
`title`; paginação desabilitada nas extremidades; e wrappers de tabela com
rolagem horizontal sinalizada no mobile.

## Achados

### [P1 - CONFIANÇA] Erros de banco e RPC podem ser exibidos sem tradução

- **Gravidade:** P1 (quebra de confiança e exposição de mensagem técnica)
- **Eixo Afetado:** Confiança
- **Localização Exata:** exclusão em BLs, Containers e Viagens;
  `src/pages/Bls.tsx:282-284`, `src/pages/Containers.tsx:181-183`,
  `src/pages/Viagens.tsx:210-212`; fallback de rota em
  `src/components/ErrorBoundary.tsx:71-74`.
- **Comportamento Atual (O que a pessoa vê):** o `message` original de qualquer
  `Error` é concatenado ao toast. Na error boundary interna, o detalhe técnico
  fica disponível também fora do bloco condicionado a desenvolvimento usado no
  Portal.
- **Problema de UX:** nomes de constraint, códigos como `42501`, mensagens em
  inglês ou detalhes de Postgres parecem falha não tratada e não orientam a
  recuperação.
- **Evidência no Código / CSS:** `const detail = err instanceof Error ?
  err.message : 'erro desconhecido'` e `<pre>{this.state.error.message}</pre>`.
  O repositório já possui `classifyDbError` em `src/lib/errors.ts`, mas esses
  caminhos não o usam.
- **Cenário de Falha:** *simulação* — em **Containers**, o Administrativo tenta
  excluir uma linha ainda referenciada; o toast mostra `violates foreign key
  constraint ...` em vez de explicar que o container está em uso.
- **Recomendação de Design:** centralizar a apresentação em um helper que use
  `classifyDbError`, com título curto, causa humana e próxima ação. Renderizar o
  `<details>` técnico apenas em `import.meta.env.DEV`; em produção, mostrar um
  identificador de suporte, nunca a mensagem bruta.

### [P1 - CONFIANÇA] Estados críticos usam tons neutros e contradizem a semântica oficial

- **Gravidade:** P1 (sinal operacional contraditório)
- **Eixo Afetado:** Confiança
- **Localização Exata:** Planejamento por escala em
  `src/components/voyages/VoyageVisaoTab.tsx:270-286`; status de fatura em
  `src/pages/faturamentoInvoiceStatus.ts:24-28`; status de Viagem em
  `src/lib/statusLabels.ts:84-88`; restituição em
  `src/components/billing/InvoiceDetailModal.tsx:465-473`.
- **Comportamento Atual (O que a pessoa vê):** `OMIT`, Fatura Cancelada,
  Restituição Cancelada e Viagem Concluída podem aparecer em cinza (`slate`).
- **Problema de UX:** a mesma aparência neutra significa ora cancelamento, ora
  conclusão, ora ausência. A pessoa perde o sinal de risco ou de sucesso ao
  varrer a tabela.
- **Evidência no Código / CSS:** `<Badge tone="slate">OMIT</Badge>`,
  `cancelled -> 'slate'` e `completed: 'slate'`.
- **Cenário de Falha:** *simulação* — em **Viagens**, uma escala omitida se
  mistura visualmente aos badges neutros de quantidade de Atracações; o
  operador não percebe rapidamente que o porto não será atendido.
- **Recomendação de Design:** mapear `OMIT` e cancelamentos para `red`; mapear
  concluído/pago/liberado para `green`; reservar `slate` para neutro/histórico.
  Centralizar esses mapas ao lado de `statusLabels.ts` e adicionar testes de
  contrato semântico.

### [P1 - CONVERSÃO] Fechar e reabrir ADR têm proteção e hierarquia inconsistentes

- **Gravidade:** P1 (ação de impacto executada ou apresentada como comum)
- **Eixo Afetado:** Conversão
- **Localização Exata:** aba ADR da Viagem,
  `src/components/voyages/VoyageAgencyReportTab.tsx:676-701`;
  reabertura departamental em
  `src/components/voyages/DepartmentSignoffControl.tsx:60-93`.
- **Comportamento Atual (O que a pessoa vê):** **Fechar ADR** chama a mutation
  diretamente, sem modal. **Reabrir** abre um modal com justificativa, mas tanto
  o gatilho quanto **Confirmar reabertura** usam hierarquia azul/primária.
- **Problema de UX:** fechar congela o snapshot e habilita a impressão; reabrir
  altera um documento fechado. Ambas são decisões operacionais, mas a interface
  as apresenta como CTAs comuns.
- **Evidência no Código / CSS:** `onClick={() => closeMutation.mutate(...)}` no
  botão **Fechar ADR**; `variant="primary"` em **Reabrir** e **Confirmar
  reabertura**.
- **Cenário de Falha:** *simulação* — na Viagem 10, um usuário clica em
  **Fechar ADR** esperando abrir uma revisão final, mas o documento é fechado
  imediatamente.
- **Recomendação de Design:** usar `ConfirmDialog` ou um modal dedicado que
  nomeie Viagem, porto/terminal e efeito; usar `variant="danger"` nas
  confirmações de reabertura. Manter **Imprimir** secundário e apenas uma ação
  primária segura por bloco.

### [P1 - CONVERSÃO] Menus anunciam um padrão ARIA que o teclado não consegue operar

- **Gravidade:** P1 (navegação principal e conta pessoal incompletas por teclado)
- **Eixo Afetado:** Conversão
- **Localização Exata:** menu do usuário e navegação interna em
  `src/components/layout/AppLayout.tsx:139-161` e `:320-365`; notificações em
  `src/components/layout/InternalNotificationBell.tsx:74-179`.
- **Comportamento Atual (O que a pessoa vê):** contêineres recebem
  `role="menu"` e itens recebem `role="menuitem"`, mas não há roving tabindex,
  setas, `Home`/`End` nem foco transferido ao abrir. O menu do usuário é uma
  `div role="button"` sem `aria-expanded`, `aria-haspopup` ou fechamento por
  `Escape`.
- **Problema de UX:** leitor de tela anuncia um menu de aplicação com regras de
  teclado que a interface não cumpre. Quem usa teclado precisa descobrir um
  fluxo diferente do anunciado.
- **Evidência no Código / CSS:** `role="menu"`/`role="menuitem"` sem handler de
  setas; o `onKeyDown` do menu do usuário trata somente `Enter` e espaço.
- **Cenário de Falha:** *simulação* — a pessoa abre **Financeiro** por teclado e
  pressiona seta para baixo, conforme o papel ARIA anunciado; o foco não entra
  em **Taxas Locais**.
- **Recomendação de Design:** para navegação de site, remover os papéis de menu
  e manter botão + lista de links semânticos; ou implementar integralmente o
  padrão WAI-ARIA Menu Button. Trocar a `div` do usuário por `<button>` com
  `aria-expanded`/`aria-controls`, mover foco ao primeiro item e devolver foco
  ao fechar.

### [P1 - CONFIANÇA] Tema escuro torna campos ilegíveis e badges ficam abaixo de AA

- **Gravidade:** P1 (conteúdo essencial perde legibilidade quando o tema está ativo)
- **Eixo Afetado:** Confiança
- **Localização Exata:** tokens escuros e componentes em
  `src/index.css:51-89`, inputs em `:2117-2144`, badges em `:2225-2250` e
  contagem da navegação em `:686-703`.
- **Comportamento Atual (O que a pessoa vê):** no tema escuro, o input conserva
  gradiente quase branco, mas recebe texto quase branco. Os badges azul, verde e
  amarelo mantêm textos escuros sobre fundos translúcidos escuros. A contagem
  dourada da navegação usa texto branco pequeno.
- **Problema de UX:** valores digitados, status e contagens podem ficar
  imperceptíveis. Isso afeta conferência de dados e WCAG 2.1 1.4.3.
- **Evidência no Código / CSS:** contraste estático calculado: input escuro
  `#f8fbff` sobre aproximadamente `#f4f7fb` = **1,04:1**; badge verde =
  **2,20:1**; amarelo = **2,35:1**; azul = **2,84:1**; contador branco sobre
  `#d4882e` = **2,85:1**. Texto normal exige 4,5:1.
- **Cenário de Falha:** *simulação* — uma sessão com preferência persistida
  `vela_visual_theme=dark` abre **BLs** e o texto digitado no filtro parece vazio.
- **Recomendação de Design:** remover fundos hardcoded dos primitives e usar
  `var(--app-surface-strong)`/`var(--app-text-strong)`; fornecer pares de tokens
  por tema para cada badge; escurecer o fundo dourado ou usar texto navy no
  contador. Automatizar a matriz de contraste dos dois temas.

### [P1 - CONFIANÇA] Valores numéricos operacionais ficam alinhados como texto

- **Gravidade:** P1 (comparação financeira e quantitativa sujeita a leitura errada)
- **Eixo Afetado:** Confiança
- **Localização Exata:** coluna **Financeiro** em
  `src/components/billing/InvoicesTable.tsx:93-103`; prévia de Carga Solta em
  `src/pages/Bls.tsx:869-895`; estilo financeiro em
  `src/index.css:3596-3606`.
- **Comportamento Atual (O que a pessoa vê):** Total, Pago, Saldo, quantidades,
  peso e CBM ficam alinhados à esquerda. O estilo financeiro aplica fonte mono,
  mas não alinha a coluna à direita.
- **Problema de UX:** dígitos de ordens de grandeza diferentes não formam uma
  borda comum; comparar faturas ou pesos verticalmente exige reler cada valor.
- **Evidência no Código / CSS:** todas as células usam apenas `px-4 py-3` ou
  `px-3 py-2`; `.app-table__cell-value--financial` define família e tracking,
  sem `text-align: right` nem `font-variant-numeric: tabular-nums`.
- **Cenário de Falha:** *simulação* — em **Faturas**, o Financeiro compara
  R$ 900,00 com R$ 90.000,00 e precisa seguir visualmente o início de cada linha,
  em vez da casa decimal.
- **Recomendação de Design:** aplicar `text-right tabular-nums` em cabeçalho e
  células numéricas; no primitive, completar
  `.app-table__cell-value--financial { text-align:right;
  font-variant-numeric:tabular-nums; }`; manter rótulos textuais à esquerda.

### [P2 - CONVERSÃO] Skeletons não espelham as tabelas finais

- **Gravidade:** P2 (feedback e estabilidade visual inconsistentes)
- **Eixo Afetado:** Conversão
- **Localização Exata:** primitive em `src/components/ui/Skeleton.tsx:18-41`;
  BLs em `src/pages/Bls.tsx:507-542`; Containers em
  `src/pages/Containers.tsx:364-395`.
- **Comportamento Atual (O que a pessoa vê):** `SkeletonTable` sempre cria
  colunas `1fr`. A tabela de BLs tem 12/13 colunas, mas o loading desenha 6.
  Containers troca toda a estrutura por uma linha de texto centralizada.
- **Problema de UX:** a geometria muda quando os dados chegam, prejudicando
  orientação e podendo produzir layout shift dentro do quadro.
- **Evidência no Código / CSS:** `gridTemplateColumns:
  repeat(${cols}, 1fr)`; `<SkeletonTable rows={8} cols={6} />`; texto
  `Carregando containers...` com `colSpan`.
- **Cenário de Falha:** *simulação* — em rede lenta, a pessoa posiciona a
  atenção na última coluna aparente de BLs; ao carregar, seis colunas adicionais
  empurram a ação para fora da viewport.
- **Recomendação de Design:** aceitar `columnTemplate` no primitive e reutilizar
  a mesma definição da tabela; usar 12/13 placeholders em BLs e um skeleton
  estrutural em Containers. Marcar a região com `aria-busy="true"` e rótulo
  somente para tecnologia assistiva.

### [P2 - CONVERSÃO] Estado vazio orienta, mas não permite executar a próxima ação

- **Gravidade:** P2 (atrito recuperável no primeiro uso)
- **Eixo Afetado:** Conversão
- **Localização Exata:** primitive em `src/components/ui/Card.tsx:15-32`;
  BLs em `src/pages/Bls.tsx:545-550`; Containers em
  `src/pages/Containers.tsx:398-403`; Faturas em
  `src/components/billing/InvoicesTable.tsx:56-57`.
- **Comportamento Atual (O que a pessoa vê):** o estado vazio aceita apenas
  título e descrição. A pessoa lê “Nenhum B/L cadastrado ainda” ou “Ajuste os
  filtros”, mas não recebe um botão contextual.
- **Problema de UX:** o sistema explica o vazio, mas obriga a procurar no topo a
  importação correta ou o comando de limpar filtros.
- **Evidência no Código / CSS:** `EmptyState` não possui prop `action`/`children`;
  os três call sites renderizam apenas texto.
- **Cenário de Falha:** *simulação* — no primeiro acesso a **BLs**, a pessoa vê
  lista vazia e precisa decidir entre quatro imports distantes sem orientação.
- **Recomendação de Design:** adicionar `action?: ReactNode`; sem filtros,
  oferecer a importação primária autorizada; com filtros, oferecer **Limpar
  filtros**. Não renderizar CTA para quem não tem permissão.

### [P2 - ENTENDIMENTO] Paginação não informa o intervalo visível

- **Gravidade:** P2 (orientação incompleta em listas extensas)
- **Eixo Afetado:** Entendimento
- **Localização Exata:** `src/components/ui/TableFooterPagination.tsx:28-52`.
- **Comportamento Atual (O que a pessoa vê):** o rodapé mostra “340 registros ·
  Página 2 de 7” e o seletor “50/pag”, sem dizer quais registros estão na tela.
- **Problema de UX:** em conferências longas, a pessoa não sabe se está vendo
  51–100 nem consegue registrar o recorte com precisão.
- **Evidência no Código / CSS:** `${totalCount} registros · Página
  ${displayPage} de ${totalPages}`; não há cálculo de `start`/`end`.
- **Cenário de Falha:** *simulação* — em **Containers**, o operador informa ao
  colega que revisou a “página 3”, mas o tamanho da página foi alterado e o
  recorte já não representa as mesmas linhas.
- **Recomendação de Design:** renderizar `Exibindo {start}–{end} de
  {totalCount}` e `50 por página`; manter “Página X de Y” como informação
  secundária.

### [P2 - CONVERSÃO] Campos marcados como obrigatórios não comunicam a obrigatoriedade

- **Gravidade:** P2 (acessibilidade e validação de formulário incompletas)
- **Eixo Afetado:** Conversão
- **Localização Exata:** `src/components/ui/Input.tsx:25-47`; exemplos em
  `src/components/admin/NovoUsuarioModal.tsx:41-60` e
  `src/pages/Profile.tsx:71-75`.
- **Comportamento Atual (O que a pessoa vê):** `Field required` adiciona apenas
  um asterisco com `aria-hidden="true"`; os inputs filhos não recebem `required`
  nem `aria-required` automaticamente.
- **Problema de UX:** o leitor de tela não anuncia a obrigatoriedade e a
  validação nativa não participa, apesar do sinal visual.
- **Evidência no Código / CSS:** `{required && <span ... aria-hidden="true">
  *</span>}`; call sites usam `<Input ... />` sem `required`.
- **Cenário de Falha:** *simulação* — em **Novo usuário**, uma pessoa com
  leitor de tela percorre Nome, E-mail e Senha sem ouvir que são obrigatórios e
  descobre a regra somente no envio.
- **Recomendação de Design:** preferir composição por `id`/`htmlFor` e exigir
  `required` no controle; se o primitive clonar o filho, adicionar
  `aria-required` sem sobrescrever props. Ligar erro por `aria-describedby` e
  `aria-invalid`.

### [P2 - CONVERSÃO] Alvos de toque ficam abaixo dos 44×44 px definidos para o produto

- **Gravidade:** P2 (toque acidental e dificuldade motora)
- **Eixo Afetado:** Conversão
- **Localização Exata:** botões compactos em `src/index.css:2001-2006`,
  ícones de tabela em `:3635-3647`, fechar modal em `:2385-2391`, fechar toast
  em `:5392-5405`; colapso de Atracações em
  `src/components/voyages/VoyageVisaoTab.tsx:270-282`.
- **Comportamento Atual (O que a pessoa vê):** vários controles usam 40×40 px;
  o expansor de Atracações usa 20×20 px.
- **Problema de UX:** em tablet ou touchscreen, a área de acionamento é menor
  que o contrato de 44×44 e fica especialmente frágil dentro de tabela densa.
- **Evidência no Código / CSS:** `min-height: 40px`, `width: 40px` e classes
  `h-5 w-5`. O teste atual em `DesignSystemCssContract.test.ts` cristaliza 40 px.
- **Cenário de Falha:** *simulação* — em **Viagens** num tablet, a pessoa tenta
  expandir Atracações e toca no porto ou em outro controle da mesma linha.
- **Recomendação de Design:** elevar hit areas para 44 px sem necessariamente
  aumentar o ícone; usar pseudo-elemento ou padding invisível quando a densidade
  exigir. Atualizar o teste para o token `--app-control-h`.

### [P2 - ENTENDIMENTO] Interface mistura termos em português e inglês

- **Gravidade:** P2 (terminologia inconsistente em contexto operacional)
- **Eixo Afetado:** Entendimento
- **Localização Exata:** coluna de BLs em `src/pages/Bls.tsx:524-534`;
  notificações internas em
  `src/components/layout/InternalNotificationBell.tsx:148-165`; título de
  impressão em `src/components/voyages/VoyageAgencyReportTab.tsx:690`.
- **Comportamento Atual (O que a pessoa vê):** **Invoice**, **Fallback** e
  **Agency Departure Report** convivem com **Taxas locais**, **Notificações** e
  **Imprimir**.
- **Problema de UX:** a troca de idioma sugere que alguns estados são internos
  ou técnicos e enfraquece a previsibilidade da linguagem.
- **Evidência no Código / CSS:** literais `Invoice`, `Fallback` e
  `title="Agency Departure Report"` nos call sites acima.
- **Cenário de Falha:** *simulação* — em **BLs**, a pessoa procura a fatura na
  coluna **Fatura**, termo usado no restante do Financeiro, mas encontra
  **Invoice**.
- **Recomendação de Design:** usar **Fatura**, **Entrega alternativa** (ou termo
  operacional validado) e **Relatório de Saída do Navio (ADR)**. Manter siglas
  de domínio somente quando definidas no glossário.

### [P2 - ENTENDIMENTO] Detalhe de Viagem não oferece breadcrumb no deep link

- **Gravidade:** P2 (contexto e retorno dependem do rail)
- **Eixo Afetado:** Entendimento
- **Localização Exata:** master-detail em `src/pages/Viagens.tsx:242-323`;
  primitive disponível em `src/components/ui/Breadcrumb.tsx:9-36`.
- **Comportamento Atual (O que a pessoa vê):** `/viagens/:voyageId` mantém o
  título genérico **Viagens** e seleciona um item no rail, mas não mostra
  **Viagens > Navio / viagem** antes da ficha. BL e Cliente já usam o primitive.
- **Problema de UX:** ao entrar por alerta ou URL direta, a pessoa depende da
  faixa de seleção para entender o nível hierárquico e voltar à lista.
- **Evidência no Código / CSS:** não há `<Breadcrumb>` em `Viagens.tsx`; há
  usos em `BlDetalhe.tsx` e `ClienteFicha.tsx`.
- **Cenário de Falha:** *simulação* — um alerta abre a aba ADR de uma Viagem; a
  pessoa precisa interpretar o rail para retornar ao conjunto de Viagens.
- **Recomendação de Design:** no detalhe selecionado, renderizar
  `Breadcrumb([{ label: 'Viagens', to: '/viagens' }, { label: navioViagem }])`;
  preservar filtros na volta quando tecnicamente possível.

### [P2 - CONVERSÃO] Combobox move o destaque visual sem anunciá-lo ao leitor de tela

- **Gravidade:** P2 (autocomplete parcialmente operável por tecnologia assistiva)
- **Eixo Afetado:** Conversão
- **Localização Exata:** `src/components/ui/Combobox.tsx:139-215`.
- **Comportamento Atual (O que a pessoa vê):** setas alteram `highlight` e
  **Escape** fecha a lista, mas o input não define `aria-activedescendant`. Cada
  `role="option"` ainda contém um `<button>`, criando um controle interativo
  dentro de outro papel interativo.
- **Problema de UX:** o destaque é visível, mas pode não ser anunciado; a árvore
  de acessibilidade da lista fica ambígua.
- **Evidência no Código / CSS:** `aria-controls` e `aria-expanded` existem,
  porém não há `aria-activedescendant`; o JSX produz
  `<li role="option"><button ... /></li>`.
- **Cenário de Falha:** *simulação* — no filtro de Viagem, a pessoa pressiona
  seta para baixo e ouve apenas o texto digitado, sem saber qual sugestão será
  escolhida ao pressionar Enter.
- **Recomendação de Design:** atribuir ID estável a cada option e atualizar
  `aria-activedescendant`; tornar o próprio option acionável, sem botão aninhado;
  anunciar carregando/sem resultados em região `status` e cobrir o padrão com
  testes de teclado.

### [P2 - CONVERSÃO] Botão em carregamento muda de largura e não anuncia estado ocupado

- **Gravidade:** P2 (layout shift e feedback assistivo incompleto)
- **Eixo Afetado:** Conversão
- **Localização Exata:** `src/components/ui/Button.tsx:17-36`; uso em
  `src/pages/Profile.tsx:81-83` e `src/pages/Viagens.tsx:358-364`.
- **Comportamento Atual (O que a pessoa vê):** qualquer rótulo é substituído
  por spinner + **Carregando...**. O botão é desabilitado, mas a largura do
  conteúdo não é preservada e não existe `aria-busy`.
- **Problema de UX:** botões curtos como **Salvar** crescem durante o submit,
  deslocando a barra de ações; leitor de tela recebe mudança de texto, mas não
  um estado ocupado explícito.
- **Evidência no Código / CSS:** ternário substitui `children` por
  `<Loader2 /> Carregando...`; `.app-btn` não reserva a dimensão anterior.
- **Cenário de Falha:** *simulação* — em **Meu perfil**, **Salvar alterações**
  muda de medida no instante do clique e reposiciona o conjunto no rodapé.
- **Recomendação de Design:** manter o rótulo no fluxo com `visibility:hidden`
  e sobrepor o estado de loading, ou medir/reservar `min-inline-size`; adicionar
  `aria-busy={loading}` e texto configurável (`loadingLabel`) em pt-BR com
  reticências tipográficas: **Carregando…**.

## Resumo por dimensão

| Dimensão | Diagnóstico |
|---|---|
| Entendimento | Navegação ativa e breadcrumbs existentes são claros, mas Viagens não usa o padrão e ainda há rótulos em inglês. |
| Confiança | É o maior risco: erros crus, cor semântica divergente, contraste do tema escuro e alinhamento financeiro. |
| Conversão | Modais genéricos são acessíveis, mas menus, ADR, empty states, loading e combobox deixam lacunas no caminho principal. |

## Cinco maiores problemas de conversão

1. Fechamento do ADR sem confirmação explícita.
2. Menus ARIA sem o contrato de teclado anunciado.
3. Empty states sem ação contextual.
4. Combobox sem anúncio da opção ativa.
5. Alvos de toque de 20–40 px em telas operacionais densas.

## Cinco quick wins

1. Trocar `OMIT`, cancelamentos e conclusão para os tons semânticos corretos.
2. Substituir **Invoice** por **Fatura** e remover **Fallback** da copy visível.
3. Exibir `Exibindo X–Y de Z` no rodapé compartilhado.
4. Adicionar `aria-busy` ao `Button` e preservar sua largura no loading.
5. Remover `role="menu"` onde o componente é navegação comum por links.

## Ordem recomendada de remediação

1. Erros apresentados, ADR e mapas semânticos (P1 de risco operacional).
2. Tema escuro e alinhamento numérico (P1 de leitura/conferência).
3. Menus, required e combobox (teclado e tecnologia assistiva).
4. Skeletons, empty states, paginação, loading e touch targets.
5. Breadcrumb de Viagens e limpeza terminológica.


## Nota editorial de remediação — 2026-09-20

Esta nota foi acrescentada após a execução da remediação na branch
codex/corrigir-auditoria-ui-design-system. As observações e limites da
execução original permanecem preservados acima.

- P1 erros técnicos: corrigido com userFacingErrorMessage, ErrorBoundary sem
detalhe técnico em produção e testes em src/lib/__tests__/errors.test.ts.
- P1 semântica de status: corrigido nos mapas de viagem, fatura, restituição e
OMIT; coberto por testes de contrato.
- P1 ADR: fechamento agora exige confirmação identificada; reabertura usa ação
de perigo e justificativa.
- P1 menus e conta: papéis de menu removidos de navegação/disclosure; conta e
notificações usam botões, estados expandidos, Escape e região semântica.
- P1 tema escuro: inputs usam tokens de superfície e badges/contador têm pares
escuros explícitos; contrato CSS automatizado.
- P1 números: valores financeiros, peso, volume e quantidade usam alinhamento à
direita e numerais tabulares.
- P2 skeletons, estados vazios e paginação: primitives aceitam geometria,
ação contextual, aria-busy e intervalo visível; telas B/Ls, Containers e
Faturas aplicam os contratos.
- P2 required, touch targets e loading: Field propaga atributos, controles
compactos têm área mínima de 44 px e Button preserva o rótulo/anuncia aria-busy.
- P2 idioma e contexto: rótulos visíveis usam Fatura/Entrega alternativa/
Relatório de Saída do Navio (ADR); Viagens tem breadcrumb em deep-link.
- P2 combobox: opção ativa é anunciada por aria-activedescendant, sem botão
aninhado, com status para carregamento/vazio.

**Evidência da remediação:** testes automatizados e gates locais são registrados
no histórico da PR. A auditoria visual em navegador não foi executada nesta
rodada; contraste foi verificado por contrato CSS e os limites de runtime
continuam declarados como lacuna.
