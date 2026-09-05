# RFQ Planner — Web Application

The web version of the Vehiclevo RFQ Planner. It preserves the original desktop
app's complete business logic — resource planning with period-based FTE
allocation, cost-profit analysis, ticket-based pricing and formatted Excel
reports — and adds the hardware management module, as a web application built
on:

| Layer    | Technology                          |
| -------- | ----------------------------------- |
| Frontend | React 18 + TypeScript (Vite)        |
| UI       | Tailwind CSS 4                      |
| Backend  | Python 3.12 + FastAPI               |
| Database | PostgreSQL + SQLAlchemy 2           |
| API      | RESTful JSON + Excel downloads      |

The app has no login of its own: it is designed to run behind an authenticating
reverse proxy, and the "Deployment contract" section below is the list of what
that deployment has to provide before the stack faces a network.

## End-to-end encrypted financial data

All monetary values (hourly sell rates, cost rates per location/level, hardware
cost per hour, ticket prices) are **end-to-end encrypted in the browser**:

- On first use you create a **financial data vault** with a passphrase; a one-time
  **recovery key file** (`rfq-recovery-key.json`) is downloaded as backup.
- Keys: passphrase → PBKDF2-SHA256 (600k iterations) → wraps a random AES-256-GCM
  data key. The server stores only KDF salt + wrapped keys + ciphertext blobs.
  The passphrase, recovery key and data key **never leave the browser**.
- The passphrase can be changed at any time from the header (gear icon next to
  the unlocked pill), proving ownership with either the current passphrase or
  the recovery file. Only the wrapped key is replaced — no project data is
  re-encrypted, and the existing recovery file keeps working.
- Nobody with database or backend access can read financial data — DB dumps and
  backups contain only ciphertext. Losing both passphrase and recovery file
  makes financial data unrecoverable **by design** (effort data is unaffected).
- Consequently all financial calculations (cost-profit, ticket revenue, budget
  pivots) run client-side (`frontend/src/money/engine.ts`, golden-master-tested
  against the original implementation), and the budget Excel workbook is
  generated in the browser. Effort data (features, roles, FTEs) stays server-side, so resource
  planning works without unlocking.
- Threat-model note: the server still delivers the app's JavaScript, so a
  *malicious* server operator could ship tampered code. The design protects
  against passive access — DB dumps, backups, curious admins.

## Quick start (Docker)

```bash
cp .env.example .env        # set POSTGRES_PASSWORD
docker compose up --build
```

- Web app: http://localhost:8080 (change the host port with `FRONTEND_PORT` in `.env`)
- Interactive API docs: http://localhost:8080/api/docs

The API is not published on the host: the web tier proxies `/api` to it over the
Compose network. Read "Deployment contract" below before exposing the stack to a
network.

## Deployment contract

The app has no login of its own. Run it behind something that authenticates
users (the company reverse proxy, an SSO gateway, oauth2-proxy) and keep the
API reachable from nothing else. The Compose stack is built for that:

- **One published port.** Only the web tier (nginx) listens on the host, on
  `FRONTEND_PORT`. The API is on the internal network only; `/api` reaches it
  through the web tier.
- **Secrets from the environment.** Database credentials come from `.env`
  (`.env.example` lists every setting); Compose refuses to start without
  `POSTGRES_PASSWORD`.
- **One migrator.** The `migrate` service upgrades the schema
  (`python -m app.migrate`) and exits before the API starts; the API processes
  run with `RUN_MIGRATIONS_ON_STARTUP=false`. On PostgreSQL an advisory lock
  serialises concurrent upgrades anyway, so a multi-worker or multi-replica
  deployment that leaves the flag on cannot race itself either.
- **Unprivileged containers.** The backend runs as user `app`; the web tier is
  `nginx-unprivileged` on port 8080.
- **Health.** `GET /api/health` answers `503` when the database cannot be
  reached. The backend image uses it as its health check and the web tier
  waits for it.
- **Upload cap.** The Excel import accepts workbooks up to 25 MB, enforced by
  nginx (`client_max_body_size`) and by the API (`MAX_UPLOAD_BYTES`, in bytes);
  keep the two in step. `defusedxml` is installed so openpyxl refuses XML bombs.
- **Same-origin by default.** No CORS headers are sent unless `CORS_ORIGINS`
  lists the origins the app is served from; neither the Compose stack nor the
  Vite dev server needs it, both proxy `/api` on their own origin.
- **Optional in-app check.** Set `TRUSTED_PROXY_USER_HEADER` to the header your
  authenticating proxy sets after login (for example `X-Forwarded-User`). The
  API then answers `401` to any request under `/api` (except `/api/health`)
  that lacks it. This is only meaningful when nothing but that proxy can reach
  the API and the proxy overwrites the header instead of passing a client's
  value through — which is what the Compose network layout provides.
- **Backups.** Back up the PostgreSQL volume (`pgdata`). It holds only wrapped
  keys and ciphertext for the financial data; keep the recovery key elsewhere.

## Local development

**Backend** (requires PostgreSQL, or set `DATABASE_URL` to any SQLAlchemy URL —
SQLite works for development):

```bash
cd backend
pip install -r requirements.txt
export DATABASE_URL=postgresql://rfq:rfq@localhost:5432/rfqplanner  # or sqlite:///./dev.db
uvicorn app.main:app --reload
```

**Frontend** (dev server proxies `/api` to `http://localhost:8000`):

```bash
cd frontend
npm install
npm run dev
```

**Tests and lint**:

```bash
cd backend
pip install -r requirements-dev.txt
ruff check .
python3 -m pytest tests/

cd ../frontend
npm ci
npm run lint
npm run format:check   # or `npm run format` to apply Prettier
npm test               # engine, helper and component tests (Testing Library + jsdom)
npm run typecheck
npm run build
```

The backend suite runs against whatever `TEST_DATABASE_URL` names (a SQLite
file by default); CI runs it twice, on SQLite and on PostgreSQL. A browser
smoke test (`frontend/e2e`, Playwright) walks the day-one path — create a
project, staff it, set up the vault, enter rates, read the analysis, export —
against a running stack:

```bash
cd frontend
npx playwright install chromium          # once
E2E_BASE_URL=http://localhost:8080 npm run e2e
```

The same checks, plus a build of both Docker images and the smoke tests
against the Compose stack, run in GitHub Actions for pull requests and pushes
to `main`.
Backend dependencies are pinned: `requirements.txt` and `requirements-dev.txt`
are compiled from the `.in` files with `pip-compile` (see `requirements.in`);
edit the `.in` file and recompile rather than editing the pinned file by hand.

## Interface

The app runs inside a portal shell (`components/AppLayout`): a persistent left
sidebar with the Vehiclevo brand and collapsible navigation groups (RFQ
Planning → Projects, Overview; Hardware → Overview, Projects, Catalog, Ordering
Process), and a top bar with a sidebar toggle, a **light/dark theme switch**
and an account menu. Navigation uses monochrome line icons (`lucide-react`)
that inherit the current text colour. The sidebar hides behind the toggle on
desktop and becomes an off-canvas drawer on small screens.

Theme choice is persisted (`localStorage`), defaults to the OS setting and is
applied by an inline script in `index.html` before the first paint, so light
mode never flashes dark. `index.css` implements it by redefining Tailwind's
colour custom properties under `[data-theme='light']`: the `slate` ramp is
inverted end-to-end, and each accent ramp swaps only its ends — shades 200-400
(accent *text*) with 700-900, and 800-950 (accent *surfaces*) with 50-200 —
while 500-700 stay fixed so solid buttons, focus rings and the brand gradient
keep their white-on-accent contrast. The sidebar is a surface of its own and
draws on `--sidebar-*` tokens defined for both themes, so the rail flips with
the rest of the app instead of staying dark on a light page. Components need no
per-theme classes.

## Application concepts (unchanged from the desktop app)

- **Project** — name, company and a month-granular timeline (start/end year+month).
- **Features & Roles** — each feature holds roles with a location (`BCC`, `HCC`,
  `MCC`) and a level (`PM/TL`, `FO`, `Principal`, `Senior`, `Standard`, `Junior`).
- **FTE allocation** — a role has either a fixed FTE (0–2.0) or *variable
  allocation periods* (`YYYY-MM` ranges with individual FTE values, no overlap).
- **Rate configuration** — hourly sell rates per location, hourly cost rates per
  location+level, SP→hours conversion, hardware cost per hour, risk factor %.
- **Ticket configuration** — story points and price per ticket size
  (small/medium/large) plus per-year quota percentages.
- **Calculations** — 160 man-hours per FTE-month; cost-profit summary by year and
  location; ticket analysis with risk/hardware-adjusted hourly rates; per-year
  pivot tables with location subtotals and grand totals.
- **Reports** — budget plan and resource plan as JSON (rendered in the Reports
  tab) or as formatted Excel workbooks (Config, CostProfit and per-year sheets,
  matching the original layout).
- **Import/export** — projects round-trip through the desktop app's JSON format
  (`POST /api/projects/import`, `GET /api/projects/{id}/export`).
- **Scenarios** — a project can be cloned into scenarios (`POST
  /api/projects/{id}/clone`) and one of them marked as the winner. The
  RFQ Overview page (`/portfolio`) and the capacity heatmap count each family once: the winning
  scenario where one is marked, the base project otherwise
  (`GET /api/projects?effective=true`).
- **Number formatting** follows the browser's locale ("1.234,56 €" in a German
  browser, "€1,234.56" in an English one); Excel exports carry number formats
  and are unaffected.
- **Hardware planning** — the Hardware tab plans the tools and equipment a
  quotation needs: each row has an ASPICE process, `yearly` or `once` billing, a
  unit cost, a quantity (use 0 to keep an alternative on the sheet without
  costing it) and a checkbox per project year. Yearly rows are charged for every
  selected year, one-time purchases once in their selected year. Rows can be
  typed in ad hoc or picked from the shared **hardware catalog**, which
  snapshots its values into the project so later catalog price changes never
  alter an existing quotation. Supplier contact details belong to the vendor's
  catalog entry — project rows display the email read-only and always show the
  current one, so updating an address in the catalog updates every plan using
  it. The catalog is its own portal module at `/hardware-catalog` (linked from
  the projects home page) and is also reachable as a modal from the Hardware
  planning tab, so a catalog can be maintained without leaving a project — both
  render the same editor (`HardwareCatalogManager`). **Generate Plan** sizes a whole plan automatically: it counts
  engineering FTEs (excluding the Project Lead) and rounds up to users, divides
  them by the users-per-bench factor, and equips every bench with a PC, power supply,
  debugger (Lauterbach or UDE) and a Vector box (CAN, LIN or Ethernet), adding
  an AMTS board to each AMTS bench and one each of the project licences
  (compiler, Polyspace, VectorCAST, DaVinci Configurator and Developer). Every
  generated row is an ordinary row afterwards, so it stays editable.
  The plan's per-year totals are carried into the cost-profit analysis as a
  "hardware plan" non-labor row; the Budget tab's *billed to the customer*
  switch (`hardware_pass_through`) decides whether that cost is also charged on
  top of the selling price. The "hardware" category of non-labor cost items is
  retired for new items so nothing is counted twice; existing items in it still
  count. The plan also exports as a standalone workbook and as a Hardware sheet
  in the budget workbook. Unlike financial data, the hardware plan is stored in
  plaintext.
- **Hardware catalog seed** — a standard catalog of ~75 supplier items (Vector,
  MathWorks, ETAS, Lauterbach, TASKING, tracetronic, IBM, Atlassian, JFrog and
  others) is installed by migration `20260818_0003` from
  `backend/app/data/hardware_catalog_seed.json`. Rented/subscription items are
  seeded as `yearly`, perpetual licenses and hardware purchases as `once`, and
  each item gets a default ASPICE process that can be changed in the UI. Run
  `python3 scripts/seed_hardware_catalog.py` from `backend/` to restore standard
  entries that were deleted or to load newly added seed rows; seeding never
  duplicates or overwrites existing catalog items.

## Hardware Management

A second, self-contained module (sidebar → Hardware) that replaces the
`HW_purchasing_working_document_V5.xlsx` working document: what was actually
bought, what it costs per year, and how much budget is left. It is separate from
RFQ hardware *planning* — planning estimates a quotation, this tracks real
purchases — and it keeps its own project list (`hw_projects`), with a
`portal_reference` column reserved for the later link to the company portal's
projects.

- **Registers** — hardware objects are split the way the workbook split them:
  **Assets** (`hw_assets`: serial, model, category, status, order number, EOL
  date, assigned employee) and **Licenses** (`hw_licenses`: product key,
  expiration date, licensed-to email, manufacturer, quantity, maintenance flag).
  Both are edited as a grid whose hot fields are inline and whose remaining
  fields open in a per-row dialog; the name column is pinned like the
  spreadsheet's frozen first column. Rows can be typed in, picked from the shared
  hardware catalog (which fills in supplier and price), or imported.
- **Depreciation** — every row spreads across years exactly as the working
  document did: `Leasing` amortises over a **fixed 36 months**
  (`cost / 36 × months overlapping the year`, months counted the way Excel's
  `DATEDIF(…, "m") + 1` counts them), `Purchase` lands whole in its purchase
  year, and `Planned Purchase` / `Not Purchased` contribute nothing to actual
  spend. `Planned Purchase` rows are totalled separately as planned budget. The
  engine lives in `backend/app/services/hw_depreciation.py`, is mirrored in
  `frontend/src/hardware/depreciation.ts` for live feedback while editing, and
  both are unit-tested against values taken out of the original workbook.
- **Budget** — a project's budget is approved either as **one overall figure**
  (the default for a new project) or **split between assets and licenses**, and
  `budget_mode` records which of the two is authoritative so a stale figure left
  over from the other mode can never quietly change a total. Both sets of
  numbers are kept when the mode is switched. In overall mode there is no
  per-type share by definition, so the dashboard reports the total and omits
  the breakdown rather than inventing one. An optional **planning window**
  (first and last year) makes the summary span the whole budget horizon before
  anything is bought.
- **Project overview** (`/hardware/projects/{id}`) — budget / committed /
  planned / remaining tiles, then a Summary tab (per-year budget table including
  the workbook's manual "Special cases" deltas, license renewal risk, and the
  category × status pivots) plus the two registers.
- **Project list** (`/hardware/projects`) — every purchasing project on a page
  of its own: the totals of the listed projects, a search box, and a sortable
  table (assets, licenses, budget, committed, planned, remaining, utilisation)
  linking to each project. New projects are created here. The page shows
  exactly what `GET /api/hw/projects` returns, so when the deployment starts
  identifying users (see "Deployment contract") that endpoint is the one place
  to scope, and a project leader then sees only their own projects — on this
  page and nowhere else.
- **Management overview** (`/hardware`) — the picture across every project:
  budget / committed / planned / remaining, spend by year, the
  expired / 30 / 60 / 90-day license renewal risk with the expiring list, and the
  asset pivot. This replaces the workbook's Assets Dashboard and Summary sheets.
- **Excel in and out** — *Import Excel* accepts a workbook with an `Assets`
  and/or `Licenses` sheet carrying the working document's headers, shows a
  dry-run preview (rows parsed, warnings, sample) before anything is written, and
  is tolerant of the real file: German decimals (`1.234,56`), currency symbols,
  several date formats, stray header whitespace, unknown columns and the derived
  year columns. Rows the document identified only by category and manufacturer
  (most of its licence rows have no name) are named from those columns rather
  than dropped. *Export Excel* writes the replacement workbook — Dashboard,
  Summary, Assets, Licenses and HW Catalogue — and re-imports cleanly.
  *Template* downloads an empty version of the two sheets.
- **Ordering process** (`/hardware/process`) — the three-phase purchase flow that
  the workbook carried as pasted images on its first sheet, as data
  (`frontend/src/hardware/orderingProcess.ts`), with each step's owner and
  guidance and links to the screen that performs it.

Supplier contact people (the workbook's "Contact person" sheet) live on the
shared hardware catalog entry, so there is one place per vendor.

## REST API overview

| Method   | Path                                            | Purpose                          |
| -------- | ----------------------------------------------- | -------------------------------- |
| GET      | `/api/meta`                                     | Locations, levels, ticket sizes  |
| GET/POST | `/api/projects`                                 | List / create projects           |
| GET/PUT/DELETE | `/api/projects/{id}`                      | Read / update / delete a project |
| GET      | `/api/projects/{id}/validate`                   | Full project validation          |
| GET      | `/api/projects/{id}/export`                     | Export legacy JSON               |
| POST     | `/api/projects/import`                          | Import legacy JSON               |
| GET/POST | `/api/projects/{id}/features`                   | List / add features              |
| PUT/DELETE | `/api/features/{id}`                          | Rename / delete a feature        |
| POST     | `/api/features/{id}/roles`                      | Add a role (with allocations)    |
| PUT/DELETE | `/api/roles/{id}`                             | Update / delete a role           |
| GET/PUT  | `/api/projects/{id}/rates`                      | Read / update non-monetary config |
| GET/PUT  | `/api/projects/{id}/financial-data`             | Encrypted financial blob         |
| GET/POST | `/api/vault`                                    | Vault key material (wrapped)     |
| GET      | `/api/projects/{id}/reports/resource-plan`      | Resource pivots (JSON)           |
| GET      | `/api/projects/{id}/reports/resource-plan.xlsx` | Resource plan workbook           |
| POST     | `/api/projects/{id}/clone`                      | Duplicate / create scenario      |
| GET      | `/api/portfolio/capacity`                       | Cross-project FTE capacity       |
| GET/POST | `/api/hardware-catalog`                         | List / add catalog items         |
| PUT/DELETE | `/api/hardware-catalog/{id}`                  | Update / delete a catalog item   |
| GET/POST | `/api/projects/{id}/hardware`                   | Hardware plan / add an item      |
| PUT/DELETE | `/api/hardware-items/{id}`                    | Update / delete a hardware item  |
| GET      | `/api/projects/{id}/reports/hardware-plan.xlsx` | Hardware plan workbook           |
| GET      | `/api/hw/meta`                                  | Register dropdown vocabularies   |
| GET      | `/api/hw/overview`                              | Spend across every HW project    |
| GET/POST | `/api/hw/projects`                              | List / create HW projects        |
| GET/PUT/DELETE | `/api/hw/projects/{id}`                   | Read / update / delete a project |
| GET      | `/api/hw/projects/{id}/summary`                 | Per-year budget, risk, pivots    |
| GET/POST/PUT | `/api/hw/projects/{id}/assets`              | Asset register (PUT replaces)    |
| GET/POST/PUT | `/api/hw/projects/{id}/licenses`            | License register (PUT replaces)  |
| PUT/DELETE | `/api/hw/assets/{id}`                         | Update / delete one asset        |
| PUT/DELETE | `/api/hw/licenses/{id}`                       | Update / delete one license      |
| GET/PUT  | `/api/hw/projects/{id}/adjustments`             | "Special cases" budget deltas    |
| POST     | `/api/hw/projects/{id}/import`                  | Upload xlsx (`dry_run` preview)  |
| GET      | `/api/hw/projects/{id}/export.xlsx`             | Replacement working document     |
| GET      | `/api/hw/import-template.xlsx`                  | Empty import template            |

## Project structure

```
├── backend/
│   ├── alembic/               # Migration chain (baseline + one file per change)
│   ├── app/
│   │   ├── main.py            # FastAPI app, middleware, validation-error shape
│   │   ├── config.py          # Domain constants, environment settings
│   │   ├── database.py        # SQLAlchemy engine/session, migrations, health probe
│   │   ├── migrate.py         # `python -m app.migrate`: upgrade the schema and exit
│   │   ├── models.py          # ORM models (+ the owner-timestamp/version listener)
│   │   ├── schemas.py         # Pydantic schemas
│   │   ├── data/              # Hardware catalog seed
│   │   ├── routers/           # REST endpoints
│   │   └── services/          # Calculations, Excel in/out, depreciation, versioning
│   ├── scripts/               # Catalog re-seed, seed-and-time for the aggregates
│   └── tests/                 # API tests (SQLite by default, PostgreSQL in CI)
├── frontend/
│   ├── e2e/                   # Playwright smoke test against a running stack
│   └── src/
│       ├── api.ts             # Typed API client
│       ├── crypto.ts          # Vault key hierarchy (WebCrypto)
│       ├── components/        # UI kit, registers, dialogs, grid, catalog editor
│       ├── hardware/          # Depreciation engine, budget/window/register helpers, auto-plan
│       ├── money/             # Client-side budget engine, Excel workbook, portable file
│       ├── pages/             # Projects, RFQ overview, project workspace, hardware pages
│       ├── tabs/              # Info / Resources / Budget / Hardware / Reports / Scenarios
│       ├── theme/             # Light/dark theme context
│       ├── vault/             # Vault context and dialogs
│       └── test/              # Vitest setup (jsdom, Testing Library)
├── docs/                      # The September 2026 review and phased plan
├── .env.example               # Settings the Compose stack reads
└── docker-compose.yml         # PostgreSQL + one-shot migrate + backend + frontend (nginx)
```
