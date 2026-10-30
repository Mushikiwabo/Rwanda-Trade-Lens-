# Rwanda TradeLens

Rwanda TradeLens is a static, browser-based dashboard for exploring reported Rwandan export statistics and destination-market observations. It is built with HTML, CSS, and vanilla JavaScript, with a Python script that converts the source workbook into JSON.

The dashboard is a research and portfolio project. It is not an official NISR product and does not provide investment, export, or market-entry advice.

## What it does

- Summarizes reported export values and their observed monthly trends.
- Lets visitors filter the available observations by year, month, category, and destination.
- Explores export categories and the destination snapshots available in the source workbook.
- Provides business insights and descriptive opportunity exploration.
- Exports filtered observations as CSV and supports printing reports from the browser.

The site is static: it has no database, paid API, or server-side application. The published dashboard reads `data/nisr_data.json`.

## View the dashboard locally

You need Python 3.9 or newer. From this folder, run:

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000>. Stop the server with `Ctrl+C` in the terminal.

## Data and regeneration

The committed `data/nisr_data.json` file is the data snapshot used by the dashboard. The source workbook is not included in this repository. The data-processing script expects a workbook named `NISR dataset.xlsx` one directory above this project folder, with `Exports` and `Destination` sheets.

In the original thesis project layout, place the workbook at the project root (next to the `prototype` folder), then run these commands from `prototype`:

```powershell
python -m pip install -r requirements.txt
python process_data.py
```

The script validates and converts the workbook observations into `data/nisr_data.json`. Review the generated data before publishing it. If you update the snapshot, commit the changed JSON file and push it to GitHub so the hosted dashboard receives the update.

## Deploy on Netlify

For this dashboard-only repository:

1. Import the GitHub repository into Netlify.
2. Leave the build command empty.
3. Set the publish directory to `.` (the repository root).
4. Deploy.

Netlify will redeploy when changes are pushed to the connected branch. Because the source workbook is not in this repository, the deploy does not regenerate the JSON file; it publishes the committed snapshot.

## Tests

Run the Python tests from this folder:

```powershell
python -m unittest discover -s tests -p "test_*.py"
```

The JavaScript calculation tests require Node.js:

```powershell
node --test tests/test_analytics.js
```

## Data interpretation and limitations

- Export totals are taken from the workbook's explicit `Total Domestic Exports` row; category values are kept separate.
- The workbook does not identify a unit, so the dashboard does not label the values with a currency.
- Destination data consists of monthly ranked country snapshots, not a complete country-by-month table. A destination missing from a month's top-ten list is not treated as having zero exports.
- Some later destination month blocks have no explicit year. Those observations are labelled `Year unspecified`; a year is not inferred.
- The workbook does not provide product-level exports by destination, foreign-market demand, tariffs, costs, or regulations. Opportunity exploration is descriptive and is not a market recommendation.
- CSV downloads contain the filtered source observations. Reports can be printed or saved as PDF through the browser's print dialog.
