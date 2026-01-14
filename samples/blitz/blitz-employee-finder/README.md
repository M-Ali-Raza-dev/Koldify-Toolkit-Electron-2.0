# Blitz Employee Finder

Sample input for the Blitz Employee Finder tool (CSV → CSV).

## Files
- `companies.csv` — Company LinkedIn URLs with optional filters

## Input Columns
- **Company LinkedIn Url** (required) — Company page URL
- **Country Code** (optional) — Comma or semicolon list (e.g., `US,FR`)
- **Continent** (optional) — Comma/semicolon list (e.g., `Europe,North America`)
- **Sales Region** (optional) — Comma/semicolon list (e.g., `EMEA,NORAM`)
- **Job Level** (optional) — Comma/semicolon list (e.g., `Director,VP`)
- **Job Function** (optional) — Comma/semicolon list (e.g., `Engineering,Information Technology`)
- **Min Connections Count** (optional) — Minimum LinkedIn connections (number)
- **Max Results** (optional) — Max people to return per company (default 10)
- **Page** (optional) — Page index (default 1)

## Sample CSV (companies.csv)
```csv
Company LinkedIn Url,Country Code,Continent,Sales Region,Job Level,Job Function,Min Connections Count,Max Results,Page
https://www.linkedin.com/company/wttj-fr,"FR,US","Europe,North America","EMEA,NORAM","Director,Manager","Engineering,Information Technology",200,10,1
https://www.linkedin.com/company/blitz-api,"US","North America","NORAM","C-Team,VP","Sales & Business Development,Advertising & Marketing",200,5,1
https://www.linkedin.com/company/google,"US","North America","NORAM","Director,VP","Engineering,Information Technology",300,10,1
```

## How to Use (UI)
1. Go to Blitz → Employee Finder.
2. Select `companies.csv` as input.
3. (Optional) Set output folder/name; defaults to timestamped CSV.
4. Provide Blitz API key (or set `BLITZ_API_KEY`).
5. Adjust concurrency if needed; defaults to 3.
6. Click Run.

## Output
- Writes `employee_finder_<timestamp>.csv` with one row per person (or error/no-result) including input row index, LinkedIn profile, headline, location, experience fields, and any error status/message.

## Notes
- Keep the column header exactly `Company LinkedIn Url` (or set custom column in the UI).
- List fields can use commas or semicolons; quoted values are supported.
- Empty optional filters are ignored.
