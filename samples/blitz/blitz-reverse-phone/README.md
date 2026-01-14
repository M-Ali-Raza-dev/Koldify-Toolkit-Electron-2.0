# Blitz Reverse Phone Lookup - Sample Input

This folder contains sample files for testing the Blitz Reverse Phone Lookup tool.

## Files Included

- **phones.csv**: Sample CSV file with phone numbers
- **phones.txt**: Sample TXT file with phone numbers (one per line)

## How to Use

### Option 1: Single Phone Number
1. Open the Blitz Reverse Phone tool
2. Enter your Blitz API key
3. Enter a single phone number (e.g., +1234567890) in the "Single Phone Number" field
4. Select an output folder
5. Click "Run Reverse Phone"

### Option 2: CSV Input
1. Open the Blitz Reverse Phone tool
2. Enter your Blitz API key
3. Click "Browse" next to "Input File" and select `phones.csv`
4. Make sure "Phone Column" is set to "phone" (or whatever your column name is)
5. Select an output folder
6. Click "Run Reverse Phone"

### Option 3: TXT Input
1. Open the Blitz Reverse Phone tool
2. Enter your Blitz API key
3. Click "Browse" next to "Input File" and select `phones.txt`
4. Select an output folder
5. Click "Run Reverse Phone"

## Output

The tool will create a timestamped CSV file in your output folder with the following columns:

- phone
- found (true/false)
- first_name
- last_name
- full_name
- headline
- about_me
- location_city
- location_state_code
- location_country_code
- linkedin_url
- connections_count
- profile_picture_url
- current_job_title
- current_company_linkedin_url
- current_company_linkedin_id
- current_job_start_date
- current_job_end_date
- current_job_is_current
- error_status
- error_message

## Settings

- **Concurrency**: Number of parallel API requests (1-10). Default is 3.
- **Phone Column**: For CSV files, specify which column contains the phone numbers. Default is "phone".

## Notes

- The API automatically handles rate limiting with exponential backoff
- Invalid or non-existent phone numbers will be marked with `found=false`
- Phone numbers should be in international format (e.g., +1234567890)
