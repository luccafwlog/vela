# 0002 — Cliente pode refazer a própria consolidada pelo Portal

> **Situação atual (2026-10-21).** Estendida pela [ADR 0093](./0093-tabela-vinculada-ao-bl-e-coerencia-financeira.md) (decisões 6 a 8): pagar uma individual reemite a consolidada sem ela, pagamento parcial atualiza a outra fatura, e a consolidada substituída continua visível no Portal com o nome da sucessora. Ainda não implementado ([plano](../plans/2026-10-21-correcoes-frente-financeira.md)). O restante desta faixa vale desde 2026-10-14: O cliente continua desfazendo pelo Portal a consolidada aberta e sem pagamento, com rastro e aviso no Portal.
> Não valem mais o `p_session_token`, porque o cliente vem da sessão do Supabase Auth ([ADR 0001](./0001-portal-login-supabase-auth.md)), nem o estado `overdue`, que saiu da fatura local ([ADR 0055](./0055-taxa-local-sem-vencimento-praticado.md)). A RPC vigente (migration `109`) também limita as tentativas e recusa a fatura com PIX em conciliação.
> Não vale mais o alerta aos operadores internos: a [ADR 0083](./0083-decisoes-da-revisao-geral-da-documentacao.md) (item 25) confirma o comportamento atual, em que a reconsolidação não avisa a equipe interna (o alerta saiu na migration arquivada `327`) e vale para qualquer consolidada do Cliente, inclusive a emitida pela equipe interna.
> Regra vigente em [Portal do Cliente](../modules/portal-cliente.md), seção "Catálogo de ações".

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Reconsolidação permanece; sessão é resolvida por Auth e overdue não integra mais o estado da invoice local.
> Rastreabilidade: [ADR 0055](./0055-taxa-local-sem-vencimento-praticado.md); [migration ativa 002](../../supabase/migrations/002_business_logic_and_security.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-06-03

## Contexto

Um receivable de taxas locais só pode pertencer a **uma** fatura consolidada aberta por vez. Ao consolidar os B/Ls A, B e C, eles ficam vinculados (`invoice_receivable_links.status='active'`) a uma consolidada em aberto e passam a ser marcados como `open_consolidated` — inelegíveis para uma nova consolidação. O core de emissão (`create_local_consolidated_invoice_core`) também rejeita B/Ls já em consolidada aberta.

Consequência: se o cliente emitiu uma consolidada de A, B, C e depois quer uma de A, B, C, D, ele **não consegue** sem antes desfazer a primeira. Hoje o único caminho é interno: um operador marca a consolidada como obsoleta (`obsolete_consolidated_invoice`), o que libera os B/Ls, e então reemite. O cliente não tem autonomia.

## Decisão

O Portal do Cliente passa a permitir que o **próprio cliente** desfaça uma consolidada **que ele mesmo emitiu e que ainda está aberta**, devolvendo os B/Ls à seleção para reemissão.

Implementado por um RPC `portal_obsolete_consolidation(p_session_token, p_invoice_id)`, `SECURITY DEFINER`, com guardas:

- a invoice precisa pertencer ao `customer_id` da sessão;
- precisa ser `invoice_type='consolidated'` em estado obsoletável (`issued`/`partially_paid`/`overdue`);
- **não pode ter pagamentos registrados**;
- reusa a lógica de `obsolete_consolidated_invoice` (status `obsolete`, links `obsolete`);
- grava `audit_logs` e dispara um **alerta** para os operadores internos.

## Consequências

- **Positivas**: o cliente corrige a própria consolidada sem depender do operador; o caso A,B,C → A,B,C,D passa a ser self-service.
- **Negativas / riscos**: é uma ação **destrutiva executada por usuário externo**. Mitigado pelas guardas (escopo à sessão, só a própria consolidada, sem pagamentos) e pela trilha de auditoria + alerta, que preservam a reflexão Portal ↔ interno.
- **Alternativas descartadas**: (a) manter mediado pelo operador — rejeitada por falta de autonomia; (b) auto-incorporar (obsoletar + reemitir numa ação só) — adiada por ser mais complexa e igualmente destrutiva.
