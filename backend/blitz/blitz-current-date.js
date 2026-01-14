/**
 * Blitz Current Date/Time (region -> console) — Pretty (NO ANSI, Electron-safe)
 *
 * Usage:
 *   PowerShell:
 *     $env:BLITZ_API_KEY="YOUR_KEY"
 *     node blitz-current-date.js --region "America/New_York"
 *
 *   Or:
 *     node blitz-current-date.js --apiKey "YOUR_KEY" --region "Asia/Karachi"
 *
 * Optional:
 *   --json   => JSON output only (good for Electron parsing)
 *
 * Node v18+
 */

const API_URL = "https://api.blitz-api.ai/v2/utilities/current-date";

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

/* =========================
 * Pretty Console (NO ANSI)
 * =======================*/
const UI = {
  width: 72,
  line(char = "─") {
    if (JSON_ONLY) return;
    console.log(char.repeat(this.width));
  },
  title() {
    if (JSON_ONLY) return;
    console.log("");
    console.log("🕒 Blitz Current Date & Time");
    console.log("   utilities/current-date");
    this.line();
  },
  row(label, value) {
    if (JSON_ONLY) return;
    const L = (label + ":").padEnd(16, " ");
    console.log(`${L}${value}`);
  },
  ok(msg) {
    if (JSON_ONLY) return;
    console.log("✅ " + msg);
  },
  warn(msg) {
    if (JSON_ONLY) return;
    console.log("⚠ " + msg);
  },
  err(msg) {
    if (JSON_ONLY) return;
    console.log("❌ " + msg);
  },
  hint(msg) {
    if (JSON_ONLY) return;
    console.log("💡 " + msg);
  },
};

function maskKey(key) {
  if (!key) return "";
  const k = String(key);
  if (k.length <= 10) return "***";
  return k.slice(0, 10) + "…" + k.slice(-6);
}

function fmtMs(ms) {
  if (ms == null || Number.isNaN(ms)) return "?";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function jlog(level, msg, meta = {}) {
  if (!JSON_ONLY) return;
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta }, null, 2));
}

/* =========================
 * Network
 * =======================*/
async function callCurrentDate({ apiKey, region }) {
  const t0 = Date.now();

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ region }),
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
  const apiKey = process.env.BLITZ_API_KEY || getArg("--apiKey") || fromEnv("apiKey", "");
  const region = getArg("--region", fromEnv("region", "America/New_York")) || "America/New_York";

  if (!apiKey) {
    if (JSON_ONLY) {
      jlog("error", "missing_api_key", {
        hint: "Set BLITZ_API_KEY or pass --apiKey",
        example_powershell: '$env:BLITZ_API_KEY="YOUR_KEY"; node blitz-current-date.js --region "Asia/Karachi"',
      });
    } else {
      UI.title();
      UI.err("Missing API key.");
      UI.warn("Set BLITZ_API_KEY or pass --apiKey");
      UI.line();
      console.log('PowerShell:  $env:BLITZ_API_KEY="YOUR_KEY"');
      console.log('Run:        node blitz-current-date.js --region "Asia/Karachi"');
      UI.line();
    }
    process.exit(1);
  }

  if (!JSON_ONLY) {
    UI.title();
    UI.row("API key", maskKey(apiKey));
    UI.row("Region", region);
    UI.line();
  }

  const r = await callCurrentDate({ apiKey, region });

  if (!r.ok) {
    const msg =
      r.data?.message ||
      r.data?.error ||
      (r.data?._raw ? String(r.data._raw).slice(0, 500) : "Request failed");

    if (JSON_ONLY) {
      jlog("error", "request_failed", { status: r.status, ms: r.ms, region, message: msg });
    } else {
      UI.err(`Request failed (${r.status})`);
      UI.warn(String(msg));
      UI.line();
    }
    process.exit(1);
  }

  const d = r.data || {};

  if (JSON_ONLY) {
    jlog("info", "ok", {
      ms: r.ms,
      region,
      datetime: d.datetime ?? null,
      timestamp: d.timestamp ?? null,
      timezone: d.timezone ?? null,
      timezone_name: d.timezone_name ?? null,
      raw: d,
    });
    return;
  }

  UI.ok(`OK • fetched in ${fmtMs(r.ms)}`);
  UI.line();

  // nice "card"
  UI.row("Datetime", d.datetime ?? "-");
  UI.row("Timestamp", d.timestamp ?? "-");
  UI.row("Timezone", d.timezone ?? "-");
  UI.row("TZ name", d.timezone_name ?? "-");

  UI.line();
  UI.hint('Try: --region "Asia/Karachi", "Europe/London", "America/New_York"');
}

main().catch((e) => {
  if (JSON_ONLY) {
    jlog("error", "fatal", { error: e?.message || String(e) });
  } else {
    UI.err("Fatal error:");
    console.error(e);
  }
  process.exit(1);
});
