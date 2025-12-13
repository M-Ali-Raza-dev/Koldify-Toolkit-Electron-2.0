// backend/email-extractor-main.js
// LinkedIn URLs Email Extractor core logic (Electron-friendly)
// - Reads input CSVs with linkedin url column
// - Calls Apify actor per CSV using rotating API keys
// - Writes per-key + global *_fixed.csv outputs
// - Tracks key usage in used_keys.json
// - Uses TOOL_CONFIG (from Electron) + CLI args for configuration
// - Supports clean logs + live metrics via status() and stdout

// Script initialization

let path, fs, fg, parse, stringify, ApifyClient;

try {
  path = require("path");
  fs = require("fs");

  // Load modules from app root
  const appRoot = process.env.APP_ROOT || path.resolve(__dirname, '../../');
  
  if (module.paths && !module.paths.includes(path.join(appRoot, 'node_modules'))) {
    module.paths.unshift(path.join(appRoot, 'node_modules'));
  }
  
  fg = require("fast-glob");
  parse = require("csv-parse/sync").parse;
  stringify = require("csv-stringify/sync").stringify;
  ApifyClient = require("apify-client").ApifyClient;
} catch (err) {
  console.error("[FATAL] Module loading failed:", err.message);
  process.exit(1);
}

let cancelRequested = false;

// ========= Soft stop via STOP_FLAG_FILE (from Electron main) =========
const STOP_FLAG_FILE = process.env.STOP_FLAG_FILE || null;
function shouldStop() {
  return cancelRequested || (STOP_FLAG_FILE && fs.existsSync(STOP_FLAG_FILE));
}

// ========= Logging hooks (can be overridden by Electron) =========
function defaultLog(line) {
  process.stdout.write(line + "\n");
}
function defaultStatus(_s) {}

function getHooks(hooks = {}) {
  return {
    log: hooks.log || defaultLog,
    status: hooks.status || defaultStatus,
  };
}

// ========= GRACEFUL STOP VIA SIGNALS (for hard kill) =========
function handleStopSignal(signal) {
  defaultLog(`[STOP] Received ${signal}. Stopping after current tasks complete...`);
  cancelRequested = true;
}

process.on("SIGTERM", handleStopSignal);
process.on("SIGINT", handleStopSignal);

// ========= CLI + TOOL_CONFIG helpers =========
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

// ========= Small helpers =========
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readCsv(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return parse(content, { columns: true, skip_empty_lines: true });
}

function findKeyInsensitive(obj, wantLower) {
  return Object.keys(obj || {}).find(
    (k) => k.toLowerCase().trim() === wantLower
  );
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = (v ?? "").toString().trim();
    if (s) return s;
  }
  return "";
}

function pick(obj, pathStr) {
  const parts = pathStr.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) cur = cur[p];
    else return "";
  }
  return (cur ?? "").toString();
}

function safeFileName(s) {
  return String(s)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// used_keys.json beside keys.json
function loadUsedKeys(usedPath) {
  if (!fs.existsSync(usedPath)) return [];
  try {
    const a = JSON.parse(fs.readFileSync(usedPath, "utf8"));
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
function saveUsedKeys(usedPath, list) {
  fs.writeFileSync(usedPath, JSON.stringify(list, null, 2), "utf8");
}

// Build token state from keys.json + extra tokens
function buildTokenState(keysJsonPath, extraTokens, quotaPerKey) {
  const usedPath = path.join(path.dirname(keysJsonPath), "used_keys.json");
  const used = loadUsedKeys(usedPath);
  const usedMap = new Map(used.map((x) => [x.token, x.remaining]));

  let jsonKeys = [];
  if (fs.existsSync(keysJsonPath)) {
    try {
      const arr = JSON.parse(fs.readFileSync(keysJsonPath, "utf8"));
      if (Array.isArray(arr))
        jsonKeys = arr.map((s) => String(s).trim()).filter(Boolean);
    } catch {}
  }

  const extras = String(extraTokens || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const combined = [...jsonKeys, ...extras].filter(
    (v, i, a) => a.indexOf(v) === i
  );

  if (combined.length === 0 && used.length === 0) {
    throw new Error("No API keys found. Provide keys.json or extra tokens.");
  }

  const partials = used.filter((x) => x.remaining > 0);
  for (const t of combined) {
    if (
      usedMap.has(t) &&
      usedMap.get(t) > 0 &&
      !partials.find((x) => x.token === t)
    ) {
      partials.push({ token: t, remaining: usedMap.get(t) });
    }
  }

  const fresh = combined
    .filter((t) => !usedMap.has(t))
    .map((t) => ({ token: t, remaining: quotaPerKey }));

  partials.sort((a, b) => b.remaining - a.remaining);

  const exhausted = new Set(
    used.filter((x) => x.remaining === 0).map((x) => x.token)
  );
  const list = [...partials, ...fresh].filter((t) => !exhausted.has(t.token));
  if (!list.length) throw new Error("All keys are exhausted (remaining=0).");

  return { list, usedPath };
}

function updateUsedKeys(usedPath, tokenStates) {
  const existing = loadUsedKeys(usedPath);
  const map = new Map(existing.map((x) => [x.token, x.remaining]));
  for (const t of tokenStates) map.set(t.token, t.remaining);
  const merged = [...map.entries()].map(([token, remaining]) => ({
    token,
    remaining,
  }));
  saveUsedKeys(usedPath, merged);
}

// classify auth/blocked errors so we fail over to next key
function isAuthOrBlockedError(msg) {
  const s = (msg || "").toString().toLowerCase();
  return (
    s.includes("authentication") ||
    (s.includes("auth") && (s.includes("invalid") || s.includes("token"))) ||
    s.includes("user was not found") ||
    s.includes("forbidden") ||
    s.includes("blocked") ||
    s.includes("401") ||
    s.includes("403")
  );
}

// Call Apify actor with retries for 429/5xx
async function fetchApify({ token, usernames, actorId, label, log }) {
  const client = new ApifyClient({ token });
  let attempt = 0;
  let inFlight = false;
  
  while (true) {
    attempt++;
    try {
      // Mark as in-flight once we start the request
      inFlight = true;
      
      // Suppress console output from Apify during the call
      const originalLog = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;
      
      console.log = () => {};
      console.error = () => {};
      console.warn = () => {};
      
      try {
        const run = await client.actor(actorId).call({
          usernames,
          includeEmail: true,
        });
        const { items } = await client
          .dataset(run.defaultDatasetId)
          .listItems({ clean: true, limit: 100000 });
        
        inFlight = false;
        return items;
      } finally {
        // Restore console methods
        console.log = originalLog;
        console.error = originalError;
        console.warn = originalWarn;
      }
    } catch (err) {
      inFlight = false;
      const msg = err?.message || String(err);
      if (attempt <= 5 && /429|rate|timeout|5\d\d/i.test(msg)) {
        const delay = 2000 * attempt;
        log(`[RETRY] ${label} → #${attempt} after ${delay}ms (${msg})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

function extractUsernames(rows) {
  if (!rows.length) return [];
  const key = findKeyInsensitive(rows[0], "linkedin url");
  const set = new Set();
  for (const r of rows) {
    const v = (key ? r[key] : "").toString().trim();
    if (v) set.add(v);
  }
  return Array.from(set);
}

function buildInputLookup(rows) {
  if (!rows.length) return new Map();
  const lkLinkedin = findKeyInsensitive(rows[0], "linkedin url");
  const lkPost = findKeyInsensitive(rows[0], "post url");
  const lkAuthor = findKeyInsensitive(rows[0], "author name");
  const map = new Map();
  for (const r of rows) {
    const url = (lkLinkedin ? r[lkLinkedin] : "").toString().trim();
    if (!url) continue;
    map.set(url, {
      author: (lkAuthor ? r[lkAuthor] : "").toString().trim(),
      postUrl: (lkPost ? r[lkPost] : "").toString().trim(),
    });
  }
  return map;
}

function mapItem(item, lookup) {
  const profileUrl =
    firstNonEmpty(
      item.profileUrl,
      item.url,
      pick(item, "basic_info.profile_url")
    ) || "";

  const fromInput =
    lookup.get(profileUrl) ||
    lookup.get(profileUrl?.replace(/^https:/, "http:")) ||
    lookup.get(profileUrl?.replace(/^http:/, "https:")) ||
    undefined;

  return {
    "First Name": firstNonEmpty(
      pick(item, "basic_info.first_name"),
      pick(item, "first_name"),
      pick(item, "firstName")
    ),
    "Last Name": firstNonEmpty(
      pick(item, "basic_info.last_name"),
      pick(item, "last_name"),
      pick(item, "lastName")
    ),
    Company: firstNonEmpty(
      pick(item, "basic_info.current_company"),
      pick(item, "current_company"),
      pick(item, "company")
    ),
    "Company LinkedIn": firstNonEmpty(
      pick(item, "basic_info.current_company_url"),
      pick(item, "current_company_url"),
      pick(item, "company_linkedin_url")
    ),
    "Job Title": firstNonEmpty(
      pick(item, "basic_info.headline"),
      pick(item, "headline"),
      pick(item, "title"),
      pick(item, "currentTitle")
    ),
    Email: firstNonEmpty(
      pick(item, "basic_info.email"),
      pick(item, "email"),
      (Array.isArray(item.emails) && item.emails[0]) || ""
    ),
    "Profile URL": profileUrl,
    Author: fromInput?.author || "",
    "post linkedin url": fromInput?.postUrl || "",
  };
}

// ========= MAIN RUNNER =========

/**
 * cfg:
 *   inDir           → input folder with CSVs
 *   outDir          → output root folder
 *   keysPath        → path to keys.json
 *   extraTokens     → comma-separated tokens
 *   actorId         → Apify actor ID
 *   csvSize         → expected rows per CSV (for quota math)
 *   csvsPerKey      → how many CSVs per key
 *   concurrency     → workers
 *
 * hooks (optional):
 *   log(line)       → logging
 *   status(str)     → status updates
 */
async function startRunInternal(cfg, hooks) {
  const { log, status } = getHooks(hooks);

  cancelRequested = false;
  status("Running...");

  const {
    inDir,
    outDir,
    keysPath,
    extraTokens,
    actorId,
    csvSize,
    csvsPerKey,
    concurrency,
  } = cfg;

  if (!actorId) {
    throw new Error("Apify actorId is required.");
  }

  if (!inDir || !fs.existsSync(inDir))
    throw new Error("Input folder not found.");
  if (!outDir) throw new Error("Output folder not selected.");
  if (!keysPath || !fs.existsSync(keysPath))
    throw new Error("keys.json not found.");

  ensureDir(outDir);
  const EMAIL_BASE = path.join(outDir, "email");
  const GLOBAL = path.join(outDir, "csvs");
  ensureDir(EMAIL_BASE);
  ensureDir(GLOBAL);

  const QUOTA_PER_KEY =
    (parseInt(csvSize, 10) || 100) * (parseInt(csvsPerKey, 10) || 10);

  const { list: tokenStates, usedPath } = buildTokenState(
    keysPath,
    extraTokens,
    QUOTA_PER_KEY
  );
  updateUsedKeys(usedPath, tokenStates);

  const totalQuota = tokenStates.reduce((acc, t) => acc + t.remaining, 0);
  log(`[RUN] Starting Email Extraction | Keys: ${tokenStates.length} | Total quota: ${totalQuota}`);

  // Initial status for UI
  status(
    JSON.stringify({
      type: 'status',
      status: "init",
      metrics: {
        filesProcessed: 0,
        remainingQuota: totalQuota,
        errors: 0,
        activeKey: null,
        apiKeysLoaded: tokenStates.length,
      }
    })
  );

  // Build file list: all CSVs under inDir
  const pattern = path.join(inDir, "**/*.csv").replace(/\\/g, "/");
  const files = await fg(pattern, { onlyFiles: true });

  if (!files.length) {
    log("[INFO] No CSVs found.");
    status(
      JSON.stringify({
        type: 'status',
        status: "done",
        metrics: {
          filesProcessed: 0,
          remainingQuota: totalQuota,
          errors: 0,
          activeKey: null,
          apiKeysLoaded: tokenStates.length,
        }
      })
    );
    return;
  }
  log(`[INFO] Processing ${files.length} CSV file(s)...`);

  let processedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  function emitProgress(activeKeyToken) {
    const remainingQuota = tokenStates.reduce(
      (acc, t) => acc + t.remaining,
      0
    );
    const activeKeyShort = activeKeyToken
      ? `${activeKeyToken.slice(0, 8)}…`
      : null;

    const statusPayload = {
      type: 'status',
      status: shouldStop() ? "stopping" : "running",
      metrics: {
        filesProcessed: processedCount,
        remainingQuota: remainingQuota,
        apiKeysLoaded: tokenStates.length,
        errors: errorCount,
        activeKey: activeKeyShort,
      }
    };
    status(JSON.stringify(statusPayload));
  }

  let idx = 0;

  async function worker(id) {
    while (true) {
      if (shouldStop()) {
        log(`[WORKER ${id}] Stopping (no new CSVs).`);
        return;
      }

      const my = idx++;
      if (my >= files.length) return;

      const filePath = files[my];
      const base = path.basename(filePath);
      const baseNoExt = base.replace(/\.[^.]+$/, "");
      const fileName = `${baseNoExt}_fixed.csv`;

      try {
        const rows = readCsv(filePath);
        const usernames = extractUsernames(rows);
        if (!usernames.length) {
          log(`[${my + 1}/${files.length}] ${base} - SKIPPED (no LinkedIn URLs found)`);
          skippedCount++;
          emitProgress(null);
          continue;
        }

        const lookup = buildInputLookup(rows);
        let processed = false;
        let inFlight = false;

        // Keep track of which tokens we tried for THIS CSV
        const triedForThisFile = new Set();

        while (!processed) {
          if (shouldStop() && !inFlight) {
            log(
              `[WORKER ${id}] Stop requested. Will not process new CSVs.`
            );
            emitProgress(null);
            return;
          }
          
          // If stop was requested AND there's an in-flight request, wait for it to complete
          // by skipping new work and looping until inFlight = false
          if (shouldStop() && inFlight) {
            // Just sleep briefly and check again
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
          }

          // If stop was requested and no in-flight, exit this file's processing
          if (shouldStop()) {
            break;
          }

          // pick a key with remaining > 0 that we haven't tried yet for this file
          let tIdx = -1;
          for (let i = 0; i < tokenStates.length; i++) {
            const t = tokenStates[i];
            if (t.remaining > 0 && !triedForThisFile.has(t.token)) {
              tIdx = i;
              break;
            }
          }

          if (tIdx === -1) {
            log(`[${my + 1}/${files.length}] ${base} - FAILED (all keys exhausted)`);
            errorCount++;
            emitProgress(null);
            break;
          }

          const token = tokenStates[tIdx].token;
          const reserved = Math.min(
            usernames.length,
            tokenStates[tIdx].remaining
          );
          triedForThisFile.add(token);

          // reserve quota
          tokenStates[tIdx].remaining -= reserved;
          updateUsedKeys(usedPath, tokenStates);

          const label = `${my + 1}/${files.length}`;
          log(`[${label}] Processing ${base}...`);
          emitProgress(token);

          // If cancellation happens AFTER reserving but BEFORE calling Apify, roll back and stop.
          if (shouldStop()) {
            log(
              `[WORKER ${id}] Stop requested. Rolling back reserved quota and stopping.`
            );
            tokenStates[tIdx].remaining += reserved;
            updateUsedKeys(usedPath, tokenStates);
            emitProgress(null);
            return;
          }

          // NOW WE WILL SEND THE REQUEST - once it's in flight, we MUST wait for it to complete
          // even if stop is requested
          inFlight = true;
          try {
            const items = await fetchApify({
              token,
              usernames,
              actorId,
              label,
              log,
            });
            inFlight = false;
            const mapped = items.map((it) => mapItem(it, lookup));
            const emailRows = mapped.filter(
              (r) => (r["Email"] || "").trim()
            );

            const perKeyDir = path.join(EMAIL_BASE, `key_${tIdx + 1}`);
            ensureDir(perKeyDir);

            const perKeyCsvPath = path.join(perKeyDir, fileName);
            const globalCsvPath = path.join(GLOBAL, fileName);

            const columns = [
              "First Name",
              "Last Name",
              "Company",
              "Company LinkedIn",
              "Job Title",
              "Email",
              "Profile URL",
              "Author",
              "post linkedin url",
            ];

            const perKeyCsv = stringify(emailRows, {
              header: true,
              columns,
            });
            fs.writeFileSync(perKeyCsvPath, perKeyCsv, "utf8");

            const globalCsv = stringify(emailRows, {
              header: true,
              columns,
            });
            fs.writeFileSync(globalCsvPath, globalCsv, "utf8");

            log(`[${label}] ✓ Complete | ${emailRows.length} email(s) extracted`);

            processed = true; // this CSV is done
            processedCount++;
            emitProgress(token);
          } catch (err) {
            inFlight = false;
            const msg = err?.message || String(err);

            // roll back quota for this failed attempt
            tokenStates[tIdx].remaining += reserved;
            updateUsedKeys(usedPath, tokenStates);

            if (isAuthOrBlockedError(msg)) {
              // permanently disable this key globally
              tokenStates[tIdx].remaining = 0;
              updateUsedKeys(usedPath, tokenStates);
              log(`[${label}] ✗ Key authentication failed. Retrying with next key...`);
              emitProgress(null);
            } else {
              // other error → try next key for THIS CSV if any left
              log(`[${label}] ✗ Request failed. Attempting with next key...`);
              emitProgress(null);
            }
          }
        } // while !processed
      } catch (err) {
        log(`[${my + 1}/${files.length}] ${base} - ERROR: ${err?.message || String(err)}`);
        errorCount++;
        emitProgress(null);
      }
    }
  }

  const workers = Array.from(
    { length: Math.max(1, parseInt(concurrency, 10) || 4) },
    (_, i) => worker(i + 1)
  );
  await Promise.all(workers);

  const remainingQuota = tokenStates.reduce(
    (acc, t) => acc + t.remaining,
    0
  );

  const finalPayload = {
    type: 'status',
    status: shouldStop() ? "stopped" : "done",
    metrics: {
      filesProcessed: processedCount,
      remainingQuota: remainingQuota,
      errors: errorCount,
      activeKey: null,
      apiKeysLoaded: tokenStates.length,
    }
  };
  status(JSON.stringify(finalPayload));

  if (shouldStop()) {
    log(`[STOP] Run terminated | Processed: ${processedCount} | Skipped: ${skippedCount} | Errors: ${errorCount}`);
  } else {
    log(`[COMPLETE] Processed: ${processedCount} | Skipped: ${skippedCount} | Errors: ${errorCount}`);
  }
}

// Allow Electron main (or other callers) to request cancellation without signals
function requestCancel() {
  cancelRequested = true;
}

// ========= AUTO-RUN WHEN SPAWNED BY ELECTRON =========
(function autoRun() {
  try {
    // Always run when spawned from Electron
    (async () => {
      const start = Date.now();

    // Build cfg from CLI + TOOL_CONFIG
    const cfg = {
      inDir: getArg("--in", fromEnv("inputDir", "")),
      outDir: getArg("--out", fromEnv("outputDir", "")),
      keysPath: getArg("--keys", fromEnv("keysPath", fromEnv("keysFilePath", ""))),
      extraTokens: getArg("--extraTokens", fromEnv("extraTokens", "")),
      actorId: getArg("--actor", fromEnv("actorId", fromEnv("actorOrFlowId", ""))),
      csvSize: getArgNumber("--csvSize", fromEnv("csvSize", 100)),
      csvsPerKey: getArgNumber("--csvsPerKey", fromEnv("csvsPerKey", 10)),
      concurrency: getArgNumber("--concurrency", fromEnv("concurrency", 4)),
    };

    try {
      await startRunInternal(cfg, {
        log: defaultLog,
        status: defaultLog,
      });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      defaultLog(`[DONE] Email extraction completed in ${elapsed}s`);
      process.exit(0);
    } catch (err) {
      defaultLog(`[ERROR] ${err?.message || String(err)}`);
      process.exit(1);
    }
  })();
  } catch (outerErr) {
    console.error("[FATAL]", outerErr.message);
    process.exit(1);
  }
})();

module.exports = {
  startRunInternal,
  requestCancel,
};
