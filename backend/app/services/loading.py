"""Eager-loading options for the aggregate endpoints.

Every list that walks a project tree used to lazy-load features, roles and
periods (or assets, licenses and adjustments) one query at a time, so a
portfolio of a hundred projects cost thousands of queries. `selectinload`
fetches each level in one IN query per level, whatever the project count.
"""

from sqlalchemy.orm import selectinload

from .. import models


def project_tree():
    """Features, roles and their periods: what the resource plan and capacity read."""
    return (
        selectinload(models.Project.features)
        .selectinload(models.Feature.roles)
        .selectinload(models.Role.allocations)
    )


def project_registers():
    """Everything a hardware project's summary and rollup read."""
    return (
        selectinload(models.HwProject.assets),
        selectinload(models.HwProject.licenses),
        selectinload(models.HwProject.adjustments),
    )


def hardware_plan():
    """The plan rows and the catalog entries they point at."""
    return selectinload(models.Project.hardware_items).selectinload(
        models.HardwareItem.catalog_item
    )
