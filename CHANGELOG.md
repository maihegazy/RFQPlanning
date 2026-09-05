# Changelog

All notable changes to the RFQ Planner web application. The project has no
versioned releases yet; entries are grouped by the phases of the September
2026 review (`docs/project-review-2026-09.md`), which this changelog closes.

## Unreleased — September 2026 review, phases 0–8

### Guardrails (phase 0)
- ruff, ESLint (flat config), Prettier; pinned backend requirements compiled
  with pip-compile; a schema-drift test; CI builds both Docker images.

### Correctness (phase 1)
- Downloads with non-Latin names no longer fail; shortening a timeline that
  still has data outside it is refused; a project's `updated_at` follows every
  change inside it; a 1990–2100 date window keeps typos out of the registers
  and rows the engine cannot count say why; SQLite enforces foreign keys;
  imports have append/replace modes and duplicate warnings; startup no longer
  silences logging; Excel exports never write formulas from text; NaN and
  absurd magnitudes are refused; money is stored to the cent; a uniform grid
  above 2.0 FTE becomes one variable period; clones keep the lost reason and
  the JSON export carries the hardware plan and the full money configuration.
- Frontend: stale-response guards when switching scenarios, a forgiving
  register save, readable validation errors, plan warnings, the import mode.

### Integrity and concurrency (phase 2)
- The vault passphrase can only be changed with proof of the current data
  key; the vault cannot be created twice. Projects and hardware projects carry
  a version; the financial blob, rate configuration, registers, adjustments
  and the whole-plan hardware save refuse stale writes with a 409 and the UI
  offers to reload. Registers and the plan are saved by upsert in one
  transaction, keeping row ids.

### Deployment (phase 3)
- Compose publishes only the web tier, reads credentials from `.env`, runs
  migrations once before the API starts and runs both containers
  unprivileged; nginx accepts the purchasing workbook (25 MB) and caches
  hashed assets; the API caps uploads, checks the database in `/api/health`,
  serialises concurrent migrations with an advisory lock, is same-origin by
  default and can require an authenticating proxy's header. CI smoke-tests
  the running stack.

### Performance (phase 4)
- The aggregate endpoints load their trees with `selectinload`: a bounded
  number of queries whatever the project count, asserted by tests.

### Product decisions (phase 5)
- Winning scenarios stand for their family in the RFQ Overview and the capacity
  heatmap; the hardware plan flows into the cost-profit analysis as a
  non-labor row with a pass-through switch (the "hardware" cost-item category
  is retired for new items); hardware projects expose their planning window;
  a new hardware project's budget is one overall figure by default; numbers
  follow the browser's locale.

### Frontend quality (phase 6)
- Shared register cells, tiles and FTE helper; forgiving number fields;
  styled confirm/prompt dialogs; an error boundary; accessible dialogs,
  labels, buttons and table headers; the "Saved" flash survives its reload;
  a deferred import resumes on any unlock.

### Tests (phase 7)
- The backend suite runs on SQLite and PostgreSQL in CI and covers the
  endpoints and importer paths the audit found untested; component tests
  (Testing Library on jsdom) for the registers, the import dialog, the
  hardware project page, the vault flows and the budget workbook; a
  Playwright smoke test against the deployed stack. The smoke test found and
  fixed a vanishing recovery-key step in the vault setup.

### Hygiene (phase 8)
- The RFQ Planning sidebar entry "Portfolio" is now "Overview" (the URL stays
  `/portfolio`).
- Timestamps leave the API with an explicit UTC offset; unknown ids inside a
  request body are validation errors (422); the management list's effective
  budget has its own field (`effective_budget`) next to the stored one;
  README refreshed; this changelog.

### Deliberately not done
- Money columns stay `Float` (`Numeric(14,2)` would need a data migration of
  every table; sums are rounded once and stored to the cent).
- The legacy plaintext money tables are kept (dropping them needs every
  project to have been migrated and purged first; the purge is idempotent).
