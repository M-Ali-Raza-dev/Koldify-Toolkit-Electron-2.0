// blitz-domain-to-linkedin.js
// Blitz: Domain -> Company LinkedIn URL (CSV Output) for Electron + CLI

const fs = require("fs");
const path = require("path");

const API_URL = "https://api.blitz-api.ai/v2/enrichment/domain-to-linkedin";

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
    singleDomain: config.singleDomain || getArg("--domain"),
    inputPath: config.inputPath || getArg("--input"),
    columnName: config.columnName || getArg("--column", "domain"),
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

// Accepts "blitz-agency.com" or "https://blitz-agency.com"
function normalizeDomain(input) {
  if (!input) return "";
  let s = input.trim();
  if (!s) return "";

  // if it's a URL, parse it
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      return u.hostname; // keep just host
    } catch {
      // fall through
    }
  }

  // remove path if user pasted without scheme
  s = s.replace(/\/.*$/, "");
  // remove trailing slash
  s = s.replace(/\/$/, "");
  // remove leading www.
  s = s.replace(/^www\./i, "");
  return s;
}

function looksLikeDomainish(s) {
  const d = normalizeDomain(s);
  return d.includes(".") && !d.includes(" ");
}

function emitStatus(phase = "running", extra = {}) {
  const { totalDomains = null, domainsProcessed = null, urlsFound = null, urlsNotFound = null } = extra;

  console.log(
    JSON.stringify({
      type: "status",
      status: phase,
      metrics: {
        totalDomains,
        domainsProcessed,
        urlsFound,
        urlsNotFound,
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

async function blitzDomainToLinkedin(domainInput, apiKey, attempt = 1) {
  const t0 = Date.now();

  // API expects "domain" - send original if it's a URL, else send normalized domain
  const payloadDomain = /^https?:\/\//i.test(domainInput)
    ? domainInput.trim()
    : normalizeDomain(domainInput);

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ domain: payloadDomain }),
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

function flattenRow(raw_domain, result) {
  const row = {
    input_domain: raw_domain,
    normalized_domain: normalizeDomain(raw_domain),
    found: "",
    company_linkedin_url: "",
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
  row.company_linkedin_url = data.company_linkedin_url ?? "";

  return row;
}

async function main() {
  const config = getConfig();
  const { apiKey, singleDomain, inputPath, columnName, outputDir, outputFileName, concurrency } = config;

  if (!apiKey) {
    console.error("Missing API key. Set BLITZ_API_KEY or pass --apiKey.");
    process.exit(1);
  }

  let domains = [];

  if (singleDomain) {
    domains = [singleDomain.trim()];
  } else if (inputPath) {
    const ext = path.extname(inputPath).toLowerCase();
    const raw = fs.readFileSync(inputPath, "utf8");

    if (ext === ".csv") {
      const parsed = parseCSV(raw);
      if (!parsed.headers.includes(columnName)) {
        console.error(`CSV missing column "${columnName}". Found: ${parsed.headers.join(", ")}`);
        process.exit(1);
      }
      domains = parsed.rows.map((r) => (r[columnName] || "").trim()).filter(Boolean);
    } else {
      domains = extractLines(raw);
    }
  } else {
    console.error('Provide either --domain "blitz-agency.com" OR --input "file.csv/.txt"');
    process.exit(1);
  }

  // clean + dedupe + validate
  domains = Array.from(new Set(domains.map((d) => d.trim()).filter(Boolean)));
  const invalid = domains.filter((d) => !looksLikeDomainish(d));
  domains = domains.filter((d) => looksLikeDomainish(d));

  if (invalid.length) {
    console.log(`Skipping ${invalid.length} invalid-looking domains (kept ${domains.length}).`);
  }

  if (!domains.length) {
    console.error("No valid domains to process.");
    process.exit(1);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const headers = [
    "input_domain",
    "normalized_domain",
    "found",
    "company_linkedin_url",
    "error_status",
    "error_message",
  ];

  const results = new Array(domains.length);
  let cursor = 0;

  let processed = 0;
  let foundTrue = 0;
  let failed = 0;

  console.log(`Starting run • ${domains.length} domains • concurrency ${concurrency}`);
  console.log(`Output dir: ${path.resolve(outputDir)}`);

  async function worker(workerId) {
    while (true) {
      const i = cursor++;
      if (i >= domains.length) return;

      const d = domains[i];

      try {
        let res = await blitzDomainToLinkedin(d, apiKey, 1);

        let attempts = 1;
        while (res.ok === "retry") {
          console.log(`Worker ${workerId} retry (${res.status}) • ${d}`);
          await sleep(res.backoff);
          attempts++;
          res = await blitzDomainToLinkedin(d, apiKey, attempts);
        }

        results[i] = flattenRow(d, res);

        processed++;

        const ok = res.ok === true;
        const found = results[i].found === "true";

        if (ok) {
          if (found) foundTrue++;
          console.log(`Worker ${workerId} • ${d} • ${found ? "FOUND" : "NO MATCH"} • ${fmtMs(res.duration_ms)}`);
        } else {
          failed++;
          console.log(`Worker ${workerId} • ${d} • FAIL (${res.status || "?"}) • ${fmtMs(res.duration_ms)}`);
        }

        emitStatus("running", {
          totalDomains: domains.length,
          domainsProcessed: processed,
          urlsFound: foundTrue,
          urlsNotFound: Math.max(0, processed - foundTrue - failed),
        });
      } catch (e) {
        results[i] = flattenRow(d, {
          ok: false,
          status: "",
          data: { message: e?.message || String(e) },
        });

        processed++;
        failed++;

        console.error(`Error processing ${d}: ${e?.message || e}`);
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
    : `domain_to_linkedin_${stamp}.csv`;
  const outPath = path.join(outputDir, outFile);

  fs.writeFileSync(outPath, toCSV(headers, results), "utf8");

  const urlsFound = foundTrue;
  const urlsNotFound = Math.max(0, processed - foundTrue - failed);

  console.log(`DONE ✓ Saved: ${outPath}`);
  console.log(`Summary: total=${domains.length}, processed=${processed}, found=${urlsFound}, not_found=${urlsNotFound}, failed=${failed}`);

  emitStatus("done", {
    totalDomains: domains.length,
    domainsProcessed: processed,
    urlsFound,
    urlsNotFound,
  });
}

main().catch((e) => {
  console.error("Fatal:", e);
  emitStatus("error", {});
  process.exit(1);
});
