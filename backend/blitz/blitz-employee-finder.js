/**
 * Blitz Employee Finder (CSV -> CSV)
 *
 * Supports:
 *  - CLI flags: --apiKey, --input, --output-dir, --output-file, --concurrency, --column
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

/* ========= Pretty Console ========= */
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};
const hr = () =>
  console.log(C.gray + "────────────────────────────────────────────────────────────" + C.reset);
const pad = (n, w = 3) => {
  const s = String(n);
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
};
const fmtMs = (ms) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`);
const banner = () => {
  console.clear?.();
  console.log(C.cyan + C.bold + "Blitz Employee Finder" + C.reset + " " + C.gray + "(CSV → CSV)" + C.reset);
  hr();
};

/* ========= CLI + TOOL_CONFIG ========= */
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

/* ========= CSV helpers ========= */
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

/* ========= Parsing cell values ========= */
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

/* ========= Safe row getter (supports new + old headers) ========= */
function getRowVal(row, possibleKeys) {
  for (const k of possibleKeys) {
    if (row[k] !== undefined && String(row[k]).trim() !== "") return row[k];
  }
  return "";
}

/* ========= Network + retries ========= */
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

/* ========= Flatten response rows ========= */
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

/* ========= Build payload from CSV row ========= */
function buildPayloadFromRow(row) {
  const payload = {
    company_linkedin_url: String(getRowVal(row, ["Company LinkedIn Url", "company_linkedin_url"])).trim(),

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

/* ========= Main ========= */
async function main() {
  banner();

  const apiKey = process.env.BLITZ_API_KEY || getArg("--apiKey") || fromEnv("apiKey", "");
  const inputPath = getArg("--input", fromEnv("inputPath", "")) || "";
  const outputDir = getArg("--output-dir", fromEnv("outputDir", "")) || path.dirname(inputPath || ".");
  const outputFileName = getArg("--output-file", fromEnv("outputFileName", "")) || "";
  const columnName = getArg("--column", fromEnv("columnName", "Company LinkedIn Url")) || "Company LinkedIn Url";
  const concurrency = Math.max(1, parseInt(getArg("--concurrency", fromEnv("concurrency", "3")), 10) || 3);

  if (!apiKey) {
    console.log(C.red + C.bold + "Missing API key." + C.reset);
    console.log(C.yellow + 'PowerShell:  $env:BLITZ_API_KEY="YOUR_KEY"' + C.reset);
    console.log(C.gray + 'Or pass:     --apiKey "YOUR_KEY"' + C.reset);
    process.exit(1);
  }

  const resolvedInput = inputPath || fromEnv("INPUT_CSV", "");
  if (!resolvedInput) {
    console.log(C.red + "Input CSV path is required (set --input or TOOL_CONFIG.inputPath)." + C.reset);
    process.exit(1);
  }

  const inPath = path.resolve(resolvedInput);
  if (!fs.existsSync(inPath)) {
    console.log(C.red + `Input CSV not found:` + C.reset);
    console.log(C.gray + inPath + C.reset);
    process.exit(1);
  }

  const raw = fs.readFileSync(inPath, "utf8");
  const parsed = parseCSV(raw);

  const hasNew = parsed.headers.includes(columnName);
  const hasOld = parsed.headers.includes("company_linkedin_url");

  if (!hasNew && !hasOld) {
    console.log(
      C.red + `Input CSV must include column: "${columnName}" (or legacy: company_linkedin_url)` + C.reset
    );
    console.log(C.gray + `Found headers: ${parsed.headers.join(", ")}` + C.reset);
    process.exit(1);
  }

  const rows = parsed.rows.filter((r) => {
    const v = getRowVal(r, [columnName, "company_linkedin_url"]);
    return String(v || "").trim().length > 0;
  });

  console.log(C.green + `✔ Loaded ${rows.length} rows` + C.reset);
  console.log(C.gray + `Input:  ${inPath}` + C.reset);
  console.log(C.gray + `Output: ${outputDir || "."}` + C.reset);
  console.log(C.gray + `Concurrency: ${concurrency}` + C.reset);
  hr();

  const outRows = [];
  let cursor = 0;

  async function worker(workerId) {
    while (true) {
      const i = cursor++;
      if (i >= rows.length) return;

      const payload = buildPayloadFromRow(rows[i]);
      const label = `${C.cyan}W${workerId}${C.reset}`;

      process.stdout.write(
        `${label} ${C.gray}[${pad(i + 1)}/${pad(rows.length)}]${C.reset} ${payload.company_linkedin_url} ` +
          `${C.gray}(page=${payload.page}, max=${payload.max_results})${C.reset} ... `
      );

      if (!payload.company_linkedin_url) {
        console.log(C.yellow + "SKIP (missing URL)" + C.reset);
        continue;
      }

      try {
        let res = await callEmployeeFinder(payload, apiKey, 1);
        let attempts = 1;

        while (res.ok === "retry") {
          process.stdout.write(`${C.yellow}retry(${res.status})${C.reset} `);
          await sleep(res.backoff);
          attempts++;
          res = await callEmployeeFinder(payload, apiKey, attempts);
        }

        if (res.ok !== true) {
          const msg =
            res?.data?.message ||
            res?.data?.error ||
            (res?.data?._raw ? String(res.data._raw).slice(0, 300) : "Request failed");

          console.log(
            C.red + `FAIL (${res.status})` + C.reset +
              ` ${C.gray}${fmtMs(res.duration_ms)}${C.reset}` +
              (msg ? ` ${C.yellow}${String(msg).slice(0, 120)}${C.reset}` : "")
          );

          outRows.push(flattenErrorRow(i + 1, payload, res.status, msg));
          continue;
        }

        const data = res.data || {};
        const results = Array.isArray(data.results) ? data.results : [];

        console.log(
          (results.length ? C.green + "OK" : C.yellow + "OK (0 results)") +
            C.reset +
            ` ${C.gray}${fmtMs(res.duration_ms)}${C.reset}` +
            ` ${C.gray}(results=${results.length}, total_pages=${data.total_pages ?? "?"})${C.reset}`
        );

        for (const p of results) outRows.push(flattenEmployee(i + 1, payload, data, p));

        if (results.length === 0) {
          outRows.push(flattenNoResultsRow(i + 1, payload, data));
        }
      } catch (e) {
        console.log(C.red + "ERROR" + C.reset);
        outRows.push(flattenErrorRow(i + 1, payload, "", e?.message || String(e)));
      }
    }
  }

  const pool = [];
  for (let w = 1; w <= concurrency; w++) pool.push(worker(w));
  await Promise.all(pool);

  hr();

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

  const okRows = outRows.filter((r) => !String(r["Error Message"] || "").trim()).length;
  const errRows = outRows.filter((r) => String(r["Error Message"] || "").trim()).length;

  console.log(C.green + C.bold + "DONE ✅" + C.reset);
  console.log(C.gray + "Saved: " + C.reset + C.bold + outPath + C.reset);
  console.log(
    C.gray + "Rows: " + C.reset +
      `ok=${C.green}${okRows}${C.reset}, issues=${C.yellow}${errRows}${C.reset}, total=${outRows.length}`
  );
  hr();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
