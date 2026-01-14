// main.js (Electron main process)
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs'); // ✅ for sample copying
const csv = require('csv-parser');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

let mainWindow;

/**
 * Map of active runs:
 * runId -> { child, toolId, stopping: boolean }
 */
const runs = new Map();

// ================================
// ✅ FIX CACHE ERRORS - Must be before app.whenReady()
// ================================
// Set custom user data path to avoid permission issues
const userDataPath = path.join(app.getPath('appData'), 'koldify-toolkit');
app.setPath('userData', userDataPath);

// Disable GPU cache to prevent cache errors
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-program-cache');

// Additional cache-related fixes
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-application-cache');

// ================================
// ✅ PREVENT MULTIPLE APP INSTANCES
// ================================
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ================================
// ✅ PATH HELPERS (DEV vs PACKAGED)
// ================================
// In dev: files exist normally under __dirname
// In packaged: backend + samples are unpacked into:
//   <resources>/app.asar.unpacked/backend/**
//   <resources>/app.asar.unpacked/samples/**
function unpackedPath(...parts) {
  if (!app.isPackaged) return path.join(__dirname, ...parts);
  return path.join(process.resourcesPath, 'app.asar.unpacked', ...parts);
}

// For renderer/preload/main we still use __dirname (they live in app.asar)
function appAsarPath(...parts) {
  return path.join(__dirname, ...parts);
}

// ================================
// ✅ TOOL REGISTRY (REAL PATHS)
// ================================
const toolRegistry = {
  // ---------- APIFY TOOLS ----------
  'post-finder': {
    script: unpackedPath('backend', 'apify', 'post-finder.mjs'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'reaction-scraper': {
    script: unpackedPath('backend', 'apify', 'post-reaction.mjs'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'comment-scraper': {
    script: unpackedPath('backend', 'apify', 'comment-orchestrator.js'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'merge-split': {
    script: unpackedPath('backend', 'apify', 'combined-merge-split.js'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'lead-merger': {
    script: unpackedPath('backend', 'apify', 'csv-lead-merger.mjs'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'apify-email-enricher': {
    script: unpackedPath('backend', 'apify', 'email-extractor-main.js'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'linkedin-profile-enhancer': {
    script: unpackedPath('backend', 'apify', 'linkedin-profile-enhancer.js'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  // New: Contact Details Scraper (Apify actor 9Sk4JJhEma9vBKqrg)
  'contact-details-scraper': {
    script: unpackedPath('backend', 'apify', 'contact-details-scraper.js'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  // ---------- BLITZ TOOLS ----------
  'email-enricher': {
    script: unpackedPath('backend', 'blitz', 'blitz-email-enricher.js'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
      BLITZ_API_KEY: payload.apiKey || process.env.BLITZ_API_KEY,
      LINKEDIN_URL_COLUMN: payload.linkedinUrlColumn || undefined,
    }),
  },

  // NOTE: If your backend uses TOOL_CONFIG, include it.
  'waterfall-icp': {
    script: unpackedPath('backend', 'blitz', 'blitz-waterfall-icp.js'),
    buildEnv: (payload) => ({
      BLITZ_API_KEY: payload.apiKey || process.env.BLITZ_API_KEY,
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'reverse-phone': {
    script: unpackedPath('backend', 'blitz', 'blitz-reverse-phone.js'),
    buildEnv: (payload) => ({
      BLITZ_API_KEY: payload.apiKey || process.env.BLITZ_API_KEY,
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'reverse-email': {
    script: unpackedPath('backend', 'blitz', 'blitz-reverse-email.js'),
    buildEnv: (payload) => ({
      BLITZ_API_KEY: payload.apiKey || process.env.BLITZ_API_KEY,
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'find-mobile-direct-phone': {
    script: unpackedPath('backend', 'blitz', 'blitz-find-mobile-direct-phone.js'),
    buildEnv: (payload) => ({
      BLITZ_API_KEY: payload.apiKey || process.env.BLITZ_API_KEY,
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'linkedin-url-to-domain': {
    script: unpackedPath('backend', 'blitz', 'blitz-linkedin-url-to-domain.js'),
    buildEnv: (payload) => ({
      BLITZ_API_KEY: payload.apiKey || process.env.BLITZ_API_KEY,
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'domain-to-linkedin': {
    script: unpackedPath('backend', 'blitz', 'blitz-domain-to-linkedin.js'),
    buildEnv: (payload) => ({
      BLITZ_API_KEY: payload.apiKey || process.env.BLITZ_API_KEY,
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },
};

// ================================
// 📁 SAMPLE DIRECTORY SUPPORT
// ================================

// Map each sampleId (used in renderer) to its sample folder inside the app
const SAMPLE_DIRS = {
  // APIFY
  'apify-comment-orchestrator': path.join('samples', 'apify', 'comment-orchestrator'),
  'apify-post-finder': path.join('samples', 'apify', 'post-finder'),
  'apify-post-reaction': path.join('samples', 'apify', 'post-reaction'),
  'apify-email-extractor': path.join('samples', 'apify', 'email-extractor'),
  'apify-combined-merge-split': path.join('samples', 'apify', 'combined-merge-split'),
  'apify-csv-lead-merger': path.join('samples', 'apify', 'csv-lead-merger'),
  'linkedin-profile-enhancer': path.join('samples', 'apify', 'linkedin-profile-enhancer'),
  'apify-contact-details-scraper': path.join('samples', 'apify', 'contact-details-scraper'),

  // BLITZ
  'blitz-email-enricher': path.join('samples', 'blitz', 'blitz-email-enricher'),
  'blitz-waterfall-icp': path.join('samples', 'blitz', 'blitz-waterfall-icp'),
  'blitz-reverse-phone': path.join('samples', 'blitz', 'blitz-reverse-phone'),
  'blitz-reverse-email': path.join('samples', 'blitz', 'blitz-reverse-email'),
  'blitz-find-mobile-direct-phone': path.join('samples', 'blitz', 'blitz-find-mobile-direct-phone'),
  'blitz-linkedin-url-to-domain': path.join('samples', 'blitz', 'blitz-linkedin-url-to-domain'),
  'blitz-domain-to-linkedin': path.join('samples', 'blitz', 'blitz-domain-to-linkedin'),
};

// Recursively copy a directory (used for exporting samples)
async function copyDirectoryRecursive(srcDir, destDir) {
  await fs.promises.mkdir(destDir, { recursive: true });

  const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

// ================================
// ✅ CREATE WINDOW
// ================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 900,
    autoHideMenuBar: true, // hide OS menu bar
    webPreferences: {
      preload: appAsarPath('preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(appAsarPath('renderer', 'index.html'));

  // ✅ Prevent new windows from opening
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // ✅ Prevent navigation away from the app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) return event.preventDefault();

    const decoded = decodeURIComponent(url.replace('file:///', '').replace('file://', ''));
    const normalizedTarget = path.normalize(decoded);
    const normalizedApp = path.normalize(app.getAppPath());

    // If target path isn't inside app folder, block it
    if (!normalizedTarget.startsWith(normalizedApp)) {
      event.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  // Remove global application menu (File / Edit / View / Window / Help)
  Menu.setApplicationMenu(null);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ================================
// 🔁 HELPERS TO SEND EVENTS
// ================================
function sendToolLog(runId, toolId, level, message) {
  if (!mainWindow) return;
  mainWindow.webContents.send('tool:log', { runId, toolId, level, message });
}

function sendToolStatus(runId, toolId, statusPayload) {
  if (!mainWindow) return;
  mainWindow.webContents.send('tool:status', { runId, toolId, ...statusPayload });
}

/**
 * Try to parse a stdout line in a few formats:
 * 1) "::STATE:: { ... }"  -> status + metrics (generic state line)
 * 2) "{ ... }" with a "type" field (log/status/metrics)
 * 3) Plain text -> normal log
 */
function handleStdoutLine(runId, toolId, rawLine, defaultLevel = 'info') {
  const line = rawLine.trim();
  if (!line) return;

  // 1) ::STATE:: { ... }
  if (line.startsWith('::STATE::')) {
    const jsonPart = line.slice('::STATE::'.length).trim();
    try {
      const stateObj = JSON.parse(jsonPart);
      if (stateObj && typeof stateObj === 'object') {
        const { phase, ...rest } = stateObj;
        const status = phase || stateObj.status || undefined;
        const metrics = Object.keys(rest).length ? rest : undefined;
        sendToolStatus(runId, toolId, { status, metrics });
        return;
      }
    } catch {
      // fall through
    }
  }

  // 2) Typed JSON
  let parsed = null;
  try {
    if (line.startsWith('{') && line.endsWith('}')) parsed = JSON.parse(line);
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed === 'object' && parsed.type) {
    switch (parsed.type) {
      case 'log': {
        const level = parsed.level || defaultLevel;
        const msg = parsed.message ?? line;
        sendToolLog(runId, toolId, level, msg);
        return;
      }
      case 'status': {
        const { status, metrics } = parsed;
        sendToolStatus(runId, toolId, { status, metrics });
        return;
      }
      case 'metrics': {
        const { metrics, status } = parsed;
        sendToolStatus(runId, toolId, { status, metrics });
        return;
      }
      default:
        sendToolLog(runId, toolId, defaultLevel, line);
        return;
    }
  }

  // 3) Plain text
  sendToolLog(runId, toolId, defaultLevel, line);
}

// ================================
// 📄 CSV PREVIEW (first N rows)
// ================================
ipcMain.handle('csv:preview', async (_event, { filePath, limit = 3 }) => {
  if (!filePath) throw new Error('filePath is required');

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const maxRows = Math.max(1, Number(limit) || 3);

  return new Promise((resolve, reject) => {
    const previewRows = [];
    let headers = [];

    const stream = fs
      .createReadStream(resolvedPath)
      .pipe(csv())
      .on('headers', (h) => {
        headers = Array.isArray(h) ? h : [];
      })
      .on('data', (row) => {
        if (previewRows.length < maxRows) {
          previewRows.push(row);
        }

        // Stop early once we have enough rows
        if (previewRows.length >= maxRows) {
          stream.destroy();
          resolve({ headers, rows: previewRows });
        }
      })
      .on('end', () => resolve({ headers, rows: previewRows }))
      .on('error', reject);
  });
});

// ================================
// ✅ RUN TOOL (tool:run)
// ================================
ipcMain.handle('tool:run', async (_event, { toolId, payload = {} }) => {
  console.error('[MAIN] tool:run called with toolId:', toolId);
  console.error('[MAIN] payload:', JSON.stringify(payload, null, 2));

  const config = toolRegistry[toolId];
  if (!config) throw new Error(`Unknown toolId: ${toolId}`);

  const runId = randomUUID();
  const scriptPath = config.script;
  console.error('[MAIN] scriptPath:', scriptPath);

  const envFromConfig = config.buildEnv ? config.buildEnv(payload) : {};
  console.error('[MAIN] TOOL_CONFIG env:', envFromConfig.TOOL_CONFIG);

  const env = {
    ...process.env,
    ...envFromConfig,
    TOOL_CONFIG:
      envFromConfig.TOOL_CONFIG !== undefined ? envFromConfig.TOOL_CONFIG : process.env.TOOL_CONFIG,
    RUN_ID: runId,
    TOOL_ID: toolId,

    // NOTE: __dirname is inside app.asar when packaged
    APP_ROOT: __dirname,

    // ✅ IMPORTANT: run Electron binary as "node" for child scripts
    ELECTRON_RUN_AS_NODE: '1',
  };

  // Check that script file exists
  if (!fs.existsSync(scriptPath)) {
    console.error('[MAIN] Script not found:', scriptPath);
    throw new Error(`Script not found: ${scriptPath}`);
  }

  console.error('[MAIN] Script file exists, spawning child process...');

  // ✅ Key packaged fixes:
  // - cwd must be a REAL directory (NOT app.asar)
  // - scripts must be REAL files (backend must be asarUnpack'ed)
  const child = spawn(process.execPath, [scriptPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    cwd: process.resourcesPath, // ✅ safe real folder in packaged apps
  });

  runs.set(runId, { child, toolId, stopping: false });

  child.on('error', (err) => {
    console.error('[MAIN] Spawn error:', err);
    sendToolLog(runId, toolId, 'error', `[SPAWN ERROR] ${err.message}`);
  });

  // STDOUT
  child.stdout.on('data', (chunk) => {
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => {
        console.log('[MAIN-STDOUT]', line);
        handleStdoutLine(runId, toolId, line, 'info');
      });
  });

  // STDERR
  child.stderr.on('data', (chunk) => {
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => {
        console.error('[MAIN-STDERR]', line);
        handleStdoutLine(runId, toolId, line, 'error');
      });
  });

  // EXIT
  child.on('close', (code) => {
    console.log('[MAIN] Child process closed with code:', code);
    runs.delete(runId);
    if (mainWindow) {
      mainWindow.webContents.send('tool:exit', {
        runId,
        toolId,
        error: code === 0 ? null : `Exited with code ${code}`,
      });
    }
  });

  return { runId };
});

// ================================
// ✅ STOP TOOL (GRACEFUL) (tool:stop)
// ================================
ipcMain.handle('tool:stop', async (_event, { runId }) => {
  const info = runs.get(runId);
  if (!info) return { ok: false, reason: 'Run not found' };

  const { child, toolId, stopping } = info;
  if (stopping) return { ok: true, reason: 'Already stopping' };

  try {
    info.stopping = true;
    child.kill('SIGINT');
    sendToolStatus(runId, toolId, { status: 'stop-requested' });
    return { ok: true };
  } catch (err) {
    console.error('Failed to stop tool:', err);
    return { ok: false, reason: err.message };
  }
});

// ================================
// ✅ DIRECTORY & FILE PICKERS
// ================================
ipcMain.handle('dialog:select-directory', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:select-file', async (_event, { filters = [] }) => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters });
  return result.canceled ? null : result.filePaths[0];
});

// ================================
// 📤 SAMPLE EXPORT HANDLER
// ================================
ipcMain.handle('sample:export', async (_event, { sampleId }) => {
  try {
    const relativeSampleDir = SAMPLE_DIRS[sampleId];
    if (!relativeSampleDir) throw new Error(`Unknown sampleId: ${sampleId}`);

    // samples are unpacked in production (asarUnpack)
    const sourceDir = unpackedPath(relativeSampleDir);

    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Sample directory not found: ${sourceDir}`);
    }

    // Let user choose a destination folder
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select folder to copy sample files into',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (canceled || !filePaths || !filePaths[0]) return { canceled: true };

    const targetRoot = filePaths[0];
    const targetDir = path.join(targetRoot, sampleId);

    await copyDirectoryRecursive(sourceDir, targetDir);

    return { canceled: false, targetDir };
  } catch (err) {
    console.error('sample:export error:', err);
    throw err;
  }
});
