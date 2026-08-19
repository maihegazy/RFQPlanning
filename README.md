# RFQ Planner — Web Application

A modern, production-ready web version of the Vehiclevo RFQ Planner. It preserves
the original desktop app's complete business logic — resource planning with
period-based FTE allocation, cost-profit analysis, ticket-based pricing and
formatted Excel reports — as a web application built on:

| Layer    | Technology                          |
| -------- | ----------------------------------- |
| Frontend | React 18 + TypeScript (Vite)        |
| UI       | Tailwind CSS 4                      |
| Backend  | Python 3.12 + FastAPI               |
| Database | PostgreSQL + SQLAlchemy 2           |
| API      | RESTful JSON + Excel downloads      |

No authentication/authorization — designed to run behind an existing system.

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
docker compose up --build
```

- Web app: http://localhost:8080
- API + interactive docs: http://localhost:8000/docs

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

**Tests**:

```bash
cd backend
pip install -r requirements-dev.txt
python3 -m pytest tests/

cd ../frontend
npm ci
npm test
npm run typecheck
npm run build
```

The same backend and frontend checks run automatically in GitHub Actions for
pull requests and pushes to `main`. Known audit defects are recorded as strict
expected failures; each later fix must remove its matching marker.

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
  it. The catalog manager is reachable from the Hardware tab and from the
  home page. Hardware totals are reported on their own (they
  do not feed the cost-profit analysis) and export both as a standalone workbook
  and as a Hardware sheet in the budget workbook. Unlike financial data, the
  hardware plan is stored in plaintext.
- **Hardware catalog seed** — a standard catalog of ~75 supplier items (Vector,
  MathWorks, ETAS, Lauterbach, TASKING, tracetronic, IBM, Atlassian, JFrog and
  others) is installed by migration `20260818_0003` from
  `backend/app/data/hardware_catalog_seed.json`. Rented/subscription items are
  seeded as `yearly`, perpetual licenses and hardware purchases as `once`, and
  each item gets a default ASPICE process that can be changed in the UI. Run
  `python3 scripts/seed_hardware_catalog.py` from `backend/` to restore standard
  entries that were deleted or to load newly added seed rows; seeding never
  duplicates or overwrites existing catalog items.

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

## Project structure

```
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app
│   │   ├── config.py          # Domain constants (levels, locations, …)
│   │   ├── database.py        # SQLAlchemy engine/session
│   │   ├── models.py          # ORM models
│   │   ├── schemas.py         # Pydantic schemas
│   │   ├── routers/           # REST endpoints
│   │   └── services/          # Business logic (calculations, Excel export)
│   └── tests/                 # End-to-end API tests
├── frontend/
│   └── src/
│       ├── api.ts             # Typed API client
│       ├── pages/             # Projects list, project workspace
│       ├── tabs/              # Info / Resources / Budget / Reports tabs
│       └── components/        # UI kit, role & allocation editor
└── docker-compose.yml         # PostgreSQL + backend + frontend (nginx)
```
