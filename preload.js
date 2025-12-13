// preload.js
// Secure bridge between Renderer (UI) and Main process

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Run a backend tool (Apify / Blitz / etc.)
   * toolId: string (e.g. "comment-scraper", "email-enricher")
   * payload: any config object (file paths, options, etc.)
   * Returns: Promise<{ runId }>
   */
  runTool: (toolId, payload = {}) => {
    return ipcRenderer.invoke('tool:run', { toolId, payload });
  },

  /**
   * Ask main process to stop a running tool gracefully.
   * runId: the id returned from runTool()
   * Returns: Promise<{ ok: boolean }>
   */
  stopTool: (runId) => {
    return ipcRenderer.invoke('tool:stop', { runId });
  },

  /**
   * Open a directory picker (for choosing input/output folders).
   * Returns: Promise<string | null> (selected path or null if canceled)
   */
  selectDirectory: () => {
    return ipcRenderer.invoke('dialog:select-directory');
  },

  /**
   * Open a file picker (for single file).
   * filters: Electron file filter array
   * Returns: Promise<string | null>
   */
  selectFile: (filters = []) => {
    return ipcRenderer.invoke('dialog:select-file', { filters });
  },

  /**
   * Export / copy sample input files for a given tool.
   * sampleId: string (e.g. "apify-comment-orchestrator")
   * Returns: Promise<{ canceled: boolean, targetDir?: string }>
   */
  downloadSample: (sampleId) => {
    return ipcRenderer.invoke('sample:export', { sampleId });
  },

  /**
   * Subscribe to log lines coming from backend tools.
   * UI will use this to append to the console.
   * Returns: unsubscribe function.
   *
   * data shape:
   *   { runId, toolId, message, level }
   */
  onToolLog: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('tool:log', listener);
    return () => ipcRenderer.removeListener('tool:log', listener);
  },

  /**
   * Subscribe to status updates (started, finished, error, stopping, etc.)
   *
   * data shape:
   *   { runId, toolId, status, metrics? }
   */
  onToolStatus: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('tool:status', listener);
    return () => ipcRenderer.removeListener('tool:status', listener);
  },

  /**
   * Subscribe specifically to "run finished" events.
   *
   * data shape:
   *   { runId, toolId, error? }
   */
  onToolExit: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('tool:exit', listener);
    return () => ipcRenderer.removeListener('tool:exit', listener);
  }
});
