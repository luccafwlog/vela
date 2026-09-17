# Specs (vivas)

Este é o **único** diretório de specs vivas do projeto. Ele contém:

1. A **spec comportamental canônica** derivada do código (planilha CSV/XLSX,
   detalhada abaixo) — permanente, nunca arquivada.
2. **Specs funcionais / design docs** aprovadas que ainda não tiveram seu plano
   derivado executado. Skills e agentes (incluindo o plugin Superpowers) gravam
   specs novas aqui, com o nome `YYYY-MM-DD-<tema>-design.md`.

Quando o plano derivado de uma spec é concluído, a spec é movida para
[`../archive/specs/`](../archive/README.md). Regra completa em
[`../CONVENCOES.md`](../CONVENCOES.md#ciclo-de-vida-de-planos-e-specs).

## Specs funcionais vivas

| Spec | Tema |
|---|---|
| [Integração futura com o Itaú — cobrança PIX](2026-08-25-integracao-itau-pix.md) | QR Code dinâmico, webhook e confirmação automática de pagamento |
| [Unificação de B/Ls e carga mista](2026-09-16-unificacao-bls-carga-mista-design.md) | Rota única `/bls`, `cargo_mode = 'misto'`, motor de taxas de duas tabelas e projeção em `/viagens` |
| [Manifesto Mercante — modelo de domínio](2026-09-17-manifesto-mercante-design.md) | Manifesto como lançamento: entidade própria com número único, par de portos e natureza; renomeação de "CE Master" para "Nº de Manifesto Mercante" |
| Blocos 1–6 | Specs concluídas e arquivadas em `docs/archive/specs/` após o encerramento do Épico #519 |

A spec funcional permanece nesta tabela enquanto seu plano não for concluído e
é movida para o [arquivo histórico](../archive/specs/) junto com ele.

A spec de múltiplos terminais foi concluída na PR #550 e está arquivada em
[`../archive/specs/`](../archive/specs/). O comportamento vigente foi promovido
para `CONTEXT.md` e `docs/ARCHITECTURE.md`.

A spec comportamental abaixo é permanente e não entra nesta tabela.

## Behavioral Specification

This directory holds the **single canonical, code-derived behavioral
specification** for Vela and the Fwlog Portal. It tracks every feature from
specification through verification in one spreadsheet.

This directory is the living source of truth. Dated CSV/XLSX pairs are editions:
the newest is canonical and lives here; superseded editions move to
[`../archive/specs/`](../archive/specs/) as historical snapshots.

## Canonical files

| File | Role |
|---|---|
| `<date>-behavioral-spec.csv` | **Source of truth** (edited directly, diffable, reviewable) |
| `<date>-behavioral-spec.xlsx` | View layer (filters + summary sheet), generated from the CSV |

Current edition: **`2026-08-12-behavioral-spec.{csv,xlsx}`**. The superseded
`2026-07-02` edition is in [`../archive/specs/`](../archive/specs/).

The CSV is edited by hand; the `.xlsx` is generated from it by
[`../../scripts/build-behavioral-spec.mjs`](../../scripts/build-behavioral-spec.mjs).
Regenerate the workbook after editing the CSV:

```bash
node scripts/build-behavioral-spec.mjs
```

Without an argument the script rebuilds the newest `*-behavioral-spec.csv` in
this directory; pass a path to target a specific edition.

## Scope

One row per feature across: all SPA routes, every `supabase.rpc(...)`, every
Edge Function under `supabase/functions/` (12 at `2026-08-12`), staff/portal
auth, and every RLS table boundary, plus security/financial triggers and jobs. Generic UI components and behaviourless
helpers are out of scope.

## Columns

`ID, Area, User Story, Expected Behavior (as implemented), Status, Defects,
Defect Type, Evidence, Source References, Open Questions / Notes`.

- **Status flow:** `Spec'd → Tested-Pass / Tested-Fail → Fixed → Verified`.
- **Evidence (strongest available):** `Vitest` (executed assertion) ›
  `SQL-contract` (`*Migration.test.ts`, detects SQL drift, not runtime) ›
  `Integration` (`src/integration/*`, not executed here) › `Static` (code read).

## Provenance

The `2026-07-02` edition was rebuilt from scratch against the executable
repository at that date: `src/App.tsx` (routes), the `supabase.rpc(...)` call
sites, `supabase/functions/`, the numbered migrations (`001`–`162`) and
[`../RASTREABILIDADE.md`](../RASTREABILIDADE.md), then driven through one QA loop
against the green Vitest suite.

The `2026-08-12` edition carries that work forward against the repository at
migrations `001`–`289`, 42 routes, 103 distinct `supabase.rpc(...)` call sites
and 12 Edge Functions, with the Vitest suite green (`npm test`). It is a
**differential** rebuild, not a from-scratch one: rows unaffected by the drift
carry their `2026-07-02` verification forward.

What changed relative to the previous edition:

- **36 rows added** for surfaces the old edition did not cover — the departure
  report RPCs (`ADR-RPC-01`–`08`), the Portal provisioning and authentication
  flow (`PORT-ROUTE-05`–`09`, `PORT-RPC-06`–`11`, `PORT-EDGE-03`–`10`), the
  `admin-users` Edge Function, depot registration, and the CE-master,
  omission-edit, granite-CE, receivables, invoice-due-date and exchange-rate
  RPCs.
- **3 rows removed** for behavior the code no longer has: the Mercante EDI (M5)
  generator (`MAN-ACT-02` — only CE Mercante *import* remains), the
  `/line-up-tv` redirect (`OPS-ROUTE-04`), and the `provision-portal-user` Edge
  Function (`PORT-EDGE-01`, superseded by the invite/activate flow).
- **8 rows repaired** where a module or test had been renamed or moved
  (`src/lib/uploadLimits.ts` → `src/lib/fileGuard.ts`, `manifestParser.ts` →
  `blParser.ts`, `LineUpTV` → `LineUpTVDisplay`, and five stale `Evidence`
  citations).

All 175 rows carry no open defect. 133 are `Verified` — backed by an executed
`Vitest` or `SQL-contract` assertion; the remaining 42 are `Verified (static)`,
confirmed by static code read where the feature has no executable surface in
this environment (SQL triggers, `pg_cron` jobs, Edge Functions, live-DB RLS).
The `Evidence` column preserves the strength of each verification, and every
file cited in `Evidence` and `Source References` was checked to exist at
`2026-08-12`. The `Open Questions / Notes` entries (`OPS-ROUTE-01`,
`VOY-ACC-02`, `MAN-ROUTE-09`, `BILL-RPC-12`) are design-intent confirmations or
coverage gaps in pre-existing code, not defects.
