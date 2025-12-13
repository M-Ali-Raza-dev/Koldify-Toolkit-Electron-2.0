# Post Finder

Search LinkedIn for posts by keywords and export results to CSV with rotating API keys.

## 📋 Input Files

### Option 1: Single Keyword
- Enter keyword directly in the UI form

### Option 2: Keywords File (keywords.txt)
```
artificial intelligence
machine learning
data science
python programming
ai trends
```

## 📤 Output Format

The tool generates `posts.csv` with columns:
- **postUrl** - LinkedIn post URL
- **postText** - Post content
- **author** - Author name
- **authorUrl** - Author LinkedIn profile URL
- **reactions** - Number of reactions
- **comments** - Number of comments
- **shares** - Number of shares
- **timestamp** - Post date

## ⚙️ Configuration

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| Keyword / Name | Yes | - | Single keyword or path to keywords file |
| Per-key limit | Yes | 100 | Max posts per API key |
| Keys file | Yes | - | keys.json with Apify API tokens |
| Output folder | Yes | - | Where posts.csv will be saved |

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
  "api_key_1": "apify_token_1",
  "api_key_2": "apify_token_2",
  "api_key_3": "apify_token_3"
}
```

## 📊 How It Works

1. **Load keywords** from file or single keyword input
2. **Track progress** in keywords.json (already searched keywords)
3. **Rotate API keys** - distributes load across all keys
4. **Filter results** - only posts with 20+ reactions
5. **Append results** to posts.csv
6. **Emit metrics** for live UI updates

## 💡 Usage Example

### Via UI:
1. Select "Post Finder" from Apify sidebar
2. Enter keyword: "machine learning" OR upload keywords.txt
3. Set per-key limit: 500
4. Upload keys.json
5. Choose output folder
6. Click "Run Post Finder"

### Sample Keywords File (keywords.txt):
```
artificial intelligence
deep learning
neural networks
data engineering
cloud computing
```

## 📈 Metrics Tracked

- **Total Keys Loaded** - Number of API keys available
- **Posts Found** - Total posts scraped
- **Keywords Processed** - Progress tracking

## ⚡ Performance Tips

- Use multiple API keys for faster processing
- Start with lower per-key limit (100-500) to test
- Monitor used_keys.json for key exhaustion
- Keywords file allows resuming from where you left off

## 🔄 Resuming Interrupted Searches

The tool tracks searched keywords in `keywords.json`. If interrupted:
1. Keep the same output folder
2. Rerun the tool with same keywords
3. It will skip already-processed keywords and continue
