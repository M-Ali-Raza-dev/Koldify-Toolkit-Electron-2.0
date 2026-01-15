#!/usr/bin/env node
/**
 * CSV Splitter (streaming) — Clean Console (Electron-safe) + Optional JSON events
 *
 * Install:
 *   npm i csv-parse csv-stringify
 *
 * Run:
 *   node csv-splitter.js
 *   node csv-splitter.js --in "D:\\path\\file.csv" --rows 500
 *   node csv-splitter.js --json     (CLI JSON logs)
 *
 * Notes:
 * - CLI: pretty human output (NO ANSI, no raw JSON spam)
 * - Electron (TOOL_CONFIG): emits JSON events: {type:"log"/"metrics"/"status"}
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { parse } = require("csv-parse");
const { stringify } = require("csv-stringify");

const DEFAULT_DIR =
  "D:\\apollo aify leads fixer\\apollo aify leads fixer\\In house codes\\Splitter";

/* =========================
 * CLI args + TOOL_CONFIG
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
function stripQuotes(s) {
  return (s || "").trim().replace(/^"+|"+$/g, "");
}
function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
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

let envCfg = {};
try {
  envCfg = process.env.TOOL_CONFIG ? JSON.parse(process.env.TOOL_CONFIG) : {};
} catch {
  envCfg = {};
}

function fromEnv(key, fallback) {
  return Object.prototype.hasOwnProperty.call(envCfg, key) ? envCfg[key] : fallback;
}

/* =========================
 * Pretty UI (NO ANSI)
 * =======================*/
const UI = {
  width: 74,
  line() {
    console.log("─".repeat(this.width));
  },
  title(folder) {
    console.log("");
    console.log("✂️  CSV Splitter (Streaming)");
    console.log(`📁 Folder: ${folder}`);
    this.line();
  },
  info(msg) {
    console.log("ℹ️  " + msg);
  },
  ok(msg) {
    console.log("✅ " + msg);
  },
  warn(msg) {
    console.log("⚠️  " + msg);
  },
  err(msg) {
    console.log("❌ " + msg);
  },
  listFiles(files) {
    console.log("📄 Found CSV files:");
    files.forEach((f, idx) => {
      console.log(`  ${idx + 1}. ${path.basename(f)} (${formatBytes(fileSize(f))})`);
    });
    this.line();
  },
};

/* =========================
 * Electron event emitter
 * =======================*/
function emitEvent(obj) {
  // Electron runner expects JSON lines.
  process.stdout.write(JSON.stringify(obj) + "\n");
}

/* =========================
 * Logger (3 modes)
 * =======================
 * - CLI pretty (default)  -> human friendly lines
 * - CLI JSON (--json)     -> JSON log lines
 * - Electron              -> emitEvent({type:"log"...}) and NO extra noise
 */
function createLogger({ mode }) {
  const nowISO = () => new Date().toISOString();

  if (mode === "electron") {
    return {
      info: (m, meta) => emitEvent({ type: "log", level: "info", message: m, meta }),
      warn: (m, meta) => emitEvent({ type: "log", level: "warn", message: m, meta }),
      error: (m, meta) => emitEvent({ type: "log", level: "error", message: m, meta }),
      success: (m, meta) => emitEvent({ type: "log", level: "success", message: m, meta }),
      progress: (meta) => emitEvent({ type: "status", status: "running", metrics: meta }),
      done: (meta) => emitEvent({ type: "status", status: "done", metrics: meta }),
      metrics: (meta) => emitEvent({ type: "metrics", metrics: meta, status: "complete" }),
    };
  }

  if (mode === "json") {
    const j = (level, msg, meta) => {
      process.stdout.write(JSON.stringify({ ts: nowISO(), level, msg, ...(meta ? { meta } : {}) }) + "\n");
    };
    return {
      info: (m, meta) => j("info", m, meta),
      warn: (m, meta) => j("warn", m, meta),
      error: (m, meta) => j("error", m, meta),
      success: (m, meta) => j("success", m, meta),
      progress: (meta) => j("status", "progress", meta),
      done: (meta) => j("status", "done", meta),
      metrics: (meta) => j("metrics", "metrics", meta),
    };
  }

  // pretty (CLI)
  return {
    info: (m) => UI.info(m),
    warn: (m) => UI.warn(m),
    error: (m) => UI.err(m),
    success: (m) => UI.ok(m),
    progress: (meta) => {
      // keep it simple and not spammy
      UI.info(`Progress: ${meta.totalRows} rows • parts: ${meta.partsCreated}`);
    },
    done: (meta) => {
      UI.ok(`Done • rows: ${meta.totalRows} • parts: ${meta.partsCreated} • ${meta.duration}`);
      UI.ok(`Output folder: ${meta.outputFolder}`);
    },
    metrics: () => {},
  };
}

/* =========================
 * Helpers
 * =======================*/
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
async function ask(rl, q) {
  return new Promise((res) => rl.question(q, (ans) => res(ans)));
}

/* ========= Input resolver (number OR path OR filename) ========= */
async function resolveInputPath({ rl, log, files }) {
  UI.listFiles(files);

  const pickRaw = await ask(
    rl,
    `Select file number (or paste full path / filename): `
  );
  const pick = stripQuotes(pickRaw);

  const idx = Number(pick);
  if (isPositiveInt(idx) && idx <= files.length) return files[idx - 1];

  const looksLikePath =
    pick.includes(":\\") || pick.includes("\\") || pick.startsWith(".") || pick.startsWith("/");

  if (looksLikePath) {
    const maybePath = path.isAbsolute(pick) ? pick : path.join(process.cwd(), pick);
    if (fs.existsSync(maybePath) && maybePath.toLowerCase().endsWith(".csv")) return maybePath;
    log.error("That path doesn't exist (or is not a .csv).");
    return null;
  }

  const asFileInDir = path.join(DEFAULT_DIR, pick);
  if (fs.existsSync(asFileInDir) && asFileInDir.toLowerCase().endsWith(".csv")) return asFileInDir;

  log.error("Invalid selection. Type 1, or paste a valid CSV path/filename.");
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

  // Only print open file in CLI (don’t spam 100 lines in Electron)
  log.info(`Creating part ${partIndex}: ${path.basename(outPath)}`);

  const close = () =>
    new Promise((resolve, reject) => {
      fileStream.once("finish", resolve);
      fileStream.once("error", reject);
      csv.once("error", reject);
      csv.end();
    });

  return { outPath, csv, close };
}

/* =========================
 * Main
 * =======================*/
async function main() {
  const args = parseArgs(process.argv);
  const isElectron = !!process.env.TOOL_CONFIG;

  // Logging mode selection
  const mode = isElectron ? "electron" : args.json ? "json" : "pretty";
  const log = createLogger({ mode });

  const rl = isElectron
    ? null
    : readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    if (!isElectron && mode === "pretty") UI.title(DEFAULT_DIR);

    let inputPath = fromEnv("inputPath", "") || args.in || "";
    inputPath = stripQuotes(inputPath);

    if (!inputPath) {
      if (isElectron) {
        log.error("Input CSV is required.", { hint: "Provide TOOL_CONFIG.inputPath" });
        process.exitCode = 1;
        return;
      }

      const files = listCsvFiles(DEFAULT_DIR);
      if (!files.length) {
        log.error("No CSV files found in the Splitter folder.");
        UI.warn(`Put a .csv file in: ${DEFAULT_DIR}`);
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

    let rowsPerFile = Number(fromEnv("rowsPerFile", 0)) || args.rows || 0;

    if (!rowsPerFile) {
      if (isElectron) {
        log.error("rowsPerFile is required.", { hint: "Provide TOOL_CONFIG.rowsPerFile" });
        process.exitCode = 1;
        return;
      }
      const ans = await ask(rl, `Rows per split CSV (e.g., 500): `);
      rowsPerFile = Number(stripQuotes(ans));
    }

    if (!isPositiveInt(rowsPerFile)) {
      log.error("Rows per file must be a positive whole number.", { rowsPerFile });
      process.exitCode = 1;
      return;
    }

    const outputRoot =
      stripQuotes(fromEnv("outputDir", "")) ||
      stripQuotes(args.outDir || "") ||
      path.dirname(inputPath) ||
      DEFAULT_DIR;

    const resolvedOutputRoot = path.isAbsolute(outputRoot)
      ? outputRoot
      : path.join(process.cwd(), outputRoot);

    const outDir = path.join(
      resolvedOutputRoot,
      `splits_${baseNameNoExt(inputPath)}_${nowStamp()}`
    );
    ensureDir(outDir);

    // Start message
    log.success("Starting split", {
      inputPath,
      rowsPerFile,
      outDir,
    });

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
        log.success("Detected columns", { count: header.length });
        partIndex = 1;
        rowCountInPart = 0;
        writer = createPartWriter({
          outDir,
          base: baseNameNoExt(inputPath),
          partIndex,
          header,
          log,
        });
      }

      if (rowCountInPart >= rowsPerFile) {
        await writer.close();
        partIndex += 1;
        rowCountInPart = 0;
        writer = createPartWriter({
          outDir,
          base: baseNameNoExt(inputPath),
          partIndex,
          header,
          log,
        });
      }

      writer.csv.write(record);
      rowCountInPart += 1;
      totalRows += 1;

      // Progress: not spammy
      if (totalRows % 5000 === 0) {
        log.progress({
          totalRows,
          partsCreated: partIndex,
          rowsInCurrentPart: rowCountInPart,
        });
      }
    }

    if (writer) await writer.close();

    const ms = Date.now() - t0;

    const summary = {
      totalRows,
      partsCreated: partIndex,
      outputFolder: outDir,
      duration: formatMs(ms),
    };

    // CLI pretty summary
    if (mode === "pretty") {
      UI.line();
      UI.ok(`Split completed • ${summary.duration}`);
      UI.ok(`Rows: ${summary.totalRows}`);
      UI.ok(`Parts: ${summary.partsCreated}`);
      UI.ok(`Output folder: ${summary.outputFolder}`);
      UI.line();
    } else {
      log.success("Split completed", summary);
    }

    // Electron metrics/status
    if (isElectron) {
      const metrics = {
        "csv-splitter-total-rows": totalRows,
        "csv-splitter-parts": partIndex,
        "csv-splitter-output": outDir,
      };
      log.metrics(metrics);
      log.done(metrics);
    }
  } catch (err) {
    const message = err?.message || String(err);
    if (isElectron) {
      log.error(message);
    } else {
      UI.err(message);
    }
    process.exitCode = 1;
  } finally {
    if (rl) rl.close();
  }
}

main();
