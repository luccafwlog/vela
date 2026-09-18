# Critérios da revisão rigorosa

Use esta referência somente no modo `rigorosa` de `vela-code-review`. O objetivo
é encontrar melhorias estruturais de alto valor, não multiplicar nits.

## Perguntas principais

- Qual é o fluxo do Vela que esta mudança deveria preservar ou alterar?
- A decisão atual foi explicitamente apresentada como substituição da regra
  anterior? Se não foi, a revisão precisa parar e perguntar ao usuário antes de
  tratar a implementação como correta.
- O comportamento faz sentido para a página, ação, entidade e estado que a
  pessoa usuária reconhece, ou apenas parece coerente no código?
- O que acontece quando não há dados, há duplicidade, retry, erro parcial,
  permissão insuficiente ou uma atualização concorrente?
- Existe um movimento de **code judo** que elimina conceitos, branches ou
  camadas inteiras mantendo o comportamento?
- A mudança melhora ou piora a arquitetura local?
- Surgiram condicionais especiais em caminhos que antes eram coesos?
- A lógica está no módulo, camada e helper canônicos?
- Um arquivo cresceu além de um limite saudável por causa do diff?
- Tipos opcionais, casts, `any`, `unknown` ou objetos ad hoc escondem a
  invariável real?
- A abstração realmente compra clareza ou apenas adiciona um wrapper?
- Há orquestração sequencial evitável ou atualizações parcialmente aplicadas?

## Sinais que merecem escalonamento

Trate como achado importante quando houver evidência de:

- complexidade que poderia ser removida por uma reformulação mais simples;
- refatoração que apenas move a mesma complexidade sem reduzi-la;
- arquivo que ultrapassa 1.000 linhas por causa da mudança, sem razão estrutural
  convincente;
- branches ad hoc espalhados por fluxos não relacionados;
- lógica específica de feature vazando para módulos compartilhados;
- mecanismo genérico ou mágico escondendo um contrato simples;
- cópia de helper já existente em vez do uso da implementação canônica;
- casts, optionalidade ou formas de dados frouxas que tornam o fluxo indireto;
- fluxo assíncrono serializado sem necessidade ou atualização não atômica;
- refatoração que passa nos testes mas reduz modularidade ou legibilidade.

Um arquivo acima de 1.000 linhas é um sinal forte, não um bloqueador automático:
verifique se o diff causou o crescimento, se há ownership coerente e se a
decomposição melhora materialmente a manutenção.

## Remédios preferidos

Prefira, nesta ordem, soluções que:

1. eliminem uma camada de indirection desnecessária;
2. tornem o estado ou contrato explícito para fazer condicionais desaparecerem;
3. movam a lógica para a fronteira que já possui o conceito;
4. reutilizem o helper canônico em vez de criar um quase-duplicado;
5. separem orquestração de lógica de negócio;
6. extraiam módulos, helpers ou componentes com ownership claro;
7. paralelizem trabalho independente somente quando isso também tornar o fluxo
   mais claro e seguro;
8. preservem comportamento, testes e contratos existentes.

Não peça uma grande refatoração por preferência estética. Um achado só deve ser
priorizado quando a evidência mostra risco, regressão estrutural ou ganho de
manutenibilidade proporcional ao escopo.

## Advogado do diabo

Para cada mudança material, formule pelo menos um exemplo hipotético no
vocabulário do Vela e compare o resultado esperado com o resultado provável.
Por exemplo: se uma regra nova permitir salvar uma Viagem sem navio, o que deve
aparecer na página de BLs e na coluna do navio? Se uma taxa mudar depois do
faturamento, quais valores podem ser recalculados e quais devem permanecer?

Se o exemplo revelar uma substituição de lógica não confirmada, classifique a
revisão como decisão pendente e faça ao usuário a pergunta:

“É isso mesmo que você quer? É essa substituição de lógica que você quer
implementar?”

Não transforme uma inferência do revisor em requisito novo.

## Calibração e saída

Seja direto e exigente, sem ser rude. Priorize:

1. regressões estruturais;
2. simplificações substanciais perdidas;
3. crescimento de spaghetti e branching;
4. fronteiras, abstrações e contratos de tipo;
5. tamanho de arquivo e decomposição;
6. legibilidade e manutenção.

Para cada achado, informe arquivo/linha quando possível, evidência, por que
importa, severidade e remédio. Recomendações ambiciosas não viram blockers
automaticamente: use bloqueador apenas quando deixar o problema tornar a
mudança insegura, materialmente difícil de manter ou contrária a um contrato
explícito.

Não implemente as refatorações durante uma revisão rigorosa sem autorização
explícita. Encaminhe achados de segurança para
`security-audit-penetration-testing` e achados recebidos para o modo `receber`.
