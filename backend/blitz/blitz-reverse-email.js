/**
 * Blitz Reverse Email -> Person (CSV Output)
 *
 * Inputs:
 *  - single email: node reverse-email-to-person.js --email "antoine@blitz-agency.com"
 *  - csv:          node reverse-email-to-person.js --input "C:\path\file.csv" --column "email"
 *  - txt/note:     node reverse-email-to-person.js --input "C:\path\emails.txt"
 *
 * Node: v18+ (fetch included)
 */

const fs = require("fs");
const path = require("path");

const API_URL = "https://api.blitz-api.ai/v2/enrichment/email-to-person";

/* =========================
 * Output helpers
 * =======================*/
function hasFlag(flag) {
  return process.argv.includes(flag);
}
function getArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  const val = process.argv[idx + 1];
  return val ?? fallback;
}

// By default: NO color (safe for Electron log panes)
// Enable colors only if you pass --color
const USE_COLOR = hasFlag("--color") && process.stdout.isTTY;

const C = USE_COLOR
  ? {
      reset: "\x1b[0m",
      bold: "\x1b[1m",
      red: "\x1b[31m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      blue: "\x1b[34m",
      magenta: "\x1b[35m",
      cyan: "\x1b[36m",
      gray: "\x1b[90m",
    }
  : {
      reset: "",
      bold: "",
      red: "",
      green: "",
      yellow: "",
      blue: "",
      magenta: "",
      cyan: "",
      gray: "",
    };

function fmtMs(ms) {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return "?";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/* =========================
 * Simple, clean UI
 * =======================*/
const UI = {
  line() {
    console.log("─".repeat(64));
  },
  title() {
    console.log("");
    console.log("📧 Reverse Email → Person Lookup");
    this.line();
  },
  section(t) {
    console.log("");
    console.log(`• ${t}`);
    this.line();
  },
  ok(msg) {
    console.log(`✓ ${msg}`);
  },
  info(msg) {
    console.log(`ℹ ${msg}`);
  },
  warn(msg) {
    console.log(`⚠ ${msg}`);
  },
  err(msg) {
    console.log(`✖ ${msg}`);
  },
  worker(workerId, email, i, total) {
    console.log(`👤 Worker ${workerId} → ${email} (${i}/${total})`);
  },
  result(email, ms, found) {
    console.log(`✅ ${email} • ${found ? "FOUND" : "NO MATCH"} • ${fmtMs(ms)}`);
  },
  fail(email, status, ms) {
    console.log(`❌ ${email} • FAIL (${status || "?"}) • ${fmtMs(ms)}`);
  },
  retry(email, status, attempt, backoffMs) {
    console.log(`↻ Retry • ${email} • ${status} • attempt ${attempt} • wait ${fmtMs(backoffMs)}`);
  },
  summary({ total, processed, found, noMatch, failed, outPath }) {
    this.section("Summary");
    this.ok(`Processed: ${processed}/${total}`);
    this.ok(`Found:     ${found}`);
    this.ok(`No match:  ${noMatch}`);
    this.ok(`Failed:    ${failed}`);
    console.log("");
    console.log("Saved CSV:");
    console.log(outPath);
    this.line();
  },
};

/* =========================
 * Config from TOOL_CONFIG or CLI
 * =======================*/
function getConfig() {
  let config = {};
  const raw = process.env.TOOL_CONFIG;
  if (raw) {
    try {
      config = JSON.parse(raw);
    } catch (e) {
      // keep this plain (no color)
      console.error("[ERROR] Failed to parse TOOL_CONFIG:", e.message);
    }
  }

  return {
    apiKey: config.apiKey || process.env.BLITZ_API_KEY || getArg("--apiKey"),
    singleEmail: config.singleEmail || getArg("--email"),
    inputPath: config.inputPath || getArg("--input"),
    columnName: config.columnName || getArg("--column", "email"),
    outputDir: config.outputDir || getArg("--outputDir", "./output"),
    outputFileName: config.outputFileName || getArg("--outputFileName", ""),
    concurrency: parseInt(config.concurrency || getArg("--concurrency", "4"), 10),

    // modes:
    // --json => only structured JSON logs (for machines)
    jsonOnly: Boolean(config.jsonLogs) || hasFlag("--json") || process.env.JSON_LOGS === "1",
    // --verbose => prints extra JSON lines too
    verbose: hasFlag("--verbose") || process.env.VERBOSE === "1",
  };
}

/* =========================
 * Emit Status for Electron
 * =========================
 * (DO NOT CHANGE THIS FORMAT)
 * ======================*/
function emitStatus(phase = "running", extra = {}) {
  const {
    totalEmails = null,
    emailsProcessed = null,
    emailsFound = null,
    emailsNotFound = null,
  } = extra;

  console.log(
    JSON.stringify({
      type: "status",
      status: phase,
      metrics: {
        totalEmails,
        emailsProcessed,
        emailsFound,
        emailsNotFound,
      },
    })
  );
}

/* =========================
 * Structured log (optional)
 * =======================*/
function nowISO() {
  return new Date().toISOString();
}
function slog(enabled, level, msg, meta = {}) {
  if (!enabled) return;
  console.log(JSON.stringify({ ts: nowISO(), level, msg, ...meta }));
}

/* =========================
 * CSV helpers
 * =======================*/
function csvEscape(v) {
  const s = (v ?? "").toString();
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCSV(columns, rows) {
  const lines = [];
  lines.push(columns.map((c) => csvEscape(c.label || c.key)).join(","));
  for (const r of rows) {
    lines.push(columns.map((c) => csvEscape(r[c.key])).join(","));
  }
  return lines.join("\n");
}

/* =========================
 * Input parsing (CSV + TXT)
 * =======================*/
function readFileText(p) {
  return fs.readFileSync(p, "utf8");
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
function extractEmailsFromTxt(text) {
  return text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}
function looksLikeEmail(s) {
  return typeof s === "string" && /.+@.+\..+/.test(s.trim());
}

/* =========================
 * Network + retries
 * =======================*/
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function blitzEmailToPerson(email, apiKey, attempt = 1) {
  const t0 = Date.now();

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
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
      return { ok: "retry", email, status, duration_ms: ms, data, backoff };
    }

    return { ok: false, email, status, duration_ms: ms, data };
  }

  return { ok: true, email, status: res.status, duration_ms: ms, data };
}

/* =========================
 * Flatten response -> row
 * =======================*/
function flattenResult(email, result) {
  const base = {
    email,
    found: "",
    first_name: "",
    last_name: "",
    full_name: "",
    headline: "",
    about_me: "",
    location_city: "",
    location_state_code: "",
    location_country_code: "",
    linkedin_url: "",
    connections_count: "",
    profile_picture_url: "",
    current_job_title: "",
    current_company_linkedin_url: "",
    current_company_linkedin_id: "",
    current_job_start_date: "",
    current_job_end_date: "",
    current_job_is_current: "",
    error_status: "",
    error_message: "",
  };

  if (!result || result.ok === false) {
    base.found = "false";
    base.error_status = String(result?.status ?? "");
    base.error_message =
      result?.data?.message ||
      result?.data?.error ||
      "Request failed / non-OK response";
    return base;
  }

  const data = result.data || {};
  base.found = String(Boolean(data.found));

  const p = data?.person?.person || data?.person || {};

  base.first_name = p.first_name ?? "";
  base.last_name = p.last_name ?? "";
  base.full_name = p.full_name ?? "";
  base.headline = p.headline ?? "";
  base.about_me = p.about_me ?? "";

  const loc = p.location || {};
  base.location_city = loc.city ?? "";
  base.location_state_code = loc.state_code ?? "";
  base.location_country_code = loc.country_code ?? "";

  base.linkedin_url = p.linkedin_url ?? "";
  base.connections_count =
    p.connections_count !== undefined ? String(p.connections_count) : "";
  base.profile_picture_url = p.profile_picture_url ?? "";

  const exp =
    Array.isArray(p.experiences) && p.experiences.length ? p.experiences[0] : null;
  if (exp) {
    base.current_job_title = exp.job_title ?? "";
    base.current_company_linkedin_url = exp.company_linkedin_url ?? "";
    base.current_company_linkedin_id = exp.company_linkedin_id ?? "";
    base.current_job_start_date = exp.job_start_date ?? "";
    base.current_job_end_date = exp.job_end_date ?? "";
    base.current_job_is_current =
      exp.job_is_current !== undefined ? String(exp.job_is_current) : "";
  }

  return base;
}

/* =========================
 * Main
 * =======================*/
async function main() {
  const cfg = getConfig();
  const jsonOnly = cfg.jsonOnly;
  const verbose = cfg.verbose;

  if (!jsonOnly) UI.title();

  const apiKey = cfg.apiKey;
  const singleEmail = cfg.singleEmail;
  const inputPath = cfg.inputPath;
  const columnName = cfg.columnName;
  const concurrency = Math.max(1, Number.isFinite(cfg.concurrency) ? cfg.concurrency : 4);

  const outputDir = cfg.outputDir ? path.resolve(cfg.outputDir) : path.join(process.cwd(), "output");
  const outputFileName = cfg.outputFileName;

  if (!apiKey) {
    console.error('Missing API key. Set BLITZ_API_KEY or pass --apiKey "..."');
    process.exit(1);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  // Collect emails
  let emails = [];

  if (singleEmail) {
    emails = [singleEmail.trim()];
  } else if (inputPath) {
    const ext = path.extname(inputPath).toLowerCase();
    const raw = readFileText(inputPath);

    if (ext === ".csv") {
      const parsed = parseCSV(raw);
      if (!parsed.headers.includes(columnName)) {
        console.error(`CSV missing column "${columnName}". Found: ${parsed.headers.join(", ")}`);
        process.exit(1);
      }
      emails = parsed.rows.map((r) => (r[columnName] || "").trim()).filter(Boolean);
    } else {
      emails = extractEmailsFromTxt(raw);
    }
  } else {
    console.error('Provide either --email "a@b.com" OR --input "file.csv/.txt"');
    process.exit(1);
  }

  // cleanup + dedupe + sanity filter
  emails = Array.from(new Set(emails.map((e) => e.trim()).filter(Boolean)));
  const invalid = emails.filter((e) => !looksLikeEmail(e));
  emails = emails.filter((e) => looksLikeEmail(e));

  if (!jsonOnly) {
    UI.ok(`Loaded ${emails.length} emails • concurrency: ${concurrency}`);
    UI.info(`Output folder: ${outputDir}`);
    if (invalid.length) UI.warn(`Skipping ${invalid.length} invalid-looking emails.`);
    UI.section("Processing");
  }

  slog(verbose || jsonOnly, "info", "starting", {
    total_emails: emails.length,
    concurrency,
    output_dir: outputDir,
  });

  const columns = [
    { key: "email", label: "Email" },
    { key: "found", label: "Found" },
    { key: "first_name", label: "First Name" },
    { key: "last_name", label: "Last Name" },
    { key: "full_name", label: "Full Name" },
    { key: "headline", label: "Headline" },
    { key: "about_me", label: "About Me" },
    { key: "location_city", label: "Location City" },
    { key: "location_state_code", label: "Location State Code" },
    { key: "location_country_code", label: "Location Country Code" },
    { key: "linkedin_url", label: "LinkedIn URL" },
    { key: "connections_count", label: "Connections Count" },
    { key: "profile_picture_url", label: "Profile Picture URL" },
    { key: "current_job_title", label: "Current Job Title" },
    { key: "current_company_linkedin_url", label: "Current Company LinkedIn URL" },
    { key: "current_company_linkedin_id", label: "Current Company LinkedIn ID" },
    { key: "current_job_start_date", label: "Current Job Start Date" },
    { key: "current_job_end_date", label: "Current Job End Date" },
    { key: "current_job_is_current", label: "Current Job Is Current" },
    { key: "error_status", label: "Error Status" },
    { key: "error_message", label: "Error Message" },
  ];

  const results = new Array(emails.length);
  let cursor = 0;

  let processed = 0;
  let foundTrue = 0;
  let failed = 0;

  async function worker(workerId) {
    while (true) {
      const i = cursor++;
      if (i >= emails.length) return;

      const email = emails[i];

      if (!jsonOnly) UI.worker(workerId, email, i + 1, emails.length);

      try {
        let res = await blitzEmailToPerson(email, apiKey, 1);

        let attempts = 1;
        while (res.ok === "retry") {
          if (!jsonOnly) UI.retry(email, res.status, attempts, res.backoff);
          slog(verbose || jsonOnly, "warn", "retrying", {
            workerId,
            email,
            status: res.status,
            attempt: attempts,
            backoff_ms: res.backoff,
          });
          await sleep(res.backoff);
          attempts++;
          res = await blitzEmailToPerson(email, apiKey, attempts);
        }

        results[i] = flattenResult(email, res);

        processed++;

        const ok = res.ok === true;
        const found = results[i].found === "true";

        if (ok) {
          if (found) foundTrue++;
          if (!jsonOnly) UI.result(email, res.duration_ms, found);
        } else {
          failed++;
          if (!jsonOnly) UI.fail(email, res.status, res.duration_ms);
        }

        slog(verbose || jsonOnly, "info", "processed", {
          workerId,
          i: i + 1,
          total: emails.length,
          email,
          ok,
          status: res.status,
          found,
          duration_ms: res.duration_ms,
        });

        // Emit metrics for Electron UI
        emitStatus("running", {
          totalEmails: emails.length,
          emailsProcessed: processed,
          emailsFound: foundTrue,
          emailsNotFound: Math.max(0, processed - foundTrue - failed),
        });
      } catch (e) {
        results[i] = flattenResult(email, {
          ok: false,
          status: "",
          data: { message: e?.message || String(e) },
        });

        processed++;
        failed++;

        if (!jsonOnly) UI.err(`Exception: ${email} • ${e?.message || String(e)}`);
        slog(true, "error", "exception", { workerId, email, error: e?.message || String(e) });
      }
    }
  }

  const pool = [];
  for (let w = 1; w <= concurrency; w++) pool.push(worker(w));
  await Promise.all(pool);

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
  const defaultFileName = `reverse_email_to_person_${stamp}.csv`;
  const fileName = outputFileName || defaultFileName;
  const outPath = path.join(outputDir, fileName);

  fs.writeFileSync(outPath, toCSV(columns, results), "utf8");

  const noMatch = Math.max(0, emails.length - foundTrue - failed);

  if (!jsonOnly) {
    UI.summary({
      total: emails.length,
      processed,
      found: foundTrue,
      noMatch,
      failed,
      outPath,
    });
  }

  slog(verbose || jsonOnly, "info", "done", {
    output_file: outPath,
    total: emails.length,
    found_true: foundTrue,
    failed,
    not_found: noMatch,
  });
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
