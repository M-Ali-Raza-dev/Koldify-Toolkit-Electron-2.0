# Comment Scraper

Extract comments and discussion threads from LinkedIn posts using Apify actors with rotating API keys.

## 📋 Input Files

### Required: post.csv

CSV file with LinkedIn post URLs and metadata:

```
postUrl,author,postText,postDate
https://www.linkedin.com/feed/update/urn:li:activity:1234567890,John Doe,Great insight on AI,2024-12-10
https://www.linkedin.com/feed/update/urn:li:activity:1234567891,Jane Smith,Machine Learning trends,2024-12-09
```

**Required columns (case-insensitive):**
- `postUrl` - LinkedIn post URL
- `author` - Post author name
- `postText` - Post content

**Optional columns:**
- `postDate` - Publication date

## 📤 Output Format

Generates `enriched_comments.csv` with columns:
- **postUrl** - Original LinkedIn post URL
- **author** - Post author
- **commentAuthor** - Person who commented
- **commentText** - Comment content
- **commentDate** - When comment was posted
- **commentReactions** - Number of reactions to comment
- **isReply** - Whether comment is a reply (true/false)
- **replyTo** - If reply, who it's replying to
- **depth** - Comment thread depth (1 = top level, 2+ = nested)

## ⚙️ Configuration

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| Input CSV | Yes | - | CSV with post URLs (post.csv) |
| Per-key limit | Yes | 100 | Max posts per API key |
| Keys file | Yes | - | keys.json with Apify API tokens |
| Output folder | Yes | - | Where enriched_comments.csv will be saved |
| Batch size | No | 10 | Posts per batch |

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
  "key_1": "apify_token_1",
  "key_2": "apify_token_2"
}
```

## 📊 How It Works

1. **Load posts.csv** with LinkedIn post URLs
2. **Validate URLs** - ensures proper LinkedIn post format
3. **Initialize key rotation** - loads and validates all API keys
4. **Batch processing** - sends posts in configurable batches
5. **Extract comments** - captures all comments and threads
6. **Parse comment trees** - identifies replies and nesting
7. **Append results** to enriched_comments.csv
8. **Track usage** in used_keys.json

## 💡 Usage Example

### Via UI:
1. Select "Comment Scraper" from Apify sidebar
2. Choose post.csv with post URLs
3. Set per-key limit: 500
4. Upload keys.json with 2-3 API keys
5. Choose output folder for results
6. Set batch size: 5-10 posts
7. Click "Run Comment Scraper"

### Sample Input (post.csv):
```csv
postUrl,author,postText,postDate
https://www.linkedin.com/feed/update/urn:li:activity:7123456789,Alice Johnson,AI is transforming business,2024-12-10
https://www.linkedin.com/feed/update/urn:li:activity:7123456790,Bob Wilson,Cloud computing best practices,2024-12-09
```

## 📈 Metrics Tracked

- **Total Posts** - Posts in input CSV
- **Processed Posts** - Successfully scraped
- **Active Keys** - Available API keys
- **Banned Keys** - Temporarily unavailable
- **Comments Found** - Total comments extracted

## ⚡ Performance Tips

- Use 2-4 API keys for optimal speed
- Start with batch size of 5-10
- Monitor key usage in used_keys.json
- Consider post engagement level (high engagement = longer scrape)
- Run during off-peak hours for faster completion

## 🔄 Resuming Interrupted Scrapes

If the tool is interrupted:
1. Keep the same output folder
2. Rerun with the same input CSV
3. Tool will append new comments (skips duplicates)
4. Check metrics panel for progress

## 💬 Comment Thread Analysis

The tool preserves comment thread structure:
- **depth=1**: Top-level comments on post
- **depth=2**: Direct replies to top-level comments
- **depth=3+**: Nested conversation threads

Use the `replyTo` and `depth` columns to analyze discussion flows.

## ⚠️ Common Issues

- **Invalid URLs**: Must be LinkedIn post URLs with `/feed/update/`
- **Token errors**: Check keys.json format and token validity
- **Rate limiting**: If getting rate limited, reduce batch size
- **Empty results**: Post may be deleted or private
