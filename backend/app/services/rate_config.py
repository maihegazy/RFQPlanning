"""Helpers to read/write a project's non-monetary rate configuration.

Monetary values (hourly sell rates, cost rates, hardware cost per hour,
ticket prices) are end-to-end encrypted and never handled in plaintext by
the server — see routers/vault.py. Only effort-related configuration lives
here: SP conversion, risk factor, ticket story points and quotas.
"""

from sqlalchemy.orm import Session

from .. import models
from ..config import TICKET_SIZES


def get_rate_config(project: models.Project) -> dict:
    """Assemble a project's non-monetary configuration as a plain dict."""
    ticket_story_points = {size: 0.0 for size in TICKET_SIZES}
    for tc in project.ticket_configs:
        ticket_story_points[tc.size] = tc.story_points

    ticket_quotas: dict[int, dict[str, float]] = {}
    for tq in project.ticket_quotas:
        ticket_quotas.setdefault(tq.year, {size: 0.0 for size in TICKET_SIZES})
        ticket_quotas[tq.year][tq.size] = tq.quota_pct

    return {
        "sp_to_hours": project.sp_to_hours,
        "risk_factor_pct": project.risk_factor_pct,
        "ticket_story_points": ticket_story_points,
        "ticket_quotas": ticket_quotas,
        "version": project.version,
    }


def update_rate_config(db: Session, project: models.Project, data) -> None:
    """Apply a partial non-monetary configuration update to a project."""
    if data.sp_to_hours is not None:
        project.sp_to_hours = data.sp_to_hours
    if data.risk_factor_pct is not None:
        project.risk_factor_pct = data.risk_factor_pct

    if data.ticket_story_points is not None:
        existing = {tc.size: tc for tc in project.ticket_configs}
        for size, sp in data.ticket_story_points.items():
            tc = existing.get(size)
            if tc is None:
                tc = models.TicketConfig(project_id=project.id, size=size)
                db.add(tc)
            tc.story_points = sp

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


def get_legacy_plaintext_money(project: models.Project) -> dict:
    """Read money values from the legacy plaintext tables (pre-encryption).

    Used once per project to migrate into the encrypted blob; afterwards
    the plaintext is purged.
    """
    hourly_rates = {hr.location: hr.rate for hr in project.hourly_rates}
    cost_rates: dict[str, dict[str, float]] = {}
    for cr in project.cost_rates:
        cost_rates.setdefault(cr.location, {})[cr.level] = cr.rate
    ticket_prices = {tc.size: tc.price for tc in project.ticket_configs}
    return {
        "hourly_rates": hourly_rates,
        "cost_rates": cost_rates,
        "hw_cost_per_hour": project.hw_cost_per_hour,
        "ticket_prices": ticket_prices,
    }


def purge_legacy_plaintext_money(db: Session, project: models.Project) -> None:
    """Remove all plaintext money values for a project after migration."""
    for hr in list(project.hourly_rates):
        db.delete(hr)
    for cr in list(project.cost_rates):
        db.delete(cr)
    for tc in project.ticket_configs:
        tc.price = 0.0
    project.hw_cost_per_hour = 0.0
