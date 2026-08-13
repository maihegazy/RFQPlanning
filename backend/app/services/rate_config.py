"""Helpers to read/write a project's rate configuration."""

from sqlalchemy.orm import Session

from .. import models
from ..config import LEVELS, LOCATIONS, TICKET_SIZES


def get_rate_config(project: models.Project) -> dict:
    """Assemble a project's full rate configuration as a plain dict."""
    hourly_rates = {loc: 0.0 for loc in LOCATIONS}
    for hr in project.hourly_rates:
        hourly_rates[hr.location] = hr.rate

    cost_rates = {loc: {lvl: 0.0 for lvl in LEVELS} for loc in LOCATIONS}
    for cr in project.cost_rates:
        cost_rates.setdefault(cr.location, {})[cr.level] = cr.rate

    ticket_story_points = {size: 0.0 for size in TICKET_SIZES}
    ticket_prices = {size: 0.0 for size in TICKET_SIZES}
    for tc in project.ticket_configs:
        ticket_story_points[tc.size] = tc.story_points
        ticket_prices[tc.size] = tc.price

    ticket_quotas: dict[int, dict[str, float]] = {}
    for tq in project.ticket_quotas:
        ticket_quotas.setdefault(tq.year, {size: 0.0 for size in TICKET_SIZES})
        ticket_quotas[tq.year][tq.size] = tq.quota_pct

    return {
        "hourly_rates": hourly_rates,
        "cost_rates": cost_rates,
        "sp_to_hours": project.sp_to_hours,
        "hw_cost_per_hour": project.hw_cost_per_hour,
        "risk_factor_pct": project.risk_factor_pct,
        "ticket_story_points": ticket_story_points,
        "ticket_prices": ticket_prices,
        "ticket_quotas": ticket_quotas,
    }


def update_rate_config(db: Session, project: models.Project, data) -> None:
    """Apply a partial rate-configuration update to a project."""
    if data.sp_to_hours is not None:
        project.sp_to_hours = data.sp_to_hours
    if data.hw_cost_per_hour is not None:
        project.hw_cost_per_hour = data.hw_cost_per_hour
    if data.risk_factor_pct is not None:
        project.risk_factor_pct = data.risk_factor_pct

    if data.hourly_rates is not None:
        existing = {hr.location: hr for hr in project.hourly_rates}
        for loc, rate in data.hourly_rates.items():
            if loc in existing:
                existing[loc].rate = rate
            else:
                db.add(models.HourlyRate(project_id=project.id, location=loc, rate=rate))

    if data.cost_rates is not None:
        existing = {(cr.location, cr.level): cr for cr in project.cost_rates}
        for loc, levels in data.cost_rates.items():
            for lvl, rate in levels.items():
                if (loc, lvl) in existing:
                    existing[(loc, lvl)].rate = rate
                else:
                    db.add(models.CostRate(
                        project_id=project.id, location=loc, level=lvl, rate=rate
                    ))

    if data.ticket_story_points is not None or data.ticket_prices is not None:
        existing = {tc.size: tc for tc in project.ticket_configs}
        sizes = set()
        if data.ticket_story_points:
            sizes.update(data.ticket_story_points)
        if data.ticket_prices:
            sizes.update(data.ticket_prices)
        for size in sizes:
            tc = existing.get(size)
            if tc is None:
                tc = models.TicketConfig(project_id=project.id, size=size)
                db.add(tc)
            if data.ticket_story_points is not None and size in data.ticket_story_points:
                tc.story_points = data.ticket_story_points[size]
            if data.ticket_prices is not None and size in data.ticket_prices:
                tc.price = data.ticket_prices[size]

    if data.ticket_quotas is not None:
        # Replace quotas wholesale: the payload is the full quota table
        for tq in list(project.ticket_quotas):
            db.delete(tq)
        db.flush()
        for year, sizes in data.ticket_quotas.items():
            for size, pct in sizes.items():
                db.add(models.TicketQuota(
                    project_id=project.id, year=year, size=size, quota_pct=pct
                ))
