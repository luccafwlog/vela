# AGENTS.md

Canonical instructions for work in Vela and Portal Fwlog. Keep shared agent
rules here; do not recreate a root `CLAUDE.md`. Tool setup belongs in
[WORKFLOW.md](WORKFLOW.md#claude-code-e-agentsmd).

## Start with the affected behavior

Vela is the internal operations application; Portal Fwlog is the customer
application. They share code and a Supabase backend, but have separate SPA
entries and authentication clients. A change in shared code can affect both.

Before editing, confirm the working directory, branch and existing diff.
Preserve unrelated work. Identify the requested outcome, the current behavior
and the smallest existing owner of the change. For a bug, establish a concrete
reproduction or failing check before changing the implementation when feasible.

## Read by task

Read the sections relevant to the change. A typo or isolated edit does not
require a repository map or the full documentation set. Before changing domain
behavior, authentication, security boundaries, billing, imports, routes, or
database schema, consult the corresponding source below.

| Task | Read first |
| --- | --- |
| Business rule or terminology | [CONTEXT.md](CONTEXT.md), then the affected module from [docs/README.md](docs/README.md) |
| Screen, route or user action | [RASTREABILIDADE.md](docs/RASTREABILIDADE.md), then the linked implementation and module |
| Shared code, imports or architecture | Relevant sections of [ARCHITECTURE.md](docs/ARCHITECTURE.md) and [ADR index](docs/adr/README.md) |
| Authentication, permissions or customer data | [Security](docs/operations/seguranca.md), affected policies/RPCs and session contracts in [WORKFLOW.md](WORKFLOW.md) |
| Schema, commands, environment, testing or deployment | Relevant procedure in [WORKFLOW.md](WORKFLOW.md); exact commands in [package.json](package.json) |
| Documentation, plans or specs | [Documentation index](docs/README.md) and [CONVENCOES.md](docs/CONVENCOES.md) |

Audits and archived plans/specs are historical snapshots. Live plans/specs
describe intended work, not proof that it has shipped. When documentation
differs from current behavior, inspect the executable repository, correct the
living document and preserve historical records. Executable behavior is
evidence of what exists, not proof that a bug is
intended: compare it with the requested outcome and applicable business rules.
Check an ADR's current status before treating its original decision as active.

## Change the existing owner

- Follow the affected path from screen to hook/service to RPC or table, and
  back through cache invalidation to the visible result. Inspect callers and
  tests before changing a shared contract.
- Keep page composition and visual state in `src/pages/`, reusable remote
  state in `src/hooks/`, and data access, parsers and domain operations in
  `src/services/`. Reuse the smallest existing owner; do not reorganize a
  whole page just to make a local correction.
- Reuse query families in `src/services/queryKeys.ts` and applicable domain
  effects in `src/services/cacheEffects.ts`. A successful write is incomplete
  if the affected screens continue displaying stale data.
- For spreadsheet imports, check `src/services/importCore.ts` before adding
  another reader or header matcher. For shared error handling, check
  `src/lib/errors.ts` and its Portal adapter.
- Preserve the separate internal and Portal clients in
  `src/services/supabase.ts`. Route guards are navigation controls; enforce
  authorization and customer scope in database policies, grants and RPCs.
  A hidden button does not secure a mutation.
- Fix a shared bug at its owner after checking callers, not with one guard
  per call site. Keep unrelated refactors out of the requested change.
- Mark intentional simplifications with a `ponytail:` comment. Name any known
  ceiling (global lock, O(n²) scan, naive heuristic) and the upgrade path.
- Non-trivial logic must leave a meaningful runnable check: a small regression
  test using the existing harness, or an assert-based demo where appropriate.
  Verify behavior, not a restatement of the implementation. Do not introduce
  a test framework or fixture scaffolding just for that check. Trivial
  one-liners and prose-only changes need no new test.

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
- Hooks in `.claude/hooks/` provide additional checks. These protections apply
  even when the current agent or editor does not run those hooks. Inspect
  commands before running them; `npm run sync:hard` resets and cleans the
  checkout and is not a routine synchronization command.
- **Data status — reaffirmed 2026-09-22, revocable by the repository owner.**
  The owner confirms Vela/Portal still have no real users and the production
  Supabase project carries no real business data: every row is a test fixture
  and may be discarded. A migration may therefore rewrite or delete
  existing rows without a preservation plan. This is the ONLY thing that makes
  such a migration acceptable, so any migration that rewrites or deletes
  existing rows must say in its header comment that it relies on this line.
  `npm run migrations:check` enforces that declaration in CI, so the question
  "is this still true?" surfaces when such a migration is written, not only
  when someone remembers this bullet.
  When the system takes real data, replace this bullet with the opposite
  assertion in the same change that opens it to real users — until then a
  reviewer may assume the data is disposable, and after then they must not.

## Verify the claim you will make

Choose checks by impact using [WORKFLOW.md](WORKFLOW.md) §11:

| Change | Required local evidence |
| --- | --- |
| Markdown or agent instructions only | `npm run docs:check` and `git diff --check`; inspect the meaning and referenced paths too |
| Application or configuration affecting its contracts | `npm run docs:check`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` |
| Schema or RPC contract | Above gates as applicable, plus `npm run migrations:check` and `npm run rpc:check`; follow the database validation procedure |
| Skill scripts | Documentation checks plus verification of the changed scripts |

Use focused checks during implementation. Keep successful results for unchanged
code and environment; rerun affected checks after fixes or new evidence, not
for each status message. Mandatory CI checks still apply.

Do not treat all tests as production-isolated: Supabase integration tests
require an explicitly controlled environment (see `WORKFLOW.md` §11).

Distinguish static code inspection, automated tests and observed runtime.
A SQL text assertion verifies a SQL contract, not execution or RLS behavior.
A green build does not establish a working user flow; a local migration file
does not establish deployment. Report the environment and evidence actually
used, and name what remains unverified. See evidence labels in
[CONVENCOES.md](docs/CONVENCOES.md).

## Deliver and stop at the agreed boundary

Before delivery, review the final diff for unintended changes, update affected
living docs and verify the requested outcome against the evidence. Explain the
visible or operational effect first, then relevant technical details, checks
and remaining limitations. Use the system's vocabulary and the user's language;
follow [the communication contract](docs/agents/linguagem-do-sistema.md).

Do not claim a task is complete while required work remains. If blocked, state
the concrete blocker and what was completed; do not present a workaround or
unverified configuration as a proven result.

After creating a pull request, monitor it ONLY until CI finishes for the pushed
commit: stay subscribed, fix CI failures and push, and once every check
completes green, report the green status, unsubscribe, and stop. Do NOT keep
watching until merge, and do NOT schedule recurring check-ins
(send_later/hourly polling) — that burns credits silently. Full babysitting
until merge is allowed only when the user explicitly asks to monitor, watch,
babysit, or autofix the PR.
