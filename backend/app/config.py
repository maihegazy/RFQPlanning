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

# RFQ lifecycle statuses
PROJECT_STATUSES = ["draft", "quoted", "won", "lost"]

# ASPICE process areas used for hardware/tool planning
ASPICE_PROCESSES = [
    "SYS.1", "SYS.2", "SYS.3", "SYS.4", "SYS.5",
    "SWE.1", "SWE.2", "SWE.3", "SWE.4", "SWE.5", "SWE.6",
    "SUP.1", "SUP.8", "SUP.9", "SUP.10",
    "MAN.3",
]

# Billing modes for hardware/tool items
HARDWARE_BILLING = ["yearly", "once"]

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
