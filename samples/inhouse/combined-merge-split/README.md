# Merge / Split CSV

Merge multiple CSV files with deduplication and split results into chunks of configurable size.

## 📋 Input Files

Place all CSV files to merge in a single directory. The tool will find and process all `.csv` files.

### Example Input Structure:
```
input_folder/
├── results_batch1.csv
├── results_batch2.csv
├── results_batch3.csv
└── results_batch4.csv
```

### Supported CSV Columns

The tool handles LinkedIn-specific data with columns like:
- `actor` or `linkedinUrl` - LinkedIn profile URL
- `query` or `post` - Search query or post reference
- `author` - Author name (extracted from filename if present)
- Standard columns: name, email, company, title, etc.

## 📤 Output Format

Generates numbered CSV files:
- `merged_1.csv` - First chunk
- `merged_2.csv` - Second chunk
- `merged_3.csv` - Third chunk
- etc.

**Output includes:**
- All unique records (deduplication by URL or main identifier)
- Preserved column headers
- Sorted results for consistency
- Author information (from filename or data)

## ⚙️ Configuration

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| Input folder | Yes | - | Directory with all CSV files to merge |
| Output folder | Yes | - | Where split CSVs will be saved |
| Chunk size | Yes | 1000 | Rows per output file |
| Mode | Yes | merge-split | Operation mode (merge-split or merge-only) |

## 🔀 Modes Explained

### Merge-Split (Default)
- **Merge** all CSVs into one virtual table
- **Deduplicate** by LinkedIn URL or primary identifier
- **Sort** results alphabetically
- **Split** into chunks of specified size
- Useful when you need distributed processing

### Merge-Only
- **Merge** all CSVs into one
- **Deduplicate** rows
- **Output single file**: `merged_final.csv`
- No splitting applied

## 💡 Usage Example

### Via UI:
1. Select "Merge / Split CSV" from Apify sidebar
2. Choose input folder with CSV files
3. Choose output folder for results
4. Set chunk size: 500 (rows per file)
5. Select mode: "merge-split"
6. Click "Run Merge / Split"

### Sample Input Files:

**file1.csv:**
```csv
linkedinUrl,name,title,company,author
https://www.linkedin.com/in/john-smith,John Smith,Manager,TechCorp,Alice
https://www.linkedin.com/in/jane-doe,Jane Doe,Director,DataCo,Alice
```

**file2.csv:**
```csv
linkedinUrl,name,title,company,author
https://www.linkedin.com/in/bob-wilson,Bob Wilson,Engineer,DevCorp,Bob
https://www.linkedin.com/in/john-smith,John Smith,Manager,TechCorp,Bob
```

### Expected Output:

**merged_1.csv:**
```csv
linkedinUrl,name,title,company,author
https://www.linkedin.com/in/bob-wilson,Bob Wilson,Engineer,DevCorp,Bob
https://www.linkedin.com/in/jane-doe,Jane Doe,Director,DataCo,Alice
https://www.linkedin.com/in/john-smith,John Smith,Manager,TechCorp,Alice
```

## 📊 How It Works

1. **Scan directory** - Finds all `.csv` files
2. **Parse CSVs** - Reads all files with header detection
3. **Normalize headers** - Handles case/space variations
4. **Deduplicate** - Removes duplicate records by URL or ID
5. **Sort results** - Alphabetically by primary column
6. **Split into chunks** - Creates multiple files of specified size
7. **Preserve metadata** - Keeps author info and all columns

## 📈 Metrics Tracked

- **Total input rows** - Sum of all input files
- **Unique rows** - After deduplication
- **Duplicates removed** - Count of removed records
- **Output files** - Number of split chunks created
- **Rows per file** - Actual chunk sizes

## ⚡ Performance Tips

- **Large datasets**: Use chunk size of 500-1000 rows
- **Wide CSVs**: With many columns, may need more memory
- **Duplicates**: Tool automatically removes ~10-20% duplicates
- **Sort order**: Results sorted alphabetically for consistency

## 🔄 Processing Examples

### Example 1: Small Merge
```
Input: 3 files × 300 rows = 900 rows
After dedup: 850 unique rows
Chunk size: 500
Output: merged_1.csv (500 rows) + merged_2.csv (350 rows)
```

### Example 2: Large Split
```
Input: 10 files × 1000 rows = 10,000 rows
After dedup: 8,500 unique rows
Chunk size: 1000
Output: merged_1.csv through merged_9.csv
```

## 🎯 Use Cases

1. **Combine Apify batches** - Merge results from multiple scraping runs
2. **Distribute for enrichment** - Split large dataset for parallel processing
3. **Deduplicate leads** - Remove duplicates across multiple sources
4. **Prepare for import** - Create properly sized files for external tools
5. **Data consolidation** - Merge data from different time periods

## ⚠️ Common Issues

- **Empty output**: Ensure CSV files are in input folder
- **No deduplication**: Check if URLs are in different formats
- **Missing columns**: Tool preserves all columns from all files
- **Sorting issues**: Results sorted by first non-ID column
