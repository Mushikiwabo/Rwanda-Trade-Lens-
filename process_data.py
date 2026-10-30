"""Convert the NISR workbook into validated JSON for the static web application."""

from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parent.parent
WORKBOOK = ROOT / "NISR dataset.xlsx"
OUTPUT = Path(__file__).resolve().parent / "data" / "nisr_data.json"

MONTHS = {
    "jan": (1, "Jan"),
    "feb": (2, "Feb"),
    "mar": (3, "Mar"),
    "apr": (4, "Apr"),
    "may": (5, "May"),
    "jun": (6, "Jun"),
    "jul": (7, "Jul"),
    "aug": (8, "Aug"),
    "sep": (9, "Sep"),
    "oct": (10, "Oct"),
    "nov": (11, "Nov"),
    "dec": (12, "Dec"),
}


def parse_month(value: Any) -> tuple[int, str] | None:
    if not isinstance(value, str):
        return None
    label = re.sub(r"[^a-z]", "", value.lower().replace("\ufffd", ""))
    for prefix, result in MONTHS.items():
        if label.startswith(prefix):
            return result
    return None


def numeric_value(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def read_exports(sheet: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    periods: dict[tuple[int, int], dict[str, Any]] = {}
    issues: list[dict[str, Any]] = []
    headers: dict[int, tuple[int, int, str]] = {}
    current_year: int | None = None

    for column in range(3, sheet.max_column + 1):
        header_year = sheet.cell(2, column).value
        if isinstance(header_year, int) and not isinstance(header_year, bool):
            current_year = header_year
        month = parse_month(sheet.cell(3, column).value)
        if current_year is not None and month:
            month_number, month_label = month
            headers[column] = (current_year, month_number, month_label)
            periods[(current_year, month_number)] = {
                "year": current_year,
                "month_num": month_number,
                "month": month_label,
                "period": f"{current_year}-{month_number:02d}",
            }

    for row in range(4, sheet.max_row + 1):
        raw_name = sheet.cell(row, 1).value
        if not isinstance(raw_name, str) or not raw_name.strip():
            continue
        name = raw_name.strip()
        is_total = name.casefold() == "total domestic exports"
        match = re.match(r"^\s*(\d+)\s*-\s*(.+?)\s*$", name)
        category_code = match.group(1) if match else None
        category = match.group(2).strip() if match else name
        if not is_total and category_code is None:
            issues.append({"type": "unrecognized_category", "source_row": row, "label": name})

        for column, (year, month_number, month_label) in headers.items():
            raw_value = sheet.cell(row, column).value
            value = numeric_value(raw_value)
            if raw_value is not None and value is None:
                issues.append(
                    {"type": "invalid_numeric_value", "sheet": sheet.title, "source_row": row, "source_column": column}
                )
            records.append(
                {
                    "year": year,
                    "month_num": month_number,
                    "month": month_label,
                    "period": f"{year}-{month_number:02d}",
                    "category": category,
                    "category_code": category_code,
                    "kind": "total" if is_total else "category",
                    "value": value,
                    "source_row": row,
                    "source_column": column,
                }
            )

    if not any(record["kind"] == "total" for record in records):
        issues.append({"type": "missing_official_total", "sheet": sheet.title})
    return records, list(periods.values()), issues


def _destination_signature(block: dict[str, Any]) -> tuple[Any, ...]:
    observations = tuple(
        sorted(
            (row["country"], row["rank"], row["value"])
            for row in block["countries"]
        )
    )
    return observations, block["rest_value"], block["total_value"]


def read_destinations(
    sheet: Any,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    dict[str, Any],
    list[dict[str, Any]],
]:
    blocks: list[dict[str, Any]] = []
    active_year: int | None = None
    year_for_block: int | None = None
    active_month: tuple[int, str] | None = None
    active_header_row: int | None = None

    def finish_block() -> None:
        if active_month is None or active_header_row is None:
            return
        month_number, month_label = active_month
        blocks.append(
            {
                "year": year_for_block,
                "month_num": month_number,
                "month": month_label,
                "period": f"{year_for_block}-{month_number:02d}" if year_for_block else None,
                "header_row": active_header_row,
                "countries": [],
                "rest_value": None,
                "total_value": None,
                "total_source_row": None,
            }
        )

    for row in range(1, sheet.max_row + 1):
        value = sheet.cell(row, 3).value
        if isinstance(value, int) and not isinstance(value, bool) and value in range(2000, 2100):
            active_year = value
            continue
        month = parse_month(value)
        if month:
            finish_block()
            active_month = month
            year_for_block = active_year
            active_header_row = row
            if month[0] == 12:
                active_year = None

    finish_block()

    destination_issues: list[dict[str, Any]] = []
    missing_country_values = 0
    missing_rest_values = 0
    for block in blocks:
        first_row = block["header_row"] + 1
        next_header = next(
            (candidate["header_row"] for candidate in blocks if candidate["header_row"] > block["header_row"]),
            sheet.max_row + 1,
        )
        for row in range(first_row, next_header):
            rank_or_name = sheet.cell(row, 1).value
            country_cell = sheet.cell(row, 2).value
            raw_value = sheet.cell(row, 3).value
            number = numeric_value(raw_value)
            if isinstance(rank_or_name, (int, float)) and isinstance(country_cell, str):
                if number is None:
                    missing_country_values += 1
                    if raw_value is not None:
                        destination_issues.append(
                            {
                                "type": "invalid_numeric_value",
                                "source_row": row,
                                "country": country_cell.strip(),
                                "value": str(raw_value),
                            }
                        )
                    continue
                block["countries"].append(
                    {
                        "country": country_cell.strip(),
                        "rank": int(rank_or_name),
                        "value": number,
                        "source_row": row,
                    }
                )
            elif isinstance(rank_or_name, str) and rank_or_name.strip().casefold() == "rest of the world":
                if number is None:
                    missing_rest_values += 1
                    if raw_value is not None:
                        destination_issues.append(
                            {"type": "invalid_numeric_value", "source_row": row, "value": str(raw_value)}
                        )
                else:
                    block["rest_value"] = number
            elif isinstance(rank_or_name, str) and rank_or_name.strip().casefold() == "total":
                if number is None:
                    if raw_value is not None:
                        destination_issues.append(
                            {"type": "invalid_numeric_value", "source_row": row, "value": str(raw_value)}
                        )
                else:
                    block["total_value"] = number
                    block["total_source_row"] = row

    deduped: list[dict[str, Any]] = []
    by_period: dict[tuple[int | None, int], list[dict[str, Any]]] = defaultdict(list)
    for block in blocks:
        by_period[(block["year"], block["month_num"])].append(block)

    duplicate_count = 0
    excluded_periods: list[dict[str, Any]] = []
    for (year, month_number), matching in by_period.items():
        signatures = {_destination_signature(block) for block in matching}
        if len(signatures) > 1:
            excluded_periods.append(
                {
                    "year": year,
                    "month_num": month_number,
                    "source_rows": [block["header_row"] for block in matching],
                    "reason": "Conflicting duplicate month blocks",
                }
            )
            continue
        deduped.append(matching[0])
        duplicate_count += len(matching) - 1

    countries: list[dict[str, Any]] = []
    totals: list[dict[str, Any]] = []
    missing_totals = 0
    for block in deduped:
        if block["total_value"] is None:
            missing_totals += 1
        totals.append(
            {
                "year": block["year"],
                "month_num": block["month_num"],
                "month": block["month"],
                "period": block["period"],
                "value": block["total_value"],
                "rest_value": block["rest_value"],
                "source_row": block["total_source_row"],
                "source_header_row": block["header_row"],
            }
        )
        for country in block["countries"]:
            countries.append(
                {
                    **country,
                    "year": block["year"],
                    "month_num": block["month_num"],
                    "month": block["month"],
                    "period": block["period"],
                }
            )

    return countries, totals, excluded_periods, {
        "raw_month_blocks": len(blocks),
        "exact_duplicate_blocks_collapsed": duplicate_count,
        "conflicting_periods_excluded": excluded_periods,
        "months_missing_total": missing_totals,
        "country_observations_missing_values": missing_country_values,
        "rest_of_world_observations_missing_values": missing_rest_values,
    }, destination_issues


def build_dataset(workbook_path: Path = WORKBOOK) -> dict[str, Any]:
    if not workbook_path.is_file():
        raise FileNotFoundError(f"Workbook not found: {workbook_path}")
    with workbook_path.open("rb") as workbook_file:
        workbook = load_workbook(workbook_file, read_only=False, data_only=True)
        try:
            sheet_names = list(workbook.sheetnames)
            required_sheets = {"Exports", "Destination"}
            missing_sheets = required_sheets.difference(sheet_names)
            if missing_sheets:
                raise ValueError(f"Workbook is missing required sheets: {', '.join(sorted(missing_sheets))}")

            export_records, export_periods, export_issues = read_exports(workbook["Exports"])
            (
                destination_records,
                destination_totals,
                excluded_periods,
                destination_audit,
                destination_issues,
            ) = read_destinations(workbook["Destination"])
        finally:
            workbook.close()

    exports_by_year: dict[str, list[int]] = defaultdict(list)
    for period in export_periods:
        exports_by_year[str(period["year"])].append(period["month_num"])
    destinations_by_year: dict[str, list[int]] = defaultdict(list)
    for period in destination_totals:
        label = str(period["year"]) if period["year"] is not None else "unspecified"
        destinations_by_year[label].append(period["month_num"])

    category_names = list(
        dict.fromkeys(record["category"] for record in export_records if record["kind"] == "category")
    )
    country_names = sorted({record["country"] for record in destination_records}, key=str.casefold)
    missing_export_values = sum(record["value"] is None for record in export_records)
    destination_periods_with_unknown_year = sum(period["year"] is None for period in destination_totals)

    return {
        "source": {
            "workbook": workbook_path.name,
            "sheets": sheet_names,
            "measurement_unit": None,
            "measurement_unit_note": "The workbook does not identify a unit in the inspected sheet headers or cells.",
            "export_periods_by_year": {year: sorted(months) for year, months in exports_by_year.items()},
            "destination_periods_by_year": {
                year: sorted(months) for year, months in destinations_by_year.items()
            },
            "export_category_count": len(category_names),
            "destination_country_count": len(country_names),
            "missing_export_values": missing_export_values,
            "destination_periods_with_unspecified_year": destination_periods_with_unknown_year,
            "destination_audit": destination_audit,
            "processing_issues": export_issues,
            "destination_processing_issues": destination_issues,
            "notes": [
                "Export totals use the workbook's explicit Total Domestic Exports row, not a sum of category rows.",
                "Destination country values are monthly ranked observations; unlisted countries are not zero.",
                "The destination sheet has month blocks without an explicit year. Their year is left unspecified.",
                "The workbook does not identify the measurement unit; values are shown without a currency label.",
                "No product-by-destination cross-tab is present in the workbook.",
            ],
        },
        "exports": export_records,
        "exportPeriods": export_periods,
        "destinations": destination_records,
        "destinationTotals": destination_totals,
        "excludedDestinationPeriods": excluded_periods,
        "categories": category_names,
        "countries": country_names,
    }


def main() -> None:
    dataset = build_dataset()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding="utf-8")
    source = dataset["source"]
    print(f"Processed workbook: {WORKBOOK}")
    print(f"Export observations: {len(dataset['exports'])} across {len(dataset['exportPeriods'])} periods")
    print(
        "Destination observations: "
        f"{len(dataset['destinations'])} country rows across {len(dataset['destinationTotals'])} periods"
    )
    print(f"Exact duplicate destination blocks collapsed: {source['destination_audit']['exact_duplicate_blocks_collapsed']}")
    print(f"Output: {OUTPUT}")


if __name__ == "__main__":
    main()
