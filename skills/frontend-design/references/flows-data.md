# Fluxos, dados e feedback

Leia esta referência quando a tarefa envolver animação, formulários,
carregamento, navegação, tabelas, gráficos ou recuperação de erro.

## Movimento e transições

- Escolha a duração pelo peso da mudança e pela distância visual. Microestados
  normalmente pedem uma transição curta; uma mudança de página ou modal pode
  precisar de mais tempo. Use os tokens existentes e evite valores extremos.
- Prefira transform e opacity a animar width, height, top ou left quando o
  objetivo puder ser atingido sem reflow.
- Use ease-out para uma entrada que precisa chegar rapidamente e ease-in para
  uma saída que deve liberar espaço; siga o ritmo já usado no produto.
- Anime poucos elementos que explicam a mudança. Um stagger curto pode organizar
  uma lista; não transforme cada texto em uma animação independente.
- Movimento deve ter causa e efeito: mostrar de onde um modal veio, indicar a
  atualização de uma coluna ou confirmar uma ação. Não deve atrasar a pessoa.
- Transições precisam ser interrompíveis e não podem bloquear teclado, clique ou
  leitura. Evite layout shift.
- Prefira crossfade ou troca estável quando conteúdo muda no mesmo contêiner.
  Respeite prefers-reduced-motion e torne a informação compreensível sem
  animação.

## Formulários

- Mostre rótulo, unidade, formato e exemplo necessários antes da digitação.
  Agrupe campos relacionados e preserve o que a pessoa já informou.
- Use o tipo de entrada e autocomplete adequados. Não force validação a cada
  tecla quando ela só consegue ser compreendida depois que o campo termina.
- No envio, comunique carregando, sucesso ou erro. Evite duplo envio sem
  desabilitar somente a ação repetida.
- Mensagem de erro deve dizer causa e correção. Em formulário longo, ofereça
  resumo com links para os campos inválidos e dê foco ao primeiro problema
  quando isso não desorientar.
- Campos obrigatórios, somente leitura e desabilitados devem ser distinguíveis.
  Não use placeholder como único rótulo.
- Para formulários longos ou frágeis, considere rascunho/autosalvamento e
  confirmação antes de descartar alterações.
- Use mensagens de sucesso que confirmem a ação e indiquem o próximo passo.
  Toast não deve desaparecer antes de poder ser lido nem roubar o foco.

## Estados de conteúdo

- Estado vazio explica por que não há conteúdo e oferece a próxima ação
  relevante; não é apenas uma área em branco.
- Estado de carregamento preserva o contexto e indica o que está sendo buscado
  ou processado.
- Estado de erro explica o problema e oferece recuperação proporcional, como
  tentar novamente, corrigir filtros ou voltar.
- Operações destrutivas devem ter confirmação ou desfazer quando houver risco
  de perda. A confirmação deve nomear a entidade e a consequência.

## Navegação

- A pessoa deve saber onde está, qual é a ação principal e como retornar sem
  perder filtros, rolagem ou dados temporários.
- Destaque a página ou seção atual e mantenha a navegação consistente entre
  páginas equivalentes.
- Use modal para uma interrupção curta ou decisão contextual, não para esconder
  uma etapa principal do fluxo.
- Em mudanças de rota, direcione foco ao conteúdo principal quando necessário e
  preserve uma URL ou caminho reproduzível para telas importantes.
- Quando muitas ações disputarem o mesmo espaço, agrupe as secundárias em
  overflow sem esconder a ação essencial.

## Tabelas, gráficos e dados

- Escolha a representação conforme a pergunta: tendência, comparação,
  distribuição ou detalhe operacional. A decoração não deve competir com o
  dado.
- Ofereça uma leitura textual ou tabular quando o gráfico não for
  autoexplicativo. Legendas, rótulos, unidades e períodos devem ser claros.
- Não dependa apenas de vermelho e verde; combine cor com texto, ícone, padrão
  ou posição. Formate números, datas e moedas conforme a localidade do Vela.
- Tabelas precisam preservar cabeçalhos, ordenação e relação entre célula e
  coluna. Em telas estreitas, defina quais colunas são prioritárias.
- Dados vazios, carregando ou com falha precisam de estados explícitos. Não
  mostre um eixo ou gráfico aparentemente vazio como se fosse resultado válido.
- Interações de tooltip, ponto, barra ou filtro precisam de alternativa de
  teclado e de um caminho claro de retorno quando abrirem detalhe.
