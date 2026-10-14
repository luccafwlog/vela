# ADR 0053 — Alerta fecha pela origem; dispensa temporária exige revisão

> **Situação atual (2026-10-14).** Decisão vigente, supersedida parcialmente pela [ADR 0083](./0083-decisoes-da-revisao-geral-da-documentacao.md) (item 23): o Alerta continua fechando pela origem quando há fato verificável, mas não vale mais que a dispensa temporária seja a única ação manual, porque os tipos de conferência sem fato de origem, como `portal_abuso_login`, ganham "Resolver com justificativa", com motivo obrigatório e registro no histórico. Implementada pela migration `238` (itens B27 e A23 do [plano de correções](../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md)): `resolve_billing_alert` só fecha `billing_auto_issue_failed` e `billing_calculation_blocked` quando o servidor confirma a origem resolvida, e "Resolver com justificativa" existe para os tipos de conferência, com motivo obrigatório no histórico.
> Regra vigente em [Operação e Suporte § Alertas e Notificações Internas](../modules/operacao-suporte.md#alertas-e-notificações-internas).

Status: supersedida parcialmente — 2026-08-17

## Contexto

O modelo anterior misturava leitura pessoal, reconhecimento coletivo,
fechamento manual e resolução da condição de origem. Isso permitia que uma
ação administrativa parecesse resolver uma pendência que ainda bloqueava o
processo. A mesma regra precisa valer para todos os tipos de alerta, sem uma
política diferente por situação.

## Decisão

- A Notificação Interna continua tendo leitura individual por destinatário. Ler
  nunca altera o Alerta.
- O Alerta permanece aberto enquanto a condição de origem existir. Não há mais
  estado nem ação de `reconhecer`.
- Fechamento é automático e só ocorre quando a recomputação da origem confirmar
  que a condição foi resolvida. Fechar nunca é sinônimo de tomar ciência.
- A ação manual disponível é uma **dispensa temporária**: ela tira o Alerta da
  fila prioritária, mas não resolve a origem, não libera gate e não o transforma
  em encerrado.
- Toda dispensa exige motivo, autor, data/hora e data futura de revisão. Não há
  data padrão, dispensa indefinida ou exceção por tipo de alerta.
- Na data de revisão, se a condição persistir, o Alerta retorna à fila ativa;
  se tiver sido resolvida, a recomputação o fecha automaticamente.
- A dispensa deve ser representada como metadado/registro temporário ligado ao
  Alerta aberto, e não como um estado terminal que possa ser confundido com
  resolução. A unidade e a unicidade do Alerta não mudam.

## Consequências

O contrato transversal deve oferecer a mesma guarda server-side e o mesmo
formato de dispensa para todos os produtores. A UI pode separar fila ativa,
dispensados e encerrados, mas não pode apagar o histórico nem tratar dispensa
como resolução. O Eco de Tratamento, quando existir, registra a ação manual de
dispensa; a leitura continua sem eco.

Esta decisão supersede parcialmente a ADR 0034 somente quanto ao estado
`reconhecido`, ao reconhecimento e ao fechamento manual. A separação entre
Alerta coletivo e Notificação Interna, a cópia congelada e as regras de
destinatários permanecem vigentes.
