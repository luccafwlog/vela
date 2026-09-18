# CLAUDE.md

## Sources of truth

Read the sections relevant to the change. A typo or isolated edit does not
require a repository map or the full documentation set. Before changing domain
behavior, authentication, security boundaries, billing, imports, routes, or
database schema, consult the corresponding source below.

- `CONTEXT.md` — terminology and business rules for the affected domain.
- `docs/ARCHITECTURE.md` — affected layers, contracts and routes.
- `docs/RASTREABILIDADE.md` — traces every route/action to components, hooks,
  services, RPCs, and tests.
- `docs/adr/README.md` — indexes accepted and superseded decisions.
- `WORKFLOW.md` — development, migrations, testing, and deploy.
- `docs/CONVENCOES.md` — documentation style, evidence labels, and module
  structure.

Dated audits, specs, and plans are historical snapshots, not current truth. When
a historical document differs from current behavior, the executable repository
is authoritative: correct the living document and preserve the historical
record.

## Task scope and completion

Carry an implementation request through the requested changes, relevant
validation, fixes caused by the change, and living documentation updates.
A first draft or a plan is not completion when implementation was requested.
Ask when a missing business decision or authorization actually blocks progress;
continue independent work and resolve routine local choices directly.

Use skills when their specific workflow helps the task or the user names one.
Read only relevant supporting references; overlapping skills are alternatives,
not a mandatory chain. Repository skills live in `skills/`; their maintenance
and installation are described in `skills/README.md`.

Local edits and checks needed for the request can proceed without repeated
approval. This does not authorize production mutations, sending messages,
publishing, or bypassing the protections below. Honor any authorization already
given for the specific action and environment.

## Conventions

- Mark intentional simplifications with a `ponytail:` comment. If the shortcut
  has a known ceiling (global lock, O(n²) scan, naive heuristic), the comment
  names the ceiling and the upgrade path.
- Non-trivial logic leaves ONE runnable check behind (an assert-based demo or
  one small test; no frameworks, no fixtures). Trivial one-liners need no test.
- Fix a bug at the shared function after checking its callers, not one guard
  per call site.

## Documentation contract

Update living documentation in the same change when modifying routes, commands,
environment variables, migrations, auth contracts, operational procedures, or
architectural decisions. Preserve historical records; use a new ADR or an
editorial note for later decisions. Read `docs/README.md` before broad
documentation or architecture changes.

Plan/spec lifecycle (full rule in `docs/CONVENCOES.md`, "Ciclo de vida de
planos e specs"):

- Live plans go in `docs/plans/`; live specs go in `docs/spec/`. These are the
  ONLY locations — never create plans or specs under any other path.
- When a plan finishes executing, move it to `docs/archive/plans/` in the SAME
  change that completes the work, and remove its row from
  `docs/plans/README.md`. If the spec that produced it is in `docs/spec/`, move
  it to `docs/archive/specs/` too.
- Dated audits, reviews, and execution reports are born historical: write them
  directly to `docs/archive/audits/` or `docs/archive/reports/`.

## Gotchas

- `src/types/database.ts`, `src/lib/pix.ts`, and existing migration files are
  protected by `.claude/hooks/protect-files.sh`; do not bypass the guard
  without explicit authorization.
- Never execute the suspended reset script
  (`supabase/scripts/reset_operational_data.sql`); see
  `docs/operations/reset-ambiente.md` for the safe alternative.
- Project playbooks live in `skills/`. Hooks in `.claude/hooks/` also guard
  destructive commands and lint edited TypeScript.
- **Data status — asserted 2026-09-18, revocable by the repository owner.** The
  production Supabase project carries no real business data: every row is test
  fixture and may be discarded. A migration may therefore rewrite or delete
  existing rows without a preservation plan. This is the ONLY thing that makes
  such a migration acceptable, so any migration that rewrites or deletes
  existing rows must say in its header comment that it relies on this line.
  `npm run migrations:check` enforces that declaration in CI, so the question
  "is this still true?" surfaces when such a migration is written, not only
  when someone remembers this bullet.
  When the system takes real data, replace this bullet with the opposite
  assertion in the same change that opens it to real users — until then a
  reviewer may assume the data is disposable, and after then they must not.

## Verification

Choose checks by impact using `WORKFLOW.md` §11. Markdown-only changes need
`npm run docs:check` and `git diff --check`; application changes need the
relevant lint, tests and build gates. Keep successful results for unchanged
code; rerun affected checks after fixes or new evidence, not for each status
message. Report what ran and any unverified behavior.

Do not treat all tests as production-isolated: Supabase integration tests
require an explicitly controlled environment (see `WORKFLOW.md` §11).

After creating a pull request, monitor it ONLY until CI finishes for the pushed
commit: stay subscribed, fix CI failures and push, and once every check
completes green, report the green status, unsubscribe, and stop. Do NOT keep
watching until merge, and do NOT schedule recurring check-ins
(send_later/hourly polling) — that burns credits silently. Full babysitting
until merge is allowed only when the user explicitly asks to monitor, watch,
babysit, or autofix the PR.
