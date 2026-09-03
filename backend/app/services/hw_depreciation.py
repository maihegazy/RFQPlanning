"""Depreciation and budget-summary engine for the Hardware Management module.

Ports `HW_purchasing_working_document_V5.xlsx`: the per-row LET() year columns on
the Assets/Licenses sheets, the Summary sheet (columns A..J, the asset pivot and the
License Renewal Risk block) and the Assets Dashboard tiles.

Every function is duck-typed — it only ever touches attribute names — so it runs
against ORM rows, Pydantic models or plain stubs alike. Assets carry
`(purchase_type, purchase_date, eol_date, purchase_cost)`, licenses carry
`(depreciation, purchase_date, termination_date, purchase_cost)`.
"""

import datetime
from typing import Any

from ..config import HW_ASSET_STATUSES, HW_LEASING_MONTHS, HW_PURCHASE_TYPES

LEASING = "LEASING"
PURCHASE = "PURCHASE"
PLANNED_PURCHASE = "PLANNED PURCHASE"

# Guard against a stray year typo (e.g. 2205) blowing the summary up into
# thousands of rows; the sheet only ever carried a decade.
MAX_SPAN_YEARS = 40

# Summary!B41:B44 counts everything expiring inside the next 90 days.
EXPIRY_HORIZON_DAYS = 90

# Pivot bucket for rows whose category/status cell is blank.
UNSPECIFIED = "Unspecified"

# `totals` is a year row without a year; 0 keeps the shape uniform for clients.
TOTALS_YEAR = 0


def _as_date(value: Any) -> datetime.date | None:
    """Coerce dates coming from the ORM or from openpyxl to a plain `date`."""
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    return None


def _kind(value: Any) -> str:
    """UPPER(TRIM(...)) — the sheet compares purchase types case-insensitively."""
    return str(value or "").strip().upper()


def _money(value: Any) -> float:
    return float(value or 0.0)


def _label(value: Any) -> str:
    return str(value or "").strip() or UNSPECIFIED


def complete_months(a: datetime.date, b: datetime.date) -> int:
    """Excel's DATEDIF(a, b, "m"): whole months elapsed between two dates."""
    months = (b.year - a.year) * 12 + (b.month - a.month)
    if b.day < a.day:
        months -= 1
    return months


def year_cost(year: int, kind: str, purchase_date: datetime.date | None,
              end_date: datetime.date | None, cost: float) -> float:
    """Cost attributed to `year` for one asset/license row."""
    purchase_date = _as_date(purchase_date)
    total = _money(cost)
    t = _kind(kind)

    if t == LEASING:
        end_date = _as_date(end_date)
        if purchase_date is None or end_date is None:
            return 0.0
        start = max(purchase_date, datetime.date(year, 1, 1))
        end = min(end_date, datetime.date(year, 12, 31))
        if start > end:
            return 0.0
        months = complete_months(start, end) + 1
        # The sheet always divides by 36 and never caps the month count, so a
        # lease running longer than three years keeps accruing past its cost.
        return total / HW_LEASING_MONTHS * months

    if t == PURCHASE:
        return total if purchase_date is not None and purchase_date.year == year else 0.0

    return 0.0  # Planned Purchase and Not Purchased never hit the actual budget.


def per_year(kind: str, purchase_date: datetime.date | None,
             end_date: datetime.date | None, cost: float,
             years: list[int]) -> dict[str, float]:
    """The year columns of one register row, keyed by year as a string."""
    return {
        str(year): round(year_cost(year, kind, purchase_date, end_date, cost), 2)
        for year in years
    }


def asset_year_costs(asset: Any, years: list[int]) -> dict[str, Any]:
    """`{per_year, total}` for one asset, ready to merge into its response body."""
    return _row_year_costs(
        asset.purchase_type, asset.purchase_date, asset.eol_date,
        asset.purchase_cost, years,
    )


def license_year_costs(license_row: Any, years: list[int]) -> dict[str, Any]:
    """`{per_year, total}` for one license, ready to merge into its response body."""
    return _row_year_costs(
        license_row.depreciation, license_row.purchase_date,
        license_row.termination_date, license_row.purchase_cost, years,
    )


def _row_year_costs(kind: str, purchase_date: datetime.date | None,
                    end_date: datetime.date | None, cost: float,
                    years: list[int]) -> dict[str, Any]:
    raw = [year_cost(year, kind, purchase_date, end_date, cost) for year in years]
    return {
        "per_year": {str(year): round(value, 2) for year, value in zip(years, raw)},
        "total": round(sum(raw), 2),
    }


def _asset_year_cost(asset: Any, year: int) -> float:
    return year_cost(year, asset.purchase_type, asset.purchase_date,
                     asset.eol_date, asset.purchase_cost)


def _license_year_cost(license_row: Any, year: int) -> float:
    return year_cost(year, license_row.depreciation, license_row.purchase_date,
                     license_row.termination_date, license_row.purchase_cost)


def year_span(assets: Any, licenses: Any, extra_years: Any = (),
              today: datetime.date | None = None) -> list[int]:
    """Contiguous list of years the summary covers.

    Spans every purchase/EOL/termination year present plus `extra_years`
    (project window, budget-adjustment years), falling back to the current year
    when the registers are empty.
    """
    years = {int(year) for year in extra_years if year}
    for asset in assets:
        for value in (asset.purchase_date, asset.eol_date):
            found = _as_date(value)
            if found is not None:
                years.add(found.year)
    for license_row in licenses:
        for value in (license_row.purchase_date, license_row.termination_date):
            found = _as_date(value)
            if found is not None:
                years.add(found.year)

    if not years:
        return [(today or datetime.date.today()).year]

    first = min(years)
    last = min(max(years), first + MAX_SPAN_YEARS - 1)
    return list(range(first, last + 1))


def renewal_risk(licenses: Any, today: datetime.date) -> dict[str, int]:
    """Summary!B41:B44 — licenses bucketed by how soon they expire."""
    counts = {"expired": 0, "in_30_days": 0, "in_60_days": 0, "in_90_days": 0}
    for license_row in licenses:
        expires = _as_date(license_row.expiration_date)
        if expires is None:
            continue
        days_left = (expires - today).days
        if days_left < 0:
            counts["expired"] += 1
        elif days_left <= 30:
            counts["in_30_days"] += 1
        elif days_left <= 60:
            counts["in_60_days"] += 1
        elif days_left <= 90:
            counts["in_90_days"] += 1
    return counts


def expiring_licenses(licenses: Any, today: datetime.date,
                      project_name_by_id: dict[int, str] | None = None,
                      horizon_days: int = EXPIRY_HORIZON_DAYS) -> list[dict]:
    """Already-expired and soon-to-expire licenses, soonest first."""
    names = project_name_by_id or {}
    rows = []
    for license_row in licenses:
        expires = _as_date(license_row.expiration_date)
        if expires is None:
            continue
        days_left = (expires - today).days
        if days_left > horizon_days:
            continue
        project_id = getattr(license_row, "hw_project_id", None)
        rows.append({
            "id": license_row.id,
            "name": str(license_row.name or "").strip(),
            "manufacturer": str(getattr(license_row, "manufacturer", "") or "").strip(),
            "expiration_date": expires.isoformat(),
            "days_left": days_left,
            "hw_project_id": project_id,
            "hw_project_name": names.get(project_id, ""),
        })
    rows.sort(key=lambda row: (row["expiration_date"], row["name"].lower()))
    return rows


def category_pivot(rows: Any, category_attr: str, status_attr: str,
                   status_order: Any = ()) -> dict[str, Any]:
    """Summary r26-r37: a count-of-rows pivot, categories down, statuses across.

    `status_order` seeds the column order with the known vocabulary; values not
    in it follow alphabetically, and the blank bucket is always last.
    """
    counts: dict[str, dict[str, int]] = {}
    seen: set[str] = set()
    for row in rows:
        category = _label(getattr(row, category_attr, None))
        status = _label(getattr(row, status_attr, None))
        seen.add(status)
        counts.setdefault(category, {})
        counts[category][status] = counts[category].get(status, 0) + 1

    known = [s for s in status_order if s in seen and s != UNSPECIFIED]
    extra = sorted(s for s in seen if s not in known and s != UNSPECIFIED)
    statuses = known + extra + ([UNSPECIFIED] if UNSPECIFIED in seen else [])

    categories = sorted(c for c in counts if c != UNSPECIFIED)
    if UNSPECIFIED in counts:
        categories.append(UNSPECIFIED)

    return {
        "statuses": statuses,
        "rows": [
            {
                "category": category,
                "counts": {s: counts[category].get(s, 0) for s in statuses},
                "total": sum(counts[category].values()),
            }
            for category in categories
        ],
    }


def _year_row(year: int, actual_assets: float, actual_licenses: float,
              planned_assets: float, planned_licenses: float) -> dict[str, Any]:
    actual_total = actual_assets + actual_licenses
    planned_total = planned_assets + planned_licenses
    return {
        "year": year,
        "actual_assets": round(actual_assets, 2),
        "actual_licenses": round(actual_licenses, 2),
        "actual_total": round(actual_total, 2),
        "planned_assets": round(planned_assets, 2),
        "planned_licenses": round(planned_licenses, 2),
        "planned_total": round(planned_total, 2),
        "grand_total": round(actual_total + planned_total, 2),
    }


def _planned_cost(rows: Any, kind_attr: str, year: int) -> float:
    """Summary cols G/H: cost of rows flagged Planned Purchase bought in `year`."""
    total = 0.0
    for row in rows:
        if _kind(getattr(row, kind_attr, None)) != PLANNED_PURCHASE:
            continue
        purchased = _as_date(row.purchase_date)
        if purchased is not None and purchased.year == year:
            total += _money(row.purchase_cost)
    return total


def _budget_rows(assets: Any, licenses: Any, adjustments: Any,
                 years: list[int]) -> tuple[list[dict], dict]:
    """Summary cols A..J plus the Total row, shared by project and overview views.

    Values accumulate unrounded and are rounded once on the way out, the way the
    sheet sums full precision and only rounds for display.
    """
    special: dict[str, dict[int, float]] = {"assets": {}, "licenses": {}}
    for adjustment in adjustments:
        bucket = special.get(str(adjustment.kind or "").strip().lower())
        if bucket is None:
            continue
        year = int(adjustment.year or 0)
        bucket[year] = bucket.get(year, 0.0) + _money(adjustment.amount)

    raw = []
    for year in years:
        raw.append((
            year,
            sum(_asset_year_cost(a, year) for a in assets) + special["assets"].get(year, 0.0),
            sum(_license_year_cost(l, year) for l in licenses) + special["licenses"].get(year, 0.0),
            _planned_cost(assets, "purchase_type", year),
            _planned_cost(licenses, "depreciation", year),
        ))

    totals = _year_row(
        TOTALS_YEAR,
        sum(row[1] for row in raw),
        sum(row[2] for row in raw),
        sum(row[3] for row in raw),
        sum(row[4] for row in raw),
    )
    return [_year_row(*row) for row in raw], totals


def _dashboard(budget_assets: float, budget_licenses: float,
               totals: dict) -> dict[str, float]:
    """Assets Dashboard tiles: remaining counts spent only, never the plan."""
    assets_budget = _money(budget_assets)
    licenses_budget = _money(budget_licenses)
    budget_total = assets_budget + licenses_budget
    return {
        "budget_total": round(budget_total, 2),
        "budget_assets": round(assets_budget, 2),
        "budget_licenses": round(licenses_budget, 2),
        "spent_total": totals["actual_total"],
        "planned_total": totals["planned_total"],
        "remaining": round(budget_total - totals["actual_total"], 2),
    }


def _adjustment_rows(adjustments: Any) -> list[dict]:
    rows = [
        {
            "year": int(a.year or 0),
            "kind": str(a.kind or "").strip().lower(),
            "amount": round(_money(a.amount), 2),
            "note": str(getattr(a, "note", "") or ""),
        }
        for a in adjustments
    ]
    rows.sort(key=lambda row: (row["year"], row["kind"]))
    return rows


def summarize(assets: Any, licenses: Any, adjustments: Any,
              budget_assets: float, budget_licenses: float,
              today: datetime.date, extra_years: Any = ()) -> dict[str, Any]:
    """The HwSummary payload minus `expiring`, which needs project names."""
    assets = list(assets)
    licenses = list(licenses)
    adjustments = list(adjustments)

    # Adjustment years join the span so a special case entered for a year with no
    # register rows still shows up instead of vanishing from the budget.
    years = year_span(
        assets, licenses,
        extra_years=list(extra_years) + [a.year for a in adjustments],
        today=today,
    )
    rows, totals = _budget_rows(assets, licenses, adjustments, years)

    return {
        "years": rows,
        "totals": totals,
        "risk": renewal_risk(licenses, today),
        "asset_pivot": category_pivot(assets, "category", "status", HW_ASSET_STATUSES),
        "license_pivot": category_pivot(licenses, "category", "depreciation",
                                        HW_PURCHASE_TYPES),
        "dashboard": _dashboard(budget_assets, budget_licenses, totals),
        "asset_count": len(assets),
        "license_count": len(licenses),
        "adjustments": _adjustment_rows(adjustments),
    }


def overview_summary(assets: Any, licenses: Any, adjustments: Any,
                     projects: Any, today: datetime.date,
                     extra_years: Any = ()) -> dict[str, Any]:
    """The HwOverview payload minus `projects`, rolled up over every HW project.

    `assets`, `licenses` and `adjustments` are the rows of *all* `projects`;
    budgets are the sum of the per-project budgets.
    """
    projects = list(projects)
    licenses = list(licenses)
    names = {p.id: p.name for p in projects}

    summary = summarize(
        assets, licenses, adjustments,
        sum(_money(p.budget_assets) for p in projects),
        sum(_money(p.budget_licenses) for p in projects),
        today, extra_years=extra_years,
    )

    return {
        "years": summary["years"],
        "totals": summary["totals"],
        "risk": summary["risk"],
        "expiring": expiring_licenses(licenses, today, names),
        "asset_pivot": summary["asset_pivot"],
        "dashboard": summary["dashboard"],
        "project_count": len(projects),
        "asset_count": summary["asset_count"],
        "license_count": summary["license_count"],
    }
