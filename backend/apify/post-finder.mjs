// backend/post-finder.mjs
// LinkedIn Post Finder — Apify actor wrapper (Electron-friendly)
// - Rotates API keys with used_keys.json
// - Tracks already-scraped keywords in keywords.json
// - Filters posts by reactions >= 20
// - Writes posts.csv (append, with header)
// - Supports:
//     --output-dir PATH
//     --output-csv PATH
//     --keys PATH
//     --per-key-limit N
//     --keyword-file PATH   (txt or csv list of keywords)
//     --keyword "single keyword"
//
// Electron:
//   Reads TOOL_CONFIG JSON from process.env.TOOL_CONFIG, e.g.:
//   {
//     "keyword": "ai",
//     "keywordFile": "C:\\...\\keywords.txt",
//     "keysJson": "C:\\...\\keys.json",
//     "outputDir": "C:\\...\\output",
//     "perKeyLimit": 3000
//   }

import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import { stringify } from "csv-stringify/sync";
import { ApifyClient } from "apify-client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cancelRequested = false;

/* ===================== METRICS TRACKING ===================== */
let globalMetrics = {
  totalKeys: 0,
  postsFound: 0
};

function emitMetrics() {
  console.log(JSON.stringify({
    type: 'metrics',
    metrics: {
      totalKeys: globalMetrics.totalKeys,
      postsFound: globalMetrics.postsFound
    }
  }));
}

/* ===================== STOP FLAG (Electron) ===================== */

const STOP_FLAG_FILE = process.env.STOP_FLAG_FILE || null;
function shouldStop() {
  return cancelRequested || (STOP_FLAG_FILE && fs.existsSync(STOP_FLAG_FILE));
}

/* ===================== GRACEFUL STOP (SIGTERM/SIGINT) ===================== */

function handleStopSignal(signal) {
  console.log("");
  console.log("=".repeat(80));
  console.log(`[STOP] Signal ${signal} received by post-finder.`);
  console.log("[STOP] Will NOT start new keywords.");
  console.log("[STOP] Any in-flight Apify run will finish, then exit.");
  console.log("=".repeat(80));
  cancelRequested = true;
}

process.on("SIGTERM", handleStopSignal);
process.on("SIGINT", handleStopSignal);

/* ===================== CLI + ENV PARSING ===================== */
const argv = process.argv.slice(2);

function getArg(flag, fallback) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return fallback;
  const val = argv[idx + 1];
  if (!val || val.startsWith("--")) return fallback;
  return val;
}

function getArgNumber(flag, fallback) {
  const v = getArg(flag, null);
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// TOOL_CONFIG from Electron (if present)
let envCfg = {};
try {
  envCfg = process.env.TOOL_CONFIG ? JSON.parse(process.env.TOOL_CONFIG) : {};
} catch {
  envCfg = {};
}

function fromEnv(key, fallback) {
  return Object.prototype.hasOwnProperty.call(envCfg, key)
    ? envCfg[key]
    : fallback;
}

const isElectronSpawn = !!process.env.TOOL_CONFIG || !!process.env.TOOL_ID;

/* ===================== DEFAULTS ===================== */
const DEFAULT_OUTPUT_DIR =
  "D:\\apollo aify leads fixer\\apollo aify leads fixer\\apify post search";
const DEFAULT_OUTPUT_CSV = path.join(DEFAULT_OUTPUT_DIR, "posts.csv");

// Data files next to this script by default
const DEFAULT_KEYS_JSON = path.join(__dirname, "keys.json");
const DEFAULT_USED_KEYS_BASENAME = "used_keys.json";
const DEFAULT_KEYWORDS_BASENAME = "keywords.json";

/* ===================== EFFECTIVE CONFIG ===================== */

// Output folder first (Electron → CLI → default)
const OUTPUT_DIR = getArg(
  "--output-dir",
  fromEnv("outputDir", DEFAULT_OUTPUT_DIR)
);

// Output CSV (Electron → CLI → OUTPUT_DIR/posts.csv)
const OUTPUT_CSV = getArg(
  "--output-csv",
  fromEnv("outputCsv", path.join(OUTPUT_DIR, "posts.csv"))
);

// keys.json
const KEYS_JSON = getArg(
  "--keys",
  fromEnv("keysJson", DEFAULT_KEYS_JSON)
);

// used_keys.json & keywords.json live next to KEYS_JSON
const KEYS_DIR = path.dirname(KEYS_JSON);
const USED_KEYS_JSON = path.join(
  KEYS_DIR,
  path.basename(fromEnv("usedKeysJson", DEFAULT_USED_KEYS_BASENAME))
);
const KEYWORDS_JSON = path.join(
  KEYS_DIR,
  path.basename(fromEnv("keywordsJson", DEFAULT_KEYWORDS_BASENAME))
);

// Per-key quota (Electron → CLI → default 3000)
const PER_KEY_LIMIT = getArgNumber(
  "--per-key-limit",
  fromEnv("perKeyLimit", 3000)
);

// Single keyword / keyword file (Electron → CLI)
const KEYWORD_FILE = getArg(
  "--keyword-file",
  fromEnv("keywordFile", null)
);
const SINGLE_KEYWORD = getArg(
  "--keyword",
  fromEnv("keyword", null)
);

// CSV Header (fixed)
const CSV_HEADER = ["Post Url", "Author Name", "Reaction Num"];

/* ===================== HELPERS ===================== */
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// Initialize data stores if missing
function initStores() {
  if (!fs.existsSync(KEYS_JSON)) {
    writeJson(KEYS_JSON, [
      // "apify_api_XXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      // "apify_api_YYYYYYYYYYYYYYYYYYYYYYYYYYYY"
    ]);
    console.log(
      `⛏️  Created ${path.basename(
        KEYS_JSON
      )} — add your Apify API keys (array of strings).`
    );
  }
  if (!fs.existsSync(USED_KEYS_JSON)) {
    writeJson(USED_KEYS_JSON, []);
    console.log(`⛏️  Created ${path.basename(USED_KEYS_JSON)}.`);
  }
  if (!fs.existsSync(KEYWORDS_JSON)) {
    writeJson(KEYWORDS_JSON, { scraped: [] });
    console.log(`⛏️  Created ${path.basename(KEYWORDS_JSON)}.`);
  }
}

// Load next usable key (one with remaining > 0). If not in used file yet, seed with PER_KEY_LIMIT.
function getNextKey() {
  const keys = readJsonSafe(KEYS_JSON, []);
  if (keys.length === 0) {
    console.error("❌ No API keys found in keys.json. Add at least one key.");
    process.exit(1);
  }
  let used = readJsonSafe(USED_KEYS_JSON, []);

  // Seed any new keys not yet tracked
  const usedTokensSet = new Set(used.map((k) => k.token));
  keys.forEach((k) => {
    if (!usedTokensSet.has(k)) {
      used.push({ token: k, remaining: PER_KEY_LIMIT });
    }
  });

  // Filter keys with remaining > 0
  used = used.filter((k) => k.remaining > 0);

  if (used.length === 0) {
    console.error(
      "❌ All API keys are exhausted. Refill keys.json or reset used_keys.json."
    );
    process.exit(1);
  }

  // Save normalized used list
  writeJson(USED_KEYS_JSON, used);

  // Return first usable
  return used[0];
}

function decrementRemaining(token, amount) {
  const used = readJsonSafe(USED_KEYS_JSON, []);
  const idx = used.findIndex((k) => k.token === token);
  if (idx >= 0) {
    const newRemaining = Math.max(0, used[idx].remaining - amount);
    used[idx].remaining = newRemaining;
    writeJson(USED_KEYS_JSON, used);
  }
}

// Append or create CSV with header
function appendToCsv(rows) {
  ensureDir(OUTPUT_DIR);
  const exists = fs.existsSync(OUTPUT_CSV);
  const data = stringify(rows, {
    header: !exists,
    columns: exists ? undefined : CSV_HEADER,
  });
  fs.writeFileSync(OUTPUT_CSV, data, { flag: "a" });
}

// Collect all dataset items (pagination-safe)
async function listAllItems(client, datasetId) {
  const all = [];
  let limit = 1000;
  let offset = 0;
  for (;;) {
    const { items, total } = await client
      .dataset(datasetId)
      .listItems({ limit, offset });
    all.push(...items);
    if (items.length < limit) break;
    offset += items.length;
    if (total && all.length >= total) break;
  }
  return all;
}

// Normalize one item to our CSV row shape
function normalizeItem(item) {
  const authorName =
    item?.author?.name ??
    item?.["author/name"] ??
    item?.authorName ??
    "";

  const reactionsRaw =
    item?.engagement?.likes ??
    item?.["engagement/likes"] ??
    item?.reactions ??
    0;
  const reactionNum = Number(reactionsRaw) || 0;

  const postUrl =
    item?.linkedinUrl ??
    item?.["linkedinUrl"] ??
    item?.url ??
    item?.postUrl ??
    "";

  return {
    "Post Url": postUrl,
    "Author Name": authorName,
    "Reaction Num": reactionNum,
  };
}

// Deduplicate by postUrl (keep first)
function dedupeByUrl(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r["Post Url"]) continue;
    if (seen.has(r["Post Url"])) continue;
    seen.add(r["Post Url"]);
    out.push(r);
  }
  return out;
}

// Simple CLI prompt (only used when NOT in Electron)
function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

/* ===================== APIFY RUN ===================== */

/**
 * Run one Apify search for a given keyword with a given key.
 * Returns an object:
 *   { consumed: <raw items count>, scraped: <unique filtered rows count> }
 */
async function runOnceWithCurrentKey(keyword, apiToken) {
  if (shouldStop()) {
    console.log(
      `⏹ Stop requested before Apify call for keyword: "${keyword}". Skipping.`
    );
    return { consumed: 0, scraped: 0 };
  }

  console.log(`\n🔎 Keyword: "${keyword}"`);
  console.log(`🔐 Using API key (masked): ${apiToken.slice(0, 10)}...`);

  const client = new ApifyClient({ token: apiToken });

  const input = {
    searchQueries: [keyword],
    maxPosts: 2000000000000, // request as many posts as the actor can provide
  };

  const actorId =
    process.env.APIFY_POST_SEARCH_ACTOR_ID || "buIWk2uOUzTmcLsuB";

  console.log(`▶️  Starting Apify actor: ${actorId}`);
  
  // Suppress console output from Apify
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  
  let run;
  try {
    // Once the request is sent, we MUST wait for it to complete
    run = await client.actor(actorId).call(input);
  } finally {
    // Restore console methods
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  originalLog("📥 Fetching dataset items...");
  const items = await listAllItems(client, run.defaultDatasetId);

  originalLog(`📦 Retrieved ${items.length} raw items.`);
  const normalized = items.map(normalizeItem);

  // Filter: reactions >= 20 and valid url
  const filtered = normalized.filter(
    (r) => r.postUrl && r.reactionNum >= 20
  );

  // Deduplicate by post url
  const unique = dedupeByUrl(filtered);

  originalLog(
    `✅ Valid after filter (>=20 reactions) & de-dupe: ${unique.length}`
  );

  if (unique.length > 0) {
    const rows = unique.map((r) => [r.postUrl, r.authorName, r.reactionNum]);
    appendToCsv(rows);
    originalLog(`💾 Appended ${rows.length} row(s) to CSV:\n   ${OUTPUT_CSV}`);
  } else {
    originalLog("ℹ️  No rows met the criteria for this keyword.");
  }

  // `consumed` = all dataset items fetched
  // `scraped`  = unique rows that passed filter
  return { consumed: items.length, scraped: unique.length };
}

// Orchestration: rotate keys and process one keyword
async function scrapeKeyword(keyword) {
  if (shouldStop()) {
    console.log(`⏹ Stop requested; not starting keyword: "${keyword}".`);
    return;
  }

  // Prevent re-scrape
  const kwStore = readJsonSafe(KEYWORDS_JSON, { scraped: [] });
  if (kwStore.scraped.includes(keyword.toLowerCase())) {
    console.log(`⚠️  "${keyword}" already scraped. Skipping.`);
    return;
  }

  for (;;) {
    if (shouldStop()) {
      console.log(
        `⏹ Stop requested while preparing key for keyword "${keyword}".`
      );
      return;
    }

    const keyObj = getNextKey(); // ensures used_keys.json exists and finds key with remaining > 0
    if (!keyObj) {
      console.error("❌ No usable keys left.");
      process.exit(1);
    }

    console.log(
      `\n🔁 Current key remaining budget: ${keyObj.remaining} posts`
    );

    // Emit an initial STATE snapshot (before run)
    console.log(
      "::STATE:: " +
        JSON.stringify({
          keyword,
          activeKey: keyObj.token.slice(0, 8) + "...",
          scraped: 0,
          remainingPerKey: keyObj.remaining,
        })
    );

    try {
      const { consumed, scraped } = await runOnceWithCurrentKey(
        keyword,
        keyObj.token
      );

      if (shouldStop()) {
        console.log(
          `⏹ Stop requested right after Apify run for "${keyword}". Still updating key usage and marking keyword as scraped.`
        );
      }

      const charge = Math.max(1, consumed); // at least 1 to avoid stuck state
      decrementRemaining(keyObj.token, charge);
      console.log(
        `🔻 Deducted ${charge}. Key budget updated in used_keys.json.\n`
      );

      // Read updated remaining for this key to show accurate value
      const usedAfter = readJsonSafe(USED_KEYS_JSON, []);
      const entryAfter = usedAfter.find((x) => x.token === keyObj.token);
      const remainingAfter =
        entryAfter && typeof entryAfter.remaining === "number"
          ? entryAfter.remaining
          : null;

      // Update postsFound metric
      globalMetrics.postsFound += scraped;
      emitMetrics();

      // Emit STATE snapshot after run for UI
      console.log(
        "::STATE:: " +
          JSON.stringify({
            keyword,
            activeKey: keyObj.token.slice(0, 8) + "...",
            scraped,
            remainingPerKey: remainingAfter,
          })
      );

      // One run per keyword by design.
      break;
    } catch (err) {
      const msg = err?.message || err;
      console.error(
        "❌ Error with this key. Will rotate to next key.\n",
        msg?.message || msg
      );
      // Exhaust this key and rotate
      decrementRemaining(keyObj.token, keyObj.remaining || PER_KEY_LIMIT);
      // loop continues to next available key
    }
  }

  // Mark keyword as scraped
  const kwStore2 = readJsonSafe(KEYWORDS_JSON, { scraped: [] });
  kwStore2.scraped = Array.from(
    new Set([...(kwStore2.scraped || []), keyword.toLowerCase()])
  );
  writeJson(KEYWORDS_JSON, kwStore2);
  console.log(
    `📝 Recorded "${keyword}" in keywords.json to prevent re-scraping.`
  );
}

/* ===================== KEYWORD LIST LOADING ===================== */

function loadKeywordsFromFile(filePath) {
  if (!filePath) return [];
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Keyword file not found: ${filePath}`);
    process.exit(1);
  }
  const ext = path.extname(filePath).toLowerCase();
  const raw = fs.readFileSync(filePath, "utf8");

  let list = [];

  if (ext === ".txt") {
    list = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (ext === ".csv") {
    const rows = raw.split(/\r?\n/).filter(Boolean);
    for (const line of rows) {
      const first = line.split(",")[0].trim();
      if (first) list.push(first);
    }
  } else {
    // treat as plain text, newline separated
    list = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Deduplicate, keep order
  const seen = new Set();
  const out = [];
  for (const k of list) {
    const lower = k.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(k);
  }
  return out;
}

/* ===================== MAIN ===================== */

(async () => {
  console.log("=====================================");
  console.log("  LinkedIn Post Finder Runner (v3)  ");
  console.log("=====================================\n");

  ensureDir(OUTPUT_DIR);
  initStores();

  // Initialize totalKeys count
  const keys = readJsonSafe(KEYS_JSON, []);
  globalMetrics.totalKeys = keys.length;
  emitMetrics();

  // Ensure CSV header exists (create empty file with header if not present)
  if (!fs.existsSync(OUTPUT_CSV)) {
    appendToCsv([]); // this writes just header
    console.log(`🗂️  Created CSV with header at: ${OUTPUT_CSV}`);
  }

  // 1) If Electron/CLI provided a keyword file or single keyword → non-interactive
  let keywords = [];

  if (KEYWORD_FILE) {
    keywords = loadKeywordsFromFile(KEYWORD_FILE);
  } else if (SINGLE_KEYWORD) {
    keywords = [SINGLE_KEYWORD];
  }

  if (keywords.length > 0) {
    console.log(
      `🚀 Running in non-interactive mode with ${keywords.length} keyword(s).`
    );

    const kwStore = readJsonSafe(KEYWORDS_JSON, { scraped: [] });
    for (const kw of keywords) {
      if (shouldStop()) {
        console.log(
          "⏹ Stop requested; stopping before starting next keyword."
        );
        break;
      }

      const lower = kw.toLowerCase();
      if (kwStore.scraped.includes(lower)) {
        console.log(`⚠️  "${kw}" is already scraped. Skipping.`);
        continue;
      }
      await scrapeKeyword(kw);
    }

    console.log("👋 Done. (non-interactive run)");
    return;
  }

  // 2) Otherwise, fall back to interactive CLI mode (ONLY if NOT spawned from Electron)
  if (isElectronSpawn) {
    console.error(
      "❌ No keyword or keyword file provided via Electron config. Set a keyword or keyword file in the UI."
    );
    process.exit(1);
  }

  // CLI interactive mode
  for (;;) {
    if (shouldStop()) {
      console.log("⏹ Stop requested; exiting interactive mode.");
      break;
    }

    const keyword = (
      await ask("Enter ONE keyword to scrape (or just press Enter to quit): ")
    ).trim();

    if (!keyword) {
      console.log("👋 Exiting.");
      break;
    }

    const kwStore = readJsonSafe(KEYWORDS_JSON, { scraped: [] });
    if (kwStore.scraped.includes(keyword.toLowerCase())) {
      console.log(
        `⚠️  "${keyword}" is already scraped. Choose another keyword.`
      );
    } else {
      await scrapeKeyword(keyword);
    }

    if (shouldStop()) {
      console.log("⏹ Stop requested; exiting after current keyword.");
      break;
    }

    const more = (
      await ask("Do you want to scrape MORE? (y/n): ")
    )
      .trim()
      .toLowerCase();
    if (more !== "y") {
      console.log("👋 Done. Goodbye.");
      break;
    }
  }
})();
