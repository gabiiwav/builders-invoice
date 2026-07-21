# Architecture

Builders Invoice is a Vite multi-page application deployed with Vercel serverless APIs.

## Runtime boundaries

- `index.html` is the public landing page.
- `app.html` contains the application markup.
- `src/styles/app.css` contains application presentation and print styles.
- `public/legacy-app.js` retains the global browser controller required by existing inline handlers while feature logic moves into modules.
- `src/` contains testable domain logic, data repositories, monitoring, and shared utilities.
- `api/` contains Vercel serverless endpoints. Protected endpoints verify the Supabase bearer token and derive identity server-side.
- `lib/` contains server-only helpers.
- `supabase/migrations/` is the source of truth for database policies, functions, triggers, and schema evolution.

## Module ownership

- `src/domain/` owns calculations and domain rules without browser dependencies.
- `src/data/` owns database operations and transactional RPC calls.
- `src/shared/` owns money and validation primitives.
- `src/monitoring.js` owns optional Sentry reporting.

The existing global UI functions are bridged to `window.BuildersCore`. New business logic belongs in `src/`; `public/legacy-app.js` is a compatibility controller, not the destination for new domain logic.

## Design rules

1. UI code does not decide payment amounts, subscription identity, or ownership.
2. Money crosses persistence and payment boundaries as integer cents.
3. Multi-table document writes use one PostgreSQL function and transaction.
4. RLS remains enabled on every browser-accessible table.
5. Domain calculations should be pure and covered by unit tests.
6. Database changes must be committed as migrations.
