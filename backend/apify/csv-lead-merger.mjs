// csv-lead-merger.mjs
// Strict-header CSV Lead Merger — Electron-friendly version
// - Merges CSVs that match EXPECTED_HEADERS (case/space-insensitive, order-insensitive)
// - Accepts CLI args for input/output paths and output file name
// - Reads TOOL_CONFIG (from Electron) for inputDir/outputDir/outputFile/removeDuplicates/normalizeHeaders
// - Emits clean, structured logs + a final JSON metrics line for the Electron UI

import fs from "fs";
import path from "path";
import fg from "fast-glob";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

/** ====== COLOR + LOG HELPERS (terminal + Electron log panel) ====== */
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bgGreen: "\x1b[42m",
};

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function logInfo(msg) {
  console.log(`${c.cyan}[INFO]${c.reset}  [${ts()}] ${msg}`);
}
function logOk(msg) {
  console.log(`${c.green}[OK]${c.reset}    [${ts()}] ${msg}`);
}
function logSkip(msg) {
  console.log(`${c.yellow}[SKIP]${c.reset}  [${ts()}] ${msg}`);
}
function logErr(msg) {
  console.log(`${c.red}[ERROR]${c.reset} [${ts()}] ${msg}`);
}
function logDone(msg) {
  console.log(`${c.bgGreen}${c.bold}[DONE]${c.reset}  [${ts()}] ${msg}`);
}

/** ====== JSON METRICS EMITTER (for Electron) ====== */
function emitMetrics(metrics) {
  try {
    const payload = { type: "metrics", metrics };
    console.log(JSON.stringify(payload));
  } catch {
    // ignore JSON errors, keep CLI safe
  }
}

/** ====== ARGS + TOOL_CONFIG ====== */
const argv = process.argv.slice(2);

function getArg(flag, fallback) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return fallback;
  const val = argv[idx + 1];
  if (!val || val.startsWith("--")) return fallback;
  return val;
}

function hasFlag(flag) {
  return argv.includes(flag);
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

/** ====== DEFAULT CONFIG (can be overridden via CLI / TOOL_CONFIG) ====== */
const DEFAULT_INPUT_DIR =
  "D:\\apollo aify leads fixer\\apollo aify leads fixer\\apifortheapifylinkedinemail\\csvs";

const DEFAULT_OUTPUT_DIR =
  "D:\\apollo aify leads fixer\\apollo aify leads fixer\\mergerjs";

const DEFAULT_OUTPUT_NAME = "merged.csv";

// Effective paths (CLI > TOOL_CONFIG > defaults)
const INPUT_DIR = getArg("--in", fromEnv("inputDir", DEFAULT_INPUT_DIR));

const OUTPUT_DIR = getArg("--out", fromEnv("outputDir", DEFAULT_OUTPUT_DIR));

// Support both outputFile and outputName from Electron config
const envOutputName =
  fromEnv("outputFile", null) ?? fromEnv("outputName", DEFAULT_OUTPUT_NAME);

const OUTPUT_NAME = getArg("--name", envOutputName || DEFAULT_OUTPUT_NAME);

const OUTPUT_CSV = path.join(OUTPUT_DIR, OUTPUT_NAME);

// Feature toggles
// - removeDuplicates: remove duplicate rows by Email (case-insensitive)
// - normalizeHeaders: allow case/space-insensitive, order-insensitive header matching
const REMOVE_DUPLICATES =
  hasFlag("--dedupe") ||
  hasFlag("--dedup") ||
  fromEnv("removeDuplicates", true);

const NORMALIZE_HEADERS =
  hasFlag("--normalize") ||
  hasFlag("--norm") ||
  fromEnv("normalizeHeaders", true);

// Expected header in output, in this exact order:
const EXPECTED_HEADERS = [
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

/** ====== HEADER NORMALIZATION ====== */
/**
 * Normalize a header string for comparison:
 * - lower-case
 * - trim
 * - collapse internal spaces
 */
function normalizeHeaderName(h) {
  return h
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Build a map from EXPECTED_HEADERS -> actual headers in file
 * Returns null if any expected header is missing.
 */
function buildHeaderMap(headersInFile) {
  const normToActual = {};
  for (const h of headersInFile) {
    normToActual[normalizeHeaderName(h)] = h;
  }

  const map = {};
  for (const expected of EXPECTED_HEADERS) {
    const key = normalizeHeaderName(expected);
    const actual = normToActual[key];
    if (!actual) {
      return null; // missing required header
    }
    map[expected] = actual;
  }
  return map;
}

/** ====== MAIN ====== */
(async () => {
  const start = Date.now();
  try {
    logInfo("Starting CSV Lead Merger with strict header validation...");
    logInfo("Config snapshot:");
    logInfo(`  INPUT_DIR        = ${INPUT_DIR}`);
    logInfo(`  OUTPUT_DIR       = ${OUTPUT_DIR}`);
    logInfo(`  OUTPUT_CSV       = ${OUTPUT_CSV}`);
    logInfo(`  HEADERS          = ${EXPECTED_HEADERS.join(" | ")}`);
    logInfo(`  removeDuplicates = ${REMOVE_DUPLICATES}`);
    logInfo(`  normalizeHeaders = ${NORMALIZE_HEADERS}`);

    // Scan for CSVs
    const pattern = path.join(INPUT_DIR, "*.csv").replace(/\\/g, "/");
    logInfo(`Scanning for CSV files: ${pattern}`);
    const files = await fg(pattern);

    if (!files.length) {
      logInfo("No CSV files found in the folder. Nothing to merge.");
      emitMetrics({
        filesMerged: 0,
        totalLeads: 0,
        duplicatesRemoved: 0,
      });
      process.exit(0);
    }

    logInfo(`Found ${files.length} CSV file(s).`);

    let allRows = [];
    let totalRowsBeforeDedupe = 0;
    let filesProcessed = 0;

    for (const file of files) {
      const base = path.basename(file);
      let rows;

      try {
        const csvRaw = fs.readFileSync(file, "utf8");
        rows = parse(csvRaw, {
          columns: true,
          skip_empty_lines: true,
          bom: true,
          trim: true,
        });
      } catch (err) {
        logErr(`file=${base} — failed to parse. Reason="${err.message}"`);
        continue;
      }

      if (!rows.length) {
        logSkip(`file=${base} — no rows, skipping.`);
        continue;
      }

      const headersInFile = Object.keys(rows[0]);
      let headerMap = null;

      if (NORMALIZE_HEADERS) {
        headerMap = buildHeaderMap(headersInFile);
        if (!headerMap) {
          logSkip(
            `file=${base} — missing one or more required headers.\n` +
              `       expected: ${EXPECTED_HEADERS.join(" | ")}\n` +
              `       found:    ${headersInFile.join(" | ")}`
          );
          continue;
        }
      } else {
        // Strict mode: same length + same order + exact match
        const mismatch =
          EXPECTED_HEADERS.length !== headersInFile.length ||
          EXPECTED_HEADERS.some((h, i) => h !== headersInFile[i]);

        if (mismatch) {
          logSkip(
            `file=${base} — header mismatch.\n` +
              `       expected: ${EXPECTED_HEADERS.join(" | ")}\n` +
              `       found:    ${headersInFile.join(" | ")}`
          );
          continue;
        }
        // identity map
        headerMap = EXPECTED_HEADERS.reduce((m, h) => {
          m[h] = h;
          return m;
        }, {});
      }

      // Normalize rows into EXPECTED_HEADERS (using headerMap)
      const normalizedRows = rows.map((row) => {
        const out = {};
        for (const expected of EXPECTED_HEADERS) {
          const actualKey = headerMap[expected];
          out[expected] = row[actualKey] ?? "";
        }
        return out;
      });

      allRows.push(...normalizedRows);
      totalRowsBeforeDedupe += normalizedRows.length;
      filesProcessed++;

      logOk(`file=${base} rows=${normalizedRows.length}`);
    }

    if (!filesProcessed) {
      logInfo(
        "No valid CSVs with the expected headers were found. Nothing to merge."
      );
      emitMetrics({
        filesMerged: 0,
        totalLeads: 0,
        duplicatesRemoved: 0,
      });
      process.exit(0);
    }

    // Optional: remove duplicates by Email (case-insensitive)
    let finalRows = allRows;
    let duplicatesRemoved = 0;

    if (REMOVE_DUPLICATES) {
      const seen = new Set();
      const deduped = [];

      for (const row of allRows) {
        const emailRaw = (row["Email"] || "").toString().trim().toLowerCase();
        if (!emailRaw) {
          // keep rows without email (or you can choose to skip, but keeping is safer)
          deduped.push(row);
          continue;
        }
        if (seen.has(emailRaw)) {
          duplicatesRemoved++;
          continue;
        }
        seen.add(emailRaw);
        deduped.push(row);
      }

      finalRows = deduped;
      logInfo(
        `Deduplication by Email done. Removed=${duplicatesRemoved}, kept=${finalRows.length}`
      );
    }

    // Ensure output folder
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const output = stringify(finalRows, {
      header: true,
      columns: EXPECTED_HEADERS,
    });

    fs.writeFileSync(OUTPUT_CSV, output, "utf8");

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    logDone(
      `processed=${filesProcessed}/${files.length} files • totalRowsBeforeDedupe=${totalRowsBeforeDedupe} • finalRows=${finalRows.length} • output="${OUTPUT_CSV}" • elapsed=${elapsed}s`
    );

    emitMetrics({
      filesMerged: filesProcessed,
      totalLeads: finalRows.length,
      duplicatesRemoved,
    });
  } catch (err) {
    logErr(err.message || String(err));
    emitMetrics({
      filesMerged: 0,
      totalLeads: 0,
      duplicatesRemoved: 0,
      error: err.message || String(err),
    });
    process.exit(1);
  }
})();
