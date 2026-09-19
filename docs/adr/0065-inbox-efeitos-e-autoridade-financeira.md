# ADR 0065 — Inbox durável, efeitos pós-commit e autoridade financeira server-side

> **Implementação conferida em 2026-09-18 (Código):** 031 implementa consumidores adicionais; 027/028/030 refinam moeda, ROE e snapshots. Rollout remoto continua exigindo evidência própria.

Status: aceito — 2026-09-07

## Contexto

Webhooks e imports podem terminar depois que a requisição ou a aba do
navegador desaparece. Deduplicar o evento antes de resolver sua tentativa pode
consumir um callback sem efeito; executar efeitos financeiros no browser pode
perder a conclusão, repetir uma invoice ou aceitar valores que não foram
recalculados pelo banco.

O plano de remediação das auditorias #654–#660 também exige que falhas de
automação permaneçam visíveis e recuperáveis, sem ativar jobs remotos por
efeito colateral de uma migration.

## Decisão

1. **Inbox antes do processamento:** `portal-email-webhook` autentica o
   provedor e persiste o evento em `portal_email_events`. A deduplicação é
   baseada na identidade do provedor; evento sem payload ou sem tentativa
   resolvível não é tratado como sucesso silencioso.

2. **Transições server-only:** `portal-email-events-runner` faz claim com
   lease e chama o processador compartilhado. Ordenação, retry com backoff,
   bounce/complaint, fallback e investigação ficam registrados no banco. O
   consumidor é at-least-once e seus efeitos precisam ser idempotentes; a
   decisão não promete exactly-once em integrações externas.

3. **Efeitos de importação recuperáveis:** `import_pending_effects` preserva o
   iniciador (`created_by`), a revisão/identidade do efeito, lease e histórico
   de tentativas. `process_import_effect` é executável somente por
   `service_role`, revalida o actor originador dentro dos núcleos de domínio,
   classifica erros transitórios para retry e bloqueia tipos sem consumidor
   completo com alerta persistente. O `import-effects-runner` é agendado, mas
   responde pausado até `IMPORT_EFFECTS_RUNNER_ENABLED=true`.

4. **Autoridade de Demurrage:** emissão recebe B/L, cliente, containers e
   documento; o banco resolve datas, tipo, tarifas, acordo e overrides,
   calcula os valores e produz o payload PIX. Cada resultado relevante grava
   `demurrage_calculation_snapshots` append-only, com versão, hash das entradas
   e evento. O browser não é autoridade para total, PTAX ou payload.

5. **Falha de PTAX como estado persistente:** indisponibilidade da fonte,
   referência ou recálculo abre `demurrage_ptax_recalc_failed` no catálogo de
   alertas; sucesso resolve a ocorrência. O job nominal continua inativo até
   autenticação, gateway, Vault e execução controlada em Preview serem
   conferidos.

## Consequências

- Crash da requisição não apaga a intenção: inbox e outbox podem ser retomadas
  pelo mesmo identificador, sem replay cego de eventos legados.
- O banco passa a ser a fonte de verdade para emissão de Demurrage e o
  histórico financeiro permite comparar versões sem atualizar snapshots.
- Falha operacional é tratada como fila/revisão (`retry_wait`, `blocked` ou
  `investigate`), não como sucesso parcial invisível.
- Runners, Vault e cron ainda são recursos do ambiente: testes locais não
  provam publicação, grants remotos, execução de `pg_cron` ou envio real.
- Consumidores de Granite e acompanhamento de veículos que ainda não têm
  implementação completa permanecem bloqueados e geram investigação; esta
  ADR não autoriza ativá-los silenciosamente.

## Implementação e evidência

- `022_email_inbox_and_dispatch_state.sql`: inbox, tentativas, claim e
  processamento de eventos.
- `023_demurrage_calculation_snapshot.sql`: RPC autoritativo, snapshot e ACLs.
- `024_demurrage_ptax_alert.sql`: catálogo do alerta de PTAX.
- `025_import_effect_worker.sql` e `026_import_effect_alert.sql`: consumidor,
  retry, bloqueio, alerta e job fail-closed.
- Testes focados e integrações opt-in em `src/services/__tests__` e
  `src/integration`, com PostgreSQL local descartável.

Esta decisão supersede parcialmente a autoridade de cálculo implícita na ADR
0026 apenas para emissão e snapshot server-side; não altera as regras de
domínio de tarifas, disputa, pagamento ou a política de ativação operacional.
