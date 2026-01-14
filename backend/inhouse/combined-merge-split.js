// combined-merge-split.js
// Merge CSVs → dedupe → split into chunks
// Electron-friendly: accepts CLI args [inputDir, outputDir, chunkSize, mode]
// Still specialized for LinkedIn data (actor/linkedinUrl + query/post) + author from filename

const fs = require("fs");
const path = require("path");

// FIX: When spawned from Electron, __dirname is backend/inhouse/
// Add app root to module search paths.
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, '../../');
if (module.paths && !module.paths.includes(path.join(appRoot, 'node_modules'))) {
  module.paths.unshift(path.join(appRoot, 'node_modules'));
}

const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify");

// =============== COLOR HELPERS ===============
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",

  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",

  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
  bgMagenta: "\x1b[45m",
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
function logDone(msg) {
  console.log(`${c.bgGreen}${c.bold}[DONE]${c.reset}  [${ts()}] ${msg}`);
}
function logErr(msg) {
  console.log(`${c.red}[ERROR]${c.reset} [${ts()}] ${msg}`);
}

// JSON helpers for Electron (main.js parses these)
function emitStatus(message, metrics) {
  const payload = { type: "status", message, metrics: metrics || undefined };
  console.log(JSON.stringify(payload));
}

function emitMetrics(metrics) {
  const payload = { type: "metrics", metrics };
  console.log(JSON.stringify(payload));
}

// =============== ARG + ENV PARSING ===============
// CLI: node combined-merge-split.js <inputDir> <outputDir> <chunkSize> <mode>
const argv = process.argv.slice(2);

let envCfg = {};
try {
  envCfg = process.env.TOOL_CONFIG ? JSON.parse(process.env.TOOL_CONFIG) : {};
} catch {
  envCfg = {};
}

const fromEnv = (key, fallback) =>
  Object.prototype.hasOwnProperty.call(envCfg, key) ? envCfg[key] : fallback;

const DEFAULT_INPUT_DIR = path.join(__dirname, "input");
const DEFAULT_OUTPUT_DIR = path.join(__dirname, "output");
const DEFAULT_CHUNK_SIZE = 5000;
const DEFAULT_MODE = "merge-split"; // merge-split | merge-only | split-only

const INPUT_DIR = argv[0]?.trim() || fromEnv("inputDir", DEFAULT_INPUT_DIR);
const OUTPUT_DIR = argv[1]?.trim() || fromEnv("outputDir", DEFAULT_OUTPUT_DIR);

let chunkSizeArg = parseInt(argv[2], 10);
// support both chunkSize and maxRowsPerChunk from TOOL_CONFIG
const envChunk = fromEnv("chunkSize", null);
const envMaxRows = fromEnv("maxRowsPerChunk", null);
if (!Number.isFinite(chunkSizeArg) || chunkSizeArg <= 0) {
  chunkSizeArg = parseInt(envChunk ?? envMaxRows ?? DEFAULT_CHUNK_SIZE, 10);
}
const CHUNK_SIZE = Number.isFinite(chunkSizeArg) && chunkSizeArg > 0 ? chunkSizeArg : DEFAULT_CHUNK_SIZE;

const MODE = (argv[3]?.trim().toLowerCase()) || (fromEnv("mode", DEFAULT_MODE) || DEFAULT_MODE);

// merged.csv will always live inside OUTPUT_DIR
const MERGED_FILE = path.join(OUTPUT_DIR, "merged.csv");

logInfo(`Using INPUT_DIR=${INPUT_DIR}`);
logInfo(`Using OUTPUT_DIR=${OUTPUT_DIR}`);
logInfo(`Using CHUNK_SIZE=${CHUNK_SIZE}`);
logInfo(`Using MODE=${MODE}`);

// =============== LOG HEADER ===============
function header(title) {
  console.log(`\n${c.bgBlue}${c.bold}  ${title}  ${c.reset}\n`);
}

function success(msg) {
  console.log(`${c.green}✔${c.reset} ${msg}`);
}
function info(msg) {
  console.log(`${c.cyan}ℹ${c.reset} ${msg}`);
}
function warn(msg) {
  console.log(`${c.yellow}⚠${c.reset} ${msg}`);
}
function error(msg) {
  console.log(`${c.red}✖${c.reset} ${msg}`);
}

// =============== UTILS ===============
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function getAuthorFromFilename(filename) {
  const base = path.basename(filename, path.extname(filename)).trim();
  let name = base
    .replace(/\s*\[\s*\d+\s*\]\s*$/i, "")
    .replace(/\s*\(\s*\d+\s*\)\s*$/i, "")
    .replace(/\s+\d+\s*$/i, "")
    .trim();
  return name || base;
}

function pick(obj, keys) {
  const lower = {};
  for (const k of Object.keys(obj)) lower[k.toLowerCase().trim()] = obj[k];
  const out = {};
  for (const key of keys) {
    const val = lower[key.toLowerCase()];
    if (val !== undefined) out[key] = val;
  }
  return out;
}

function normalizeLinkedinUrl(url) {
  if (!url) return "";
  return url
    .toString()
    .trim()
    .replace(/^"+|"+$/g, "")
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?linkedin\.com\//, "")
    .split("?")[0]
    .replace(/\/$/, "");
}

function safeTrimBOM(s) {
  return s ? s.replace(/^\uFEFF/, "") : s;
}

// =============== STEP 1: MERGE & DEDUPE ===============
function mergeAndDedupe() {
  header("STEP 1 — MERGE & CLEAN CSVs");

  logInfo(`Config snapshot:`);
  logInfo(`  MODE        = ${MODE}`);
  logInfo(`  INPUT_DIR   = ${INPUT_DIR}`);
  logInfo(`  OUTPUT_DIR  = ${OUTPUT_DIR}`);
  logInfo(`  MERGED_FILE = ${MERGED_FILE}`);
  logInfo(`  CHUNK_SIZE  = ${CHUNK_SIZE}`);

  emitStatus("Starting merge & dedupe step...", {
    inputDir: INPUT_DIR,
    outputDir: OUTPUT_DIR,
    chunkSize: CHUNK_SIZE,
    mode: MODE,
  });

  if (!fs.existsSync(INPUT_DIR)) {
    logErr(`Input folder not found: ${INPUT_DIR}`);
    emitStatus(`Input folder not found: ${INPUT_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(INPUT_DIR)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .map((f) => path.join(INPUT_DIR, f));

  if (!files.length) {
    error(`No CSV files found in ${INPUT_DIR}`);
    emitStatus(`No CSV files found in ${INPUT_DIR}`);
    process.exit(1);
  }

  info(`Found ${files.length} CSV files\n`);
  emitMetrics({ filesFound: files.length, chunksCreated: 0 });

  let rows = [];
  let total = 0;

  for (const file of files) {
    const fileName = path.basename(file);
    const author = getAuthorFromFilename(file);
    process.stdout.write(
      `${c.magenta}→${c.reset} Processing ${c.bold}${fileName}${c.reset} … `
    );

    let records;
    try {
      records = parse(fs.readFileSync(file), {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_quotes: true,
        relax_column_count: true,
      });
      success(`OK (${records.length} rows)`);
    } catch (err) {
      warn(`Skipped — ${err.message}`);
      continue;
    }

    for (const rec of records) {
      total++;
      const picked = pick(rec, ["actor/linkedinurl", "query/post"]);
      const linkedin = (picked["actor/linkedinurl"] || "").toString().trim();
      const post = (picked["query/post"] || "").toString().trim();

      if (!linkedin && !post) continue;

      rows.push({
        "linkedin url": linkedin.replace(/^"+|"+$/g, ""),
        "post url": post.replace(/^"+|"+$/g, ""),
        "author name": author,
      });
    }
  }

  const seen = new Set();
  const deduped = [];

  for (const r of rows) {
    const key = normalizeLinkedinUrl(r["linkedin url"]);
    if (!key) {
      deduped.push(r);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  info("\nWriting merged.csv...");

  ensureDir(path.dirname(MERGED_FILE));

  const stringifier = stringify({
    header: true,
    columns: ["linkedin url", "post url", "author name"],
  });

  const out = fs.createWriteStream(MERGED_FILE);
  stringifier.pipe(out);
  deduped.forEach((r) => stringifier.write(r));
  stringifier.end();

  out.on("finish", () => {
    success(`Parsed rows: ${total}`);
    success(`Kept rows: ${deduped.length}`);
    success(`Saved → ${MERGED_FILE}`);

    emitMetrics({
      filesFound: files.length,
      rowsParsed: total,
      rowsKept: deduped.length,
      mergedFile: MERGED_FILE,
      chunksCreated: 0,
    });

    emitStatus("Merge & dedupe completed.", {
      rowsParsed: total,
      rowsKept: deduped.length,
    });

    if (MODE === "merge-split") {
      splitMerged();
    } else {
      logDone("Finished in MERGE-ONLY mode (no splitting).");
      emitStatus("Finished in MERGE-ONLY mode.");
    }
  });

  out.on("error", (err) => {
    error(`Error writing merged file: ${err.message}`);
    emitStatus(`Error writing merged file: ${err.message}`);
    process.exit(1);
  });
}

// =============== STEP 2: SPLIT MERGED FILE ===============
function splitMerged() {
  header("STEP 2 — SPLITTING MERGED FILE");

  emitStatus("Starting split step...", {
    mergedFile: MERGED_FILE,
    outputDir: OUTPUT_DIR,
    chunkSize: CHUNK_SIZE,
  });

  if (!fs.existsSync(MERGED_FILE)) {
    error(`merged.csv not found: ${MERGED_FILE}`);
    emitStatus(`merged.csv not found: ${MERGED_FILE}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(MERGED_FILE, "utf8");
  const text = safeTrimBOM(raw);
  let lines = text.split(/\r?\n/);

  if (lines[lines.length - 1].trim() === "") lines.pop();

  if (lines.length <= 1) {
    error("Not enough data to split.");
    emitStatus("Not enough data to split.");
    process.exit(1);
  }

  const headerRow = lines[0];
  const data = lines.slice(1);

  info(`Total data rows: ${data.length}`);
  ensureDir(OUTPUT_DIR);

  let part = 1;

  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.slice(i, i + CHUNK_SIZE);
    const outPath = path.join(
      OUTPUT_DIR,
      `merged_part_${String(part).padStart(3, "0")}.csv`
    );

    fs.writeFileSync(outPath, [headerRow, ...chunk].join("\n") + "\n", "utf8");

    success(
      `Created part ${String(part).padStart(3, "0")} (${chunk.length} rows)`
    );

    part++;
  }

  console.log(
    `\n${c.bgGreen}${c.bold}  DONE — ${part - 1} files created in ${OUTPUT_DIR}  ${c.reset}\n`
  );

  logDone(
    `processed=${data.length} rows • chunks=${part - 1} • output=${OUTPUT_DIR}`
  );

  emitMetrics({
    splitRows: data.length,
    chunksCreated: part - 1,
    outputDir: OUTPUT_DIR,
    filesFound: 1, // merged file was the input
  });

  emitStatus("Split step completed.", {
    chunksCreated: part - 1,
    outputDir: OUTPUT_DIR,
  });
}

// =============== RUN ===============
(function run() {
  const start = Date.now();

  logInfo("Starting Combined Merge & Split (LinkedIn specialized)...");
  logInfo(`Mode: ${MODE}`);

  if (MODE === "split-only") {
    // Only split an existing merged.csv
    splitMerged();
  } else {
    // merge-only or merge-split
    mergeAndDedupe();
  }

  process.on("exit", () => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    logDone(`Elapsed time: ${elapsed}s`);
    emitStatus("Combined Merge & Split finished.", { elapsedSeconds: Number(elapsed) });
  });
})();
