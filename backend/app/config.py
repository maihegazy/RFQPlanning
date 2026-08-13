"""Application configuration and domain constants."""

import os

# Job levels in hierarchy order
LEVELS = ["PM/TL", "FO", "Principal", "Senior", "Standard", "Junior"]

# Office locations
LOCATIONS = ["BCC", "HCC", "MCC"]

# Standard working hours per full-time equivalent per month
HOURS_PER_FTE_PER_MONTH = 160

# Ticket sizes
TICKET_SIZES = ["small", "medium", "large"]

# Default rate-configuration values
DEFAULT_SP_TO_HOURS = 4.0
DEFAULT_HW_COST_PER_HOUR = 0.0
DEFAULT_RISK_FACTOR_PCT = 0.0

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://rfq:rfq@localhost:5432/rfqplanner",
)

CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", "*").split(",")
    if origin.strip()
]
