# Polimento de interfaces existentes

Leia esta referência no modo polir. O objetivo é melhorar a percepção de
qualidade sem introduzir complexidade ou movimento sem função.

## Antes de mexer

- Observe a tela real, a página vizinha e os estados que a pessoa encontra.
  Localize se o problema é de hierarquia, alinhamento, densidade, feedback,
  legibilidade, transição ou recuperação.
- Use tokens e componentes existentes. Uma regra nova só vale a pena quando
  resolve uma inconsistência observável e pode ser aplicada com coerência.
- Explique a melhoria pela experiência: o botão fica mais identificável, a
  coluna não salta, o erro aponta o campo correto, o modal mantém o contexto.

## Superfícies e alinhamento

- Elementos aninhados devem ter relação coerente entre padding e raio; não use
  o mesmo raio em todas as camadas por hábito.
- Quando o centro geométrico parecer errado, ajuste pelo alinhamento óptico do
  ícone, texto ou forma. Verifique em contexto, não apenas no inspector.
- Use bordas, sombras e elevação conforme a linguagem do produto. Camadas sutis
  podem separar superfícies; sombra não deve substituir contraste ou hierarquia.
- Preserve o espaço de clique mesmo quando o ícone visual for pequeno. A área
  acionável não deve encostar ou se sobrepor à de outro controle.

## Movimento e resposta

- Prefira transições interrompíveis para hover, foco, aberto, fechado e
  pressionado. Keyframes ficam para sequências intencionais.
- Entradas podem ser divididas por grupos semânticos e ter um stagger discreto.
  Saídas devem liberar o espaço sem parecer que a página está travando.
- Ícones podem usar opacity, scale ou blur para explicar troca de estado, mas
  os valores devem seguir o token de movimento e a legibilidade do produto.
- Feedback de pressão deve ser perceptível sem deslocar o layout. Não aplique
  scale 0.96, duração fixa ou outra receita em todos os controles; escolha algo
  proporcional ao componente e desative ou reduza quando movimento distrair.
- Não anime width, height, top ou left quando transform e opacity resolvem o
  problema. Não use transition: all; declare apenas as propriedades necessárias.
- Use will-change somente quando houver evidência de benefício para
  transform, opacity ou filter. Não o deixe como decoração de performance.

## Tipografia e conteúdo

- Use antialiasing apenas quando ele fizer sentido para a plataforma e não
  alterar negativamente a leitura.
- Aplique números tabulares em contadores, valores e colunas que mudam para
  evitar saltos.
- Balance títulos e permita quebra natural no texto de apoio. Não sacrifique
  legibilidade para preservar uma única linha.
- Imagens podem receber uma separação sutil da superfície quando isso combina
  com o sistema visual. Não adicione contorno por regra universal.

## Verificação de polimento

- A mudança melhora a página ou apenas adiciona efeito?
- O estado normal, foco, hover, pressionado, desabilitado, carregando e erro
  continuam compreensíveis?
- O layout permanece estável enquanto a pessoa interage?
- Teclado, contraste, leitor de tela e movimento reduzido continuam atendidos?
- A alteração usa o vocabulário e os padrões visíveis do Vela?
- O custo de manutenção é proporcional ao ganho percebido?

Quando for útil comunicar o resultado, use uma tabela Antes/Depois com uma linha
por mudança, indicando página ou controle, efeito visível e detalhe técnico
somente quando necessário.
