/**
 * Blitz Employee Finder (CSV -> CSV) — Pretty console (NO ANSI, Electron-safe)
 *
 * Supports:
 *  - CLI flags: --apiKey, --input, --output-dir, --output-file, --concurrency, --column, --verbose, --json
 *  - Electron TOOL_CONFIG via BLITZ_API_KEY and TOOL_CONFIG JSON
 *  - CSV input column: "Company LinkedIn Url" (preferred) or legacy "company_linkedin_url"
 *
 * Node v18+
 */

const fs = require("fs");
const path = require("path");

// Ensure packaged apps can resolve dependencies
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, "../../");
if (module.paths && !module.paths.includes(path.join(appRoot, "node_modules"))) {
  module.paths.unshift(path.join(appRoot, "node_modules"));
}

const API_URL = "https://api.blitz-api.ai/v2/search/employee-finder";

/* =========================
 * CLI + TOOL_CONFIG
 * =======================*/
function hasFlag(flag) {
  return process.argv.includes(flag);
}
function getArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  const val = process.argv[idx + 1];
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

const JSON_ONLY = hasFlag("--json") || process.env.JSON_LOGS === "1";
const VERBOSE = hasFlag("--verbose") || process.env.VERBOSE === "1";

/* =========================
 * Pretty Console (NO ANSI)
 * =======================*/
const UI = {
  width: 74,
  line(char = "─") {
    if (JSON_ONLY) return;
    console.log(char.repeat(this.width));
  },
  title() {
    if (JSON_ONLY) return;
    console.log("");
    console.log("🧑‍💼 Blitz Employee Finder  (CSV → CSV)");
    this.line();
  },
  section(name) {
    if (JSON_ONLY) return;
    console.log("");
    console.log("• " + name);
    this.line();
  },
  info(msg) {
    if (JSON_ONLY) return;
    console.log("ℹ " + msg);
  },
  ok(msg) {
    if (JSON_ONLY) return;
    console.log("✓ " + msg);
  },
  warn(msg) {
    if (JSON_ONLY) return;
    console.log("⚠ " + msg);
  },
  err(msg) {
    if (JSON_ONLY) return;
    console.log("✖ " + msg);
  },
  // One clean line per row completion
  rowDone({ i, total, url, page, max, ms, results, totalPages, status, note }) {
    if (JSON_ONLY) return;

    const pos = `[${String(i).padStart(3, " ")}/${String(total).padStart(3, " ")}]`;
    const time = ms != null ? (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`) : "?";
    const head = `${pos} ${url}  (p=${page}, max=${max})`;

    // shorten long URLs a bit (still recognizable)
    const trimmed = head.length > 90 ? head.slice(0, 87) + "..." : head;

    let tail = "";
    if (status === "OK") {
      tail = `✅ OK • results=${results} • pages=${totalPages ?? "?"} • ${time}`;
      if (results === 0) tail = `🟡 OK (0 results) • pages=${totalPages ?? "?"} • ${time}`;
    } else if (status === "FAIL") {
      tail = `❌ FAIL (${note || "?"}) • ${time}`;
    } else if (status === "SKIP") {
      tail = `⚠ SKIP • ${note || ""}`.trim();
    } else {
      tail = `ℹ ${note || ""}`.trim();
    }

    console.log(trimmed);
    console.log("   " + tail);

    if (VERBOSE && note && status === "FAIL") {
      console.log("   ↳ " + String(note).slice(0, 220));
    }
  },
  progress({ done, total, okCompanies, zeroCompanies, failCompanies, outRows }) {
    if (JSON_ONLY) return;
    console.log(
      `… Progress: ${done}/${total}  |  ok=${okCompanies}  |  zero=${zeroCompanies}  |  fail=${failCompanies}  |  out_rows=${outRows}`
    );
  },
  summary({ inputRows, outRows, okRows, errRows, outPath }) {
    if (JSON_ONLY) return;

    this.section("Run Summary");
    console.log(`✓ Input rows:     ${inputRows}`);
    console.log(`✓ Output rows:    ${outRows}`);
    console.log(`✓ Clean rows:     ${okRows}`);
    console.log(`✓ Rows w/ issues: ${errRows}`);
    console.log("");
    console.log("Saved CSV:");
    console.log(outPath);
    this.line();
  },
};

function jlog(level, msg, meta = {}) {
  if (!JSON_ONLY && !VERBOSE) return;
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta }));
}

function emitState(payload) {
  try {
    console.log("::STATE:: " + JSON.stringify(payload));
  } catch {}
}

/* =========================
 * CSV helpers
 * =======================*/
function csvEscape(v) {
  const s = (v ?? "").toString();
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
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
function toCSV(headers, rows) {
  const lines = [];
  lines.push(headers.map(csvEscape).join(","));
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  return lines.join("\n");
}

/* =========================
 * Parsing cell values
 * =======================*/
function parseListCell(v) {
  const s = (v ?? "").toString().trim();
  if (!s) return undefined;

  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean);
    } catch {}
  }

  return s
    .split(/[;,]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseNumberCell(v) {
  const s = (v ?? "").toString().trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/* =========================
 * Safe row getter (supports new + old headers)
 * =======================*/
function getRowVal(row, possibleKeys) {
  for (const k of possibleKeys) {
    if (row[k] !== undefined && String(row[k]).trim() !== "") return row[k];
  }
  return "";
}

/* =========================
 * Network + retries
 * =======================*/
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callEmployeeFinder(payload, apiKey, attempt = 1) {
  const t0 = Date.now();

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text };
  }

  const ms = Date.now() - t0;

  if (!res.ok) {
    const status = res.status;
    const shouldRetry = status === 429 || status >= 500;

    if (shouldRetry && attempt < 5) {
      const backoff = Math.min(15000, 750 * Math.pow(2, attempt));
      return { ok: "retry", status, duration_ms: ms, data, backoff };
    }
    return { ok: false, status, duration_ms: ms, data };
  }

  return { ok: true, status: res.status, duration_ms: ms, data };
}

/* =========================
 * Flatten response rows
 * =======================*/
function pickExperience(p) {
  const exp = Array.isArray(p.experiences) && p.experiences.length ? p.experiences[0] : null;
  return exp || {};
}

function flattenEmployee(inputRowIndex, searchPayload, apiResult, person) {
  const loc = person.location || {};
  const exp = pickExperience(person);
  const expLoc = exp.job_location || {};

  return {
    "Input Row": String(inputRowIndex),
    "Company LinkedIn Url": searchPayload.company_linkedin_url ?? "",
    "Page": String(searchPayload.page ?? ""),
    "Max Results": String(searchPayload.max_results ?? ""),

    "First Name": person.first_name ?? "",
    "Last Name": person.last_name ?? "",
    "Full Name": person.full_name ?? "",
    "Headline": person.headline ?? "",
    "Country Code": loc.country_code ?? "",
    "Continent": loc.continent ?? "",
    "LinkedIn Url": person.linkedin_url ?? "",
    "Connections Count": person.connections_count !== undefined ? String(person.connections_count) : "",
    "Profile Picture Url": person.profile_picture_url ?? "",

    "Job Title": exp.job_title ?? "",
    "Exp Company LinkedIn Url": exp.company_linkedin_url ?? "",
    "Exp Company LinkedIn Id": exp.company_linkedin_id ?? "",
    "Job Start Date": exp.job_start_date ?? "",
    "Job End Date": exp.job_end_date ?? "",
    "Job Is Current": exp.job_is_current !== undefined ? String(exp.job_is_current) : "",
    "Job Location Country Code": expLoc.country_code ?? "",

    "Results Length": apiResult?.results_length !== undefined ? String(apiResult.results_length) : "",
    "Total Pages": apiResult?.total_pages !== undefined ? String(apiResult.total_pages) : "",

    "Error Status": "",
    "Error Message": "",
  };
}

function flattenErrorRow(inputRowIndex, searchPayload, status, message) {
  return {
    "Input Row": String(inputRowIndex),
    "Company LinkedIn Url": searchPayload.company_linkedin_url ?? "",
    "Page": String(searchPayload.page ?? ""),
    "Max Results": String(searchPayload.max_results ?? ""),

    "First Name": "",
    "Last Name": "",
    "Full Name": "",
    "Headline": "",
    "Country Code": "",
    "Continent": "",
    "LinkedIn Url": "",
    "Connections Count": "",
    "Profile Picture Url": "",

    "Job Title": "",
    "Exp Company LinkedIn Url": "",
    "Exp Company LinkedIn Id": "",
    "Job Start Date": "",
    "Job End Date": "",
    "Job Is Current": "",
    "Job Location Country Code": "",

    "Results Length": "",
    "Total Pages": "",

    "Error Status": String(status ?? ""),
    "Error Message": String(message ?? ""),
  };
}

function flattenNoResultsRow(inputRowIndex, searchPayload, apiResult) {
  return {
    "Input Row": String(inputRowIndex),
    "Company LinkedIn Url": searchPayload.company_linkedin_url ?? "",
    "Page": String(searchPayload.page ?? ""),
    "Max Results": String(searchPayload.max_results ?? ""),

    "First Name": "",
    "Last Name": "",
    "Full Name": "",
    "Headline": "",
    "Country Code": "",
    "Continent": "",
    "LinkedIn Url": "",
    "Connections Count": "",
    "Profile Picture Url": "",

    "Job Title": "",
    "Exp Company LinkedIn Url": "",
    "Exp Company LinkedIn Id": "",
    "Job Start Date": "",
    "Job End Date": "",
    "Job Is Current": "",
    "Job Location Country Code": "",

    "Results Length": apiResult?.results_length !== undefined ? String(apiResult.results_length) : "0",
    "Total Pages": apiResult?.total_pages !== undefined ? String(apiResult.total_pages) : "",

    "Error Status": "",
    "Error Message": "",
  };
}

/* =========================
 * Build payload from CSV row
 * =======================*/
function buildPayloadFromRow(row, columnName) {
  const payload = {
    company_linkedin_url: String(getRowVal(row, [columnName, "Company LinkedIn Url", "company_linkedin_url"])).trim(),

    country_code: parseListCell(getRowVal(row, ["Country Code", "country_code"])),
    continent: parseListCell(getRowVal(row, ["Continent", "continent"])),
    sales_region: parseListCell(getRowVal(row, ["Sales Region", "sales_region"])),
    job_level: parseListCell(getRowVal(row, ["Job Level", "job_level"])),
    job_function: parseListCell(getRowVal(row, ["Job Function", "job_function"])),

    min_connections_count: parseNumberCell(getRowVal(row, ["Min Connections Count", "min_connections_count"])),
    max_results: parseNumberCell(getRowVal(row, ["Max Results", "max_results"])),
    page: parseNumberCell(getRowVal(row, ["Page", "page"])),
  };

  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined || payload[k] === "") delete payload[k];
  }

  if (!payload.max_results) payload.max_results = 10;
  if (!payload.page) payload.page = 1;

  return payload;
}

/* =========================
 * Main
 * =======================*/
async function main() {
  if (!JSON_ONLY) UI.title();

  const apiKey = process.env.BLITZ_API_KEY || getArg("--apiKey") || fromEnv("apiKey", "");
  const inputPath = getArg("--input", fromEnv("inputPath", "")) || "";
  const outputDir =
    getArg("--output-dir", fromEnv("outputDir", "")) || path.dirname(inputPath || ".");
  const outputFileName = getArg("--output-file", fromEnv("outputFileName", "")) || "";
  const columnName = getArg("--column", fromEnv("columnName", "Company LinkedIn Url")) || "Company LinkedIn Url";
  const concurrency = Math.max(
    1,
    parseInt(getArg("--concurrency", fromEnv("concurrency", "3")), 10) || 3
  );

  if (!apiKey) {
    if (JSON_ONLY) {
      console.log(JSON.stringify({ ok: false, error: "Missing API key." }));
    } else {
      UI.err("Missing API key. Set BLITZ_API_KEY or pass --apiKey.");
      UI.info('PowerShell:  $env:BLITZ_API_KEY="YOUR_KEY"');
    }
    process.exit(1);
  }

  const resolvedInput = inputPath || fromEnv("INPUT_CSV", "");
  if (!resolvedInput) {
    UI.err("Input CSV path is required (set --input or TOOL_CONFIG.inputPath).");
    process.exit(1);
  }

  const inPath = path.resolve(resolvedInput);
  if (!fs.existsSync(inPath)) {
    UI.err("Input CSV not found:");
    console.log(inPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(inPath, "utf8");
  const parsed = parseCSV(raw);

  const hasNew = parsed.headers.includes(columnName) || parsed.headers.includes("Company LinkedIn Url");
  const hasOld = parsed.headers.includes("company_linkedin_url");

  if (!hasNew && !hasOld) {
    UI.err(`Input CSV must include column "${columnName}" (or legacy: company_linkedin_url)`);
    UI.info(`Found headers: ${parsed.headers.join(", ")}`);
    process.exit(1);
  }

  const rows = parsed.rows.filter((r) => {
    const v = getRowVal(r, [columnName, "Company LinkedIn Url", "company_linkedin_url"]);
    return String(v || "").trim().length > 0;
  });

  if (!JSON_ONLY) {
    UI.ok(`Loaded ${rows.length} rows`);
    UI.info(`Input:  ${inPath}`);
    UI.info(`Output: ${path.resolve(outputDir || ".")}`);
    UI.info(`Concurrency: ${concurrency}`);
    UI.section("Processing");
  }

  jlog("info", "starting", {
    total_rows: rows.length,
    concurrency,
    input: inPath,
    output_dir: outputDir,
  });

  emitState({
    status: "start",
    inputRows: rows.length,
    outputRows: 0,
    cleanRows: 0,
    issueRows: 0,
  });

  const outRows = [];
  let cursor = 0;

  // counters (per input row)
  let done = 0;
  let okCompanies = 0;
  let zeroCompanies = 0;
  let failCompanies = 0;
  let issueRows = 0;

  async function worker(workerId) {
    while (true) {
      const idx = cursor++;
      if (idx >= rows.length) return;

      const payload = buildPayloadFromRow(rows[idx], columnName);

      if (!payload.company_linkedin_url) {
        done++;
        UI.rowDone({
          i: idx + 1,
          total: rows.length,
          url: "(missing company_linkedin_url)",
          page: payload.page ?? 1,
          max: payload.max_results ?? 10,
          ms: null,
          status: "SKIP",
          note: "missing URL",
        });
        if (done % 5 === 0 || done === rows.length) {
          UI.progress({ done, total: rows.length, okCompanies, zeroCompanies, failCompanies, outRows: outRows.length });
          emitState({
            status: "progress",
            inputRows: rows.length,
            outputRows: outRows.length,
            cleanRows: outRows.length - issueRows,
            issueRows: issueRows,
          });
        }
        continue;
      }

      try {
        let res = await callEmployeeFinder(payload, apiKey, 1);
        let attempts = 1;

        while (res.ok === "retry") {
          jlog("warn", "retrying", { workerId, row: idx + 1, status: res.status, attempt: attempts, backoff_ms: res.backoff });
          await sleep(res.backoff);
          attempts++;
          res = await callEmployeeFinder(payload, apiKey, attempts);
        }

        if (res.ok !== true) {
          const msg =
            res?.data?.message ||
            res?.data?.error ||
            (res?.data?._raw ? String(res.data._raw).slice(0, 260) : "Request failed");

          outRows.push(flattenErrorRow(idx + 1, payload, res.status, msg));
          issueRows++;
          failCompanies++;
          done++;

          UI.rowDone({
            i: idx + 1,
            total: rows.length,
            url: payload.company_linkedin_url,
            page: payload.page,
            max: payload.max_results,
            ms: res.duration_ms,
            status: "FAIL",
            note: `${res.status}${msg ? " • " + String(msg).slice(0, 80) : ""}`,
          });

          jlog("error", "request_failed", { workerId, row: idx + 1, status: res.status, duration_ms: res.duration_ms });
        } else {
          const data = res.data || {};
          const results = Array.isArray(data.results) ? data.results : [];

          if (results.length > 0) okCompanies++;
          else zeroCompanies++;

          for (const p of results) outRows.push(flattenEmployee(idx + 1, payload, data, p));
          if (results.length === 0) outRows.push(flattenNoResultsRow(idx + 1, payload, data));

          done++;

          UI.rowDone({
            i: idx + 1,
            total: rows.length,
            url: payload.company_linkedin_url,
            page: payload.page,
            max: payload.max_results,
            ms: res.duration_ms,
            results: results.length,
            totalPages: data.total_pages ?? "?",
            status: "OK",
          });

          jlog("info", "request_ok", {
            workerId,
            row: idx + 1,
            duration_ms: res.duration_ms,
            results: results.length,
            total_pages: data.total_pages ?? null,
          });
        }
      } catch (e) {
        const msg = e?.message || String(e);
        outRows.push(flattenErrorRow(idx + 1, payload, "", msg));
        issueRows++;

        failCompanies++;
        done++;

        UI.rowDone({
          i: idx + 1,
          total: rows.length,
          url: payload.company_linkedin_url,
          page: payload.page,
          max: payload.max_results,
          ms: null,
          status: "FAIL",
          note: msg,
        });

        jlog("error", "exception", { workerId, row: idx + 1, error: msg });
      }

      if (done % 5 === 0 || done === rows.length) {
        UI.progress({ done, total: rows.length, okCompanies, zeroCompanies, failCompanies, outRows: outRows.length });
        emitState({
          status: "progress",
          inputRows: rows.length,
          outputRows: outRows.length,
          cleanRows: outRows.length - issueRows,
          issueRows: issueRows,
        });
      }
    }
  }

  const pool = [];
  for (let w = 1; w <= concurrency; w++) pool.push(worker(w));
  await Promise.all(pool);

  if (!JSON_ONLY) UI.line();

  const headers = [
    "Input Row",
    "Company LinkedIn Url",
    "Page",
    "Max Results",

    "First Name",
    "Last Name",
    "Full Name",
    "Headline",
    "Country Code",
    "Continent",
    "LinkedIn Url",
    "Connections Count",
    "Profile Picture Url",

    "Job Title",
    "Exp Company LinkedIn Url",
    "Exp Company LinkedIn Id",
    "Job Start Date",
    "Job End Date",
    "Job Is Current",
    "Job Location Country Code",

    "Results Length",
    "Total Pages",

    "Error Status",
    "Error Message",
  ];

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
  const outName = outputFileName || `employee_finder_${stamp}.csv`;
  const outPath = path.join(outputDir || path.dirname(inPath), outName);

  fs.writeFileSync(outPath, toCSV(headers, outRows), "utf8");

  const errRows = issueRows;
  const okRows = outRows.length - errRows;

  emitState({
    status: "done",
    inputRows: rows.length,
    outputRows: outRows.length,
    cleanRows: okRows,
    issueRows: errRows,
  });

  if (!JSON_ONLY) {
    UI.summary({
      inputRows: rows.length,
      outRows: outRows.length,
      okRows,
      errRows,
      outPath,
    });
  }

  jlog("info", "done", {
    output_file: outPath,
    input_rows: rows.length,
    output_rows: outRows.length,
    ok_rows: okRows,
    issue_rows: errRows,
  });
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
