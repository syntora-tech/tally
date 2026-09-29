# CLAUDE.md — Tally

Internal back-office for Syntora.Tech: ledger, payroll, invoices, FOP acts, bench, trips, documents, MCP for agents.

**Source of truth: `docs/spec.md`.** Before working on a stage, re-read the relevant sections (always 1, 4, 5, 11, 13.1 plus the module's section). If the spec conflicts with habit, the spec wins. Anything missing → take the default from spec §12, or decide yourself and log it in `docs/assumptions.md` (date, question, decision, why). Never invent business rules — they live in spec §5.

## Hard rules

- **Money is never a float.** DB: `numeric(20,8)` amounts, `numeric(18,6)` rates, `numeric(20,2)` UAH totals. TS: `string` at the DB boundary, `decimal.js` for arithmetic (`@tally/domain/money`). No `Number(amount)`, `parseFloat`, `Math.round`, or `Intl.NumberFormat` on money. `supabase-js` is never used for financial data.
- **Dates without timezone traps.** Business dates are `LocalDate` (`YYYY-MM-DD`) from `@tally/domain`. Domain code never calls `Date.now()` / `new Date()` for "today" — it takes `today` as an argument. The app resolves today via `server/today.ts` (`APP_TODAY` is honoured outside production).
- **Invariants live in the DB** (triggers, constraints, RLS). Business calculations are pure functions in `packages/domain` with unit tests.
- **Service layer is the only mutation point.** Business operations live in `apps/web/server/services/*` as `(ctx, input) → Result` with a Zod input schema. Server Actions and MCP tools are thin adapters: parse → call service → map result. No logic in actions.
- **RLS is enforced from the server:** every user-context query goes through `withUser()` (`set local role authenticated` + JWT claims). Raw connection (`postgres` role) only in cron/job handlers and import, with `app.actor` set to `system:<job>`.
- **Everything with an effective date is versioned** (`valid_from`); manual changes to amounts are separate `adjustment` rows with a reason; issued documents are immutable.
- **Audit:** every business table gets the `audit_row_change()` trigger and `set_updated_at()`.

## Language

- UI text: Ukrainian. Dates `ДД.ММ.РРРР`, amounts with currency (`@tally/domain` formatters).
- Code, comments, identifiers, logs, error messages, commit messages: English.
- Comments only for non-obvious _why_.

## Repo & commands

```bash
pnpm install
pnpm db:start            # supabase start (Postgres :54322, API :54321, Studio :54323, Mailpit :54324)
pnpm db:reset            # migrations + seed from scratch
pnpm dev                 # http://localhost:3000
pnpm lint | pnpm typecheck | pnpm test
pnpm db:test             # pgTAP (supabase/tests)
pnpm e2e                 # Playwright (needs db:start)
pnpm db:generate         # drizzle-kit → supabase/migrations
pnpm db:migration <name> # empty SQL migration for triggers/functions/RLS
```

- Supabase CLI is a devDependency — use `pnpm supabase …`, not a global install.
- TypeScript: `tsc` is TS 7 (`@typescript/native`); the `typescript` package is aliased to `@typescript/typescript6` for typescript-eslint and Next.js (see assumptions A-001).
- Drizzle schema: `packages/db/src/schema`. Generated migrations go to `supabase/migrations`; triggers/functions/RLS are hand-written SQL migrations.

## Workflow

- Small Conventional Commits; every commit green (`pnpm check` + `pnpm db:test` when SQL changes).
- Stages from spec §11 strictly in order; the next starts only after the previous DoD.
- Never commit real xlsx or `.env*` (except `.env.example`). No push until a remote exists.
