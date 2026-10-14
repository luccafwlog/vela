# ADR 0060 — Perfil Equipamentos ganha sua primeira permissão

> **Situação atual (2026-10-14).** A permissão `customer_communications` vale para disparar Comunicados e editar contatos e caixas. Pela [ADR 0085](./0085-modelo-de-permissoes-por-perfil.md) (item D19), não vale mais que ela governe o acesso ao módulo inteiro: qualquer Departamento abre `/clientes/comunicacao` para consultar o histórico. Implementado na migration `250` (item P12 do [plano de correções](../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md)).
> Regra vigente em [Segurança](../operations/seguranca.md), seção "Modelo de permissões por perfil".

Status: supersedida parcialmente — 2026-08-27; o acesso de leitura ao módulo mudou pela ADR 0085 em 2026-10-14

## Contexto

`roleHasPermission` (`src/hooks/useAuth.tsx`) hoje retorna `false` para
`equipamentos` em toda permissão: o perfil existe, tem leitura interna global
pela ADR 0044 e escrita com rastro pela ADR 0046, mas nenhuma permissão
nomeada.

A cobrança de Demurrage é responsabilidade de Equipamentos na operação, e o
canal de Comunicado (ADR 0058) coloca essa cobrança dentro do sistema. Sem
permissão, Equipamentos não alcançaria a tela que executa o próprio trabalho.

Considerou-se recortar a permissão por Natureza do Comunicado — Documentação e
Administrativo em Avisos gerais, Avisos operacionais e Documentação;
Equipamentos apenas em Demurrage. O produto decidiu que os três perfis disparam
qualquer comunicado, e a trilha responde quem fez.

`financeiro` fica **fora** por decisão, não por esquecimento: ele detém
`settle_financial_adjustments` e as superfícies de taxas locais e Demurrage,
mas o Comunicado é redação operacional dirigida ao cliente — quem opera a
viagem (Documentação) e quem opera a cobrança (Equipamentos) —, não lançamento
financeiro. Se o produto quiser incluí-lo, é um perfil a mais nesta mesma
permissão, sem ADR nova.

## Decisão

- Nasce a permissão `customer_communications`, concedida a `administrativo`,
  `documentacao` e `equipamentos`.
- Ela governa o acesso ao módulo de Comunicação e a execução de Disparo de
  Comunicado, sem recorte por Natureza.
- Todo disparo registra autor, momento e recorte.
- `portal_provisioning` **não** é reaproveitada: amarrar comunicação
  operacional à governança do Portal recriaria o acoplamento que a ADR 0058
  desfaz.

## Consequências

`equipamentos` deixa de ser um perfil sem permissões. O `switch` de
`roleHasPermission` passa a ter um ramo real para ele, e o teste
`src/hooks/__tests__/roleHasPermission.test.ts` precisa cobrir a nova matriz.

**Atenção ao editar o `switch`.** Hoje `equipamentos` não tem um ramo próprio:
ele compartilha o arm de `operacoes` (`src/hooks/useAuth.tsx`), que é literalmente

```ts
case 'operacoes':
case 'equipamentos': return false
```

Trocar o `return false` no lugar concede `customer_communications` a
`operacoes` junto, em silêncio. A edição correta **separa** os dois `case`,
mantendo `case 'operacoes': return false`. A matriz do teste precisa afirmar
que `operacoes` continua sem a permissão, senão a regressão passa despercebida.
**Evidência: Código.**

Como não há recorte por Natureza, um usuário de Documentação pode disparar
cobrança de Demurrage e um de Equipamentos pode disparar Aviso de Chegada.
Isso é escolha consciente do produto: a conferência obrigatória e a trilha por
autor são as guardas, não a permissão. Se o recorte vier a ser necessário, ele
entra como refinamento desta permissão, não como permissão nova — e as quatro
Naturezas já lhe dão o corte pronto, com Equipamentos coincidindo exatamente com
Demurrage.

Não altera a ADR 0044 (leitura interna global) nem a 0046 (escrita interna
global com rastro). Especificação funcional em
[`../archive/specs/2026-08-27-comunicacao-email-clientes-design.md`](../archive/specs/2026-08-27-comunicacao-email-clientes-design.md).
