// renderer/script.js
// Frontend logic for Koldify Toolkit (runs in BrowserWindow)

(function () {
  const electronAPI = window.electronAPI || null;

  // ---------- DOM ELEMENTS ----------
  const toggleButtons = document.querySelectorAll('.toggle-btn');
  const apifySidebar = document.getElementById('apify-sidebar');
  const blitzSidebar = document.getElementById('blitz-sidebar');

  const navTabs = document.querySelectorAll('.nav-tab');
  const toolCards = document.querySelectorAll('.tool-card');

  const runButtons = document.querySelectorAll('[data-role="run-tool"]');
  const resetBtn = document.getElementById('reset-app');

  // ---------- STATE ----------
  const state = {
    currentRunId: null,
    currentToolId: null,
    running: false,
    stopping: false,
  };

  // ---------- LOG HELPERS ----------
  function appendToolLog(toolId, message, level = 'info') {
    if (!toolId) return;
    const consoleEl = document.getElementById(`console-${toolId}`);
    if (!consoleEl) return;

    const line = document.createElement('div');
    line.textContent = message;
    if (level === 'error') {
      line.style.color = '#ff6b6b';
    } else if (level === 'warn') {
      line.style.color = '#ffd166';
    }
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function appendLog(toolId, message, level = 'info') {
    appendToolLog(toolId, message, level);
  }

  // ---------- RUN / STOP BUTTON UI ----------
  runButtons.forEach((btn) => {
    if (!btn.dataset.defaultHtml) {
      btn.dataset.defaultHtml = btn.innerHTML;
    }
  });

  function setRunningUI(isRunning, toolId = null) {
    state.running = isRunning;

    runButtons.forEach((btn) => {
      const thisToolId = btn.getAttribute('data-tool-id');

      if (isRunning) {
        if (thisToolId === toolId) {
          btn.disabled = false;
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-danger');
          btn.innerHTML = 'Stop';
        } else {
          btn.disabled = true;
        }
      } else {
        btn.disabled = false;
        btn.classList.remove('btn-danger');
        btn.classList.add('btn-primary');
        if (btn.dataset.defaultHtml) {
          btn.innerHTML = btn.dataset.defaultHtml;
        }
      }
    });
  }

  function setStoppingUI(isStopping) {
    state.stopping = isStopping;
  }

  function resetState() {
    state.currentRunId = null;
    state.currentToolId = null;
    setRunningUI(false, null);
    setStoppingUI(false);
  }

  // ---------- METRICS ----------
  function updateMetrics(toolId, metrics = {}) {
    if (!toolId || !metrics) return;
    
    console.log('[DEBUG] updateMetrics called:', { toolId, metrics });

    const set = (dataMetricName, value) => {
      const el = document.querySelector(`[data-metric="${dataMetricName}"]`);
      if (el && typeof value !== 'undefined') {
        console.log('[DEBUG] Setting metric:', dataMetricName, '=', value);
        el.textContent = String(value);
      } else if (!el) {
        console.log('[DEBUG] Metric element not found:', dataMetricName);
      }
    };

    switch (toolId) {
      // APIFY
      case 'post-finder':
        set('post-finder-total-keys', metrics.totalKeys);
        set('post-finder-posts-found', metrics.postsFound);
        break;

      case 'reaction-scraper':
        set('reaction-posts-processed', metrics.postsProcessed);
        set('reaction-unique-reactors', metrics.uniqueReactors);
        break;

      case 'merge-split':
        set('merge-files-found', metrics.filesFound);
        set('merge-chunks-created', metrics.chunksCreated);
        break;

      case 'lead-merger':
        set('lead-files-merged', metrics.filesMerged);
        set('lead-total-leads', metrics.totalLeads);
        set('lead-duplicates-removed', metrics.duplicatesRemoved);
        break;

      case 'comment-scraper':
        set('comment-total-posts', metrics.totalPosts);
        set('comment-processed-posts', metrics.processedPosts);
        set('comment-active-keys', metrics.activeKeys);
        set('comment-keys-banned', metrics.keysBanned);
        break;

      case 'apify-email-enricher':
        set('apify-email-files-processed', metrics.filesProcessed || 0);
        set('apify-email-rows-processed', metrics.remainingQuota !== undefined ? metrics.remainingQuota : 0);
        set('apify-email-enriched-rows', metrics.apiKeysLoaded || 0);
        break;

      case 'linkedin-profile-enhancer':
        set('linkedin-profile-processed', metrics.profilesProcessed || 0);
        set('linkedin-profile-valid', metrics.validProfiles || 0);
        set('linkedin-profile-keys-active', metrics.keysActive || 0);
        break;

      // BLITZ
      case 'email-enricher':
        set('blitz-email-rows-processed', metrics.rowsProcessed);
        set('blitz-email-found', metrics.emailsFound);
        set('blitz-email-not-found', metrics.emailsNotFound);
        break;

      case 'waterfall-icp':
        set('waterfall-companies-processed', metrics.companiesProcessed);
        set('waterfall-contacts-found', metrics.contactsFound);
        set('waterfall-no-matches', metrics.noMatches);
        break;

      default:
        break;
    }
  }

  // ---------- SECTION TOGGLE (Apify / Blitz) ----------
  function handleSectionToggle(section) {
    toggleButtons.forEach((btn) => {
      const btnSection = btn.getAttribute('data-section');
      if (btnSection === section) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    if (apifySidebar) {
      apifySidebar.classList.toggle('hidden', section !== 'apify');
    }
    if (blitzSidebar) {
      blitzSidebar.classList.toggle('hidden', section !== 'blitz');
    }

    let activeToolId = null;
    if (section === 'apify' && apifySidebar) {
      const activeTab =
        apifySidebar.querySelector('.nav-tab.active') ||
        apifySidebar.querySelector('.nav-tab[data-tool]');
      activeToolId = activeTab
        ? activeTab.getAttribute('data-tool')
        : 'post-finder';
    } else if (section === 'blitz' && blitzSidebar) {
      const activeTab =
        blitzSidebar.querySelector('.nav-tab.active') ||
        blitzSidebar.querySelector('.nav-tab[data-tool]');
      activeToolId = activeTab
        ? activeTab.getAttribute('data-tool')
        : 'email-enricher';
    }

    toolCards.forEach((card) => {
      const cardSection = card.getAttribute('data-section');
      const cardId = card.id;
      const shouldShow = cardSection === section && cardId === activeToolId;
      card.classList.toggle('hidden', !shouldShow);
    });
  }

  function initSectionToggle() {
    toggleButtons.forEach((btn) => {
      const section = btn.getAttribute('data-section');
      if (!section) return;
      btn.addEventListener('click', () => handleSectionToggle(section));
    });

    handleSectionToggle('apify');
  }

  // ---------- SIDEBAR NAV TABS ----------
  function showToolCard(toolId, section) {
    toolCards.forEach((card) => {
      const cardSection = card.getAttribute('data-section');
      const cardId = card.id;
      const shouldShow = cardSection === section && cardId === toolId;
      card.classList.toggle('hidden', !shouldShow);
    });
  }

  function initNavTabs() {
    navTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const toolId = tab.getAttribute('data-tool');
        const section =
          tab.closest('.sidebar')?.id === 'blitz-sidebar' ? 'blitz' : 'apify';

        const siblingTabs =
          tab.closest('.sidebar')?.querySelectorAll('.nav-tab') || [];
        siblingTabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');

        showToolCard(toolId, section);
      });
    });
  }

  // ---------- DIRECTORY PICKERS ----------
  function initDirPickers() {
    if (!electronAPI) return;

    const dirButtons = document.querySelectorAll('[data-role="pick-dir"]');
    dirButtons.forEach((btn) => {
      const targetId = btn.getAttribute('data-target');
      if (!targetId) return;

      btn.addEventListener('click', async () => {
        try {
          const selectedPath = await electronAPI.selectDirectory();
          if (!selectedPath) return;

          const input = document.getElementById(targetId);
          if (input) {
            input.value = selectedPath;
          }
        } catch (err) {
          console.error('Failed to open folder picker:', err);
        }
      });
    });
  }

  // ---------- SAMPLE INPUT BUTTONS ----------
  function initSampleButtons() {
    if (!electronAPI || !electronAPI.downloadSample) return;

    const sampleButtons = document.querySelectorAll('.sample-btn');

    sampleButtons.forEach((btn) => {
      const sampleId = btn.getAttribute('data-sample-id');
      if (!sampleId) return;

      btn.addEventListener('click', async () => {
        try {
          const result = await electronAPI.downloadSample(sampleId);
          if (result && !result.canceled && result.targetDir) {
            alert(`Sample files copied to:\n${result.targetDir}`);
          }
        } catch (err) {
          console.error('Failed to export sample files:', err);
          alert('Failed to export sample files. Check console for details.');
        }
      });
    });
  }

  // ---------- COLLECT CONFIG PER TOOL ----------
  function collectToolConfig(toolId) {
    const card = document.getElementById(toolId);
    if (!card) return {};

    const inputs = card.querySelectorAll('.form-field .input-field');

    switch (toolId) {
      // -------- APIFY --------
      case 'post-finder': {
        const keywordInput = inputs[0];
        const perKeyInput = inputs[1];
        const keysFileInput = inputs[2];
        const outputDirInput = inputs[3];

        const keyword = keywordInput?.value?.trim() || '';
        const perKeyLimit = Number(perKeyInput?.value || 0) || 0;

        let keysFilePath = '';
        if (keysFileInput && keysFileInput.files && keysFileInput.files[0]) {
          keysFilePath = keysFileInput.files[0].path || '';
        }

        const outputDir = outputDirInput?.value?.trim() || '';

        return {
          keyword,
          perKeyLimit,
          keysFilePath,
          outputDir,
        };
      }

      case 'reaction-scraper': {
        const postsFileInput = inputs[0];
        const keysFileInput = inputs[1];
        const perKeyInput = inputs[2];
        const outputDirInput = inputs[3];

        const postsCsvPaths = [];
        if (postsFileInput && postsFileInput.files) {
          for (const f of postsFileInput.files) {
            if (f && f.path) postsCsvPaths.push(f.path);
          }
        }

        let keysFilePath = '';
        if (keysFileInput && keysFileInput.files && keysFileInput.files[0]) {
          keysFilePath = keysFileInput.files[0].path || '';
        }

        const perKeyLimit = Number(perKeyInput?.value || 0) || 0;
        const outputDir = outputDirInput?.value?.trim() || '';

        return {
          postsCsvPaths,
          keysFilePath,
          perKeyLimit,
          outputDir,
        };
      }

      case 'merge-split': {
        const inputDirInput = inputs[0];
        const outputDirInput = inputs[1];
        const maxRowsInput = inputs[2];
        const modeSelect = inputs[3];

        const inputDir = inputDirInput?.value?.trim() || '';
        const outputDir = outputDirInput?.value?.trim() || '';
        const maxRowsPerChunk = Number(maxRowsInput?.value || 0) || 0;
        const mode = modeSelect?.value || 'merge-split';

        return {
          inputDir,
          outputDir,
          maxRowsPerChunk,
          mode,
        };
      }

      case 'lead-merger': {
        const inputDirInput = inputs[0];
        const outputDirInput = inputs[1];

        const checkboxes = card.querySelectorAll(
          '.checkbox-row input[type="checkbox"]'
        );
        const dedupeByEmail = !!checkboxes[0]?.checked;
        const normalizeHeaders = !!checkboxes[1]?.checked;

        const inputDir = inputDirInput?.value?.trim() || '';
        const outputDir = outputDirInput?.value?.trim() || '';

        return {
          inputDir,
          outputDir,
          dedupeByEmail,
          normalizeHeaders,
        };
      }

      case 'comment-scraper': {
        const postsFileInput = inputs[0];
        const keysFileInput = inputs[1];
        const limitInput = inputs[2];
        const outputDirInput = inputs[3];

        const postsCsvPaths = [];
        if (postsFileInput && postsFileInput.files) {
          for (const f of postsFileInput.files) {
            if (f && f.path) postsCsvPaths.push(f.path);
          }
        }

        let keysFilePath = '';
        if (keysFileInput && keysFileInput.files && keysFileInput.files[0]) {
          keysFilePath = keysFileInput.files[0].path || '';
        }

        const limitPerKey = Number(limitInput?.value || 0) || 0;
        const outputDir = outputDirInput?.value?.trim() || '';

        return {
          postsCsvPaths,
          keysFilePath,
          limitPerKey,
          outputDir,
        };
      }

      case 'apify-email-enricher': {
        const inputDirInput = inputs[0];
        const outputDirInput = inputs[1];
        const keysFileInput = inputs[2];
        const actorIdInput = inputs[3];
        const csvSizeInput = inputs[4];
        const csvsPerKeyInput = inputs[5];
        const concurrencyInput = inputs[6];

        const checkboxes = card.querySelectorAll(
          '.checkbox-row input[type="checkbox"]'
        );
        const overwrite = !!checkboxes[0]?.checked;
        const append = !!checkboxes[1]?.checked;

        const inputDir = inputDirInput?.value?.trim() || '';
        const outputDir = outputDirInput?.value?.trim() || '';

        let keysFilePath = '';
        if (keysFileInput && keysFileInput.files && keysFileInput.files[0]) {
          keysFilePath = keysFileInput.files[0].path || '';
        }

        const actorOrFlowId = actorIdInput?.value?.trim() || '';
        const csvSize = Number(csvSizeInput?.value || 100) || 100;
        const csvsPerKey = Number(csvsPerKeyInput?.value || 10) || 10;
        const concurrency = Number(concurrencyInput?.value || 5) || 5;

        return {
          inputDir,
          outputDir,
          keysFilePath,
          actorOrFlowId,
          csvSize,
          csvsPerKey,
          concurrency,
          overwrite,
          append,
        };
      }

      case 'linkedin-profile-enhancer': {
        const inputCsvInput = inputs[0];
        const outputDirInput = inputs[1];
        const keysFileInput = inputs[2];
        const batchSizeInput = inputs[3];
        const maxCreditsInput = inputs[4];
        const actorIdInput = inputs[5];

        let inputCsv = '';
        if (inputCsvInput && inputCsvInput.files && inputCsvInput.files[0]) {
          inputCsv = inputCsvInput.files[0].path || '';
        }

        const outputDir = outputDirInput?.value?.trim() || '';

        if (!inputCsv) {
          alert('Please select an input CSV file');
          return null;
        }

        if (!outputDir) {
          alert('Please select an output folder');
          return null;
        }

        let keysFilePath = '';
        if (keysFileInput && keysFileInput.files && keysFileInput.files[0]) {
          keysFilePath = keysFileInput.files[0].path || '';
        }

        if (!keysFilePath) {
          alert('Please upload keys.json file');
          return null;
        }

        const batchSize = Number(batchSizeInput?.value || 10) || 10;
        const maxCredits = Number(maxCreditsInput?.value || 1600) || 1600;
        const actorId = actorIdInput?.value?.trim() || 'yZnhB5JewWf9xSmoM';

        return {
          inputCsv,
          outputDir,
          keysFilePath,
          batchSize,
          maxCredits,
          actorId,
        };
      }

      // -------- BLITZ --------
      case 'email-enricher': {
        const apiKey = document.getElementById('blitz-email-api-key')?.value?.trim() || '';
        const inputDir = document.getElementById('blitz-email-input-dir')?.value?.trim() || '';
        const outputDir = document.getElementById('blitz-email-output-dir')?.value?.trim() || '';
        const outputFileName = document.getElementById('blitz-email-output-filename')?.value?.trim() || 'enriched_output.csv';

        if (!inputDir) {
          alert('Please select an input folder');
          return null;
        }

        if (!outputDir) {
          alert('Please select an output folder');
          return null;
        }

        return {
          apiKey,
          inputDir,
          outputFileName,
          outputFile: `${outputDir}\\${outputFileName}`,
          streamAppend: true,
        };
      }

      case 'waterfall-icp': {
        const apiKeyInput = inputs[0];
        const companiesFileInput = inputs[1];
        const includeTitlesInput = inputs[2];
        const excludeTitlesInput = inputs[3];
        const locationsInput = inputs[4];
        const maxResultsInput = inputs[5];
        const outputDirInput = inputs[6];
        const outputFileInput = inputs[7];

        const apiKey = apiKeyInput?.value?.trim() || '';

        let companiesCsvPath = '';
        if (companiesFileInput?.files?.[0]) {
          companiesCsvPath = companiesFileInput.files[0].path || '';
        }

        let includeTitlesCsvPath = '';
        if (includeTitlesInput?.files?.[0]) {
          includeTitlesCsvPath = includeTitlesInput.files[0].path || '';
        }

        let excludeTitlesCsvPath = '';
        if (excludeTitlesInput?.files?.[0]) {
          excludeTitlesCsvPath = excludeTitlesInput.files[0].path || '';
        }

        let locationsCsvPath = '';
        if (locationsInput?.files?.[0]) {
          locationsCsvPath = locationsInput.files[0].path || '';
        }

        const maxResultsPerCompany =
          Number(maxResultsInput?.value || 0) || 0;
        const outputDir = outputDirInput?.value?.trim() || '';
        const outputFile = outputFileInput?.value?.trim() || '';

        return {
          apiKey,
          companiesCsvPath,
          includeTitlesCsvPath,
          excludeTitlesCsvPath,
          locationsCsvPath,
          maxResultsPerCompany,
          outputDir,
          outputFile,
          streamAppend: true,
        };
      }

      default:
        return {};
    }
  }

  // ---------- START TOOL ----------
  async function startTool(toolId) {
    if (!electronAPI) {
      appendLog(
        toolId,
        'Electron API not available. Are you running inside Electron?',
        'error'
      );
      return;
    }

    if (state.running) {
      appendLog(
        toolId,
        'Another tool is already running. Please stop it before starting a new one.',
        'warn'
      );
      return;
    }

    const consoleEl = document.getElementById(`console-${toolId}`);
    if (consoleEl) consoleEl.textContent = 'Starting...\n';

    appendLog(toolId, `▶ Starting tool: ${toolId}`);

    setRunningUI(true, toolId);
    setStoppingUI(false);

    try {
      const payload = collectToolConfig(toolId);
      console.log('[DEBUG] Collected payload:', payload);

      if (toolId === 'apify-email-enricher') {
        console.log('[DEBUG] Validating Apify Email Enricher...');
        console.log('[DEBUG] inputDir:', payload.inputDir);
        console.log('[DEBUG] outputDir:', payload.outputDir);
        console.log('[DEBUG] keysFilePath:', payload.keysFilePath);
        console.log('[DEBUG] actorOrFlowId:', payload.actorOrFlowId);
        
        if (!payload.inputDir) throw new Error('Input folder is required.');
        if (!payload.outputDir) throw new Error('Output folder is required.');
        if (!payload.keysFilePath) throw new Error('Keys file (keys.json) is required.');
        if (!payload.actorOrFlowId) throw new Error('Actor ID / Flow ID is required.');
        console.log('[DEBUG] All validations passed!');
      }

      if (toolId === 'linkedin-profile-enhancer') {
        console.log('[DEBUG] Validating LinkedIn Profile Enhancer...');
        console.log('[DEBUG] inputCsv:', payload.inputCsv);
        console.log('[DEBUG] outputDir:', payload.outputDir);
        console.log('[DEBUG] keysFilePath:', payload.keysFilePath);
        
        if (!payload.inputCsv) throw new Error('Input CSV file is required.');
        if (!payload.outputDir) throw new Error('Output folder is required.');
        if (!payload.keysFilePath) throw new Error('Keys file (keys.json) is required.');
        console.log('[DEBUG] All validations passed!');
      }

      console.log('[DEBUG] Calling electronAPI.runTool with:', toolId, payload);
      const result = await electronAPI.runTool(toolId, payload);
      console.log('[DEBUG] Got result:', result);
      const runId = result?.runId;

      if (!runId) {
        throw new Error('No runId returned from main process.');
      }

      state.currentRunId = runId;
      state.currentToolId = toolId;
      appendLog(toolId, `✓ Tool "${toolId}" started (runId: ${runId})`);
    } catch (err) {
      console.error('[ERROR] startTool error:', err);
      appendLog(
        toolId,
        `✗ Failed to start tool "${toolId}": ${err.message}`,
        'error'
      );
      resetState();
    }
  }

  // ---------- STOP (GRACEFUL) ----------
  async function requestStopForCurrent() {
    if (!electronAPI) return;

    if (!state.running || !state.currentRunId) {
      if (state.currentToolId) {
        appendLog(state.currentToolId, 'No tool is currently running.', 'warn');
      }
      return;
    }

    if (state.stopping) {
      appendLog(
        state.currentToolId,
        'Already stopping current run…',
        'warn'
      );
      return;
    }

    setStoppingUI(true);
    appendLog(
      state.currentToolId,
      '⏹ Stop requested. No new requests will be scheduled; waiting for in-flight work to complete…'
    );

    try {
      await electronAPI.stopTool(state.currentRunId);
    } catch (err) {
      appendLog(
        state.currentToolId,
        `✗ Failed to send stop signal: ${err.message}`,
        'error'
      );
      setStoppingUI(false);
    }
  }

  function initRunButtons() {
    runButtons.forEach((btn) => {
      const toolId = btn.getAttribute('data-tool-id');
      if (!toolId) return;

      btn.addEventListener('click', () => {
        if (!state.running) {
          startTool(toolId);
          return;
        }

        if (state.running && state.currentToolId === toolId) {
          requestStopForCurrent();
          return;
        }

        appendLog(
          toolId,
          'Another tool is already in progress. Wait for it to finish or stop it first.',
          'warn'
        );
      });
    });
  }

  // ---------- RESET BUTTON ----------
  function initResetButton() {
    if (!resetBtn) return;

    resetBtn.addEventListener('click', () => {
      if (state.running) {
        appendLog(
          state.currentToolId,
          'Cannot reset while a tool is running. Please stop it first.',
          'warn'
        );
        return;
      }

      const allTextInputs = document.querySelectorAll(
        '.tool-card .input-field'
      );
      allTextInputs.forEach((inp) => {
        if (inp.type === 'number') {
          return;
        }
        if (inp.type === 'password') {
          inp.value = '';
          return;
        }
        if (inp.type === 'file') {
          inp.value = '';
          return;
        }
        inp.value = inp.defaultValue || '';
      });

      const allCheckboxes = document.querySelectorAll(
        '.tool-card .checkbox-row input[type="checkbox"]'
      );
      allCheckboxes.forEach((cb) => {
        cb.checked = cb.defaultChecked;
      });

      const metricElements = document.querySelectorAll('[data-metric]');
      metricElements.forEach((el) => {
        el.textContent = '0';
      });

      toolCards.forEach((card) => {
        const toolId = card.id;
        const consoleEl = document.getElementById(`console-${toolId}`);
        if (consoleEl) {
          consoleEl.textContent = 'Waiting for execution...';
          consoleEl.style.maxHeight = '4rem'; // reset to collapsed size
        }
      });

      resetState();
      handleSectionToggle('apify');
      appendLog('post-finder', 'App reset to initial state.');
    });
  }

  // ---------- PER-TOOL CONSOLE TOGGLES ----------
  function initPerToolConsoleToggles() {
    const consoleToggleButtons =
      document.querySelectorAll('.console-toggle');

    consoleToggleButtons.forEach((btn) => {
      const toolId = btn.getAttribute('data-tool-id');
      if (!toolId) return;

      const consoleEl = document.getElementById(`console-${toolId}`);
      if (!consoleEl) return;

      // start small
      consoleEl.style.maxHeight = '4rem';
      btn.dataset.expanded = 'false';
      btn.textContent = 'Expand Log';

      btn.addEventListener('click', () => {
        const isExpanded = btn.dataset.expanded === 'true';

        if (isExpanded) {
          // shrink
          consoleEl.style.maxHeight = '4rem';
          btn.dataset.expanded = 'false';
          btn.textContent = 'Expand Log';
        } else {
          // expand big
          consoleEl.style.maxHeight = '22rem';
          btn.dataset.expanded = 'true';
          btn.textContent = 'Shrink Log';
        }
      });
    });
  }

  // ---------- IPC LISTENERS ----------
  function initIpcListeners() {
    if (!electronAPI) {
      console.warn(
        'Electron API not present – running in plain browser mode.'
      );
      return;
    }

    electronAPI.onToolLog((data) => {
      if (
        state.currentRunId &&
        data.runId &&
        data.runId !== state.currentRunId
      )
        return;
      const toolId = data.toolId || state.currentToolId || 'tool';
      appendLog(toolId, data.message, data.level || 'info');
    });

    electronAPI.onToolStatus((data) => {
      if (
        state.currentRunId &&
        data.runId &&
        data.runId !== state.currentRunId
      )
        return;

      const toolId = data.toolId || state.currentToolId || 'tool';
      if (data.status) {
        appendLog(toolId, `ℹ Status: ${data.status}`, 'info');
      }
      if (data.metrics) {
        updateMetrics(toolId, data.metrics);
      }
    });

    electronAPI.onToolExit((data) => {
      // Always reset the UI when any tool exits so buttons return to normal
      const toolId = data.toolId || state.currentToolId || 'tool';
      const msg = data.error
        ? `✗ Tool "${toolId}" exited with error: ${data.error}`
        : `✓ Tool "${toolId}" finished.`;

      appendLog(toolId, msg, data.error ? 'error' : 'info');
      resetState();
    });
  }

  // ---------- INIT ----------
  document.addEventListener('DOMContentLoaded', () => {
    initSectionToggle();
    initNavTabs();
    initRunButtons();
    initDirPickers();
    initSampleButtons();          // 👈 NEW
    initPerToolConsoleToggles();
    initIpcListeners();
    initResetButton();
  });
})();
