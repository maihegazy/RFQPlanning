"""Deep-clone a project (for scenarios and plain duplicates)."""

from sqlalchemy.orm import Session

from .. import models


def clone_project(db: Session, source: models.Project, name: str,
                  base_project_id: int | None) -> models.Project:
    """Deep-copy a project: features, roles, allocations, non-monetary
    config and the encrypted money blob (same DEK, so it stays readable
    by the vault owner). Returns the new project (flushed, not committed).
    """
    clone = models.Project(
        name=name,
        company=source.company,
        start_year=source.start_year,
        start_month=source.start_month,
        end_year=source.end_year,
        end_month=source.end_month,
        sp_to_hours=source.sp_to_hours,
        hw_cost_per_hour=source.hw_cost_per_hour,
        risk_factor_pct=source.risk_factor_pct,
        encrypted_money=source.encrypted_money,
        money_iv=source.money_iv,
        status=source.status,
        win_probability_pct=source.win_probability_pct,
        lost_reason=source.lost_reason,
        base_project_id=base_project_id,
        is_winning_scenario=False,
    )
    db.add(clone)
    db.flush()

    for feature in source.features:
        new_feature = models.Feature(project_id=clone.id, name=feature.name)
        db.add(new_feature)
        db.flush()
        for role in feature.roles:
            new_role = models.Role(
                feature_id=new_feature.id,
                name=role.name,
                location=role.location,
                level=role.level,
                ftes=role.ftes,
                use_advanced_allocation=role.use_advanced_allocation,
            )
            db.add(new_role)
            db.flush()
            for alloc in role.allocations:
                db.add(models.AllocationPeriod(
                    role_id=new_role.id,
                    start_month=alloc.start_month,
                    end_month=alloc.end_month,
                    ftes=alloc.ftes,
                ))

    for tc in source.ticket_configs:
        db.add(models.TicketConfig(
            project_id=clone.id, size=tc.size,
            story_points=tc.story_points, price=tc.price,
        ))
    for hw in source.hardware_items:
        db.add(models.HardwareItem(
            project_id=clone.id,
            catalog_item_id=hw.catalog_item_id,
            name=hw.name,
            aspice=hw.aspice,
            billing=hw.billing,
            unit_cost=hw.unit_cost,
            qty=hw.qty,
            years_json=hw.years_json,
            supplier_name=hw.supplier_name,
            supplier_email=hw.supplier_email,
        ))
    for tq in source.ticket_quotas:
        db.add(models.TicketQuota(
            project_id=clone.id, year=tq.year, size=tq.size,
            quota_pct=tq.quota_pct,
        ))

    db.flush()
    return clone
