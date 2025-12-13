# Reaction Scraper

Extract reactions and comments from LinkedIn posts using Apify actors with rotating API keys.

## 📋 Input Files

### Required: posts.csv

CSV file with LinkedIn post URLs and details:

```
postUrl,author,postText
https://www.linkedin.com/feed/update/urn:li:activity:1234567890,John Doe,Great insight on AI
https://www.linkedin.com/feed/update/urn:li:activity:1234567891,Jane Smith,Machine Learning trends
https://www.linkedin.com/feed/update/urn:li:activity:1234567892,Bob Wilson,Data Science tips
```

**Required columns (case-insensitive):**
- `postUrl` - LinkedIn post URL (must contain `linkedin.com/feed/update`)
- `author` - Name of post author
- `postText` - Post content or description

## 📤 Output Format

Generates `enriched_reactions.csv` with columns:
- **postUrl** - Original LinkedIn post URL
- **author** - Post author name
- **postText** - Post content
- **totalReactions** - Total number of reactions
- **likes** - Count of likes
- **comments** - Count of comments
- **reposts** - Count of reposts
- **reactions** - Array of reaction types (like, celebrate, support, love, insightful, curious)
- **commenters** - List of people who commented
- **timestamp** - When post was published

## ⚙️ Configuration

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| Input CSV | Yes | - | CSV with post URLs (posts.csv) |
| Per-key limit | Yes | 100 | Max posts per API key |
| Keys file | Yes | - | keys.json with Apify API tokens |
| Output folder | Yes | - | Where enriched_reactions.csv will be saved |
| Batch size | No | 10 | Posts per batch (1-50 recommended) |

## 🔑 Keys File Format

**As array:**
```json
[
  "apify_token_1",
  "apify_token_2"
]
```

**As object:**
```json
{
  "prod_key": "apify_token_1",
  "backup_key": "apify_token_2"
}
```

## 📊 How It Works

1. **Load posts.csv** with post URLs
2. **Validate URLs** - filters for valid LinkedIn post URLs
3. **Rotate API keys** - uses keys in round-robin fashion
4. **Batch processing** - sends posts in configurable batch sizes
5. **Extract reactions** - captures engagement metrics
6. **Append results** to output CSV
7. **Track key usage** in used_keys.json

## 💡 Usage Example

### Via UI:
1. Select "Reaction Scraper" from Apify sidebar
2. Choose posts.csv with post URLs
3. Set per-key limit: 500
4. Upload keys.json
5. Choose output folder
6. Set batch size: 10
7. Click "Run Reaction Scraper"

### Sample Input (posts.csv):
```csv
postUrl,author,postText
https://www.linkedin.com/feed/update/urn:li:activity:1234567890,Alice Johnson,Excited to announce new AI features!
https://www.linkedin.com/feed/update/urn:li:activity:1234567891,Bob Wilson,Machine learning changed our company
```

## 📈 Metrics Tracked

- **Posts Processed** - Total posts scraped
- **Valid Posts** - Posts with valid URLs
- **Active Keys** - Available API keys
- **Banned Keys** - Temporarily unavailable keys

## ⚡ Performance Tips

- Start with batch size of 10-20 posts
- Use at least 2-3 API keys for stability
- Monitor used_keys.json for key status
- Interrupt and retry on validation errors

## 🔄 Resuming Interrupted Scrapes

If interrupted:
1. Keep same output folder
2. Run tool again with same input CSV
3. Tool will append new results (skips duplicates)
4. Check metrics to see progress

## ⚠️ Common Issues

- **Invalid URL**: Post URL must contain `linkedin.com/feed/update`
- **Banned key**: Check used_keys.json for key status
- **No results**: Verify post URLs are publicly visible
