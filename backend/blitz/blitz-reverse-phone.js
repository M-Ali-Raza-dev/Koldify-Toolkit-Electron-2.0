// blitz-reverse-phone.js
// Blitz Reverse Phone -> Person (CSV Output) - Electron & CLI friendly, stop-safe, rate-limited

/**
 * Inputs:
 *  - single phone: node reverse-phone-to-person.js --phone "+1234567890"
 *  - csv:          node reverse-phone-to-person.js --input "C:\path\file.csv" --column "phone"
 *  - txt/note:     node reverse-phone-to-person.js --input "C:\path\numbers.txt"
 *
 * Node: v18+ (fetch included)
 */

const fs = require("fs");
const path = require("path");

// FIX: When spawned from Electron, __dirname is backend/blitz/
// Add app root to module search paths.
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, "../../");
if (module.paths && !module.paths.includes(path.join(appRoot, "node_modules"))) {
  module.paths.unshift(path.join(appRoot, "node_modules"));
}

const API_URL = "https://api.blitz-api.ai/v2/enrichment/phone-to-person";

/* ========================
 * STOP SUPPORT
 * ======================*/
const STOP_FLAG_FILE = process.env.STOP_FLAG_FILE || "";
let stopRequested = false;

function handleStopSignal(signal) {
  console.log("");
  console.log("=".repeat(80));
  console.log(`[STOP] Signal ${signal} received by blitz-reverse-phone.`);
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

// --- CLI arg helpers ---
function getArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  const val = process.argv[idx + 1];
  return val ?? fallback;
}
function hasFlag(flag) {
  return process.argv.includes(flag);
}

// --- Config from TOOL_CONFIG or CLI ---
function getConfig() {
  let config = {};
  const raw = process.env.TOOL_CONFIG;
  if (raw) {
    try {
      config = JSON.parse(raw);
    } catch (e) {
      console.error("[ERROR] Failed to parse TOOL_CONFIG:", e.message);
    }
  }

  return {
    apiKey: config.apiKey || process.env.BLITZ_API_KEY || getArg("--apiKey"),
    singlePhone: config.singlePhone || getArg("--phone"),
    inputPath: config.inputPath || getArg("--input"),
    columnName: config.columnName || getArg("--column", "phone"),
    outputDir: config.outputDir || getArg("--output-dir", "./output"),
    concurrency: parseInt(config.concurrency || getArg("--concurrency", "3"), 10),
  };
}

// --- Logging (structured + readable) ---
function nowISO() {
  return new Date().toISOString();
}
function log(level, msg, meta = {}) {
  const line = {
    ts: nowISO(),
    level,
    msg,
    ...meta,
  };
  console.log(JSON.stringify(line));
}

// --- Status/Metrics output for Electron UI ---
function emitStatus(phase = "running", extra = {}) {
  const {
    totalPhones = null,
    phonesProcessed = null,
    phonesFound = null,
    phonesNotFound = null,
  } = extra;

  console.log(
    JSON.stringify({
      type: "status",
      status: phase,
      metrics: {
        totalPhones,
        phonesProcessed,
        phonesFound,
        phonesNotFound,
      },
    })
  );
}

// --- CSV helpers ---
function csvEscape(v) {
  const s = (v ?? "").toString();
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCSV(headers, rows) {
  const lines = [];
  lines.push(headers.map(csvEscape).join(","));
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  }
  return lines.join("\n");
}

// --- Input parsing (CSV + TXT) ---
function readFileText(p) {
  return fs.readFileSync(p, "utf8");
}

// VERY small CSV parser (good enough for standard exported CSVs)
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = splitCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = splitCSVLine(lines[i]);
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = parts[c] ?? "";
    rows.push(row);
  }

  return { headers, rows };
}

function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"' && (i === 0 || line[i - 1] !== "\\")) {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'; // escaped quote
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function extractPhonesFromTxt(text) {
  return text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// --- Blitz call with retries/backoff ---
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function blitzPhoneToPerson(phone, apiKey, attempt = 1) {
  const t0 = Date.now();

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phone }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text };
  }

  const ms = Date.now() - t0;

  // Retry on rate limits / transient errors
  if (!res.ok) {
    const status = res.status;

    // Backoff rules
    const shouldRetry = status === 429 || status >= 500;
    if (shouldRetry && attempt < 5) {
      const backoff = Math.min(15000, 750 * Math.pow(2, attempt)); // 1500, 3000, 6000...
      log("warn", "Request failed; retrying", {
        phone,
        status,
        attempt,
        backoff_ms: backoff,
      });
      await sleep(backoff);
      return blitzPhoneToPerson(phone, apiKey, attempt + 1);
    }

    log("error", "Request failed (no more retries)", {
      phone,
      status,
      attempt,
      duration_ms: ms,
      response_preview: String(text).slice(0, 300),
    });

    // return a normalized failure row
    return {
      ok: false,
      phone,
      status,
      duration_ms: ms,
      data,
    };
  }

  log("info", "Request ok", { phone, status: res.status, duration_ms: ms });

  return {
    ok: true,
    phone,
    status: res.status,
    duration_ms: ms,
    data,
  };
}

// --- Flatten Blitz response into CSV row ---
function flattenResult(phone, result) {
  const base = {
    "Phone": phone,
    "Found": "",
    "First Name": "",
    "Last Name": "",
    "Full Name": "",
    "Headline": "",
    "About Me": "",
    "Location City": "",
    "Location State Code": "",
    "Location Country Code": "",
    "LinkedIn URL": "",
    "Connections Count": "",
    "Profile Picture URL": "",
    "Current Job Title": "",
    "Current Company LinkedIn URL": "",
    "Current Company LinkedIn ID": "",
    "Current Job Start Date": "",
    "Current Job End Date": "",
    "Current Job Is Current": "",
    "Error Status": "",
    "Error Message": "",
  };

  if (!result || result.ok === false) {
    base["Found"] = "false";
    base["Error Status"] = String(result?.status ?? "");
    base["Error Message"] =
      result?.data?.message ||
      result?.data?.error ||
      "Request failed / non-OK response";
    return base;
  }

  const data = result.data || {};
  base["Found"] = String(Boolean(data.found));

  // Your sample has: data.person.person.{...}
  const p = data?.person?.person || data?.person || {};

  base["First Name"] = p.first_name ?? "";
  base["Last Name"] = p.last_name ?? "";
  base["Full Name"] = p.full_name ?? "";
  base["Headline"] = p.headline ?? "";
  base["About Me"] = p.about_me ?? "";
  base["LinkedIn URL"] = p.linkedin_url ?? "";
  base["Connections Count"] =
    p.connections_count !== undefined ? String(p.connections_count) : "";
  base["Profile Picture URL"] = p.profile_picture_url ?? "";

  const loc = p.location || {};
  base["Location City"] = loc.city ?? "";
  base["Location State Code"] = loc.state_code ?? "";
  base["Location Country Code"] = loc.country_code ?? "";

  // Take first experience as "current" if present
  const exp = Array.isArray(p.experiences) && p.experiences.length ? p.experiences[0] : null;
  if (exp) {
    base["Current Job Title"] = exp.job_title ?? "";
    base["Current Company LinkedIn URL"] = exp.company_linkedin_url ?? "";
    base["Current Company LinkedIn ID"] = exp.company_linkedin_id ?? "";
    base["Current Job Start Date"] = exp.job_start_date ?? "";
    base["Current Job End Date"] = exp.job_end_date ?? "";
    base["Current Job Is Current"] =
      exp.job_is_current !== undefined ? String(exp.job_is_current) : "";
  }

  return base;
}

// --- Main runner ---
async function main() {
  const config = getConfig();
  const { apiKey, singlePhone, inputPath, columnName, outputDir, concurrency } = config;

  if (!apiKey) {
    console.error(
      "Missing API key. Set env var BLITZ_API_KEY or pass --apiKey \"...\""
    );
    process.exit(1);
  }

  // Ensure output dir exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Collect phones
  let phones = [];

  if (singlePhone) {
    phones = [singlePhone.trim()];
  } else if (inputPath) {
    const ext = path.extname(inputPath).toLowerCase();
    const raw = readFileText(inputPath);

    if (ext === ".csv") {
      const parsed = parseCSV(raw);
      if (!parsed.headers.includes(columnName)) {
        console.error(
          `CSV missing column "${columnName}". Found columns: ${parsed.headers.join(
            ", "
          )}`
        );
        process.exit(1);
      }
      phones = parsed.rows
        .map((r) => (r[columnName] || "").trim())
        .filter(Boolean);
    } else {
      // .txt, .note, etc
      phones = extractPhonesFromTxt(raw);
    }
  } else {
    console.error(
      'Provide either --phone "+123..." OR --input "file.csv/.txt"'
    );
    process.exit(1);
  }

  // Basic cleanup + de-dupe
  phones = Array.from(new Set(phones.map((p) => p.trim()).filter(Boolean)));

  log("info", "Starting run", {
    total_phones: phones.length,
    concurrency,
    output_dir: outputDir,
  });

  // Emit initial status
  emitStatus("running", {
    totalPhones: phones.length,
    phonesProcessed: 0,
    phonesFound: 0,
    phonesNotFound: 0,
  });

  const headers = [
    "Phone",
    "Found",
    "First Name",
    "Last Name",
    "Full Name",
    "Headline",
    "About Me",
    "Location City",
    "Location State Code",
    "Location Country Code",
    "LinkedIn URL",
    "Connections Count",
    "Profile Picture URL",
    "Current Job Title",
    "Current Company LinkedIn URL",
    "Current Company LinkedIn ID",
    "Current Job Start Date",
    "Current Job End Date",
    "Current Job Is Current",
    "Error Status",
    "Error Message",
  ];

  // Concurrency worker pool
  const results = new Array(phones.length);
  let idx = 0;
  let processedCount = 0;
  let foundCount = 0;
  let notFoundCount = 0;

  async function worker(workerId) {
    while (true) {
      // Check for stop
      if (stopRequested || softStopRequested()) {
        log("info", "Worker stopping", { workerId });
        return;
      }

      const myIndex = idx++;
      if (myIndex >= phones.length) return;

      const phone = phones[myIndex];
      log("info", "Worker processing", { workerId, phone, i: myIndex + 1 });

      try {
        const res = await blitzPhoneToPerson(phone, apiKey);
        results[myIndex] = flattenResult(phone, res);
        
        // Update counters
        processedCount++;
        if (results[myIndex]["Found"] === "true") {
          foundCount++;
        } else {
          notFoundCount++;
        }

        // Emit status every 5 processed or at key milestones
        if (processedCount % 5 === 0 || processedCount === phones.length) {
          emitStatus("running", {
            totalPhones: phones.length,
            phonesProcessed: processedCount,
            phonesFound: foundCount,
            phonesNotFound: notFoundCount,
          });
        }
      } catch (e) {
        log("error", "Unhandled exception", {
          workerId,
          phone,
          error: e?.message || String(e),
        });
        results[myIndex] = flattenResult(phone, {
          ok: false,
          status: "",
          data: { message: e?.message || String(e) },
        });
        processedCount++;
        notFoundCount++;
      }
    }
  }

  const workers = [];
  for (let w = 0; w < Math.max(1, concurrency); w++) workers.push(worker(w + 1));
  await Promise.all(workers);

  // Final status update
  emitStatus("done", {
    totalPhones: phones.length,
    phonesProcessed: processedCount,
    phonesFound: foundCount,
    phonesNotFound: notFoundCount,
  });

  // Check if stopped early
  if (stopRequested || softStopRequested()) {
    log("warn", "Run stopped early", {
      processed: results.filter(r => r).length,
      total: phones.length,
    });
  }

  // Write output CSV
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
  const outPath = path.join(outputDir, `reverse_phone_to_person_${stamp}.csv`);

  const csv = toCSV(headers, results.filter(r => r)); // Only write completed results
  fs.writeFileSync(outPath, csv, "utf8");

  log("info", "Done", {
    output_file: outPath,
    total: phones.length,
    found_true: foundCount,
    found_false: notFoundCount,
  });

  console.log("\nSaved CSV:\n" + outPath);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
