/**
 * linkedin-profile-enhancer.js (CommonJS) — Clean terminal UI + key precheck
 * Enriches LinkedIn profiles with professional information using Apify actor
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { ApifyClient } = require("apify-client");
const csvParser = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");

// ========================
// TOOL CONFIG (from Electron)
// ========================
let envCfg = {};
try {
  envCfg = process.env.TOOL_CONFIG ? JSON.parse(process.env.TOOL_CONFIG) : {};
} catch {}

const fromEnv = (key, fallback) =>
  Object.prototype.hasOwnProperty.call(envCfg, key) ? envCfg[key] : fallback;

// ========================
// CONFIG
// ========================
const ACTOR_ID = fromEnv("actorId", "yZnhB5JewWf9xSmoM");
const MAX_CREDITS_PER_KEY = fromEnv("maxCredits", 1600);
const BATCH_SIZE = fromEnv("batchSize", 10);

let INPUT_CSV = fromEnv("inputCsv", "");
let OUTPUT_DIR = fromEnv("outputDir", "");
let KEYS_JSON_PATH = fromEnv("keysFilePath", path.resolve("./keys.json"));
let USED_KEYS_JSON_PATH = "";
let OUTPUT_CSV = "";

// Set used_keys.json in same directory as keys.json
if (KEYS_JSON_PATH) {
  const keysDir = path.dirname(KEYS_JSON_PATH);
  USED_KEYS_JSON_PATH = path.join(keysDir, "used_keys.json");
}

// ========================
// OUTPUT HEADERS
// ========================
const OUTPUT_HEADERS = [
  { id: "firstname", title: "Firstname" },
  { id: "lastname", title: "Lastname" },
  { id: "headline", title: "Headline" },
  { id: "profileUrl", title: "Profile Url" },
  { id: "email", title: "Email" },
  { id: "emailDomain", title: "Email Domain" },

  { id: "companyName", title: "Company Name" },
  { id: "title", title: "Title" },
  { id: "isCurrent", title: "Is Current Position" },
  { id: "startYear", title: "Start Year" },
  { id: "startMonth", title: "Start Month" },
  { id: "companyLinkedinUrl", title: "Company Linkedin Url" },
  { id: "inputCompanyWebsite", title: "Company Website Input" },

  { id: "author", title: "Author" },
  { id: "postLinkedinUrl", title: "Post Linkedin Url" }
];

// ========================
// TERMINAL UI (clean)
// ========================
function line(char = "─", n = 78) {
  return char.repeat(n);
}
function now() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}
function badge(type) {
  if (type === "OK") return "[OK]   ";
  if (type === "WARN") return "[WARN] ";
  if (type === "FAIL") return "[FAIL] ";
  return "[INFO] ";
}
function log(type, msg) {
  console.log(`${badge(type)} ${msg}`);
}
function section(title) {
  console.log("\n" + line());
  console.log(title);
  console.log(line());
}
function kv(key, value) {
  const k = String(key).padEnd(26, " ");
  console.log(`${k}: ${value}`);
}
function keyHint(token) {
  const t = String(token || "");
  if (t.length < 16) return t;
  return `${t.slice(0, 10)}...${t.slice(-4)}`;
}

// ========================
// UTILS
// ========================
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
function extractInputRow(row) {
  const norm = {};
  for (const k of Object.keys(row)) norm[normalizeHeader(k)] = row[k];

  return {
    firstname: String(norm["firstname"] || "").trim(),
    lastname: String(norm["lastname"] || "").trim(),
    email: String(norm["email"] || "").trim(),
    emailDomain: String(norm["emaildomain"] || "").trim(),
    author: String(norm["author"] || "").trim(),
    postLinkedinUrl: String(norm["postlinkedinurl"] || "").trim(),
    profileUrl: String(norm["profileurl"] || "").trim(),
    inputCompanyWebsite: String(norm["companywebsite"] || "").trim(),
    inputCompanyLinkedinUrl: String(norm["companylinkedinurl"] || "").trim()
  };
}
function parseCompanyUrnFromUrl(companyUrl) {
  if (!companyUrl) return "";
  const m = String(companyUrl).match(/\/company\/(\d+)\//i);
  return m ? m[1] : "";
}
function pickCurrentPosition(item) {
  const positions = Array.isArray(item?.positions) ? item.positions : [];
  let current = positions.find((p) => p && p.current === true);
  if (!current) {
    current = positions.find((p) => {
      const end = p?.timePeriod?.endDate;
      return end === null || typeof end === "undefined";
    });
  }
  if (!current) current = positions[0] || null;
  return current;
}
function getStartYearMonth(pos) {
  const start = pos?.timePeriod?.startDate || {};
  return {
    startYear: start?.year ?? "",
    startMonth: start?.month ?? ""
  };
}
function waitForEnter(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

// ========================
// ERROR CLASSIFIER
// ========================
function classifyError(e) {
  const msg = String(e?.message || e || "");
  const lower = msg.toLowerCase();

  if (lower.includes("authentication token is not valid") || lower.includes("not authorized")) {
    return { type: "INVALID_TOKEN", msg };
  }
  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("429")) {
    return { type: "RATE_LIMIT", msg };
  }
  return { type: "UNKNOWN", msg };
}

// ========================
// KEY MANAGEMENT
// ========================
function loadKeys() {
  if (!fs.existsSync(KEYS_JSON_PATH)) {
    throw new Error(`keys.json not found at: ${KEYS_JSON_PATH}`);
  }
  const raw = JSON.parse(fs.readFileSync(KEYS_JSON_PATH, "utf-8"));

  let entries = [];
  if (Array.isArray(raw)) {
    entries = raw
      .filter((v) => v && String(v).trim().length > 0)
      .map((token, idx) => ({ name: `api${idx + 1}`, token: String(token).trim() }));
  } else if (raw && typeof raw === "object") {
    entries = Object.entries(raw)
      .filter(([k, v]) => k && v && String(v).trim().length > 0)
      .map(([k, v]) => ({ name: k, token: String(v).trim() }));
  } else {
    throw new Error("keys.json must be an array of tokens OR an object of named tokens.");
  }

  if (!entries.length) throw new Error("keys.json has no usable keys.");
  return entries;
}

function loadUsedKeysState(keys) {
  let state = {};
  if (fs.existsSync(USED_KEYS_JSON_PATH)) {
    try {
      state = JSON.parse(fs.readFileSync(USED_KEYS_JSON_PATH, "utf-8")) || {};
    } catch {
      state = {};
    }
  }

  for (const k of keys) {
    if (!state[k.name]) {
      state[k.name] = {
        tokenHint: keyHint(k.token),
        usedCredits: 0,
        remainingCredits: MAX_CREDITS_PER_KEY,
        status: "ACTIVE", // ACTIVE | INVALID | EXHAUSTED
        reason: "",
        lastUsedAt: ""
      };
    } else {
      const used = Number(state[k.name].usedCredits || 0);
      state[k.name].usedCredits = used;
      state[k.name].remainingCredits = Math.max(0, MAX_CREDITS_PER_KEY - used);
      if (state[k.name].remainingCredits <= 0) {
        state[k.name].status = "EXHAUSTED";
      }
    }
  }

  return state;
}

function saveUsedKeysState(state) {
  fs.writeFileSync(USED_KEYS_JSON_PATH, JSON.stringify(state, null, 2), "utf-8");
}

function pickNextKey(keys, usedState, neededCredits) {
  for (const k of keys) {
    const st = usedState[k.name];
    if (!st) continue;
    if (st.status !== "ACTIVE") continue;
    if (st.remainingCredits < neededCredits) continue;
    return k;
  }
  return null;
}

// ========================
// PRECHECK TOKEN
// ========================
async function precheckToken(name, token) {
  const client = new ApifyClient({ token });
  const me = await client.user().get();
  return me?.username || "OK";
}

// ========================
// CSV READ
// ========================
function readAllInputRows(csvPath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(csvPath)
      .pipe(csvParser())
      .on("data", (row) => rows.push(extractInputRow(row)))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

// ========================
// APIFY RUN
// ========================
async function runActorForUrls(token, urls) {
  const client = new ApifyClient({ token });
  const input = {
    urls: urls.map((u) => ({ url: u })),
    findContacts: false,
    "findContacts.contactCompassToken": ""
  };

  log("INFO", "Submitting profiles to LinkedIn scraper...");
  const run = await client.actor(ACTOR_ID).call(input, { waitSecs: 0 });
  
  log("INFO", "Enrichment in progress...");
  
  // Poll for completion
  let runInfo = await client.run(run.id).get();
  let dots = 0;
  
  while (runInfo.status === "RUNNING") {
    process.stdout.write(".");
    dots++;
    if (dots % 50 === 0) process.stdout.write("\n");
    await new Promise(resolve => setTimeout(resolve, 2000));
    runInfo = await client.run(run.id).get();
  }
  
  if (dots > 0) console.log("");
  
  if (runInfo.status === "SUCCEEDED") {
    log("OK", "Enrichment completed successfully");
  } else {
    log("WARN", `Enrichment finished with status: ${runInfo.status}`);
  }
  
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items || [];
}

// ========================
// MAIN
// ========================
async function main() {
  // Validate required config
  if (!INPUT_CSV || !OUTPUT_DIR) {
    console.error("[ERROR] Missing required configuration:");
    console.error("  - inputCsv:", INPUT_CSV || "(not set)");
    console.error("  - outputDir:", OUTPUT_DIR || "(not set)");
    console.error("");
    console.error("This tool should be run via the Electron UI or with TOOL_CONFIG environment variable.");
    process.exit(1);
  }

  OUTPUT_CSV = path.join(OUTPUT_DIR, "enriched_profiles_current.csv");
  ensureDir(OUTPUT_DIR);

  section("APIFY LINKEDIN PROFILE ENRICHER");
  kv("Started", now());
  kv("Actor", ACTOR_ID);
  kv("Batch size", BATCH_SIZE);
  kv("Credits/key cap", MAX_CREDITS_PER_KEY);
  kv("Input CSV", INPUT_CSV);
  kv("Output CSV", OUTPUT_CSV);

  const keys = loadKeys();
  const usedState = loadUsedKeysState(keys);
  saveUsedKeysState(usedState);

  section("KEYS LOADED");
  keys.forEach((k) => {
    const st = usedState[k.name];
    console.log(
      `${k.name.padEnd(6)} | ${st.tokenHint.padEnd(20)} | status=${st.status} | remaining=${st.remainingCredits}`
    );
  });

  // Precheck keys
  section("KEY PRECHECK");
  for (const k of keys) {
    const st = usedState[k.name];
    if (st.status !== "ACTIVE") continue;

    try {
      const who = await precheckToken(k.name, k.token);
      log("OK", `${k.name} token valid (Apify user: ${who})`);
    } catch (e) {
      const info = classifyError(e);
      st.status = "INVALID";
      st.reason = info.msg;
      st.lastUsedAt = new Date().toISOString();
      saveUsedKeysState(usedState);
      log("FAIL", `${k.name} token invalid -> saved to used_keys.json`);
      log("FAIL", `Reason: ${info.msg}`);
    }
  }

  const activeKeys = keys.filter((k) => usedState[k.name]?.status === "ACTIVE");
  if (!activeKeys.length) {
    section("STOPPED");
    log("FAIL", "No ACTIVE keys available. Fix keys.json and rerun.");
    log("INFO", `Check: ${USED_KEYS_JSON_PATH}`);
    return;
  }

  const allRows = await readAllInputRows(INPUT_CSV);
  const rows = allRows.filter((r) => r.profileUrl && r.profileUrl.includes("linkedin.com/in/"));

  section("INPUT SUMMARY");
  kv("Rows in CSV", allRows.length);
  kv("Valid linkedin profileUrl", rows.length);

  const fileExists = fs.existsSync(OUTPUT_CSV);
  const csvWriter = createObjectCsvWriter({
    path: OUTPUT_CSV,
    header: OUTPUT_HEADERS,
    append: fileExists
  });

  log("OK", fileExists ? "Appending to existing output CSV" : "Creating new output CSV with headers");

  let processed = 0;

  while (processed < rows.length) {
    const batch = rows.slice(processed, processed + BATCH_SIZE);
    const neededCredits = batch.length;

    const keyObj = pickNextKey(keys, usedState, neededCredits);
    if (!keyObj) {
      section("STOPPED");
      log("FAIL", "No usable keys left (INVALID/EXHAUSTED/insufficient credits).");
      log("INFO", `Check: ${USED_KEYS_JSON_PATH}`);
      break;
    }

    const st = usedState[keyObj.name];

    section(`BATCH ${Math.floor(processed / BATCH_SIZE) + 1}`);
    kv("Using key", `${keyObj.name} (${st.tokenHint})`);
    kv("Credits before", st.remainingCredits);
    kv("Batch size", batch.length);

    const urls = batch.map((r) => r.profileUrl);

    let items = [];
    try {
      items = await runActorForUrls(keyObj.token, urls);
      log("OK", `Actor run success. Items returned: ${items.length}`);
    } catch (e) {
      const info = classifyError(e);
      st.status = info.type === "INVALID_TOKEN" ? "INVALID" : st.status;
      st.reason = info.msg;
      st.lastUsedAt = new Date().toISOString();
      saveUsedKeysState(usedState);

      log("FAIL", `Key ${keyObj.name} failed.`);
      log("FAIL", `Reason: ${info.msg}`);

      continue;
    }

    const byInputUrl = new Map();
    for (const it of items) {
      if (it?.inputUrl) byInputUrl.set(String(it.inputUrl).trim(), it);
    }

    const outRows = batch.map((r) => {
      const it = byInputUrl.get(r.profileUrl) || null;

      const pos = pickCurrentPosition(it);
      const { startYear, startMonth } = getStartYearMonth(pos);

      const companyLinkedinUrl = r.inputCompanyLinkedinUrl ||
        pos?.company?.url || it?.currentCompany?.url || it?.companyLinkedinUrl || "";
      
      const companyName =
        pos?.company?.name || it?.currentCompany?.name || it?.companyName || "";

      const title = pos?.title || it?.jobTitle || "";
      const headline = it?.headline || "";

      const isCurrent =
        pos?.current === true ||
        pos?.timePeriod?.endDate === null ||
        typeof pos?.timePeriod?.endDate === "undefined"
          ? "true"
          : "false";

      return {
        firstname: r.firstname,
        lastname: r.lastname,
        headline,
        profileUrl: r.profileUrl,
        email: r.email,
        emailDomain: r.emailDomain,

        companyName,
        title,
        isCurrent,
        startYear,
        startMonth,
        companyLinkedinUrl,
        inputCompanyWebsite: r.inputCompanyWebsite,

        author: r.author,
        postLinkedinUrl: r.postLinkedinUrl
      };
    });

    await csvWriter.writeRecords(outRows);
    log("OK", `Wrote ${outRows.length} rows to output CSV`);

    // credits update
    st.usedCredits += neededCredits;
    st.remainingCredits = Math.max(0, MAX_CREDITS_PER_KEY - st.usedCredits);
    st.lastUsedAt = new Date().toISOString();
    if (st.remainingCredits <= 0) {
      st.status = "EXHAUSTED";
      st.reason = "Credit cap reached";
      log("WARN", `${keyObj.name} exhausted (used=${st.usedCredits})`);
    }
    saveUsedKeysState(usedState);

    processed += batch.length;

    kv("Progress", `${processed}/${rows.length}`);
    kv("Credits after", st.remainingCredits);

    if (processed < rows.length) {
      await waitForEnter("\nPress ENTER to send next 10...\n");
    }
  }

  section("FINISHED");
  log("OK", `Output: ${OUTPUT_CSV}`);
  log("OK", `Key log: ${USED_KEYS_JSON_PATH}`);
}

main().catch((e) => {
  section("FATAL ERROR");
  console.log(String(e?.stack || e?.message || e));
  process.exit(1);
});
