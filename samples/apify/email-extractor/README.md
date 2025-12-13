# Email Extractor

Enrich LinkedIn profiles with professional email addresses using Apify actors and rotating API keys.

## 📋 Input Files

### Required: profiles.csv

CSV file with LinkedIn profile URLs to enrich:

```
linkedinUrl,name,company
https://www.linkedin.com/in/johnsmith,John Smith,TechCorp
https://www.linkedin.com/in/janedoe,Jane Doe,DataCorp
https://www.linkedin.com/in/bobwilson,Bob Wilson,StartupCo
```

**Required columns (case-insensitive):**
- `linkedinUrl` or `profile_url` or `profileUrl` - LinkedIn profile URL

**Optional columns:**
- `name` - Person's full name
- `company` - Company name
- `title` - Job title
- `email` - Existing email (for deduplication)

## 📤 Output Format

Generates `enriched_profiles.csv` with columns:
- **linkedinUrl** - Original LinkedIn URL
- **name** - Full name
- **company** - Current company
- **title** - Current job title
- **email** - Extracted email address
- **emailConfidence** - Confidence score (0-100)
- **secondaryEmail** - Alternative email if found
- **phone** - Phone number (if available)
- **website** - Personal website
- **location** - Current location
- **headline** - Professional headline

## ⚙️ Configuration

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| Input CSV | Yes | - | CSV with LinkedIn profile URLs |
| Output folder | Yes | - | Where enriched_profiles.csv will be saved |
| Keys file | Yes | - | keys.json with Apify API tokens |
| Per-key limit | Yes | 100 | Max profiles per API key |
| Batch size | No | 10 | Profiles per batch (1-50) |
| Actor ID | No | default | Apify actor ID for email extraction |

## 🔑 Keys File Format

**As array:**
```json
[
  "apify_token_1",
  "apify_token_2",
  "apify_token_3"
]
```

**As object:**
```json
{
  "primary_key": "apify_token_1",
  "backup_key": "apify_token_2"
}
```

## 📊 How It Works

1. **Load profiles.csv** with LinkedIn URLs
2. **Validate URLs** - ensures proper LinkedIn profile format
3. **Initialize key rotation** - loads and validates all API keys
4. **Batch processing** - sends profiles in configurable batches
5. **Extract emails** - calls Apify actor for email enrichment
6. **Parse results** - extracts email and confidence scores
7. **Append to CSV** - writes enriched data to output file
8. **Track usage** - updates used_keys.json with key consumption

## 💡 Usage Example

### Via UI:
1. Select "Email Extractor" from Apify sidebar
2. Choose profiles.csv with LinkedIn URLs
3. Set per-key limit: 500
4. Upload keys.json with 2-3 API keys
5. Choose output folder for results
6. Set batch size: 10
7. Click "Run Email Extractor"

### Sample Input (profiles.csv):
```csv
linkedinUrl,name,company,title
https://www.linkedin.com/in/johnsmith,John Smith,TechCorp,Manager
https://www.linkedin.com/in/janedoe,Jane Doe,DataCorp,Director
https://www.linkedin.com/in/bobwilson,Bob Wilson,StartupCo,Founder
```

### Sample Output (enriched_profiles.csv):
```csv
linkedinUrl,name,company,title,email,emailConfidence,secondaryEmail,phone,location
https://www.linkedin.com/in/johnsmith,John Smith,TechCorp,Manager,john.smith@techcorp.com,95,,+1-555-1234,San Francisco
https://www.linkedin.com/in/janedoe,Jane Doe,DataCorp,Director,jane.doe@datacorp.com,88,jane.d@datacorp.com,,New York
https://www.linkedin.com/in/bobwilson,Bob Wilson,StartupCo,Founder,bob@startupco.com,92,,+1-555-5678,Boston
```

## 📈 Metrics Tracked

- **Profiles processed** - Total profiles enriched
- **Emails found** - Successful extractions
- **Emails not found** - Missing or undetected
- **API keys loaded** - Number of available keys
- **Remaining quota** - Credits left

## ⚡ Performance Tips

- **Batch size**: Start with 10-20 profiles per batch
- **API keys**: Use 2-4 keys for optimal speed
- **Per-key limit**: Set to 500-1000 for best performance
- **Monitor keys**: Check used_keys.json for key status
- **Timing**: Some profiles take longer; be patient

## 🔄 Resuming Interrupted Enrichment

If interrupted:
1. Keep the same output folder
2. Rerun with the same input CSV
3. Tool will append new results (skips duplicates)
4. Check metrics panel for progress

## 📊 Email Confidence Scores

- **90-100**: High confidence - verified email
- **75-89**: Medium confidence - pattern matched
- **50-74**: Lower confidence - inferred
- **<50**: Very low confidence - skip these

**Recommendation**: Filter for confidence >= 80 for outreach campaigns

## 🎯 Use Cases

1. **B2B lead generation** - Enrich LinkedIn leads with corporate emails
2. **Sales outreach** - Build email lists for cold email campaigns
3. **Recruitment** - Find contact info for candidates
4. **Data enrichment** - Add emails to existing lead lists
5. **Account-based marketing** - Target decision makers with emails

## ⚠️ Common Issues

- **Invalid URLs**: Must be LinkedIn profile URLs (/in/username format)
- **No emails found**: Profile may be private or not indexed
- **API rate limits**: Reduce batch size if getting throttled
- **Token errors**: Verify keys.json format and token validity
- **Confidence too low**: Actor couldn't confidently determine email

## 🔍 Troubleshooting

| Issue | Solution |
|-------|----------|
| "No results" | Ensure LinkedIn URLs are valid and public |
| "Invalid token" | Check keys.json syntax and Apify API key |
| "Rate limit" | Reduce batch size from 10 to 5 |
| "Timeout errors" | Some profiles take longer; retry failed URLs |
| "Low confidence scores" | Profiles may not have discoverable emails |
