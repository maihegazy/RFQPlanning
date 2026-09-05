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

# Hardware management vocabularies (from the HW purchasing working document).
# These populate dropdowns only; the registers still accept free text.
HW_PURCHASE_TYPES = ["Purchase", "Leasing", "Planned Purchase", "Not Purchased"]

HW_ASSET_STATUSES = ["In Stock", "Labeled", "Labeled Deployed", "Return", "Depreciation"]

HW_ASSET_CATEGORIES = [
    "Board", "Dongle", "ECU", "Flexray/CAN Interface",
    "Lauterbach debugger", "PC", "Power supply",
    "ProgrammablePower supply", "Server / PC", "Vector Box",
]

HW_LICENSE_CATEGORIES = [
    "Compiler", "Debugger License", "Dongles license",
    "Floating License", "Maintenance",
]

# A hardware budget is either one approved number or a split by type.
HW_BUDGET_MODES = ["split", "overall"]

# The working document amortises leasing over a fixed 36 months, independent of
# the actual contract length.
HW_LEASING_MONTHS = 36

# Dates outside this window are treated as typos rather than data: they neither
# widen a register's year span nor count towards any year, and the importer
# refuses to read a bare number in a date column as a year 1905 serial.
DATE_WINDOW_YEARS = (1990, 2100)

# Upper bounds that keep a typo or an overflow probe out of the database
# (PostgreSQL's int4 stops at 2,147,483,647; money past a trillion is never real).
MAX_MONEY = 1_000_000_000_000.0
MAX_QUANTITY = 1_000_000

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
