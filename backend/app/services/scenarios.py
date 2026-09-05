"""Which project of a scenario family speaks for it.

A base project and its scenarios are alternatives for the same quotation. Once
one of them is marked as the winner it is the figure the portfolio, the
weighted revenue and the capacity heatmap should carry; until then the base
project stands in for the family.
"""

from .. import models


def effective_projects(projects: list[models.Project]) -> list[models.Project]:
    """One project per family, in the order the families first appear.

    The winning scenario when one is marked (the base itself can be the
    winner), otherwise the base project. A scenario whose base is missing from
    `projects` only counts when it is the winner.
    """
    families: dict[int, list[models.Project]] = {}
    for project in projects:
        families.setdefault(project.base_project_id or project.id, []).append(project)

    chosen: list[models.Project] = []
    for base_id, members in families.items():
        winner = next((m for m in members if m.is_winning_scenario), None)
        base = next((m for m in members if m.id == base_id), None)
        pick = winner or base
        if pick is not None:
            chosen.append(pick)
    return chosen
