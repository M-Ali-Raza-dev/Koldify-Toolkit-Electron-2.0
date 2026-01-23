const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const yargs = require("yargs");
const { hideBin } = require("yargs/helpers");
const { ApifyClient } = require("apify-client");
const readline = require("readline");

/* ================= CONFIG ================= */
const ACTOR_ID = "BlJ6u6jb5UzYsyiKT";

const OUTPUT_COLS = {
  open: "OpenProfile",
  inmail: "InmailEligible",
  runId: "ApifyRunId",
  token: "ApifyTokenUsed",
  error: "Error",
};

const STATUS_DONE = "done";
const STATUS_SKIPPED = "skipped";
const STATUS_ERROR = "error";

/* ================= CONFIG FROM ENV (ELECTRON) ================= */
let electronConfig = {};
try {
  if (process.env.TOOL_CONFIG) {
    electronConfig = JSON.parse(process.env.TOOL_CONFIG);
  }
} catch (e) {
  console.error("Failed to parse TOOL_CONFIG");
}

/* ================= CLI ================= */
const argv = yargs(hideBin(process.argv))
  .option("folder", { type: "string" })
  .option("input", { type: "string", describe: "Optional specific CSV path" })
  .option("tokens", { type: "string", describe: "Comma-separated Apify tokens" })
  .option("concurrency", { type: "number", default: 5 })
  .option("linkedin-column", { type: "string" })
  .help()
  .parseSync();

/* ================= CONFIG RESOLUTION (ELECTRON > CLI > ENV) ================= */
const config = {
  folder: electronConfig.outputDir || argv.folder || process.cwd(),
  input: electronConfig.inputCsv || argv.input,
  tokensStr: electronConfig.tokensStr || argv.tokens,
  linkedinColumn: electronConfig.linkedinColumn || argv["linkedin-column"],
  concurrency: electronConfig.concurrency || argv.concurrency || 5,
};

console.log(`CONFIG: Using folder=${config.folder}, concurrency=${config.concurrency}`);

/* ================= HELPERS ================= */
function parseTokens(tokensStr) {
  const raw = (tokensStr || process.env.APIFY_TOKENS || process.env.APIFY_TOKEN || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function listCsvFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .map((f) => path.join(dir, f));
}

async function readCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

function detectLinkedInColumn(rows) {
  if (!rows.length) return null;
  const headers = Object.keys(rows[0]).filter(Boolean);
  const sample = rows.slice(0, Math.min(40, rows.length));

  const headerScore = (h) => {
    const s = h.toLowerCase();
    let score = 0;
    if (s.includes("linkedin")) score += 10;
    if (s.includes("url")) score += 5;
    if (s.includes("profile")) score += 2;
    return score;
  };

  const valueScore = (h) => {
    let score = 0;
    for (const r of sample) {
      const v = String(r[h] ?? "").trim().toLowerCase();
      if (v.includes("linkedin.com/in/")) score += 5;
      if (v.includes("linkedin.com")) score += 1;
    }
    return score;
  };

  let best = null;
  let bestScore = -1;
  for (const h of headers) {
    const score = headerScore(h) + valueScore(h);
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return bestScore >= 8 ? best : null;
}

function getStatusColumn(rows) {
  if (!rows.length) return "Status";
  const headers = Object.keys(rows[0]).filter(Boolean);
  return headers.find((h) => h.toLowerCase() === "status") || "Status";
}

function normalizeLinkedInUrl(raw) {
  if (!raw) return "";
  let u = String(raw).trim();
  u = u.replace(/\s+/g, "");
  u = u.replace(/\/+$/g, "");
  if (u.startsWith("www.")) u = "https://" + u;
  if (u.startsWith("linkedin.com/")) u = "https://" + u;
  return u;
}

function looksLikeLimitOrRateError(msg = "") {
  const m = String(msg).toLowerCase();
  return (
    m.includes("429") ||
    m.includes("rate") ||
    m.includes("quota") ||
    m.includes("limit") ||
    m.includes("exceeded") ||
    m.includes("usage") ||
    m.includes("insufficient") ||
    m.includes("payment required")
  );
}

async function writeInputCsv(filePath, rows, headers) {
  return new Promise((resolve, reject) => {
    const csvContent = [
      headers.map(csvEscape).join(","),
      ...rows.map(row => headers.map(h => csvEscape(row[h] || "")).join(","))
    ].join("\n");
    
    fs.writeFile(filePath, csvContent, "utf8", (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/* ================= CSV WRITER (TRUE APPEND QUEUE) ================= */
function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

class WriteQueue {
  constructor(stream, headers) {
    this.stream = stream;
    this.headers = headers;
    this.chain = Promise.resolve();
    this.closed = false;
  }

  enqueue(rowObj) {
    if (this.closed) return;
    this.chain = this.chain.then(() => {
      const line = this.headers.map((h) => csvEscape(rowObj[h])).join(",") + "\n";
      return new Promise((resolve, reject) => {
        this.stream.write(line, (err) => (err ? reject(err) : resolve()));
      });
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.chain;
    await new Promise((resolve) => this.stream.end(resolve));
  }
}

/* ================= ACTOR OUTPUT ================= */
function extractOpenProfileFlag(item) {
  const v = item?.data?.open_profile;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.toLowerCase().trim();
    if (["true", "yes", "1"].includes(s)) return true;
    if (["false", "no", "0"].includes(s)) return false;
  }
  return null;
}

/* ================= SUPPRESS NOISY APIFY/ACTOR LOGS (STDOUT + STDERR) ================= */
function withQuietActorLogs(fn) {
  const noisy = (s) => {
    const t = String(s ?? "");
    return (
      t.includes("open-profile-status") ||
      t.includes("runId:") ||
      t.includes("ACTOR:") ||
      t.includes("[apify]") ||
      t.includes("apify_sdk_version") ||
      t.includes("apify_client_version") ||
      t.includes("crawlee_version") ||
      t.includes("python_version") ||
      t.includes("Actor is running") ||
      t.includes("Exiting Actor") ||
      t.includes("exit_code") ||
      t.includes("LIMITED_PERMISSIONS") ||
      t.includes("disable_browser_sandbox") ||
      t.includes("Initializing Actor") ||
      t.includes("System info") ||
      t.includes("Fetching LinkedIn URL:") ||
      t.includes("🔍") ||
      t.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
    );
  };

  const origConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  // Save original write methods BEFORE replacing them
  const origStdoutWrite = process.stdout.write;
  const origStderrWrite = process.stderr.write;

  let stdoutBuf = "";
  let stderrBuf = "";

  const filterWrite = (origWrite, bufRef, chunk, encoding, cb) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString(encoding || "utf8");
    bufRef.value += text;

    const lines = bufRef.value.split(/\r?\n/);
    bufRef.value = lines.pop() ?? "";

    const kept = [];
    for (const line of lines) {
      if (!line) continue;
      if (noisy(line)) continue;
      kept.push(line);
    }

    if (kept.length) {
      const out = kept.join("\n") + "\n";
      return origWrite(out, encoding, cb);
    }
    if (typeof cb === "function") cb();
    return true;
  };

  const wrapConsole = (origFn) => (...args) => {
    const joined = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    if (noisy(joined)) return;
    origFn(...args);
  };

  console.log = wrapConsole(origConsole.log);
  console.info = wrapConsole(origConsole.info);
  console.warn = wrapConsole(origConsole.warn);
  console.error = wrapConsole(origConsole.error);

  const stdoutRef = { value: "" };
  const stderrRef = { value: "" };

  // Use the SAVED original methods, not the wrapper
  process.stdout.write = (chunk, encoding, cb) => filterWrite(origStdoutWrite, stdoutRef, chunk, encoding, cb);
  process.stderr.write = (chunk, encoding, cb) => filterWrite(origStderrWrite, stderrRef, chunk, encoding, cb);

  const restore = () => {
    console.log = origConsole.log;
    console.info = origConsole.info;
    console.warn = origConsole.warn;
    console.error = origConsole.error;
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
  };

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      restore();
    });
}

async function runActorForProfile({ token, linkedinUrl }) {
  const client = new ApifyClient({ token });

  return withQuietActorLogs(async () => {
    const run = await client.actor(ACTOR_ID).call({ linkedin_url: linkedinUrl });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const item = Array.isArray(items) && items.length ? items[0] : null;
    return { runId: run?.id || "", item };
  });
}

async function runWithTokenRotation({ tokens, linkedinUrl, singleTokenMode }) {
  let lastErr = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    try {
      const res = await runActorForProfile({ token, linkedinUrl });
      return { ok: true, tokenUsed: token, ...res };
    } catch (err) {
      const msg = err?.message || String(err);
      lastErr = msg;

      if (singleTokenMode) {
        return { ok: false, tokenUsed: token, error: msg, isLimit: looksLikeLimitOrRateError(msg) };
      }
      continue;
    }
  }

  return {
    ok: false,
    tokenUsed: "",
    error: lastErr || "Unknown error",
    isLimit: looksLikeLimitOrRateError(lastErr || ""),
  };
}

/* ================= CONCURRENCY POOL ================= */
async function runPool({ tasks, concurrency }) {
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const idx = nextIndex++;
      if (idx >= tasks.length) return;
      await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
}

/* ================= MAIN ================= */
async function main() {
  const folder = config.folder;
  const concurrency = Math.max(1, Number(config.concurrency || 5));
  const linkedinColOverride = config.linkedinColumn;

  const tokens = parseTokens(config.tokensStr);
  if (!tokens.length) {
    console.log("ERROR: No Apify tokens provided");
    process.exit(1);
  }
  const singleTokenMode = tokens.length === 1;

  console.log(`INFO: ${tokens.length} token(s) active, single-token mode: ${singleTokenMode}`);

  // pick input CSV
  let inputCsv = config.input;
  if (!inputCsv) {
    const files = listCsvFiles(config.folder);
    if (!files.length) {
      console.log("ERROR: No CSV found in folder");
      process.exit(1);
    }
    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    inputCsv = files[0];
  }
  if (!fs.existsSync(inputCsv)) {
    console.log("ERROR: Input CSV not found");
    process.exit(1);
  }

  console.log(`INFO: Processing file: ${path.basename(inputCsv)}`);

  const rows = await readCsv(inputCsv);
  if (!rows.length) {
    console.log("ERROR: CSV is empty");
    process.exit(1);
  }

  let linkedinCol = linkedinColOverride || detectLinkedInColumn(rows);
  if (!linkedinCol) {
    console.log("ERROR: Could not detect LinkedIn URL column");
    process.exit(1);
  }

  console.log(`INFO: Using LinkedIn column: ${linkedinCol}`);

  const statusCol = getStatusColumn(rows);
  
  const inputHeaders = Object.keys(rows[0]).filter(Boolean);
  if (!inputHeaders.includes(statusCol)) {
    inputHeaders.push(statusCol);
  }
  for (const r of rows) if (!(statusCol in r)) r[statusCol] = "";
  
  await writeInputCsv(inputCsv, rows, inputHeaders);

  const inputBase = path.basename(inputCsv, path.extname(inputCsv));
  const outPath = path.join(folder, `output_inmail_${inputBase}_${Date.now()}.csv`);

  const baseHeaders = Object.keys(rows[0]).filter(Boolean);
  const outHeaders = [...baseHeaders];
  if (!outHeaders.includes(statusCol)) outHeaders.push(statusCol);
  for (const h of Object.values(OUTPUT_COLS)) if (!outHeaders.includes(h)) outHeaders.push(h);

  const outStream = fs.createWriteStream(outPath, { flags: "w", encoding: "utf8" });
  outStream.write(outHeaders.map(csvEscape).join(",") + "\n");
  const writer = new WriteQueue(outStream, outHeaders);

  const stats = {
    totalRows: rows.length,
    totalLinkedIn: 0,
    openCount: 0,
    closedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    doneCount: 0,
  };

  console.log(`STATS: Starting with ${rows.length} rows, concurrency: ${concurrency}`);
  // Send initial metrics
  console.log(JSON.stringify({
    type: 'metrics',
    metrics: {
      ...stats,
      activeKeys: tokens.length,
      estimatedCost: tokens.length * 5,
    }
  }));
  const tasks = rows.map((row, index) => async () => {
    for (const h of Object.values(OUTPUT_COLS)) if (!(h in row)) row[h] = "";
    if (!(statusCol in row)) row[statusCol] = "";

    const status = String(row[statusCol] || "").trim().toLowerCase();
    const linkedinUrl = normalizeLinkedInUrl(row[linkedinCol]);

    if (linkedinUrl && linkedinUrl.toLowerCase().includes("linkedin.com")) {
      stats.totalLinkedIn++;
    }

    if (status === STATUS_DONE) {
      stats.doneCount++;
      writer.enqueue(row);
      console.log(JSON.stringify({
        type: 'metrics',
        metrics: {
          ...stats,
          activeKeys: tokens.length,
          estimatedCost: tokens.length * 5,
        }
      }));
      return;
    }

    if (!linkedinUrl || !linkedinUrl.toLowerCase().includes("linkedin.com")) {
      row[statusCol] = STATUS_SKIPPED;
      row[OUTPUT_COLS.error] = "Missing/invalid LinkedIn URL";
      stats.skippedCount++;
      writer.enqueue(row);
      await writeInputCsv(inputCsv, rows, inputHeaders);
      console.log(JSON.stringify({
        type: 'metrics',
        metrics: {
          ...stats,
          activeKeys: tokens.length,
          estimatedCost: tokens.length * 5,
        }
      }));
      return;
    }

    const res = await runWithTokenRotation({ tokens, linkedinUrl, singleTokenMode });
    row[OUTPUT_COLS.token] = res.tokenUsed || "";

    if (!res.ok) {
      row[statusCol] = STATUS_ERROR;
      row[OUTPUT_COLS.error] = res.error || "Unknown error";
      stats.errorCount++;
      writer.enqueue(row);
      await writeInputCsv(inputCsv, rows, inputHeaders);
      console.log(JSON.stringify({
        type: 'metrics',
        metrics: {
          ...stats,
          activeKeys: tokens.length,
          estimatedCost: tokens.length * 5,
        }
      }));

      if (singleTokenMode && res.isLimit) {
        await writer.close();
        console.log(`WARNING: Rate limit reached. Stopping.`);
        process.exit(0);
      }
      return;
    }

    row[OUTPUT_COLS.runId] = res.runId || "";

    const openFlag = extractOpenProfileFlag(res.item);
    row[OUTPUT_COLS.open] = openFlag === null ? "" : String(openFlag);
    row[OUTPUT_COLS.inmail] = openFlag === null ? "" : String(openFlag);

    if (openFlag === true) stats.openCount++;
    else stats.closedCount++;

    row[OUTPUT_COLS.error] = "";
    row[statusCol] = STATUS_DONE;
    stats.doneCount++;

    writer.enqueue(row);
    await writeInputCsv(inputCsv, rows, inputHeaders);
    console.log(JSON.stringify({
      type: 'metrics',
      metrics: {
        ...stats,
        activeKeys: tokens.length,
        estimatedCost: tokens.length * 5,
      }
    }));
  });

  await runPool({ tasks, concurrency });

  await writer.close();

  console.log(`SUCCESS: Output saved to ${path.basename(outPath)}`);
  console.log(`FINAL: Total: ${stats.totalRows} | LinkedIn: ${stats.totalLinkedIn} | Open: ${stats.openCount} | Closed: ${stats.closedCount} | Skipped: ${stats.skippedCount} | Error: ${stats.errorCount} | Done: ${stats.doneCount}`);
}

main().catch((err) => {
  console.log("FATAL:", err?.message || err);
  process.exit(1);
});
