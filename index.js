/**
 * index.js — Rough Cut Generator para Premiere Pro (UXP)
 *
 * APIs utilizadas:
 *   require('uxp')          → storage (file picker), entrypoints
 *   require('premierepro') → API nativa do Premiere Pro
 *
 * PLACEHOLDERS (não implementados nesta versão):
 *   - Detecção de batida/BPM da música (beat detection)
 *   - Seleção inteligente de trecho de clipe (in/out automático)
 *   - Criação de gráfico real para cartelas (title card como gráfico)
 *   - Duração "Seguir música": usa fallback de 3 min (duração real requer
 *     análise de metadados do arquivo de áudio)
 *   - Trim preciso do clipe após inserção (depende de acesso a clip.end)
 */

'use strict';

const { entrypoints } = require('uxp');
const { localFileSystem } = require('uxp').storage;
const ppro = require('premierepro');

// ---------------------------------------------------------------------------
// Registro do painel UXP
// ---------------------------------------------------------------------------

entrypoints.setup({
  panels: {
    mainPanel: {
      show() {},
      hide() {},
    },
  },
});

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TICKS_PER_SECOND = 254016000000;

// Duração média de clipe por ritmo (segundos)
const RHYTHM = {
  fast:   { min: 1.0, max: 2.5 },
  medium: { min: 2.5, max: 4.5 },
  slow:   { min: 4.0, max: 8.0 },
};

// Duração reservada para cartela de título e cartela final (em segundos)
const TITLE_CARD_DURATION = 3;
const END_CARD_DURATION   = 3;

// Duração padrão de clipes de entrevista inseridos na timeline
const INTERVIEW_CLIP_DURATION = 20;

// Duração fallback quando "Seguir música" está selecionado
// PLACEHOLDER: duração real da música precisaria de análise de metadados
const MUSIC_MATCH_FALLBACK_SECONDS = 180;

// ---------------------------------------------------------------------------
// Estado da aplicação
// ---------------------------------------------------------------------------

const state = {
  step:         1,
  music:        null,   // File object (UXP)
  broll:        [],     // File[] (UXP)
  interviews:   [],     // File[] (UXP)
  hasInterviews: false,
  duration:     'match',
  rhythm:       'medium',
  addTitleCard: false,
  titleText:    '',
  addEndCard:   false,
  endText:      '',
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function toTicks(seconds) {
  return Math.round(seconds * TICKS_PER_SECOND);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getFileName(file) {
  return file.name || file.nativePath.split(/[\\/]/).pop();
}

// ---------------------------------------------------------------------------
// Pesquisa de ProjectItem no projeto
// ---------------------------------------------------------------------------

function getChildren(item) {
  const c = item.children;
  if (!c) return [];
  // UXP retorna array nativo; ExtendScript usa numItems
  if (Array.isArray(c)) return c;
  const arr = [];
  for (let i = 0; i < c.numItems; i++) arr.push(c[i]);
  return arr;
}

function findProjectItemByName(name, bin) {
  bin = bin || null;
  const root = bin;
  const children = getChildren(root);
  for (const child of children) {
    if (child.name === name) return child;
    // type 2 = bin; recursão
    if (child.type === 2) {
      const found = findProjectItemByName(name, child);
      if (found) return found;
    }
  }
  return null;
}

async function findItemInProject(project, filename) {
  const root = project.rootItem;
  return findProjectItemByName(filename, root);
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function $(id) {
  return document.getElementById(id);
}

function show(el) {
  if (typeof el === 'string') el = $(el);
  el.classList.remove('hidden');
}

function hide(el) {
  if (typeof el === 'string') el = $(el);
  el.classList.add('hidden');
}

function setProgress(pct, text) {
  $('progress-fill').style.width = pct + '%';
  if (text) $('progress-text').textContent = text;
}

function showGenerateError(msg) {
  const el = $('error-msg');
  el.textContent = msg;
  show(el);
}

function renderFileList(containerId, files, onRemove) {
  const container = $(containerId);
  container.innerHTML = '';
  files.forEach((f, i) => {
    const entry = document.createElement('div');
    entry.className = 'file-list-entry';

    const num = document.createElement('span');
    num.className = 'file-list-entry__num';
    num.textContent = (i + 1) + '.';

    const name = document.createElement('span');
    name.className = 'file-list-entry__name';
    name.textContent = getFileName(f);

    const btn = document.createElement('button');
    btn.className = 'file-list-entry__remove';
    btn.textContent = '✕';
    btn.addEventListener('click', () => onRemove(i));

    entry.appendChild(num);
    entry.appendChild(name);
    entry.appendChild(btn);
    container.appendChild(entry);
  });
}

function updateBrollUI() {
  renderFileList('broll-list', state.broll, (i) => {
    state.broll.splice(i, 1);
    updateBrollUI();
  });
  if (state.broll.length > 0) {
    const badge = $('broll-count');
    badge.textContent = state.broll.length + ' clipe(s) selecionado(s)';
    show(badge);
  } else {
    hide('broll-count');
  }
}

function updateInterviewUI() {
  renderFileList('interview-list', state.interviews, (i) => {
    state.interviews.splice(i, 1);
    updateInterviewUI();
  });
  if (state.interviews.length > 0) {
    const badge = $('interview-count');
    badge.textContent = state.interviews.length + ' entrevista(s) selecionada(s)';
    show(badge);
  } else {
    hide('interview-count');
  }
}

function buildSummary() {
  const durationLabel = {
    match: 'Seguir música (~3 min fallback)',
    '60':  '1 minuto',
    '120': '2 minutos',
    '180': '3 minutos',
    '300': '5 minutos',
  }[state.duration] || state.duration;

  const rhythmLabel = {
    fast:   'Rápido (1–2.5s)',
    medium: 'Médio (2.5–4.5s)',
    slow:   'Lento (4–8s)',
  }[state.rhythm] || state.rhythm;

  const extras = [];
  if (state.addTitleCard) extras.push('Cartela de título');
  if (state.addEndCard)   extras.push('Cartela final');

  $('summary').innerHTML = [
    '<strong>Música:</strong> ' + (state.music ? getFileName(state.music) : '—'),
    '<strong>B-Roll:</strong> ' + state.broll.length + ' clipe(s)',
    '<strong>Entrevistas:</strong> ' + (state.hasInterviews ? state.interviews.length + ' clipe(s)' : 'não'),
    '<strong>Duração:</strong> ' + durationLabel,
    '<strong>Ritmo:</strong> ' + rhythmLabel,
    extras.length ? '<strong>Extras:</strong> ' + extras.join(', ') : '',
  ].filter(Boolean).join('<br />');
}

// ---------------------------------------------------------------------------
// Navegação entre steps
// ---------------------------------------------------------------------------

function activateStep(n) {
  // Oculta todos os painéis
  document.querySelectorAll('.step-panel').forEach((p) => p.classList.remove('active'));
  // Ativa o painel do step atual
  $('step-' + n).classList.add('active');

  // Atualiza indicadores
  document.querySelectorAll('.steps-nav__item').forEach((dot) => {
    const s = parseInt(dot.dataset.step, 10);
    dot.classList.remove('active', 'done');
    if (s === n) dot.classList.add('active');
    else if (s < n) dot.classList.add('done');
  });

  $('step-label').textContent = 'Passo ' + n + ' de 6';
  $('btn-back').style.visibility = n === 1 ? 'hidden' : 'visible';

  if (n === 6) {
    buildSummary();
    $('btn-next').style.display = 'none';
  } else {
    $('btn-next').style.display = '';
  }

  state.step = n;
}

function validateStep(n) {
  if (n === 1 && !state.music) {
    return 'Selecione a música antes de continuar.';
  }
  if (n === 2 && state.broll.length === 0) {
    return 'Adicione pelo menos um clipe B-Roll.';
  }
  if (n === 3 && state.hasInterviews && state.interviews.length === 0) {
    return 'Adicione pelo menos uma entrevista ou desative a opção.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// File selection (UXP Storage)
// ---------------------------------------------------------------------------

async function selectMusic() {
  try {
    const file = await localFileSystem.getFileForOpening({
      types: ['mp3', 'wav', 'aac', 'm4a', 'aif', 'aiff'],
    });
    if (!file) return;
    state.music = file;
    $('music-name').textContent = getFileName(file);
    show('music-info');
  } catch (err) {
    console.error('Erro ao selecionar música:', err);
  }
}

async function selectBroll() {
  try {
    // getFilesForOpening: UXP >= 3.x; fallback para getFileForOpening se necessário
    let files;
    if (localFileSystem.getFilesForOpening) {
      files = await localFileSystem.getFilesForOpening({
        allowMultiple: true,
        types: ['mp4', 'mov', 'avi', 'mxf', 'r3d', 'braw', 'mkv'],
      });
    } else {
      const f = await localFileSystem.getFileForOpening({
        types: ['mp4', 'mov', 'avi', 'mxf', 'r3d', 'braw', 'mkv'],
      });
      files = f ? [f] : [];
    }
    if (!files || files.length === 0) return;
    // Adiciona sem duplicar por nome
    const existing = new Set(state.broll.map(getFileName));
    files.forEach((f) => {
      if (!existing.has(getFileName(f))) state.broll.push(f);
    });
    updateBrollUI();
  } catch (err) {
    console.error('Erro ao selecionar B-Roll:', err);
  }
}

async function selectInterviews() {
  try {
    let files;
    if (localFileSystem.getFilesForOpening) {
      files = await localFileSystem.getFilesForOpening({
        allowMultiple: true,
        types: ['mp4', 'mov', 'avi', 'mxf', 'r3d', 'braw', 'mkv'],
      });
    } else {
      const f = await localFileSystem.getFileForOpening({
        types: ['mp4', 'mov', 'avi', 'mxf', 'r3d', 'braw', 'mkv'],
      });
      files = f ? [f] : [];
    }
    if (!files || files.length === 0) return;
    const existing = new Set(state.interviews.map(getFileName));
    files.forEach((f) => {
      if (!existing.has(getFileName(f))) state.interviews.push(f);
    });
    updateInterviewUI();
  } catch (err) {
    console.error('Erro ao selecionar entrevistas:', err);
  }
}

// ---------------------------------------------------------------------------
// Algoritmo de rough cut
// ---------------------------------------------------------------------------

/**
 * Monta a lista ordenada de clipes a inserir.
 * B-roll embaralhado, entrevistas intercaladas uniformemente.
 */
function buildClipPlan(brollItems, interviewItems, totalDurationSec, rhythm) {
  const range   = RHYTHM[rhythm] || RHYTHM.medium;
  const plan    = [];
  let elapsed   = 0;
  let brollIdx  = 0;
  let clipCount = 0;

  // Quantos clipes de b-roll entre cada entrevista
  const interviewInterval = interviewItems.length > 0
    ? Math.max(3, Math.floor((totalDurationSec / ((range.min + range.max) / 2)) / (interviewItems.length + 1)))
    : Infinity;

  let interviewIdx = 0;

  while (elapsed < totalDurationSec && plan.length < 500) {
    const isInterviewSlot =
      interviewItems.length > 0 &&
      clipCount > 0 &&
      clipCount % interviewInterval === 0 &&
      interviewIdx < interviewItems.length;

    if (isInterviewSlot) {
      const dur = Math.min(INTERVIEW_CLIP_DURATION, totalDurationSec - elapsed);
      plan.push({ item: interviewItems[interviewIdx % interviewItems.length], duration: dur, type: 'interview' });
      interviewIdx++;
      elapsed += dur;
    } else {
      const dur = Math.min(randomBetween(range.min, range.max), totalDurationSec - elapsed);
      plan.push({ item: brollItems[brollIdx % brollItems.length], duration: dur, type: 'broll' });
      brollIdx++;
      elapsed += dur;
    }

    clipCount++;
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Premiere Pro — funções de API
// ---------------------------------------------------------------------------

async function importFilePaths(project, paths) {
  // importFiles(paths, suppressUI, targetBin, importAsNumberedStills)
  project.importFiles(paths, true, project.rootItem, false);
  // Aguarda o Premiere processar a importação
  await sleep(1500);
}

async function createOrGetSequence(project) {
  const timestamp = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const name = 'Rough Cut - ' + timestamp;
  try {
    const seq = await project.createNewSequence(name, '');
    if (seq) return seq;
  } catch (_) {
    // createNewSequence pode lançar se não houver preset
  }
  // Fallback: usa sequência ativa
  const active = await project.getActiveSequence();
  if (active) return active;
  throw new Error(
    'Não foi possível criar uma sequência. Abra ou crie uma sequência no Premiere Pro primeiro.'
  );
}

async function insertMusicTrack(sequence, musicItem) {
  try {
    const tracks = sequence.audioTracks;
    if (!tracks || tracks.length === 0) return;
    const track = tracks[0];
    await track.insertClip(musicItem, 0);
  } catch (err) {
    console.warn('Aviso: não foi possível inserir música na faixa de áudio:', err.message);
  }
}

async function insertVideoClips(sequence, plan, startTimeSec) {
  const tracks = sequence.videoTracks;
  if (!tracks || tracks.length === 0) {
    throw new Error('Sequência sem faixas de vídeo disponíveis.');
  }
  const vTrack = tracks[0];

  let currentTick = toTicks(startTimeSec);

  for (const entry of plan) {
    try {
      await vTrack.insertClip(entry.item, currentTick);

      // Tenta trimmar o clipe ao tamanho do ritmo
      // PLACEHOLDER: clip.end pode não estar acessível em todas versões da API
      try {
        const clips = vTrack.clips;
        if (clips && clips.length > 0) {
          const inserted = clips[clips.length - 1];
          const endTick = currentTick + toTicks(entry.duration);
          if (inserted && inserted.end !== undefined) {
            inserted.end = endTick;
          }
        }
      } catch (trimErr) {
        // PLACEHOLDER: trimming não suportado nesta versão da API
        console.warn('Trim não aplicado:', trimErr.message);
      }

      currentTick += toTicks(entry.duration);
    } catch (clipErr) {
      console.warn('Clipe não inserido:', entry.item.name, clipErr.message);
    }
  }

  return currentTick; // retorna tempo final em ticks
}

function addMarkers(sequence, opts) {
  try {
    const markers = sequence.markers;
    if (!markers) return;

    if (opts.titleCard) {
      // PLACEHOLDER: cria apenas marker. Cartela real precisaria de Mogrt/gráfico.
      const m = markers.createMarker(0);
      m.name = '[TÍTULO] ' + (opts.titleText || 'NOME DO EVENTO');
      m.comments = 'PLACEHOLDER: substitua por gráfico/title card real.';
      m.type = 0;
    }

    if (opts.endCard && opts.endTimeTick !== undefined) {
      // PLACEHOLDER: marker para cartela final
      const m = markers.createMarker(opts.endTimeTick);
      m.name = '[FIM] ' + (opts.endText || 'FIM');
      m.comments = 'PLACEHOLDER: substitua por gráfico/end card real.';
      m.type = 0;
    }
  } catch (err) {
    console.warn('Markers não adicionados:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Geração principal do rough cut
// ---------------------------------------------------------------------------

async function generateRoughCut() {
  const { music, broll, interviews, hasInterviews, duration, rhythm,
          addTitleCard, titleText, addEndCard, endText } = state;

  hide('success-msg');
  hide('error-msg');
  show('progress-section');
  $('btn-generate').disabled = true;

  try {
    // 1. Obtém projeto ativo
    setProgress(5, 'Obtendo projeto...');
    const project = await ppro.app.getActiveProject();
    if (!project) throw new Error('Nenhum projeto aberto no Premiere Pro.');

    // 2. Coleta caminhos dos arquivos
    setProgress(10, 'Importando arquivos...');
    const allPaths = [music.nativePath];
    broll.forEach((f) => allPaths.push(f.nativePath));
    if (hasInterviews) interviews.forEach((f) => allPaths.push(f.nativePath));

    await importFilePaths(project, allPaths);

    // 3. Localiza os itens importados no painel do projeto
    setProgress(25, 'Localizando clipes no projeto...');

    const musicItem = await findItemInProject(project, getFileName(music));
    if (!musicItem) throw new Error('Não foi possível localizar "' + getFileName(music) + '" no projeto. Verifique se o arquivo foi importado corretamente.');

    const brollItems = [];
    for (const f of broll) {
      const item = await findItemInProject(project, getFileName(f));
      if (item) brollItems.push(item);
      else console.warn('B-Roll não encontrado no projeto:', getFileName(f));
    }
    if (brollItems.length === 0) throw new Error('Nenhum clipe B-Roll foi localizado no projeto após importação.');

    const interviewItems = [];
    if (hasInterviews) {
      for (const f of interviews) {
        const item = await findItemInProject(project, getFileName(f));
        if (item) interviewItems.push(item);
      }
    }

    // 4. Cria sequência
    setProgress(35, 'Criando sequência...');
    const sequence = await createOrGetSequence(project);

    // 5. Calcula duração total
    // PLACEHOLDER: "Seguir música" usa fallback fixo; duração real precisaria
    // de análise de metadados do arquivo de áudio.
    const totalDurationSec = duration === 'match'
      ? MUSIC_MATCH_FALLBACK_SECONDS
      : parseInt(duration, 10);

    // 6. Calcula tempo de início (reserva espaço para title card)
    const videoStartSec = addTitleCard ? TITLE_CARD_DURATION : 0;

    // 7. Monta plano de clipes
    setProgress(45, 'Planejando sequência...');
    const shuffledBroll = shuffle([...brollItems]);
    const plan = buildClipPlan(shuffledBroll, interviewItems,
                               totalDurationSec - videoStartSec - (addEndCard ? END_CARD_DURATION : 0),
                               rhythm);

    // 8. Insere música
    setProgress(55, 'Inserindo música...');
    await insertMusicTrack(sequence, musicItem);

    // 9. Insere clipes de vídeo
    setProgress(65, 'Distribuindo clipes na timeline...');
    const endTick = await insertVideoClips(sequence, plan, videoStartSec);

    // 10. Adiciona markers (title card e end card)
    setProgress(90, 'Adicionando markers...');
    addMarkers(sequence, {
      titleCard:   addTitleCard,
      titleText,
      endCard:     addEndCard,
      endText,
      endTimeTick: endTick,
    });

    setProgress(100, 'Concluído!');
    await sleep(400);
    hide('progress-section');
    show('success-msg');

  } catch (err) {
    console.error('Erro ao gerar rough cut:', err);
    hide('progress-section');
    showGenerateError('Erro: ' + (err && err.message ? err.message : String(err)));
  } finally {
    $('btn-generate').disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {

  // — Step navigation —
  $('btn-next').addEventListener('click', () => {
    const err = validateStep(state.step);
    if (err) {
      // Mostra erro inline simples
      const panel = $('step-' + state.step);
      let errEl = panel.querySelector('.inline-error');
      if (!errEl) {
        errEl = document.createElement('div');
        errEl.className = 'feedback feedback--error inline-error';
        panel.appendChild(errEl);
      }
      errEl.textContent = err;
      show(errEl);
      return;
    }
    // Remove erro anterior se houver
    const prev = $('step-' + state.step).querySelector('.inline-error');
    if (prev) hide(prev);
    if (state.step < 6) activateStep(state.step + 1);
  });

  $('btn-back').addEventListener('click', () => {
    if (state.step > 1) activateStep(state.step - 1);
  });

  // — Step 1: Music —
  $('btn-select-music').addEventListener('click', () => selectMusic());
  $('btn-remove-music').addEventListener('click', () => {
    state.music = null;
    hide('music-info');
  });

  // — Step 2: B-Roll —
  $('btn-select-broll').addEventListener('click', () => selectBroll());

  // — Step 3: Interviews —
  $('chk-interviews').addEventListener('change', (e) => {
    state.hasInterviews = e.target.checked;
    if (state.hasInterviews) show('interview-section');
    else hide('interview-section');
  });
  $('btn-select-interviews').addEventListener('click', () => selectInterviews());

  // — Step 4: Duration —
  document.querySelectorAll('input[name="duration"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      state.duration = e.target.value;
    });
  });

  // — Step 5: Rhythm —
  document.querySelectorAll('input[name="rhythm"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      state.rhythm = e.target.value;
    });
  });

  $('chk-title-card').addEventListener('change', (e) => {
    state.addTitleCard = e.target.checked;
    if (state.addTitleCard) show('title-input-row');
    else hide('title-input-row');
  });
  $('input-title-text').addEventListener('input', (e) => {
    state.titleText = e.target.value;
  });

  $('chk-end-card').addEventListener('change', (e) => {
    state.addEndCard = e.target.checked;
    if (state.addEndCard) show('end-input-row');
    else hide('end-input-row');
  });
  $('input-end-text').addEventListener('input', (e) => {
    state.endText = e.target.value;
  });

  // — Step 6: Generate —
  $('btn-generate').addEventListener('click', () => generateRoughCut());

  // — Init —
  activateStep(1);
});
