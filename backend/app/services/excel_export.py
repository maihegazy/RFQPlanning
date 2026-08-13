"""Excel report generation (ported from the desktop ExcelService).

Reports are written to an in-memory buffer with xlsxwriter and streamed
to the client, preserving the original workbook layout and formatting.
"""

import io

import xlsxwriter

from .. import models
from .rate_config import get_rate_config

TEXT_COL_COUNT = 4  # Feature, Role, Location, Level


def _sanitize_sheet_name(name: str) -> str:
    for char in [':', '\\', '/', '?', '*', '[', ']']:
        name = name.replace(char, '_')
    return name[:31]


def _write_pivot_sheet(workbook, sheet_name: str, pivot: dict, num_format: str):
    worksheet = workbook.add_worksheet(_sanitize_sheet_name(sheet_name))

    header_format = workbook.add_format({
        'bold': True, 'bg_color': '#FFFF00', 'font_color': 'black',
        'border': 1, 'align': 'center', 'valign': 'vcenter',
    })
    total_format = workbook.add_format({
        'bold': True, 'bg_color': '#D3D3D3', 'border': 1, 'num_format': num_format,
    })
    number_format = workbook.add_format({
        'num_format': num_format, 'border': 1, 'align': 'center',
    })
    text_format = workbook.add_format({'border': 1, 'align': 'left'})

    columns = pivot["columns"]
    for col, header in enumerate(columns):
        worksheet.write(0, col, header, header_format)

    col_widths = [len(str(c)) for c in columns]
    for row_idx, row in enumerate(pivot["rows"], start=1):
        is_total_row = str(row.get("Feature", "")).startswith("TOTAL")
        for col_idx, col_name in enumerate(columns):
            value = row.get(col_name, "")
            col_widths[col_idx] = max(col_widths[col_idx], len(str(value)))
            if col_idx < TEXT_COL_COUNT:
                fmt = total_format if is_total_row else text_format
            else:
                fmt = total_format if is_total_row else number_format
            worksheet.write(row_idx, col_idx, value, fmt)

    for idx, width in enumerate(col_widths):
        worksheet.set_column(idx, idx, width + 2)


def build_resource_plan_xlsx(pivots: list[dict]) -> bytes:
    buffer = io.BytesIO()
    workbook = xlsxwriter.Workbook(buffer, {'in_memory': True})
    for pivot in pivots:
        _write_pivot_sheet(workbook, pivot["year"], pivot, '#,##0.0')
    workbook.close()
    return buffer.getvalue()


def build_budget_plan_xlsx(project: models.Project,
                           cost_profit_summary: list[dict],
                           ticket_analysis: list[dict],
                           yearly_pivots: list[dict]) -> bytes:
    buffer = io.BytesIO()
    workbook = xlsxwriter.Workbook(buffer, {'in_memory': True})

    _write_config_sheet(workbook, project)
    _write_cost_profit_sheet(workbook, cost_profit_summary, ticket_analysis)
    for pivot in yearly_pivots:
        _write_pivot_sheet(workbook, pivot["year"], pivot, '#,##0.00')

    workbook.close()
    return buffer.getvalue()


def _write_cost_profit_sheet(workbook, cost_profit_summary: list[dict],
                             ticket_analysis: list[dict]):
    worksheet = workbook.add_worksheet("CostProfit")

    header_format = workbook.add_format({
        'bold': True, 'bg_color': '#FFFF00', 'font_color': 'black',
        'border': 1, 'align': 'center', 'valign': 'vcenter',
    })
    title_format = workbook.add_format({
        'bold': True, 'font_size': 14, 'font_color': '#1F2937',
    })
    number_format = workbook.add_format({
        'num_format': '#,##0.00', 'border': 1, 'align': 'center',
    })
    percent_format = workbook.add_format({
        'num_format': '0.00%', 'border': 1, 'align': 'center',
    })
    text_format = workbook.add_format({'border': 1, 'align': 'center'})
    euro_format = workbook.add_format({
        'num_format': '#,##0.00 "€"', 'border': 1, 'align': 'center',
    })
    overall_euro_format = workbook.add_format({
        'bold': True, 'bg_color': '#90EE90', 'border': 1,
        'align': 'center', 'num_format': '#,##0.00 "€"',
    })
    overall_green_format = workbook.add_format({
        'bold': True, 'bg_color': '#90EE90', 'border': 1, 'align': 'center',
    })
    overall_percent_format = workbook.add_format({
        'bold': True, 'bg_color': '#90EE90', 'border': 1,
        'align': 'center', 'num_format': '0.00%',
    })
    profit_format = workbook.add_format({
        'bold': True, 'bg_color': '#FFB6C1', 'border': 1, 'align': 'center',
    })
    profit_percent_format = workbook.add_format({
        'bold': True, 'bg_color': '#FFB6C1', 'border': 1,
        'align': 'center', 'num_format': '0.00%',
    })

    current_row = 0
    worksheet.write(current_row, 0, "Cost-Profit Summary by Year and Location", title_format)
    current_row += 2

    years = sorted({row["year"] for row in cost_profit_summary})
    for year in years:
        year_data = [r for r in cost_profit_summary if r["year"] == year]

        headers = ["Year", "Location", "ManHours", "Cost", "SellingPrice",
                   "HourlyCost", "HourlyRate", "Profit", "Profit%"]
        for col, header in enumerate(headers):
            worksheet.write(current_row, col, header, header_format)
        current_row += 1

        for idx, row in enumerate(year_data):
            worksheet.write(current_row, 0, row["year"] if idx == 0 else "", text_format)
            worksheet.write(current_row, 1, row["location"], text_format)
            worksheet.write(current_row, 2, row["man_hours"], number_format)
            worksheet.write(current_row, 3, row["cost"], euro_format)
            worksheet.write(current_row, 4, row["selling_price"], euro_format)
            worksheet.write(current_row, 5, row["hourly_cost"], euro_format)
            worksheet.write(current_row, 6, row["hourly_rate"], euro_format)
            worksheet.write(current_row, 7, row["profit"], euro_format)
            worksheet.write(current_row, 8, row["profit_pct"] / 100, percent_format)
            current_row += 1

        total_manhours = sum(r["man_hours"] for r in year_data)
        total_cost = sum(r["cost"] for r in year_data)
        total_selling = sum(r["selling_price"] for r in year_data)
        overall_hourly_cost = total_cost / total_manhours if total_manhours > 0 else 0
        overall_hourly_rate = total_selling / total_manhours if total_manhours > 0 else 0
        overall_profit = total_selling - total_cost
        overall_profit_pct = (overall_profit / total_selling * 100) if total_selling > 0 else 0

        worksheet.write(current_row, 0, "Overall", overall_green_format)
        worksheet.write(current_row, 1, "", overall_green_format)
        worksheet.write(current_row, 2, total_manhours, overall_green_format)
        worksheet.write(current_row, 3, total_cost, overall_euro_format)
        worksheet.write(current_row, 4, total_selling, overall_euro_format)
        worksheet.write(current_row, 5, overall_hourly_cost, overall_euro_format)
        worksheet.write(current_row, 6, overall_hourly_rate, overall_euro_format)
        worksheet.write(current_row, 7, overall_profit, overall_euro_format)
        worksheet.write(current_row, 8, overall_profit_pct / 100, overall_percent_format)
        current_row += 3

    # Ticket Analysis section
    current_row += 2
    worksheet.write(current_row, 0, "Ticket Analysis", title_format)
    current_row += 2

    ticket_years = sorted({row["year"] for row in ticket_analysis})
    for year in ticket_years:
        year_data = [r for r in ticket_analysis if r["year"] == year]

        ticket_headers = ["Year", "Size", "StoryPoints", "HoursPerTicket",
                          "NumTickets", "TotalHours", "HourlyRate", "Revenue"]
        for col, header in enumerate(ticket_headers):
            worksheet.write(current_row, col, header, header_format)
        current_row += 1

        for idx, row in enumerate(year_data):
            worksheet.write(current_row, 0, row["year"] if idx == 0 else "", text_format)
            worksheet.write(current_row, 1, row["size"], text_format)
            worksheet.write(current_row, 2, row["story_points"], number_format)
            worksheet.write(current_row, 3, row["hours_per_ticket"], number_format)
            worksheet.write(current_row, 4, row["num_tickets"], number_format)
            worksheet.write(current_row, 5, row["total_hours"], number_format)
            worksheet.write(current_row, 6, row["hourly_rate"], euro_format)
            worksheet.write(current_row, 7, row["revenue"], euro_format)
            current_row += 1

        overall_revenue = sum(r["revenue"] for r in year_data)
        for col in range(7):
            worksheet.write(current_row, col, "Overall" if col == 0 else "", overall_green_format)
        worksheet.write(current_row, 7, overall_revenue, overall_euro_format)
        current_row += 1

        year_cost_data = [r for r in cost_profit_summary if r["year"] == year]
        overall_cost = sum(r["cost"] for r in year_cost_data)
        profit_amount = overall_revenue - overall_cost
        profit_percentage = (profit_amount / overall_revenue * 100) if overall_revenue > 0 else 0

        for col in range(7):
            worksheet.write(current_row, col, "Profit" if col == 0 else "", profit_format)
        worksheet.write(current_row, 7, profit_percentage / 100, profit_percent_format)
        current_row += 3

    worksheet.set_column(0, 0, 10)
    worksheet.set_column(1, 1, 15)
    worksheet.set_column(2, 8, 15)


def _write_config_sheet(workbook, project: models.Project):
    worksheet = workbook.add_worksheet("Config")

    header_format = workbook.add_format({
        'bold': True, 'bg_color': '#1F2937', 'font_color': 'white',
        'border': 1, 'align': 'center',
    })
    label_format = workbook.add_format({'bold': True, 'bg_color': '#F3F4F6', 'border': 1})
    value_format = workbook.add_format({'border': 1, 'align': 'left'})
    number_format = workbook.add_format({'num_format': '#,##0.00', 'border': 1})
    text_format = workbook.add_format({'border': 1, 'align': 'center'})

    rates = get_rate_config(project)
    current_row = 0

    worksheet.merge_range(current_row, 0, current_row, 3, "PROJECT CONFIGURATION", header_format)
    current_row += 2

    worksheet.write(current_row, 0, "Project Name:", label_format)
    worksheet.write(current_row, 1, project.name, value_format)
    worksheet.write(current_row, 2, "Company:", label_format)
    worksheet.write(current_row, 3, project.company, value_format)
    current_row += 1

    worksheet.write(current_row, 0, "Start Date:", label_format)
    worksheet.write(current_row, 1, f"{project.start_year}-{project.start_month:02d}", value_format)
    worksheet.write(current_row, 2, "End Date:", label_format)
    worksheet.write(current_row, 3, f"{project.end_year}-{project.end_month:02d}", value_format)
    current_row += 2

    worksheet.merge_range(current_row, 0, current_row, 3, "RATES CONFIGURATION", header_format)
    current_row += 2

    worksheet.write(current_row, 0, "Story Points to Hours:", label_format)
    worksheet.write(current_row, 1, rates["sp_to_hours"], number_format)
    worksheet.write(current_row, 2, "HW Cost/Hour:", label_format)
    worksheet.write(current_row, 3, rates["hw_cost_per_hour"], number_format)
    current_row += 1

    worksheet.write(current_row, 0, "Risk Factor %:", label_format)
    worksheet.write(current_row, 1, rates["risk_factor_pct"], number_format)
    current_row += 2

    worksheet.merge_range(current_row, 0, current_row, 3, "HOURLY SELL RATES", header_format)
    current_row += 1
    for location, rate in rates["hourly_rates"].items():
        worksheet.write(current_row, 0, f"{location}:", label_format)
        worksheet.write(current_row, 1, rate, number_format)
        current_row += 1
    current_row += 1

    worksheet.merge_range(current_row, 0, current_row, 3, "HOURLY COST RATES", header_format)
    current_row += 1
    for location, levels in rates["cost_rates"].items():
        worksheet.write(current_row, 0, f"{location}:", label_format)
        worksheet.write(current_row, 1, "", value_format)
        current_row += 1
        for level, rate in levels.items():
            worksheet.write(current_row, 0, "", value_format)
            worksheet.write(current_row, 1, f"  {level}:", label_format)
            worksheet.write(current_row, 2, rate, number_format)
            current_row += 1
    current_row += 1

    worksheet.merge_range(current_row, 0, current_row, 3, "TICKET CONFIGURATION", header_format)
    current_row += 2

    quota_years = sorted(rates["ticket_quotas"].keys())
    headers = ["Size", "Story-points", "Price (€)"] + [f"Quota {y} (%)" for y in quota_years]
    for col, header in enumerate(headers):
        worksheet.write(current_row, col, header, header_format)
    current_row += 1

    for size in ["Small", "Medium", "Large"]:
        size_lower = size.lower()
        worksheet.write(current_row, 0, size, text_format)
        worksheet.write(current_row, 1, rates["ticket_story_points"].get(size_lower, 0.0), number_format)
        worksheet.write(current_row, 2, rates["ticket_prices"].get(size_lower, 0.0), number_format)
        for col_idx, year in enumerate(quota_years, start=3):
            worksheet.write(current_row, col_idx,
                            rates["ticket_quotas"][year].get(size_lower, 0.0), number_format)
        current_row += 1

    worksheet.set_column(0, 3, 20)
    if quota_years:
        for i in range(4, 3 + len(quota_years)):
            worksheet.set_column(i, i, 15)
