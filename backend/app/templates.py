"""Built-in project templates for software development RFQs.

Each template defines a set of features with pre-configured roles, plus a
"Project Management" feature holding the project-level PL / TL / Integrator
roles. All roles start as fixed 1.0 FTE allocations and can be edited after
the project is created.
"""

# (role name, location, level, ftes)
STANDARD_FEATURE_ROLES = [
    ("Developer", "BCC", "FO", 1.0),
    ("Tester", "BCC", "Standard", 1.0),
    ("Developer", "BCC", "Junior", 1.0),
]

SAFETY_FEATURE_ROLES = [
    ("Developer", "BCC", "FO", 1.0),
    ("Developer", "BCC", "Principal", 1.0),
]

PROJECT_MANAGEMENT_FEATURE = {
    "name": "Project Management",
    "roles": [
        ("Project Lead (PL)", "BCC", "PM/TL", 1.0),
        ("Technical Lead (TL)", "BCC", "PM/TL", 1.0),
        ("Integrator", "BCC", "Senior", 1.0),
    ],
}

TEMPLATES = [
    {
        "id": "basic-software",
        "name": "Basic Software Development Package",
        "description": (
            "Full basic-software stack: Network, Cyber Security, Functional "
            "Safety, Diagnostics, Programming, Life Cycle and Calibration — "
            "each staffed with an FO developer, a standard tester and a junior "
            "developer, plus PL, TL and Integrator."
        ),
        "features": [
            {"name": name, "roles": STANDARD_FEATURE_ROLES}
            for name in [
                "Network",
                "Cyber Security",
                "Functional Safety",
                "Diagnostics",
                "Programming",
                "Life Cycle",
                "Calibration",
            ]
        ] + [PROJECT_MANAGEMENT_FEATURE],
    },
    {
        "id": "application-software",
        "name": "Application Software Development Package",
        "description": (
            "Two application features, each staffed with an FO developer, a "
            "standard tester and a junior developer, plus PL, TL and Integrator."
        ),
        "features": [
            {"name": "Application Feature 1", "roles": STANDARD_FEATURE_ROLES},
            {"name": "Application Feature 2", "roles": STANDARD_FEATURE_ROLES},
            PROJECT_MANAGEMENT_FEATURE,
        ],
    },
    {
        "id": "safety",
        "name": "Safety Development Package",
        "description": (
            "Safety Analysis and Safety Enhancement features, each staffed "
            "with an FO developer and a principal developer, plus PL, TL and "
            "Integrator."
        ),
        "features": [
            {"name": "Safety Analysis", "roles": SAFETY_FEATURE_ROLES},
            {"name": "Safety Enhancement", "roles": SAFETY_FEATURE_ROLES},
            PROJECT_MANAGEMENT_FEATURE,
        ],
    },
]


def get_template(template_id: str) -> dict | None:
    return next((t for t in TEMPLATES if t["id"] == template_id), None)


def normalize_roles(feature_def: dict) -> list[dict]:
    """Roles of a template feature as dicts (built-ins store tuples)."""
    roles = []
    for role in feature_def["roles"]:
        if isinstance(role, dict):
            roles.append(role)
        else:
            name, location, level, ftes = role
            roles.append({"name": name, "location": location,
                          "level": level, "ftes": ftes})
    return roles


def resolve_template(db, template_id: str) -> dict | None:
    """Resolve a built-in ('basic-software') or custom ('custom-<id>')
    template to {"features": [{"name", "roles": [dict, ...]}]}."""
    import json

    from . import models

    if template_id.startswith("custom-"):
        try:
            custom_id = int(template_id.removeprefix("custom-"))
        except ValueError:
            return None
        record = db.get(models.CustomTemplate, custom_id)
        if record is None:
            return None
        return {"features": json.loads(record.features_json)}

    template = get_template(template_id)
    if template is None:
        return None
    return {
        "features": [
            {"name": f["name"], "roles": normalize_roles(f)}
            for f in template["features"]
        ],
    }
