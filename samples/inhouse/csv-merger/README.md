# CSV Merger Tool

## Overview
The CSV Merger is an intelligent tool that automatically merges multiple CSV files from a folder into a single unified CSV file. It automatically detects and normalizes column headers across different files, handling variations in naming conventions.

## Features
✅ **Auto-detects** all CSV files in a selected folder  
✅ **Smart column normalization** - handles different header names for same data (e.g., "email", "Email Address", "Work Email" → "Email")  
✅ **No duplicate removal** - appends ALL rows from all files  
✅ **Column union** - creates columns from all unique headers across all files  
✅ **Beautiful console output** with progress tracking  
✅ **JSONL log file** for detailed processing records  
✅ **Folder selection dialog** - easy to use with Electron

## How It Works

### Header Normalization
The tool intelligently maps similar column names to standardized headers:

| Input Headers | → | Unified Header |
|--------------|---|----------------|
| email, Email Address, work email | → | Email |
| First Name, firstname, FirstName | → | First Name |
| company, Company Name, organization | → | Company |
| LinkedIn, linkedin url, profile url | → | LinkedIn URL |
| phone, Phone Number | → | Phone |

### Sample Files
This folder contains 3 sample CSV files with different column structures:

**contacts1.csv:**
- First Name, Last Name, Email Address, Company Name, Job Title, LinkedIn

**contacts2.csv:**
- Full Name, Work Email, Organization, Phone Number, Website

**contacts3.csv:**
- email, firstname, lastname, company, title, domain, phone

When merged, these will create a unified CSV with all unique columns.

## Usage

### From Electron App
```bash
node backend/inhouse/csv-merger.js
```
A folder selection dialog will appear - select the folder containing your CSV files.

### From Command Line

**With folder selection:**
```bash
node backend/inhouse/csv-merger.js
```

**With specific input folder:**
```bash
node backend/inhouse/csv-merger.js --input "path/to/csv/folder"
```

**Custom output filename:**
```bash
node backend/inhouse/csv-merger.js --input "path/to/csv/folder" --out "my-merged-data.csv"
```

**Custom log filename:**
```bash
node backend/inhouse/csv-merger.js --log "custom-log.jsonl"
```

## Output Files

### merged.csv
The main output file containing all merged data with unified column headers.

### merger-log.jsonl
A detailed log file in JSON Lines format containing:
- Run start/end timestamps
- Files processed
- Rows appended per file
- Column mapping details
- Error information (if any)

## Testing with Samples

1. Navigate to the samples folder:
   ```
   samples/inhouse/csv-merger/
   ```

2. Run the merger and select this folder:
   ```bash
   node backend/inhouse/csv-merger.js
   ```

3. Expected output:
   - **9 total rows** (3 from each sample file)
   - **Unified columns:** Email, First Name, Last Name, Company, Job Title, LinkedIn URL, Full Name, Phone, Website, Domain

## Column Alias Configuration

You can customize column mappings by editing the `ALIASES` Map in `csv-merger.js`:

```javascript
const ALIASES = new Map([
  ["email", "Email"],
  ["email address", "Email"],
  ["work email", "Email"],
  // Add your custom mappings here
]);
```

## Important Notes

⚠️ **No Deduplication:** This tool does NOT remove duplicate rows. All rows from all files are appended.

⚠️ **Empty Rows:** Completely empty rows (all columns blank) are automatically skipped.

⚠️ **Encoding:** UTF-8 encoding is used. BOM (Byte Order Mark) is automatically removed if present.

⚠️ **CSV Format:** Follows RFC 4180 standard with:
- Comma delimiters
- Quote escaping (double quotes "")
- Support for newlines inside quoted fields

## Requirements
- Node.js v18 or higher
- No external dependencies (uses only Node.js built-in modules)
- For folder selection dialog: Electron environment

## Troubleshooting

**No files found:**
- Ensure the folder contains `.csv` files (case-insensitive)
- Check file permissions

**Encoding issues:**
- Save CSV files in UTF-8 encoding
- Tool automatically handles BOM

**Log file not created:**
- Check write permissions in the target folder
- The tool will continue without logs if unable to write

## License
Part of Koldify Toolkit Electron 2.0
