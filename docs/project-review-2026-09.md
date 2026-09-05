# RFQ Planner — Project Review and Phased Plan (September 2026)

Branch: `claude/project-review-planning-19mpih` · Reviewed commit: `06d111b` (main after PR #19)

This document is a review only. Nothing in the codebase was changed. Every defect
listed under "Findings" was reproduced against the current code (scratch scripts,
the existing test suites, or a direct read of the code path); each entry says how.

## 1. Context recovered from the previous session

The earlier session ("Modern web application modernization", 12 Aug – 4 Sep 2026)
drove the whole modernization of the desktop RFQ Planner into this web app. Its
transcript is not retrievable, but the git history and the merged pull requests
reconstruct it:

| Period | Work | Merged as |
| --- | --- | --- |
| 12–13 Aug | Full-stack rewrite (FastAPI + React), templates, planning grid | PRs #1–#3 |
| 17 Aug | Client-side encryption of all financial data, lifecycle/scenarios/portfolio, rate escalation and non-labor cost items, save-as-template, ticket-quota validation, terminology rename | PRs #4–#7 |
| 17–18 Aug | A separate six-phase audit series on `agent/phase-*` branches: CI + regression safety net, frontend state fixes, backend validation, legacy-import validation, Alembic migrations | PRs #8–#14 |
| 18–21 Aug | Hardware planning module, seeded catalog, catalog UI, vault passphrase change, home-page rework, automatic plan generation | PRs #15–#18 |
| 4 Sep | Portal shell with light/dark theme, and the Hardware Management module (registers, depreciation, budget modes, Excel in/out, ordering process) | PR #19 |

Two facts from that history shape this plan:

- **Phase 6 of the audit series ("deployment security") was never executed.** The
  branch `agent/phase-6-deployment-security` exists but carries no commits beyond
  phase 5. Its executable specification survives as the two strict `xfail` tests in
  `backend/tests/test_known_regressions.py` (CORS defaults to `*`; Compose publishes
  the unauthenticated backend port).
- The session ended with **180 green tests** (73 backend, 107 frontend). That is
  still true today; the suites, type-check and production build all pass on this
  checkout.

## 2. What was reviewed and how

- Every source file was read: 27 k lines across `backend/` (app, migrations, tests)
  and `frontend/src/` (pages, tabs, components, money engine, crypto/vault,
  hardware engines, tests), plus Docker, nginx, CI and the README.
- Executed: `pytest` (73 passed, 1 skipped, 2 xfailed), `vitest` (107 passed),
  `tsc -b`, `vite build`, `ruff`, `pip-audit`, `npm audit`, an Alembic
  model-vs-migration drift check on both the fresh-database path and the
  hand-written DDL path (0 differences on each), and nine scratch probes for
  suspected behavior bugs (results quoted inline below).
- Two independent second-pass reviewers were run on the frontend state flows and on
  the backend (importer, depreciation engine, routers, migrations); their findings
  were re-verified before being merged into section 4. The backend pass also stood
  up a throwaway PostgreSQL 16 to reproduce the startup race and the `int4`
  overflow, and upgraded a database built from the first release's schema on both
  engines (clean, zero drift).

## 3. Overall assessment

**The foundation is good.** The domain logic is careful and unusually well
documented in code: the money engine is oracle-tested against 30 randomized runs of
the original desktop implementation, the depreciation engine reproduces golden cells
from the customer's workbook on both sides of the wire with a parity test, the Excel
importer tolerates the real file's quirks, migrations are versioned and drift-free,
and the end-to-end encryption design is sound (PBKDF2-SHA256 at 600 k iterations
wrapping a random AES-256-GCM key, fresh IV per write, recovery key path, key
re-wrap on passphrase change without re-encrypting data).

**The gaps cluster in four themes**, and the plan is organised around them:

1. **Edge-case correctness** — a handful of real bugs that will surface in daily use
   (non-ASCII project names break every Excel export; shrinking a timeline leaves
   invisible stale data; an early-year typo blanks the hardware summary).
2. **Integrity under concurrent use** — the app is multi-user by nature but has no
   concurrency control, several multi-request "saves" that are not atomic, and one
   endpoint that lets any caller lock everyone out of the financial vault's
   passphrase path.
3. **Deployment readiness** — the README says "production-ready", but the
   deployment security phase never happened: permissive CORS, published backend
   port, hard-coded credentials, a 1 MB upload ceiling in nginx that blocks the
   Excel import, unpinned dependencies, no lint step, and a startup step that
   switches off all logging so none of the above would ever be seen.
4. **Maintainability** — the Hardware Management module (about 9 k lines added in
   one PR) duplicates helpers between its two register tables, the backend suite is
   order-dependent, and the HW management UI has no component tests. The older RFQ
   pages, meanwhile, predate the request-sequencing and reset-on-change patterns the
   newer pages use, which is where most of the frontend state bugs sit.

None of this is structural. Every item below is a bounded change; the biggest single
phase is about two to three days of work.

## 4. Findings

Severity: **High** = crashes, data loss, or blocks a core workflow in production.
**Medium** = wrong figures or labels, integrity risk, or breaks in plausible
situations. **Low** = quality, hygiene, cosmetics. "Phase" points at section 5.

### High

**F-01 · Every Excel download fails for project names outside latin-1 and corrupts for umlauts and quotes.** `Content-Disposition` is built by string formatting in
`backend/app/routers/reports.py:50`, `routers/hardware.py:308` and
`routers/hw_management.py:438`. Starlette encodes headers as latin-1, so a name with
an en dash ("Projekt – 2026"), a euro sign or Arabic letters raises
`UnicodeEncodeError` and the request returns 500; "Zoë" is sent as raw latin-1 bytes
that browsers display as a mangled filename; `Quote "A"` produces a malformed header.
Reproduced with a scratch client against all three endpoints. Fix: one shared helper
that emits an ASCII fallback plus `filename*=UTF-8''…` (RFC 5987), with a regression
test for each case. → Phase 1

**F-02 · The Docker deployment caps uploads at 1 MB, which blocks the Excel import.** `frontend/nginx.conf` sets no `client_max_body_size`, so nginx's default of
1 MB applies to `/api/`. The purchasing working document the importer was written
for (hundreds of rows, formatting, pasted images) is larger than that; nginx answers
413 before the API sees the file. Fix: `client_max_body_size` on the `/api/`
location, together with a server-side cap (F-13). → Phase 3

**F-03 · Anyone who can reach the API can lock everyone out of the vault's passphrase path.** `PUT /api/vault/passphrase` (`routers/vault.py:43`) replaces the
passphrase-wrapped key with whatever it is sent and asks for no proof of the current
passphrase; a blind call with garbage returned 200 in the probe, after which no
passphrase unlocks (only the recovery file does). `POST /api/vault` (`routers/vault.py:32`) also has a
check-then-insert race and no uniqueness guard, so two first-time users can create
two vault rows and one of them silently encrypts data under a key the app will never
load again. This is a denial-of-service and data-loss risk, not a confidentiality
break (the server never holds a usable key). Fix: require the current wrapped key
(and IV) in the request and compare before replacing; enforce a single vault row at
the database level and return 409 on conflict. → Phase 2

**F-29 · Export → import silently drops rate escalation and every non-labor cost item.** `pages/ProjectsPage.tsx:280-286` writes only the four legacy money keys
(hourly rates, cost rates, hardware cost per hour, ticket prices) into the JSON;
`importProject` (`ProjectsPage.tsx:192-206`) rebuilds the blob from an empty
configuration plus those keys. Escalation resets to 0 and all cost items vanish, so
Reports, Scenarios and Portfolio figures differ from the original after a
backup-and-restore, with no warning. Fix: export the full versioned `MoneyConfig`
under its own key next to the legacy keys, import it when present, and add a
round-trip test. The export also omits the hardware plan (F-47). → Phase 1

**F-37 · Starting the app switches off every log.** `alembic/env.py:13-14` calls
`logging.config.fileConfig(alembic.ini)` with the default
`disable_existing_loggers=True`, and `run_migrations` runs it inside the FastAPI
lifespan, after uvicorn has created its loggers. Reproduced: after startup
`uvicorn`, `uvicorn.error`, `uvicorn.access` and every application logger have
`disabled = True`, and the root level is forced to WARNING by `alembic.ini:15-16`.
A real `uvicorn app.main:app` prints "Waiting for application startup." and then
nothing: no access lines, and a request that fails with 500 produces no traceback.
Production is blind to every error. Fix: do not reconfigure logging when a
connection is supplied to Alembic (or pass `disable_existing_loggers=False`) and
leave uvicorn's log configuration alone. → Phase 1

**F-38 · A number typed into a date column is read as an Excel serial date, silently corrupting the whole project view.** `_parse_date` (`services/hw_excel.py:694-695`)
maps any number from 1 to 2958465 to a date, so a year typed as `2026` in
"Purchase Date" becomes `1905-07-18` with no warning (reproduced; serials below 61
are also off by one day). Combined with F-06 the summary then spans 1905–1944 and
every real row shows zero. Fix: accept serials only inside a sane window and warn
otherwise, using the same window guard as F-06. → Phase 1

### Medium

**F-04 · Shortening a project's timeline leaves stale data that the app then reports inconsistently.** Reproduced: a project 2026–2027 with an allocation period in
2027 and a one-time hardware purchase in 2027, then `PUT` `end_year=2026` → 200;
`/validate` says valid; `/hardware` reports `per_year: {"2027": 1000}` for a project
that no longer has a 2027, and the hardware workbook would omit that cost from the
year columns while keeping it in the Total column. The role validators reject
out-of-timeline periods on create/update, but `update_project`
(`routers/projects.py:73`) and `calculations.validate_project`
(`services/calculations.py:135`) never look at them.
Fix: validate on timeline change (reject with the list of offending rows, or clamp
after confirmation in the UI), add the timeline check to `validate_project`, and
restrict hardware year costs to project years. → Phase 1

**F-05 · "Recently updated" and "Updated 3 days ago" are wrong.** `Project.updated_at` only moves when a project's own columns change; adding a
feature, role, allocation, hardware item, rate or financial blob leaves it untouched
(reproduced: unchanged after adding a feature and a role). The projects home sorts and
labels by it, and `ResourcesTab.tsx:72` uses it as the React `key` that resets the
planning grid. Fix: touch the parent on every child write. → Phase 1

**F-06 · One mistyped year hides every real year in a hardware register.** `hw_depreciation.year_span` (`services/hw_depreciation.py:138`, mirrored at
`frontend/src/hardware/depreciation.ts:169`) starts the 40-year span at the earliest date it finds. A purchase date typed as
`0225-07-02` yields years 225–264 and the real 2025–2028 rows show zero everywhere
(reproduced). The cap protects against a late typo but not an early one, and F-38
shows the importer manufactures exactly such a year from a bare `2026`. Fix: anchor
the span on the current and project years, clamp dates to a sane window, and warn on
out-of-window dates in the grid and the importer. → Phase 1

**F-07 · SQLite does not enforce foreign keys, so development behaves differently from production and the code carries workarounds.** No `PRAGMA foreign_keys=ON` is
set (`app/database.py:16`). Reproduced on SQLite: deleting a base project leaves its
scenarios reachable as orphans; deleting a catalog item leaves `catalog_item_id: 77`
on a hardware-management asset (the planning module guards against this in
`serialize_item`, the management module does not). On PostgreSQL the cascades work,
so the tests cannot catch this class of bug. Fix: enable the pragma per connection
and delete the workarounds. → Phase 1

**F-08 · Importing the same workbook twice duplicates the whole register.** The import always appends (`routers/hw_management.py:388`); the probe imported one
file twice and got two "Twice" assets. The dialog text says nothing is overwritten,
but a purchasing manager re-importing a corrected file will do exactly this. Fix: an
import mode (append / replace register) and a duplicate warning keyed on the sheet
ID column. → Phase 1

**F-09 · Two hardware-planning "saves" are sequences of independent requests.** `HardwareTab.save` (`tabs/HardwareTab.tsx:162`) issues one DELETE/POST/PUT per
changed row, and Generate Plan in replace mode deletes every existing row one by one
before creating the new ones (`components/HardwareWizardModal.tsx:130`). A failure midway leaves a half-deleted
plan with no rollback. The management registers already have a single bulk `PUT`;
planning should too. → Phase 2

**F-10 · Last write wins everywhere, silently.** The financial blob, the non-monetary rate config, both hardware registers and the special-case adjustments are
replaced wholesale with no version check, so two people editing the same project
overwrite each other without a warning. The register bulk `PUT` also recreates every
row on each save, so row ids and `created_at` churn (a later audit trail is
impossible). Fix: an `updated_at`/version precondition returning 409, and upsert by
id in the register `PUT`. → Phase 2

**F-11 · The Portfolio and the capacity heatmap ignore the winning scenario.** Both aggregate only base projects (`routers/portfolio.py:26`, `pages/PortfolioPage.tsx`),
so promoting an offshore-heavy scenario as the winner changes nothing in pipeline
value, weighted revenue or FTE demand. Needs a product decision (see section 6).
→ Phase 5

**F-12 · Hardware cost has two homes that do not meet.** Non-labor cost items
(category "hardware", encrypted, feeding cost-profit) and the plaintext hardware plan
(explicitly not feeding cost-profit, per README) both exist. Users can double-count
or wonder why the plan total never appears in the budget. Needs a product decision.
→ Phase 5

**F-13 · The import endpoint has no size limit and the XML-bomb guard is not installed in the image.** `import_hw_workbook` reads the whole upload into memory;
openpyxl only defends against quadratic-blowup XML when `defusedxml` is present,
which it is here by accident (a tool's transitive dependency) and would not be in the
Docker image built from `requirements.txt`. Fix: cap the upload, declare
`defusedxml`. → Phase 3

**F-14 · The deployment security phase never happened.** Defaults are `CORS_ORIGINS=*`, Compose publishes port 8000 of an unauthenticated API to the host,
database credentials are literal in `docker-compose.yml`, the backend container runs
as root, migrations run inside every process at startup and race (reproduced by the
second pass: three fresh workers against PostgreSQL 16 left two crashed on a
duplicate-key error while creating tables, and with F-37 the crash is not even
logged), and `/api/health` never touches the database. The README's "no
authentication, designed to run behind an existing system" is fine as a stance, but
it needs to be a documented, enforced deployment contract. → Phase 3

**F-15 · `HwProject.start_year`/`end_year` cannot be set.** The columns exist
(`models.py:287`) and the summary honours them, but no schema exposes them and no UI
offers them; the README documents behavior that is unreachable. Expose or drop.
→ Phase 5

**F-16 · N+1 queries on the aggregate endpoints.** `/api/portfolio/capacity`
lazy-loads features, roles and allocations per project per month;
`/api/hw/overview` and `/api/hw/projects` lazy-load assets, licenses and adjustments
per project and summarise each project twice; the hardware plan loads
`catalog_item` per row. Fine at ten projects, noticeable at a hundred. Fix:
`selectinload` on the aggregate queries. → Phase 4

**F-17 · Dependency hygiene.** Backend requirements are lower bounds only, so
Docker builds are not reproducible; `pydantic-settings` is declared but unused;
`PyYAML` is used by the tests but undeclared (it arrives via `uvicorn[standard]`).
`npm audit`: `react-router-dom` has a moderate advisory with a non-breaking fix
available; `exceljs` pins an old `uuid` with a moderate advisory in a code path
exceljs does not use (accept and document, or replace exceljs). `pip-audit` is clean.
→ Phase 0

**F-18 · No lint or format tooling anywhere, and CI runs none.** `ruff` on the
backend reports seven real issues today (an unused import in `alembic/env.py`, three
`zip()` calls without `strict`, two `raise` without `from` inside `except`, one
ambiguous variable name); the frontend has no ESLint or Prettier configuration.
→ Phase 0

**F-19 · Test hygiene and coverage gaps.** The backend suite shares one SQLite
database across all modules and is order-dependent: `test_portfolio_capacity`
asserts an exact BCC sum built from projects that other tests happened to create.
There are no end-to-end tests, the vault flows are untested, and the Hardware
Management UI (`HwProjectPage`, `HardwareOverviewPage`, both register tables, the
import dialog: about 4 k lines) has no component tests at all; only its engines do.
Also untested: `crypto.ts`, `api.ts` error mapping, `excelBudget.ts` (the workbook
is never asserted), `ResourceGrid` save/reset, and the export → import round trip.
On the backend, nothing calls `PUT`/`DELETE /api/features/{id}` or
`PUT`/`DELETE /api/roles/{id}` (which is why F-42 survives), the legacy-money
`has_data` branch, or the importer's merged-cell, banner-row, bool-word,
serial-date and negative-number paths; `conftest.py:8` hard-codes SQLite and one
test reads the SQLite file directly, so the suite cannot be pointed at PostgreSQL,
which is why F-40's `int4` overflow and F-14's startup race are invisible to CI.
→ Phase 7

**F-30 · Switching scenarios can show, and save, the previous scenario's budget configuration.** `tabs/BudgetTab.tsx:20-22` re-fetches when the project changes but
never clears `rates` or the decrypted `money`, and has no stale-response guard.
While the new scenario's rates are loading, or indefinitely after that request fails
(the form only hides itself when nothing was ever loaded), scenario A's SP-to-hours,
risk factor, story points and quotas are shown under B's heading with Save enabled;
a vitest experiment observed `updateRates(B, A's values)`. `ReportsTab`,
`CompareTab`, `PortfolioPage`, `ProjectPage` and `HardwareTab` share the
missing-guard pattern; the Hardware Management pages already do this right with a
sequence counter. Fix: reset state on project change and drop out-of-order
responses, the way `HwProjectPage.tsx:837-881` does. → Phase 1

**F-31 · The planning grid's Save button stays stuck on "Saving…" after the first successful save.** `components/ResourceGrid.tsx:238-254` never clears its busy flag
on success; it relies on being remounted through `key={project.updated_at}` in
`ResourcesTab.tsx:72`, and F-05 means that key never changes. After one save the
button is disabled for good, even after further edits; users must toggle List/Grid
to save again. Fix together with F-05, and clear the flag. → Phase 1

**F-32 · A blank register row makes the whole bulk save fail with raw validation JSON.** `pages/HwProjectPage.tsx:1285` and `:1309` append a row with an empty name; the
API requires one (`schemas.py:618`, `:647`), so `PUT …/assets` answers 422, the
banner shows the pydantic error array verbatim, and every other edit in the register
is blocked until the blank row is named or removed. The planning tab and the catalog
form already guard this. Fix: skip or flag unnamed rows client-side, and render 422
details as readable messages. → Phase 1

**F-33 · Vault setup can lose the one-time recovery key.** `vault/VaultContext.tsx:66-79` creates the vault, then issues a second GET to refresh
state; if that GET fails the wizard shows an error and never reaches the
recovery-file step, so the key that only ever lived in memory is gone while the vault
already exists on the server (a retry gets 409). `POST /api/vault` already returns
the full record, so the second request is unnecessary. Fix: use the POST response
and keep the recovery download reachable until it has been saved. → Phase 2

**F-39 · Formula injection in three generated workbooks.** `services/excel_export.py:38,50` and `routers/hardware.py:265-286` use xlsxwriter's
generic `write()`, and `hw_excel.py:347` uses `merge_range()`; each turns a string
that starts with `=` into a live formula. Reproduced: a feature named `=1+1` becomes
a formula cell in the resource plan, and a hardware item or HW project field can
carry `=HYPERLINK(...)` or a DDE-style payload into the recipient's Excel. The
register cells in `hw_excel.py` already use `write_string`. Fix:
`strings_to_formulas: False` on every workbook, plus `write_string` where the type
is known. → Phase 1

**F-40 · Non-finite and out-of-range numbers pass validation and end as 500s or `null` money.** `_parse_number` accepts `nan`, `inf` and `1e30` through `float()`
(reproduced). A `nan` cell makes the import endpoint raise outside its error handler
(500 on dry run and commit alike); `inf` passes `ge=0`, is stored, comes back as
`null` in every money field, and makes the workbook export fail because xlsxwriter
refuses NaN and INF; a quantity of `1e30` overflows `int()`. Raw JSON `Infinity` on
the register endpoints behaves the same. Separately, `quantity`, `qty` and the
ticket-quota year are unbounded integers: `3000000000` is stored on SQLite but fails
on PostgreSQL's `int4` with a 500, and a bulk register `PUT` carrying one such row
fails as a whole. The suite is SQLite-only, so none of this is caught. Fix:
`allow_inf_nan=False` and upper bounds on the schemas, a rejecting branch in
`_parse_number`, and the import preview built inside the error handler. → Phase 1

**F-41 · Register rows that silently count as zero spend.** A `Purchase` without a
purchase date, a `Leasing` without an end date or with an end date before the
purchase, a `Planned Purchase` without a date, and any misspelt type ("Purchse")
all contribute 0 to every year and to committed spend. Reproduced: 10,000 € of such
rows leave "remaining" at the full budget. The grid shows a dash and nothing else
warns; `purchase_type` and `depreciation` are free text. Fix: row-level
"not counted because…" flags in the registers, a count in the summary and dashboard,
and a warning for a type outside the vocabulary. → Phase 1

**F-42 · Fixed-FTE roles keep whatever allocations they are sent, and a project's own export can then fail to re-import.** `RoleCreate` stops validating allocations
for fixed roles (`schemas.py:77-84`), `create_role` and `update_role` persist them
anyway, `export_project` emits them, and the importer validates every period against
the timeline. Reproduced: a fixed role created with a 2019 period → 201, `/validate`
says valid, export → import 422. The same trap follows from F-04 after a timeline
shrink. Fix: ignore or reject allocations for fixed roles; export only what the
import accepts. → Phase 1

### Low

**F-20 · Duplication in the frontend.** `BLANK_ASSET`/`BLANK_LICENSE`,
`dateInputValue`, `withCurrent`, `CostCell`, `PlannedPill`, `TextField`, `round2` are
copied between `HwAssetTable.tsx` and `HwLicenseTable.tsx` (and partly into
`HwProjectPage.tsx`); `KpiTile` and `Stat` exist twice; `roleFtesForMonth` is
implemented three times (money engine, `ResourceGrid`, `autoPlan`);
`HOURS_PER_FTE_PER_MONTH` is hard-coded in the engine although `/api/meta` serves
it. Roughly 300 lines. → Phase 6

**F-21 · UX papercuts.** The catalog picker in `tabs/HardwareTab.tsx:252-253` renders
the "+ Add from catalog…" placeholder twice (visible today). Numeric inputs
everywhere store `Number(e.target.value)`, so clearing a field snaps it to 0 and
typing a new value is fiddly. Deletes and scenario naming use `window.confirm` and
`window.prompt` while every other dialog is a styled modal. The account button in
the top bar does nothing. The vault setup wizard's ✕ silently does nothing before the
recovery file is downloaded. `ReportsTab.tsx:76` nests a `<button>` inside
`<a download>`.
Numbers are formatted en-US ("1,234.56 €") for a German-speaking organisation while
the importer accepts German decimals. → Phase 6 (locale: Phase 5)

**F-22 · Default budget mode differs between UI and API.** The new hardware
project dialog starts on "One overall budget" (`components/HwBudgetFields.tsx:63`); the
API and migration default to `split`. Harmless today, confusing later. → Phase 5

**F-23 · README drift.** The project-structure tree predates `alembic/`, `scripts/`,
`hardware/`, `vault/`, `theme/`, `money/` and the HW pages; it documents the
unreachable start/end-year behavior (F-15); it calls the app production-ready
(F-14). `.gitignore` contains a stray `frontend/undefined/`. → Phase 8

**F-24 · Naive UTC timestamps and a deprecated API.** `datetime.utcnow` (13 uses;
deprecated since Python 3.12) produces naive timestamps that the frontend fixes up by
appending `Z` heuristically. → Phase 8

**F-25 · Money is stored as `Float`.** Sums are rounded once on output, so figures
are correct today, but `Numeric(14,2)` is the durable choice. Optional. → Phase 8

**F-26 · "Upcoming renewals (next 90 days)" also lists licenses expired years ago.** `expiring_licenses` (`services/hw_depreciation.py:185`) has no lower bound; the
Excel dashboard section title is therefore wrong for long-expired rows. → Phase 1

**F-27 · No React error boundary.** A render error anywhere blanks the whole
portal with no message. → Phase 6

**F-28 · Python version drift.** CI and the Dockerfile use 3.12; nothing pins it
for local development (this review ran on 3.11 without issue). → Phase 0

**F-34 · Accessibility of the shared primitives.** `Modal` in
`components/ui.tsx:101-124` has no dialog role, initial focus, focus trap, Escape
handling or focus restore; `Label` renders no `htmlFor`, and the RFQ-side inputs
(BudgetTab, InfoTab, RoleModal) carry no `aria-label`, so screen readers announce
unnamed fields. Icon-only buttons without names in `CostItemsEditor.tsx:131`,
`RoleModal.tsx:230` and `ResourcesTab.tsx:97,139`; sortable headers in
`HardwareCatalogManager.tsx:247-266` are clickable `<th>` cells with no button;
`CompareTab` row headers are `<td>`; the `ResourceGrid` header has no `scope`.
The Hardware Management pages already do all of this properly. → Phase 6

**F-35 · Deselecting every status pill in Portfolio shows all projects in the heatmap.** `pages/PortfolioPage.tsx:36-39` calls `getPortfolioCapacity([])`,
`api.ts:132-135` omits the query string, and the backend treats a missing filter as
"all", so the margin table says "no projects in the selected statuses" while the
capacity card counts every project, lost ones included. → Phase 1

**F-36 · Three small flow leaks.** InfoTab's "Saved ✓" is wiped by the reload it
triggers (`tabs/InfoTab.tsx:28-41, 59-60`). Cancelling the vault dialog during an
import leaves the pending import and its notice behind, and unlocking from the header
never resumes it (`pages/ProjectsPage.tsx:221-257, 511-516`). If the legacy-money
purge fails after the blob was saved, the plaintext stays in the database and the
banner never returns (`tabs/BudgetTab.tsx:118-128`). → Phase 6 (purge: Phase 8)

**F-43 · Importer parsing edges.** `_parse_number` reads `.5` as 5 and treats a
leading `0` as a thousands group (`0.500` → 500, `0.125` → 125; reproduced). The
footer rule only inspects the ID column, so a hand-made sheet with "Total" under
Asset Name imports as an asset, while a real row whose ID is "Total" and whose name
is blank is dropped. When a workbook carries both an "Asset" and an "Assets" sheet
only the first is read, without a warning. A header row below row 10 yields
"no header row found", yet `dry_run=false` still answers 200 with nothing created.
→ Phase 1

**F-44 · Cent drift between row totals and the summary.** The API rows and the
register TOTAL row sum rounded per-year values while the summary sums unrounded
ones: three 100 € leases over one year show 99.99 in the rows and 100.00 in the
summary and the exported workbook. The API also accepts `1234.567`, which the
export rounds, so an export → import shifts totals by cents. → Phase 1

**F-45 · The fixed-FTE ≤ 2.0 rule is bypassed by the planning grid and by templates.** A uniform 3.0 per month in the grid is stored as a fixed 3.0 role
(`features.py:180-188`), and a template built from a variable role averaging 4.0
instantiates a fixed 4.0 role; both then fail `/validate`. → Phase 1

**F-46 · A half-null financial blob is accepted.** `{"encrypted_money": "…",
"money_iv": null}` is stored and can never be decrypted (`schemas.py:425-427`).
Fix: a both-or-neither validator. → Phase 2

**F-47 · The JSON export omits the hardware plan, and cloning omits `lost_reason`.** `export_project` never writes `hardware_items`, so the backup format loses the plan
(part of F-29's fix); `cloning.py:20-30` copies `status` but not `lost_reason`.
→ Phase 1

**F-48 · Unknown ids in a request body return 404.** An unknown `catalog_item_id`
or `role_id` inside a body answers 404, indistinguishable from the path resource
missing, where 422 is correct; the tests lock this in. → Phase 8

**F-49 · `budget_total` means two things.** `HwProjectOut.budget_total` is the
stored overall figure while `HwProjectRollupOut.budget_total` is overwritten with
the effective budget (`hw_management.py:108-117`); a client that echoes a list row
through `PUT` overwrites the stored figure. No UI path does this today. Fix: rename
the rollup field to `effective_budget`. → Phase 8

**F-50 · The baseline migration cannot restore a dropped index.** `create_all(checkfirst)` skips tables that exist, so an index removed by hand is
never re-added; the drift check from Phase 0 will report it. The upgrade path itself
is clean: a database built from the first release's schema (commit `80f258b`)
upgrades on both SQLite and PostgreSQL with rows intact and zero model drift.
→ Phase 0

Checked and found clean, for the record: every accent shade the components use is
remapped for the light theme in `index.css:58-102`; the UI tables and the
browser-built Excel workbook agree with the money engine figure for figure
(non-labor rows, Overall rows, ticket profit, hardware sheet, rounding); the
TypeScript types match the Pydantic schemas field for field; the leasing engine
matches the README's DATEDIF rule on every golden cell; and
`examples/complete-example-project.json` imports, exports and re-imports cleanly.

## 5. Phased plan

Each phase is one pull request (Phase 1 may be two), independently shippable, with
its own tests. Effort: **S** under half a day, **M** one to two days, **L** three to
five days — for an agent session, not a calendar estimate. Recommended order is the
numbering; Phase 5 is decisions and can run in parallel with anything.

### Phase 0 — Guardrails (S, low risk)
Goal: make every later change cheaper and safer to review.
- Add `ruff` (backend) and ESLint + Prettier (frontend) with configs matching the
  existing style; fix the seven current ruff findings; run both in CI (F-18).
- Pin backend dependencies (a lock file via `pip-compile` or `uv`), drop
  `pydantic-settings`, declare `PyYAML` and `defusedxml` (F-17, part of F-13).
- Apply the non-breaking `react-router-dom` fix; document the exceljs/uuid advisory
  as accepted (F-17).
- Add the Alembic drift check used in this review as a permanent test (it also
  catches a hand-dropped index, F-50), and a Docker build job to CI.
- Pin the Python version for local development (F-28); tidy `.gitignore` (F-23).
Exit: CI runs lint, tests, drift check and Docker build; `pip install` is reproducible.

### Phase 1 — Correctness fixes (M–L, low risk; one backend PR and one frontend PR)
Goal: close every reproduced bug, each with a regression test in the style of
`test_known_regressions.py`.
- Logging: stop Alembic's `fileConfig` from disabling the running loggers (F-37).
- Date serials accepted only inside the date window, with a warning (F-38);
  `strings_to_formulas: False` on every workbook (F-39); `allow_inf_nan=False`,
  integer bounds, a rejecting branch in `_parse_number`, the import preview built
  inside the error handler (F-40).
- "Not counted" flags for register rows the engine ignores, a count in the summary,
  a warning for unknown purchase types (F-41).
- Allocations ignored or rejected for fixed roles; export only what import accepts
  (F-42); grid and templates respect the 2.0 fixed-FTE cap (F-45); `lost_reason`
  copied on clone and the hardware plan included in the export (F-47).
- Importer edges: leading-zero decimals, footer detection by name, duplicate
  aliased sheets, a 400 when no header row is found (F-43); one rounding rule for
  rows, summary and workbook, and two-decimal money on input (F-44).
- Shared attachment-filename helper with RFC 5987 encoding; tests for umlaut, en
  dash, euro sign, Arabic, double quote (F-01).
- Timeline-change validation on `PUT /api/projects/{id}`; timeline check in
  `validate_project`; hardware year costs restricted to project years; an InfoTab
  warning listing what would fall outside (F-04).
- Touch `Project.updated_at` (and `HwProject.updated_at`) on child writes (F-05).
- Year-span anchoring and date-window warnings in both engines (F-06).
- `PRAGMA foreign_keys=ON` for SQLite; remove the dangling-id workarounds; guard the
  management serializers the same way the planning one is (F-07).
- Import mode append/replace with duplicate warnings (F-08).
- Duplicate placeholder option (F-21, one line); lower bound on the "upcoming
  renewals" list (F-26).
- Full `MoneyConfig` in the JSON export, imported when present; round-trip test
  (F-29).
- Reset-on-change and stale-response guards in `BudgetTab`, `ReportsTab`,
  `CompareTab`, `PortfolioPage`, `ProjectPage` and `HardwareTab` (F-30); clear the
  planning grid's busy flag (F-31).
- Client-side guard for unnamed register rows and readable 422 messages (F-32);
  an explicit "no statuses" case for the capacity filter (F-35).
Exit: all probes from this review pass as tests; suites green.

### Phase 2 — Integrity and concurrency (M, medium risk)
Goal: the app cannot be corrupted by two people using it at once, and no save is
half-applied.
- Vault: proof-of-current-key on passphrase change; single-row guarantee with 409 on
  a second `POST` (F-03). Frontend sends the current wrapped key it already holds.
  Setup uses the `POST` response instead of a second request and keeps the recovery
  download reachable until saved (F-33). Both-or-neither validation on the
  financial blob (F-46).
- Bulk `PUT /api/projects/{id}/hardware` in one transaction; `HardwareTab` and the
  wizard use it (F-09).
- Optimistic concurrency: `updated_at` (or a version column) precondition on the
  financial blob, rates, registers and adjustments, 409 on mismatch, and a
  "reload and retry" banner in the UI; register `PUT` upserts by id so ids and
  `created_at` are stable (F-10).
Exit: a concurrent-edit test per endpoint; no multi-request save remains.

### Phase 3 — Deployment and security hardening (M, medium risk)
Goal: what the README already claims. This is the audit's missing phase 6.
- nginx: `client_max_body_size`, gzip, cache headers for hashed assets (F-02).
- Upload cap on the import endpoint; `defusedxml` in the image (F-13).
- CORS default to same-origin (explicit `CORS_ORIGINS` for dev); Compose stops
  publishing 8000, reads credentials from `.env`, adds health checks; non-root
  container user; `/api/health` checks the database (F-14).
- Migration-at-startup guard: a single migrator step (Compose `command`) or an
  advisory lock, documented for multi-replica deployments (F-14).
- Document the deployment contract (reverse proxy with authentication in front, or an
  optional trusted-header / API-key check if you want the app to enforce it — see
  section 6).
- Remove the two `xfail` markers, which then pass.
Exit: `docker compose up` yields a stack with no public backend port, secrets from
the environment, and a working large-file import.

### Phase 4 — Performance (S–M, low risk)
- `selectinload` on the project tree, portfolio capacity, HW overview/list and
  hardware plan; compute each project's summary once in the overview (F-16).
- A seed script for 100 projects and a timing check kept as a manual script.
Exit: aggregate endpoints issue a bounded number of queries (asserted in a test).

### Phase 5 — Product decisions (S each once decided)
Items that need your answer before code (section 6): winning-scenario semantics
(F-11), hardware plan versus cost items (F-12), HW project planning window (F-15),
default budget mode (F-22), number locale (F-21).

### Phase 6 — Frontend quality (M, low risk)
- Shared HW register helpers module; one `KpiTile`/`Stat`; one `roleFtesForMonth`;
  engine reads hours-per-FTE from meta (F-20).
- A `NumberInput` that tolerates an empty field; styled confirm/prompt dialogs;
  remove or wire the account button; make the wizard's ✕ explain itself; fix the
  anchor/button nesting (F-21).
- An error boundary with a reload action (F-27).
- Accessible `Modal` (dialog role, focus trap, Escape, focus restore), `Label`
  with `htmlFor`, names on icon-only buttons, real buttons in sortable headers,
  `scope` on header cells (F-34).
- Keep "Saved ✓" visible across the reload; clear or resume a pending import when
  the vault dialog is cancelled or the vault is unlocked elsewhere (F-36).
Exit: no duplicated helper; typecheck and tests green; manual light/dark pass.

### Phase 7 — Test hardening (M–L, low risk)
- Backend: per-test database (transactional fixture), remove cross-test numeric
  coupling, make the suite engine-agnostic and run the PostgreSQL job against all of
  it; add the untested endpoints (feature and role update/delete, legacy-money
  migration, importer edge paths, a pre-Alembic upgrade on SQLite, a startup
  logging test) (F-19).
- Frontend: component tests for `HwProjectPage`, both register tables, the import
  dialog, the vault setup/unlock/change flows, the import-with-financial-data flow,
  `ResourceGrid` save/reset, the export → import round trip, and an assertion on the
  browser-built Excel workbook.
- A Playwright smoke test (create project → roles → budget → reports → export) run
  in CI against the Compose stack.
Exit: the suites can run in any order; the HW management UI has coverage.

### Phase 8 — Data-model and documentation hygiene (S–M, low risk)
- Timezone-aware UTC timestamps serialised with an offset; drop the frontend `Z`
  heuristic (F-24).
- Optional: `Numeric(14,2)` money columns via migration (F-25); a migration that
  drops the legacy plaintext money tables once every project has been purged, which
  also closes the purge-failure leak (F-36).
- README refresh: structure tree, deployment contract, corrected claims; a
  CHANGELOG (F-23).
- API shape: 422 for unknown ids in a body (F-48); `effective_budget` on the
  rollup instead of a second `budget_total` (F-49).

## 6. Decisions needed from you

1. **Winning scenario in Portfolio and capacity (F-11).** When a scenario is marked
   as winner, should Portfolio value, weighted revenue, margin and the capacity
   heatmap use the winner instead of the base project? (My recommendation: yes,
   with the base used only when no winner is marked.)
2. **Hardware plan versus cost items (F-12).** Options: (a) keep them separate and
   say so in the UI; (b) let the hardware plan flow into the cost-profit summary as
   a non-labor row (with a pass-through flag), and remove the "hardware" cost-item
   category; (c) the reverse. (My recommendation: b.)
3. **HW project planning window (F-15).** Expose start/end year in the project
   dialog, or remove the columns and the README sentence? (Recommendation: expose;
   it is a two-field change and the summary logic already exists.)
4. **Default budget mode (F-22).** "overall" or "split" for new hardware projects?
5. **Number locale (F-21).** Keep en-US formatting, switch to de-DE, or follow the
   browser locale?
6. **Authentication stance (F-14).** Keep "behind an existing system" and only
   harden the deployment, or add an optional in-app check (trusted proxy header or
   a static API key) so the vault endpoints are not writable by any network peer?
7. **Scope of Phase 2's concurrency work (F-10).** Full optimistic concurrency on
   all four write paths, or only on the financial blob and the registers?
8. **Leasing month rule.** The engine reproduces the working document exactly,
   including its over-attribution: a lease from 2025-07-02 to 2028-07-02 is charged
   37 of 36 months (7,356.17 € on a 7,157.35 € lease), and a two-day lease across
   New Year is charged two months. Keep sheet parity (current, and what the golden
   tests lock in), or cap at 36 charged months? (Recommendation: keep parity until
   purchasing confirms; it changes historical figures.)

## 7. Recommendation

Run Phases 0 and 1 first; they are small, low-risk and remove every reproduced bug.
Phase 3 next, because the current Compose deployment cannot import the workbook the
module was built for. Then Phase 2, whose changes touch the API shape and benefit
from the guardrails. Phases 4, 6, 7 and 8 can follow in any order; Phase 5 needs
only answers.
