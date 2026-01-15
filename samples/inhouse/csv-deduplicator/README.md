# CSV Deduplicator Tool

## Overview
The CSV Deduplicator removes duplicate rows from a CSV file based on a chosen column. You can keep either the first or last occurrence of each duplicate.

## Features
✅ **Column-based deduplication** - Choose any column as the unique key  
✅ **Keep first or last** - Flexible duplicate handling strategy  
✅ **Preserves empty values** - Rows with empty keys are always kept  
✅ **Case-insensitive matching** - "john@example.com" and "JOHN@EXAMPLE.COM" are treated as duplicates  
✅ **Clean output** - Writes deduplicated CSV with original structure

## How It Works

### Deduplication Logic
- **First mode**: Keeps the first occurrence of each duplicate, removes all subsequent ones
- **Last mode**: Keeps the last occurrence of each duplicate, removes all previous ones
- **Empty keys**: Rows with empty/blank values in the dedupe column are always kept (not considered duplicates)

### Sample File
This folder contains `leads_with_duplicates.csv` with:
- 30 rows total
- Several duplicate emails
- Some empty email fields
- Example of how duplicates are handled

## Usage

### From Electron App
1) In the app, open **In-House > CSV Deduplicator**.
2) Click **Browse** and select your CSV file with duplicates.
3) After selection, choose the **Dedupe Column** from the dropdown (e.g., "Email").
4) Select **Keep Mode**: First or Last occurrence.
5) (Optional) Choose an output folder; otherwise saves to input folder.
6) Run. Output file is named `deduped.csv` by default.

### From Command Line

**Basic usage:**
```bash
TOOL_CONFIG='{"inputPath":"samples/inhouse/csv-deduplicator/leads_with_duplicates.csv","columnName":"Email","keepMode":"first","outputDir":"./","outputFileName":"deduped.csv"}' node backend/inhouse/csv-deduplicator.js
```

**Keep last occurrence:**
```bash
TOOL_CONFIG='{"inputPath":"leads.csv","columnName":"Email","keepMode":"last","outputDir":"./output","outputFileName":"unique_leads.csv"}' node backend/inhouse/csv-deduplicator.js
```

## Common Use Cases

### Email Deduplication
Remove duplicate contacts based on email address:
- Column: `Email` or `Work Email`
- Keep: First (keeps earliest contact record)

### LinkedIn Profile Deduplication
Remove duplicate profiles:
- Column: `LinkedIn URL`
- Keep: Last (keeps most recently scraped profile)

### Phone Number Deduplication
Remove duplicate phone numbers:
- Column: `Phone` or `Mobile`
- Keep: First (keeps original entry)

## Output
- **File**: `deduped.csv` (or custom name)
- **Location**: Same as input folder (or custom output folder)
- **Content**: All unique rows + rows with empty keys

## Metrics
The tool reports:
- **Input rows**: Total rows in original file
- **Output rows**: Rows after deduplication
- **Duplicates removed**: Number of duplicate rows removed
- **Empty key rows kept**: Rows with blank dedupe column values (always preserved)

## Example

**Input (leads_with_duplicates.csv):**
```csv
Name,Email,Company
John Doe,john@example.com,Acme
Jane Smith,jane@example.com,TechCo
John Doe,john@example.com,NewCorp
Bob Johnson,,Startup
Alice Lee,alice@example.com,BigCo
Jane Smith,jane@example.com,TechCo
```

**Output (Keep First):**
```csv
Name,Email,Company
John Doe,john@example.com,Acme
Jane Smith,jane@example.com,TechCo
Bob Johnson,,Startup
Alice Lee,alice@example.com,BigCo
```
*Result: 4 rows (removed 2 duplicates, kept 1 empty key row)*

**Output (Keep Last):**
```csv
Name,Email,Company
John Doe,john@example.com,NewCorp
Bob Johnson,,Startup
Alice Lee,alice@example.com,BigCo
Jane Smith,jane@example.com,TechCo
```
*Result: 4 rows (kept last occurrence of duplicates)*

## Requirements
- Node.js v18 or higher
- No external dependencies (uses only Node.js built-in modules)

## Troubleshooting

**Column not found:**
- Ensure the column name exactly matches the header (case-sensitive)
- Check for extra spaces in column names

**Empty output:**
- Verify input CSV has valid headers
- Check that dedupe column contains data

**All rows removed:**
- Verify you selected the correct column
- Check if all values in that column are empty

## Tips
- Use "First" mode for contact lists (keeps original entries)
- Use "Last" mode for enriched/updated data (keeps latest info)
- Always preview your dedupe column selection before running
- Keep a backup of original files before deduplication

## License
Part of Koldify Toolkit Electron 2.0
