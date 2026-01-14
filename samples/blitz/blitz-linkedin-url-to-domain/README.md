# Blitz: LinkedIn URL to Domain

Sample inputs for the Company LinkedIn URL -> email domain lookup tool.

## Files
- `companies.csv` — CSV with `company_linkedin_url` column
- `companies.txt` — Plain text, one company LinkedIn URL per line

## Notes
- Keep the column name exactly `company_linkedin_url` or update the column name field in the UI.
- Supports CSV or TXT inputs.
- Concurrency is configurable; start with 3-6 to be gentle on rate limits.
