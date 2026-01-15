#!/usr/bin/env node
/**
 * CSV Duplicate Remover (Pick Column) — NO DEPENDENCIES
 *
 * ✅ User selects the column to dedupe by
 * ✅ Keeps FIRST or LAST occurrence (configurable)
 * ✅ Writes a clean output CSV
 * ✅ Pretty console + structured JSON logs for Electron
 *
 * Usage:
 *   node csv-deduplicator.js
 *   TOOL_CONFIG='{"inputPath":"file.csv","columnName":"Email","keepMode":"first","outputDir":"./out","outputFileName":"deduped.csv"}' node csv-deduplicator.js
 *
 * Node v18+
 */

const fs = require("fs");
const path = require("path");

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

const ok = (m) => console.log(color("✓ ", C.green) + m);
const warn = (m) => console.log(color("⚠ ", C.yellow) + color(m, C.yellow));
const fail = (m) => console.log(color("✗ ", C.red) + color(m, C.red));

/* ===================== CSV PARSER / WRITER ===================== */
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
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(outPath, headers, rowArrays) {
  const lines = [];
  lines.push(headers.map(csvEscape).join(","));
  for (const r of rowArrays) {
    const line = headers.map((_, i) => csvEscape(r[i] ?? "")).join(",");
    lines.push(line);
  }
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
}

/* ===================== IO HELPERS ===================== */
function readText(filePath) {
  const buf = fs.readFileSync(filePath);
  let text = buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  return text;
}

function normalizeKey(v) {
  return String(v ?? "").trim().toLowerCase();
}

/* ===================== MAIN ===================== */
async function main() {
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

  try {
    const inputPath = config.inputPath;
    const columnName = config.columnName;
    const keepMode = config.keepMode || "first";
    const outputDir = config.outputDir || path.dirname(inputPath);
    const outputFileName = config.outputFileName || "deduped.csv";

    if (!inputPath) {
      console.error(JSON.stringify({ type: "log", level: "error", message: "Input CSV is required." }));
      process.exit(1);
    }

    if (!columnName) {
      console.error(JSON.stringify({ type: "log", level: "error", message: "Column name is required." }));
      process.exit(1);
    }

    if (!fs.existsSync(inputPath)) {
      console.error(JSON.stringify({ type: "log", level: "error", message: `Input file not found: ${inputPath}` }));
      process.exit(1);
    }

    console.log(JSON.stringify({ type: "log", level: "info", message: `Loading CSV: ${path.basename(inputPath)}` }));

    const text = readText(inputPath);
    const parsed = parseCsv(text);

    if (!parsed.headers.length) {
      console.error(JSON.stringify({ type: "log", level: "error", message: "CSV has no headers or is empty." }));
      process.exit(1);
    }

    const colIndex = parsed.headers.findIndex((h) => h.trim() === columnName.trim());
    if (colIndex === -1) {
      console.error(
        JSON.stringify({
          type: "log",
          level: "error",
          message: `Column "${columnName}" not found in CSV. Available: ${parsed.headers.join(", ")}`,
        })
      );
      process.exit(1);
    }

    console.log(
      JSON.stringify({
        type: "log",
        level: "info",
        message: `Loaded ${parsed.rows.length} rows • ${parsed.headers.length} columns`,
      })
    );
    console.log(
      JSON.stringify({
        type: "log",
        level: "info",
        message: `Deduplicating by column: ${columnName} (keep: ${keepMode})`,
      })
    );

    const seen = new Map();
    const kept = [];
    let removed = 0;
    let emptyKey = 0;
    let dups = 0;

    const total = parsed.rows.length;
    const step = Math.max(500, Math.floor(total / 20));

    if (keepMode === "first") {
      for (let i = 0; i < total; i++) {
        if (i % step === 0 || i === total - 1) {
          console.log(
            JSON.stringify({
              type: "metrics",
              metrics: {
                "dedupe-processed": i + 1,
                "dedupe-total": total,
                "dedupe-kept": kept.length,
                "dedupe-removed": removed,
              },
            })
          );
        }

        const row = parsed.rows[i];
        const key = normalizeKey(row[colIndex]);

        if (!key) {
          emptyKey++;
          kept.push(row);
          continue;
        }

        if (!seen.has(key)) {
          seen.set(key, kept.length);
          kept.push(row);
        } else {
          dups++;
          removed++;
        }
      }
    } else {
      // keepMode === "last"
      for (let i = 0; i < total; i++) {
        if (i % step === 0 || i === total - 1) {
          console.log(
            JSON.stringify({
              type: "metrics",
              metrics: {
                "dedupe-processed": i + 1,
                "dedupe-total": total,
                "dedupe-kept": kept.length,
                "dedupe-removed": removed,
              },
            })
          );
        }

        const row = parsed.rows[i];
        const key = normalizeKey(row[colIndex]);

        if (!key) {
          emptyKey++;
          kept.push(row);
          continue;
        }

        if (!seen.has(key)) {
          seen.set(key, kept.length);
          kept.push(row);
        } else {
          const idx = seen.get(key);
          kept[idx] = row;
          dups++;
          removed++;
        }
      }
    }

    const outPath = path.join(outputDir, outputFileName);
    writeCsv(outPath, parsed.headers, kept);

    console.log(
      JSON.stringify({
        type: "metrics",
        metrics: {
          "dedupe-input-rows": total,
          "dedupe-output-rows": kept.length,
          "dedupe-removed": removed,
          "dedupe-empty-key": emptyKey,
        },
        status: "complete",
      })
    );

    console.log(JSON.stringify({ type: "log", level: "info", message: `✓ Saved → ${outPath}` }));
    console.log(JSON.stringify({ type: "log", level: "info", message: `Input rows: ${total}` }));
    console.log(JSON.stringify({ type: "log", level: "info", message: `Output rows: ${kept.length}` }));
    console.log(JSON.stringify({ type: "log", level: "info", message: `Duplicates removed: ${removed}` }));
    console.log(JSON.stringify({ type: "log", level: "info", message: `Empty key rows kept: ${emptyKey}` }));
    console.log(JSON.stringify({ type: "status", status: "done" }));
  } catch (err) {
    const message = err?.message || String(err);
    console.error(JSON.stringify({ type: "log", level: "error", message }));
    process.exitCode = 1;
  }
}

main();
