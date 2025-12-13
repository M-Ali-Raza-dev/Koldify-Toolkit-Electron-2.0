// blitz-waterfall-icp.js
// =======================================================
// Blitz Waterfall ICP Runner (Bulk, Electron + CLI friendly)
// =======================================================
//
// DEFAULT USAGE (same folder as CSVs):
//   node blitz-waterfall-icp.js
//
// CLI OVERRIDES (all optional):
//   --in PATH              companies.csv path
//   --out PATH             output CSV path
//   --include PATH         include_titles.csv path
//   --exclude PATH         exclude_titles.csv path
//   --locations PATH       locations.csv path
//   --max-results N        contacts per company (default: 10)
//   --api-key KEY          Blitz API key (else BLITZ_API_KEY env, else default)
//
//
// Electron TOOL_CONFIG (JSON in process.env.TOOL_CONFIG), e.g.:
// {
//   "inputCsv": "C:\\path\\to\\companies.csv",
//   "outputCsv": "C:\\path\\to\\blitz_icp_results.csv",
//   "includeTitlesCsv": "C:\\path\\to\\include_titles.csv",
//   "excludeTitlesCsv": "C:\\path\\to\\exclude_titles.csv",
//   "locationsCsv": "C:\\path\\to\\locations.csv",
//   "maxResults": 10,
//   "apiKey": "blitz_XXXXXXXX"
// }
//
// STOP SUPPORT:
//   - Set env STOP_FLAG_FILE to a path. If that file exists, script stops
//     before starting new companies.
//   - SIGINT / SIGTERM (Ctrl+C) also trigger graceful stop.
// =======================================================

const fs = require("fs");
const path = require("path");

// FIX: When spawned from Electron, __dirname is backend/blitz/
// Add app root to module search paths.
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, '../../');
if (module.paths && !module.paths.includes(path.join(appRoot, 'node_modules'))) {
  module.paths.unshift(path.join(appRoot, 'node_modules'));
}

const csv = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");

// fetch polyfill (Node 18+ has global fetch; older needs node-fetch)
const fetch =
  globalThis.fetch ||
  ((...args) =>
    import("node-fetch").then((m) => m.default(...args)));

/* ----------------- STOP SUPPORT ----------------- */

const STOP_FLAG_FILE = process.env.STOP_FLAG_FILE || "";
let stopRequested = false;

function handleStopSignal(signal) {
  console.log("");
  console.log("=".repeat(80));
  console.log(`[STOP] Signal ${signal} received by blitz-waterfall-icp.`);
  console.log("[STOP] Will NOT start new companies.");
  console.log(
    "[STOP] Any in-flight Blitz call will finish, then the script will exit."
  );
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

/* ----------------- CLI + TOOL_CONFIG ----------------- */

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
  if (v == null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
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

/* ----------------- DEFAULT CONFIG ----------------- */

const DEFAULT_INPUT_CSV = path.join(process.cwd(), "companies.csv");
const DEFAULT_OUTPUT_CSV = path.join(
  process.cwd(),
  "blitz_icp_results.csv"
);
const DEFAULT_INCLUDE_TITLES_CSV = path.join(
  process.cwd(),
  "include_titles.csv"
);
const DEFAULT_EXCLUDE_TITLES_CSV = path.join(
  process.cwd(),
  "exclude_titles.csv"
);
const DEFAULT_LOCATIONS_CSV = path.join(process.cwd(), "locations.csv");
const COLUMN_NAME = "company_linkedin_url";
const DEFAULT_MAX_RESULTS = 10;

/* ----------------- EFFECTIVE CONFIG ----------------- */

// I/O paths (CLI > TOOL_CONFIG > defaults)
const INPUT_CSV = getArg(
  "--in",
  fromEnv("inputCsv", DEFAULT_INPUT_CSV)
);

const OUTPUT_CSV = getArg(
  "--out",
  fromEnv("outputCsv", DEFAULT_OUTPUT_CSV)
);

const INCLUDE_TITLES_CSV = getArg(
  "--include",
  fromEnv("includeTitlesCsv", DEFAULT_INCLUDE_TITLES_CSV)
);

const EXCLUDE_TITLES_CSV = getArg(
  "--exclude",
  fromEnv("excludeTitlesCsv", DEFAULT_EXCLUDE_TITLES_CSV)
);

const LOCATIONS_CSV = getArg(
  "--locations",
  fromEnv("locationsCsv", DEFAULT_LOCATIONS_CSV)
);

// Max results per company
const MAX_RESULTS = getArgNumber(
  "--max-results",
  fromEnv("maxResults", DEFAULT_MAX_RESULTS)
);

// Blitz API key: CLI > TOOL_CONFIG > env > hardcoded default
const BLITZ_API_KEY = getArg(
  "--api-key",
  fromEnv("apiKey", process.env.BLITZ_API_KEY)
);

/* ----------------- METRICS EMITTER (for Electron UI) ----------------- */

function emitMetrics(extra = {}) {
  const {
    phase = "running",
    totalCompanies = null,
    processedCompanies = null,
    failedCompanies = null,
    currentCompany = null,
    contactsFound = null,
    noMatches = null,
  } = extra;

  console.log(
    JSON.stringify({
      type: "status",
      status: phase,
      metrics: {
        totalCompanies,
        companiesProcessed: processedCompanies,
        failedCompanies,
        currentCompany,
        contactsFound,
        noMatches,
      },
    })
  );
}

/* ----------------- SAFETY CHECKS ----------------- */

function ensureInputExists() {
  if (!fs.existsSync(INPUT_CSV)) {
    console.error(
      `\n[ERROR] "${INPUT_CSV}" not found. Create it with a "${COLUMN_NAME}" column or use --in.\n`
    );
    process.exit(1);
  }

  if (!fs.existsSync(INCLUDE_TITLES_CSV)) {
    console.error(
      `\n[ERROR] "${INCLUDE_TITLES_CSV}" not found. This file is required (include titles).\n`
    );
    process.exit(1);
  }

  if (!BLITZ_API_KEY) {
    console.error(
      '\n[ERROR] BLITZ_API_KEY is not set. Use env, TOOL_CONFIG.apiKey, or --api-key.\n'
    );
    process.exit(1);
  }
}

/* ----------------- HELPERS: CSV READERS ----------------- */

function readCompaniesFromCsv(csvPath, columnName) {
  return new Promise((resolve, reject) => {
    const companies = [];
    let rowCount = 0;

    fs.createReadStream(csvPath)
      .pipe(csv())
      .on("data", (row) => {
        rowCount++;
        const url = row[columnName];
        if (!url || !String(url).trim()) {
          console.warn(
            `[WARN] Row ${rowCount} missing "${columnName}" – skipping.`
          );
          return;
        }
        companies.push(String(url).trim());
      })
      .on("end", () => {
        console.log(
          `\n[LOG] Loaded ${companies.length} company URLs from "${csvPath}" (column: "${columnName}").`
        );
        resolve(companies);
      })
      .on("error", (err) => reject(err));
  });
}

function readListFromCsv(
  filePath,
  { required = false, normalizeLocation = false } = {}
) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      if (required) {
        return reject(new Error(`Required CSV file missing: ${filePath}`));
      }
      console.warn(
        `[WARN] CSV file not found: ${filePath} – treating as empty.`
      );
      return resolve([]);
    }

    const values = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => {
        const cols = Object.values(row);
        const raw = cols.find((v) => v && String(v).trim());
        if (!raw) return;

        let val = String(raw).trim();

        if (normalizeLocation) {
          const lower = val.toLowerCase();

          if (lower === "usa") {
            val = "US";
          } else if (lower.length === 2) {
            val = lower.toUpperCase();
          } else {
            val = val;
          }
        }

        values.push(val);
      })
      .on("end", () => resolve(values))
      .on("error", (err) => reject(err));
  });
}

/* ----------------- HELPER: Blitz API CALL ----------------- */

async function callBlitzWaterfall(companyUrl, cascade, maxResults) {
  const body = {
    company_linkedin_url: companyUrl,
    cascade,
    max_results: maxResults,
  };

  const res = await fetch(
    "https://api.blitz-api.ai/api/search/waterfall-icp-real-time",
    {
      method: "POST",
      headers: {
        "x-api-key": BLITZ_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status} ${res.statusText} for ${companyUrl}: ${text}`.trim()
    );
  }

  return res.json();
}

/* ----------------- HELPER: pretty print result ----------------- */

function logCompanyResult(idx, total, companyUrl, apiResponse) {
  const count = apiResponse.results_length || 0;
  console.log("\n" + "─".repeat(70));
  console.log(
    `[${idx}/${total}] ${companyUrl} -> ${count} contact(s) returned (max: ${apiResponse.max_results})`
  );

  if (!apiResponse.results || apiResponse.results.length === 0) {
    console.log("   No matching contacts found.");
    return;
  }

  apiResponse.results.forEach((person, i) => {
    const rank = person.ranking ?? i + 1;
    const icp = person.icp ?? "N/A";
    const name =
      person.full_name ||
      `${person.first_name || ""} ${person.last_name || ""}`.trim();
    const title = person.job_title || "N/A";
    const country = person.country || "N/A";
    const personUrl = person.person_linkedin_url || "N/A";

    console.log(
      `   #${rank} | ${name} | ${title} | Country: ${country} | ICP: ${icp}`
    );
    console.log(`       LinkedIn: ${personUrl}`);

    if (person.what_matched && person.what_matched.length > 0) {
      const wm = person.what_matched
        .map((w) => `${w.key}: "${w.value}"`)
        .join(" | ");
      console.log(`       Matched: ${wm}`);
    }
  });
}

/* ----------------- HELPER: flatten for CSV ----------------- */

function flattenResultsForCsv(companyResponse) {
  const rows = [];
  const companyUrl = companyResponse.company_linkedin_url || "";
  const maxResults = companyResponse.max_results ?? "";
  const resultsLen = companyResponse.results_length ?? "";

  if (!companyResponse.results || companyResponse.results.length === 0) {
    return rows;
  }

  for (const person of companyResponse.results) {
    const whatMatched =
      person.what_matched && Array.isArray(person.what_matched)
        ? person.what_matched.map((w) => `${w.key}: ${w.value}`).join(" | ")
        : "";

    rows.push({
      search_company_linkedin_url: companyUrl,
      search_max_results: maxResults,
      search_results_length: resultsLen,

      company_domain: person.company_domain || "",
      company_linkedin_url: person.company_linkedin_url || "",

      full_name: person.full_name || "",
      first_name: person.first_name || "",
      last_name: person.last_name || "",
      job_title: person.job_title || "",
      linkedin_headline: person.linkedin_headline || "",
      person_linkedin_url: person.person_linkedin_url || "",
      country: person.country || "",
      icp: person.icp ?? "",
      ranking: person.ranking ?? "",
      what_matched: whatMatched,
    });
  }

  return rows;
}

/* ----------------- CSV WRITER (STREAMING APPEND) ----------------- */

// Create/append output CSV once, then append rows per company
let globalCsvWriter = null;

function getCsvWriter() {
  if (globalCsvWriter) return globalCsvWriter;

  const dir = path.dirname(OUTPUT_CSV);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const fileExists = fs.existsSync(OUTPUT_CSV);

  globalCsvWriter = createObjectCsvWriter({
    path: OUTPUT_CSV,
    header: [
      {
        id: "search_company_linkedin_url",
        title: "search_company_linkedin_url",
      },
      { id: "search_max_results", title: "search_max_results" },
      { id: "search_results_length", title: "search_results_length" },
      { id: "company_domain", title: "company_domain" },
      { id: "company_linkedin_url", title: "company_linkedin_url" },
      { id: "full_name", title: "full_name" },
      { id: "first_name", title: "first_name" },
      { id: "last_name", title: "last_name" },
      { id: "job_title", title: "job_title" },
      { id: "linkedin_headline", title: "linkedin_headline" },
      { id: "person_linkedin_url", title: "person_linkedin_url" },
      { id: "country", title: "country" },
      { id: "icp", title: "icp" },
      { id: "ranking", title: "ranking" },
      { id: "what_matched", title: "what_matched" },
    ],
    append: fileExists,
  });

  return globalCsvWriter;
}

/* ----------------- MAIN ----------------- */

(async () => {
  console.clear();
  console.log("==============================================");
  console.log(" Blitz API – Waterfall ICP Bulk Enricher");
  console.log(" Node/Electron friendly, with STOP + status logs");
  console.log("==============================================\n");

  ensureInputExists();

  console.log("[LOG] Config snapshot:");
  console.log(`   INPUT_CSV        = ${INPUT_CSV}`);
  console.log(`   OUTPUT_CSV       = ${OUTPUT_CSV}`);
  console.log(`   INCLUDE_TITLES   = ${INCLUDE_TITLES_CSV}`);
  console.log(`   EXCLUDE_TITLES   = ${EXCLUDE_TITLES_CSV}`);
  console.log(`   LOCATIONS_CSV    = ${LOCATIONS_CSV}`);
  console.log(`   MAX_RESULTS      = ${MAX_RESULTS}`);
  console.log(
    `   BLITZ_API_KEY    = ${
      BLITZ_API_KEY ? BLITZ_API_KEY.slice(0, 10) + "…" : "NOT SET"
    }`
  );
  console.log("------------------------------------------------\n");

  // Load filters
  let includeTitles;
  try {
    includeTitles = await readListFromCsv(INCLUDE_TITLES_CSV, {
      required: true,
      normalizeLocation: false,
    });
  } catch (e) {
    console.error(`\n[ERROR] ${e.message}\n`);
    process.exit(1);
  }

  if (includeTitles.length === 0) {
    console.error(
      `\n[ERROR] "${INCLUDE_TITLES_CSV}" is empty. Add at least one title (e.g. "ceo") and rerun.\n`
    );
    process.exit(1);
  }

  const excludeTitles = await readListFromCsv(EXCLUDE_TITLES_CSV, {
    required: false,
    normalizeLocation: false,
  });

  const locations = await readListFromCsv(LOCATIONS_CSV, {
    required: false,
    normalizeLocation: true,
  });

  console.log("[LOG] Filters loaded:");
  console.log(
    `   include_title: ${includeTitles.length} item(s) (${INCLUDE_TITLES_CSV})`
  );
  console.log(
    `   exclude_title: ${excludeTitles.length} item(s)${
      excludeTitles.length ? " (" + EXCLUDE_TITLES_CSV + ")" : ""
    }`
  );
  console.log(
    `   location:      ${locations.length} item(s)${
      locations.length ? " (" + LOCATIONS_CSV + ")" : ""
    }`
  );

  // Cascade (single step for now)
  const cascade = [
    {
      include_title: includeTitles,
      exclude_title: excludeTitles,
      location: locations,
    },
  ];

  // Load companies
  const companies = await readCompaniesFromCsv(INPUT_CSV, COLUMN_NAME);
  if (companies.length === 0) {
    console.error(
      "\n[ERROR] No valid company URLs found. Check your CSV and column name.\n"
    );
    process.exit(1);
  }

  console.log(
    `\n[LOG] Starting Blitz search for ${companies.length} companie(s) with max_results=${MAX_RESULTS}...\n`
  );

  // Prepare CSV writer (create or append)
  const csvWriter = getCsvWriter();

  let processedCompanies = 0;
  let failedCompanies = 0;
  let contactsFound = 0;
  let noMatches = 0;
  const errorSummary = [];

  emitMetrics({
    phase: "running",
    totalCompanies: companies.length,
    processedCompanies,
    failedCompanies,
    currentCompany: null,
    contactsFound,
    noMatches,
  });

  for (let i = 0; i < companies.length; i++) {
    if (shouldStop()) {
      console.log("");
      console.log("=".repeat(70));
      console.log(
        "[STOP] Stop requested. Not starting any new companies. Remaining companies will be skipped."
      );
      console.log("=".repeat(70));
      break;
    }

    const idx = i + 1;
    const companyUrl = companies[i];

    console.log(
      `\n[RUN] (${idx}/${companies.length}) Querying Blitz for: ${companyUrl}`
    );

    emitMetrics({
      phase: "running",
      totalCompanies: companies.length,
      processedCompanies,
      failedCompanies,
      currentCompany: companyUrl,
      contactsFound,
      noMatches,
    });

    try {
      const apiRes = await callBlitzWaterfall(
        companyUrl,
        cascade,
        MAX_RESULTS
      );

      const decorated = {
        company_linkedin_url: companyUrl,
        max_results: apiRes.max_results ?? MAX_RESULTS,
        results_length:
          apiRes.results_length ??
          (apiRes.results ? apiRes.results.length : 0),
        results: apiRes.results || [],
      };

      logCompanyResult(idx, companies.length, companyUrl, decorated);

      const rows = flattenResultsForCsv(decorated);

      if (rows.length === 0) {
        noMatches++;
      } else {
        contactsFound += rows.length;
        // STREAMING APPEND: write this company's rows immediately
        await csvWriter.writeRecords(rows);
      }

      processedCompanies++;

      emitMetrics({
        phase: "running",
        totalCompanies: companies.length,
        processedCompanies,
        failedCompanies,
        currentCompany: companyUrl,
        contactsFound,
        noMatches,
      });
    } catch (err) {
      console.error(
        `[ERROR] Failed for company: ${companyUrl}\n        ${
          err.message || String(err)
        }`
      );
      failedCompanies++;
      errorSummary.push({ companyUrl, error: err.message || String(err) });

      emitMetrics({
        phase: "running",
        totalCompanies: companies.length,
        processedCompanies,
        failedCompanies,
        currentCompany: companyUrl,
        contactsFound,
        noMatches,
      });
    }
  }

  if (contactsFound === 0) {
    console.warn(
      `\n[WARN] No contact rows generated – "${OUTPUT_CSV}" may not have new rows.`
    );
  } else {
    console.log(
      `\n[SUCCESS] Contacts appended to "${OUTPUT_CSV}". Total contacts this run: ${contactsFound}`
    );
  }

  if (errorSummary.length > 0) {
    console.log("\n[SUMMARY] Some companies failed:");
    errorSummary.forEach((e) => {
      console.log(`   - ${e.companyUrl} -> ${e.error}`);
    });
  } else {
    console.log("\n[SUMMARY] All processed companies succeeded without API errors.");
  }

  emitMetrics({
    phase: shouldStop() ? "stopped" : "done",
    totalCompanies: companies.length,
    processedCompanies,
    failedCompanies,
    currentCompany: null,
    contactsFound,
    noMatches,
  });

  console.log("\n[DONE] Blitz ICP enrichment complete.\n");
})().catch((e) => {
  console.error("UNCAUGHT ERROR:", e);
  process.exit(1);
});
