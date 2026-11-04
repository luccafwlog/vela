# 0122 — O CI não roda em rascunho, e a promoção nasce rascunho

Status: aceito — 2026-11-04 (pedido do dono: "Implemente a fase 1" da análise
de enxugamento do CI e da bateria local dos agentes, feita na mesma data).
Supersede parcialmente a [ADR 0086](./0086-ci-confere-na-medida-da-mudanca.md)
(item 1: a PR em rascunho não confere nada) e a
[ADR 0091](./0091-promocao-feature-staging-main.md) (item 5: o CI da PR de
promoção começa quando o dono a marca pronta, não a cada merge na `staging`).
Regra vigente em [WORKFLOW.md](../../WORKFLOW.md), seções "11. Testes e
validação" e "12. CI e deploy", em [Deploy](../setup/deploy.md#workflows) e,
para os agentes, em [AGENTS.md](../../AGENTS.md#verify-the-claim-you-will-make).

## Contexto

O repositório é público, e o GitHub Actions não cobra minutos de repositório
público. O dono quer o repositório privado, e o plano gratuito privado dá cerca
de 2.000 minutos por mês. Entre 2026-10-29 e 2026-11-04, 300 runs do `ci.yml`
(56 por dia) somaram cerca de 950 minutos cobráveis por dia, cerca de 29 mil por
mês. O GitHub arredonda cada job para o minuto de cima: uma PR que toca o banco
custa ~17 minutos, as outras ~12. As medidas vêm da API de runs, com o runner do
repositório público.

Dois pontos concentravam o gasto:

1. **A PR `staging` → `main` rodava o CI a cada merge na `staging`.** Foram 89
   dos 300 runs (~16 por dia), contra ~3 publicações por dia. Esse CI não
   repete o das PRs de feature: como a PR de feature não precisa estar
   atualizada ([ADR 0086](./0086-ci-confere-na-medida-da-mudanca.md), D2), é
   ele que confere a `staging` inteira antes da produção. 3 dos 89 runs ficaram
   vermelhos, um deles no Vitest com o resto verde. O desperdício está na
   frequência, não no teste.
2. **PRs de agente com muitos pushes.** As 91 branches de PR tiveram 2,3 runs
   em média, e 38% dos runs vieram de 10 branches com quatro ou mais. Cada push
   roda o CI inteiro. A bateria local que o `AGENTS.md` pedia em toda mudança de
   aplicação (`lint`, `npm test` e `build` completos) repetia o CI do mesmo
   commit sem evitar esses pushes.

Pular o CI da promoção, ou só os jobs dela, deixaria a produção receber uma
`staging` que nenhum run conferiu. Para a proteção de branch, um job pulado
conta como sucesso, então o `checks` ficaria verde sem conferir nada.

## Decisão

1. **O `ci.yml` não roda em PR rascunho.** `quality`, `test`, `db` e `checks`
   ficam pulados enquanto a PR é rascunho. Ao sair do rascunho, o evento
   `ready_for_review` (já entre os gatilhos) cria um run novo, que começa
   pendente. Rascunho não pode ser mergeado, então o `checks` pulado não
   libera merge. Fora do rascunho nada muda no que o CI confere.
2. **A PR `staging` → `main` nasce rascunho.** `staging-to-main-pr.yml` a cria
   com `--draft`, e os merges seguintes na `staging` só reescrevem o corpo. Na
   hora de publicar, o dono marca **Ready for review**, espera o CI verde (~7
   minutos) e faz o merge com **Create a merge commit**. Atualizar uma PR que já
   está pronta não a devolve a rascunho: cada push novo na `staging` roda o CI
   de novo, como deve. O checklist do corpo da PR passa a dizer isso.
3. **Agentes: o CI do commit final é a prova da suíte completa.** Antes de cada
   push, o agente roda localmente só os checks baratos e os focados no que
   mudou. A suíte completa local fica para quando nenhum CI vai rodar no commit
   entregue. As correções de uma rodada (falha de CI ou revisão) vão num push
   só. Texto em [AGENTS.md](../../AGENTS.md#verify-the-claim-you-will-make) e no
   [WORKFLOW.md](../../WORKFLOW.md) § 11.
4. **Não muda:** o que o CI confere fora do rascunho, o check
   `main-only-from-staging` (que continua rodando também em `edited`), os
   deploys, os workflows semanais e o merge manual da `main`.

## Consequências

- No ritmo medido, o CI da promoção cai de ~16 para ~3–5 runs por dia (cerca de
  −22% do total). A meta da regra dos agentes é sair de 2,3 para ~1,6 runs por
  PR. Medir em duas semanas, pela mesma API de runs: runs por dia (feature e
  promoção), runs por PR, minutos cobráveis (soma das durações arredondadas por
  job), PRs vermelhas no primeiro run (8,5% na medição) e o tempo entre
  **Ready for review** e o merge da promoção. Conta como acerto ao menos 35% a
  menos de minutos por dia, com volume parecido de PRs.
- Uma quebra entre duas PRs já mergeadas na `staging` deixa de aparecer em
  minutos na PR de promoção. Ela aparece na hora de publicar, ou no CI da
  próxima PR de feature, que testa contra a `staging` nova. O deploy da
  `staging` continua compilando a cada push.
- Publicar tem um passo a mais: marcar a PR pronta e esperar o CI.
- Entre o clique em **Ready for review** e a criação do run novo há alguns
  segundos em que o último `checks` registrado é o pulado. Só quem pode mergear
  na `main` alcança essa janela; o merge vem depois do CI verde.
- A PR de promoção aberta antes desta mudança continua pronta. Ela segue com o
  CI a cada merge até ser mergeada, ou até o dono convertê-la em rascunho.
- Reverter: se uma quebra de integração chegar à produção, volta o CI a cada
  merge na promoção (basta tirar o `--draft` do workflow); se as PRs vermelhas
  no primeiro run passarem de 15%, volta o `npm test` local antes do push.
