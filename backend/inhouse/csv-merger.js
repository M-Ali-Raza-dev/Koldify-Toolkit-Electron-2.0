#!/usr/bin/env node
/**
 * CSV Merger (Auto-Detect Columns) — NO DEDUPE, NO DEPENDENCIES
 *
 * ✅ Auto-detects all CSV files in a folder
 * ✅ Auto-detects/normalizes columns across files (header union)
 * ✅ Appends ALL rows (no duplicate removal)
 * ✅ Writes one merged CSV
 * ✅ Attractive console + JSONL log file
 * ✅ Folder selection dialog for Electron
 *
 * Usage:
 *   node csv-merger.js
 *   node csv-merger.js --input "D:\path\to\folder"
 *   node csv-merger.js --out "merged.csv"
 *   node csv-merger.js --log "merger-log.jsonl"
 *
 * Node v18+
 */

const fs = require("fs");
const path = require("path");

/* ===================== CONFIG ===================== */
const DEFAULT_OUT_FILE = "merged.csv";
const DEFAULT_LOG_FILE = "merger-log.jsonl";

/* ===================== PRETTY CONSOLE ===================== */
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

const color = (s, c) => `${c}${s}${C.reset}`;
const hr = () =>
  console.log(color("────────────────────────────────────────────────────────────────────────", C.gray));

function banner(title) {
  console.log(color("┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓", C.cyan));
  console.log(color("┃ ", C.cyan) + color(title.padEnd(68, " "), C.bold) + color(" ┃", C.cyan));
  console.log(color("┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛", C.cyan));
}

const ok = (m) => console.log(color("✓ ", C.green) + m);
const warn = (m) => console.log(color("⚠ ", C.yellow) + color(m, C.yellow));
const fail = (m) => console.log(color("✗ ", C.red) + color(m, C.red));
const info = (m) => console.log(color("ℹ ", C.cyan) + m);

/* ===================== LOGGING (JSONL) ===================== */
let LOG_PATH = null;
function logEvent(type, data = {}) {
  if (!LOG_PATH) return;
  const payload = { ts: new Date().toISOString(), type, ...data };
  try {
    fs.appendFileSync(LOG_PATH, JSON.stringify(payload) + "\n");
  } catch {
    // ignore
  }
}

/* ===================== CLI PARSER ===================== */
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

/* ===================== CSV PARSER / WRITER ===================== */
/**
 * RFC4180-ish parser:
 * - commas
 * - quotes with escaped quotes ("")
 * - newlines inside quoted fields
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\r") continue;

    if (ch === "\n") {
      row.push(field);
      field = "";
      if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    field += ch;
  }

  row.push(field);
  if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) rows.push(row);

  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => String(h ?? "").trim());
  return { headers, rows: rows.slice(1) };
}

function csvEscape(v) {
  const s = (v ?? "").toString();
  
  // Prevent Excel formula injection by wrapping potential formulas
  if (/^[+\-=@]/.test(s)) {
    // Use ="value" format to prevent formula execution
    return `="${s.replace(/"/g, '""')}"`;
  }
  
  // Regular CSV escaping for values with quotes, commas, or newlines
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  
  return s;
}

function writeCsv(outPath, headers, rowObjects) {
  const lines = [];
  lines.push(headers.map(csvEscape).join(","));
  for (const obj of rowObjects) {
    lines.push(headers.map((h) => csvEscape(obj[h] ?? "")).join(","));
  }
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
}

/* ===================== HEADER NORMALIZATION ===================== */
function normalizeHeader(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Optional alias map:
 * (keeps merged output cleaner when different files use different spellings)
 * You can remove/add synonyms anytime.
 */
const ALIASES = new Map([
  ["email", "Email"],
  ["email address", "Email"],
  ["work email", "Email"],

  ["first name", "First Name"],
  ["firstname", "First Name"],
  ["last name", "Last Name"],
  ["lastname", "Last Name"],
  ["full name", "Full Name"],
  ["name", "Full Name"],

  ["company", "Company"],
  ["company name", "Company"],
  ["organization", "Company"],

  ["domain", "Domain"],
  ["company domain", "Domain"],
  ["website", "Website"],
  ["website url", "Website"],
  ["company website", "Website"],
  ["company url", "Website"],

  ["linkedin", "LinkedIn URL"],
  ["linkedin url", "LinkedIn URL"],
  ["person linkedin url", "LinkedIn URL"],
  ["profile url", "LinkedIn URL"],

  ["phone", "Phone"],
  ["phone number", "Phone"],

  ["job title", "Job Title"],
  ["title", "Job Title"],
]);

function canonicalHeader(originalHeader) {
  const n = normalizeHeader(originalHeader);
  return ALIASES.get(n) || String(originalHeader ?? "").trim() || "Unnamed Column";
}

/* ===================== FILE HELPERS ===================== */
function readCsvFiles(dir) {
  if (!fs.existsSync(dir)) throw new Error(`Input folder does not exist: ${dir}`);
  const items = fs.readdirSync(dir, { withFileTypes: true });
  return items
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".csv"))
    .map((d) => path.join(dir, d.name));
}

function readText(filePath) {
  const buf = fs.readFileSync(filePath);
  let text = buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  return text;
}

/* ===================== FOLDER SELECTION (for Electron) ===================== */
async function selectFolder() {
  try {
    const { dialog } = require("electron");
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select folder containing CSV files to merge",
    });
    
    if (result.canceled || !result.filePaths.length) {
      return null;
    }
    return result.filePaths[0];
  } catch (e) {
    // If electron is not available (running in Node.js directly), skip folder selection
    warn("Folder selection not available (Electron not detected). Please use --input flag.");
    return null;
  }
}

/* ===================== MAIN ===================== */
async function main() {
  // Check if running from Electron (TOOL_CONFIG env var)
  let inputDir, outputDir, outFile, logName;

  const toolConfig = process.env.TOOL_CONFIG;
  
  if (toolConfig) {
    // Running from Electron
    try {
      const config = JSON.parse(toolConfig);
      inputDir = config.inputDir;
      outputDir = config.outputDir || '';
      outFile = config.outputFileName || DEFAULT_OUT_FILE;
      logName = config.logFileName || DEFAULT_LOG_FILE;
    } catch (e) {
      console.error(JSON.stringify({ type: 'log', level: 'error', message: `Failed to parse TOOL_CONFIG: ${e.message}` }));
      process.exit(1);
    }
  } else {
    // Running from command line
    const args = parseArgs(process.argv);
    inputDir = args.input;
    outputDir = args.output || '';
    outFile = args.out || DEFAULT_OUT_FILE;
    logName = args.log || DEFAULT_LOG_FILE;
  }

  // If no input directory specified and not from Electron, prompt user to select folder
  if (!inputDir && !toolConfig) {
    console.clear();
    banner("CSV Merger • Auto Columns • No Dedupe");
    hr();
    info("Please select the folder containing CSV files to merge...");
    inputDir = await selectFolder();
    
    if (!inputDir) {
      fail("No folder selected. Exiting.");
      process.exit(1);
    }
  }

  if (!inputDir) {
    const errMsg = "No input folder specified.";
    console.error(JSON.stringify({ type: 'log', level: 'error', message: errMsg }));
    process.exit(1);
  }

  // Output to console or structured JSON based on environment
  const isElectron = !!toolConfig;
  
  // Use outputDir if provided, otherwise use inputDir
  const actualOutputDir = outputDir || inputDir;

  if (!isElectron) {
    console.clear();
    banner("CSV Merger • Auto Columns • No Dedupe");
    hr();
    console.log(color("📁 Input:", C.gray), color(inputDir, C.cyan));
    console.log(color("📤 Output:", C.gray), color(path.join(actualOutputDir, outFile), C.cyan));
    console.log(color("🧾 Log:", C.gray), color(path.join(actualOutputDir, logName), C.gray));
    hr();
  } else {
    console.log(JSON.stringify({ type: 'log', level: 'info', message: `Input folder: ${inputDir}` }));
    console.log(JSON.stringify({ type: 'log', level: 'info', message: `Output folder: ${actualOutputDir}` }));
    console.log(JSON.stringify({ type: 'log', level: 'info', message: `Output file: ${outFile}` }));
  }

  LOG_PATH = path.join(actualOutputDir, logName);
  try {
    fs.writeFileSync(LOG_PATH, ""); // reset log each run
  } catch {
    LOG_PATH = null;
    const warnMsg = "Could not write log file (continuing without logs).";
    if (isElectron) {
      console.log(JSON.stringify({ type: 'log', level: 'warn', message: warnMsg }));
    } else {
      warn(warnMsg);
    }
  }

  logEvent("run_start", { inputDir, outFile });

  const files = readCsvFiles(inputDir);
  if (!files.length) {
    const errMsg = "No .csv files found in the folder.";
    if (isElectron) {
      console.error(JSON.stringify({ type: 'log', level: 'error', message: errMsg }));
    } else {
      fail(errMsg);
    }
    logEvent("no_files");
    process.exit(1);
  }

  if (isElectron) {
    console.log(JSON.stringify({ type: 'log', level: 'info', message: `Found ${files.length} CSV file(s)` }));
    files.forEach((f, i) => {
      console.log(JSON.stringify({ type: 'log', level: 'info', message: `  ${i + 1}. ${path.basename(f)}` }));
    });
  } else {
    ok(`Found ${files.length} CSV file(s):`);
    files.forEach((f, i) => console.log(color(`  ${i + 1}.`, C.gray), path.basename(f)));
    hr();
    console.log(color("🔎 Detecting columns + merging rows…", C.cyan));
  }

  const unionHeaders = [];
  const unionSet = new Set();

  const parsed = files.map((filePath) => {
    const text = readText(filePath);
    const p = parseCsv(text);

    const canonicalHeaders = p.headers.map(canonicalHeader);

    // ensure unique canonical headers inside same file if duplicates exist
    const seen = new Map();
    const unique = canonicalHeaders.map((h) => {
      const c = (seen.get(h) || 0) + 1;
      seen.set(h, c);
      return c === 1 ? h : `${h} (${c})`;
    });

    for (const h of unique) {
      if (!unionSet.has(h)) {
        unionSet.add(h);
        unionHeaders.push(h);
      }
    }

    logEvent("file_parsed", {
      file: path.basename(filePath),
      rows: p.rows.length,
      headers: p.headers,
      canonicalHeaders: unique,
    });

    return { filePath, headers: unique, rows: p.rows };
  });

  if (isElectron) {
    console.log(JSON.stringify({ type: 'log', level: 'info', message: `Union headers: ${unionHeaders.length}` }));
    console.log(JSON.stringify({ type: 'log', level: 'info', message: `Sample columns: ${unionHeaders.slice(0, 10).join(', ')}${unionHeaders.length > 10 ? '...' : ''}` }));
  } else {
    ok(`Union headers: ${unionHeaders.length}`);
    console.log(color("🧩 Sample columns:", C.gray));
    console.log(color("  " + unionHeaders.slice(0, 28).join(color("  |  ", C.gray)), C.dim));
    if (unionHeaders.length > 28) console.log(color(`  … +${unionHeaders.length - 28} more`, C.dim));
    hr();
  }

  const mergedRows = [];
  let totalRowsIn = 0;
  let emptyRowsSkipped = 0;

  for (const pf of parsed) {
    const base = path.basename(pf.filePath);

    // header -> index map for that file
    const idx = new Map();
    pf.headers.forEach((h, i) => idx.set(h, i));

    let fileAppended = 0;

    for (const r of pf.rows) {
      totalRowsIn++;

      const obj = {};
      for (const h of unionHeaders) obj[h] = "";

      for (const [h, i] of idx.entries()) {
        obj[h] = (r[i] ?? "").toString();
      }

      // skip fully empty rows
      const hasData = unionHeaders.some((h) => String(obj[h] ?? "").trim() !== "");
      if (!hasData) {
        emptyRowsSkipped++;
        continue;
      }

      mergedRows.push(obj);
      fileAppended++;
    }

    if (isElectron) {
      console.log(JSON.stringify({ type: 'log', level: 'info', message: `${base}: appended ${fileAppended} rows` }));
    } else {
      ok(`${base}: appended ${fileAppended} rows`);
    }
    logEvent("file_appended", { file: base, appended: fileAppended });
  }

  const outPath = path.join(actualOutputDir, outFile);
  writeCsv(outPath, unionHeaders, mergedRows);

  if (isElectron) {
    console.log(JSON.stringify({ type: 'log', level: 'info', message: `✓ Saved to: ${outPath}` }));
    console.log(JSON.stringify({ 
      type: 'metrics', 
      metrics: { 
        'csv-merger-files': files.length,
        'csv-merger-rows': mergedRows.length,
        'csv-merger-columns': unionHeaders.length
      },
      status: 'complete'
    }));
    console.log(JSON.stringify({ type: 'log', level: 'info', message: `Total input rows: ${totalRowsIn}` }));
    console.log(JSON.stringify({ type: 'log', level: 'info', message: `Empty rows skipped: ${emptyRowsSkipped}` }));
    console.log(JSON.stringify({ type: 'log', level: 'info', message: `Output rows: ${mergedRows.length}` }));
  } else {
    hr();
    ok(`Saved → ${outPath}`);
    console.log(color("📊 Stats:", C.bold));
    console.log(color("  • Total input rows: ", C.gray) + color(totalRowsIn, C.cyan));
    console.log(color("  • Empty rows skipped: ", C.gray) + color(emptyRowsSkipped, C.yellow));
    console.log(color("  • Output rows: ", C.gray) + color(mergedRows.length, C.green));
    hr();
    ok("Done.");
  }

  logEvent("run_done", {
    files: files.length,
    totalRowsIn,
    emptyRowsSkipped,
    outputRows: mergedRows.length,
    outPath,
    outputDir: actualOutputDir,
  });
}

main().catch((e) => {
  hr();
  fail(e?.message || String(e));
  logEvent("run_error", { message: e?.message || String(e), stack: e?.stack || "" });
  process.exit(1);
});
