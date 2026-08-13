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
