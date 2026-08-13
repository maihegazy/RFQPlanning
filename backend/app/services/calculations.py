"""Business calculations ported from the desktop app.

All logic (time-aware FTE allocation, cost-profit summary, ticket
analysis, yearly pivots with location subtotals) mirrors the original
BudgetController / ResourceController implementations.
"""

from collections import defaultdict

from .. import models
from ..config import HOURS_PER_FTE_PER_MONTH
from .date_utils import get_month_list
from .rate_config import get_rate_config


def get_ftes_for_month(role: models.Role, month: str) -> float:
    """Time-aware FTE for a role in a given YYYY-MM month."""
    if not role.use_advanced_allocation or not role.allocations:
        return role.ftes
    total = 0.0
    for alloc in role.allocations:
        if alloc.start_month <= month <= alloc.end_month:
            total += alloc.ftes
    return total


def get_project_months(project: models.Project) -> list[str]:
    return get_month_list(
        project.start_year, project.start_month,
        project.end_year, project.end_month,
    )


def build_budget_rows(project: models.Project, months: list[str]) -> list[dict]:
    """Per-month, per-role rows with man-hours, cost and selling price."""
    rates = get_rate_config(project)
    rows = []
    for month in months:
        for feature in project.features:
            for role in feature.roles:
                monthly_ftes = get_ftes_for_month(role, month)
                man_hours = monthly_ftes * HOURS_PER_FTE_PER_MONTH
                selling_price = man_hours * rates["hourly_rates"].get(role.location, 0.0)
                cost = man_hours * rates["cost_rates"].get(role.location, {}).get(role.level, 0.0)
                rows.append({
                    "month": month,
                    "year": month[:4],
                    "feature": feature.name,
                    "role": role.name,
                    "location": role.location,
                    "level": role.level,
                    "ftes": monthly_ftes,
                    "man_hours": man_hours,
                    "selling_price": selling_price,
                    "cost": cost,
                })
    return rows


def generate_cost_profit_summary(budget_rows: list[dict]) -> list[dict]:
    """Cost-profit summary grouped by year and location."""
    grouped: dict[tuple[str, str], dict] = defaultdict(
        lambda: {"man_hours": 0.0, "cost": 0.0, "selling_price": 0.0}
    )
    for row in budget_rows:
        key = (row["year"], row["location"])
        grouped[key]["man_hours"] += row["man_hours"]
        grouped[key]["cost"] += row["cost"]
        grouped[key]["selling_price"] += row["selling_price"]

    summary = []
    for (year, location) in sorted(grouped.keys()):
        g = grouped[(year, location)]
        profit = g["selling_price"] - g["cost"]
        summary.append({
            "year": year,
            "location": location,
            "man_hours": g["man_hours"],
            "cost": g["cost"],
            "selling_price": g["selling_price"],
            "hourly_cost": g["cost"] / g["man_hours"] if g["man_hours"] != 0 else 0.0,
            "hourly_rate": g["selling_price"] / g["man_hours"] if g["man_hours"] != 0 else 0.0,
            "profit": profit,
            "profit_pct": (profit / g["selling_price"] * 100) if g["selling_price"] != 0 else 0.0,
        })
    return summary


def generate_cost_profit_overall(summary: list[dict]) -> list[dict]:
    """Overall (all-locations) row per year, as shown in the Excel report."""
    by_year: dict[str, list[dict]] = defaultdict(list)
    for row in summary:
        by_year[row["year"]].append(row)

    overall = []
    for year in sorted(by_year):
        rows = by_year[year]
        man_hours = sum(r["man_hours"] for r in rows)
        cost = sum(r["cost"] for r in rows)
        selling = sum(r["selling_price"] for r in rows)
        profit = selling - cost
        overall.append({
            "year": year,
            "man_hours": man_hours,
            "cost": cost,
            "selling_price": selling,
            "hourly_cost": cost / man_hours if man_hours > 0 else 0.0,
            "hourly_rate": selling / man_hours if man_hours > 0 else 0.0,
            "profit": profit,
            "profit_pct": (profit / selling * 100) if selling > 0 else 0.0,
        })
    return overall


def generate_ticket_analysis(project: models.Project, budget_rows: list[dict]) -> list[dict]:
    """Ticket analysis: expected tickets and revenue per year and size."""
    rates = get_rate_config(project)
    risk_factor = rates["risk_factor_pct"] / 100.0

    yearly_totals: dict[str, dict] = defaultdict(
        lambda: {"man_hours": 0.0, "selling_price": 0.0}
    )
    for row in budget_rows:
        yearly_totals[row["year"]]["man_hours"] += row["man_hours"]
        yearly_totals[row["year"]]["selling_price"] += row["selling_price"]

    ticket_rows = []
    for year in sorted(yearly_totals):
        year_int = int(year)
        total_man_hours = yearly_totals[year]["man_hours"]
        total_price = yearly_totals[year]["selling_price"]
        base_hourly_rate = total_price / total_man_hours if total_man_hours > 0 else 0.0
        final_hourly_rate = base_hourly_rate * (1 + risk_factor) + rates["hw_cost_per_hour"]

        for size, story_points in rates["ticket_story_points"].items():
            hours_per_ticket = story_points * rates["sp_to_hours"]
            quota_pct = rates["ticket_quotas"].get(year_int, {}).get(size, 0.0) / 100.0

            if hours_per_ticket > 0:
                num_tickets = (total_man_hours * quota_pct) / hours_per_ticket
            else:
                num_tickets = 0.0

            total_hours = num_tickets * hours_per_ticket
            revenue = total_hours * final_hourly_rate

            ticket_rows.append({
                "year": year,
                "size": size.title(),
                "story_points": story_points,
                "hours_per_ticket": hours_per_ticket,
                "num_tickets": round(num_tickets, 2),
                "total_hours": round(total_hours, 2),
                "hourly_rate": round(final_hourly_rate, 2),
                "revenue": round(revenue, 2),
            })
    return ticket_rows


def generate_ticket_overall(ticket_rows: list[dict], cost_profit_summary: list[dict]) -> list[dict]:
    """Per-year overall ticket revenue and profit vs. resource cost."""
    revenue_by_year: dict[str, float] = defaultdict(float)
    for row in ticket_rows:
        revenue_by_year[row["year"]] += row["revenue"]

    cost_by_year: dict[str, float] = defaultdict(float)
    for row in cost_profit_summary:
        cost_by_year[row["year"]] += row["cost"]

    overall = []
    for year in sorted(revenue_by_year):
        revenue = revenue_by_year[year]
        cost = cost_by_year.get(year, 0.0)
        profit = revenue - cost
        overall.append({
            "year": year,
            "revenue": revenue,
            "cost": cost,
            "profit": profit,
            "profit_pct": (profit / revenue * 100) if revenue > 0 else 0.0,
        })
    return overall


def _pivot_by_year(rows: list[dict], value_key: str) -> list[dict]:
    """Build per-year pivot tables (Feature/Role/Location/Level x Month)
    with a Total column, per-location subtotal rows and a grand total row."""
    years = sorted({row["year"] for row in rows})
    pivots = []

    for year in years:
        year_rows = [r for r in rows if r["year"] == year]
        month_cols = sorted({r["month"] for r in year_rows})

        grouped: dict[tuple, dict[str, float]] = {}
        for r in year_rows:
            key = (r["feature"], r["role"], r["location"], r["level"])
            if key not in grouped:
                grouped[key] = {m: 0.0 for m in month_cols}
            grouped[key][r["month"]] += r[value_key]

        data_rows = []
        for key in sorted(grouped.keys()):
            feature, role, location, level = key
            values = grouped[key]
            row = {
                "Feature": feature,
                "Role": role,
                "Location": location,
                "Level": level,
            }
            for m in month_cols:
                row[m] = values[m]
            row["Total"] = sum(values.values())
            data_rows.append(row)

        # Location subtotals
        locations = []
        for row in data_rows:
            if row["Location"] not in locations:
                locations.append(row["Location"])

        subtotal_rows = []
        for location in locations:
            loc_rows = [r for r in data_rows if r["Location"] == location]
            sub = {
                "Feature": f"TOTAL - {location}",
                "Role": "",
                "Location": location,
                "Level": "",
            }
            for m in month_cols + ["Total"]:
                sub[m] = sum(r[m] for r in loc_rows)
            subtotal_rows.append(sub)

        # Grand total
        grand = {"Feature": "TOTAL", "Role": "", "Location": "", "Level": ""}
        for m in month_cols + ["Total"]:
            grand[m] = sum(r[m] for r in data_rows)

        pivots.append({
            "year": year,
            "columns": ["Feature", "Role", "Location", "Level"] + month_cols + ["Total"],
            "rows": data_rows + subtotal_rows + [grand],
        })
    return pivots


def generate_resource_pivots(project: models.Project, months: list[str]) -> list[dict]:
    """Per-year FTE pivot tables for the resource plan."""
    rows = []
    for month in months:
        for feature in project.features:
            for role in feature.roles:
                rows.append({
                    "month": month,
                    "year": month[:4],
                    "feature": feature.name,
                    "role": role.name,
                    "location": role.location,
                    "level": role.level,
                    "ftes": get_ftes_for_month(role, month),
                })
    return _pivot_by_year(rows, "ftes")


def generate_budget_pivots(budget_rows: list[dict]) -> list[dict]:
    """Per-year selling-price pivot tables for the budget plan."""
    return _pivot_by_year(budget_rows, "selling_price")


def compress_monthly_ftes(months: list[str], values: list[float]) -> dict:
    """Compress a per-month FTE series into the role storage model.

    Returns {"fixed": fte} when every month has the same value, otherwise
    {"periods": [(start_month, end_month, fte), ...]} with consecutive
    equal non-zero values merged into single periods.
    """
    if not months:
        return {"fixed": 0.0}

    if all(v == values[0] for v in values):
        return {"fixed": values[0]}

    periods = []
    run_start = 0
    for i in range(1, len(months) + 1):
        if i == len(months) or values[i] != values[run_start]:
            if values[run_start] != 0:
                periods.append((months[run_start], months[i - 1], values[run_start]))
            run_start = i
    return {"periods": periods}


def validate_project(project: models.Project) -> list[str]:
    """Full project validation ported from the desktop models."""
    errors = []

    if not project.name.strip():
        errors.append("Project name is required")
    if not project.company.strip():
        errors.append("Company name is required")
    if not (1 <= project.start_month <= 12):
        errors.append("Start month must be between 1 and 12")
    if not (1 <= project.end_month <= 12):
        errors.append("End month must be between 1 and 12")
    if (project.end_year < project.start_year or
            (project.end_year == project.start_year and
             project.end_month < project.start_month)):
        errors.append("End date must be after start date")
    if not project.features:
        errors.append("At least one feature is required")

    for i, feature in enumerate(project.features):
        prefix = f"Feature {i + 1} ({feature.name})"
        if not feature.name.strip():
            errors.append(f"Feature {i + 1}: Feature name is required")
        if not feature.roles:
            errors.append(f"{prefix}: At least one role is required")

        for j, role in enumerate(feature.roles):
            role_prefix = f"{prefix}, Role {j + 1} ({role.name})"
            if not role.name.strip():
                errors.append(f"{prefix}, Role {j + 1}: Role name is required")

            if not role.use_advanced_allocation:
                if role.ftes < 0:
                    errors.append(f"{role_prefix}: FTEs cannot be negative")
                if role.ftes > 2.0:
                    errors.append(
                        f"{role_prefix}: FTEs cannot exceed 2.0 for fixed allocation "
                        "(use variable periods for higher values)"
                    )
            else:
                if not role.allocations:
                    errors.append(
                        f"{role_prefix}: Advanced allocation requires at least one period"
                    )
                for k, alloc in enumerate(role.allocations):
                    if alloc.ftes < 0:
                        errors.append(f"{role_prefix}, Period {k + 1}: FTEs cannot be negative")
                    if alloc.ftes > 2.0:
                        errors.append(
                            f"{role_prefix}, Period {k + 1}: FTEs seems unusually high (>2.0)"
                        )
                    if alloc.start_month > alloc.end_month:
                        errors.append(
                            f"{role_prefix}, Period {k + 1}: Start month must be before "
                            "or equal to end month"
                        )
                sorted_periods = sorted(role.allocations, key=lambda a: a.start_month)
                for k in range(len(sorted_periods) - 1):
                    current = sorted_periods[k]
                    nxt = sorted_periods[k + 1]
                    if current.end_month >= nxt.start_month:
                        errors.append(
                            f"{role_prefix}: Overlapping periods: "
                            f"{current.end_month} and {nxt.start_month}"
                        )
    return errors
