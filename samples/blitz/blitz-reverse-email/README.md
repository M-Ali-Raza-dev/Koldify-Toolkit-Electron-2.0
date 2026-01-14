# Blitz Reverse Email → Person Lookup

## Overview

Lookup person details from email addresses using the Blitz API enrichment service.

## Input Formats

### Single Email
```
node blitz-reverse-email.js --email "example@domain.com" --apiKey "YOUR_KEY"
```

### CSV File
```
node blitz-reverse-email.js --input "emails.csv" --column "email" --apiKey "YOUR_KEY"
```

CSV must contain an email column. Example structure:
```
Email,Name,Company
john.doe@company.com,John Doe,Acme Corp
jane.smith@example.com,Jane Smith,Tech Inc
```

### TXT File
```
node blitz-reverse-email.js --input "emails.txt" --apiKey "YOUR_KEY"
```

TXT file with one email per line:
```
john@company.com
jane@example.com
contact@business.com
```

## Output

CSV file with person details extracted from email lookup. Located in the output directory with timestamp:
```
reverse_email_to_person_2024-01-14_12-30-45.csv
```

### Output Columns

| Column | Description |
|--------|-------------|
| Email | Input email address |
| Found | true/false - whether person was found |
| First Name | Person's first name |
| Last Name | Person's last name |
| Full Name | Complete name |
| Headline | LinkedIn headline/title |
| About Me | Person's bio/about section |
| Location City | City of residence |
| Location State Code | State/province code |
| Location Country Code | Country code |
| LinkedIn URL | LinkedIn profile URL |
| Connections Count | Number of LinkedIn connections |
| Profile Picture URL | URL to profile picture |
| Current Job Title | Current position title |
| Current Company LinkedIn URL | Company LinkedIn URL |
| Current Company LinkedIn ID | Company LinkedIn identifier |
| Current Job Start Date | When current job started |
| Current Job End Date | When current job ended |
| Current Job Is Current | Whether job is still active |
| Error Status | HTTP status if lookup failed |
| Error Message | Error description if lookup failed |

## Options

- `--email` - Single email to lookup
- `--input` - Path to CSV or TXT file
- `--column` - Column name in CSV (default: "email")
- `--concurrency` - Number of parallel workers 1-10 (default: 4)
- `--outputDir` - Output folder path (default: ./output)
- `--apiKey` - Blitz API key (or use BLITZ_API_KEY environment variable)
- `--json` - Output only JSON structured logs
- `--verbose` - Output both pretty and JSON logs

## Example CSV

```csv
Email
john.doe@company.com
jane.smith@example.org
contact@startup.io
```

## Example TXT

```
john.doe@company.com
jane.smith@example.org
contact@startup.io
```

## Success Response

```json
{
  "Email": "john@company.com",
  "Found": "true",
  "First Name": "John",
  "Last Name": "Doe",
  "Full Name": "John Doe",
  "Headline": "Director of Sales at Acme Corp",
  "Location City": "San Francisco",
  "Location Country Code": "US",
  "LinkedIn URL": "https://linkedin.com/in/john-doe",
  "Connections Count": "542",
  ...
}
```

## Troubleshooting

- **Missing email column in CSV**: Check that your CSV has a column named "email" or specify the correct column name with `--column`
- **Invalid email format**: The tool filters emails using basic regex validation
- **Rate limits (HTTP 429)**: Tool automatically retries with exponential backoff
- **API errors**: Check your API key is valid and has sufficient credits
