"""Date utility functions (ported from the desktop app)."""

import datetime


def get_month_list(start_year: int, start_month: int,
                   end_year: int, end_month: int) -> list[str]:
    """Generate list of months in YYYY-MM format between start and end dates."""
    try:
        start_date = datetime.date(start_year, start_month, 1)
        end_date = datetime.date(end_year, end_month, 1)
    except ValueError:
        return []

    if start_date > end_date:
        return []

    months = []
    current = start_date
    while current <= end_date:
        months.append(current.strftime("%Y-%m"))
        if current.month == 12:
            current = datetime.date(current.year + 1, 1, 1)
        else:
            current = datetime.date(current.year, current.month + 1, 1)
    return months


def format_month(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def months_between(start_year: int, start_month: int,
                   end_year: int, end_month: int) -> int:
    """Number of months between two dates (inclusive)."""
    return (end_year - start_year) * 12 + (end_month - start_month) + 1
