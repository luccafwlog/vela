# Diagnóstico baseline da primeira coorte de skills

**Data:** 2026-09-18
**Escopo:** `using-superpowers`, `grill-me-with-docs`, `wayfinder`,
`writing-plans` e `executing-plans`
**Status:** diagnóstico concluído; nenhuma dessas cinco skills foi alterada
nesta etapa.

## Método

- Leitura controlada dos `SKILL.md` atuais e das referências diretamente usadas
  por eles.
- Teste de mesa com cenários realistas de roteamento, uso normal, sobreposição,
  mudança de escopo e falha operacional.
- Critérios: gatilho correto, limite de escopo, comportamento esperado, handoff
  para outra skill e instrução suficiente para não inventar etapas.
- Este é um baseline documental. Não é uma medição de frequência em produção e
  não foi executado por um agente independente; portanto, os resultados abaixo
  identificam lacunas observáveis no texto, não uma taxa estatística de erro.

## Resultados por skill

### `using-superpowers`

- **Papel:** selecionar uma skill quando a escolha de workflow não é evidente.
- **Cenário que passa:** se o usuário nomeia explicitamente uma skill, a regra
  de prioridade está clara (`SKILL.md:8-10`).
- **Cenário que passa:** trabalho simples e bem definido pode seguir sem
  carregar uma skill; isso evita ritual obrigatório.
- **Cenário problemático:** iniciativa grande, ambígua e com decisões abertas.
  O texto manda escolher uma skill, mas não diferencia `wayfinder` de
  `writing-plans`, `grilling` ou `grill-me-with-docs`.
- **Cenário problemático:** tarefa multi-arquivo com requisitos já fechados.
  Não há critério para distinguir escrever um plano de executar diretamente.
- **Cenário problemático:** workflow pede ferramenta de subagente em um harness
  que não a oferece. A referência lista equivalências, mas não define fallback
  operacional quando a capacidade está indisponível.
- **Diagnóstico:** é um roteador conceitualmente correto, porém genérico demais
  para resolver justamente as sobreposições que motivam sua existência.
- **Melhoria provável:** adicionar uma matriz curta de decisão entre as skills
  mantidas, incluindo quando não carregar nenhuma, e uma regra de fallback para
  capacidades ausentes.
- **Prioridade:** alta.

### `grill-me-with-docs`

- **Papel:** conduzir uma entrevista e registrar decisões duráveis em glossary
  e ADRs.
- **Cenário que passa:** decisão arquitetural ou de domínio com termos ainda
  ambíguos; a delegação para `/grilling` e a manutenção direta dos documentos
  estão claras (`SKILL.md:7-11`).
- **Cenário problemático:** o usuário quer conversar, mas explicitamente não
  quer criar ou alterar documentação. Não existe regra de opt-out nem critério
  para separar decisão durável de preferência temporária.
- **Cenário problemático:** plano claro, sem decisão de domínio ou arquitetura.
  Se a skill for invocada explicitamente, ela não diz quando encerrar cedo para
  não transformar o trabalho em uma entrevista desnecessária.
- **Cenário problemático:** escolher entre `grill-me`, `grilling` e
  `grill-me-with-docs`. A diferença documental existe, mas o gatilho de cada
  uma não está descrito como regra de roteamento.
- **Diagnóstico:** o wrapper está correto, mas seu contrato de documentação é
  permissivo demais: pode gerar ADR/glossary sem necessidade ou contra a
  intenção do usuário.
- **Melhoria provável:** definir quando uma decisão merece persistência, quando
  não criar documento, como respeitar um pedido explícito de não persistência e
  qual é a condição de parada.
- **Prioridade:** alta.

### `wayfinder`

- **Papel:** transformar uma iniciativa grande e ainda nebulosa em mapa de
  decisões e tickets dependentes; não executar o destino por padrão.
- **Cenário que passa:** iniciativa grande com fog de decisões; a distinção
  entre mapa, tickets, frontier e execução está bem explicada.
- **Cenário parcialmente coberto:** mudança pequena e já especificada. O texto
  diz que um mapa pode ser desnecessário, mas não oferece um teste operacional
  curto antes de iniciar duas rodadas de grilling.
- **Cenário problemático:** uso no repositório Vela. A skill manda consultar a
  configuração do tracker, mas não aponta diretamente para
  `docs/agents/issue-tracker.md`. Além disso, o documento do repositório usa
  `## Fog`, enquanto a skill usa `## Not yet specified`; o documento diz que o
  GitHub não tem bloqueio nativo, enquanto a skill começa assumindo esse caso
  como padrão.
- **Cenário problemático:** reivindicar um ticket. A skill fala em atribuir o
  ticket; o contrato local determina o label `wayfinder:claimed`.
- **Cenário parcialmente coberto:** pesquisa paralela. A regra presume uma
  capacidade de agente de pesquisa, mas não define como proceder quando o
  harness não possui essa capacidade.
- **Diagnóstico:** é a skill com maior risco operacional, porque pode criar
  artefatos no tracker com semântica divergente da configuração do Vela.
- **Melhoria provável:** tornar o tracker local a fonte explícita, alinhar
  headings e claiming ao contrato do GitHub, criar um teste de “mapa ou não” e
  definir fallback sem subagentes.
- **Prioridade:** muito alta.

### `writing-plans`

- **Papel:** produzir um plano executável para trabalho substancial que precisa
  de coordenação ou handoff.
- **Cenário que passa:** mudança multi-arquivo com dependências, critérios de
  aceite e validações; o conteúdo mínimo esperado está claro (`SKILL.md:8-11`).
- **Cenário parcialmente coberto:** correção pequena e localizada. A descrição
  diz “substantial work”, mas não há regra prática para evitar um plano inútil.
- **Cenário que passa:** pedido de implementação com decisões suficientes; o
  texto manda continuar para execução em vez de perguntar novamente (`SKILL.md:29-31`).
- **Cenário parcialmente coberto:** requisitos ainda dependem de uma decisão
  material. A skill manda marcar a decisão, mas não define quando deve parar e
  perguntar antes de fechar o plano.
- **Cenário problemático:** iniciativa grande ainda nebulosa. Não há fronteira
  explícita com `wayfinder`; ambas podem parecer “a skill de planejamento”.
- **Diagnóstico:** o conteúdo de um plano está bem definido, mas o gatilho e a
  fronteira com wayfinding estão subespecificados.
- **Melhoria provável:** adicionar um teste de tamanho/clareza, diferenciar
  “plano executável” de “mapa de decisões” e explicitar o handoff para
  `executing-plans`.
- **Prioridade:** média-alta.

### `executing-plans`

- **Papel:** executar um plano existente, adaptando passos mecânicos e
  validando o resultado.
- **Cenário que passa:** plano atual, requisitos claros e checks definidos; o
  fluxo de ler, executar, validar e corrigir está correto (`SKILL.md:8-10`,
  `18-21`).
- **Cenário que passa:** teste falha durante a execução. A instrução manda
  diagnosticar, não pedir autorização automaticamente.
- **Cenário parcialmente coberto:** o código diverge materialmente do plano.
  “Adaptar passos mecânicos” é correto, mas não define como identificar uma
  mudança de escopo que exige parar e consultar o usuário.
- **Cenário parcialmente coberto:** plano inexistente, incompleto ou já
  obsoleto. Não há preflight explícito nem resposta padrão para cada caso.
- **Cenário que passa:** ausência de acesso ou requisito não resolvido é tratada
  como motivo legítimo para pedir esclarecimento/acesso.
- **Diagnóstico:** a execução normal é boa; faltam protocolos de drift, plano
  inválido e conclusão verificável.
- **Melhoria provável:** adicionar preflight, categorias de desvio
  mecânico/material, regra de pausa e checklist mínimo de conclusão sem
  duplicar `writing-plans`.
- **Prioridade:** média-alta.

## Sobreposições relevantes

- **`using-superpowers` ↔ todas:** deveria resolver as escolhas, mas não possui
  a matriz que permitiria fazê-lo com consistência.
- **`wayfinder` ↔ `writing-plans`:** ambos lidam com trabalho grande; o
  divisor correto é “decisões ainda nebulosas” versus “escopo decidido que
  precisa ser executado”.
- **`writing-plans` ↔ `executing-plans`:** o primeiro produz o artefato; o
  segundo o consome e valida. Essa fronteira precisa ser explícita.
- **`grill-me-with-docs` ↔ `grilling`:** o segundo é o motor de entrevista; o
  primeiro deve ser um wrapper com persistência documental condicional.
- **Idioma:** a regra de pt-BR está presente e sincronizada; não apareceu uma
  lacuna nessa dimensão nesta coorte.

## Ordem recomendada de intervenção

1. `wayfinder`: corrigir o contrato com o tracker do Vela antes de qualquer uso
   que crie ou altere issues.
2. `using-superpowers`: criar a matriz de roteamento que organiza as skills
   mantidas.
3. `grill-me-with-docs`: tornar a persistência de ADR/glossary condicional e
   explicitar a diferença em relação a `grill-me`/`grilling`.
4. `writing-plans`: definir gatilho e fronteira com wayfinding/execution.
5. `executing-plans`: definir preflight e protocolo para drift material.

## Decisão pendente

O próximo passo é aplicar somente essas correções de comportamento, na ordem
acima, e repetir os mesmos cenários após cada ajuste. Nenhuma alteração de
conteúdo dessas cinco skills foi aplicada neste diagnóstico.

## Pós-validação — grupo de melhoria `wayfinder` — 2026-09-18

A primeira skill do grupo de melhoria foi revisada e os cenários de pressão
foram repetidos como teste de mesa documental:

- **Trabalho pequeno e claro:** passou. A skill agora exige que um mapa só seja
  criado quando houver destino incerto, decisões dependentes, frontier maior
  que um plano executável ou coordenação entre sessões/pessoas/agentes. Caso
  contrário, encaminha para `writing-plans` ou execução direta.
- **Tracker do Vela:** passou no nível contratual. `wayfinder` agora aponta
  explicitamente para `docs/agents/issue-tracker.md`, e o contrato do Vela usa
  os headings que a skill espera (`Destination`, `Notes`, `Decisions so far`,
  `Not yet specified`, `Out of scope`).
- **Claiming e bloqueios:** passaram no nível contratual. A skill deixou de
  presumir uma operação genérica de atribuição ou de bloqueio e passou a
  exigir as operações documentadas pelo tracker do repositório.
- **Pesquisa sem capacidade de paralelização:** passou. A skill agora define
  fallback para pesquisa na sessão atual, quando autorizada, ou para deixar o
  ticket aberto registrando a capacidade ausente; ela não deve inventar
  subagentes nem ocultar o fato.
- **Iniciativa grande e nebulosa:** passou. O comportamento de mapa e tickets
  dependentes foi preservado para o caso em que realmente existe frontier de
  decisões.

### Limite da validação

Esta foi uma validação documental e estática. O contrato e as instruções foram
verificados no repositório, mas não foi executada uma operação real de criação,
claim ou bloqueio no GitHub durante esta etapa. O próximo grupo de melhoria é
`grill-me-with-docs`, seguido por `writing-plans` e `executing-plans`.

## Diagnóstico de linha de base — grupo de melhoria `grill-me-with-docs` — 2026-09-18

- **Decisão arquitetural ou de domínio com termos ambíguos:** passou. A skill
  encaminha a entrevista para `grilling` em pt-BR e menciona a atualização de
  glossary/ADRs.
- **Usuário quer apenas conversar e explicitamente não quer alterar docs:**
  falhou. Não havia opt-out nem regra para deixar o repositório intacto.
- **Plano já claro, sem decisão de domínio ou arquitetura:** falhou. A skill
  não tinha condição de encerramento antecipado e poderia iniciar uma entrevista
  desnecessária.
- **Preferência temporária ou escolha específica de uma tarefa:** falhou. Não
  havia classificação para impedir que uma decisão local virasse verbete ou ADR.
- **Escolha entre `grill-me`, `grilling` e `grill-me-with-docs`:** parcialmente
  passou. A persistência documental diferencia o wrapper, mas os gatilhos e a
  fronteira com as skills vizinhas não estavam escritos como regras de
  roteamento.
- **Confirmação da decisão antes de persistir:** falhou. O texto dizia para
  atualizar os documentos “à medida que” as decisões surgissem, sem exigir uma
  confirmação explícita do usuário nem indicar quando a entrevista terminou.

**Diagnóstico:** o wrapper tem a intenção correta, mas seu contrato de
persistência é amplo demais. A revisão deve torná-lo condicional, classificar o
que merece documento durável e explicitar as rotas de entrada e saída sem
duplicar o motor de entrevista de `grilling`.

## Pós-validação — grupo de melhoria `grill-me-with-docs` — 2026-09-18

- **Decisão arquitetural ou de domínio:** passou. A skill mantém `grilling` como
  motor da entrevista e define `CONTEXT.md`/ADR como destinos condicionais para
  decisões confirmadas.
- **Opt-out de documentação:** passou. Um pedido explícito para não alterar
  documentos agora interrompe a persistência e permite continuar somente a
  entrevista.
- **Plano claro sem decisão durável:** passou. O roteamento agora encaminha para
  `writing-plans`/`executing-plans` quando apropriado, sem iniciar uma
  entrevista documental desnecessária.
- **Preferência temporária ou escolha local:** passou. A classificação manda
  registrar em plano/spec/issue ou não registrar, em vez de criar verbete ou
  ADR.
- **Roteamento entre skills:** passou no nível documental. A diferença entre
  `grill-me`, `grilling`, `grill-me-with-docs`, `wayfinder`, `writing-plans` e
  `executing-plans` está explícita.
- **Confirmação antes da escrita:** passou. Decisões não confirmadas ficam na
  conversa; a escrita ocorre apenas após confirmação e classificação.

### Limite da validação

Esta foi uma validação documental e estática dos cenários; não houve uma sessão
interativa real nem criação de ADR/alteração de `CONTEXT.md`, porque não existia
uma decisão de produto autorizada para persistir nesta etapa.

## Diagnóstico de linha de base — grupo de melhoria `writing-plans` — 2026-09-18

- **Mudança pequena e clara, localizada em um arquivo:** parcialmente passou.
  A descrição diz “substantial work”, mas o corpo não fornece um teste curto
  para evitar um plano burocrático.
- **Iniciativa grande ainda nebulosa, com decisões dependentes:** falhou como
  roteamento. A skill não define quando parar e usar `wayfinder` antes de
  escrever um plano executável.
- **Requisito material ainda não decidido:** parcialmente passou. A skill manda
  marcar decisões que exigem input, mas não diz quando deve pausar o plano e
  perguntar antes de fechá-lo ou executá-lo.
- **Plano já existente que será executado:** parcialmente passou. O handoff
  para `executing-plans` não está explícito, e a frase sobre continuar a
  implementação pode duplicar responsabilidades.
- **Plano para coordenação ou handoff:** passou. O conjunto de outcome,
  restrições, arquivos, dependências, aceite e checks está claro.
- **Diagnóstico:** a estrutura do plano é boa, mas faltam um gate operacional
  de tamanho/clareza, uma fronteira explícita com `wayfinder` e um protocolo
  para decisões materiais sem autorização implícita.

## Pós-validação — grupo de melhoria `writing-plans` — 2026-09-18

- **Mudança pequena e clara:** passou. A skill agora orienta execução direta
  quando o trabalho é localizado e não cria plano por hábito.
- **Iniciativa nebulosa:** passou. O texto encaminha primeiro para `wayfinder`
  ou para uma skill de entrevista quando o destino ou a rota ainda não estão
  decididos.
- **Decisão material pendente:** passou. O agente deve apresentar alternativas
  em pt-BR, registrar o bloqueio e aguardar a resposta antes de fechar o plano
  ou iniciar a execução, mantendo as partes independentes em andamento.
- **Plano já existente:** passou. A skill encaminha a execução para
  `executing-plans` e evita duplicar sua responsabilidade.
- **Plano multi-arquivo com coordenação:** passou. O conteúdo mínimo preserva
  outcome, escopo, restrições, fontes de verdade, interfaces, dependências,
  aceite, checks, riscos e rollback.

### Limite da validação

Esta foi uma validação documental e estática; nenhum plano de produto foi
criado ou executado como efeito colateral da revisão da skill.

## Diagnóstico de linha de base — grupo de melhoria `executing-plans` — 2026-09-18

- **Plano atual, requisitos claros e checks definidos:** passou. A regra de
  ler fontes, executar em ordem, validar e corrigir é adequada.
- **Diferença mecânica no repositório:** parcialmente passou. A skill permite
  adaptar passos, mas não define exemplos nem pede registro da adaptação.
- **Mudança material de escopo, contrato ou arquitetura:** falhou. Não há um
  critério explícito para parar e consultar o usuário em vez de reescrever o
  plano silenciosamente.
- **Plano inexistente, incompleto ou obsoleto:** falhou como preflight. A skill
  não define quando deve encaminhar para `writing-plans` ou pedir uma decisão.
- **Falha de teste durante execução:** passou. A orientação de diagnosticar a
  falha antes de pedir autorização é correta.
- **Conclusão de plano parcialmente executado:** parcialmente passou. O texto
  manda arquivar ao final, mas não define um checklist observável nem quando
  manter o plano vivo com pendências.
- **Diagnóstico:** o fluxo normal funciona, mas faltam preflight, categorias de
  drift e um contrato de conclusão que evite declarar sucesso prematuramente.

## Pós-validação — grupo de melhoria `executing-plans` — 2026-09-18

- **Plano atual e verificável:** passou. O preflight agora exige leitura do
  plano, conferência das premissas no repositório e separação do trabalho
  pendente.
- **Plano inexistente, arquivado ou incompleto:** passou. A skill encaminha para
  `writing-plans` ou pede somente a informação material ausente, sem inventar
  requisitos.
- **Divergência mecânica:** passou. Renome de caminho, comando equivalente ou
  ajuste local podem ser adaptados, desde que registrados e validados.
- **Divergência material:** passou. Mudança de escopo, contrato, arquitetura,
  segurança, dados, aceite ou rollout exige pausa segura e decisão/atualização
  antes de continuar.
- **Falha de teste:** passou. A regra de diagnóstico foi preservada; a skill
  não transforma falha em pedido automático de autorização.
- **Conclusão parcial ou completa:** passou. O checklist impede declarar sucesso
  sem resultado, checks, documentação e diff revisados; plano incompleto fica
  vivo em `docs/plans/`.

### Limite da validação

Esta foi uma validação documental e estática; nenhum plano de produto foi
executado durante a revisão da skill.

## Validação oficial das quatro skills revisadas — 2026-09-18

- `writing-plans`: **passou** no `quick_validate.py`.
- `executing-plans`: **passou** no `quick_validate.py`.
- `wayfinder`: o validador parou em `disable-model-invocation`, uma propriedade
  já existente que o script oficial não aceita.
- `grill-me-with-docs`: o validador parou pela mesma propriedade existente.

A política `disable-model-invocation: true` foi preservada nas duas skills
interativas porque removê-la alteraria a forma como elas podem ser invocadas.
O restante das verificações de frontmatter, Markdown, links e sincronização foi
aprovado; a incompatibilidade do validador permanece como pendência explícita,
não como uma falha silenciosa.

## Diagnóstico de linha de base — grupo de melhoria de entrevista e comunicação — 2026-09-18

### `grill-me`

- **Usuário pede para ser questionado sobre um plano:** passou. A skill delega
  para `grilling`.
- **Usuário quer que as decisões sejam registradas:** falhou como roteamento. A
  skill não diferencia `grill-me-with-docs` nem define o que fazer com pedidos
  de persistência.
- **Pedido já é uma implementação pequena e clara:** falhou como limite. A
  skill não orienta encerrar cedo ou encaminhar para execução/planejamento.
- **Idioma:** passou apenas parcialmente; pt-BR está presente, mas o wrapper
  não repete as regras de saída e encerramento da entrevista.

### `grilling`

- **Decisão com frontier clara:** passou. A árvore, os rounds e a recomendação
  por pergunta estão bem definidos.
- **Fato que exige capacidade ausente no harness:** falhou. O texto manda
  despachar subagente, sem fallback operacional.
- **Entrevista terminada:** passou parcialmente. A skill manda aguardar
  entendimento compartilhado, mas não explicita que não deve editar código,
  documentos ou tracker por conta própria.
- **Perguntas dirigidas ao usuário:** passou. O formato e o pt-BR estão
  descritos, embora a descrição de frontmatter seja genérica.

### `eli5`

- **Audiência explicitamente indicada:** passou. Há matriz de idade, formação,
  papel profissional e relação.
- **Audiência ausente ou ambígua:** parcialmente passou. O default de idade 5 é
  previsível, mas pode simplificar em excesso quando o pedido é apenas uma
  explicação clara para um adulto.
- **Código, documento ou erro como fonte:** passou parcialmente. A skill manda
  ler a fonte, mas não define pt-BR nem uma regra de fidelidade para conceitos
  de alto impacto.
- **Simplificação de assunto complexo:** falhou em segurança epistemológica. A
  frase que aceita 80% de precisão pode incentivar omissão de fatos materiais.

### `wait-what`

- **Usuário diz que a resposta não ficou clara:** passou parcialmente. O
  gatilho e a intenção de reexplicar existem.
- **Idioma e vocabulário do Vela:** falhou. O texto exige Simplified Technical
  English, em conflito com a convenção pt-BR, e não define fallback se
  `CONTEXT.md` não tiver o termo relevante.
- **Nova resposta ainda não resolve a dúvida:** falhou. Não há ciclo curto para
  identificar o ponto confuso e tentar uma segunda representação.

**Diagnóstico do grupo:** `grill-me` deve ser um wrapper de entrada e roteamento;
`grilling` deve ser o motor neutro da entrevista; `eli5` precisa de uma regra de
fidelidade e idioma; `wait-what` precisa ser um reparo curto, iterável e em
pt-BR. As quatro podem ser melhoradas sem criar uma nova skill.

## Pós-validação — grupo de melhoria de entrevista e comunicação — 2026-09-18

- **`grill-me`:** passou. Agora encaminha explicitamente para `grilling`, não
  persiste documentos e envia pedidos de documentação, mapas ou implementação
  para a skill adequada.
- **`grilling`:** passou. A skill agora declara seu escopo neutro, mantém rounds
  e frontier, usa fallback quando não existe paralelização segura e proíbe
  alterações silenciosas em código, documentos e issues.
- **`eli5`:** passou. O gatilho exige audiência explícita ou invocação ELI5,
  respostas passam a usar pt-BR e a simplificação não pode remover fatos,
  condições ou incertezas materiais.
- **`wait-what`:** passou. O reparo agora é em pt-BR, troca a representação,
  consulta `CONTEXT.md` apenas quando aplicável e limita a interação a uma
  pergunta concreta quando ainda houver ambiguidade.
- **Catálogo:** as descrições correspondentes em `skills/README.md` foram
  alinhadas ao novo contrato.

### Limite da validação

Esta foi uma validação documental e estática; nenhuma entrevista real ou
explicação de produto foi executada como efeito colateral da revisão.

## Diagnóstico de linha de base — grupo de coordenação e manutenção — 2026-09-18

### `handoff`

- **Handoff no Claude Code com CLI disponível:** passou parcialmente. O resumo,
  nome descritivo, skills sugeridas e redação de segredos estão especificados.
- **Handoff no Codex, Antigravity ou harness sem `claude --bg`:** falhou. A skill
  presume uma CLI específica e não define fallback nativo ou manual.
- **Usuário não pediu para iniciar outra sessão:** falhou como limite. O texto
  não explicita que a skill não deve lançar agente por inferência.
- **Resumo com trabalho já documentado:** passou; há orientação para apontar
  para planos, PRs e diffs em vez de duplicá-los.

### `brainstorming`

- **Decisão de produto/design que muda a implementação:** passou. A skill manda
  inspecionar contexto, comparar alternativas e registrar comportamento.
- **Implementação clara, sem decisão em aberto:** passou parcialmente. Há uma
  regra contra cerimônia, mas a fronteira com `writing-plans` e execução não é
  explícita.
- **Exploração pequena e descartável:** passou. A recomendação, sem criação
  automática de spec, está indicada.
- **Design substancial:** parcialmente passou. O gatilho para criar spec e o
  critério de decisão material precisam ser mais operacionais.

### `writing-skills`

- **Criar ou refinar uma skill curta:** passou. Propósito, invariantes, routing e
  referências progressivas estão bem delimitados.
- **Skill vendorizada com política de invocação própria:** passou parcialmente.
  A preservação é citada, mas não há protocolo para diferenciar adaptação local
  de alteração da política original.
- **Skill interativa que pede decisões:** falhou no idioma. Não há regra
  explícita para pt-BR nas perguntas e confirmações do processo de escrita.
- **Validação antes de sincronizar:** passou parcialmente. A orientação existe,
  mas não define o que fazer quando o validador oficial conflita com uma
  propriedade suportada pelo harness.

**Diagnóstico do grupo:** `handoff` precisa ser desacoplada de uma única CLI;
`brainstorming` precisa de um gate e de fronteiras de routing; `writing-skills`
precisa explicitar idioma, proveniência e tratamento de incompatibilidades de
validação. O conteúdo auxiliar existente deve ser preservado e carregado apenas
quando a tarefa exigir.

## Pós-validação — grupo de coordenação e manutenção — 2026-09-18

- **`handoff`:** passou. O texto agora exige pedido explícito, prefere a
  capacidade nativa do harness, usa `claude --bg` apenas quando disponível e
  oferece resumo manual quando não há transferência automática.
- **`brainstorming`:** passou. O gate diferencia decisão material de detalhe
  mecânico, e o routing separa entrevista, mapa, plano e execução.
- **`writing-skills`:** passou. A skill agora exige pt-BR quando interativa,
  preserva proveniência e política de invocação e define como reportar conflito
  entre validador e harness.
- **Catálogo:** as descrições de `handoff`, `brainstorming` e `writing-skills`
  foram alinhadas ao comportamento revisado.

### Limite da validação

Esta foi uma validação documental e estática; não houve handoff para outro
agente nem uma decisão de produto que justificasse criar uma spec.

## Diagnóstico de linha de base — grupo de revisão e segurança — 2026-09-18

### `receiving-code-review`

- **Achado de revisão contra o diff real:** passou. A skill exige verificar
  código, callers e requisitos antes de aceitar a recomendação.
- **Achado especulativo ou preferência:** passou. A distinção entre defeito
  reproduzível e preferência está explícita.
- **Mudança material de negócio ou escopo:** passou parcialmente. Há regra para
  pedir decisão, mas falta routing claro para plano/execução quando a correção
  deixa de ser localizada.
- **Resposta ao comentário:** passou. A autorização e a thread existente são
  mencionadas, mas o restante da comunicação poderia ser padronizado em pt-BR.

### `requesting-code-review`

- **Diff de working tree, commit ou branch:** passou. A skill exige escolher o
  diff e verificar a base.
- **Risco baixo versus mudança de alto impacto:** passou parcialmente. Há regra
  de calibrar profundidade, mas não há gate operacional curto.
- **Revisor independente indisponível:** passou parcialmente. A skill proíbe
  alegar revisão inexistente, mas não define a saída recomendada quando não há
  subagente ou ferramenta disponível.
- **Pedido de push, merge ou deploy:** passou. A revisão não concede essa
  autorização.

### `security-audit-penetration-testing`

- **Auditoria autorizada e local/staging:** passou parcialmente. Escopo e
  aprovação aparecem, mas o texto promete auditoria “completa e automática”,
  confiança de 100% e “pronto para produção”.
- **Pentest em produção ou sem autorização:** falhou como limite operacional.
  O texto não exige confirmação explícita de alvo, autorização, janela e
  método antes de testes ativos.
- **Ferramentas ou scans indisponíveis:** falhou. A skill promete discovery,
  CVE scan e testes sem verificar capacidade, e os exemplos dizem que tudo será
  detectado automaticamente.
- **Auditoria apenas documental:** falhou parcialmente. Não há uma saída clara
  para relatório sem remediação nem para evidência incompleta.
- **Frontmatter:** falhou no contrato Agentskills. `name` contém espaços e
  maiúsculas, e `trigger_phrases`, `version`, `category` e `author` estão fora
  das propriedades aceitas pelo validador oficial.

### `thermo-nuclear-code-quality-review`

- **Revisão estrita explicitamente solicitada:** passou. O padrão e a ordem de
  prioridade são claros.
- **Mudança pequena ou revisão comum:** falhou como routing. O texto pode impor
  uma ambição desproporcional e induzir refatoração além do pedido.
- **Arquivo cruzando 1.000 linhas:** passou como sinal, mas o tratamento como
  bloqueador presumido precisa de contexto e evidência.
- **Sugestão estrutural versus execução:** falhou parcialmente. A skill não
  delimita que é revisão e não autorização para reestruturar o código.
- **Diagnóstico:** as skills de review têm bons princípios, mas precisam de
  gates de escopo, fallback de capacidade e comunicação mais uniforme. A skill
  de segurança requer uma correção estrutural do contrato e das promessas.

## Pós-validação — grupo de revisão e segurança — 2026-09-18

- **`receiving-code-review`:** passou. Agora diferencia recebimento de
  solicitação de revisão, classifica o resultado dos achados e impede
  refatoração fora do escopo ou autorização implícita de entrega.
- **`requesting-code-review`:** passou. O gate de risco e o fallback para
  ausência de revisor impedem simular uma revisão independente.
- **`security-audit-penetration-testing`:** passou no nível contratual. O
  frontmatter agora segue o padrão, o escopo exige autorização e o fluxo separa
  auditoria, remediação e validação segura. Promessas de cobertura total,
  mitigação de 100% e prontidão para produção foram removidas.
- **`thermo-nuclear-code-quality-review`:** passou. A ambição estrutural foi
  preservada, mas o texto agora exige evidência, contexto e escopo antes de
  tratar uma recomendação como bloqueador ou implementar uma refatoração.
- **Catálogo:** as descrições das quatro skills foram alinhadas ao novo
  contrato.

### Limite da validação

Esta foi uma validação documental e estática; não foi executada auditoria de
segurança, revisão independente ou pentest real durante a melhoria das skills.

## Diagnóstico de linha de base — grupo de design e arquitetura — 2026-09-18

### `design-audit`

- **Auditoria real de páginas com screenshots:** passou como intenção, mas o
  fluxo é excessivamente prescritivo e assume Playwright MCP, PostgreSQL 16,
  `apt-get`, Chromium e uma estrutura de ambiente específica.
- **Ambiente sem uma dessas capacidades:** falhou. Não há fallback nem separação
  entre preparação autorizada e auditoria possível com o ambiente atual.
- **Correção segura versus mudança de domínio/dados:** passou parcialmente. Há
  uma lista de arquivos protegidos, mas falta um gate explícito para não aplicar
  correções sem autorização.
- **Entrega:** falhou. A skill manda commit, push e abertura de PR, embora uma
  auditoria não conceda automaticamente essa autorização.

### `frontend-design`

- **Implementação de interface com requisitos claros:** passou. A direção
  visual, coerência e funcionalidade estão bem enfatizadas.
- **Contexto de produto, acessibilidade e restrições existentes:** passou
  parcialmente. O texto privilegia estética e não exige consultar tokens,
  componentes, conteúdo e critérios de acessibilidade antes de escolher uma
  direção.
- **Escolha de fontes, cores e motion:** falhou como regra universal. Proibir
  famílias ou exigir uma estética “extrema” pode conflitar com a marca, o
  sistema existente ou a preferência do usuário.
- **Idioma:** falhou; não há convenção explícita para comunicação em pt-BR.

### `make-interfaces-feel-better`

- **Polimento localizado:** passou. Os princípios são concretos e úteis.
- **Revisão versus implementação:** falhou parcialmente. O texto não define
  quando analisar, quando editar e como calibrar a mudança ao pedido.
- **Valores absolutos de design:** falhou parcialmente. `scale(0.96)`, 40×40px,
  outline preto/branco e delays fixos são heurísticas apresentadas como regras
  universais.
- **Formato de saída:** falhou como routing. Exigir sempre uma tabela Before/After
  não serve para uma implementação que não é uma revisão.

### `ui-ux-pro-max`

- **Escolha de critérios por categoria:** passou. O roteamento para referências
  evita carregar todo o material.
- **Correção isolada versus auditoria ampla:** passou parcialmente. O texto
  menciona a distinção, mas não diferencia claramente `design-audit`,
  `frontend-design` e `make-interfaces-feel-better`.
- **Idioma e evidência:** falhou parcialmente. Não há regra para comunicação
  pt-BR nem para registrar viewport, estado, evidência ou incerteza da análise.

### `improve-codebase-architecture`

- **Exploração e relatório visual:** passou como intenção, mas presume um Agent
  tool com `subagent_type=Explore`, CDN e comandos de abertura específicos.
- **Harness sem subagente, browser ou CDN:** falhou. Não há fallback nem regra
  para declarar a capacidade ausente.
- **Efeitos colaterais durante grilling:** falhou. A skill manda atualizar
  `CONTEXT.md` e ADRs à medida que decisões surgem, sem confirmação explícita
  ou classificação de persistência.
- **Entrega:** falhou. Não deve abrir PR, alterar arquitetura ou criar documento
  durável sem pedido e autorização adequados.

**Diagnóstico do grupo:** preservar os critérios úteis, mas substituir regras
universais por heurísticas contextualizadas; separar análise, implementação e
auditoria; declarar capacidades disponíveis; e remover publicação/alteração
automática como efeito colateral.
