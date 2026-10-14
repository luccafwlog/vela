# ADR 0043 — Vínculo de cliente somente por documento

> **Situação atual (2026-10-13).** Vale o vínculo automático só por documento exato; nome continua sendo sugestão confirmada por pessoa na fila de revisão. Não vale mais a menção a CPF nem a normalização "para dígitos": não existe Cliente pessoa física e CPF é recusado ([ADR 0078](./0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md), item 17), e o CNPJ canônico tem 14 caracteres alfanuméricos (migration arquivada `293`).
> As migrations `284`–`287` citadas abaixo são da cadeia arquivada (`supabase/migrations_archive/`), anterior à consolidação da ADR 0062.
> Regra vigente em [Clientes](../modules/clientes.md), seção "Reconciliação de cliente em B/L e Granito".

Status: supersedida parcialmente — 2026-08-11 (original: aceito e implementado nas migrations `284`–`287`)

## Decisão

O vínculo automático de um B/L ou Granito só pode ocorrer por CPF/CNPJ exato,
normalizado para dígitos. Match por nome continua sendo uma sugestão persistida
em `bls.suggested_customer_id` ou `granite_bls.suggested_client_id` e só vira
vínculo após confirmação humana na fila de revisão.

As duas FKs para `customers` são qualificadas nos embeds PostgREST. O
faturamento continua lendo apenas `customer_id`/`client_id`; sugestões não
liberam cobrança. O backfill 287 exclui faturados e decisões humanas e pode ser
reexecutado sem mover a mesma linha novamente.

## Consequências

Imports de container, carga solta e Granito preservam o candidato sugerido, a
fila o exibe, e a confirmação usa os RPCs de revisão existentes. A contagem de
impacto deve ser executada em somente-leitura antes da aplicação em cada ambiente.
