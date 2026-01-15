#!/usr/bin/env node
/**
 * CSV Splitter (streaming) — Pretty Console + Clean Logs (Fixed)
 *
 * Install:
 *   npm i csv-parse csv-stringify
 *
 * Run:
 *   node csv-splitter.js
 *   node csv-splitter.js --in "D:\\path\\file.csv" --rows 500
 *   node csv-splitter.js --json
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { parse } = require("csv-parse");
const { stringify } = require("csv-stringify");

const DEFAULT_DIR = "D:\\apollo aify leads fixer\\apollo aify leads fixer\\In house codes\\Splitter";

/* ========= Pretty Console ========= */
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
  white: "\x1b[37m",
};

const ICON = {
  ok: "✅",
  warn: "⚠️",
  err: "❌",
  info: "ℹ️",
  run: "🚀",
  file: "📄",
  out: "📦",
  gear: "⚙️",
};

function hr() {
  console.log(
    C.gray +
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" +
      C.reset
  );
}

function title() {
  console.log(`${C.bold}${C.cyan}╔════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║${C.reset}  ${C.bold}${C.white}${ICON.run} CSV SPLITTER — Fast, Clean, Streaming Splitter${C.reset}                 ${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.gray}${ICON.gear} Folder: ${DEFAULT_DIR}${C.reset}`);
  hr();
}

/* ========= Helpers ========= */
function pad2(n) {
  return String(n).padStart(2, "0");
}

function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(
    d.getHours()
  )}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = (s - m * 60).toFixed(1);
  return `${m}m ${r}s`;
}

function stripQuotes(s) {
  return (s || "").trim().replace(/^"+|"+$/g, "");
}

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

async function ask(rl, q) {
  return new Promise((res) => rl.question(q, (ans) => res(ans)));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function listCsvFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .map((f) => path.join(dir, f));
}

function fileSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function baseNameNoExt(filePath) {
  const b = path.basename(filePath);
  return b.replace(/\.[^/.]+$/, "");
}

function partName(base, partIndex) {
  return `${base}_part_${String(partIndex).padStart(3, "0")}.csv`;
}

/* ========= Clean Logging ========= */
function createLogger({ json = false } = {}) {
  const base = (level, msg, meta) => {
    const time = new Date().toISOString();

    if (json) {
      process.stdout.write(
        JSON.stringify({ time, level, msg, ...(meta ? { meta } : {}) }) + "\n"
      );
      return;
    }

    const color =
      level === "error"
        ? C.red
        : level === "warn"
        ? C.yellow
        : level === "success"
        ? C.green
        : C.cyan;

    const tag =
      level === "error"
        ? `${ICON.err} ERROR`
        : level === "warn"
        ? `${ICON.warn} WARN `
        : level === "success"
        ? `${ICON.ok} OK   `
        : `${ICON.info} INFO `;

    process.stdout.write(`${C.gray}${time}${C.reset} ${color}${tag}${C.reset} ${msg}\n`);
    if (meta && Object.keys(meta).length) {
      process.stdout.write(`${C.gray}${JSON.stringify(meta, null, 2)}${C.reset}\n`);
    }
  };

  return {
    info: (m, meta) => base("info", m, meta),
    warn: (m, meta) => base("warn", m, meta),
    error: (m, meta) => base("error", m, meta),
    success: (m, meta) => base("success", m, meta),
  };
}

function parseArgs(argv) {
  const out = { json: false, in: null, rows: null, outDir: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--in") out.in = argv[++i] || null;
    else if (a === "--rows") out.rows = Number(argv[++i] || 0) || null;
    else if (a === "--out") out.outDir = argv[++i] || null;
  }
  return out;
}

/* ========= Input resolver (number OR path OR filename) ========= */
async function resolveInputPath({ rl, log, files }) {
  console.log(`${C.bold}${C.white}${ICON.file} Found CSV files:${C.reset}`);
  files.forEach((f, idx) => {
    console.log(
      `  ${C.cyan}${idx + 1}.${C.reset} ${path.basename(f)} ${C.gray}(${formatBytes(
        fileSize(f)
      )})${C.reset}`
    );
  });
  hr();

  const pickRaw = await ask(
    rl,
    `${C.bold}${C.white}Select file number (or paste full path / filename):${C.reset} `
  );
  const pick = stripQuotes(pickRaw);

  const idx = Number(pick);
  if (isPositiveInt(idx) && idx <= files.length) return files[idx - 1];

  const looksLikePath =
    pick.includes(":\\") || pick.includes("\\") || pick.startsWith(".") || pick.startsWith("/");

  if (looksLikePath) {
    const maybePath = path.isAbsolute(pick) ? pick : path.join(process.cwd(), pick);
    if (fs.existsSync(maybePath) && maybePath.toLowerCase().endsWith(".csv")) return maybePath;
    log.error("That path doesn't exist (or is not a .csv).", { input: maybePath });
    return null;
  }

  const asFileInDir = path.join(DEFAULT_DIR, pick);
  if (fs.existsSync(asFileInDir) && asFileInDir.toLowerCase().endsWith(".csv")) return asFileInDir;

  log.error("Invalid selection. Type 1, or paste a valid CSV path/filename.", { input: pick });
  return null;
}

/* ========= Part writer ========= */
function createPartWriter({ outDir, base, partIndex, header, log }) {
  const outPath = path.join(outDir, partName(base, partIndex));
  const fileStream = fs.createWriteStream(outPath, { encoding: "utf8" });

  const csv = stringify({
    header: true,
    columns: header,
  });

  csv.pipe(fileStream);

  log.info("Opened new split file.", { part: partIndex, output: outPath });

  const close = () =>
    new Promise((resolve, reject) => {
      fileStream.once("finish", resolve);
      fileStream.once("error", reject);
      csv.once("error", reject);
      csv.end();
    });

  return { outPath, csv, close };
}

/* ========= Main ========= */
async function main() {
  const args = parseArgs(process.argv);
  const isElectron = !!process.env.TOOL_CONFIG;

  let config = {};
  if (isElectron) {
    try {
      config = JSON.parse(process.env.TOOL_CONFIG || "{}") || {};
    } catch (e) {
      console.error(
        JSON.stringify({ type: "log", level: "error", message: `Failed to parse TOOL_CONFIG: ${e.message}` })
      );
      process.exit(1);
    }
  }

  const log = createLogger({ json: args.json || config.jsonLogs || isElectron });
  const rl = isElectron ? null : readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    if (!isElectron) title();

    let inputPath = config.inputPath ? stripQuotes(config.inputPath) : args.in ? stripQuotes(args.in) : null;

    if (!inputPath) {
      if (isElectron) {
        console.error(JSON.stringify({ type: "log", level: "error", message: "Input CSV is required." }));
        process.exitCode = 1;
        return;
      }

      const files = listCsvFiles(DEFAULT_DIR);
      if (!files.length) {
        log.error("No CSV files found in the Splitter folder.", { folder: DEFAULT_DIR });
        console.log(`${C.yellow}Put a .csv file in the folder above, then run again.${C.reset}`);
        process.exitCode = 1;
        return;
      }

      const chosen = await resolveInputPath({ rl, log, files });
      if (!chosen) {
        process.exitCode = 1;
        return;
      }
      inputPath = chosen;
    } else if (!path.isAbsolute(inputPath)) {
      inputPath = path.join(process.cwd(), inputPath);
    }

    if (!fs.existsSync(inputPath)) {
      log.error("Input file not found.", { inputPath });
      process.exitCode = 1;
      return;
    }

    let rowsPerFile = config.rowsPerFile || args.rows;
    if (!rowsPerFile) {
      if (isElectron) {
        log.error("rowsPerFile is required.");
        process.exitCode = 1;
        return;
      }
      const ans = await ask(rl, `${C.bold}${C.white}Rows per split CSV (e.g., 500):${C.reset} `);
      rowsPerFile = Number(stripQuotes(ans));
    }
    if (!isPositiveInt(rowsPerFile)) {
      log.error("Rows per file must be a positive whole number.", { rowsPerFile });
      process.exitCode = 1;
      return;
    }

    const outputRoot = config.outputDir || args.outDir || path.dirname(inputPath) || DEFAULT_DIR;
    const resolvedOutputRoot = path.isAbsolute(outputRoot)
      ? outputRoot
      : path.join(process.cwd(), outputRoot);
    const outDir = path.join(
      resolvedOutputRoot,
      `splits_${baseNameNoExt(inputPath)}_${nowStamp()}`
    );
    ensureDir(outDir);

    if (!isElectron) {
      log.info("Starting split...", { input: inputPath, rowsPerFile, outDir });
    } else {
      console.log(
        JSON.stringify({ type: "log", level: "info", message: "Starting split", meta: { inputPath, rowsPerFile, outDir } })
      );
    }

    const t0 = Date.now();

    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      bom: true,
      trim: false,
    });

    const inputStream = fs.createReadStream(inputPath);

    let header = null;
    let partIndex = 0;
    let totalRows = 0;
    let rowCountInPart = 0;
    let writer = null;

    const recordsStream = inputStream.pipe(parser);

    for await (const record of recordsStream) {
      if (!header) {
        header = Object.keys(record);
        log.success("Detected columns (auto).", { columns: header });

        partIndex = 1;
        rowCountInPart = 0;
        writer = createPartWriter({ outDir, base: baseNameNoExt(inputPath), partIndex, header, log });
      }

      if (rowCountInPart >= rowsPerFile) {
        await writer.close();

        partIndex += 1;
        rowCountInPart = 0;
        writer = createPartWriter({ outDir, base: baseNameNoExt(inputPath), partIndex, header, log });
      }

      writer.csv.write(record);
      rowCountInPart += 1;
      totalRows += 1;

      if (totalRows % 5000 === 0) {
        log.info("Progress", {
          totalRows,
          currentPart: partIndex,
          rowsInCurrentPart: rowCountInPart,
        });
      }
    }

    if (writer) await writer.close();

    const ms = Date.now() - t0;

    hr();
    log.success("Split completed.", {
      totalRows,
      partsCreated: partIndex,
      outputFolder: outDir,
      duration: formatMs(ms),
    });

    const metrics = {
      "csv-splitter-total-rows": totalRows,
      "csv-splitter-parts": partIndex,
      "csv-splitter-output": outDir,
    };

    console.log(JSON.stringify({ type: "metrics", metrics, status: "complete" }));
    console.log(JSON.stringify({ type: "log", level: "info", message: `${ICON.out} Output folder: ${outDir}` }));
    console.log(JSON.stringify({ type: "status", status: "done", metrics }));
    hr();
  } catch (err) {
    const message = err?.message || String(err);
    console.error(JSON.stringify({ type: "log", level: "error", message }));
    process.exitCode = 1;
  } finally {
    if (rl) rl.close();
  }
}

main();
