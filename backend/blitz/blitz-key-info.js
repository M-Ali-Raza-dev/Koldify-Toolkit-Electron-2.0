/**
 * Blitz: API Key Details (key-info) — Pretty, clean, no ANSI (Electron-safe)
 *
 * Usage (PowerShell):
 *   $env:BLITZ_API_KEY="YOUR_KEY"
 *   node blitz-key-info.js
 *
 * Or:
 *   node blitz-key-info.js --apiKey "YOUR_KEY"
 *
 * Optional:
 *   node blitz-key-info.js --json     // machine readable only
 *
 * Node v18+
 */

const API_URL = "https://api.blitz-api.ai/v2/account/key-info";

/* =========================
 * CLI
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

/* =========================
 * Formatting helpers
 * =======================*/
const jsonOnly = hasFlag("--json");

function hr(char = "─", width = 70) {
  if (jsonOnly) return;
  console.log(char.repeat(width));
}

function center(text, width = 70) {
  if (text.length >= width) return text;
  const pad = Math.floor((width - text.length) / 2);
  return " ".repeat(pad) + text;
}

function boxTitle(title, subtitle = "") {
  if (jsonOnly) return;
  console.log("");
  console.log(center("Blitz API Key Details", 70));
  if (subtitle) console.log(center(subtitle, 70));
  hr();
}

function line(label, value, pad = 26) {
  if (jsonOnly) return;
  const L = (label + ":").padEnd(pad, " ");
  console.log(`${L}${value}`);
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

function fmtNum(n) {
  if (n === null || n === undefined || n === "") return "-";
  if (typeof n === "number") return Number.isInteger(n) ? String(n) : String(n.toFixed(2));
  return String(n);
}

function maskKey(key) {
  if (!key) return "";
  const k = String(key);
  if (k.length <= 10) return "***";
  return k.slice(0, 10) + "…" + k.slice(-6);
}

function badge(text) {
  // Plain-text "badge" that still looks nice
  return `[ ${String(text).toUpperCase()} ]`;
}

function printTable(rows, col1 = 34) {
  if (jsonOnly) return;
  for (const [a, b] of rows) {
    console.log(String(a).padEnd(col1, " ") + String(b));
  }
}

/* =========================
 * Grouping helpers
 * =======================*/
function groupApis(list) {
  const groups = {
    Search: [],
    Enrichment: [],
    Utilities: [],
    Account: [],
    Other: [],
  };

  for (const api of list || []) {
    const s = String(api);
    if (s.startsWith("/search/")) groups.Search.push(s);
    else if (s.startsWith("/enrichment/")) groups.Enrichment.push(s);
    else if (s.startsWith("/utilities/")) groups.Utilities.push(s);
    else if (s.startsWith("/account/")) groups.Account.push(s);
    else groups.Other.push(s);
  }

  // Sort each group alphabetically
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.localeCompare(b));
  return groups;
}

function printApiGroups(allowed) {
  if (jsonOnly) return;

  const groups = groupApis(allowed);
  const total = (allowed || []).length;

  console.log("");
  console.log("Allowed APIs " + badge(`${total}`));
  hr();

  const order = ["Search", "Enrichment", "Utilities", "Account", "Other"];
  for (const name of order) {
    const items = groups[name];
    if (!items || items.length === 0) continue;

    console.log(`• ${name} (${items.length})`);
    for (const a of items) console.log(`  - ${a}`);
    console.log("");
  }
  hr();
}

function printPlans(plans) {
  if (jsonOnly) return;

  console.log("");
  console.log("Active Plans");
  hr();

  if (!Array.isArray(plans) || plans.length === 0) {
    console.log("  (none)");
    hr();
    return;
  }

  for (const p of plans) {
    const name = p?.name ?? "Unknown";
    const status = p?.status ?? "-";
    const started = fmtDate(p?.started_at);

    // compact, clean single-line
    console.log(`• ${badge(status)} ${name}  |  started: ${started}`);
  }

  hr();
}

/* =========================
 * Request
 * =======================*/
async function fetchKeyInfo(apiKey) {
  const t0 = Date.now();
  const res = await fetch(API_URL, {
    method: "GET",
    headers: { "x-api-key": apiKey },
  });
  const ms = Date.now() - t0;

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text };
  }

  return { ok: res.ok, status: res.status, ms, data };
}

/* =========================
 * Main
 * =======================*/
async function main() {
  const apiKey = process.env.BLITZ_API_KEY || getArg("--apiKey");

  if (!apiKey) {
    if (jsonOnly) {
      console.log(JSON.stringify({ ok: false, error: "Missing API key. Set BLITZ_API_KEY or pass --apiKey." }));
    } else {
      boxTitle("", "Account → key-info");
      console.log(badge("MISSING API KEY") + " Set BLITZ_API_KEY or pass --apiKey");
      console.log("");
      console.log("PowerShell:");
      console.log('  $env:BLITZ_API_KEY="YOUR_KEY"');
      console.log("  node blitz-key-info.js");
      hr();
    }
    process.exit(1);
  }

  if (!jsonOnly) {
    boxTitle("", "Account → key-info");
    line("Using API key", maskKey(apiKey));
    hr();
  }

  const r = await fetchKeyInfo(apiKey);

  if (!r.ok) {
    if (jsonOnly) {
      console.log(JSON.stringify({ ok: false, status: r.status, ms: r.ms, data: r.data }, null, 2));
    } else {
      console.log(badge(`REQUEST FAILED (${r.status})`));
      console.log("");
      console.log("Response preview:");
      console.log(String(r.data?._raw ?? JSON.stringify(r.data)).slice(0, 900));
      hr();
    }
    process.exit(1);
  }

  const d = r.data || {};
  const valid = Boolean(d.valid);

  if (jsonOnly) {
    console.log(JSON.stringify({ ok: true, ms: r.ms, data: d }, null, 2));
    return;
  }

  console.log(badge(valid ? "VALID KEY" : "INVALID KEY"));
  console.log(`Fetched in ${r.ms}ms`);
  hr();

  // Summary card (compact + aligned)
  console.log("");
  console.log("Key Summary");
  hr();

  const rows = [
    ["Key ID", fmtNum(d.id)],
    ["Remaining credits", fmtNum(d.remaining_credits)],
    ["Next reset at", fmtDate(d.next_reset_at)],
    ["Max req/sec", fmtNum(d.max_requests_per_seconds)],
  ];
  printTable(rows, 26);
  hr();

  printApiGroups(d.allowed_apis);
  printPlans(d.active_plans);

  console.log("");
  console.log("Tip: Rotate keys if you ever pasted them in chat, repos, or screenshots.");
  hr();
}

main().catch((e) => {
  if (jsonOnly) {
    console.log(JSON.stringify({ ok: false, error: e?.message || String(e) }));
  } else {
    console.error("Fatal:", e);
  }
  process.exit(1);
});
