// blitz-email-enricher.js
// Blitz Email Enricher — Electron & CLI friendly, stop-safe, rate-limited

/* ========================
 * Imports & Polyfills
 * ======================*/
const fs = require('fs');
const path = require('path');

// FIX: When spawned from Electron, __dirname is backend/blitz/
// Add app root to module search paths.
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, '../../');
if (module.paths && !module.paths.includes(path.join(appRoot, 'node_modules'))) {
  module.paths.unshift(path.join(appRoot, 'node_modules'));
}

const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// fetch polyfill (Node 18+ has global fetch; older needs node-fetch)
const fetch =
  globalThis.fetch ||
  ((...args) =>
    import('node-fetch').then((m) => m.default(...args)));

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
  console.log("[STOP] Current Blitz request (if any) will finish,");
  console.log("[STOP] then the script will stop cleanly.");
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
  return Object.prototype.hasOwnProperty.call(envCfg, key)
    ? envCfg[key]
    : fallback;
}

/* ========================
 * CONFIG (defaults + overrides)
 * ======================*/

// Effective config: CLI > TOOL_CONFIG > ENV
const INPUT_DIR = getArg("--in", fromEnv("inputDir", ""));

const OUTPUT_FILENAME = getArg("--output-name", fromEnv("outputFileName", "enriched_output.csv"));

const OUTPUT_FILE = getArg(
  "--out",
  fromEnv("outputFile", "")
);

const BLITZ_API_KEY = getArg(
  "--api-key",
  fromEnv("apiKey", process.env.BLITZ_API_KEY)
);

// Column names in input CSVs
const PROFILE_URL_COL = "Person Linkedin Url";
const POSITION_COL = "Job Title";
const POST_URL_COL = "Post Url";
const AUTHOR_NAME_COL = "Author Name";
const FIRST_NAME_COL = "First Name";
const LAST_NAME_COL = "Last Name";

// Rate limit config (Blitz: 5 req / sec, ~18k/hour)
const MAX_CONCURRENT_REQUESTS = 10;
const MAX_REQUESTS_PER_SECOND = 4;

/* ========================
 * SIMPLE RATE LIMITER
 * ======================*/

// Send up to 10 concurrent requests, but respect rate limit of ~2 per second
const jobQueue = [];
let activeRequests = 0;
let rateLimiterInterval = null;
let lastRequestTime = 0;

// cache per profile URL to avoid multiple Blitz calls for same person
const blitzCache = new Map();

function startRateLimiter() {
  if (rateLimiterInterval) return;

  // Process jobs from queue every 50ms
  rateLimiterInterval = setInterval(async () => {
    if (jobQueue.length === 0 && activeRequests === 0) {
      return; // Nothing to do, but keep checking
    }

    // Respect rate limit: wait if needed
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    const minTimeBetweenRequests = 1000 / MAX_REQUESTS_PER_SECOND;
    
    if (timeSinceLastRequest < minTimeBetweenRequests) {
      return; // Wait for next interval tick
    }

    // Start new requests if under concurrency limit
    while (activeRequests < MAX_CONCURRENT_REQUESTS && jobQueue.length > 0) {
      if (shouldStop()) {
        // Don't start new jobs, but let existing ones finish
        break;
      }

      const job = jobQueue.shift();
      activeRequests++;
      lastRequestTime = Date.now();

      runJob(job).finally(() => {
        activeRequests--;
      });

      // Check rate limit again after starting a job
      const nowAfterStart = Date.now();
      const timeSince = nowAfterStart - lastRequestTime;
      if (timeSince < minTimeBetweenRequests) {
        break; // Don't start more jobs this tick
      }
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

// This actually calls Blitz API
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
  if (!profileUrl) {
    return Promise.resolve({ found: false, email: "" });
  }

  // Cache Blitz response per profile URL
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
    return {
      jobTitle: match[0].trim(),
      companyName: match[1].trim(),
    };
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

// Ensure output folder exists
const outputDir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

/* ========================
 * CSV WRITER (STREAMING APPEND)
 * ======================*/

// We want the output CSV created at the beginning and then APPENDED
// as the program goes on (row by row).
let globalCsvWriter = null;

function getCsvWriter() {
  if (globalCsvWriter) return globalCsvWriter;

  const fileExists = fs.existsSync(OUTPUT_FILE);

  globalCsvWriter = createCsvWriter({
    path: OUTPUT_FILE,
    header: [
      { id: "FIRST_NAME", title: "First name" },
      { id: "LAST_NAME", title: "Last name" },
      { id: "JOBTITLE", title: "Jobtitle" },
      { id: "EMAIL", title: "Email" },
      { id: "EMAIL_DOMAIN", title: "Email domain" },
      { id: "COMPANY_NAME", title: "Company name" },
      { id: "COMPANY_WEBSITE", title: "Company website" },
      { id: "COMPANY_LINKEDIN_URL", title: "Company linkedin url" },
      { id: "Author", title: "Author" },
      { id: "Post_URL", title: "Post linkedin url" },
      { id: "Profile_URL", title: "Profile url" },
    ],
    append: fileExists,
  });

  return globalCsvWriter;
}

/* ========================
 * METRICS EMITTER (for Electron UI)
 * ======================*/

// This prints a PURE JSON line the main process can parse as:
// { type: 'status', status: 'running', metrics: {...} }
function emitMetrics(extra = {}) {
  const {
    phase = "running",
    currentFile = null,
    totalFiles = null,
    currentRow = null,
    totalRows = null,
    emailsFound = null,
    emailsNotFound = null,
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
      },
    })
  );
}

/* ========================
 * MAIN LOGIC
 * ======================*/

async function processAllFiles() {
  console.log("======================================");
  console.log("🔍 Blitz Email Enrichment – Batch Mode");
  console.log("======================================");
  console.log(`📂 Input folder : ${INPUT_DIR}`);
  console.log(`📁 Output file  : ${OUTPUT_FILE}`);
  console.log(`🔑 Blitz API key: ${BLITZ_API_KEY ? "OK (set)" : "NOT SET!"}`);
  console.log("💡 Limit: 5 requests/second (~18k leads/hour)");
  console.log("======================================\n");

  if (!INPUT_DIR) {
    console.error("❌ No input folder provided. Please select an input folder.");
    process.exit(1);
  }

  if (!OUTPUT_FILE) {
    console.error("❌ No output file path provided. Please select an output folder.");
    process.exit(1);
  }

  if (!BLITZ_API_KEY) {
    console.error(
      "❌ No Blitz API key provided. Set BLITZ_API_KEY, TOOL_CONFIG.apiKey, or use --api-key."
    );
    process.exit(1);
  }

  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`❌ Input folder not found: ${INPUT_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(INPUT_DIR)
    .filter((f) => f.toLowerCase().endsWith(".csv"));

  if (files.length === 0) {
    console.log("⚠️  No CSV files found in the input folder. Exiting.");
    return;
  }

  console.log(`📄 Found ${files.length} CSV file(s) to process.\n`);

  // Create output CSV at the beginning
  getCsvWriter();

  // Start rate limiter (for Blitz calls)
  startRateLimiter();

  for (let idx = 0; idx < files.length; idx++) {
    if (shouldStop()) {
      console.log(
        "⏹ Stop requested. Not starting any new files. Remaining files will be left untouched."
      );
      break;
    }

    const file = files[idx];
    await processSingleFile(file, idx + 1, files.length);
  }

  console.log("\n✅ Blitz enrichment run finished.");
  
  // Wait for any remaining jobs to finish
  let waitCount = 0;
  while ((jobQueue.length > 0 || activeRequests > 0) && waitCount < 600) {
    await new Promise(resolve => setTimeout(resolve, 100));
    waitCount++;
  }
  
  stopRateLimiter();
}

/**
 * Process a single CSV file from INPUT_DIR.
 */
async function processSingleFile(filename, fileIndex, totalFiles) {
  const inputPath = path.join(INPUT_DIR, filename);

  console.log("--------------------------------------");
  console.log(`📄 Processing file : ${filename}`);
  console.log(`    [${fileIndex}/${totalFiles}]`);
  console.log("--------------------------------------");

  const rows = [];

  await new Promise((resolve, reject) => {
    fs.createReadStream(inputPath)
      .pipe(csv())
      .on("data", (data) => rows.push(data))
      .on("end", resolve)
      .on("error", reject);
  });

  console.log(`📊 Total rows found: ${rows.length}`);

  let processedCount = 0;
  let emailFoundCount = 0;
  let emailNotFoundCount = 0;

  emitMetrics({
    phase: "running",
    currentFile: filename,
    totalFiles,
    currentRow: 0,
    totalRows: rows.length,
    emailsFound: emailFoundCount,
    emailsNotFound: emailNotFoundCount,
  });

  const csvWriter = getCsvWriter();

  for (const row of rows) {
    if (shouldStop()) {
      console.log(
        "⏹ Stop requested during file processing. Ending loop after this iteration."
      );
      break;
    }

    processedCount++;

    const profileUrl = (row[PROFILE_URL_COL] || "").trim();
    const position = (row[POSITION_COL] || "").trim();
    const authorName = (row[AUTHOR_NAME_COL] || "").trim();
    const postUrl = (row[POST_URL_COL] || "").trim();
    const inputFirstName = (row[FIRST_NAME_COL] || "").trim();
    const inputLastName = (row[LAST_NAME_COL] || "").trim();

    if (!profileUrl) {
      console.log(
        `⚠️  [Row ${processedCount}] Missing LinkedIn profile URL. Skipping.`
      );

      emitMetrics({
        phase: "running",
        currentFile: filename,
        totalFiles,
        currentRow: processedCount,
        totalRows: rows.length,
        emailsFound: emailFoundCount,
        emailsNotFound: emailNotFoundCount,
      });

      continue;
    }

    let blitzData;
    try {
      blitzData = await blitzEmailLookup(profileUrl);
    } catch (err) {
      console.log(
        `❌  [Row ${processedCount}] Error calling Blitz for ${profileUrl}: ${
          err.message || String(err)
        }`
      );

      emitMetrics({
        phase: "running",
        currentFile: filename,
        totalFiles,
        currentRow: processedCount,
        totalRows: rows.length,
        emailsFound: emailFoundCount,
        emailsNotFound: emailNotFoundCount,
      });

      continue;
    }

    const found = blitzData?.found;
    const email = (blitzData?.email || "").trim();
    const allEmails = Array.isArray(blitzData?.all_emails) ? blitzData.all_emails : [];

    // Pull email_domain and company_linkedin_url from the first item (primary)
    const primaryEmailObj = allEmails[0] || null;
    const emailDomain = primaryEmailObj?.email_domain || (email.includes("@") ? email.split("@")[1] : "");
    const companyLinkedinUrl = primaryEmailObj?.company_linkedin_url || "";

    if (found && email) {
      emailFoundCount++;
      console.log(
        `✅  [${processedCount}/${rows.length}] Email found for: ${profileUrl} -> ${email}`
      );
    } else {
      emailNotFoundCount++;
      console.log(
        `🚫  [${processedCount}/${rows.length}] No email found for: ${profileUrl}`
      );
    }

    const { jobTitle, companyName: posCompanyName } = parsePosition(position);
    const website = websiteFromEmail(email);
    const domain = email ? email.split("@")[1] : "";
    const domainCompanyName = companyNameFromDomain(domain);
    const finalCompanyName = posCompanyName || domainCompanyName;

    const enrichedRow = {
      FIRST_NAME: capitalizeFirstWord(inputFirstName),
      LAST_NAME: capitalizeFirstWord(inputLastName),
      JOBTITLE: capitalizeFirstWord(jobTitle),
      EMAIL: email,
      EMAIL_DOMAIN: emailDomain,
      COMPANY_NAME: capitalizeFirstWord(finalCompanyName),
      COMPANY_WEBSITE: website,
      COMPANY_LINKEDIN_URL: companyLinkedinUrl,
      Author: capitalizeFirstWord(authorName),
      Post_URL: postUrl,
      Profile_URL: profileUrl,
    };

    // 🔥 STREAMING APPEND: write this row immediately
    await csvWriter.writeRecords([enrichedRow]);

    // Emit metrics for UI
    emitMetrics({
      phase: "running",
      currentFile: filename,
      totalFiles,
      currentRow: processedCount,
      totalRows: rows.length,
      emailsFound: emailFoundCount,
      emailsNotFound: emailNotFoundCount,
    });
  }

  console.log("\n📁 Output file (combined): " + OUTPUT_FILE);
  console.log("📌 Summary for file: " + filename);
  console.log(`   • Rows processed   : ${processedCount}`);
  console.log(`   • Emails found     : ${emailFoundCount}`);
  console.log(`   • Emails not found : ${emailNotFoundCount}`);
  console.log("--------------------------------------\n");

  emitMetrics({
    phase: shouldStop() ? "stopped" : "running",
    currentFile: filename,
    totalFiles,
    currentRow: processedCount,
    totalRows: rows.length,
    emailsFound: emailFoundCount,
    emailsNotFound: emailNotFoundCount,
  });
}

/* ========================
 * RUN
 * ======================*/

processAllFiles().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
