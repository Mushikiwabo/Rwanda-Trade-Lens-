const test = require("node:test");
const assert = require("node:assert/strict");
const analytics = require("../analytics.js");

test("percentage change handles increases, decreases, and undefined denominators", () => {
  assert.equal(analytics.percentageChange(120, 100), 20);
  assert.equal(analytics.percentageChange(80, 100), -20);
  assert.equal(analytics.percentageChange(1, 0), null);
  assert.equal(analytics.percentageChange(null, 100), null);
});

test("aggregation skips missing values and ranks by summed value", () => {
  const rows = [
    { group: "A", value: 4 },
    { group: "B", value: 7 },
    { group: "A", value: null },
    { group: "A", value: 3 }
  ];
  assert.deepEqual(
    analytics.aggregateBy(rows, (row) => row.group, (row) => row.value),
    [{ key: "A", value: 7 }, { key: "B", value: 7 }]
  );
  assert.equal(analytics.sum([null, Number.NaN]), null);
});

test("year comparison uses only month numbers reported in both years", () => {
  const rows = [
    { year: 2024, month_num: 1, value: 10 },
    { year: 2024, month_num: 3, value: 20 },
    { year: 2025, month_num: 1, value: 15 },
    { year: 2025, month_num: 2, value: 900 },
    { year: 2025, month_num: 3, value: 30 }
  ];
  assert.deepEqual(
    analytics.compareYears(rows, 2025, (row) => row.value, "all"),
    { current: 45, previous: 30, change: 50, months: [1, 3] }
  );
  assert.equal(analytics.compareYears(rows, 2025, (row) => row.value, "2").months.length, 0);
});

test("volatility and listed-market HHI calculations return transparent values", () => {
  assert.equal(analytics.coefficientOfVariation([10, 10, null]), 0);
  assert.equal(analytics.coefficientOfVariation([10]), null);
  assert.equal(analytics.hhiLowerBound([50, 25], 100), 3125);
  assert.equal(analytics.hhiLowerBound([10], 0), null);
});

test("CSV output quotes delimiters, quotes, and missing values", () => {
  assert.equal(
    analytics.toCsv(["country", "value"], [['Congo, "DRC"', null]]),
    '"country","value"\r\n"Congo, ""DRC""",""'
  );
});
