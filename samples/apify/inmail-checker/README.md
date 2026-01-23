# InMail Checker - Sample Input

This folder contains sample data for testing the InMail Checker tool.

## Files

- **profiles.csv** - Sample CSV with LinkedIn profile URLs to check for InMail eligibility

## How to Use

1. Upload the `profiles.csv` file in the InMail Checker tool
2. Enter your Apify API tokens (get them from https://console.apify.com)
3. Set concurrency (recommended: 5)
4. Select output folder
5. Click "Start InMail Checker"

## Requirements

- Valid Apify API token(s)
- LinkedIn profile URLs in the CSV

## Output

The tool will create a new CSV file with:
- Original columns
- `Status` - done/skipped/error
- `OpenProfile` - true/false for InMail eligibility
- `InmailEligible` - same as OpenProfile
- `ApifyRunId` - the Apify run ID
- `ApifyTokenUsed` - which token was used
- `Error` - error message if any

Each key can process 0.5-1K profiles with ~$5 cost per key.
