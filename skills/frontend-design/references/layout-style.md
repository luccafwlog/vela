# Layout, estilo e desempenho

Leia esta referência quando a tarefa envolver composição da tela,
responsividade, tipografia, cores, ícones, superfícies ou carregamento.

## Descobrir antes de alterar

- Identifique os tokens, componentes e padrões já usados na página e nas telas
  vizinhas. Consistência com o produto é uma decisão de design, não falta de
  criatividade.
- Use o tipo de produto e a tarefa para orientar a direção visual. Não aplique
  uma paleta, fonte, textura ou efeito porque está na moda ou porque uma
  geração automática costuma sugeri-los.
- Mantenha uma ação primária clara por contexto. Ações secundárias devem ser
  identificáveis sem competir com ela.
- Ícones estruturais devem ser vetoriais e pertencer a uma família coerente.
  Alinhe-os opticalmente ao texto e preserve proporções de marcas oficiais.

## Layout e responsividade

- Preserve o conteúdo essencial e a ordem da tarefa em diferentes larguras.
  Em telas estreitas, priorize informação e ação antes de reduzir tudo até
  ficar ilegível.
- Use os breakpoints, espaçamentos e larguras de contêiner que já existem no
  projeto. Se não existirem, introduza uma escala pequena e explicada, não
  valores isolados em cada componente.
- Evite rolagem horizontal acidental. Tabelas e dados densos podem precisar de
  uma estratégia explícita de rolagem, colunas prioritárias ou visualização
  alternativa.
- Evite regiões de rolagem aninhadas sem uma razão clara. Conteúdo sob header,
  footer ou barra fixa precisa de espaço reservado.
- Mantenha camadas e z-index compreensíveis. Dropdowns, modais, toasts e
  tooltips não devem competir de forma imprevisível.
- Não desabilite zoom e não use uma altura fixa que corte conteúdo em
  dispositivos com barras de navegador variáveis.
- Respeite orientação, contraste, densidade e tamanho de texto configurados
  pela pessoa usuária.

## Tipografia e cor

- Use a tipografia do produto antes de introduzir outra. Qualquer mudança deve
  justificar legibilidade, hierarquia ou identidade e considerar carregamento e
  licenciamento.
- Controle o comprimento de linhas para leitura. Prefira quebrar texto a
  truncá-lo; quando o truncamento for necessário, ofereça acesso ao conteúdo
  completo.
- Use text-wrap balance em títulos quando melhorar a composição e text-wrap
  pretty ou equivalente em blocos longos quando suportado.
- Use números tabulares em colunas e contadores que mudam, quando isso evita
  que a página salte.
- Use tokens semânticos para superfície, texto, borda, ação, alerta e estado.
  Evite hex ou sombra ad hoc diretamente em cada tela.
- Verifique contraste de texto e controles nos estados normal, foco, hover,
  pressionado, desabilitado, erro e sucesso. Cor funcional precisa de outro
  indicador.
- Se houver temas claro e escuro, revise ambos. Não trate o escuro como mera
  inversão de cores.

## Superfícies e detalhes

- Raio, sombra, borda, transparência e elevação devem formar uma escala
  coerente. Em elementos aninhados, considere a relação entre padding e raio
  para evitar cantos desalinhados.
- Use sombras ou bordas conforme a linguagem visual existente e a necessidade
  de separar superfícies. Não adicione efeitos para esconder uma hierarquia
  confusa.
- Backgrounds, texturas e blur precisam reforçar contexto ou profundidade sem
  prejudicar contraste, desempenho ou leitura.
- Estados visuais devem ser estáveis: uma resposta ao clique não pode deslocar
  o conteúdo ao redor nem alterar a área de interação de forma inesperada.

## Desempenho percebido

- Reserve dimensões ou aspect-ratio para imagens e conteúdo assíncrono para
  reduzir layout shift.
- Carregue fontes e imagens de forma proporcional à prioridade da tela; use
  lazy loading e divisão por rota somente quando o ganho justificar a
  complexidade.
- Evite leituras e escritas repetidas do layout e efeitos que forçam reflow.
  Virtualização é uma ferramenta para listas realmente grandes, não um padrão
  automático.
- Dê feedback rapidamente para ações e entradas. Em rede lenta, comunique o
  estado e, quando possível, ofereça uma versão degradada ou uma tentativa
  novamente.
- Retire scripts e efeitos que não contribuem para o fluxo. A estética não
  deve consumir o orçamento de interação da página.
