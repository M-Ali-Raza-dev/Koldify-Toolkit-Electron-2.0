# CSV Splitter Sample

Use this sample to test the CSV Splitter (streaming) tool.

## Files
- `leads.csv` — 25 sample rows with headers

## How to use (App)
1) In the app, open **In-House > CSV Splitter**.
2) Click **Browse** and pick `leads.csv` from this folder.
3) Set **Rows per split** (e.g., 10).
4) (Optional) Choose an output folder; otherwise the splits are written next to the input file.
5) Run. Output will land in a new timestamped folder named like `splits_leads_YYYY-MM-DD_hh-mm-ss`.

## How to use (CLI)
```bash
node backend/inhouse/csv-splitter.js --in "samples/inhouse/csv-splitter/leads.csv" --rows 10
```

Add `--out "D:/path/to/output"` to change the destination.

## Expected output
- Multiple split files named `leads_part_001.csv`, `leads_part_002.csv`, ...
- Each split keeps the original header row.
- Last file may contain fewer rows (remainder).
