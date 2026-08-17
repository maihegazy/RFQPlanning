"""Effort calculations (time-aware FTE allocation, resource pivots).

Monetary calculations (cost-profit, ticket revenue, budget pivots) run
exclusively in the browser against end-to-end encrypted money data — see
frontend/src/money/engine.ts, which mirrors the same row/pivot structure.
"""

from .. import models
from .date_utils import get_month_list


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

    # Ticket quotas: per-year totals cannot exceed 100% of man-hours
    quotas_by_year: dict[int, float] = {}
    for tq in project.ticket_quotas:
        if tq.quota_pct < 0 or tq.quota_pct > 100:
            errors.append(
                f"Ticket quota for {tq.size} in {tq.year} must be between 0 and 100%"
            )
        quotas_by_year[tq.year] = quotas_by_year.get(tq.year, 0.0) + tq.quota_pct
    for year, total in sorted(quotas_by_year.items()):
        if total > 100:
            errors.append(
                f"Ticket quotas for {year} sum to {total:g}% — "
                "the total per year cannot exceed 100%"
            )
    return errors
