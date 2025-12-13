# Blitz Email Enricher

Enrich LinkedIn profiles with professional email addresses using the Blitz API (non-Apify alternative).

## 📋 Input Files

### Required: post.csv

CSV file with LinkedIn profile URLs to enrich:

```
linkedinUrl,name,company,title
https://www.linkedin.com/in/johnsmith,John Smith,TechCorp,Manager
https://www.linkedin.com/in/janedoe,Jane Doe,DataCorp,Director
https://www.linkedin.com/in/bobwilson,Bob Wilson,StartupCo,CEO
```

**Required columns (case-insensitive):**
- `linkedinUrl` or `profile_url` - LinkedIn profile URL

**Optional columns:**
- `name` - Person's name
- `company` - Company name
- `title` - Job title
- `email` - Existing email

## 📤 Output Format

Generates `enriched_blitz.csv` with columns:
- **linkedinUrl** - Original LinkedIn profile URL
- **name** - Person's name
- **company** - Company name
- **title** - Job title
- **email** - Extracted email address
- **emailConfidence** - Confidence score (0-100)
- **domain** - Email domain
- **verified** - Whether email is verified (true/false)
- **primaryEmail** - Primary business email
- **source** - Source of email discovery

## ⚙️ Configuration

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| Input CSV | Yes | - | CSV with LinkedIn URLs (post.csv) |
| Output folder | Yes | - | Where enriched_blitz.csv will be saved |
| API Key | Yes | - | Provide via field or BLITZ_API_KEY env var |
| Output filename | No | enriched_blitz.csv | Name for output file |
| Batch size | No | 10 | Profiles per batch |
| Stream append | Yes | true | Append to existing output |

## 🔑 API Key Configuration

### Option 1: Environment Variable
Set `BLITZ_API_KEY` in your environment before running the tool.

### Option 2: UI Field / CLI Flag
Enter your Blitz API key in the UI field (or pass `--api-key` when running via CLI).

**Key format:** `blitz_XXXXXXXXXXXXXXXXXXXXXXX`

## 📊 How It Works

1. **Load input CSV** with LinkedIn profile URLs
2. **Validate URLs** - ensures proper LinkedIn format
3. **Initialize Blitz API** - authenticates with API key
4. **Batch processing** - sends profiles in configurable batches
5. **Query Blitz database** - searches for email matches
6. **Extract results** - captures email and confidence
7. **Write output** - appends to enriched_blitz.csv
8. **Report metrics** - shows progress and stats

## 💡 Usage Example

### Via UI:
1. Select "Email Enricher" from Blitz section
2. Choose post.csv with LinkedIn profile URLs
3. Provide your Blitz API key (or ensure BLITZ_API_KEY env var is set)
4. Choose output folder for results
5. Keep batch size: 10
6. Enable "Append to existing"
7. Click "Run Email Enricher"

### Sample Input (post.csv):
```csv
linkedinUrl,name,company,title
https://www.linkedin.com/in/johnsmith,John Smith,TechCorp,Manager
https://www.linkedin.com/in/janedoe,Jane Doe,DataCorp,Director
https://www.linkedin.com/in/bobwilson,Bob Wilson,StartupCo,Founder
```

### Sample Output (enriched_blitz.csv):
```csv
linkedinUrl,name,company,title,email,emailConfidence,domain,verified,source
https://www.linkedin.com/in/johnsmith,John Smith,TechCorp,Manager,john.smith@techcorp.com,92,techcorp.com,true,database
https://www.linkedin.com/in/janedoe,Jane Doe,DataCorp,Director,jane.doe@datacorp.com,88,datacorp.com,true,pattern
https://www.linkedin.com/in/bobwilson,Bob Wilson,StartupCo,Founder,bob@startupco.io,85,startupco.io,true,pattern
```

## 📈 Metrics Displayed

- **Rows Processed** - Total profiles enriched
- **Emails Found** - Successful extractions
- **Emails Not Found** - Missing matches
- **Confidence Average** - Mean confidence score

## ⚡ Performance Tips

- **Batch size**: 10-20 for balanced speed/reliability
- **Stream append**: Keep enabled to resume interrupted runs
- **Large files**: Split large CSVs into chunks of 5000 rows
- **Retry failed**: Keep same output folder to retry failed profiles

## 🔄 Resuming Interrupted Enrichment

If interrupted:
1. Keep "Stream append" enabled
2. Keep the same output folder
3. Rerun tool with same input CSV
4. Tool will skip already enriched profiles
5. Check metrics for progress

## 📊 Email Confidence Scores

- **90-100**: Verified email addresses
- **80-89**: High confidence matches
- **70-79**: Pattern matched email
- **<70**: Lower confidence predictions

**Best practice**: Use emails with confidence >= 80 for outreach

## 🎯 Use Cases

1. **Email list building** - Create enriched lead lists from LinkedIn
2. **Sales prospecting** - Find contact emails for cold outreach
3. **Recruitment** - Locate candidate email addresses
4. **Marketing outreach** - Email addresses for campaigns
5. **Data enrichment** - Add emails to existing contacts

## 🔄 Blitz vs Apify Comparison

| Feature | Blitz | Apify |
|---------|-------|-------|
| Speed | Fast | Slower |
| Accuracy | High | Very high |
| Cost | Per query | Per credit |
| API calls | Direct | Via actor |
| Batch size | 10+ | 5-20 |

## ⚠️ Common Issues

- **Invalid URLs**: Must be LinkedIn profile URLs
- **API errors**: Check internet connection and Blitz key
- **No results**: Profile may be unlisted or private
- **Rate limiting**: Reduce batch size if getting throttled
- **Auth errors**: Verify API key is correct format

## 🔍 Troubleshooting

| Issue | Solution |
|-------|----------|
| "API key invalid" | Use default key or get new key from Blitz |
| "No results" | Ensure LinkedIn URLs are public profiles |
| "Too slow" | Increase batch size from 10 to 20 |
| "Connection error" | Check internet connection |
| "Output file not created" | Ensure output folder is writable |
