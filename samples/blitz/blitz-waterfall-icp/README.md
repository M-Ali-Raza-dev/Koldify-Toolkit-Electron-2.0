# Waterfall ICP

Identify decision makers and evaluate company fit using Blitz API with advanced filtering criteria.

## 📋 Input Files

### Required Files:

1. **companies.csv** - List of target companies
2. **include_titles.csv** - Job titles to target (decision makers)
3. **exclude_titles.csv** - Job titles to exclude
4. **locations.csv** - Geographic locations to focus on

### companies.csv
```csv
companyLinkedinUrl,companyName,industry,size
https://www.linkedin.com/company/techcorp-inc,TechCorp Inc,Software,500-1000
https://www.linkedin.com/company/datacorp,DataCorp,Data Science,200-500
https://www.linkedin.com/company/startupco,StartupCo,SaaS,50-100
```

**Required columns:**
- `companyLinkedinUrl` or `company_url` - Company LinkedIn URL

**Optional:**
- `companyName` - Company name
- `industry` - Industry classification
- `size` - Employee count range

### include_titles.csv
```csv
title
CEO
Founder
VP of Sales
Chief Revenue Officer
Head of Marketing
Chief Technology Officer
VP of Engineering
```

**Columns:**
- `title` - Job titles to include in search

### exclude_titles.csv
```csv
title
Intern
Junior
Assistant
Analyst
Representative
Coordinator
```

**Columns:**
- `title` - Job titles to exclude from results

### locations.csv
```csv
location
United States
Canada
San Francisco
New York
Los Angeles
```

**Columns:**
- `location` - Geographic locations to target

## 📤 Output Format

Generates `waterfall_results.csv` with columns:
- **companyName** - Target company name
- **companyUrl** - LinkedIn company URL
- **decisionMaker** - Contact person name
- **title** - Job title
- **email** - Contact email address
- **linkedinUrl** - LinkedIn profile URL
- **location** - Contact location
- **seniority** - Seniority level (C-suite, VP, Manager, etc.)
- **relevanceScore** - How well matches criteria (0-100)
- **emailConfidence** - Email accuracy (0-100)
- **verified** - Email verification status

## ⚙️ Configuration

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| API Key | Yes | - | Provide via field or BLITZ_API_KEY env var |
| Companies CSV | Yes | - | companies.csv with target companies |
| Include Titles CSV | Yes | - | include_titles.csv with target roles |
| Exclude Titles CSV | Yes | - | exclude_titles.csv with roles to skip |
| Locations CSV | Yes | - | locations.csv with target regions |
| Max results/company | No | 5 | Maximum decision makers per company |
| Output folder | Yes | - | Where waterfall_results.csv goes |
| Output filename | No | waterfall_results.csv | Name for results file |

## 🔑 API Key Configuration

### Option 1: Environment Variable
Set `BLITZ_API_KEY` before launching the tool.

### Option 2: UI Field / CLI Flag
Enter your Blitz API key in the UI field or pass `--api-key` when running via CLI. Key format: `blitz_XXXXXXXXXXXXX`

## 📊 How It Works

1. **Load input files** - companies, titles, locations
2. **Validate data** - ensure proper CSV format
3. **Initialize Blitz API** - authenticate with key
4. **For each company:**
   - Query Blitz for employees at that company
   - Filter by INCLUDE titles (decision makers)
   - Exclude any matching EXCLUDE titles
   - Filter by locations
5. **Calculate relevance** - score based on fit
6. **Lookup emails** - enrich with contact info
7. **Verify emails** - confidence scoring
8. **Output results** - write to waterfall_results.csv

## 💡 Usage Example

### Via UI:
1. Select "Waterfall ICP" from Blitz section
2. Upload companies.csv with target companies
3. Upload include_titles.csv with decision maker roles
4. Upload exclude_titles.csv with junior/intern roles
5. Upload locations.csv with target regions
6. Set max results per company: 5
7. Choose output folder
8. Provide your Blitz API key (or ensure BLITZ_API_KEY env var is set)
9. Click "Run Waterfall ICP"

### Sample Data Flow:

**Input - companies.csv:**
```csv
companyLinkedinUrl,companyName
https://www.linkedin.com/company/techcorp-inc,TechCorp Inc
https://www.linkedin.com/company/datacorp,DataCorp
```

**Input - include_titles.csv:**
```csv
title
CEO
VP of Sales
Chief Revenue Officer
Director of Sales
```

**Input - exclude_titles.csv:**
```csv
title
Intern
Assistant
Junior
```

**Input - locations.csv:**
```csv
location
United States
Canada
```

**Sample Output - waterfall_results.csv:**
```csv
companyName,title,decisionMaker,email,linkedinUrl,location,seniority,relevanceScore,emailConfidence
TechCorp Inc,VP of Sales,John Smith,john.smith@techcorp.com,https://www.linkedin.com/in/johnsmith,San Francisco,VP,95,90
TechCorp Inc,Sales Director,Jane Doe,jane.doe@techcorp.com,https://www.linkedin.com/in/janedoe,New York,Director,88,85
DataCorp,Chief Revenue Officer,Bob Wilson,bob@datacorp.com,https://www.linkedin.com/in/bobwilson,Boston,C-Suite,92,88
```

## 📈 Metrics Tracked

- **Companies searched** - Number of target companies
- **Decision makers found** - Matching profiles
- **Emails enriched** - Successful email lookups
- **Relevance average** - Mean ICP fit score

## 🎯 ICP Waterfall Logic

The tool implements a "waterfall" methodology:

1. **Start**: All employees at target companies
2. **Filter 1**: Must have INCLUDE title (VP, Director, C-Suite, etc.)
3. **Filter 2**: Cannot have EXCLUDE title (Intern, Assistant, etc.)
4. **Filter 3**: Must be in target LOCATION
5. **Filter 4**: Top N results by relevance score
6. **Result**: Qualified decision makers ready for outreach

## 📊 Relevance Score Calculation

Based on:
- **Title match** (0-40 points) - How senior the decision maker
- **Location match** (0-30 points) - Geographic targeting
- **Company size** (0-20 points) - Budget/influence potential
- **Seniority level** (0-10 points) - Decision authority

## ⚡ Performance Tips

- **Max results**: Set to 5-10 per company for quality leads
- **Broad filtering**: Wider include titles = more results
- **Specific locations**: Narrows down to best prospects
- **Batch processing**: Tool handles multiple companies efficiently

## 🔄 Resuming Interrupted Searches

If interrupted:
1. Keep same output folder
2. Rerun tool with same input files
3. Tool will append new results (skips completed companies)
4. Check metrics for overall progress

## 🎯 Use Cases

1. **Account-based marketing** - Find decision makers at target accounts
2. **Enterprise sales** - Identify C-suite contacts for outreach
3. **Lead generation** - Build lists of qualified buyers
4. **Territory planning** - Find decision makers by region
5. **Competitive analysis** - Identify key players at competitors

## 📋 Title Classification

### High-Value Titles (C-Suite)
- CEO, Founder, President
- CRO, CMO, CTO, CFO
- Chief of Staff
- Board member

### Mid-Level (VP/Director)
- VP of Sales, Marketing, Engineering
- Director of Business Development
- Head of Growth
- General Manager

### Operational (Manager)
- Sales Manager, Marketing Manager
- Account Executive
- Team Lead

### Junior (Exclude)
- Intern, Assistant, Coordinator
- Associate, Representative
- Specialist (non-senior)

## ⚠️ Common Issues

- **No results**: Expand include titles or adjust locations
- **Invalid URLs**: Ensure company LinkedIn URLs are correct
- **Missing emails**: Some profiles don't have discoverable emails
- **API errors**: Check API key and internet connection
- **Slow results**: Large companies take longer; be patient

## 🔍 Troubleshooting

| Issue | Solution |
|-------|----------|
| "Company not found" | Verify LinkedIn company URL format |
| "No matching titles" | Titles may not exist at that company |
| "No emails found" | Profiles might be private or unlisted |
| "API rate limit" | Reduce max results per company |
| "Location mismatch" | Use exact location names from Blitz |
