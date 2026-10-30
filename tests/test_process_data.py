import sys
import unittest
from pathlib import Path

from openpyxl import load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from process_data import WORKBOOK, build_dataset, parse_month


class WorkbookProcessingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dataset = build_dataset(WORKBOOK)

    def open_source_workbook(self, read_only=False):
        source = WORKBOOK.open("rb")
        self.addCleanup(source.close)
        workbook = load_workbook(source, read_only=read_only, data_only=True)
        self.addCleanup(workbook.close)
        return workbook

    def test_reads_expected_sheets_and_product_categories(self):
        self.assertEqual(self.dataset["source"]["sheets"], ["Exports", "Destination"])
        self.assertEqual(self.dataset["source"]["export_category_count"], 10)
        self.assertIn("Food and live animals", self.dataset["categories"])
        self.assertIn("Machinery and transport equipment", self.dataset["categories"])

    def test_export_periods_preserve_missing_months_and_official_totals(self):
        months = self.dataset["source"]["export_periods_by_year"]
        self.assertNotIn(8, months["2024"])
        self.assertEqual(months["2025"], list(range(1, 13)))
        self.assertEqual(months["2026"], list(range(1, 9)))
        august_2026_total = next(
            row for row in self.dataset["exports"]
            if row["kind"] == "total" and row["year"] == 2026 and row["month_num"] == 8
        )
        workbook = self.open_source_workbook(read_only=True)
        self.assertEqual(august_2026_total["value"], workbook["Exports"].cell(14, 33).value)
        self.assertEqual(august_2026_total["source_row"], 14)

    def test_numeric_observations_match_their_original_cells(self):
        workbook = self.open_source_workbook()
        exports = workbook["Exports"]
        for record in self.dataset["exports"]:
            self.assertEqual(
                record["value"],
                exports.cell(record["source_row"], record["source_column"]).value,
            )
        destinations = workbook["Destination"]
        for record in self.dataset["destinations"]:
            self.assertEqual(record["value"], destinations.cell(record["source_row"], 3).value)

    def test_destination_unlabelled_periods_and_duplicate_blocks_are_audited(self):
        self.assertEqual(self.dataset["source"]["destination_periods_by_year"]["2024"], list(range(1, 13)))
        self.assertEqual(self.dataset["source"]["destination_periods_by_year"]["2025"], [1, *range(3, 13)])
        self.assertIn("unspecified", self.dataset["source"]["destination_periods_by_year"])
        self.assertGreaterEqual(
            self.dataset["source"]["destination_audit"]["exact_duplicate_blocks_collapsed"], 1
        )
        self.assertEqual(self.dataset["source"]["destination_audit"]["months_missing_total"], 1)
        may_2024 = next(
            row for row in self.dataset["destinationTotals"]
            if row["year"] == 2024 and row["month_num"] == 5
        )
        self.assertIsNone(may_2024["value"])
        self.assertTrue(all(row["year"] is None for row in self.dataset["destinations"] if row["period"] is None))

    def test_unit_is_not_inferred(self):
        self.assertIsNone(self.dataset["source"]["measurement_unit"])
        self.assertIn("does not identify a unit", self.dataset["source"]["measurement_unit_note"])

    def test_month_parser_handles_replacement_characters(self):
        self.assertEqual(parse_month("Sept\ufffd"), (9, "Sep"))
        self.assertEqual(parse_month("April\ufffd"), (4, "Apr"))
        self.assertIsNone(parse_month("not a month"))


if __name__ == "__main__":
    unittest.main()
