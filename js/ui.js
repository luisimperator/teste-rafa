/**
 * js/ui.js — Helpers de UI: navegação de steps, renderização, progress
 *
 * Não acessa a API do Premiere diretamente.
 * Gerencia: step nav, listas de arquivos, progress bar, análise visual.
 */

'use strict';

// localFileSystem carregado com try/catch — pode falhar em alguns ambientes UXP
let localFileSystem = null;
try {
  localFileSystem = require('uxp').storage.localFileSystem;
} catch (_) {
  Log.warn('localFileSystem indisponível — use o scan do projeto.');
}

// ---------------------------------------------------------------------------
// Helpers DOM
// ---------------------------------------------------------------------------

function $(id) { return document.getElementById(id); }
function show(id) { const el = $(id); if (el) el.classList.remove('hidden'); }
function hide(id) { const el = $(id); if (el) el.classList.add('hidden'); }

// Funciona com UXP File, ProjectItem ou objeto { name } genérico
function getFileName(item) {
  if (!item) return '';
  return item.name || (item.nativePath ? item.nativePath.split(/[\\/]/).pop() : '?');
}

// ---------------------------------------------------------------------------
// Navegação de Steps
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 4;

function activateStep(n) {
  // Painéis
  document.querySelectorAll('.step-panel').forEach((p) => p.classList.remove('active'));
  const panel = $('step-' + n);
  if (panel) panel.classList.add('active');

  // Indicadores
  document.querySelectorAll('.step-dot').forEach((dot) => {
    const s = parseInt(dot.dataset.step, 10);
    dot.classList.remove('active', 'done');
    if (s === n)  dot.classList.add('active');
    if (s < n)    dot.classList.add('done');
  });

  // Label + nav buttons
  $('step-label').textContent = 'Passo ' + n + ' de ' + TOTAL_STEPS;
  $('btn-back').style.visibility = n === 1 ? 'hidden' : 'visible';

  if (n === TOTAL_STEPS) {
    hide('btn-next');
    buildGenerateSummary();
  } else {
    show('btn-next');
  }

  AppState.step = n;
  Log.debug('Step ' + n + ' ativado.');
}

function validateStep(n) {
  if (n === 1 && !AppState.music) return 'Selecione a música antes de continuar.';
  if (n === 1 && AppState.broll.length === 0) return 'Adicione pelo menos um clipe B-Roll.';
  if (n === 1 && AppState.hasInterviews && AppState.interviews.length === 0)
    return 'Adicione ao menos uma entrevista ou desative a opção.';
  if (n === 2 && !AppState.analysed) return 'Confirme a análise antes de prosseguir.';
  return null;
}

function showStepError(stepNum, msg) {
  const panel = $('step-' + stepNum);
  if (!panel) return;
  let errEl = panel.querySelector('.step-error');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.className = 'step-error';
    panel.appendChild(errEl);
  }
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}

function clearStepError(stepNum) {
  const panel = $('step-' + stepNum);
  if (!panel) return;
  const errEl = panel.querySelector('.step-error');
  if (errEl) errEl.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Listas de arquivos
// ---------------------------------------------------------------------------

function renderFileList(containerId, files, onRemove) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = '';

  files.forEach((f, i) => {
    const entry = document.createElement('div');
    entry.className = 'flist-entry';

    const num = document.createElement('span');
    num.className = 'flist-num';
    num.textContent = (i + 1);

    const name = document.createElement('span');
    name.className = 'flist-name';
    name.textContent = getFileName(f);

    const size = document.createElement('span');
    size.className = 'flist-size';
    size.textContent = Analysis.formatBytes(f.size);

    const btn = document.createElement('button');
    btn.className = 'flist-remove';
    btn.textContent = '✕';
    btn.title = 'Remover';
    btn.addEventListener('click', () => onRemove(i));

    entry.appendChild(num);
    entry.appendChild(name);
    entry.appendChild(size);
    entry.appendChild(btn);
    container.appendChild(entry);
  });
}

function updateBrollUI() {
  renderFileList('broll-list', AppState.broll, (i) => {
    AppState.broll.splice(i, 1);
    updateBrollUI();
  });
  const badge = $('broll-count');
  if (badge) badge.textContent = AppState.broll.length + ' clipe(s)';
  AppState.broll.length > 0 ? show('broll-count') : hide('broll-count');
  updateMediaBadge();
}

function updateInterviewUI() {
  renderFileList('interview-list', AppState.interviews, (i) => {
    AppState.interviews.splice(i, 1);
    updateInterviewUI();
  });
  const badge = $('interview-count');
  if (badge) badge.textContent = AppState.interviews.length + ' entrevista(s)';
  AppState.interviews.length > 0 ? show('interview-count') : hide('interview-count');
  updateMediaBadge();
}

function updateAssetUI() {
  renderFileList('asset-list', AppState.assets, (i) => {
    AppState.assets.splice(i, 1);
    updateAssetUI();
  });
  const badge = $('asset-count');
  if (badge) badge.textContent = AppState.assets.length + ' asset(s)';
  AppState.assets.length > 0 ? show('asset-count') : hide('asset-count');
  updateMediaBadge();
}

function updateMediaBadge() {
  const total = (AppState.music ? 1 : 0) + AppState.broll.length +
                AppState.interviews.length + AppState.assets.length;
  const el = $('media-total-badge');
  if (el) {
    el.textContent = total + ' arquivo(s) carregado(s)';
    total > 0 ? show('media-total-badge') : hide('media-total-badge');
  }
}

function updateMusicUI() {
  if (AppState.music) {
    const info = Analysis.getFileInfo(AppState.music);
    const nameEl = $('music-name');
    const sizeEl = $('music-size');
    if (nameEl) nameEl.textContent = info.name;
    if (sizeEl) sizeEl.textContent = info.size;
    show('music-info');
  } else {
    hide('music-info');
  }
  updateMediaBadge();
}

// ---------------------------------------------------------------------------
// Assign panel — scan do projeto + categorização de itens
// ---------------------------------------------------------------------------

/**
 * Renderiza a lista de itens escaneados do projeto.
 * Cada item recebe botões de papel: Música / B-Roll / Entrevista / Ignorar
 * @param {Array<{item, name, mediaType}>} scannedItems
 */
function renderAssignPanel(scannedItems) {
  const audioItems = scannedItems.filter((s) => s.mediaType === 'audio');
  const videoItems = scannedItems.filter((s) => s.mediaType === 'video');

  // Atualiza contadores de seção
  const ac = $('audio-count'); if (ac) ac.textContent = audioItems.length;
  const vc = $('video-count'); if (vc) vc.textContent = videoItems.length;

  // Renderiza cada seção
  _renderAssignSection('audio-items', audioItems);
  _renderAssignSection('video-items', videoItems);

  audioItems.length > 0 ? show('audio-section') : hide('audio-section');
  videoItems.length > 0 ? show('video-section') : hide('video-section');

  show('assign-panel');
  _updateAssignSummary();
}

function _renderAssignSection(containerId, items) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = '';

  items.forEach((scanned) => {
    const entry = document.createElement('div');
    entry.className = 'assign-entry';
    entry.dataset.id = scanned.name; // chave de lookup

    const namEl = document.createElement('span');
    namEl.className = 'assign-entry__name';
    namEl.textContent = scanned.name;
    namEl.title = scanned.name;

    const btns = document.createElement('div');
    btns.className = 'assign-entry__btns';

    const roles = [
      { key: 'music',     label: '&#9834; Música',     cls: 'role-btn--music'     },
      { key: 'broll',     label: '&#9654; B-Roll',     cls: 'role-btn--broll'     },
      { key: 'interview', label: '&#127908; Entrev.',   cls: 'role-btn--interview' },
      { key: 'skip',      label: '&#10005; Ignorar',   cls: 'role-btn--skip'      },
    ];

    roles.forEach(({ key, label, cls }) => {
      const btn = document.createElement('button');
      btn.className = 'role-btn ' + cls;
      btn.innerHTML = label;
      btn.dataset.role = key;
      btn.addEventListener('click', () => _assignRole(scanned, key, entry, btns));
      btns.appendChild(btn);
    });

    // Auto-sugestão por tipo de mídia
    if (scanned.mediaType === 'audio' && !AppState.music) {
      _assignRole(scanned, 'music', entry, btns);
    } else if (scanned.mediaType === 'video') {
      _assignRole(scanned, 'broll', entry, btns);
    }

    entry.appendChild(namEl);
    entry.appendChild(btns);
    container.appendChild(entry);
  });
}

function _assignRole(scanned, role, entryEl, btnsEl) {
  // Remove item de todos os slots
  if (AppState.music === scanned.item) AppState.music = null;
  AppState.broll     = AppState.broll.filter((x) => x !== scanned.item);
  AppState.interviews = AppState.interviews.filter((x) => x !== scanned.item);

  // Atribui ao slot correto
  if (role === 'music') {
    // Música é única — remove qualquer outro item que estava como música
    AppState.music = scanned.item;
  } else if (role === 'broll') {
    AppState.broll.push(scanned.item);
  } else if (role === 'interview') {
    AppState.interviews.push(scanned.item);
  }
  // 'skip' = não atribui a nada

  // Atualiza estilos visuais
  entryEl.className = 'assign-entry' + (role !== 'skip' ? ' assign-entry--active-' + role : '');
  btnsEl.querySelectorAll('.role-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.role === role);
  });

  _updateAssignSummary();
  updateMediaBadge();
}

function _updateAssignSummary() {
  const musicName = $('sum-music-name');
  const brollCnt  = $('sum-broll-count');
  const interCnt  = $('sum-interview-count');
  if (musicName) musicName.textContent = AppState.music ? getFileName(AppState.music) : '—';
  if (brollCnt)  brollCnt.textContent  = AppState.broll.length;
  if (interCnt)  interCnt.textContent  = AppState.interviews.length;
}

// ---------------------------------------------------------------------------
// File selection helpers (UXP Storage)
// ---------------------------------------------------------------------------

async function pickFile(types) {
  if (!localFileSystem) {
    showStepError(1, 'File picker indisponível neste ambiente. Use "Escanear painel do projeto" acima.');
    return null;
  }
  try {
    return await localFileSystem.getFileForOpening({ types });
  } catch (err) {
    Log.error('File picker falhou: ' + err.message);
    showStepError(1, 'File picker falhou: ' + err.message +
      ' — Use "Escanear painel do projeto" como alternativa.');
    return null;
  }
}

async function pickFiles(types) {
  if (!localFileSystem) {
    showStepError(1, 'File picker indisponível neste ambiente. Use "Escanear painel do projeto" acima.');
    return [];
  }
  try {
    if (localFileSystem.getFilesForOpening) {
      return (await localFileSystem.getFilesForOpening({ allowMultiple: true, types })) || [];
    }
    const f = await localFileSystem.getFileForOpening({ types });
    return f ? [f] : [];
  } catch (err) {
    Log.error('File picker (multi) falhou: ' + err.message);
    showStepError(1, 'File picker falhou: ' + err.message +
      ' — Use "Escanear painel do projeto" como alternativa.');
    return [];
  }
}

// ---------------------------------------------------------------------------
// BPM UI — Step 2
// ---------------------------------------------------------------------------

function updateBpmDisplay(bpm) {
  const display = $('bpm-display');
  if (display) display.textContent = bpm;
  const interval = (60 / bpm).toFixed(2);
  const beatEl = $('beat-interval');
  if (beatEl) beatEl.textContent = interval + 's / beat';
  AppState.bpm = bpm;
}

function setAnalysisReady(bpm) {
  updateBpmDisplay(bpm);
  const statusEl = $('analysis-status');
  if (statusEl) {
    statusEl.textContent = 'Pronto para montar';
    statusEl.className = 'analysis-status analysis-status--ok';
  }
  AppState.analysed = true;

  const musicCard = $('analysis-music-card');
  if (musicCard && AppState.music) {
    const info = Analysis.getFileInfo(AppState.music);
    const nameEl = musicCard.querySelector('.acard-name');
    const sizeEl = musicCard.querySelector('.acard-meta');
    if (nameEl) nameEl.textContent = info.name;
    if (sizeEl) sizeEl.textContent = info.size + ' · BPM ajustável';
  }

  const clipsEl = $('analysis-clips-count');
  if (clipsEl) clipsEl.textContent = AppState.broll.length + ' B-Roll  ·  ' +
    AppState.interviews.length + ' Entrevistas  ·  ' + AppState.assets.length + ' Assets';
}

// ---------------------------------------------------------------------------
// Progress bar — Step 4
// ---------------------------------------------------------------------------

function setProgress(pct, text) {
  const bar = $('progress-fill');
  if (bar) bar.style.width = Math.min(100, pct) + '%';
  if (text) {
    const textEl = $('progress-text');
    if (textEl) textEl.textContent = text;
  }
}

function resetGenerateUI() {
  setProgress(0, '');
  hide('progress-section');
  hide('generate-success');
  hide('generate-error');
  $('btn-generate').disabled = false;
}

function showGenerateSuccess() {
  hide('progress-section');
  show('generate-success');
}

function showGenerateError(msg) {
  hide('progress-section');
  const el = $('generate-error');
  if (el) el.textContent = 'Erro: ' + msg;
  show('generate-error');
}

// ---------------------------------------------------------------------------
// Summary — Step 4
// ---------------------------------------------------------------------------

const DURATION_LABELS = {
  15: '15s', 30: '30s', 45: '45s', 60: '1min',
  90: '1min 30s', 120: '2min', 180: '3min', 300: '5min',
};

function buildGenerateSummary() {
  const el = $('generate-summary');
  if (!el) return;

  const dur  = DURATION_LABELS[AppState.durationSec] || AppState.durationSec + 's';
  const rows = [
    ['Música',     AppState.music ? getFileName(AppState.music) : '—'],
    ['BPM',        AppState.bpm + ' BPM'],
    ['B-Roll',     AppState.broll.length + ' clipes'],
    ['Entrevistas',AppState.useInterviews ? AppState.interviews.length + ' clipes' : 'não'],
    ['Duração',    dur],
    ['Formato',    AppState.format + ' (preset padrão)'],
    ['Ritmo',      AppState.rhythm],
    ['Frequência', AppState.cutFreq],
    ['Title card', AppState.addTitleCard ? '"' + (AppState.titleText || 'TÍTULO') + '"' : 'não'],
    ['Cartela final', AppState.addEndCard ? '"' + (AppState.endText || 'FIM') + '"' : 'não'],
  ];

  el.innerHTML = rows
    .map(([k, v]) => '<div class="summary-row"><span class="summary-key">' + k +
                     '</span><span class="summary-val">' + v + '</span></div>')
    .join('');
}
