# LinkedIn Profile Enhancer Sample

This sample demonstrates how to use the LinkedIn Profile Enhancer tool to extract and enrich LinkedIn profile data.

## Files

- **keys.json** - Apify API keys (required)
- **sample_profiles.csv** - Sample input with LinkedIn profile URLs

## Input CSV Format

The input CSV should contain LinkedIn profile URLs in a column named `profileUrl` (case-insensitive). Optional columns:
- `firstname` - First name of the person
- `lastname` - Last name of the person
- `email` - Email address
- `author` - Name of the person who shared the post
- `postLinkedinUrl` - LinkedIn post URL where profile was found
- `companyWebsite` - Company website URL
- `companyLinkedinUrl` - LinkedIn company page URL

## Output

The tool will generate an enriched CSV with the following columns:
- Firstname, Lastname
- Headline (professional headline)
- Profile URL
- Email, Email Domain
- Company Name
- Job Title
- Is Current Position (true/false)
- Start Year, Start Month
- Company LinkedIn URL
- Company Website Input
- Author, Post LinkedIn URL

## Requirements

1. Valid Apify API keys in `keys.json`
2. Input CSV with LinkedIn profile URLs
3. Output folder where results will be saved

## How to Use

1. Update `keys.json` with your Apify API tokens
2. Prepare your input CSV with LinkedIn profile URLs
3. Select the tool from the sidebar: "LinkedIn Profile Enhancer"
4. Choose your input CSV file
5. Select an output folder
6. Upload your keys.json
7. Click "Run Profile Enricher"

The tool will process profiles in batches, showing progress and updating metrics in real-time.
