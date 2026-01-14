# Lead Merger

Merge multiple LinkedIn lead CSV files with strict header validation, deduplication, and normalization.

## 📋 Input Files

Place all lead CSV files in a single input directory. The tool will find and merge all `.csv` files with matching headers.

### Example Input Structure:
```
input_folder/
├── leads_batch_a.csv
├── leads_batch_b.csv
├── prospects.csv
└── contacts.csv
```

### Expected CSV Format

All CSVs must have compatible headers (case/space-insensitive, order-independent):

**Standard LinkedIn Lead Columns:**
- `firstName` / `first_name` / `First Name`
- `lastName` / `last_name` / `Last Name`
- `email`
- `company`
- `jobTitle` / `job_title` / `title`
- `linkedinUrl` / `linkedin_url`
- `location` / `city` / `country`
- `industry`

**Optional columns:**
- Phone, website, experience, skills, etc.

## 📤 Output Format

Generates `merged_leads.csv` (or custom filename) with:
- **Unique leads** - Deduplicates by email and LinkedIn URL
- **Normalized headers** - Consistent column naming
- **Sorted data** - Alphabetically by first/last name
- **All original columns** - Preserves data integrity

### Sample Output:
```csv
firstName,lastName,email,company,jobTitle,linkedinUrl,location,industry
John,Smith,john.smith@techcorp.com,TechCorp,Manager,https://www.linkedin.com/in/johnsmith,San Francisco,Technology
Jane,Doe,jane.doe@datacorp.com,DataCorp,Director,https://www.linkedin.com/in/janedoe,New York,Data Science
```

## ⚙️ Configuration

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| Input folder | Yes | - | Directory with CSV lead files |
| Output folder | Yes | - | Where merged_leads.csv will be saved |
| Output filename | No | merged_leads.csv | Name for merged file |
| Remove duplicates | Yes | true | Deduplicate by email/URL |
| Normalize headers | Yes | true | Standardize column names |

## 📊 How It Works

1. **Scan folder** - Finds all `.csv` files in input directory
2. **Validate headers** - Ensures compatible columns (flexible matching)
3. **Read data** - Parses all CSVs with header normalization
4. **Extract emails** - Normalizes email addresses (lowercase)
5. **Merge records** - Combines all lead data
6. **Deduplicate** - Removes duplicates by email and LinkedIn URL
7. **Sort leads** - Alphabetically by firstName, lastName
8. **Write output** - Creates merged CSV with clean data
9. **Emit metrics** - Reports stats to UI

## 💡 Usage Example

### Via UI:
1. Select "Lead Merger" from Apify sidebar
2. Choose input folder with CSV lead files
3. Choose output folder for merged results
4. Set output filename: "all_leads.csv"
5. Enable "Remove duplicates"
6. Enable "Normalize headers"
7. Click "Run Lead Merger"

### Sample Input Files:

**leads_a.csv:**
```csv
first_name,last_name,email,company,job_title,linkedin_url
John,Smith,john.smith@techcorp.com,TechCorp,Manager,https://www.linkedin.com/in/johnsmith
Alice,Johnson,alice@datacorp.com,DataCorp,Engineer,https://www.linkedin.com/in/alicejohnson
```

**leads_b.csv:**
```csv
FirstName,LastName,Email,Company,JobTitle,LinkedInUrl,City
Bob,Wilson,bob.wilson@startupco.com,StartupCo,CEO,https://www.linkedin.com/in/bobwilson,Boston
John,Smith,john.smith@techcorp.com,TechCorp,Manager,https://www.linkedin.com/in/johnsmith,San Francisco
```

### Expected Output (merged_leads.csv):
```csv
firstName,lastName,email,company,jobTitle,linkedinUrl,city
Alice,Johnson,alice@datacorp.com,DataCorp,Engineer,https://www.linkedin.com/in/alicejohnson,
Bob,Wilson,bob.wilson@startupco.com,StartupCo,CEO,https://www.linkedin.com/in/bobwilson,Boston
John,Smith,john.smith@techcorp.com,TechCorp,Manager,https://www.linkedin.com/in/johnsmith,San Francisco
```

## 📈 Metrics Displayed

- **Files merged** - Number of input CSVs processed
- **Total rows** - Sum of all input rows
- **Unique leads** - After deduplication
- **Duplicates removed** - Count of removed records
- **Output file** - Path to merged CSV

## ⚡ Performance Tips

- **Header flexibility** - Tool matches headers with case/space tolerance
- **Order independent** - Column order doesn't matter
- **Missing data** - Blank cells are preserved
- **Large datasets** - Tested with 10K+ leads
- **Memory efficient** - Streams files instead of loading all at once

## 🔄 Deduplication Strategy

Records are considered duplicates if they match:
1. **Email address** (primary key) - case-insensitive
2. **LinkedIn URL** (secondary key) - exact match

If either matches, the record is marked as duplicate.
When duplicates found, the first occurrence is kept.

## 🎯 Use Cases

1. **Consolidate lead sources** - Merge CRM exports with Apify results
2. **Clean lead lists** - Remove duplicates across campaigns
3. **Prepare for outreach** - Create unified contact list
4. **Data reconciliation** - Combine data from different periods
5. **Sales enablement** - Create master lead database

## 🔧 Header Normalization Examples

These variations are all recognized as the same column:
- `firstName`, `first_name`, `First Name`, `FIRST_NAME` → `firstName`
- `email`, `Email Address`, `EMAIL` → `email`
- `linkedinUrl`, `linkedin_url`, `LinkedIn URL` → `linkedinUrl`
- `company`, `Company Name`, `COMPANY` → `company`

## ⚠️ Common Issues

- **Incompatible headers**: Ensure at least one matching header between files
- **Empty folder**: Tool won't run if no CSV files found
- **Encoding issues**: Use UTF-8 encoding for CSV files
- **Special characters**: Email normalization handles standard formats
- **Blank rows**: Tool skips completely empty rows

## 🔍 Troubleshooting

| Issue | Solution |
|-------|----------|
| "No matching headers" | Ensure CSVs have compatible column names |
| "No output file created" | Check that input CSVs aren't empty |
| "Unexpected column names" | Use standard LinkedIn column names |
| "Too many duplicates" | Verify data quality in source files |
