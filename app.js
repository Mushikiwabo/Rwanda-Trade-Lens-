const A = window.RTIAnalytics;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pageTitles = {
  overview: "Export overview",
  explorer: "Export Explorer",
  destinations: "Destination Markets",
  opportunities: "Export Opportunities",
  assistant: "Business Insights",
  reports: "Reports"
};
const defaults = { year: "2025", month: "all", category: "all", destination: "all" };
let data;
let toastTimer;

const controls = {
  year: document.getElementById("yearFilter"),
  month: document.getElementById("monthFilter"),
  category: document.getElementById("categoryFilter"),
  destination: document.getElementById("destinationFilter")
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "Not available";
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "Not available";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function periodLabel(record) {
  return record.year == null ? `Year unspecified · ${record.month}` : `${record.year} ${record.month}`;
}

function periodOrder(record) {
  return record.year == null ? 300000 + record.month_num : record.year * 100 + record.month_num;
}

function comparePeriod(left, right) {
  return periodOrder(left) - periodOrder(right);
}

function selectedYearMatches(record) {
  const year = controls.year.value;
  if (year === "all") return true;
  if (year === "unspecified") return record.year == null;
  return String(record.year) === year;
}

function selectedMonthMatches(record) {
  return controls.month.value === "all" || record.month_num === Number(controls.month.value);
}

function selectedExportCategoryMatches(record) {
  return controls.category.value === "all" || record.category === controls.category.value;
}

function selectedDestinationMatches(record) {
  return controls.destination.value === "all" || record.country === controls.destination.value;
}

function filteredExports(kind) {
  return data.exports.filter((record) =>
    record.kind === kind &&
    selectedYearMatches(record) &&
    selectedMonthMatches(record) &&
    (kind === "total" || selectedExportCategoryMatches(record))
  );
}

function filteredExportTable() {
  return data.exports.filter((record) =>
    selectedYearMatches(record) &&
    selectedMonthMatches(record) &&
    (controls.category.value === "all" || (record.kind === "category" && selectedExportCategoryMatches(record)))
  ).sort((left, right) => comparePeriod(left, right) || left.source_row - right.source_row);
}

function filteredDestinations() {
  return data.destinations.filter((record) =>
    selectedYearMatches(record) &&
    selectedMonthMatches(record) &&
    selectedDestinationMatches(record)
  ).sort((left, right) => comparePeriod(left, right) || left.rank - right.rank);
}

function filteredDestinationTotals() {
  return data.destinationTotals.filter((record) =>
    selectedYearMatches(record) && selectedMonthMatches(record)
  ).sort(comparePeriod);
}

function currentComparisonYear() {
  if (controls.year.value === "unspecified") return null;
  if (controls.year.value !== "all") return Number(controls.year.value);
  const years = data.exports.filter((record) => record.year != null).map((record) => record.year);
  return years.length ? Math.max(...years) : null;
}

function currentMetricRecords() {
  return controls.category.value === "all" ? filteredExports("total") : filteredExports("category");
}

function matchedComparison(records, year, valueOf = (record) => record.value) {
  return year == null ? null : A.compareYears(records, year, valueOf, controls.month.value);
}

function comparisonLabel(result, year) {
  if (!result || !result.months.length) return "No matched months in the prior year";
  const months = result.months.map((month) => MONTH_NAMES[month - 1]).join(", ");
  return `${year} vs ${year - 1} · ${months}`;
}

function selectedPeriodDescription() {
  const yearLabel = controls.year.value === "all"
    ? "all available years"
    : controls.year.value === "unspecified"
      ? "year unspecified"
      : controls.year.value;
  const monthLabel = controls.month.value === "all" ? "all available months" : MONTH_NAMES[Number(controls.month.value) - 1];
  return `${yearLabel} · ${monthLabel}`;
}

function metricCard(label, value, detail, badge = "") {
  return `<article class="metric-card"><div class="metric-top"><span>${escapeHtml(label)}</span>${badge ? `<span class="metric-badge">${escapeHtml(badge)}</span>` : ""}</div><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function emptyMessage(message) {
  return `<div class="empty-state"><span class="empty-icon">—</span><strong>No observations available</strong><p>${escapeHtml(message)}</p></div>`;
}

function renderLineChart(container, records, title) {
  const observations = records
    .filter((record) => Number.isFinite(record.value))
    .sort(comparePeriod);
  if (!observations.length) {
    container.innerHTML = emptyMessage("No reported observations match the selected period and filters.");
    return;
  }
  const width = 820;
  const height = 270;
  const left = 62;
  const right = 18;
  const top = 18;
  const bottom = 48;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maximum = Math.max(...observations.map((record) => record.value), 0);
  const scaleMax = maximum || 1;
  const x = (index) => observations.length === 1
    ? left + chartWidth / 2
    : left + (index * chartWidth) / (observations.length - 1);
  const y = (value) => top + chartHeight - (value / scaleMax) * chartHeight;
  const path = observations.map((record, index) => `${index ? "L" : "M"} ${x(index).toFixed(1)} ${y(record.value).toFixed(1)}`).join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const position = top + chartHeight * fraction;
    return `<line class="chart-grid" x1="${left}" y1="${position}" x2="${width - right}" y2="${position}"></line><text class="chart-y-label" x="${left - 8}" y="${position + 4}" text-anchor="end">${escapeHtml(formatNumber(scaleMax * (1 - fraction)))}</text>`;
  }).join("");
  const stride = Math.max(1, Math.ceil(observations.length / 7));
  const points = observations.map((record, index) =>
    `<circle class="chart-point" cx="${x(index)}" cy="${y(record.value)}" r="4"><title>${escapeHtml(periodLabel(record))}: ${escapeHtml(formatNumber(record.value))}</title></circle>`
  ).join("");
  const labels = observations.map((record, index) => {
    if (index % stride !== 0 && index !== observations.length - 1) return "";
    const label = record.year == null ? record.month : `${String(record.year).slice(-2)} ${record.month}`;
    return `<text class="chart-x-label" x="${x(index)}" y="${height - 13}" text-anchor="middle">${escapeHtml(label)}</text>`;
  }).join("");
  container.innerHTML = `<svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">${grid}<path class="chart-line" d="${path}"></path>${points}${labels}</svg><div class="chart-caption"><span>${escapeHtml(periodLabel(observations[0]))} – ${escapeHtml(periodLabel(observations[observations.length - 1]))}</span><span>${observations.length} reported observation${observations.length === 1 ? "" : "s"}</span></div>`;
}

function renderBars(container, rows, selectedKey, onSelect, emptyText) {
  if (!rows.length) {
    container.innerHTML = emptyMessage(emptyText);
    return;
  }
  const maximum = Math.max(...rows.map((row) => row.value), 0) || 1;
  container.innerHTML = rows.map((row) => {
    const key = String(row.key);
    const width = Math.max(2, (row.value / maximum) * 100);
    const active = selectedKey !== "all" && key === selectedKey;
    return `<button type="button" class="bar-row${active ? " selected" : ""}" data-key="${escapeHtml(key)}" aria-label="Filter by ${escapeHtml(key)}, reported value ${escapeHtml(formatNumber(row.value))}"><span class="bar-label"><span>${escapeHtml(key)}</span><strong>${escapeHtml(formatNumber(row.value))}</strong></span><span class="bar-track"><i style="width:${width.toFixed(1)}%"></i></span></button>`;
  }).join("");
  container.querySelectorAll(".bar-row").forEach((button) => {
    button.addEventListener("click", () => onSelect(button.dataset.key));
  });
}

function renderExportRows(records) {
  const body = document.getElementById("exportTable");
  if (!records.length) {
    body.innerHTML = `<tr><td colspan="4">${emptyMessage("No monthly export values match these filters.")}</td></tr>`;
    return;
  }
  const visible = records.slice(0, 200);
  body.innerHTML = visible.map((record) => `<tr><td>${escapeHtml(periodLabel(record))}</td><td>${escapeHtml(record.category)}</td><td>${escapeHtml(formatNumber(record.value))}</td><td>${escapeHtml(record.source_row)}</td></tr>`).join("");
  if (records.length > visible.length) {
    body.insertAdjacentHTML("beforeend", `<tr><td colspan="4" class="table-footnote">Showing first ${visible.length} of ${records.length} observations. Download CSV for all filtered rows.</td></tr>`);
  }
}

function renderDestinationRows(records) {
  const body = document.getElementById("destinationTable");
  if (!records.length) {
    body.innerHTML = `<tr><td colspan="6">${emptyMessage("No ranked country observations match these filters.")}</td></tr>`;
    return;
  }
  const totalsByPeriod = new Map(
    filteredDestinationTotals().map((record) => [`${record.year ?? "unspecified"}-${record.month_num}`, record.value])
  );
  const visible = records.slice(0, 200);
  body.innerHTML = visible.map((record) => {
    const key = `${record.year ?? "unspecified"}-${record.month_num}`;
    const periodTotal = totalsByPeriod.get(key);
    const share = Number.isFinite(periodTotal) && periodTotal !== 0 ? `${((record.value / periodTotal) * 100).toFixed(1)}%` : "Not available";
    return `<tr><td>${escapeHtml(periodLabel(record))}</td><td>${escapeHtml(record.country)}</td><td>${escapeHtml(record.rank)}</td><td>${escapeHtml(formatNumber(record.value))}</td><td>${escapeHtml(share)}</td><td>${escapeHtml(record.source_row)}</td></tr>`;
  }).join("");
  if (records.length > visible.length) {
    body.insertAdjacentHTML("beforeend", `<tr><td colspan="6" class="table-footnote">Showing first ${visible.length} of ${records.length} observations. Download CSV for all filtered rows.</td></tr>`);
  }
}

function categoryRanking() {
  const records = data.exports.filter((record) =>
    record.kind === "category" &&
    selectedYearMatches(record) &&
    selectedMonthMatches(record) &&
    selectedExportCategoryMatches(record)
  );
  return A.aggregateBy(records, (record) => record.category, (record) => record.value).slice(0, 6);
}

function destinationRanking() {
  return A.aggregateBy(filteredDestinations(), (record) => record.country, (record) => record.value).slice(0, 6);
}

function renderOverview() {
  const exportRows = currentMetricRecords();
  const total = A.sum(exportRows.map((record) => record.value));
  const year = currentComparisonYear();
  const comparison = matchedComparison(
    data.exports.filter((record) =>
      (controls.category.value === "all" ? record.kind === "total" : record.kind === "category" && selectedExportCategoryMatches(record))
    ),
    year
  );
  const currentPeriods = new Set(exportRows.filter((record) => Number.isFinite(record.value)).map((record) => record.period));
  const selectedCategories = new Set(
    data.exports.filter((record) =>
      record.kind === "category" &&
      selectedYearMatches(record) &&
      selectedMonthMatches(record) &&
      selectedExportCategoryMatches(record) &&
      Number.isFinite(record.value)
    ).map((record) => record.category)
  );
  const countries = new Set(filteredDestinations().map((record) => record.country));
  const changeValue = comparison?.change == null ? "Not available" : formatPercent(comparison.change);
  const changeDetail = comparison?.months?.length ? comparisonLabel(comparison, year) : "No comparable prior-year months";
  document.getElementById("overviewMetrics").innerHTML = [
    metricCard(controls.category.value === "all" ? "Reported exports" : "Selected category", formatNumber(total), `${currentPeriods.size} reported month(s) · ${selectedPeriodDescription()} · workbook units`),
    metricCard("Matched-period change", changeValue, changeDetail, comparison?.change == null ? "" : comparison.change >= 0 ? "Increase" : "Decrease"),
    metricCard("Product categories", String(selectedCategories.size), "SITC categories with reported values in this selection"),
    metricCard("Listed destinations", String(countries.size), "Distinct country names observed in ranked snapshots")
  ].join("");

  const metricTrendRows = exportRows.filter((record) => Number.isFinite(record.value));
  document.getElementById("overviewTrendTitle").textContent = controls.category.value === "all"
    ? "Official monthly export total"
    : `${controls.category.value} · monthly values`;
  document.getElementById("trendUnit").textContent = "Workbook units · unit not specified";
  renderLineChart(document.getElementById("overviewTrend"), metricTrendRows, "Reported export values by month");

  const categories = categoryRanking();
  renderBars(
    document.getElementById("overviewCategories"),
    categories,
    controls.category.value,
    (category) => {
      controls.category.value = controls.category.value === category ? "all" : category;
      renderAll();
    },
    "No product category values match the selected filters."
  );
  const markets = destinationRanking();
  renderBars(
    document.getElementById("overviewDestinations"),
    markets,
    controls.destination.value,
    (country) => {
      controls.destination.value = controls.destination.value === country ? "all" : country;
      renderAll();
    },
    "No listed destination values match the selected period."
  );
  const notes = [
    `Exports sheet: ${data.source.export_category_count} SITC categories and the workbook's own total row.`,
    `Destination sheet: ${data.source.destination_country_count} distinct listed country names across monthly snapshots.`,
    data.source.measurement_unit_note,
    `Destination periods with no explicit year: ${data.source.destination_periods_with_unspecified_year}.`,
    `Destination month blocks without a reported total: ${data.source.destination_audit.months_missing_total}.`,
    `Missing/invalid values: ${data.source.missing_export_values} export cells and ${data.source.destination_audit.country_observations_missing_values} ranked-country values.`,
    `Conflicting duplicate destination periods excluded: ${data.source.destination_audit.conflicting_periods_excluded.length}.`,
    `Known gaps: August 2024 is absent from Exports; February 2025 is absent from Destination. Missing months are not zero.`
  ];
  document.getElementById("qualityNotes").innerHTML = notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  document.getElementById("coverageChip").textContent = `${currentPeriods.size} export month(s) in current selection`;
}

function renderExplorer() {
  const metricRows = currentMetricRecords().filter((record) => Number.isFinite(record.value));
  document.getElementById("categoryTrendTitle").textContent = controls.category.value === "all"
    ? "Official total · monthly trend"
    : `${controls.category.value} · monthly trend`;
  renderLineChart(document.getElementById("categoryTrend"), metricRows, "Monthly export values");
  const comparisonYear = currentComparisonYear();
  const comparison = matchedComparison(
    data.exports.filter((record) =>
      controls.category.value === "all"
        ? record.kind === "total"
        : record.kind === "category" && selectedExportCategoryMatches(record)
    ),
    comparisonYear
  );
  const comparisonContainer = document.getElementById("categoryComparison");
  comparisonContainer.innerHTML = comparison?.months?.length
    ? `<div class="comparison-number">${escapeHtml(formatPercent(comparison.change))}</div><p>${escapeHtml(comparisonLabel(comparison, comparisonYear))}</p><p>Current matched value: <strong>${escapeHtml(formatNumber(comparison.current))}</strong><br>Previous matched value: <strong>${escapeHtml(formatNumber(comparison.previous))}</strong></p><p class="small-note">Only months with numeric values in both years are included.</p>`
    : emptyMessage("A prior-year value for the same selected months is not available.");

  const selectedRecords = filteredExportTable();
  renderExportRows(selectedRecords);
  renderMonthlyChanges(metricRows);
}

function renderMonthlyChanges(records) {
  const container = document.getElementById("monthChanges");
  const ordered = records.filter((record) => Number.isFinite(record.value)).sort(comparePeriod);
  const adjacent = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index];
    const previous = ordered[index - 1];
    const sameYear = current.year === previous.year;
    const adjacentMonth = sameYear && current.month_num === previous.month_num + 1;
    if (!adjacentMonth) continue;
    adjacent.push({ current, previous, change: A.percentageChange(current.value, previous.value) });
  }
  if (!adjacent.length) {
    container.innerHTML = emptyMessage("No adjacent months within the selected period can be compared.");
    return;
  }
  container.innerHTML = adjacent.slice(-6).reverse().map(({ current, previous, change }) =>
    `<div class="change-row"><span>${escapeHtml(previous.month)} → ${escapeHtml(current.month)}</span><strong class="${change == null ? "" : change >= 0 ? "positive" : "negative"}">${escapeHtml(formatPercent(change))}</strong></div>`
  ).join("");
}

function renderDestinationsPage() {
  const countryRecords = filteredDestinations();
  const ranking = destinationRanking();
  let trendCountry = controls.destination.value;
  if (trendCountry === "all" && ranking.length) trendCountry = ranking[0].key;
  const trendRows = countryRecords.filter((record) => record.country === trendCountry);
  document.getElementById("destinationTrendTitle").textContent = trendCountry === "all"
    ? "Reported monthly values by market"
    : `${trendCountry} · listed monthly values`;
  renderLineChart(document.getElementById("destinationTrend"), trendRows, "Reported country values by month");
  renderBars(
    document.getElementById("destinationRanking"),
    ranking,
    controls.destination.value,
    (country) => {
      controls.destination.value = controls.destination.value === country ? "all" : country;
      renderAll();
    },
    "No country rankings match this period. Check whether a year label is available."
  );
  renderDestinationRows(countryRecords);
}

function categoryOpportunityRows() {
  const year = currentComparisonYear();
  if (year == null) return [];
  const categories = controls.category.value === "all" ? data.categories : [controls.category.value];
  return categories.map((category) => {
    const rows = data.exports.filter((record) =>
      record.kind === "category" &&
      record.category === category &&
      selectedMonthMatches(record)
    );
    const comparison = matchedComparison(rows, year);
    const currentValues = rows.filter((record) => record.year === year && Number.isFinite(record.value)).map((record) => record.value);
    return {
      category,
      comparison,
      volatility: A.coefficientOfVariation(currentValues)
    };
  }).sort((left, right) => (right.comparison?.change ?? -Infinity) - (left.comparison?.change ?? -Infinity));
}

function destinationOpportunityRows() {
  const year = currentComparisonYear();
  if (year == null) return [];
  const countries = controls.destination.value === "all" ? data.countries : [controls.destination.value];
  return countries.map((country) => {
    const rows = data.destinations.filter((record) =>
      record.country === country && selectedMonthMatches(record)
    );
    const comparison = matchedComparison(rows, year);
    return { key: country, value: comparison?.change, months: comparison?.months?.length || 0 };
  }).filter((row) => row.months > 0 && Number.isFinite(row.value))
    .sort((left, right) => right.value - left.value)
    .slice(0, 8);
}

function renderOpportunities() {
  const rows = categoryOpportunityRows();
  const body = document.getElementById("opportunityCategories");
  if (!rows.length || !rows.some((row) => row.comparison?.months?.length)) {
    body.innerHTML = `<tr><td colspan="5">${emptyMessage("A matched previous-year period is not available for this selection.")}</td></tr>`;
  } else {
    body.innerHTML = rows.map(({ category, comparison, volatility }) => {
      const current = comparison?.months?.length ? formatNumber(comparison.current) : "Not available";
      const previous = comparison?.months?.length ? formatNumber(comparison.previous) : "Not available";
      const change = comparison?.months?.length ? formatPercent(comparison.change) : "Not comparable";
      const cv = Number.isFinite(volatility) ? `${volatility.toFixed(1)}%` : "Not available";
      return `<tr><td>${escapeHtml(category)}</td><td>${escapeHtml(current)}</td><td>${escapeHtml(previous)}</td><td class="${comparison?.change == null ? "" : comparison.change >= 0 ? "positive" : "negative"}">${escapeHtml(change)}</td><td>${escapeHtml(cv)}</td></tr>`;
    }).join("");
  }
  renderBars(
    document.getElementById("opportunityDestinations"),
    destinationOpportunityRows(),
    controls.destination.value,
    (country) => {
      controls.destination.value = controls.destination.value === country ? "all" : country;
      renderAll();
    },
    "No destination has ranked observations in matched months in both years."
  );
}

function assistantResponse(question) {
  const query = question.toLowerCase();
  if (/destination|market|country|countries/.test(query) && /largest|top|rank|lead|receive|value|most/.test(query)) {
    const rows = destinationRanking().slice(0, 5);
    if (!rows.length) return { title: "No destination rankings for these filters", paragraphs: ["No ranked country observations match the current selection. The workbook contains destination snapshots, not a complete country-by-month panel."] };
    const details = rows.map((row, index) => `${index + 1}. ${row.key}: ${formatNumber(row.value)} workbook units (${countryObservationCount(row.key)} listed observation(s)).`);
    return {
      title: "Largest reported destination observations",
      paragraphs: [details.join("\n"), `Period filter: ${selectedPeriodDescription()}. These are sums of the available ranked observations, not complete country totals across months. The source is the Destination sheet.`]
    };
  }
  if (/grow|grew|grown|growth|increase|declin|fall|change|trend/.test(query) && /categor|export|value/.test(query)) {
    const rows = categoryOpportunityRows().filter((row) => row.comparison?.months?.length);
    if (!rows.length) return { title: "No matched comparison available", paragraphs: ["The selected reporting period has no usable prior-year values for the same months. Missing months are not treated as zero."] };
    const increases = rows.filter((row) => row.comparison.change > 0).slice(0, 3);
    const declines = [...rows].filter((row) => row.comparison.change < 0).sort((a, b) => a.comparison.change - b.comparison.change).slice(0, 3);
    const describe = (items) => items.length
      ? items.map((row) => `${row.category}: ${formatPercent(row.comparison.change)} (${formatNumber(row.comparison.current)} vs ${formatNumber(row.comparison.previous)} workbook units; ${row.comparison.months.length} matched month(s)).`).join("\n")
      : "None in the selected comparison.";
    return {
      title: `Category changes · ${currentComparisonYear()} vs ${currentComparisonYear() - 1}`,
      paragraphs: [`Largest increases:\n${describe(increases)}\nLargest declines:\n${describe(declines)}`, "This compares reported values, not physical quantities. A change does not establish market demand or business profitability. Source: Exports sheet."]
    };
  }
  if (/volatil|unstable|fluctuat/.test(query)) {
    const rows = categoryOpportunityRows().filter((row) => Number.isFinite(row.volatility))
      .sort((left, right) => right.volatility - left.volatility).slice(0, 5);
    return rows.length
      ? { title: "Categories with the largest observed variation", paragraphs: [rows.map((row) => `${row.category}: ${row.volatility.toFixed(1)}% coefficient of variation across available monthly values.`).join("\n"), "This is descriptive variability for the selected year and months, not a forecast. Missing observations are excluded."] }
      : { title: "Volatility cannot be calculated", paragraphs: ["At least two numeric monthly observations are needed for a category in the selected period."] };
  }
  if (/concentrat|hhi|share/.test(query)) {
    const totals = filteredDestinationTotals().filter((row) => Number.isFinite(row.value));
    const latest = totals[totals.length - 1];
    if (!latest || !Number.isFinite(latest.value) || latest.value <= 0) {
      return { title: "Concentration cannot be calculated", paragraphs: ["No valid destination total is available for the selected filters."] };
    }
    const countries = data.destinations.filter((row) =>
      row.year === latest.year && row.month_num === latest.month_num
    );
    const hhi = A.hhiLowerBound(countries.map((row) => row.value), latest.value);
    return {
      title: `Listed-country concentration snapshot · ${periodLabel(latest)}`,
      paragraphs: [`The known-country contribution to HHI is ${hhi == null ? "not available" : hhi.toFixed(0)} points (scale 0–10,000). This sums squared shares for the individually listed countries only.`, "Because the source groups other markets as “Rest of the World,” the full country HHI cannot be recovered; the figure is a lower bound. This is a snapshot, not a measure of product-level market concentration."]
    };
  }
  if (/before|research|enter|export to|recommend|opportunit/.test(query)) {
    return {
      title: "What to investigate before exporting",
      paragraphs: ["The NISR workbook describes Rwanda's historical export values; it does not identify foreign import demand, prices, tariffs, costs, or market access. For a selected product and country, verify product-level demand, regulatory requirements, competitors, buyer terms, logistics, and landed costs from current reliable sources.", "Historical growth can suggest a topic for further research, but it does not prove unmet demand or future success."]
    };
  }
  return {
    title: "I can answer questions supported by this workbook",
    paragraphs: ["Try asking which categories changed year over year, which listed destinations had the largest reported values, or what further research is needed before exporting. This local assistant does not invent figures or consult external demand data."]
  };
}

function countryObservationCount(country) {
  return filteredDestinations().filter((record) => record.country === country).length;
}

function showAssistantResponse(question) {
  const response = assistantResponse(question);
  document.getElementById("answerTitle").textContent = response.title;
  document.getElementById("assistantAnswer").innerHTML = response.paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function renderReport() {
  const year = currentComparisonYear();
  const metricRows = currentMetricRecords();
  const total = A.sum(metricRows.map((record) => record.value));
  const comparison = matchedComparison(
    data.exports.filter((record) =>
      controls.category.value === "all"
        ? record.kind === "total"
        : record.kind === "category" && selectedExportCategoryMatches(record)
    ),
    year
  );
  const topCategories = categoryRanking().slice(0, 3);
  const topDestinations = destinationRanking().slice(0, 3);
  document.getElementById("reportPeriod").textContent = selectedPeriodDescription();
  document.getElementById("reportSummary").innerHTML = `
    <p><strong>Selected scope:</strong> ${escapeHtml(selectedPeriodDescription())}${controls.category.value === "all" ? "" : ` · ${escapeHtml(controls.category.value)}`}${controls.destination.value === "all" ? "" : ` · ${escapeHtml(controls.destination.value)}`}</p>
    <p><strong>Reported export value:</strong> ${escapeHtml(formatNumber(total))} workbook units across ${metricRows.filter((record) => Number.isFinite(record.value)).length} reported month observation(s). The workbook does not specify the unit.</p>
    <p><strong>Matched-period change:</strong> ${escapeHtml(comparison?.months?.length ? `${formatPercent(comparison.change)} · ${comparisonLabel(comparison, year)}` : "Not available; no matching prior-year months.")}</p>
    <p><strong>Leading categories:</strong> ${escapeHtml(topCategories.length ? topCategories.map((row) => `${row.key} (${formatNumber(row.value)})`).join("; ") : "No observations.")}</p>
    <p><strong>Leading listed destinations:</strong> ${escapeHtml(topDestinations.length ? topDestinations.map((row) => `${row.key} (${formatNumber(row.value)})`).join("; ") : "No observations.")}</p>
    <h4>Limitations and further research</h4>
    <ul class="plain-list"><li>Destination markets are monthly ranked snapshots; unlisted countries are not zero.</li><li>August 2024 is missing in Exports, February 2025 is missing in Destination, one destination month lacks a reported total, and some later destination month blocks have no year label.</li><li>Missing or invalid source values are retained as missing; conflicting duplicate destination periods, if any, are excluded and reported in the coverage notes.</li><li>No product-by-destination cross-tab is supplied. Historical reported values are not proof of demand, profitability, or future performance; check product-level demand, tariffs, regulations, competitors, and logistics separately.</li></ul>`;
}

function renderGlobalNote() {
  const notes = [];
  if (controls.category.value !== "all" && controls.destination.value !== "all") {
    notes.push("The workbook does not provide a product-by-destination cross-tab; the selected category and destination are analyzed separately, not as a combined slice.");
  }
  if (controls.year.value === "unspecified") {
    notes.push("Destination month blocks without a year label are included. Product exports have no corresponding year-unspecified records.");
  }
  if (controls.year.value === "2026") {
    notes.push("2026 export observations run through August. Destination records do not have an explicit 2026 year label; they are not assigned to 2026.");
  }
  const element = document.getElementById("globalNote");
  element.hidden = notes.length === 0;
  element.textContent = notes.join(" ");
}

function renderAll() {
  if (!data) return;
  renderGlobalNote();
  renderOverview();
  renderExplorer();
  renderDestinationsPage();
  renderOpportunities();
  renderReport();
}

function fillFilters() {
  const explicitYears = new Set();
  data.exports.forEach((record) => explicitYears.add(record.year));
  data.destinationTotals.forEach((record) => {
    if (record.year != null) explicitYears.add(record.year);
  });
  const years = [...explicitYears].sort((a, b) => b - a);
  controls.year.innerHTML = `<option value="all">All years</option>${years.map((year) => `<option value="${year}">${year}</option>`).join("")}<option value="unspecified">Year unspecified</option>`;
  controls.year.value = years.includes(Number(defaults.year)) ? defaults.year : String(years[0] ?? "all");
  controls.month.innerHTML = `<option value="all">All months</option>${MONTH_NAMES.map((month, index) => `<option value="${index + 1}">${month}</option>`).join("")}`;
  controls.category.innerHTML = `<option value="all">All categories</option>${data.categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  controls.destination.innerHTML = `<option value="all">All destinations</option>${data.countries.map((country) => `<option value="${escapeHtml(country)}">${escapeHtml(country)}</option>`).join("")}`;
  Object.values(controls).forEach((control) => control.addEventListener("change", renderAll));
}

function showPage() {
  const requested = window.location.hash.slice(1) || "overview";
  const page = Object.prototype.hasOwnProperty.call(pageTitles, requested) ? requested : "overview";
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `view-${page}`));
  document.querySelectorAll(".nav-item").forEach((link) => link.classList.toggle("active", link.dataset.page === page));
  document.getElementById("pageTitle").textContent = pageTitles[page];
}

function downloadCsv(filename, headers, rows) {
  if (!rows.length) {
    showToast("There are no matching observations to download.");
    return;
  }
  const content = A.toCsv(headers, rows);
  const blob = new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`${rows.length} row(s) exported.`);
}

function downloadExports() {
  const rows = filteredExportTable();
  downloadCsv(
    "nisr-export-observations.csv",
    ["year", "month", "category", "category_code", "record_type", "reported_value_workbook_units", "source_sheet", "source_row", "source_column"],
    rows.map((record) => [record.year, record.month, record.category, record.category_code, record.kind, record.value, "Exports", record.source_row, record.source_column])
  );
}

function downloadDestinations() {
  const rows = filteredDestinations();
  downloadCsv(
    "nisr-destination-observations.csv",
    ["year", "month", "country", "monthly_rank", "reported_value_workbook_units", "source_sheet", "source_row"],
    rows.map((record) => [record.year, record.month, record.country, record.rank, record.value, "Destination", record.source_row])
  );
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function resetFilters() {
  controls.year.value = data.source.export_periods_by_year[defaults.year] ? defaults.year : "all";
  controls.month.value = defaults.month;
  controls.category.value = defaults.category;
  controls.destination.value = defaults.destination;
  renderAll();
}

function wireControls() {
  document.querySelectorAll(".nav-item, .brand").forEach((link) => link.addEventListener("click", () => {
    const target = link.getAttribute("href");
    if (target) window.location.hash = target;
  }));
  window.addEventListener("hashchange", showPage);
  document.getElementById("resetFilters").addEventListener("click", resetFilters);
  document.getElementById("downloadExports").addEventListener("click", downloadExports);
  document.getElementById("downloadDestinations").addEventListener("click", downloadDestinations);
  document.getElementById("downloadReportTop").addEventListener("click", downloadExports);
  document.getElementById("downloadExportsReport").addEventListener("click", downloadExports);
  document.getElementById("downloadDestinationsReport").addEventListener("click", downloadDestinations);
  document.getElementById("printReport").addEventListener("click", () => window.print());
  document.getElementById("assistantForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const question = document.getElementById("assistantQuestion").value.trim();
    if (!question) {
      showToast("Enter a question about exports first.");
      return;
    }
    showAssistantResponse(question);
  });
  document.querySelectorAll(".prompt-chip").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById("assistantQuestion").value = button.textContent;
      showAssistantResponse(button.textContent);
    });
  });
}

async function initialize() {
  wireControls();
  showPage();
  try {
    const response = await fetch("data/nisr_data.json");
    if (!response.ok) throw new Error(`Data request failed with status ${response.status}`);
    data = await response.json();
    fillFilters();
    renderAll();
  } catch (error) {
    const errorBox = document.getElementById("loadError");
    errorBox.hidden = false;
    errorBox.textContent = `The workbook data could not be loaded. Run “python process_data.py” from the prototype folder, then restart the local web server. Details: ${error.message}`;
  }
}

initialize();
