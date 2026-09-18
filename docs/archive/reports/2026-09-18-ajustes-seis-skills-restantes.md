# Ajustes das seis skills restantes — 2026-09-18

## Escopo

Depois das consolidações de revisão, entrevistas e design, foram revisadas as
seis skills que permaneceram com necessidade de ajuste comportamental:

- `brainstorming`
- `design-audit`
- `improve-codebase-architecture`
- `security-audit-penetration-testing`
- `wait-what`
- `writing-skills`

O objetivo foi preservar suas finalidades, reduzir ambiguidades de roteamento e
aplicar as duas regras transversais aprovadas pelo usuário: comunicação em
português BR e explicação pelo vocabulário visível do Vela antes do detalhe de
implementação.

## Ajustes por skill

### `brainstorming`

- ganhou uma seção explícita sobre decisões e persistência;
- não grava `CONTEXT.md`, ADR, spec, plano ou issue sem pedido ou confirmação;
- não resolve silenciosamente uma decisão nova que contradiga uma anterior;
- apresenta exemplo hipotético no vocabulário do Vela antes de pedir a decisão;
- encaminha a decisão fechada para `writing-plans` ou `executing-plans`.

Também foi removida a dependência de um comando específico para o companion
visual: a skill usa a capacidade de edição e visualização disponível no harness.

### `design-audit`

- deixou de presumir uma sequência única de páginas do produto;
- passou a usar exemplos flexíveis: Viagens, BLs, Taxas Locais e faturas;
- separa achado visual, entendimento, confiança, conversão, defeito técnico e
  decisão de produto;
- confronta a sessão atual, `CONTEXT.md` e ADRs vigentes;
- marca substituição de semântica como decisão pendente quando ela não estiver
  explícita;
- não transforma o relatório em autorização para corrigir código ou persistir
  uma nova regra.

### `improve-codebase-architecture`

- foi reescrita para distinguir hipótese arquitetural de decisão de mudança;
- explora com o agente atual quando o harness não oferece exploração
  independente autorizada, sem prometer subagentes inexistentes;
- exige relatório HTML autocontido, com CSS/SVG inline e fallback offline;
- permite citar componentes, services, APIs, queries e RPCs quando forem
  evidência, mas começa pelo efeito em páginas e fluxos do Vela;
- exige exemplo hipotético por candidato;
- pede escolha do usuário antes de aprofundar ou implementar;
- requer confirmação antes de alterar `CONTEXT.md`, ADR, spec, plano ou issue.

O formato `HTML-REPORT.md` foi alinhado a esse contrato, incluindo rótulos em
português BR e exemplos de Viagem, B/L e Taxa Local.

### `security-audit-penetration-testing`

- define análise local e estática, sem tráfego ativo, como padrão seguro;
- separa auditoria estática, dependências, configuração e teste ativo;
- exige alvo, autorização, janela e limites antes de scan externo ou exploração;
- exige exemplo hipotético para cada risco material, usando o vocabulário do
  Vela;
- separa risco técnico da decisão de produto quando o ajuste afetar acesso a
  BLs, uma página, emissão de fatura ou Taxa Local.

### `wait-what`

- passou a aplicar explicitamente o perfil do proprietário do Vela;
- explica primeiro página, botão, campo, estado e efeito;
- evita começar por component, service, query ou RPC;
- não usa analogias infantis por padrão.

### `writing-skills`

- registra que `skills/<nome>/` no repositório é a única fonte editável;
- trata `.agents`, Claude, Codex e Antigravity como destinos materializados;
- exige dry-run, ownership e `--check` no fluxo de sincronização;
- protege skills de sistema e plugins contra poda do Vela;
- exige uma matriz de cenários quando uma mudança altera o comportamento:
  gatilho, não gatilho adjacente, comportamento obrigatório, comportamento
  proibido, momento de perguntar e exemplo do fluxo Vela.

## Ajustes de catálogo

As descrições no `opencode.json` e no `skills/README.md` foram alinhadas aos
novos contratos, especialmente para `brainstorming`, `design-audit`,
`improve-codebase-architecture`, `security-audit-penetration-testing` e
`wait-what`.

## Validação

- `quick_validate.py`: passou em `brainstorming`, `design-audit`,
  `security-audit-penetration-testing` e `writing-skills`;
- `quick_validate.py`: rejeitou somente `disable-model-invocation` em
  `improve-codebase-architecture` e `wait-what`; o campo foi preservado porque
  é uma política válida do harness e o validador utilizado não o reconhece;
- `npm run docs:check`: passou;
- `git diff --check`: passou;
- `node --test scripts/skills/skill-sync.test.mjs`: 5/5 passou;
- `npm run skills:sync -- --dry-run`: identificou as seis atualizações nos
  quatro destinos gerenciados e não indicou poda de skill antiga.
- `npm run skills:sync`: aplicado nos quatro destinos gerenciados;
- `npm run skills:sync -- --check`: passou sem divergências;
- inventário pós-ajuste: 14 skills em cada raiz, com hashes iguais ao
  repositório.

O inventário completo está em
`docs/skills/skill-inventory-post-cleanup-2026-09-18.md`.

## Limites

Nenhuma implementação do Vela, ADR, `CONTEXT.md`, issue, commit ou push foi
alterado por estas skills. O plano foi atualizado apenas para registrar a
execução e a evidência; commit e push continuam pendentes de aprovação.
