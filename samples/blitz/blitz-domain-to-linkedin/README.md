# Blitz: Domain to LinkedIn URL

Sample inputs for the Domain -> Company LinkedIn URL lookup tool.

## Files
- `domains.csv` — CSV with `domain` column
- `domains.txt` — Plain text, one domain per line

## Notes
- Keep the column name exactly `domain` or update the column name field in the UI.
- Supports CSV or TXT inputs.
- Accepts domains like "blitz-agency.com" or full URLs like "https://blitz-agency.com"
- Concurrency is configurable; start with 3-6 to be gentle on rate limits.
