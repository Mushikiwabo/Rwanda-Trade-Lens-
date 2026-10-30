(function (root) {
  function sum(values) {
    const valid = values.filter((value) => Number.isFinite(value));
    return valid.length ? valid.reduce((total, value) => total + value, 0) : null;
  }

  function percentageChange(current, previous) {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
    return ((current - previous) / previous) * 100;
  }

  function aggregateBy(records, keyOf, valueOf) {
    const totals = new Map();
    records.forEach((record) => {
      const value = valueOf(record);
      if (!Number.isFinite(value)) return;
      const key = keyOf(record);
      totals.set(key, (totals.get(key) || 0) + value);
    });
    return [...totals.entries()]
      .map(([key, value]) => ({ key, value }))
      .sort((left, right) => right.value - left.value);
  }

  function compareYears(records, year, valueOf, monthFilter) {
    const currentYear = Number(year);
    if (!Number.isInteger(currentYear)) return null;
    const previousYear = currentYear - 1;
    const current = new Map();
    const previous = new Map();
    records.forEach((record) => {
      if (!Number.isFinite(record.year) || !Number.isFinite(record.month_num)) return;
      if (monthFilter !== "all" && record.month_num !== Number(monthFilter)) return;
      const value = valueOf(record);
      if (!Number.isFinite(value)) return;
      if (record.year === currentYear) current.set(record.month_num, value);
      if (record.year === previousYear) previous.set(record.month_num, value);
    });
    const months = [...current.keys()].filter((month) => previous.has(month)).sort((a, b) => a - b);
    if (!months.length) return { current: null, previous: null, change: null, months: [] };
    const currentTotal = sum(months.map((month) => current.get(month)));
    const previousTotal = sum(months.map((month) => previous.get(month)));
    return {
      current: currentTotal,
      previous: previousTotal,
      change: percentageChange(currentTotal, previousTotal),
      months
    };
  }

  function coefficientOfVariation(values) {
    const valid = values.filter(Number.isFinite);
    if (valid.length < 2) return null;
    const mean = sum(valid) / valid.length;
    if (mean === 0) return null;
    const variance = valid.reduce((total, value) => total + ((value - mean) ** 2), 0) / valid.length;
    return (Math.sqrt(variance) / Math.abs(mean)) * 100;
  }

  function hhiLowerBound(countryValues, totalValue) {
    if (!Number.isFinite(totalValue) || totalValue <= 0) return null;
    return countryValues
      .filter((value) => Number.isFinite(value) && value >= 0)
      .reduce((hhi, value) => hhi + ((value / totalValue) ** 2) * 10000, 0);
  }

  function toCsv(headers, rows) {
    const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
  }

  const api = { sum, percentageChange, aggregateBy, compareYears, coefficientOfVariation, hhiLowerBound, toCsv };
  root.RTIAnalytics = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
