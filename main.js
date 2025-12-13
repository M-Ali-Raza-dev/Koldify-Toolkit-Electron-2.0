// main.js (Electron main process)
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');              // ✅ for sample copying
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

let mainWindow;

/**
 * Map of active runs:
 * runId -> { child, toolId, stopping: boolean }
 */
const runs = new Map();

// ================================
// ✅ TOOL REGISTRY (REAL PATHS)
// ================================
const toolRegistry = {
  // ---------- APIFY TOOLS ----------
  'post-finder': {
    script: path.join(__dirname, 'backend', 'apify', 'post-finder.mjs'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'reaction-scraper': {
    script: path.join(__dirname, 'backend', 'apify', 'post-reaction.mjs'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'comment-scraper': {
    script: path.join(__dirname, 'backend', 'apify', 'comment-orchestrator.js'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'merge-split': {
    script: path.join(__dirname, 'backend', 'apify', 'combined-merge-split.js'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'lead-merger': {
    script: path.join(__dirname, 'backend', 'apify', 'csv-lead-merger.mjs'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'apify-email-enricher': {
    script: path.join(__dirname, 'backend', 'apify', 'email-extractor-main.js'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  'linkedin-profile-enhancer': {
    script: path.join(__dirname, 'backend', 'apify', 'linkedin-profile-enhancer.js'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
    }),
  },

  // ---------- BLITZ TOOLS ----------
  'email-enricher': {
    script: path.join(__dirname, 'backend', 'blitz', 'blitz-email-enricher.js'),
    buildEnv: (payload) => ({
      TOOL_CONFIG: JSON.stringify(payload || {}),
      BLITZ_API_KEY: payload.apiKey || process.env.BLITZ_API_KEY,
    }),
  },

  'waterfall-icp': {
    script: path.join(__dirname, 'backend', 'blitz', 'blitz-waterfall-icp.js'),
    buildEnv: (payload) => ({
      BLITZ_API_KEY: payload.apiKey || process.env.BLITZ_API_KEY,
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

  // BLITZ
  'blitz-email-enricher': path.join('samples', 'blitz', 'blitz-email-enricher'),
  'blitz-waterfall-icp': path.join('samples', 'blitz', 'blitz-waterfall-icp'),
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
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
  mainWindow.webContents.send('tool:log', {
    runId,
    toolId,
    level,
    message,
  });
}

function sendToolStatus(runId, toolId, statusPayload) {
  if (!mainWindow) return;
  mainWindow.webContents.send('tool:status', {
    runId,
    toolId,
    ...statusPayload, // e.g. { status, metrics }
  });
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

  // 1) ::STATE:: { ... } lines (used by blitz-waterfall-icp and others)
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
      // fall through to generic handling if JSON parse fails
    }
  }

  // 2) Pure JSON with a "type" field
  let parsed = null;
  try {
    if (line.startsWith('{') && line.endsWith('}')) {
      parsed = JSON.parse(line);
    }
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
        // expected shape: { type: 'status', status?: string, metrics?: {...} }
        const { status, metrics } = parsed;
        sendToolStatus(runId, toolId, { status, metrics });
        return;
      }

      case 'metrics': {
        // expected: { type: 'metrics', metrics: {...}, status?: string }
        const { metrics, status } = parsed;
        sendToolStatus(runId, toolId, { status, metrics });
        return;
      }

      default:
        // unknown typed JSON -> just log it
        sendToolLog(runId, toolId, defaultLevel, line);
        return;
    }
  }

  // 3) Plain text fallback
  sendToolLog(runId, toolId, defaultLevel, line);
}

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
      envFromConfig.TOOL_CONFIG !== undefined
        ? envFromConfig.TOOL_CONFIG
        : process.env.TOOL_CONFIG,
    RUN_ID: runId,
    TOOL_ID: toolId,
    APP_ROOT: __dirname,  // Pass app root so backend scripts can find node_modules
  };

  // Check that script file exists
  if (!fs.existsSync(scriptPath)) {
    console.error('[MAIN] Script not found:', scriptPath);
    throw new Error(`Script not found: ${scriptPath}`);
  }

  console.error('[MAIN] Script file exists, spawning child process...');

  // use process.execPath so it works when packaged
  // Keep default cwd so Node can find node_modules in app root
  const child = spawn(process.execPath, [scriptPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // DO NOT set cwd - use default (app root) so require() can find node_modules
  });

  runs.set(runId, { child, toolId, stopping: false });
  
  // ERROR event on spawn itself
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
  if (!info) {
    return { ok: false, reason: 'Run not found' };
  }

  const { child, toolId, stopping } = info;

  if (stopping) {
    // already requested
    return { ok: true, reason: 'Already stopping' };
  }

  try {
    // mark as stopping so we don't send multiple signals
    info.stopping = true;
    // SIGINT is our "graceful stop" signal.
    child.kill('SIGINT');

    // inform renderer that stop was requested
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
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:select-file', async (_event, { filters = [] }) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters,
  });
  return result.canceled ? null : result.filePaths[0];
});

// ================================
// 📤 SAMPLE EXPORT HANDLER
// ================================
ipcMain.handle('sample:export', async (_event, { sampleId }) => {
  try {
    const relativeSampleDir = SAMPLE_DIRS[sampleId];
    if (!relativeSampleDir) {
      throw new Error(`Unknown sampleId: ${sampleId}`);
    }

    const appPath = app.getAppPath();
    const sourceDir = path.join(appPath, relativeSampleDir);

    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Sample directory not found: ${sourceDir}`);
    }

    // Let user choose a destination folder
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select folder to copy sample files into',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (canceled || !filePaths || !filePaths[0]) {
      return { canceled: true };
    }

    const targetRoot = filePaths[0];
    const targetDir = path.join(targetRoot, sampleId); // e.g. /Downloads/apify-comment-orchestrator

    await copyDirectoryRecursive(sourceDir, targetDir);

    return { canceled: false, targetDir };
  } catch (err) {
    console.error('sample:export error:', err);
    throw err;
  }
});
