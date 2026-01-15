// renderer/script.js
// Frontend logic for Koldify Toolkit (runs in BrowserWindow)

(function () {
  const electronAPI = window.electronAPI || null;

  // ---------- DOM ELEMENTS ----------
  const toggleButtons = document.querySelectorAll('.toggle-btn');
  const apifySidebar = document.getElementById('apify-sidebar');
  const blitzSidebar = document.getElementById('blitz-sidebar');
  const inhouseSidebar = document.getElementById('inhouse-sidebar');

  const blitzUrlSelect = document.getElementById('blitz-email-url-column');
  const blitzInputFile = document.getElementById('blitz-email-input-file');

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

  // ---------- BLITZ EMAIL PREVIEW ----------
  function detectLinkedinColumn(headers = []) {
    const lowered = headers.map((h) => h.toLowerCase());
    const candidates = lowered.filter((h) => h.includes('linkedin') || h.includes('profile'));
    if (!candidates.length) return '';

    // Prefer headers that also mention url/id
    const urlish = candidates.find((h) => h.includes('url') || h.includes('link'));
    const chosen = urlish || candidates[0];
    const originalIdx = lowered.indexOf(chosen);
    return headers[originalIdx] || '';
  }

  function populateBlitzUrlSelect(headers = []) {
    if (!blitzUrlSelect) return;
    const previous = blitzUrlSelect.value;

    blitzUrlSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = headers.length ? 'Pick LinkedIn URL column' : 'Select a column';
    blitzUrlSelect.appendChild(placeholder);

    headers.forEach((h) => {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = h;
      blitzUrlSelect.appendChild(opt);
    });

    if (previous && headers.includes(previous)) {
      blitzUrlSelect.value = previous;
    }
  }

  async function loadBlitzHeaders() {
    if (!electronAPI || !blitzInputFile) return;
    const filePath = blitzInputFile.value?.trim();
    if (!filePath) return;

    try {
      const { headers = [] } = await electronAPI.previewCsv(filePath, 1);
      populateBlitzUrlSelect(headers);

      const detected = detectLinkedinColumn(headers);
      if (detected && blitzUrlSelect && !blitzUrlSelect.value) {
        blitzUrlSelect.value = detected;
      }
    } catch (err) {
      console.error('Failed to read CSV headers:', err);
    }
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

      case 'comment-scraper':
        set('comment-total-posts', metrics.totalPosts);
        set('comment-processed-posts', metrics.processedPosts);
        set('comment-active-keys', metrics.activeKeys);
        set('comment-keys-banned', metrics.keysBanned);
        break;

      case 'apify-email-enricher':
        set('apify-email-files-processed', metrics.filesProcessed || 0);
        set(
          'apify-email-rows-processed',
          metrics.remainingQuota !== undefined ? metrics.remainingQuota : 0
        );
        set('apify-email-enriched-rows', metrics.apiKeysLoaded || 0);
        break;

      case 'linkedin-profile-enhancer':
        set('linkedin-profile-processed', metrics.profilesProcessed || 0);
        set('linkedin-profile-valid', metrics.validProfiles || 0);
        set('linkedin-profile-keys-active', metrics.keysActive || 0);
        break;

      case 'contact-details-scraper': {
        set('contact-total-keys', metrics.totalKeys);
        set('contact-chunks-processed', metrics.chunksProcessed);
        set('contact-urls-total', metrics.urlsTotal);
        break;
      }

      // BLITZ
      case 'email-enricher':
        set('blitz-email-total-rows', metrics.totalRows);
        set('blitz-email-rows-processed', metrics.rowsProcessed);
        set('blitz-email-skipped-done', metrics.skippedDone);
        set('blitz-email-found', metrics.emailsFound);
        set('blitz-email-not-found', metrics.emailsNotFound);
        break;

      case 'waterfall-icp':
        set('waterfall-companies-processed', metrics.companiesProcessed);
        set('waterfall-contacts-found', metrics.contactsFound);
        set('waterfall-no-matches', metrics.noMatches);
        break;

      case 'reverse-phone':
        set('reverse-phone-total', metrics.totalPhones);
        set('reverse-phone-processed', metrics.phonesProcessed);
        set('reverse-phone-found', metrics.phonesFound);
        set('reverse-phone-not-found', metrics.phonesNotFound);
        break;

      case 'reverse-email':
        set('reverse-email-total', metrics.totalEmails);
        set('reverse-email-processed', metrics.emailsProcessed);
        set('reverse-email-found', metrics.emailsFound);
        set('reverse-email-not-found', metrics.emailsNotFound);
        break;

      case 'find-mobile-direct-phone':
        set('find-phone-total', metrics.totalUrls);
        set('find-phone-processed', metrics.urlsProcessed);
        set('find-phone-found', metrics.phonesFound);
        set('find-phone-not-found', metrics.phonesNotFound);
        break;

      case 'linkedin-url-to-domain':
        set('domain-total', metrics.totalUrls);
        set('domain-processed', metrics.urlsProcessed);
        set('domain-found', metrics.domainsFound);
        set('domain-not-found', metrics.domainsNotFound);
        break;

      case 'domain-to-linkedin':
        set('domain-linkedin-total', metrics.totalDomains);
        set('domain-linkedin-processed', metrics.domainsProcessed);
        set('domain-linkedin-found', metrics.urlsFound);
        set('domain-linkedin-not-found', metrics.urlsNotFound);
        break;

      case 'blitz-employee-finder':
        set('employee-input-rows', metrics.inputRows);
        set('employee-output-rows', metrics.outputRows);
        set('employee-clean-rows', metrics.cleanRows);
        set('employee-issue-rows', metrics.issueRows);
        break;

      // INHOUSE
      case 'csv-splitter': {
        set('csv-splitter-total-rows', metrics['csv-splitter-total-rows']);
        set('csv-splitter-parts', metrics['csv-splitter-parts']);
        set('csv-splitter-output', metrics['csv-splitter-output']);
        break;
      }

      case 'csv-merger':
        set('csv-merger-files', metrics['csv-merger-files']);
        set('csv-merger-rows', metrics['csv-merger-rows']);
        set('csv-merger-columns', metrics['csv-merger-columns']);
        break;

      default:
        break;
    }
  }

  // ---------- SECTION TOGGLE (Apify / Inhouse / Blitz) ----------
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
    if (inhouseSidebar) {
      inhouseSidebar.classList.toggle('hidden', section !== 'inhouse');
    }
    if (blitzSidebar) {
      blitzSidebar.classList.toggle('hidden', section !== 'blitz');
    }

    let activeToolId = null;
    if (section === 'apify' && apifySidebar) {
      const activeTab =
        apifySidebar.querySelector('.nav-tab.active') ||
        apifySidebar.querySelector('.nav-tab[data-tool]');
      activeToolId = activeTab ? activeTab.getAttribute('data-tool') : 'post-finder';
    } else if (section === 'inhouse' && inhouseSidebar) {
      const activeTab =
        inhouseSidebar.querySelector('.nav-tab.active') ||
        inhouseSidebar.querySelector('.nav-tab[data-tool]');
      activeToolId = activeTab ? activeTab.getAttribute('data-tool') : null;
    } else if (section === 'blitz' && blitzSidebar) {
      const activeTab =
        blitzSidebar.querySelector('.nav-tab.active') ||
        blitzSidebar.querySelector('.nav-tab[data-tool]');
      activeToolId = activeTab ? activeTab.getAttribute('data-tool') : 'blitz-key-info';
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

    handleSectionToggle('inhouse');
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
        let section = 'apify';
        const sidebarId = tab.closest('.sidebar')?.id;
        if (sidebarId === 'blitz-sidebar') {
          section = 'blitz';
        } else if (sidebarId === 'inhouse-sidebar') {
          section = 'inhouse';
        }

        const siblingTabs = tab.closest('.sidebar')?.querySelectorAll('.nav-tab') || [];
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
          if (input) input.value = selectedPath;
        } catch (err) {
          console.error('Failed to open folder picker:', err);
        }
      });
    });
  }

  // ---------- FILE PICKERS ----------
  function initFilePickers() {
    if (!electronAPI) return;

    const fileButtons = document.querySelectorAll('[data-role="pick-file"]');
    fileButtons.forEach((btn) => {
      const targetId = btn.getAttribute('data-target');
      if (!targetId) return;

      btn.addEventListener('click', async () => {
        try {
          let filters = [];
          const filtersAttr = btn.getAttribute('data-filters');
          if (filtersAttr) {
            try {
              filters = JSON.parse(filtersAttr).map(([name, extensions]) => ({
                name,
                extensions,
              }));
            } catch {}
          }

          const selectedPath = await electronAPI.selectFile({ filters });
          if (!selectedPath) return;

          const input = document.getElementById(targetId);
          if (input) {
            input.value = selectedPath;
            input.dispatchEvent(new Event('change'));
          }
        } catch (err) {
          console.error('Failed to open file picker:', err);
        }
      });
    });
  }

  function initBlitzPreview() {
    if (!electronAPI) return;

    if (blitzInputFile) {
      blitzInputFile.addEventListener('change', () => {
        if (blitzInputFile.value?.trim()) {
          loadBlitzHeaders();
        }
      });
    }
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

    // helper for Contact Details Scraper: only apply dept filter when Lead enrichment output is involved
    const isLeadEnrichmentOutput = (choice) => {
      // 3 = Lead enrichment only
      // 4 = Lead + Social
      // 5 = All outputs
      return choice === '3' || choice === '4' || choice === '5';
    };

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
        if (keysFileInput?.files?.[0]) keysFilePath = keysFileInput.files[0].path || '';

        const outputDir = outputDirInput?.value?.trim() || '';

        return { keyword, perKeyLimit, keysFilePath, outputDir };
      }

      case 'contact-details-scraper': {
        const inputCsvInput = inputs[0];
        const keysFileInput = inputs[1];
        const urlColInput = inputs[2];
        const batchSizeInput = inputs[3];
        const outputDirInput = inputs[4];
        const outputChoiceSelect = inputs[5];

        let inputCsvPath = '';
        if (inputCsvInput?.files?.[0]) inputCsvPath = inputCsvInput.files[0].path || '';

        let keysFilePath = '';
        if (keysFileInput?.files?.[0]) keysFilePath = keysFileInput.files[0].path || '';

        const urlCol = urlColInput?.value?.trim() || '';
        const batchSize = Number(batchSizeInput?.value || 100) || 100;
        const outputDir = outputDirInput?.value?.trim() || '';
        const outputChoice = outputChoiceSelect?.value || '5';

        // Departments multi-select state from embedded UI (no enable toggle)
        let selectedDepartments = [];
        const chipsWrap = document.getElementById('chips-contact');
        if (chipsWrap) {
          const chipLabels = chipsWrap.querySelectorAll('span[title]');
          chipLabels.forEach((el) => selectedDepartments.push(el.getAttribute('title')));
        }

        // ✅ If no departments selected → treat as none.
        // Only include when outputChoice includes Lead enrichment and selection is non-empty.
        const shouldIncludeDepartments =
          isLeadEnrichmentOutput(outputChoice) &&
          selectedDepartments.length > 0;

        const leadDepartmentsChoice = shouldIncludeDepartments
          ? { type: 'selected', selectedDepartments }
          : { type: 'none' };

        // Social toggles
        const scrapeSocialMediaProfiles = {
          facebooks: !!document.getElementById('contact-social-fb')?.checked,
          instagrams: !!document.getElementById('contact-social-ig')?.checked,
          youtubes: !!document.getElementById('contact-social-yt')?.checked,
          tiktoks: !!document.getElementById('contact-social-tt')?.checked,
          twitters: !!document.getElementById('contact-social-tw')?.checked,
        };

        // Proxy config
        const proxyConfig = {
          useApifyProxy: !!document.getElementById('contact-proxy-enable')?.checked,
          groups: (document.getElementById('contact-proxy-groups')?.value || '').trim(),
          country: (document.getElementById('contact-proxy-country')?.value || '').trim(),
        };

        if (!inputCsvPath) {
          alert('Please select an input CSV file');
          return null;
        }
        if (!keysFilePath) {
          alert('Please upload keys.json file');
          return null;
        }
        if (!outputDir) {
          alert('Please select an output folder');
          return null;
        }

        return {
          inputCsvPath,
          keysPath: keysFilePath,
          urlCol: urlCol || null,
          batchSize,
          outputDir,
          outputChoice,
          leadDepartmentsChoice, // ✅ will be {type:'none'} unless lead enrichment + enabled + not NONE
          scrapeSocialMediaProfiles,
          proxyConfig,
        };
      }

      case 'reaction-scraper': {
        const postsFileInput = inputs[0];
        const keysFileInput = inputs[1];
        const perKeyInput = inputs[2];
        const outputDirInput = inputs[3];

        const postsCsvPaths = [];
        if (postsFileInput?.files) {
          for (const f of postsFileInput.files) {
            if (f?.path) postsCsvPaths.push(f.path);
          }
        }

        let keysFilePath = '';
        if (keysFileInput?.files?.[0]) keysFilePath = keysFileInput.files[0].path || '';

        const perKeyLimit = Number(perKeyInput?.value || 0) || 0;
        const outputDir = outputDirInput?.value?.trim() || '';

        return { postsCsvPaths, keysFilePath, perKeyLimit, outputDir };
      }

      case 'apify-email-enricher': {

        return { inputDir, outputDir, dedupeByEmail, normalizeHeaders };
      }

      case 'comment-scraper': {
        const postsFileInput = inputs[0];
        const keysFileInput = inputs[1];
        const limitInput = inputs[2];
        const outputDirInput = inputs[3];

        const postsCsvPaths = [];
        if (postsFileInput?.files) {
          for (const f of postsFileInput.files) {
            if (f?.path) postsCsvPaths.push(f.path);
          }
        }

        let keysFilePath = '';
        if (keysFileInput?.files?.[0]) keysFilePath = keysFileInput.files[0].path || '';

        const limitPerKey = Number(limitInput?.value || 0) || 0;
        const outputDir = outputDirInput?.value?.trim() || '';

        return { postsCsvPaths, keysFilePath, limitPerKey, outputDir };
      }

      case 'apify-email-enricher': {
        const inputDirInput = inputs[0];
        const outputDirInput = inputs[1];
        const keysFileInput = inputs[2];
        const actorIdInput = inputs[3];
        const csvSizeInput = inputs[4];
        const csvsPerKeyInput = inputs[5];
        const concurrencyInput = inputs[6];

        const checkboxes = card.querySelectorAll('.checkbox-row input[type="checkbox"]');
        const overwrite = !!checkboxes[0]?.checked;
        const append = !!checkboxes[1]?.checked;

        const inputDir = inputDirInput?.value?.trim() || '';
        const outputDir = outputDirInput?.value?.trim() || '';

        let keysFilePath = '';
        if (keysFileInput?.files?.[0]) keysFilePath = keysFileInput.files[0].path || '';

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
        if (inputCsvInput?.files?.[0]) inputCsv = inputCsvInput.files[0].path || '';

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
        if (keysFileInput?.files?.[0]) keysFilePath = keysFileInput.files[0].path || '';
        if (!keysFilePath) {
          alert('Please upload keys.json file');
          return null;
        }

        const batchSize = Number(batchSizeInput?.value || 10) || 10;
        const maxCredits = Number(maxCreditsInput?.value || 1600) || 1600;
        const actorId = actorIdInput?.value?.trim() || 'yZnhB5JewWf9xSmoM';

        return { inputCsv, outputDir, keysFilePath, batchSize, maxCredits, actorId };
      }

      // -------- BLITZ --------
      case 'email-enricher': {
        const apiKey =
          document.getElementById('blitz-email-api-key')?.value?.trim() || '';
        const inputFile =
          document.getElementById('blitz-email-input-file')?.value?.trim() || '';
        const linkedinUrlColumn =
          document.getElementById('blitz-email-url-column')?.value?.trim() || '';
        const outputDir =
          document.getElementById('blitz-email-output-dir')?.value?.trim() || '';
        const outputFileName =
          document.getElementById('blitz-email-output-filename')?.value?.trim() ||
          'enriched_output.csv';
        const checkpointBatch =
          parseInt(document.getElementById('blitz-email-checkpoint-batch')?.value?.trim() || '50', 10);

        if (!inputFile) {
          alert('Please select an input CSV file');
          return null;
        }
        if (!linkedinUrlColumn) {
          alert('Please choose which column contains the LinkedIn profile URLs.');
          return null;
        }
        if (!outputDir) {
          alert('Please select an output folder');
          return null;
        }

        return {
          apiKey,
          inputFile,
          linkedinUrlColumn,
          outputFileName,
          outputFile: `${outputDir}\\${outputFileName}`,
          checkpointBatchSize: checkpointBatch,
        };
      }

      case 'waterfall-icp': {
        const apiKey = document.getElementById('waterfall-api-key')?.value?.trim() || '';

        const companiesCsvPath =
          document.getElementById('waterfall-companies-csv')?.value?.trim() || '';
        const includeTitlesCsvPath =
          document.getElementById('waterfall-include-titles-csv')?.value?.trim() || '';
        const excludeTitlesCsvPath =
          document.getElementById('waterfall-exclude-titles-csv')?.value?.trim() || '';
        const locationsCsvPath =
          document.getElementById('waterfall-locations-csv')?.value?.trim() || '';

        const maxResultsPerCompany =
          Number(document.getElementById('waterfall-max-results')?.value || 10) || 10;

        const outputDir =
          document.getElementById('waterfall-output-dir')?.value?.trim() || '';
        const outputFile =
          document.getElementById('waterfall-output-file')?.value?.trim() || 'blitz_icp_results.csv';

        if (!companiesCsvPath) {
          alert('Please choose Companies CSV');
          return null;
        }
        if (!includeTitlesCsvPath) {
          alert('Please choose Include titles CSV');
          return null;
        }
        if (!outputDir) {
          alert('Please select an output folder');
          return null;
        }

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

      case 'reverse-phone': {
        const apiKeyInput = inputs[0];
        const singlePhoneInput = inputs[1];
        const inputFileInput = inputs[2];
        const columnNameInput = inputs[3];
        const concurrencyInput = inputs[4];
        const outputDirInput = inputs[5];

        const apiKey = apiKeyInput?.value?.trim() || '';
        const singlePhone = singlePhoneInput?.value?.trim() || '';
        const inputPath = inputFileInput?.value?.trim() || '';
        const columnName = columnNameInput?.value?.trim() || 'phone';
        const concurrency = Number(concurrencyInput?.value || 3) || 3;
        const outputDir = outputDirInput?.value?.trim() || '';

        // Must have either single phone or input file
        if (!singlePhone && !inputPath) {
          alert('Please enter a phone number OR select an input file (CSV/TXT)');
          return null;
        }

        if (!outputDir) {
          alert('Please select an output folder');
          return null;
        }

        return {
          apiKey,
          singlePhone,
          inputPath,
          columnName,
          concurrency,
          outputDir,
        };
      }

      case 'reverse-email': {
        const apiKeyInput = inputs[0];
        const singleEmailInput = inputs[1];
        const inputFileInput = inputs[2];
        const columnNameInput = inputs[3];
        const concurrencyInput = inputs[4];
        const outputDirInput = inputs[5];
        const outputFileInput = inputs[6];

        const apiKey = apiKeyInput?.value?.trim() || '';
        const singleEmail = singleEmailInput?.value?.trim() || '';
        const inputPath = inputFileInput?.value?.trim() || '';
        const columnName = columnNameInput?.value?.trim() || 'email';
        const concurrency = Number(concurrencyInput?.value || 4) || 4;
        const outputDir = outputDirInput?.value?.trim() || '';
        const outputFileName = outputFileInput?.value?.trim() || '';

        // Must have either single email or input file
        if (!singleEmail && !inputPath) {
          alert('Please enter an email address OR select an input file (CSV/TXT)');
          return null;
        }

        if (!outputDir) {
          alert('Please select an output folder');
          return null;
        }

        return {
          apiKey,
          singleEmail,
          inputPath,
          columnName,
          concurrency,
          outputDir,
          outputFileName,
        };
      }

      case 'find-mobile-direct-phone': {
        const apiKeyInput = inputs[0];
        const singleUrlInput = inputs[1];
        const inputFileInput = inputs[2];
        const columnNameInput = inputs[3];
        const concurrencyInput = inputs[4];
        const outputDirInput = inputs[5];
        const outputFileInput = inputs[6];

        const apiKey = apiKeyInput?.value?.trim() || '';
        const singleLinkedin = singleUrlInput?.value?.trim() || '';
        const inputPath = inputFileInput?.value?.trim() || '';
        const columnName = columnNameInput?.value?.trim() || 'person_linkedin_url';
        const concurrency = Number(concurrencyInput?.value || 5) || 5;
        const outputDir = outputDirInput?.value?.trim() || '';
        const outputFileName = outputFileInput?.value?.trim() || '';

        if (!singleLinkedin && !inputPath) {
          alert('Please enter a LinkedIn URL OR select an input file (CSV/TXT)');
          return null;
        }

        if (!outputDir) {
          alert('Please select an output folder');
          return null;
        }

        return {
          apiKey,
          singleLinkedin,
          inputPath,
          columnName,
          concurrency,
          outputDir,
          outputFileName,
        };
      }

      case 'linkedin-url-to-domain': {
        const apiKeyInput = inputs[0];
        const singleCompanyInput = inputs[1];
        const inputFileInput = inputs[2];
        const columnNameInput = inputs[3];
        const concurrencyInput = inputs[4];
        const outputDirInput = inputs[5];
        const outputFileInput = inputs[6];

        const apiKey = apiKeyInput?.value?.trim() || '';
        const singleCompany = singleCompanyInput?.value?.trim() || '';
        const inputPath = inputFileInput?.value?.trim() || '';
        const columnName = columnNameInput?.value?.trim() || 'company_linkedin_url';
        const concurrency = Number(concurrencyInput?.value || 6) || 6;
        const outputDir = outputDirInput?.value?.trim() || '';
        const outputFileName = outputFileInput?.value?.trim() || '';

        if (!singleCompany && !inputPath) {
          alert('Please enter a company LinkedIn URL OR select an input file (CSV/TXT)');
          return null;
        }

        if (!outputDir) {
          alert('Please select an output folder');
          return null;
        }

        return {
          apiKey,
          singleCompany,
          inputPath,
          columnName,
          concurrency,
          outputDir,
          outputFileName,
        };
      }

      case 'domain-to-linkedin': {
        const apiKeyInput = inputs[0];
        const singleDomainInput = inputs[1];
        const inputFileInput = inputs[2];
        const columnNameInput = inputs[3];
        const concurrencyInput = inputs[4];
        const outputDirInput = inputs[5];
        const outputFileInput = inputs[6];

        const apiKey = apiKeyInput?.value?.trim() || '';
        const singleDomain = singleDomainInput?.value?.trim() || '';
        const inputPath = inputFileInput?.value?.trim() || '';
        const columnName = columnNameInput?.value?.trim() || 'domain';
        const concurrency = Number(concurrencyInput?.value || 6) || 6;
        const outputDir = outputDirInput?.value?.trim() || '';
        const outputFileName = outputFileInput?.value?.trim() || '';

        if (!singleDomain && !inputPath) {
          alert('Please enter a domain OR select an input file (CSV/TXT)');
          return null;
        }

        if (!outputDir) {
          alert('Please select an output folder');
          return null;
        }

        return {
          apiKey,
          singleDomain,
          inputPath,
          columnName,
          concurrency,
          outputDir,
          outputFileName,
        };
      }

      case 'blitz-key-info': {
        const apiKeyInput = inputs[0];
        const apiKey = apiKeyInput?.value?.trim() || '';

        return {
          apiKey,
        };
      }

      case 'blitz-employee-finder': {
        const apiKeyInput = inputs[0];
        const inputFileInput = inputs[1];
        const columnNameInput = inputs[2];
        const concurrencyInput = inputs[3];
        const outputDirInput = inputs[4];
        const outputFileInput = inputs[5];

        const apiKey = apiKeyInput?.value?.trim() || '';
        const inputPath = inputFileInput?.value?.trim() || '';
        const columnName = columnNameInput?.value?.trim() || 'Company LinkedIn Url';
        const concurrency = Number(concurrencyInput?.value || 3) || 3;
        const outputDir = outputDirInput?.value?.trim() || '';
        const outputFileName = outputFileInput?.value?.trim() || '';

        if (!inputPath) {
          alert('Please select an input CSV file.');
          return null;
        }

        if (!outputDir) {
          alert('Please select an output folder.');
          return null;
        }

        return {
          apiKey,
          inputPath,
          columnName,
          concurrency,
          outputDir,
          outputFileName,
        };
      }

      case 'blitz-current-date': {
        const apiKeyInput = inputs[0];
        const regionInput = inputs[1];

        const apiKey = apiKeyInput?.value?.trim() || '';
        const region = regionInput?.value?.trim() || 'America/New_York';

        return {
          apiKey,
          region,
        };
      }

      // -------- INHOUSE --------
      case 'csv-splitter': {
        const inputFileInput = document.getElementById('csv-splitter-input-file');
        const rowsInput = document.getElementById('csv-splitter-rows');
        const outputDirInput = document.getElementById('csv-splitter-output-dir');

        const inputPath = inputFileInput?.value?.trim() || '';
        const rowsPerFile = Number(rowsInput?.value || 0) || 0;
        const outputDir = outputDirInput?.value?.trim() || '';

        if (!inputPath) {
          appendLog('csv-splitter', 'Please select an input CSV file.', 'error');
          return null;
        }

        if (!rowsPerFile || rowsPerFile < 1) {
          appendLog('csv-splitter', 'Rows per split must be a positive number.', 'error');
          return null;
        }

        return {
          inputPath,
          rowsPerFile,
          outputDir,
        };
      }

      case 'csv-merger': {
        const inputDirInput = document.getElementById('csv-merger-input-dir');
        const outputDirInput = document.getElementById('csv-merger-output-dir');
        const outputNameInput = document.getElementById('csv-merger-output-name');
        const logNameInput = document.getElementById('csv-merger-log-name');

        const inputDir = inputDirInput?.value?.trim() || '';
        const outputDir = outputDirInput?.value?.trim() || '';
        const outputFileName = outputNameInput?.value?.trim() || 'merged.csv';
        const logFileName = logNameInput?.value?.trim() || 'merger-log.jsonl';

        if (!inputDir) {
          appendLog('csv-merger', 'Please select an input folder containing CSV files.', 'error');
          return null;
        }

        return {
          inputDir,
          outputDir,
          outputFileName,
          logFileName,
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
        console.log('[DEBUG] inputDir:', payload?.inputDir);
        console.log('[DEBUG] outputDir:', payload?.outputDir);
        console.log('[DEBUG] keysFilePath:', payload?.keysFilePath);
        console.log('[DEBUG] actorOrFlowId:', payload?.actorOrFlowId);

        if (!payload?.inputDir) throw new Error('Input folder is required.');
        if (!payload?.outputDir) throw new Error('Output folder is required.');
        if (!payload?.keysFilePath)
          throw new Error('Keys file (keys.json) is required.');
        if (!payload?.actorOrFlowId)
          throw new Error('Actor ID / Flow ID is required.');
        console.log('[DEBUG] All validations passed!');
      }

      if (toolId === 'linkedin-profile-enhancer') {
        console.log('[DEBUG] Validating LinkedIn Profile Enhancer...');
        console.log('[DEBUG] inputCsv:', payload?.inputCsv);
        console.log('[DEBUG] outputDir:', payload?.outputDir);
        console.log('[DEBUG] keysFilePath:', payload?.keysFilePath);

        if (!payload?.inputCsv) throw new Error('Input CSV file is required.');
        if (!payload?.outputDir) throw new Error('Output folder is required.');
        if (!payload?.keysFilePath)
          throw new Error('Keys file (keys.json) is required.');
        console.log('[DEBUG] All validations passed!');
      }

      console.log('[DEBUG] Calling electronAPI.runTool with:', toolId, payload);
      const result = await electronAPI.runTool(toolId, payload);
      console.log('[DEBUG] Got result:', result);

      const runId = result?.runId;
      if (!runId) throw new Error('No runId returned from main process.');

      state.currentRunId = runId;
      state.currentToolId = toolId;
      appendLog(toolId, `✓ Tool "${toolId}" started (runId: ${runId})`);
    } catch (err) {
      console.error('[ERROR] startTool error:', err);
      appendLog(toolId, `✗ Failed to start tool "${toolId}": ${err.message}`, 'error');
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
      appendLog(state.currentToolId, 'Already stopping current run…', 'warn');
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

      // reset inputs
      const allInputs = document.querySelectorAll('.tool-card .input-field');
      allInputs.forEach((inp) => {
        if (inp.type === 'number') return;

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

      // ✅ reset ALL checkboxes (not only .checkbox-row)
      const allCheckboxes = document.querySelectorAll('.tool-card input[type="checkbox"]');
      allCheckboxes.forEach((cb) => {
        cb.checked = cb.defaultChecked;
      });

      // ✅ reset contact departments selector UI (chips + toggle text)
      const chipsWrap = document.getElementById('chips-contact');
      if (chipsWrap) chipsWrap.innerHTML = '';

      const countEl = document.getElementById('count-contact');
      if (countEl) countEl.textContent = '0';

      const toggleText = document.getElementById('toggleText-contact');
      if (toggleText) toggleText.textContent = 'Off';

      const metricElements = document.querySelectorAll('[data-metric]');
      metricElements.forEach((el) => {
        el.textContent = '0';
      });

      toolCards.forEach((card) => {
        const toolId = card.id;
        const consoleEl = document.getElementById(`console-${toolId}`);
        if (consoleEl) {
          consoleEl.textContent = 'Waiting for execution...';
          consoleEl.style.maxHeight = '4rem';
        }
      });

      resetState();
      handleSectionToggle('apify');
      appendLog('post-finder', 'App reset to initial state.');
    });
  }

  // ---------- PER-TOOL CONSOLE TOGGLES ----------
  function initPerToolConsoleToggles() {
    const consoleToggleButtons = document.querySelectorAll('.console-toggle');

    consoleToggleButtons.forEach((btn) => {
      const toolId = btn.getAttribute('data-tool-id');
      if (!toolId) return;

      const consoleEl = document.getElementById(`console-${toolId}`);
      if (!consoleEl) return;

      consoleEl.style.maxHeight = '4rem';
      btn.dataset.expanded = 'false';
      btn.textContent = 'Expand Log';

      btn.addEventListener('click', () => {
        const isExpanded = btn.dataset.expanded === 'true';

        if (isExpanded) {
          consoleEl.style.maxHeight = '4rem';
          btn.dataset.expanded = 'false';
          btn.textContent = 'Expand Log';
        } else {
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
      console.warn('Electron API not present – running in plain browser mode.');
      return;
    }

    electronAPI.onToolLog((data) => {
      if (state.currentRunId && data.runId && data.runId !== state.currentRunId) return;
      const toolId = data.toolId || state.currentToolId || 'tool';
      appendLog(toolId, data.message, data.level || 'info');
    });

    electronAPI.onToolStatus((data) => {
      if (state.currentRunId && data.runId && data.runId !== state.currentRunId) return;

      const toolId = data.toolId || state.currentToolId || 'tool';
      if (data.status) appendLog(toolId, `ℹ Status: ${data.status}`, 'info');
      if (data.metrics) updateMetrics(toolId, data.metrics);
    });

    electronAPI.onToolExit((data) => {
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
    initFilePickers();
    initBlitzPreview();
    initSampleButtons();
    initPerToolConsoleToggles();
    initIpcListeners();
    initResetButton();

    // Initialize embedded departments multi-select for Contact Details Scraper
    (function initContactDepartmentSelector() {
      // ✅ options (your 14) — no explicit "None"
      const OPTIONS = [
        'C-Suite',
        'Product',
        'Engineering & Technical',
        'Design',
        'Education',
        'Finance',
        'Human Resources',
        'Information Technology',
        'Legal',
        'Marketing',
        'Medical & Health',
        'Operations',
        'Sales',
        'Consulting',
      ];

      const ms = document.getElementById('ms-contact');
      if (!ms) return;

      const btn = ms.querySelector('.ms-btn');
      const list = document.getElementById('list-contact');
      const chips = document.getElementById('chips-contact');
      const search = document.getElementById('search-contact');
      const clearBtn = document.getElementById('clearBtn-contact');
      const selectAllBtn = document.getElementById('selectAll-contact');
      const countEl = document.getElementById('count-contact');
      // Removed enable toggle elements

      // outputChoice select (used to disable filter UI when not lead enrichment)
      const contactCard = document.getElementById('contact-details-scraper');
      const outputChoiceSelect = contactCard?.querySelectorAll('.form-field .input-field')?.[5] || null;

      const local = { open: false, selected: new Set([]), focusIndex: -1 };

      function isLeadEnrichmentOutput(choice) {
        return choice === '3' || choice === '4' || choice === '5';
      }

      function setOpen(next) {
        local.open = next;
        ms.classList.toggle('open', next);
        btn.setAttribute('aria-expanded', String(next));
        if (next) {
          if (search) search.value = '';
          local.focusIndex = -1;
          renderList();
          setTimeout(() => search?.focus?.(), 50);
        }
      }

      function renderChips() {
        chips.innerHTML = '';
        if (local.selected.size === 0) {
          const ph = document.createElement('div');
          ph.className = 'placeholder';
          ph.textContent = 'Select departments...';
          chips.appendChild(ph);
          return;
        }

        [...local.selected].forEach((val) => {
          const chip = document.createElement('span');
          chip.className = 'chip';
          chip.innerHTML = `<span title="${val}">${val}</span><button type="button" aria-label="Remove ${val}">×</button>`;
          chip.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation();
            local.selected.delete(val);
            renderAll();
          });
          chips.appendChild(chip);
        });
      }

      function renderList() {
        const q = (search?.value || '').trim().toLowerCase();
        list.innerHTML = '';

        const filtered = OPTIONS.filter((opt) => opt.toLowerCase().includes(q));

        filtered.forEach((opt, idx) => {
          const row = document.createElement('div');
          row.className = 'item' + (local.selected.has(opt) ? ' selected' : '');
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', String(local.selected.has(opt)));
          row.setAttribute('data-index', String(idx));
          row.innerHTML = `<span class="check"><span class="tick"></span></span><span>${opt}</span>`;

          row.addEventListener('click', () => {
            if (local.selected.has(opt)) local.selected.delete(opt);
            else local.selected.add(opt);
            renderAll(false);
          });

          // Keyboard support for items
          row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (local.selected.has(opt)) local.selected.delete(opt);
              else local.selected.add(opt);
              renderAll(false);
            }
          });

          list.appendChild(row);
        });

        countEl.textContent = String(local.selected.size);
      }

      function renderAll(closeMenu = true) {
        renderChips();
        renderList();
        if (closeMenu) setOpen(false);
      }

      function enforceOutputChoiceRules() {
        const choice = outputChoiceSelect?.value || '5';
        const allow = isLeadEnrichmentOutput(choice);
        // Visually allow selection always; just no-op on send if not enrichment
        ms.style.opacity = '1';
        ms.style.pointerEvents = 'auto';
        if (!allow) {
          // no enforced clearing; empty selection means none
        }
      }

      btn.addEventListener('click', () => setOpen(!local.open));
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen(!local.open);
        }
        if (e.key === 'Escape') setOpen(false);
      });

      document.addEventListener('click', (e) => {
        if (!ms.contains(e.target)) setOpen(false);
      });

      search?.addEventListener('input', renderList);

      clearBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        local.selected.clear();
        renderAll(false);
      });

      selectAllBtn?.addEventListener('click', () => {
        local.selected.clear();
        OPTIONS.forEach((o) => local.selected.add(o));
        renderAll(false);
      });

      // watch output type changes
      outputChoiceSelect?.addEventListener('change', enforceOutputChoiceRules);

      // initial state
      renderAll(false);
      enforceOutputChoiceRules();
    })();
  });
})();
