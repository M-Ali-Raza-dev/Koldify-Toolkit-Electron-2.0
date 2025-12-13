// ==== LINKEDIN COMMENT SCRAPER ORCHESTRATOR ====
// Usage (classic):
//   node comment-orchestrator.js posts.csv keys.json
//   node comment-orchestrator.js posts1.csv posts2.csv keys.json
//
// Usage (with flags – better for Electron):
//   node comment-orchestrator.js posts1.csv posts2.csv --keys keys.json --out ./output --limit 2500
//
// ENV support via TOOL_CONFIG (JSON string):
//   {
//     "limitPerKey": 2500,
//     "outputDir": "C:\\path\\to\\output",
//     "keysFile": "C:\\path\\to\\keys.json"
//   }

const fs = require("fs");
const path = require("path");

// FIX: When spawned from Electron, __dirname is backend/apify/
// Add app root to module search paths.
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, '../../');
if (module.paths && !module.paths.includes(path.join(appRoot, 'node_modules'))) {
  module.paths.unshift(path.join(appRoot, 'node_modules'));
}

const { ApifyClient } = require("apify-client");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");

// ==== CONSTANTS / DEFAULTS ====
const ACTOR_ID = "ZI6ykbLlGS3APaPE8";
const DEFAULT_LIMIT_PER_KEY = 2500;
const DEFAULT_OUTPUT_DIR = path.join(__dirname, "output");

// USED_KEYS_FILE will be set after KEYS_JSON_PATH is determined

// ==== ENV CONFIG (TOOL_CONFIG) ====
let envCfg = {};
try {
  if (process.env.TOOL_CONFIG) {
    envCfg = JSON.parse(process.env.TOOL_CONFIG);
  }
} catch {
  envCfg = {};
}

function fromEnv(key, fallback) {
  return Object.prototype.hasOwnProperty.call(envCfg, key)
    ? envCfg[key]
    : fallback;
}

// ==== CLI ARGS PARSING ====
const argv = process.argv.slice(2);

// Split into flags + positionals
const positionals = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg.startsWith("--")) {
    const name = arg.replace(/^--/, "");
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
    flags[name] = value;
    if (value !== true) i++;
  } else {
    positionals.push(arg);
  }
}

// Keys file: from --keys, TOOL_CONFIG.keysFile / keysFilePath, or last positional
const keysFromEnv = fromEnv("keysFile", fromEnv("keysFilePath", null));
let KEYS_JSON_PATH =
  flags.keys ||
  flags.key ||
  keysFromEnv ||
  (positionals.length > 0 ? positionals[positionals.length - 1] : null);

// Posts CSVs: from TOOL_CONFIG.postsCsvPaths, or positionals (based on whether keys supplied separately)
const envPostsRaw = fromEnv("postsCsvPaths", null);
const envPosts = Array.isArray(envPostsRaw)
  ? envPostsRaw
  : envPostsRaw
  ? [envPostsRaw]
  : [];

let POSTS_CSV_PATHS = [];
if (envPosts.length) {
  POSTS_CSV_PATHS = envPosts;
} else if (keysFromEnv || flags.keys || flags.key) {
  // All positionals are posts when keys are provided via flag/env
  POSTS_CSV_PATHS = positionals;
} else if (positionals.length >= 2) {
  POSTS_CSV_PATHS = positionals.slice(0, -1);
}

// Output dir + limit
const OUTPUT_DIR =
  flags.out || flags.output || fromEnv("outputDir", DEFAULT_OUTPUT_DIR);

let limitFromEnv = fromEnv("limitPerKey", DEFAULT_LIMIT_PER_KEY);
let limitFromFlag = parseInt(flags.limit || flags.max || "", 10);
const LIMIT_PER_KEY =
  Number.isFinite(limitFromFlag) && limitFromFlag > 0
    ? limitFromFlag
    : limitFromEnv || DEFAULT_LIMIT_PER_KEY;

// Basic validation
if (!KEYS_JSON_PATH || !POSTS_CSV_PATHS.length) {
  console.error(
    "Usage: node comment-orchestrator.js posts.csv [more_posts.csv ...] keys.json\n" +
      "Or with flags: comment-orchestrator.js posts.csv --keys keys.json [--out ./output --limit 2500]"
  );
  process.exit(1);
}

KEYS_JSON_PATH = path.resolve(KEYS_JSON_PATH);
POSTS_CSV_PATHS = POSTS_CSV_PATHS.map((p) => path.resolve(p));

// Set USED_KEYS_FILE in same directory as keys.json
const USED_KEYS_FILE = path.join(path.dirname(KEYS_JSON_PATH), "used_keys.json");

// ==== STOP FLAG (for Electron Stop button via SIGTERM) ====
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
  emitStatus("Stop signal received. Finishing current task and then exiting...", {
    stopping: true,
  });
});

// ==== JSON HELPERS FOR ELECTRON ====
function emitStatus(message, metrics) {
  const payload = { type: "status", message, metrics: metrics || undefined };
  console.log(JSON.stringify(payload));
}

function emitMetrics(metrics) {
  const payload = { type: "metrics", metrics };
  console.log(JSON.stringify(payload));
}

// ==== TEXT CLEANERS ====
function cleanText(str) {
  if (!str) return "";
  return str
    .normalize("NFKC")
    // keep letters, numbers, basic punctuation, @, &, |, spaces
    .replace(/[^\p{L}\p{N}@&.,\-+'"/()| ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeFileName(str) {
  const cleaned = cleanText(str);
  if (!cleaned) return "unknown";
  return cleaned.replace(/[\/\\?<>:*"|]/g, "_").trim() || "unknown";
}

// ==== CSV HELPERS ====
function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return parse(content, { columns: true, skip_empty_lines: true });
}

function writeCsv(filePath, rows, order) {
  const csv = stringify(rows, { header: true, columns: order });
  fs.writeFileSync(filePath, csv, "utf8");
}

// ==== KEY MANAGEMENT ====
function loadKeys(keysPath) {
  const raw = JSON.parse(fs.readFileSync(keysPath, "utf8"));
  let tokens = [];

  if (Array.isArray(raw)) {
    tokens = typeof raw[0] === "string" ? raw : raw.map((k) => k.token);
  } else if (raw.tokens) {
    tokens = raw.tokens;
  }

  if (fs.existsSync(USED_KEYS_FILE)) {
    console.log("▶ Resuming key usage from used_keys.json");
    const usedRaw = JSON.parse(fs.readFileSync(USED_KEYS_FILE, "utf8"));
    return usedRaw.keys;
  }

  return tokens.map((token, i) => ({
    id: i + 1,
    token,
    used: 0,
    remaining: LIMIT_PER_KEY,
    limit: LIMIT_PER_KEY,
    banned: false,
    error: null,
  }));
}

function saveUsedKeys(keys) {
  fs.writeFileSync(
    USED_KEYS_FILE,
    JSON.stringify({ limitPerKey: LIMIT_PER_KEY, keys }, null, 2),
    "utf8"
  );
}

function chooseKeyForPost(keys, commentNum) {
  const active = keys.filter((k) => !k.banned && k.remaining > 0);
  if (!active.length) return null;

  const fitting = active.filter((k) => k.remaining >= commentNum);
  if (fitting.length) {
    return fitting.reduce((best, k) =>
      k.remaining < best.remaining ? k : best
    );
  }

  return active.reduce((best, k) =>
    k.remaining > best.remaining ? k : best
  );
}

// ==== APIFY RUNNER (QUIET) ====
async function runActorQuiet(client, input) {
  const origLog = console.log;
  const origInfo = console.info;

  // Suppress internal Apify logging
  console.log = () => {};
  console.info = () => {};

  try {
    return await client.actor(ACTOR_ID).call(input);
  } finally {
    console.log = origLog;
    console.info = origInfo;
  }
}

// ==== MAIN EXEC ====
(async () => {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const keys = loadKeys(KEYS_JSON_PATH);

  console.log("\n=== START COMMENT ORCHESTRATOR ===");
  console.log("Config:");
  console.log("  Posts CSVs:", POSTS_CSV_PATHS);
  console.log("  Keys file:", KEYS_JSON_PATH);
  console.log("  Output dir:", OUTPUT_DIR);
  console.log("  Limit per key:", LIMIT_PER_KEY);

  console.log("Keys state:");
  console.table(
    keys.map((k) => ({
      id: k.id,
      remaining: k.remaining,
      banned: k.banned,
    }))
  );

  emitStatus("Comment orchestrator started.", {
    outputDir: OUTPUT_DIR,
    limitPerKey: LIMIT_PER_KEY,
    keysCount: keys.length,
  });

  let totalProcessed = 0;
  let totalPosts = 0;

  // Pre-count total posts for metrics
  for (const postsPath of POSTS_CSV_PATHS) {
    if (!fs.existsSync(postsPath)) continue;
    const recs = parseCsv(postsPath);
    totalPosts += recs.length;
  }

  emitMetrics({
    totalPosts,
    processedPosts: 0,
    activeKeys: keys.filter((k) => !k.banned && k.remaining > 0).length,
    keysBanned: keys.filter((k) => k.banned).length,
  });

  // Process each posts file
  for (let fIndex = 0; fIndex < POSTS_CSV_PATHS.length; fIndex++) {
    if (stopping) {
      console.log("\nStop flag set, breaking file loop.");
      break;
    }

    const POSTS_CSV_PATH = POSTS_CSV_PATHS[fIndex];

    console.log(
      `\n[FILE ${fIndex + 1}/${POSTS_CSV_PATHS.length}] ${POSTS_CSV_PATH}`
    );

    if (!fs.existsSync(POSTS_CSV_PATH)) {
      console.log("  → File not found, skipping.");
      emitStatus(`Posts CSV not found: ${POSTS_CSV_PATH}`);
      continue;
    }

    const records = parseCsv(POSTS_CSV_PATH);
    const CSV_COLUMNS = records.length ? Object.keys(records[0]) : [];

    console.log(`  Posts in file: ${records.length}`);

    let processedInFile = 0;

    for (let i = 0; i < records.length; i++) {
      if (stopping) {
        console.log("  Stop flag set, breaking post loop.");
        break;
      }

      const row = records[i];
      const postUrl = row["post url"];
      const rawAuthor = row["author name"];
      const author = cleanText(rawAuthor || "");
      const status = (row["status"] || "").toLowerCase();
      let commentNum = parseInt(row["comment num"], 10);

      if (!postUrl) {
        console.log(`  [${i + 1}/${records.length}] No post url → skip`);
        continue;
      }

      if (status === "done") {
        console.log(
          `  [${i + 1}/${records.length}] ${author || "Unknown"} → already done`
        );
        continue;
      }

      if (Number.isNaN(commentNum) || commentNum <= 0) {
        console.log(
          `  [${i + 1}/${records.length}] ${
            author || "Unknown"
          } → invalid comment num → skip`
        );
        continue;
      }

      console.log(
        `  [${i + 1}/${records.length}] ${author || "Unknown"} | comments: ${
          commentNum
        }`
      );
      emitStatus("Processing post", {
        fileIndex: fIndex + 1,
        fileTotal: POSTS_CSV_PATHS.length,
        postIndex: i + 1,
        postsInFile: records.length,
        author,
        postUrl,
        commentNum,
      });

      let success = false;

      while (!success && !stopping) {
        const key = chooseKeyForPost(keys, commentNum);
        if (!key) {
          console.log(
            "    → No active keys left with credits. Stopping for this post."
          );
          emitStatus(
            "No active keys with remaining credits. Stopping current post.",
            {
              processedPosts: totalProcessed,
            }
          );
          break;
        }

        const maxItems = Math.min(
          commentNum,
          key.remaining,
          LIMIT_PER_KEY
        );
        if (maxItems <= 0) {
          key.banned = true;
          key.error = "No remaining credits but selected.";
          key.remaining = 0;
          saveUsedKeys(keys);
          console.log(
            `    → Key ${key.id} had 0 remaining, marking banned.`
          );
          continue;
        }

        console.log(
          `    → Using key ${key.id} (remaining: ${key.remaining}) maxItems: ${maxItems}`
        );
        emitStatus("Calling Apify actor", {
          keyId: key.id,
          maxItems,
          remainingBefore: key.remaining,
        });

        const client = new ApifyClient({ token: key.token });

        try {
          const run = await runActorQuiet(client, {
            posts: [postUrl],
            maxItems,
            profileScraperMode: "short",
          });

          const { items } = await client
            .dataset(run.defaultDatasetId)
            .listItems();

          const seen = new Set();
          const rows = items
            .map((i) => i.actor)
            .filter((a) => a && a.linkedinUrl)
            .filter((a) => !seen.has(a.linkedinUrl) && seen.add(a.linkedinUrl))
            .map((a) => {
              const fullName = cleanText(a.name || "");
              const [first, ...rest] = fullName.split(/\s+/);
              const jobTitle = cleanText(a.position || "");
              return {
                "First Name": first || "",
                "Last Name": rest.join(" ") || "",
                "Person Linkedin Url": a.linkedinUrl,
                "Job Title": jobTitle,
                "Author Name": author || "",
                "Post Url": postUrl || "",
              };
            });

          const fileName = `${safeFileName(author)} (${commentNum}).csv`;
          const outPath = path.join(OUTPUT_DIR, fileName);

          writeCsv(outPath, rows, [
            "First Name",
            "Last Name",
            "Person Linkedin Url",
            "Job Title",
            "Author Name",
            "Post Url",
          ]);

          key.used += maxItems;
          key.remaining = Math.max(0, key.remaining - maxItems);
          row["status"] = "done";
          processedInFile++;
          totalProcessed++;

          saveUsedKeys(keys);
          writeCsv(POSTS_CSV_PATH, records, CSV_COLUMNS);

          console.log(
            `    → Saved: ${fileName} | rows: ${rows.length}`
          );
          console.log(
            `      Key ${key.id} remaining: ${key.remaining}`
          );

          emitMetrics({
            totalPosts,
            processedPosts: totalProcessed,
            activeKeys: keys.filter(
              (k) => !k.banned && k.remaining > 0
            ).length,
            keysBanned: keys.filter((k) => k.banned).length,
          });

          success = true;
        } catch (err) {
          console.log(`    → Key ${key.id} FAILED: ${err.message}`);
          key.banned = true;
          key.error = err.message;
          key.remaining = 0;
          saveUsedKeys(keys);
          console.log(
            "      Marked key as banned, trying next key (if any)..."
          );
          emitStatus("Key failed and was banned.", {
            keyId: key.id,
            error: err.message,
          });
        }
      }
    }

    console.log(
      `  → File done. Posts processed in this file: ${processedInFile}`
    );
    emitStatus("Finished file", {
      fileIndex: fIndex + 1,
      postsProcessedInFile: processedInFile,
    });

    if (stopping) {
      console.log("Stopping after finishing this file.");
      break;
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Total posts processed: ${totalProcessed}`);
  console.table(
    keys.map((k) => ({
      id: k.id,
      used: k.used,
      remaining: k.remaining,
      banned: k.banned,
      error: k.error || "",
    }))
  );
  console.log("=== DONE ===\n");

  emitMetrics({
    totalPosts,
    processedPosts: totalProcessed,
    activeKeys: keys.filter((k) => !k.banned && k.remaining > 0).length,
    keysBanned: keys.filter((k) => k.banned).length,
  });

  emitStatus("Comment orchestrator finished.", {
    totalPosts,
    processedPosts: totalProcessed,
  });
})();
