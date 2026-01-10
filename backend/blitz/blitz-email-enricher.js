// blitz-email-enricher.js
// Blitz Email Enricher — Electron & CLI friendly, stop-safe, rate-limited
// SINGLE INPUT CSV + IN-PLACE "Status=done" CHECKPOINTING

/* ========================
 * Imports & Polyfills
 * ======================*/
const fs = require("fs");
const path = require("path");

// FIX: When spawned from Electron, __dirname is backend/blitz/
// Add app root to module search paths.
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, "../../");
if (module.paths && !module.paths.includes(path.join(appRoot, "node_modules"))) {
  module.paths.unshift(path.join(appRoot, "node_modules"));
}

const csv = require("csv-parser");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

// fetch polyfill (Node 18+ has global fetch; older needs node-fetch)
const fetch =
  globalThis.fetch ||
  ((...args) => import("node-fetch").then((m) => m.default(...args)));

/* ========================
 * STOP SUPPORT
 * ======================*/
const STOP_FLAG_FILE = process.env.STOP_FLAG_FILE || "";
let stopRequested = false;

function handleStopSignal(signal) {
  console.log("");
  console.log("=".repeat(80));
  console.log(`[STOP] Signal ${signal} received by blitz-email-enricher.`);
  console.log("[STOP] Will NOT start new rows after the current one finishes.");
  console.log("[STOP] Current Blitz request (if any) will finish, then stop cleanly.");
  console.log("=".repeat(80));
  stopRequested = true;
}

process.on("SIGINT", handleStopSignal);
process.on("SIGTERM", handleStopSignal);

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

/* ========================
 * CLI + TOOL_CONFIG
 * ======================*/
const argv = process.argv.slice(2);

function getArg(flag, fallback) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return fallback;
  const val = argv[idx + 1];
  if (!val || val.startsWith("--")) return fallback;
  return val;
}

let envCfg = {};
try {
  envCfg = process.env.TOOL_CONFIG ? JSON.parse(process.env.TOOL_CONFIG) : {};
} catch {
  envCfg = {};
}

function fromEnv(key, fallback) {
  return Object.prototype.hasOwnProperty.call(envCfg, key) ? envCfg[key] : fallback;
}

/* ========================
 * CONFIG (defaults + overrides)
 * ======================*/
// Effective config: CLI > TOOL_CONFIG > ENV
const INPUT_FILE = getArg("--in", fromEnv("inputFile", "")); // ✅ now a FILE
const OUTPUT_FILENAME = getArg(
  "--output-name",
  fromEnv("outputFileName", "enriched_output.csv")
);

const OUTPUT_FILE = getArg("--out", fromEnv("outputFile", ""));
const BLITZ_API_KEY = getArg("--api-key", fromEnv("apiKey", process.env.BLITZ_API_KEY));

// Column names in input CSV
const PROFILE_URL_COL = "Person Linkedin Url";
const LINKEDIN_URL_COL =
  process.env.LINKEDIN_URL_COLUMN || getArg("--linkedin-col", fromEnv("linkedinUrlColumn", PROFILE_URL_COL));
const POSITION_COL = "Job Title";
const POST_URL_COL = "Post Url";
const AUTHOR_NAME_COL = "Author Name";
const FIRST_NAME_COL = "First Name";
const LAST_NAME_COL = "Last Name";
const STATUS_COL = "Status"; // ✅ NEW

const BLITZ_OUTPUT_COLUMNS = [
  "Email [Blitz]",
  "Email Domain [Blitz]",
  "Company Name [Blitz]",
  "Company Website [Blitz]",
  "Company Linkedin Url [Blitz]",
];

// Rate limit config (Blitz: 5 req / sec, ~18k/hour)
const MAX_CONCURRENT_REQUESTS = 10;
const MAX_REQUESTS_PER_SECOND = 5;
const CHECKPOINT_BATCH_SIZE = parseInt(
  getArg("--checkpoint-batch", fromEnv("checkpointBatchSize", "50")),
  10
) || 50; // Checkpoint every N rows instead of every row

/* ========================
 * LOGGING (clean + structured)
 * ======================*/
function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function safeStr(x) {
  return (x ?? "").toString();
}

function safeReplaceFile(src, dest) {
  try {
    fs.renameSync(src, dest);
    return;
  } catch (err) {
    if (err && (err.code === "EPERM" || err.code === "EACCES")) {
      // Windows sometimes holds the target; fall back to copy + unlink
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
      return;
    }
    throw err;
  }
}

function valueFromColumns(row, columns = [], fallback = "") {
  for (const col of columns) {
    if (col && Object.prototype.hasOwnProperty.call(row, col)) {
      const val = safeStr(row[col]).trim();
      if (val) return val;
    }
  }
  return fallback;
}

// Will be initialized once OUTPUT_FILE is known
let LOGS_DIR = null;
let RUN_LOG = null;
let JSONL_LOG = null;

function initLogs() {
  const outDir = path.dirname(OUTPUT_FILE);
  LOGS_DIR = path.join(outDir, "_logs");
  ensureDir(LOGS_DIR);
  const stamp = ts();
  RUN_LOG = path.join(LOGS_DIR, `run-${stamp}.log`);
  JSONL_LOG = path.join(LOGS_DIR, `summary-${stamp}.jsonl`);
  fs.appendFileSync(RUN_LOG, `=== Blitz Enricher Run ${new Date().toISOString()} ===\n`);
}

function logLine(level, msg, obj) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  try {
    fs.appendFileSync(RUN_LOG, line);
  } catch {}
  if (obj) {
    try {
      fs.appendFileSync(JSONL_LOG, JSON.stringify({ t: new Date().toISOString(), level, msg, ...obj }) + "\n");
    } catch {}
  }
}

/* ========================
 * SIMPLE RATE LIMITER
 * ======================*/
const jobQueue = [];
let activeRequests = 0;
let rateLimiterInterval = null;
let lastRequestTime = 0;

// cache per profile URL to avoid multiple Blitz calls for same person
const blitzCache = new Map();

function startRateLimiter() {
  if (rateLimiterInterval) return;

  rateLimiterInterval = setInterval(async () => {
    if (jobQueue.length === 0 && activeRequests === 0) return;

    const now = Date.now();
    const minTimeBetweenRequests = 1000 / MAX_REQUESTS_PER_SECOND;
    if (now - lastRequestTime < minTimeBetweenRequests) return;

    while (activeRequests < MAX_CONCURRENT_REQUESTS && jobQueue.length > 0) {
      if (shouldStop()) break;

      const job = jobQueue.shift();
      activeRequests++;
      lastRequestTime = Date.now();

      runJob(job).finally(() => {
        activeRequests--;
      });
    }
  }, 50);
}

function stopRateLimiter() {
  if (rateLimiterInterval) {
    clearInterval(rateLimiterInterval);
    rateLimiterInterval = null;
  }
}

function enqueueJob(job) {
  jobQueue.push(job);
}

async function runJob(job) {
  const { profileUrl, resolve, reject } = job;

  try {
    const res = await fetch("https://prod.blitz-api.ai/api/enrichment/email", {
      method: "POST",
      headers: {
        "x-api-key": BLITZ_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ linkedin_profile_url: profileUrl }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Blitz HTTP ${res.status} — ${res.statusText || ""} ${text || ""}`.trim()
      );
    }

    const data = await res.json();
    resolve(data);
  } catch (err) {
    reject(err);
  }
}

function blitzEmailLookup(profileUrl) {
  if (!profileUrl) return Promise.resolve({ found: false, email: "" });

  const cached = blitzCache.get(profileUrl);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    enqueueJob({
      profileUrl,
      resolve: (data) => {
        blitzCache.set(profileUrl, data);
        resolve(data);
      },
      reject,
    });
  });
}

/* ========================
 * HELPERS
 * ======================*/
function parsePosition(position) {
  if (!position) return { jobTitle: "", companyName: "" };
  const match = position.split(/\s+at\s+/i);
  if (match.length === 2) {
    return { jobTitle: match[0].trim(), companyName: match[1].trim() };
  }
  return { jobTitle: position.trim(), companyName: "" };
}

function websiteFromEmail(email) {
  if (!email || !email.includes("@")) return "";
  const domain = email.split("@")[1].trim();
  if (!domain) return "";
  return `https://${domain}`;
}

function companyNameFromDomain(domain) {
  if (!domain) return "";
  const core = domain.split(".")[0];
  if (!core) return "";
  return core
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function capitalizeFirstWord(text) {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function normalizeStatus(s) {
  return safeStr(s).trim().toLowerCase();
}

/* ========================
 * OUTPUT CSV WRITER (STREAMING APPEND)
 * ======================*/
let globalCsvWriter = null;

function getCsvWriter(headers) {
  if (globalCsvWriter) return globalCsvWriter;

  if (!Array.isArray(headers) || headers.length === 0) {
    throw new Error("Output headers are required to create CSV writer");
  }

  const fileExists = fs.existsSync(OUTPUT_FILE);

  globalCsvWriter = createCsvWriter({
    path: OUTPUT_FILE,
    header: headers.map((h) => ({ id: h, title: h })),
    append: fileExists,
  });

  return globalCsvWriter;
}

/* ========================
 * INPUT CSV CHECKPOINT WRITER (IN-PLACE)
 * ======================*/
async function checkpointInputCsv(inputPath, rows, headers) {
  // Write to temp, then replace for atomic-ish safety
  const tmpPath = `${inputPath}.tmp`;

  const finalHeaders = Array.isArray(headers) && headers.length ? headers : Object.keys(rows[0] || {});
  // Ensure Status exists in header order
  if (!finalHeaders.includes(STATUS_COL)) finalHeaders.push(STATUS_COL);

  const writer = createCsvWriter({
    path: tmpPath,
    header: finalHeaders.map((h) => ({ id: h, title: h })),
    append: false,
  });

  await writer.writeRecords(
    rows.map((r) => {
      const out = { ...r };
      if (!Object.prototype.hasOwnProperty.call(out, STATUS_COL)) out[STATUS_COL] = "";
      return out;
    })
  );

  // On Windows, rename can fail with EPERM if the file is locked (e.g., open in Excel or AV)
  safeReplaceFile(tmpPath, inputPath);
}

/* ========================
 * METRICS EMITTER (for Electron UI)
 * ======================*/
function emitMetrics(extra = {}) {
  const {
    phase = "running",
    currentFile = null,
    totalFiles = null,
    currentRow = null,
    totalRows = null,
    emailsFound = null,
    emailsNotFound = null,
    skippedDone = null,
  } = extra;

  console.log(
    JSON.stringify({
      type: "status",
      status: phase,
      metrics: {
        currentFile,
        totalFiles,
        currentRow,
        totalRows,
        rowsProcessed: currentRow,
        emailsFound,
        emailsNotFound,
        skippedDone,
      },
    })
  );
}

/* ========================
 * MAIN LOGIC
 * ======================*/
async function processSingleCsvFile() {
  console.log("======================================");
  console.log("🔍 Blitz Email Enrichment – Single CSV");
  console.log("======================================");
  console.log(`📄 Input CSV   : ${INPUT_FILE}`);
  console.log(`📁 Output file : ${OUTPUT_FILE}`);
  console.log(`🔗 LinkedIn URL column: ${LINKEDIN_URL_COL}`);
  console.log(`🔑 Blitz API key: ${BLITZ_API_KEY ? "OK (set)" : "NOT SET!"}`);
  console.log("💡 Limit: 5 requests/second (~18k leads/hour)");
  console.log("======================================\n");

  if (!INPUT_FILE) {
    console.error("❌ No input CSV file provided. Use --in path/to/file.csv");
    process.exit(1);
  }
  if (!OUTPUT_FILE) {
    console.error("❌ No output file path provided. Please select an output file.");
    process.exit(1);
  }
  if (!BLITZ_API_KEY) {
    console.error("❌ No Blitz API key provided. Set BLITZ_API_KEY, TOOL_CONFIG.apiKey, or use --api-key.");
    process.exit(1);
  }
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ Input CSV not found: ${INPUT_FILE}`);
    process.exit(1);
  }

  // Ensure output folder exists
  const outputDir = path.dirname(OUTPUT_FILE);
  ensureDir(outputDir);

  initLogs();

  // Start rate limiter (for Blitz calls)
  startRateLimiter();

  // Read rows + capture header order
  const rows = [];
  let headerOrder = [];

  await new Promise((resolve, reject) => {
    fs.createReadStream(INPUT_FILE)
      .pipe(csv())
      .on("headers", (headers) => {
        headerOrder = headers || [];
      })
      .on("data", (data) => rows.push(data))
      .on("end", resolve)
      .on("error", reject);
  });

  if (!headerOrder.includes(LINKEDIN_URL_COL)) {
    console.error(
      `❌ Selected LinkedIn URL column "${LINKEDIN_URL_COL}" not found. Headers detected: ${headerOrder.join(", ")}`
    );
    process.exit(1);
  }

  // Ensure Status column exists on all rows; if missing in file, add and checkpoint once
  const hadStatusHeader = headerOrder.includes(STATUS_COL);
  if (!hadStatusHeader) {
    headerOrder.push(STATUS_COL);
  }
  let statusMissingSomeRows = false;
  for (const r of rows) {
    if (!Object.prototype.hasOwnProperty.call(r, STATUS_COL)) {
      r[STATUS_COL] = "";
      statusMissingSomeRows = true;
    }
  }
  if (!hadStatusHeader || statusMissingSomeRows) {
    console.log(`🧩 Adding missing "${STATUS_COL}" column to input and checkpointing...`);
    logLine("INFO", "Status column missing; adding and checkpointing input CSV", {
      input: INPUT_FILE,
      addedHeader: !hadStatusHeader,
    });
    await checkpointInputCsv(INPUT_FILE, rows, headerOrder);
  }

  console.log(`📊 Total rows found: ${rows.length}`);

  const outputHeaderOrder = [...headerOrder];
  for (const extra of BLITZ_OUTPUT_COLUMNS) {
    if (!outputHeaderOrder.includes(extra)) outputHeaderOrder.push(extra);
  }

  const csvWriter = getCsvWriter(outputHeaderOrder);

  let processedCount = 0;      // how many rows we iterated over (including done/skipped)
  let apiTouchedCount = 0;     // how many we actually sent to Blitz
  let emailFoundCount = 0;
  let emailNotFoundCount = 0;
  let skippedDoneCount = 0;

  emitMetrics({
    phase: "running",
    currentFile: path.basename(INPUT_FILE),
    totalFiles: 1,
    currentRow: 0,
    totalRows: rows.length,
    emailsFound: emailFoundCount,
    emailsNotFound: emailNotFoundCount,
    skippedDone: skippedDoneCount,
  });

  for (let i = 0; i < rows.length; i++) {
    if (shouldStop()) {
      console.log("⏹ Stop requested. Not starting new rows.");
      logLine("WARN", "Stop requested; breaking before starting next row", { index: i });
      break;
    }

    processedCount++;
    const row = rows[i];

    const status = normalizeStatus(row[STATUS_COL]);
    if (status === "done") {
      skippedDoneCount++;
      emitMetrics({
        phase: "running",
        currentFile: path.basename(INPUT_FILE),
        totalFiles: 1,
        currentRow: processedCount,
        totalRows: rows.length,
        emailsFound: emailFoundCount,
        emailsNotFound: emailNotFoundCount,
        skippedDone: skippedDoneCount,
      });
      continue;
    }

    const profileUrl = valueFromColumns(row, [LINKEDIN_URL_COL, PROFILE_URL_COL, "LinkedIn URL", "Profile URL", "linkedin_url"], "");
    const position = valueFromColumns(row, [POSITION_COL, "Title", "Job Title", "Position"], "");
    const authorName = valueFromColumns(row, [AUTHOR_NAME_COL, "Author", "Author Name"], "");
    const postUrl = valueFromColumns(row, [POST_URL_COL, "Post URL", "Post Url"], "");
    const inputFirstName = valueFromColumns(row, [FIRST_NAME_COL, "First Name", "Firstname", "first_name"], "");
    const inputLastName = valueFromColumns(row, [LAST_NAME_COL, "Last Name", "Lastname", "last_name"], "");

    if (!profileUrl) {
      console.log(`⚠️  [Row ${processedCount}] Missing LinkedIn profile URL. Marking done + skipping.`);
      logLine("WARN", "Missing profile URL; marking done", { rowIndex: i + 1 });

      // ✅ mark done even if missing URL (so it won't repeat forever)
      row[STATUS_COL] = "done";
      await checkpointInputCsv(INPUT_FILE, rows, headerOrder);

      emitMetrics({
        phase: "running",
        currentFile: path.basename(INPUT_FILE),
        totalFiles: 1,
        currentRow: processedCount,
        totalRows: rows.length,
        emailsFound: emailFoundCount,
        emailsNotFound: emailNotFoundCount,
        skippedDone: skippedDoneCount,
      });

      continue;
    }

    // Call Blitz
    apiTouchedCount++;
    let blitzData;
    try {
      blitzData = await blitzEmailLookup(profileUrl);
    } catch (err) {
      console.log(`❌  [Row ${processedCount}] Error calling Blitz for ${profileUrl}: ${err.message || String(err)}`);
      logLine("ERROR", "Blitz call failed", { profileUrl, error: err.message || String(err) });

      // ✅ still mark done (as you requested: "as the linkedin url is sent to the api keep adding done")
      row[STATUS_COL] = "done";
      await checkpointInputCsv(INPUT_FILE, rows, headerOrder);

      emitMetrics({
        phase: "running",
        currentFile: path.basename(INPUT_FILE),
        totalFiles: 1,
        currentRow: processedCount,
        totalRows: rows.length,
        emailsFound: emailFoundCount,
        emailsNotFound: emailNotFoundCount,
        skippedDone: skippedDoneCount,
      });

      continue;
    }

    const found = !!blitzData?.found;
    const email = safeStr(blitzData?.email).trim();
    const allEmails = Array.isArray(blitzData?.all_emails) ? blitzData.all_emails : [];

    const primaryEmailObj = allEmails[0] || null;
    const emailDomain =
      safeStr(primaryEmailObj?.email_domain) || (email.includes("@") ? email.split("@")[1] : "");
    const companyLinkedinUrl = safeStr(primaryEmailObj?.company_linkedin_url);

    if (found && email) {
      emailFoundCount++;
      console.log(`✅  [${processedCount}/${rows.length}] Email found: ${profileUrl} -> ${email}`);
      logLine("INFO", "Email found", { profileUrl, email });
    } else {
      emailNotFoundCount++;
      console.log(`🚫  [${processedCount}/${rows.length}] No email found: ${profileUrl}`);
      logLine("INFO", "Email not found", { profileUrl });
    }

    const { jobTitle, companyName: posCompanyName } = parsePosition(position);
    const website = websiteFromEmail(email);
    const domain = email.includes("@") ? email.split("@")[1] : "";
    const domainCompanyName = companyNameFromDomain(domain);
    const finalCompanyName = posCompanyName || domainCompanyName;

    row[STATUS_COL] = "done";

    const outputRow = { ...row };
    outputRow[BLITZ_OUTPUT_COLUMNS[0]] = email;
    outputRow[BLITZ_OUTPUT_COLUMNS[1]] = emailDomain;
    outputRow[BLITZ_OUTPUT_COLUMNS[2]] = capitalizeFirstWord(finalCompanyName);
    outputRow[BLITZ_OUTPUT_COLUMNS[3]] = website;
    outputRow[BLITZ_OUTPUT_COLUMNS[4]] = companyLinkedinUrl;

    // ✅ output append immediately, preserving all input columns and adding Blitz columns
    await csvWriter.writeRecords([outputRow]);

    // ✅ checkpoint input rows in batches
    if (apiTouchedCount % CHECKPOINT_BATCH_SIZE === 0 || processedCount === rows.length) {
      await checkpointInputCsv(INPUT_FILE, rows, headerOrder);
    }

    emitMetrics({
      phase: "running",
      currentFile: path.basename(INPUT_FILE),
      totalFiles: 1,
      currentRow: processedCount,
      totalRows: rows.length,
      emailsFound: emailFoundCount,
      emailsNotFound: emailNotFoundCount,
      skippedDone: skippedDoneCount,
    });
  }

  // Final checkpoint to save any remaining rows
  await checkpointInputCsv(INPUT_FILE, rows, headerOrder);

  console.log("\n📁 Output file: " + OUTPUT_FILE);
  console.log("📌 Summary");
  console.log(`   • Total rows         : ${rows.length}`);
  console.log(`   • Skipped (done)     : ${skippedDoneCount}`);
  console.log(`   • Blitz calls made   : ${apiTouchedCount}`);
  console.log(`   • Emails found       : ${emailFoundCount}`);
  console.log(`   • Emails not found   : ${emailNotFoundCount}`);
  console.log("✅ Run finished.\n");

  emitMetrics({
    phase: shouldStop() ? "stopped" : "done",
    currentFile: path.basename(INPUT_FILE),
    totalFiles: 1,
    currentRow: processedCount,
    totalRows: rows.length,
    emailsFound: emailFoundCount,
    emailsNotFound: emailNotFoundCount,
    skippedDone: skippedDoneCount,
  });

  // Wait for any remaining queued jobs to finish
  let waitCount = 0;
  while ((jobQueue.length > 0 || activeRequests > 0) && waitCount < 600) {
    await new Promise((r) => setTimeout(r, 100));
    waitCount++;
  }

  stopRateLimiter();
}

/* ========================
 * RUN
 * ======================*/
processSingleCsvFile().catch((err) => {
  console.error("💥 Fatal error:", err);
  try {
    if (RUN_LOG) fs.appendFileSync(RUN_LOG, `FATAL: ${err?.stack || err}\n`);
  } catch {}
  process.exit(1);
});
