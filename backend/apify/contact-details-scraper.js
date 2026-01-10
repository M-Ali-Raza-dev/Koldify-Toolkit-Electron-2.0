// backend/apify/contact-details-scraper.js
// Contact Details Scraper — Apify actor 9Sk4JJhEma9vBKqrg
// Accepts TOOL_CONFIG from environment (JSON) to avoid interactive prompts when run from Electron.

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');
const { ApifyClient } = require('apify-client');

// ----- Config intake -----
function getToolConfigFromEnv() {
  try {
    const raw = process.env.TOOL_CONFIG;
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

function nowISO() { return new Date().toISOString(); }
function logLine(level, message) {
  // Clean, readable log output
  console.log(JSON.stringify({ type: 'log', level, message }));
}
function sendStatus(status, metrics = undefined) {
  console.log(JSON.stringify({ type: 'status', status, metrics }));
}

const ACTOR_ID = '9Sk4JJhEma9vBKqrg';

const LEADS_DEPARTMENTS = [
  { label: 'C-Suite', value: 'c_suite' },
  { label: 'Product', value: 'product' },
  { label: 'Engineering & Technical', value: 'engineering_technical' },
  { label: 'Design', value: 'design' },
  { label: 'Education', value: 'education' },
  { label: 'Finance', value: 'finance' },
  { label: 'Human Resources', value: 'human_resources' },
  { label: 'Information Technology', value: 'information_technology' },
  { label: 'Legal', value: 'legal' },
  { label: 'Marketing', value: 'marketing' },
  { label: 'Medical & Health', value: 'medical_health' },
  { label: 'Operations', value: 'operations' },
  { label: 'Sales', value: 'sales' },
  { label: 'Consulting', value: 'consulting' },
];
const LABEL_TO_VALUE = new Map(LEADS_DEPARTMENTS.map(d => [d.label.toLowerCase(), d.value]));

const BASE_ACTOR_INPUT = {
  maxRequestsPerStartUrl: 20,
  mergeContacts: true,
  maxDepth: 2,
  maxRequests: 9999999,
  sameDomain: true,
  considerChildFrames: true,
  maximumLeadsEnrichmentRecords: 0,
  scrapeSocialMediaProfiles: {
    facebooks: false,
    instagrams: false,
    youtubes: false,
    tiktoks: false,
    twitters: false,
  },
  useBrowser: false,
  waitUntil: 'domcontentloaded',
  proxyConfig: { useApifyProxy: true },
};

function safeMkdir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function readJson(filePath, fallback) {
  try { if (!fs.existsSync(filePath)) return fallback; return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}
function writeJson(filePath, obj) { fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8'); }

async function readUrlsFromCsv(csvPath, urlColHint) {
  return new Promise((resolve, reject) => {
    const urls = [];
    let detectedHeaders = null;

    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('headers', (headers) => (detectedHeaders = headers))
      .on('data', (row) => {
        let col = urlColHint;
        if (!col) {
          const candidates = ['website','Website','url','Url','URL','domain','Domain','site','Site'];
          col = candidates.find((c) => row[c] !== undefined) || null;
          if (!col && detectedHeaders?.length) col = detectedHeaders[0];
        }
        const raw = (row[col] || '').toString().trim();
        if (!raw) return;
        let u = raw; if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
        urls.push(u);
      })
      .on('end', () => resolve(urls))
      .on('error', reject);
  });
}
function chunk(arr, size) { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }
async function fetchAllDatasetItems(client, datasetId) {
  const all = []; let offset = 0; const limit = 250;
  while (true) {
    const res = await client.dataset(datasetId).listItems({ offset, limit });
    const items = (res && res.items) || []; all.push(...items);
    if (items.length < limit) break; offset += limit;
  }
  return all;
}

function buildSocialRow(item) {
  const joinOrEmpty = (arr) => (Array.isArray(arr) ? arr.join(' | ') : '');
  return {
    domain: item.domain || '',
    originalStartUrl: item.originalStartUrl || '',
    facebookProfiles: joinOrEmpty(item.facebooks),
    instagramProfiles: joinOrEmpty(item.instagrams),
    youtubeProfiles: joinOrEmpty(item.youtubes),
    tiktokProfiles: joinOrEmpty(item.tiktoks),
    twitterProfiles: joinOrEmpty(item.twitters),
  };
}
function buildLeadRow(item) {
  const lead = Array.isArray(item.leadsEnrichment) ? item.leadsEnrichment[0] : null;
  return {
    domain: item.domain || '',
    title: '',
    firstName: lead?.firstName || '',
    lastName: lead?.lastName || '',
    fullName: lead?.fullName || '',
    linkedinProfile: lead?.linkedinProfile || '',
    email: lead?.email || '',
    mobileNumber: lead?.mobileNumber || '',
    headline: lead?.headline || '',
    jobTitle: lead?.jobTitle || '',
    departments: Array.isArray(lead?.departments) ? lead.departments.join(' | ') : '',
    seniority: lead?.seniority || '',
    industry: lead?.industry || '',
    photoUrl: lead?.photoUrl || '',
    city: lead?.city || '',
    state: lead?.state || '',
    country: lead?.country || '',
    companyName: lead?.companyName || '',
    companyWebsite: lead?.companyWebsite || '',
    companySize: lead?.companySize || '',
    companyLinkedin: lead?.companyLinkedin || '',
    companyCity: lead?.companyCity || '',
    companyState: lead?.companyState || '',
    companyCountry: lead?.companyCountry || '',
    companyPhoneNumber: lead?.companyPhoneNumber || '',
    twitter: lead?.twitter || '',
    companyId: lead?.companyId || '',
    'departments/0': Array.isArray(lead?.departments) ? (lead.departments[0] || '') : '',
    personId: lead?.personId || '',
  };
}

function buildActorInputForChoice(choice) {
  const actorInput = JSON.parse(JSON.stringify(BASE_ACTOR_INPUT));
  const wantAllFields = choice === '1' || choice === '5';
  const wantSocialOnly = choice === '2';
  const wantLeadsOnly = choice === '3';
  const wantLeadsPlusSocial = choice === '4';
  const wantAllOutputs = choice === '5';
  if (wantAllFields || wantLeadsOnly || wantLeadsPlusSocial || wantAllOutputs) actorInput.maximumLeadsEnrichmentRecords = 1; else actorInput.maximumLeadsEnrichmentRecords = 0;
  if (wantAllFields || wantSocialOnly || wantLeadsPlusSocial || wantAllOutputs) {
    actorInput.scrapeSocialMediaProfiles = { facebooks: true, instagrams: true, youtubes: true, tiktoks: true, twitters: true };
  } else {
    actorInput.scrapeSocialMediaProfiles = { facebooks: false, instagrams: false, youtubes: false, tiktoks: false, twitters: false };
  }
  return actorInput;
}
function choiceToModes(choice) {
  if (choice === '1') return { all: true, social: false, leads: false };
  if (choice === '2') return { all: false, social: true, leads: false };
  if (choice === '3') return { all: false, social: false, leads: true };
  if (choice === '4') return { all: false, social: true, leads: true };
  return { all: true, social: true, leads: true };
}

async function main() {
  const cfg = getToolConfigFromEnv() || {};
  const keysPath = cfg.keysPath || cfg.keysFilePath || 'keys.json';
  const inputCsvPath = cfg.inputCsvPath || cfg.inputCsv || cfg.input || '';
  const urlCol = cfg.urlCol || null;
  const batchSize = Number(cfg.batchSize || cfg.batch || 100) || 100;
  const outputDir = cfg.outputDir || path.join(process.cwd(), 'out');
  const outputChoice = String(cfg.outputChoice || '5');

  if (!inputCsvPath || !fs.existsSync(inputCsvPath)) {
    console.error('Input CSV not found. Please provide inputCsvPath.');
    process.exit(1);
  }
  if (!fs.existsSync(keysPath)) {
    console.error('keys.json not found. Please provide keysPath.');
    process.exit(1);
  }
  safeMkdir(outputDir);

  const keysDir = path.dirname(keysPath);
  const usedKeysPath = path.join(keysDir, 'used_keys.json');
  const bannedKeysPath = path.join(keysDir, 'banned_keys.json');

  const keys = readJson(keysPath, null);
  if (!Array.isArray(keys) || keys.length === 0) {
    console.error(`keys.json is missing or empty: ${keysPath}`);
    process.exit(1);
  }

  const actorInputBase = buildActorInputForChoice(outputChoice);
  // Override with social toggles if provided
  if (cfg.scrapeSocialMediaProfiles && typeof cfg.scrapeSocialMediaProfiles === 'object') {
    actorInputBase.scrapeSocialMediaProfiles = {
      facebooks: !!cfg.scrapeSocialMediaProfiles.facebooks,
      instagrams: !!cfg.scrapeSocialMediaProfiles.instagrams,
      youtubes: !!cfg.scrapeSocialMediaProfiles.youtubes,
      tiktoks: !!cfg.scrapeSocialMediaProfiles.tiktoks,
      twitters: !!cfg.scrapeSocialMediaProfiles.twitters,
    };
  }
  // Override proxy config if provided
  if (cfg.proxyConfig && typeof cfg.proxyConfig === 'object') {
    const useApifyProxy = !!cfg.proxyConfig.useApifyProxy;
    const groups = (cfg.proxyConfig.groups || '').toString().trim();
    const country = (cfg.proxyConfig.country || '').toString().trim();
    actorInputBase.proxyConfig = { useApifyProxy };
    if (groups) actorInputBase.proxyConfig.groups = groups;
    if (country) actorInputBase.proxyConfig.countryCode = country;
  }

  // Optional department filter from UI
  // cfg.leadDepartmentsChoice: { type: 'none' | 'selected', selectedDepartments?: string[] (labels or slugs) }
  if (actorInputBase.maximumLeadsEnrichmentRecords > 0 && cfg.leadDepartmentsChoice) {
    if (cfg.leadDepartmentsChoice.type === 'selected' && Array.isArray(cfg.leadDepartmentsChoice.selectedDepartments)) {
      const slugs = cfg.leadDepartmentsChoice.selectedDepartments
        .map(v => {
          if (!v) return null;
          const s = String(v);
          const byLabel = LABEL_TO_VALUE.get(s.toLowerCase());
          return byLabel || s; // accept slug directly
        })
        .filter(Boolean);
      if (slugs.length) actorInputBase.leadsEnrichmentDepartments = Array.from(new Set(slugs));
    }
    // type==='none' -> do not set field
  }

  // Startup
  const outputModeNames = { '1': 'All Fields', '2': 'Social Profiles Only', '3': 'Lead Enrichment Only', '4': 'Leads + Social', '5': 'All Outputs' };
  logLine('info', `⚡ Initializing Contact Details Scraper`);
  logLine('info', `📁 Input: ${path.basename(inputCsvPath)}`);
  logLine('info', `🔑 API Keys: ${keys.length} available`);
  logLine('info', `📊 Output Mode: ${outputModeNames[outputChoice] || outputChoice}`);
  logLine('info', `📦 Batch Size: ${batchSize} URLs per key`);
  sendStatus('starting', { totalKeys: keys.length });

  const urls = await readUrlsFromCsv(inputCsvPath, urlCol);
  const uniqueUrls = Array.from(new Set(urls));
  logLine('info', `✅ Loaded ${uniqueUrls.length} unique URL${uniqueUrls.length !== 1 ? 's' : ''} from CSV`);
  sendStatus('urls-loaded', { urlsTotal: uniqueUrls.length });

  const urlChunks = chunk(uniqueUrls, batchSize);
  logLine('info', `🔄 Created ${urlChunks.length} batch${urlChunks.length !== 1 ? 'es' : ''} for processing`);
  sendStatus('chunks-created', { chunksCreated: urlChunks.length });

  const usedKeys = readJson(usedKeysPath, []);
  const bannedKeys = readJson(bannedKeysPath, []);
  const usedMap = new Map(usedKeys.map((x) => [x.key, x]));
  const bannedMap = new Map(bannedKeys.map((x) => [x.key, x]));

  const allItems = []; const socialRows = []; const leadRows = [];
  let chunkIndex = 0; let keyIndex = 0;

  while (chunkIndex < urlChunks.length && keyIndex < keys.length) {
    const key = keys[keyIndex];
    if (!key || typeof key !== 'string') { keyIndex++; continue; }
    if (bannedMap.has(key)) { keyIndex++; continue; }

    const urlsForThisKey = urlChunks[chunkIndex];
    const client = new ApifyClient({ token: key });
    const actorInput = { ...actorInputBase, startUrls: urlsForThisKey.map((u) => ({ url: u })) };
    if (!Array.isArray(actorInput.leadsEnrichmentDepartments) || actorInput.leadsEnrichmentDepartments.length === 0) {
      delete actorInput.leadsEnrichmentDepartments;
    }

    const deptFilter = Array.isArray(actorInput.leadsEnrichmentDepartments) ? ` (${actorInput.leadsEnrichmentDepartments.length} dept${actorInput.leadsEnrichmentDepartments.length !== 1 ? 's' : ''})` : '';
    logLine('info', `🚀 Processing batch ${chunkIndex + 1}/${urlChunks.length} with ${urlsForThisKey.length} URL${urlsForThisKey.length !== 1 ? 's' : ''}${deptFilter}`);
    sendStatus('run-start', { activeKeyIndex: keyIndex + 1, chunksProcessed: chunkIndex });

    try {
      const run = await client.actor(ACTOR_ID).call(actorInput);
      const items = await fetchAllDatasetItems(client, run.defaultDatasetId);
      allItems.push(...items);
      if (choiceToModes(outputChoice).social) for (const it of items) socialRows.push(buildSocialRow(it));
      if (choiceToModes(outputChoice).leads) for (const it of items) leadRows.push(buildLeadRow(it));

      const used = usedMap.get(key) || { key, runs: 0, urlsProcessed: 0, lastUsedAt: '' };
      used.runs += 1; used.urlsProcessed += urlsForThisKey.length; used.lastUsedAt = nowISO(); usedMap.set(key, used);

      chunkIndex++; keyIndex++;
      sendStatus('chunk-finished', { chunksProcessed: chunkIndex });
    } catch (err) {
      const msg = (err?.message || '').toString();
      bannedMap.set(key, { key, reason: 'ERROR', bannedAt: nowISO(), message: msg.slice(0, 500) });
      keyIndex++;
      logLine('error', `❌ API Key failed: ${msg.slice(0, 120)}`);
    }

    writeJson(usedKeysPath, Array.from(usedMap.values()));
    writeJson(bannedKeysPath, Array.from(bannedMap.values()));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const modes = choiceToModes(outputChoice);
  
  let allPath = null, socialPath = null, leadsPath = null;
  
  // For 'All Outputs' mode, create single combined CSV
  if (outputChoice === '5') {
    const combinedPath = path.join(outputDir, `apify_combined_${stamp}.csv`);
    const flattenedRows = []; const headerSet = new Set();
    for (const it of allItems) { const flat = flattenAny(it); flattenedRows.push(flat); for (const k of Object.keys(flat)) headerSet.add(k); }
    const headers = Array.from(headerSet).sort().map((h) => ({ id: h, title: h }));
    const writer = createObjectCsvWriter({ path: combinedPath, header: headers });
    const normalized = flattenedRows.map((r) => { const obj = {}; for (const h of headerSet) obj[h] = r[h] ?? ''; return obj; });
    await writer.writeRecords(normalized);
    allPath = combinedPath;
  } else {
    // Create separate files for other modes
    if (modes.all) {
      allPath = path.join(outputDir, `apify_all_fields_${stamp}.csv`);
      const flattenedRows = []; const headerSet = new Set();
      for (const it of allItems) { const flat = flattenAny(it); flattenedRows.push(flat); for (const k of Object.keys(flat)) headerSet.add(k); }
      const headers = Array.from(headerSet).sort().map((h) => ({ id: h, title: h }));
      const writer = createObjectCsvWriter({ path: allPath, header: headers });
      const normalized = flattenedRows.map((r) => { const obj = {}; for (const h of headerSet) obj[h] = r[h] ?? ''; return obj; });
      await writer.writeRecords(normalized);
    }
    if (modes.social) {
      socialPath = path.join(outputDir, `apify_social_profiles_${stamp}.csv`);
      const headers = [
        { id: 'domain', title: 'domain' },
        { id: 'originalStartUrl', title: 'originalStartUrl' },
        { id: 'facebookProfiles', title: 'facebookProfiles' },
        { id: 'instagramProfiles', title: 'instagramProfiles' },
        { id: 'youtubeProfiles', title: 'youtubeProfiles' },
        { id: 'tiktokProfiles', title: 'tiktokProfiles' },
        { id: 'twitterProfiles', title: 'twitterProfiles' },
      ];
      const writer = createObjectCsvWriter({ path: socialPath, header: headers });
      await writer.writeRecords(socialRows);
    }
    if (modes.leads) {
      leadsPath = path.join(outputDir, `apify_lead_enrichment_${stamp}.csv`);
      const headers = [
        { id: 'domain', title: 'domain' },
        { id: 'title', title: 'title' },
        { id: 'firstName', title: 'firstName' },
        { id: 'lastName', title: 'lastName' },
        { id: 'fullName', title: 'fullName' },
        { id: 'linkedinProfile', title: 'linkedinProfile' },
        { id: 'email', title: 'email' },
        { id: 'mobileNumber', title: 'mobileNumber' },
        { id: 'headline', title: 'headline' },
        { id: 'jobTitle', title: 'jobTitle' },
        { id: 'departments', title: 'departments' },
        { id: 'seniority', title: 'seniority' },
        { id: 'industry', title: 'industry' },
        { id: 'photoUrl', title: 'photoUrl' },
        { id: 'city', title: 'city' },
        { id: 'state', title: 'state' },
        { id: 'country', title: 'country' },
        { id: 'companyName', title: 'companyName' },
        { id: 'companyWebsite', title: 'companyWebsite' },
        { id: 'companySize', title: 'companySize' },
        { id: 'companyLinkedin', title: 'companyLinkedin' },
        { id: 'companyCity', title: 'companyCity' },
        { id: 'companyState', title: 'companyState' },
        { id: 'companyCountry', title: 'companyCountry' },
        { id: 'companyPhoneNumber', title: 'companyPhoneNumber' },
        { id: 'twitter', title: 'twitter' },
        { id: 'companyId', title: 'companyId' },
        { id: 'departments/0', title: 'departments/0' },
        { id: 'personId', title: 'personId' },
      ];
      const writer = createObjectCsvWriter({ path: leadsPath, header: headers });
      await writer.writeRecords(leadRows);
    }
  }

  const bannedList = Array.from(bannedMap.values());
  const usedList = Array.from(usedMap.values());
  sendStatus('finished', {
    urlsTotal: uniqueUrls.length,
    chunksCreated: urlChunks.length,
    chunksProcessed: chunkIndex,
    usedKeys: usedList.length,
    bannedKeys: bannedList.length,
  });
  logLine('info', ``);
  logLine('info', `✨ Process completed successfully`);
  logLine('info', `📊 Summary:`);
  logLine('info', `   • URLs Processed: ${uniqueUrls.length}`);
  logLine('info', `   • Batches Completed: ${chunkIndex}/${urlChunks.length}`);
  logLine('info', `   • API Keys Used: ${usedList.length}`);
  if (bannedList.length > 0) logLine('info', `   • Failed Keys: ${bannedList.length}`);
  if (outputChoice === '5') {
    logLine('info', `📄 Combined Output: ${path.basename(allPath)}`);
  } else {
    if (allPath) logLine('info', `📄 All Fields: ${path.basename(allPath)}`);
    if (socialPath) logLine('info', `📱 Social Profiles: ${path.basename(socialPath)}`);
    if (leadsPath) logLine('info', `👤 Lead Enrichment: ${path.basename(leadsPath)}`);
  }
  logLine('info', `💾 Output saved to: ${outputDir}`);
}

function flattenAny(value, prefix = '', out = {}) {
  if (value === null || value === undefined) { if (prefix) out[prefix] = value; return out; }
  if (Array.isArray(value)) { value.forEach((v, i) => { const p = prefix ? `${prefix}/${i}` : `${i}`; flattenAny(v, p, out); }); if (value.length === 0 && prefix) out[prefix] = ''; return out; }
  if (typeof value === 'object') { const keys = Object.keys(value); if (keys.length === 0 && prefix) out[prefix] = ''; for (const k of keys) { const p = prefix ? `${prefix}/${k}` : k; flattenAny(value[k], p, out); } return out; }
  out[prefix] = value; return out;
}

main().catch((e) => {
  console.error(JSON.stringify({ type: 'log', level: 'error', message: e?.message || 'Unhandled error' }));
  process.exit(1);
});
