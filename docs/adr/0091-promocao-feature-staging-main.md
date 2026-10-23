# 0091 — Promoção feature → staging → main

Status: aceito — 2026-10-20. Estende a [ADR 0010](./0010-validacao-testes-deploy-gates.md)
no caminho até a produção. Não altera o que o CI confere
([ADR 0086](./0086-ci-confere-na-medida-da-mudanca.md)) nem o hosting
([ADR 0076](./0076-cloudflare-pages-como-hosting.md)).

> **Situação atual (2026-10-22, auditoria de segurança run-3).** Os itens 3 e 5
> valem com dois ajustes decididos pelo dono: o workflow da promoção dispara no
> push na `staging` (o merge de uma PR), e não mais no fechamento da PR, e
> `STAGING_TO_MAIN_TOKEN` mora no environment GitHub `staging-release`,
> restrito à branch `staging`. O check `main-only-from-staging` passa a ser
> obrigatório na proteção da `main` (passo do dono).

Regra vigente em [WORKFLOW.md](../../WORKFLOW.md#promoção-da-staging-para-a-main)
e em [Deploy](../setup/deploy.md#workflows).

## Contexto

A `main` publica vela.app.br e portalfwlog.com.br a cada push. Feature indo
direto para a `main` publica produção no mesmo merge que entra no código. A
branch `staging` já é o ambiente fixo de QA (sites e banco), e o GitHub não
tem uma trava nativa "a main só aceita PR da staging".

Squash na promoção `staging` → `main` afasta as duas branches a cada release.

## Decisão

1. PR de feature abre contra `staging`. O merge nela publica o staging, pelo
   workflow que já existe no push da branch.
2. A `main` só aceita PR cuja origem é a branch `staging` deste repositório.
   O check `main-only-from-staging` falha nos outros casos. Ele passa a ser o
   nome exigido na proteção da `main`; aplicar essa proteção fica com o dono.
3. O merge de uma PR na `staging` abre a PR `staging` → `main`, ou atualiza a
   que já estiver aberta. O merge na `main` continua manual.
4. Essa PR pede **Create a merge commit**. O corpo lista as PRs reconhecidas
   no assunto dos commits e é reescrito a cada merge na `staging`.
5. O secret `STAGING_TO_MAIN_TOKEN` faz o CI da PR de promoção começar
   sozinho. Sem ele, o workflow usa o `GITHUB_TOKEN` e o CI espera aprovação.
   Criar o secret e trocar a branch padrão para `staging` ficam com o dono.

A prévia `pr-N` continua só para PR cuja base é `main`. QA da feature é o
staging persistente.

## Consequências

- Publicar produção continua sendo o merge da PR `staging` → `main`.
- Os workflows desta decisão estão no repositório. Proteção da branch, branch
  padrão e o secret ainda não estão aplicados.
- A lista de PRs pode omitir push direto na `staging`, porque o assunto não
  traz `#n`. Acima de 250 commits, a leitura anda até o merge-base com teto;
  se o teto estourar, o corpo avisa que a lista pode estar incompleta.
