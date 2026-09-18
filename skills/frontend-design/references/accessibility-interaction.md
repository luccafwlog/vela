# Acessibilidade e interação

Leia esta referência quando a tarefa envolver acessibilidade, controles,
foco, teclado, feedback ou interação responsiva. Ela é uma orientação para
interfaces web do Vela; critérios numéricos são pontos de partida e devem ser
verificados no contexto real.

## Estrutura e compreensão

- Use uma hierarquia de títulos coerente e landmarks semânticos. A sequência
  deve explicar a página para quem navega visualmente e para quem usa leitor de
  tela.
- Todo campo precisa de um rótulo visível ou de uma associação semântica
  equivalente. Placeholder não substitui rótulo.
- Botão que mostra apenas ícone precisa de nome acessível. O nome deve
  descrever a ação visível, não o nome do componente.
- Não transmita informação somente por cor. Combine cor com texto, ícone,
  padrão, posição ou outro sinal percebível.
- Imagens que carregam significado precisam de texto alternativo adequado.
  Imagens decorativas devem ser ignoradas pela tecnologia assistiva.
- Em páginas longas ou com navegação persistente, ofereça um caminho para
  chegar rapidamente ao conteúdo principal.

## Teclado e foco

- A ordem do foco deve acompanhar a ordem visual e o fluxo da tarefa.
- Todo controle interativo deve ser alcançável e operável pelo teclado.
- O foco precisa permanecer visível em estados claros de alto contraste; não o
  remova apenas para deixar a interface visualmente mais limpa.
- Ao abrir um modal ou dropdown, mova o foco para o contexto novo de forma
  previsível. Ao fechar, devolva-o ao controle que iniciou a ação quando isso
  fizer sentido.
- Dialogs, menus e fluxos em etapas precisam de uma saída clara: fechar,
  cancelar, voltar ou desfazer. Não aprisione a pessoa em uma tela sem rota de
  recuperação.
- Não dependa de arrastar, passar o mouse ou gesto. Ações importantes precisam
  de uma alternativa visível e operável por teclado.

## Estados e feedback

- Carregamento deve comunicar que a ação foi recebida. Para operações longas,
  mostre progresso, skeleton ou texto de estado sem apagar o contexto útil.
- Durante uma operação assíncrona, impeça somente a repetição perigosa da
  mesma ação; não congele a página inteira sem necessidade.
- Mensagens de erro devem indicar o que aconteceu e como corrigir ou tentar
  novamente. Posicione a mensagem perto do campo ou controle relacionado e,
  quando houver vários erros, ofereça um resumo navegável.
- Anuncie mudanças importantes para leitores de tela sem roubar o foco. Use
  regiões vivas com a urgência adequada ao problema.
- Diferencie visual e semanticamente desabilitado, somente leitura, vazio,
  carregando, erro e sucesso.
- Em ações destrutivas, confirme quando o risco justificar e prefira oferecer
  desfazer quando a operação permitir.

## Toque, ponteiro e responsividade

- A área acionável deve ser grande o suficiente para o dispositivo e o
  componente; use os tokens do produto e os critérios de acessibilidade, não
  um número fixo aplicado cegamente.
- Separe controles próximos para evitar acionamento acidental. Não deixe áreas
  de clique sobrepostas.
- Hover pode complementar a explicação, mas nunca pode ser o único caminho
  para uma ação ou informação necessária.
- Use controles semânticos nativos quando eles já representam a ação. Não
  transforme uma div em botão sem fornecer papel, foco, teclado e estado.
- Em telas estreitas, preserve a ação principal e a leitura da página antes de
  manter informações secundárias lado a lado. Não desabilite zoom.

## Movimento

- Toda animação deve explicar uma mudança de estado, relação espacial ou
  resposta à ação. Movimento puramente decorativo deve ser questionado.
- Prefira transform e opacity quando a mudança puder ocorrer sem reflow.
- Mantenha a interface operável durante a animação e permita interrupção.
- Respeite prefers-reduced-motion: reduza, remova ou substitua movimento
  intenso por uma transição estável sem perder informação.

## Verificação

Ao avaliar, registre página, controle, estado e viewport observados. Diferencie
um problema que impede a tarefa, um risco de acessibilidade e uma melhoria de
conforto. Verifique pelo menos:

- navegação por teclado e foco;
- nome, papel e estado dos controles;
- contraste de texto, ícones e estados;
- leitura das mensagens de erro, sucesso e carregamento;
- operação em viewport estreito e amplo;
- comportamento com movimento reduzido.
