"""Costing of the per-project hardware plan (the Hardware tab's rows).

Shared by the plan endpoint and the rate configuration: the cost-profit
analysis runs in the browser on decrypted money, and it reads the plan's
per-year totals off the rate configuration so it can carry them as a
non-labor row without a second request.
"""

import json

from .. import models


def item_years(item: models.HardwareItem) -> list[int]:
    """The project years a hardware row applies to, from its JSON column."""
    try:
        years = json.loads(item.years_json or "[]")
    except ValueError:
        return []
    return sorted({int(year) for year in years})


def item_total(item: models.HardwareItem) -> float:
    """Yearly items cost unit_cost x qty for every selected year; a one-time
    purchase costs unit_cost x qty once (in its selected purchase year)."""
    occurrences = 1 if item.billing == "once" else len(item_years(item))
    return round(item.unit_cost * item.qty * occurrences, 2)


def item_year_costs(item: models.HardwareItem, start_year: int) -> dict[int, float]:
    """Cost the item contributes to each year."""
    years = item_years(item)
    per_unit = round(item.unit_cost * item.qty, 2)
    if item.billing == "once":
        # A one-time purchase lands in its selected year (or the project
        # start year when no year was picked).
        return {years[0] if years else start_year: per_unit}
    return {year: per_unit for year in years}


def plan_costs_per_year(project: models.Project) -> dict[int, float]:
    """The plan's total per project year, rows outside the timeline left out."""
    per_year: dict[int, float] = {}
    for item in project.hardware_items:
        for year, cost in item_year_costs(item, project.start_year).items():
            if project.start_year <= year <= project.end_year:
                per_year[year] = round(per_year.get(year, 0.0) + cost, 2)
    return dict(sorted(per_year.items()))
