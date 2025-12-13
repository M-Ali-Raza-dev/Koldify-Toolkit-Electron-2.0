// backend/post-reaction.mjs
// LinkedIn Post Reaction Scraper — Apify actor wrapper
// FULL Electron-safe + Stop-safe version

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { ApifyClient } from "apify-client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ----------------- STOP SUPPORT ----------------- */

const STOP_FLAG_FILE = process.env.STOP_FLAG_FILE || "";
let stopRequested = false;

/* ----------------- METRICS TRACKING ----------------- */

let globalMetrics = {
  postsProcessed: 0,
  uniqueReactors: 0
};

function emitMetrics() {
  console.log(JSON.stringify({
    type: 'metrics',
    metrics: {
      postsProcessed: globalMetrics.postsProcessed,
      uniqueReactors: globalMetrics.uniqueReactors
    }
  }));
}

function handleStopSignal(signal) {
  console.log("");
  console.log("=".repeat(80));
  console.log(`[STOP] Signal ${signal} received.`);
  console.log("[STOP] Will NOT start new posts or new API keys.");
  console.log(
    "[STOP] Any in-flight Apify run will be awaited, then script will exit gracefully."
  );
  console.log("=".repeat(80));
  stopRequested = true;
}

process.on("SIGTERM", handleStopSignal);
process.on("SIGINT", handleStopSignal);

function softStopRequested() {
  try {
    return STOP_FLAG_FILE && fs.existsSync(STOP_FLAG_FILE);
  } catch {
    return false;
  }
}

function shouldStop() {
  return stopRequested || softStopRequested();
}

/* ================= CLI + ENV CONFIG ================= */

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

let envCfg = {};
try {
  envCfg = process.env.TOOL_CONFIG ? JSON.parse(process.env.TOOL_CONFIG) : {};
} catch {}

const fromEnv = (key, fallback) =>
  Object.prototype.hasOwnProperty.call(envCfg, key) ? envCfg[key] : fallback;

/* ================= DEFAULT CONFIG ================= */

const DEFAULT_INPUT_CSV =
  "D:\\apollo aify leads fixer\\apollo aify leads fixer\\apify post search\\posts.csv";

const DEFAULT_OUTPUT_DIR =
  "D:\\apollo aify leads fixer\\apollo aify leads fixer\\linkedin csv merger\\mergethis";

const DEFAULT_KEYS_JSON = path.join(__dirname, "keys.json");
const DEFAULT_APIFY_ACTOR_ID = "S6mgSO5lezSZKi0zN";
const DEFAULT_PER_KEY_REACTION_LIMIT = 2500;

/* ================= EFFECTIVE CONFIG ================= */

const INPUT_CSV = getArg("--in", fromEnv("inputCsv", DEFAULT_INPUT_CSV));
const OUTPUT_DIR = getArg("--out", fromEnv("outputDir", DEFAULT_OUTPUT_DIR));
const APIFY_ACTOR_ID = getArg(
  "--actor",
  fromEnv("actorId", DEFAULT_APIFY_ACTOR_ID)
);
const KEYS_JSON = getArg("--keys", fromEnv("keysJson", DEFAULT_KEYS_JSON));

const KEYS_DIR = path.dirname(KEYS_JSON);
const USED_KEYS_JSON = getArg(
  "--used-keys",
  path.join(KEYS_DIR, "used_keys.json")
);

const PER_KEY_REACTION_LIMIT = getArgNumber(
  "--per-key-limit",
  fromEnv("perKeyLimit", DEFAULT_PER_KEY_REACTION_LIMIT)
);

const RESET_BUDGETS_FLAG =
  argv.includes("--reset-budgets") || !!fromEnv("resetBudgets", false);

const UNBLOCK_ALL_FLAG =
  argv.includes("--unblock-all-keys") || !!fromEnv("unblockAll", false);

const hr = () => console.log("=".repeat(80));

/* ================= HELPERS ================= */

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function safeFileName(s) {
  return String(s)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readCsv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  });
}

function writeCsv(filePath, rows) {
  const headerSet = new Set();
  for (const r of rows) Object.keys(r).forEach((k) => headerSet.add(k));
  const columns = Array.from(headerSet);
  const csv = stringify(rows, { header: true, columns });
  fs.writeFileSync(filePath, csv, "utf8");
}

function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function classifyErrorType(err) {
  const status = err?.statusCode ?? err?.status ?? null;
  const msg = String(err?.message || "").toLowerCase();

  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "billing";
  if (status === 429) return "quota";

  if (msg.includes("billing")) return "billing";
  if (msg.includes("invalid token")) return "auth";
  if (msg.includes("rate limit")) return "quota";

  return "other";
}

/* ================= ACTOR CALL ================= */

async function runActorOnce(apifyToken, postUrl) {
  const client = new ApifyClient({ token: apifyToken });
  const input = { posts: [postUrl] };
  
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
    run = await client.actor(APIFY_ACTOR_ID).call(input);
  } finally {
    // Restore console methods
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  const items = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { items: batch } = await client
      .dataset(run.defaultDatasetId)
      .listItems({ offset, limit });

    if (batch?.length) items.push(...batch);
    if (!batch || batch.length < limit) break;
    offset += batch.length;
  }

  return items;
}

function flatten(obj, prefix = "", out = {}) {
  if (!obj || typeof obj !== "object") {
    out[prefix || "value"] = obj;
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}/${k}` : k;
    if (typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

function itemsToRows(items) {
  const rows = [];
  for (const it of items) {
    if (Array.isArray(it?.reactions)) {
      for (const r of it.reactions) {
        rows.push({ ...flatten(it), ...flatten(r) });
      }
    } else rows.push(flatten(it));
  }
  if (!rows.length) rows.push({});
  return rows;
}

/* ================= MAIN ================= */

(async () => {
  hr();
  console.log("APIFY LINKEDIN REACTION SCRAPER — ELECTRON SAFE");
  hr();

  ensureDir(OUTPUT_DIR);

  const keysPriority = loadJson(KEYS_JSON, []);
  let keyStates = loadJson(USED_KEYS_JSON, []);

  if (RESET_BUDGETS_FLAG || !keyStates.length) {
    keyStates = keysPriority.map((t) => ({
      token: t,
      remaining: PER_KEY_REACTION_LIMIT,
      blocked: false,
    }));
    saveJson(USED_KEYS_JSON, keyStates);
  }

  if (UNBLOCK_ALL_FLAG) {
    keyStates = keyStates.map((k) => ({ ...k, blocked: false }));
    saveJson(USED_KEYS_JSON, keyStates);
  }

  let inputRows = readCsv(INPUT_CSV);

  let processed = 0,
    skipped = 0,
    failed = 0;

  const emitState = (extra = {}) => {
    console.log(
      "::STATE:: " +
        JSON.stringify({
          processed,
          skipped,
          failed,
          ...extra,
        })
    );
  };

  emitState();

  for (let i = 0; i < inputRows.length; i++) {
    if (shouldStop()) break;

    const row = inputRows[i];
    if (String(row.status || "").toLowerCase() === "done") {
      skipped++;
      emitState({ currentIndex: i + 1 });
      continue;
    }

    const postUrl = (row["post url"] || "").trim();
    const authorName = (row["author name"] || "unknown").trim();
    const reactionNeed = Math.max(
      1,
      parseInt(String(row["reaction num"] || "1").replace(/,/g, ""), 10)
    );

    const outName = `${safeFileName(authorName)} [${reactionNeed}].csv`;
    const outPath = path.join(OUTPUT_DIR, outName);

    let rowDone = false;

    while (!rowDone) {
      if (shouldStop()) break;

      const activeKey = keyStates.find(
        (k) => !k.blocked && k.remaining > 0
      );
      if (!activeKey) {
        failed++;
        break;
      }

      emitState({
        currentIndex: i + 1,
        currentAuthor: authorName,
        activeKey: activeKey.token.slice(0, 8) + "...",
      });

      try {
        const items = await runActorOnce(activeKey.token, postUrl);
        const rows = itemsToRows(items);

        writeCsv(outPath, rows);

        row.status = "done";
        writeCsv(INPUT_CSV, inputRows);

        activeKey.remaining = Math.max(
          0,
          activeKey.remaining - reactionNeed
        );
        saveJson(USED_KEYS_JSON, keyStates);

        processed++;
        globalMetrics.postsProcessed = processed;
        globalMetrics.uniqueReactors += rows.length;
        emitMetrics();
        rowDone = true;

        if (shouldStop()) break;
      } catch (err) {
        const errType = classifyErrorType(err);

        if (errType !== "other") {
          activeKey.blocked = true;
          saveJson(USED_KEYS_JSON, keyStates);
        } else {
          failed++;
          break;
        }
      }
    }
  }

  hr();
  if (shouldStop()) console.log("STOPPED BY USER");
  else console.log("DONE");
  console.log(`Processed: ${processed}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Failed:    ${failed}`);
  hr();

  emitState();
})();
