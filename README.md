
<div align="center">
  <img src="renderer/assets/koldify-logo.svg" alt="Koldify Toolkit" width="120" />
  <h1>Koldify Toolkit (Electron) — v2.10.2</h1>
  <p><b>Apify + Blitz automation suite</b> for LinkedIn data workflows, enrichment, and clean CSV outputs — with a single desktop UI.</p>

  <p>
    <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-informational">
    <img alt="Built With" src="https://img.shields.io/badge/built%20with-Electron-9cf">
    <img alt="Version" src="https://img.shields.io/badge/version-2.10.2-success">
  </p>
</div>

---

## ⚡ What this is

**Koldify Toolkit** is a desktop app that bundles multiple **Apify** + **Blitz** automations into one clean UI:
- run tools from a sidebar
- pick input files/folders
- see real-time logs + status updates
- export ready-to-use CSVs
- copy **sample inputs** per tool to get started fast

Built for growth ops, lead-gen workflows, and LinkedIn data pipelines.

---

## 🧰 Included Tools

### Apify (LinkedIn / CSV pipeline)
- **Post Finder** — find LinkedIn posts by keyword and export results
- **Reaction Scraper** — scrape reactors from post URLs (CSV in → CSV out)
- **Comment Scraper** — orchestrated comment scraping + export
- **Contact Details Scraper** — extract contact information from LinkedIn profiles
- **Merge / Split CSV** — combine and split datasets cleanly
- **Lead Merger** — merge lead files into one normalized output
- **Email Enricher** — extract/enrich emails using Apify flows
- **LinkedIn Profile Enhancer** — enhance/enrich profile records

### Blitz (enrichment)
- **Email Enricher** — enrich emails via Blitz API
- **Waterfall ICP** — waterfall enrichment / ICP pipeline (status streaming supported)
- **Reverse Email** — lookup person details from email addresses (single/batch, CSV/TXT support)
- **Reverse Phone** — lookup person details from phone numbers (single/batch, CSV/TXT support)
- **Find Mobile & Direct Phone** — get mobile/direct numbers from LinkedIn profile URLs (single/batch, CSV/TXT support)
- **LinkedIn URL to Domain** — extract email domain from company LinkedIn URLs (single/batch, CSV/TXT support)
- **Domain to LinkedIn** — find company LinkedIn URL from domain (single/batch, CSV/TXT support)
- **Key Info** — check Blitz API key details, credits, rate limits, and allowed endpoints
- **Employee Finder** — search employees by company LinkedIn URL with filters (region, level, function, connections)
  - New sample bundle: `samples/blitz/blitz-employee-finder/companies.csv`

> The app streams logs and supports structured stdout formats like `::STATE:: {...}` for live status + metrics.

---

## ✅ Requirements
- **Node.js** (recommended: **18+**)
- **npm** (or yarn/pnpm)
- Apify API token(s) if using Apify tools
- Blitz API key if using Blitz tools

---

## 🚀 Getting Started

### 1) Install dependencies
```bash
npm install
````

### 2) Run the app (dev)

```bash
npm run dev
```

### 3) Build the desktop installer

```bash
npm run build
```

Build output goes to:

* `dist/` (configured by electron-builder)

---

## 🔑 Configuration

### Apify keys (multi-key support)

Most Apify tools accept a `keys.json` file:

```json
["apify_key_1", "apify_key_2", "apify_key_3"]
```

### Blitz API Key

Blitz tools read the key from either:

* the UI payload (if provided), or
* environment variable `BLITZ_API_KEY`

Example (PowerShell):

```powershell
$env:BLITZ_API_KEY="blitz_xxxxxxx"
npm run dev
```

Example (bash):

```bash
export BLITZ_API_KEY="blitz_xxxxxxx"
npm run dev
```

---

## 🧪 Sample Inputs (built-in)

Each tool includes a **Sample input** button in the UI.

When clicked, the app will:

1. ask you to select a destination folder
2. copy the sample template(s) from:

   * `samples/apify/...`
   * `samples/blitz/...`

This makes onboarding new users super fast.

---

## 🗂️ Project Structure

```txt
.
├── main.js                 # Electron main process (tool runner + IPC)
├── preload.js              # Safe IPC bridge for renderer
├── renderer/               # UI (HTML/CSS/JS)
│   ├── index.html
│   ├── script.js
│   └── assets/
├── backend/
│   ├── apify/              # Apify scripts (mjs/js)
│   └── blitz/              # Blitz scripts (js)
└── samples/                # Copy-to-user sample input templates
```

---

## 🧠 How Tool Execution Works

* UI sends `tool:run` via IPC with a `toolId` + `payload`
* Main process spawns the matching backend script using `process.execPath`
* Logs stream back to the UI in real time (`tool:log`, `tool:status`, `tool:exit`)
* Stop button sends a graceful `SIGINT` (`tool:stop`)

---

## 🛠️ Troubleshooting

### “Script not found”

Ensure `backend/**` exists and paths match `toolRegistry` in `main.js`.

### Build issues on Windows

* Make sure you’re on a supported Node version
* Run terminal as Admin if permissions block build output

### No logs showing

* Confirm tool scripts are writing to stdout/stderr
* For structured status, emit:

  * `::STATE:: {"phase":"...", "count":123}`

---

## 🗺️ Roadmap (optional)

* [ ] Save + load tool presets
* [ ] Per-tool “recent runs” history
* [ ] Output validation + auto-fix columns
* [ ] Global search across logs
* [ ] Packaging for macOS notarization

---

## ⚠️ Disclaimer

This project is for legitimate data workflows and operational automation.
Make sure your usage complies with the Terms of Service of any platform you interact with.

---

## 📄 License

ISC (see `package.json`).

---

### ⭐ If you use this

If you find this useful for your workflows, drop a star and keep building.

```

---

If you want, I can also:
- add a **“Screenshots”** section (once you drop 2–3 screenshots into `/renderer/assets/`)
- write a cleaner **Contributing** + **Security** section
- tailor the README for **selling** (more “product page” vibe) vs “developer repo” vibe
```
