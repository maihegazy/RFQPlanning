"""Excel generation for effort-only reports (resource plan).

The budget workbook contains monetary values, which are end-to-end
encrypted — it is generated in the browser (frontend/src/money/excelBudget.ts)
with the same layout as the original desktop report.
"""

import io

import xlsxwriter

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
    # Feature and role names are user text; a name starting with "=" must stay text
    # instead of becoming a formula in the recipient's Excel.
    workbook = xlsxwriter.Workbook(buffer, {'in_memory': True, 'strings_to_formulas': False})
    for pivot in pivots:
        _write_pivot_sheet(workbook, pivot["year"], pivot, '#,##0.0')
    workbook.close()
    return buffer.getvalue()
