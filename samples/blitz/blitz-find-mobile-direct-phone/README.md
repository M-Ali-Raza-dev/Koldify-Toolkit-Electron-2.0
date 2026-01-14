# Blitz: Find Mobile & Direct Phone

Sample inputs for the LinkedIn URL -> phone lookup tool.

## Files
- `links.csv` — CSV with `person_linkedin_url` column
- `links.txt` — Plain text, one LinkedIn URL per line

## Notes
- Keep the column name exactly `person_linkedin_url` or update the column name field in the UI.
- Supports CSV or TXT inputs.
- Concurrency is configurable; start with 3-5 to be gentle on rate limits.
