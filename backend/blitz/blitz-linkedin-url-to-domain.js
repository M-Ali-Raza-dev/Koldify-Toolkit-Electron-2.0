// blitz-linkedin-url-to-domain.js
// Blitz: Company LinkedIn URL -> Email Domain (CSV Output) for Electron + CLI

const fs = require("fs");
const path = require("path");

const API_URL = "https://api.blitz-api.ai/v2/enrichment/linkedin-to-domain";

// Ensure packaged apps can resolve dependencies
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, "../../");
if (module.paths && !module.paths.includes(path.join(appRoot, "node_modules"))) {
  module.paths.unshift(path.join(appRoot, "node_modules"));
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  const val = process.argv[idx + 1];
  return val ?? fallback;
}

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
    singleCompany: config.singleCompany || getArg("--company"),
    inputPath: config.inputPath || getArg("--input"),
    columnName: config.columnName || getArg("--column", "company_linkedin_url"),
    outputDir: config.outputDir || getArg("--output-dir", "./output"),
    outputFileName: config.outputFileName || getArg("--output-file", ""),
    concurrency: parseInt(config.concurrency || getArg("--concurrency", "6"), 10),
    jsonLogs: Boolean(config.jsonLogs) || hasFlag("--json") || process.env.JSON_LOGS === "1",
  };
}

function nowISO() {
  return new Date().toISOString();
}

function fmtMs(ms) {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return "?";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function looksLikeCompanyLinkedInUrl(s) {
  if (!s) return false;
  const v = s.trim().toLowerCase();
  return v.includes("linkedin.com/company/");
}

function emitStatus(phase = "running", extra = {}) {
  const { totalUrls = null, urlsProcessed = null, domainsFound = null, domainsNotFound = null } = extra;

  console.log(
    JSON.stringify({
      type: "status",
      status: phase,
      metrics: {
        totalUrls,
        urlsProcessed,
        domainsFound,
        domainsNotFound,
      },
    })
  );
}

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

function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        cur += "\"";
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

function extractLines(text) {
  return text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

async function blitzLinkedinToDomain(company_linkedin_url, apiKey, attempt = 1) {
  const t0 = Date.now();

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ company_linkedin_url }),
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

function flattenRow(company_linkedin_url, result) {
  const row = {
    company_linkedin_url,
    found: "",
    email_domain: "",
    error_status: "",
    error_message: "",
  };

  if (!result || result.ok === false) {
    row.found = "false";
    row.error_status = String(result?.status ?? "");
    row.error_message = result?.data?.message || result?.data?.error || "Request failed";
    return row;
  }

  const data = result.data || {};
  row.found = String(Boolean(data.found));
  row.email_domain = data.email_domain ?? "";

  return row;
}

async function main() {
  const config = getConfig();
  const { apiKey, singleCompany, inputPath, columnName, outputDir, outputFileName, concurrency } = config;

  if (!apiKey) {
    console.error("Missing API key. Set BLITZ_API_KEY or pass --apiKey.");
    process.exit(1);
  }

  let urls = [];

  if (singleCompany) {
    urls = [singleCompany.trim()];
  } else if (inputPath) {
    const ext = path.extname(inputPath).toLowerCase();
    const raw = fs.readFileSync(inputPath, "utf8");

    if (ext === ".csv") {
      const parsed = parseCSV(raw);
      if (!parsed.headers.includes(columnName)) {
        console.error(`CSV missing column "${columnName}". Found: ${parsed.headers.join(", ")}`);
        process.exit(1);
      }
      urls = parsed.rows.map((r) => (r[columnName] || "").trim()).filter(Boolean);
    } else {
      urls = extractLines(raw);
    }
  } else {
    console.error('Provide either --company "https://..." OR --input "file.csv/.txt"');
    process.exit(1);
  }

  // clean + dedupe + validate
  urls = Array.from(new Set(urls.map((u) => u.trim()).filter(Boolean)));
  const invalid = urls.filter((u) => !looksLikeCompanyLinkedInUrl(u));
  urls = urls.filter((u) => looksLikeCompanyLinkedInUrl(u));

  if (invalid.length) {
    console.log(`Skipping ${invalid.length} invalid-looking company LinkedIn URLs (kept ${urls.length}).`);
  }

  if (!urls.length) {
    console.error("No valid company LinkedIn URLs to process.");
    process.exit(1);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const headers = [
    "company_linkedin_url",
    "found",
    "email_domain",
    "error_status",
    "error_message",
  ];

  const results = new Array(urls.length);
  let cursor = 0;

  let processed = 0;
  let foundTrue = 0;
  let failed = 0;

  console.log(`Starting run • ${urls.length} company URLs • concurrency ${concurrency}`);
  console.log(`Output dir: ${path.resolve(outputDir)}`);

  async function worker(workerId) {
    while (true) {
      const i = cursor++;
      if (i >= urls.length) return;

      const company_linkedin_url = urls[i];

      try {
        let res = await blitzLinkedinToDomain(company_linkedin_url, apiKey, 1);

        let attempts = 1;
        while (res.ok === "retry") {
          console.log(`Worker ${workerId} retry (${res.status}) • ${company_linkedin_url}`);
          await sleep(res.backoff);
          attempts++;
          res = await blitzLinkedinToDomain(company_linkedin_url, apiKey, attempts);
        }

        results[i] = flattenRow(company_linkedin_url, res);

        processed++;

        const ok = res.ok === true;
        const found = results[i].found === "true";

        if (ok) {
          if (found) foundTrue++;
          console.log(`Worker ${workerId} • ${company_linkedin_url} • ${found ? "FOUND" : "NO MATCH"} • ${fmtMs(res.duration_ms)}`);
        } else {
          failed++;
          console.log(`Worker ${workerId} • ${company_linkedin_url} • FAIL (${res.status || "?"}) • ${fmtMs(res.duration_ms)}`);
        }

        emitStatus("running", {
          totalUrls: urls.length,
          urlsProcessed: processed,
          domainsFound: foundTrue,
          domainsNotFound: Math.max(0, processed - foundTrue - failed),
        });
      } catch (e) {
        results[i] = flattenRow(company_linkedin_url, {
          ok: false,
          status: "",
          data: { message: e?.message || String(e) },
        });

        processed++;
        failed++;

        console.error(`Error processing ${company_linkedin_url}: ${e?.message || e}`);
      }
    }
  }

  const pool = [];
  const workers = Math.max(1, Math.min(concurrency || 1, 25));
  for (let w = 1; w <= workers; w++) pool.push(worker(w));
  await Promise.all(pool);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
  const outFile = outputFileName && outputFileName.trim().length > 0
    ? outputFileName.trim()
    : `linkedin_url_to_domain_${stamp}.csv`;
  const outPath = path.join(outputDir, outFile);

  fs.writeFileSync(outPath, toCSV(headers, results), "utf8");

  const domainsFound = foundTrue;
  const domainsNotFound = Math.max(0, processed - foundTrue - failed);

  console.log(`DONE ✓ Saved: ${outPath}`);
  console.log(`Summary: total=${urls.length}, processed=${processed}, found=${domainsFound}, not_found=${domainsNotFound}, failed=${failed}`);

  emitStatus("done", {
    totalUrls: urls.length,
    urlsProcessed: processed,
    domainsFound,
    domainsNotFound,
  });
}

main().catch((e) => {
  console.error("Fatal:", e);
  emitStatus("error", {});
  process.exit(1);
});
