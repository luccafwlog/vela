# ADR 0022: Omissao de Escala, Transbordo e COD como Registro Operacional

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** COD reprecifica Taxa Local; escala omitida continua visível como OMIT. COD também limpa manifesto_mercante_id e exceção de terminal, preservando ce_mercante.
> Rastreabilidade: [ADR 0051](./0051-cod-reprecifica-no-destino-final.md), [ADR 0052](./0052-escala-omitida-visivel-na-programacao.md); [migration ativa 060](../../supabase/migrations/060_pr698_claude_review_followup.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente

Data: 2026-07-09

## Contexto

O armador pode omitir uma escala prevista, descarregar a carga em outro POD e
seguir com transbordo por navio de terceiro. Em alguns B/Ls, a excecao vira COD
(Change of Destination), alterando o destino final para o porto de descarga.

Esse evento precisa aparecer na operacao e no Portal, mas nao deve automatizar
CE Mercante, taxas, demurrage ou outros efeitos financeiros.

## Decisao

- Registrar a omissao no grao escala em `voyage_omissions`.
- Registrar a disposicao por B/L em `bl_transshipments`, com `transshipment`
  como padrao e `cod` como excecao.
- Tratar o navio de transbordo como referencia leve, nao como uma nova Viagem.
- Diferenciar omissao de exclusao: `deleted` remove um POD do planejamento;
  `omitted` preserva a escala como evento operacional rastreavel.
- Excluir PODs omitidos de `getProximaEscala`, da conclusao automatica da viagem
  e da RPC `portal_ship_schedule`.
- Expor o evento ao Portal por `portal_notifications.type='transshipment'`, sem
  dar acesso direto do Portal as tabelas internas.
- Notificar a omissao da escala no primeiro momento para todos os B/Ls afetados;
  se um B/L virar COD depois, ele recebe nova notificacao especifica de destino.

## Consequencias

Financeiro, CE Mercante, taxas e demurrage seguem manuais. COD atualiza
`bls.pod` por RPC auditada; reverter para transbordo restaura o POD original da
omissao. O fluxo depende de RPCs `SECURITY DEFINER` com `auth.uid()`,
`is_active_user()` e `changed_by=auth.uid()`.

## Nota editorial — evolução do registro global

A implementação da spec aprovada de 2026-07-16 evoluiu o cabeçalho da omissão:
porto, motivo, navio, armador, viagem, ETD e ETA passaram a formar um registro
global em `voyage_omissions`, complementável pela RPC auditada
`update_voyage_omission`. `bl_transshipments` conserva a disposição individual
(`transshipment` ou `cod`). O Portal projeta os dados globais vigentes no card
`Informações de Transbordo`; somente a omissão inicial e o COD individual criam
notificações.

## Nota editorial — 2026-08-19 (exclusão do `portal_ship_schedule` supersedida)

A decisão de excluir PODs omitidos da RPC `portal_ship_schedule` foi revista
pela [ADR 0052](./0052-escala-omitida-visivel-na-programacao.md): a escala
omitida volta a aparecer na programação, marcada como `OMIT`, para o operador e
para o cliente. Esconder tornava uma escala cancelada indistinguível de uma
escala sem data informada.

As outras duas exclusões da mesma linha — `getProximaEscala` e a conclusão
automática da viagem — permanecem válidas, assim como todo o resto desta ADR.
