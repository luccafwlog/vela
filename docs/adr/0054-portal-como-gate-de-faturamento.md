# ADR 0054 — Portal ativo e acesso do cliente como gate de faturamento

> **Nota editorial — 2026-09-23.** A exceção interna da `051` foi retirada pela [ADR 0070](./0070-portal-trava-toda-emissao-e-liberacao-por-cliente.md) (migration `083`): o Portal trava toda emissão, inclusive a automática pelo CE, e a saída sem Portal é a Liberação de faturamento sem Portal, por Cliente, concedida pelo Administrativo.
>
> **Nota editorial — 2026-09-18 · supersedida parcialmente.** A 047 mantém a prontidão do Portal na emissão manual; a 051 introduz contexto interno controlado que emite pela transição CE sem provisionamento. Não é dispensa pública do gate.
> Rastreabilidade: [ADR 0065](./0065-inbox-efeitos-e-autoridade-financeira.md); [migration ativa 051](../../supabase/migrations/051_ce_mercante_auto_billing.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-08-17

## Contexto

Uma fatura só pode ser considerada faturada quando o cliente consegue recebê-la
e visualizá-la. A migration `188_review_gate_remove_portal.sql` retirou a
prontidão do Portal do gate, mas isso contradiz o controle financeiro exigido:
sem Conta de Portal ativa e acesso utilizável, a fatura fica indisponível para
quem deve pagá-la.

## Decisão

- A prontidão do Portal é condição obrigatória do gate de revisão/faturamento.
- Para o cliente ser considerado pronto, a Conta de Portal precisa estar ativa,
  vinculada ao usuário de autenticação e com Email de Recuperação válido e não
  suprimido, conforme o contrato de Clientes/Portal.
- A decisão final deve ser aplicada server-side na fronteira que permite
  `ready_for_billing`/emissão; a UI não pode declarar o processo faturado antes
  dessa guarda.
- A ausência do Portal é motivo canônico do alerta único do B/L quando o B/L
  estiver na fila de revisão. Ela não cria um segundo alerta para a mesma
  entidade.
- A ativação ou correção da Conta de Portal deve disparar a recomputação dos
  B/Ls afetados. O histórico já faturado não é reaberto automaticamente.
- A migration `188` permanece imutável. A restauração do gate deve ocorrer em
  migration nova, sequencial e com testes da fronteira server-side.

## Nota editorial — 2026-08-31

O gate decidido aqui **foi implementado** pela migration
`337_review_portal_alert_producer.sql`, que devolveu
`Acesso ao portal nao provisionado` ao produtor canônico
`compute_bl_review_pendencies`. Como a fronteira que promove
`ready_for_billing` e emite consulta essa função e recusa gravando
`billing_hold_reason`, a guarda server-side exigida por esta ADR está em vigor.
Nem esta ADR nem o `CONTEXT.md` foram atualizados na época, e por isso o
glossário seguiu descrevendo a categoria de bloqueio como fechada em três
motivos — a contradição era documental, não de comportamento.

Dois pontos ficam fixados agora, ambos pendentes de implementação:

- **Critério de prontidão** — a 337 verifica apenas conta `active` com
  `auth_user_id`. O texto desta ADR exige mais: conta ativa
  (`account_situation = 'ativo'`), vinculada ao usuário de autenticação, com
  e-mail de recuperação válido e não suprimido. `convite_pendente` não passa: o
  cliente ainda não acessou.
- **Precedência na fila** — quando há mais de um bloqueio aberto, o portal é o
  último exibido (cliente, cálculo, CE Mercante, portal), por ser o único que se
  resolve no cadastro do cliente e não no B/L. Hoje a Validação não nomeia esse
  motivo: ele chega como `billing_hold_reason` genérico e é exibido como
  *Cálculo incompleto*.

O gate atinge a **emissão**, individual e consolidada, nunca o cálculo: as taxas
seguem sendo calculadas para conferência com o bloqueio aberto.

## Relação com decisões anteriores

Esta ADR supersede a nota editorial de 2026-08-16 da ADR 0006 e a parte da
`188_review_gate_remove_portal.sql` que retirou o Portal do gate. As demais
regras da ADR 0006, inclusive a ausência de backfill top-level, permanecem
vigentes.
