/**
 * js/main.js — Entrypoint: registro do painel UXP + orquestração
 *
 * Este arquivo:
 * 1. Registra o painel via entrypoints.setup() (obrigatório para UXP)
 * 2. Conecta todos os event listeners da UI
 * 3. Orquestra a geração do rough cut chamando PremierePro e Assembly
 */

'use strict';

const { entrypoints } = require('uxp');

// ---------------------------------------------------------------------------
// Registro do painel — obrigatório para o Premiere reconhecer o plugin
// ---------------------------------------------------------------------------

entrypoints.setup({
  panels: {
    mainPanel: {
      show() { Log.debug('Painel AutoRecap visível.'); },
      hide() {},
    },
  },
});

// ---------------------------------------------------------------------------
// Geração do rough cut — função principal
// ---------------------------------------------------------------------------

async function generateRoughCut() {
  if (AppState.generating) return;
  AppState.generating = true;

  Log.clear();
  resetGenerateUI();
  show('progress-section');
  $('btn-generate').disabled = true;

  try {
    // 1. Projeto
    setProgress(3, 'Obtendo projeto do Premiere...');
    Log.info('=== AutoRecap — iniciando geração ===');
    const project = await PremierePro.getProject();
    Log.ok('Projeto: ' + (project.name || 'sem nome'));

    // 2. Importação — só executa se os itens vieram do file picker (têm nativePath)
    //    Se vieram do scan do projeto, já são ProjectItems e não precisam de import.
    setProgress(8, 'Verificando mídia...');

    async function resolveItem(item) {
      if (PremierePro.isProjectItem(item)) return item; // já é ProjectItem
      // É um File — importa e localiza no projeto
      if (item.nativePath) {
        try { project.importFiles([item.nativePath], true, project.rootItem, false); } catch (_) {}
        await new Promise((r) => setTimeout(r, 800));
        return await PremierePro.findProjectItem(project, getFileName(item));
      }
      return null;
    }

    const musicItem = await resolveItem(AppState.music);
    if (!musicItem) throw new Error('Música não encontrada no projeto: ' + getFileName(AppState.music));
    Log.ok('Música: ' + getFileName(AppState.music));

    setProgress(18, 'Localizando clipes B-Roll...');
    const brollItems = [];
    for (const f of AppState.broll) {
      const item = await resolveItem(f);
      if (item) brollItems.push(item);
      else Log.warn('B-Roll não localizado: ' + getFileName(f));
    }
    if (brollItems.length === 0) throw new Error('Nenhum clipe B-Roll disponível. Atribua clipes de vídeo como B-Roll na Etapa 1.');

    const interviewItems = [];
    if (AppState.useInterviews && AppState.interviews.length > 0) {
      for (const f of AppState.interviews) {
        const item = await resolveItem(f);
        if (item) interviewItems.push(item);
      }
      Log.info('Entrevistas: ' + interviewItems.length);
    }

    // 4. Cria sequência
    setProgress(25, 'Criando sequência...');
    const ts  = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const seq = await PremierePro.createSequence(project, 'AutoRecap — ' + ts);
    await PremierePro.prepareVideoTracks(seq);

    // 5. Insere música
    setProgress(32, 'Inserindo trilha principal em A1...');
    await PremierePro.insertMusic(seq, musicItem);

    // 6. Title card
    if (AppState.addTitleCard) {
      setProgress(36, 'Adicionando marker de título...');
      PremierePro.createTitleCardMarker(seq, 0, AppState.titleText);
    }

    // 7. Plano de montagem
    setProgress(40, 'Calculando plano narrativo...');
    Log.info('Calculando plano: ' + AppState.durationSec + 's · ' +
             AppState.rhythm + ' · ' + AppState.cutFreq + ' freq · BPM=' + AppState.bpm);

    const plan = Assembly.buildClipPlan(AppState, brollItems, interviewItems);
    Log.ok('Plano gerado: ' + plan.clips.length + ' clipes em ' +
           plan.sections.length + ' seções narrativas.');

    // 8. Insere clipes
    setProgress(45, 'Distribuindo clipes na timeline...');
    await Assembly.executePlan(seq, plan, (pct, text) => {
      // Progresso dentro de 45–85%
      setProgress(45 + pct * 0.40, text);
    });

    // 9. Markers de seção
    if (AppState.addSectionMarkers) {
      setProgress(88, 'Adicionando markers de seção...');
      PremierePro.createSectionMarkers(seq, plan.sections);
    }

    // 10. Cartela final
    if (AppState.addEndCard) {
      setProgress(92, 'Adicionando marker de cartela final...');
      PremierePro.createEndCardMarker(seq, plan.totalVideoDur, AppState.endText);
    }

    setProgress(100, 'Concluído!');
    await new Promise((r) => setTimeout(r, 500));
    showGenerateSuccess();
    Log.ok('=== Rough cut gerado com sucesso! ===');
    Log.info('Total de clipes: ' + plan.clips.length);
    Log.info('Duração montada: ' + plan.totalVideoDur.toFixed(1) + 's');
    plan.sections.forEach((s) => {
      Log.info('  ' + s.name + ': início=' + s.startSec.toFixed(1) +
               's · dur=' + s.durationSec.toFixed(1) + 's');
    });

  } catch (err) {
    Log.error('FALHA: ' + err.message);
    showGenerateError(err.message);
    console.error('[AutoRecap] Erro na geração:', err);
  } finally {
    AppState.generating = false;
    $('btn-generate').disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {

  // — Navegação —
  $('btn-next').addEventListener('click', () => {
    const err = validateStep(AppState.step);
    if (err) { showStepError(AppState.step, err); return; }
    clearStepError(AppState.step);
    if (AppState.step < TOTAL_STEPS) activateStep(AppState.step + 1);
  });

  $('btn-back').addEventListener('click', () => {
    if (AppState.step > 1) {
      clearStepError(AppState.step);
      activateStep(AppState.step - 1);
    }
  });

  // =========================================================================
  // STEP 1 — Mídia
  // =========================================================================

  // — Scan do painel do projeto (modo primário) —
  $('btn-scan-project').addEventListener('click', async () => {
    const btn    = $('btn-scan-project');
    const status = $('scan-status');
    btn.disabled = true;
    if (status) { status.textContent = 'Escaneando...'; show('scan-status'); }

    // Limpa atribuições anteriores ao re-escanear
    AppState.music      = null;
    AppState.broll      = [];
    AppState.interviews = [];

    try {
      const project = await PremierePro.getProject();
      const scanned = await PremierePro.scanProjectItems(project);

      if (scanned.length === 0) {
        if (status) status.textContent = 'Nenhum item de mídia encontrado. Importe arquivos no Premiere primeiro.';
        Log.warn('Projeto sem itens de mídia (vídeo/áudio). Importe os clipes pelo menu Arquivo → Importar.');
      } else {
        if (status) status.textContent = scanned.length + ' item(s) encontrado(s).';
        renderAssignPanel(scanned);
        Log.ok(scanned.length + ' item(s) escaneado(s) do projeto.');
      }
    } catch (err) {
      if (status) status.textContent = 'Erro: ' + err.message;
      Log.error('Scan falhou: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // — File picker (modo secundário — fallback) —
  $('btn-select-music').addEventListener('click', async () => {
    const file = await pickFile(['mp3', 'wav', 'aac', 'm4a', 'aif', 'aiff', 'ogg']);
    if (!file) return;
    AppState.music = file;
    updateMusicUI();
    Log.info('Música (pasta): ' + getFileName(file));
  });

  $('btn-remove-music').addEventListener('click', () => {
    AppState.music = null;
    AppState.analysed = false;
    updateMusicUI();
  });

  $('btn-select-broll').addEventListener('click', async () => {
    const files = await pickFiles(['mp4', 'mov', 'avi', 'mxf', 'r3d', 'braw', 'mkv', 'mpg']);
    if (!files || files.length === 0) return;
    const existing = new Set(AppState.broll.map(getFileName));
    let added = 0;
    files.forEach((f) => {
      if (!existing.has(getFileName(f))) { AppState.broll.push(f); added++; }
    });
    updateBrollUI();
    Log.info(added + ' B-Roll da pasta adicionado(s). Total: ' + AppState.broll.length);
  });

  $('btn-select-interviews').addEventListener('click', async () => {
    const files = await pickFiles(['mp4', 'mov', 'avi', 'mxf', 'mkv']);
    if (!files || files.length === 0) return;
    const existing = new Set(AppState.interviews.map(getFileName));
    files.forEach((f) => {
      if (!existing.has(getFileName(f))) AppState.interviews.push(f);
    });
    updateInterviewUI();
    Log.info('Entrevistas da pasta: ' + AppState.interviews.length);
  });

  // =========================================================================
  // STEP 2 — Análise
  // =========================================================================

  $('btn-analyze').addEventListener('click', async () => {
    if (!AppState.music) {
      showStepError(2, 'Volte e selecione a música primeiro.');
      return;
    }

    const btn    = $('btn-analyze');
    const status = $('analysis-status');
    btn.disabled = true;
    if (status) {
      status.textContent = 'Analisando...';
      status.className   = 'analysis-status analysis-status--loading';
    }

    const bpm = await Analysis.simulateBpmDetection(AppState.music, (pct, text) => {
      if (status) status.textContent = text + ' (' + pct + '%)';
    });

    setAnalysisReady(bpm);
    btn.disabled = false;
  });

  // BPM slider
  const bpmSlider = $('bpm-slider');
  const bpmInput  = $('bpm-input');

  if (bpmSlider) {
    bpmSlider.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      if (bpmInput) bpmInput.value = v;
      updateBpmDisplay(v);
      AppState.analysed = true;
      const statusEl = $('analysis-status');
      if (statusEl && !statusEl.classList.contains('analysis-status--ok')) {
        statusEl.textContent = 'BPM ajustado manualmente';
        statusEl.className   = 'analysis-status analysis-status--ok';
      }
    });
  }

  if (bpmInput) {
    bpmInput.addEventListener('change', (e) => {
      let v = parseInt(e.target.value, 10);
      v = Math.max(40, Math.min(240, v || 120));
      e.target.value = v;
      if (bpmSlider) bpmSlider.value = v;
      updateBpmDisplay(v);
      AppState.analysed = true;
    });
  }

  // =========================================================================
  // STEP 3 — Configuração
  // =========================================================================

  // Duração
  document.querySelectorAll('input[name="cfg-duration"]').forEach((r) => {
    r.addEventListener('change', (e) => {
      const v = parseInt(e.target.value, 10);
      AppState.durationSec = v;
      // custom
      e.target.value === 'custom' ? show('custom-duration-row') : hide('custom-duration-row');
    });
  });

  const customDur = $('input-custom-duration');
  if (customDur) {
    customDur.addEventListener('change', (e) => {
      const v = parseInt(e.target.value, 10);
      if (v > 0) AppState.durationSec = v;
    });
  }

  // Formato
  document.querySelectorAll('input[name="cfg-format"]').forEach((r) => {
    r.addEventListener('change', (e) => {
      AppState.format = e.target.value;
      Log.ph('Formato ' + e.target.value + ' selecionado — sequência usará preset padrão (PLACEHOLDER).');
    });
  });

  // Ritmo
  document.querySelectorAll('input[name="cfg-rhythm"]').forEach((r) => {
    r.addEventListener('change', (e) => { AppState.rhythm = e.target.value; });
  });

  // Frequência de cortes
  document.querySelectorAll('input[name="cfg-freq"]').forEach((r) => {
    r.addEventListener('change', (e) => { AppState.cutFreq = e.target.value; });
  });

  // Toggles de extras
  $('chk-use-interviews').addEventListener('change', (e) => {
    AppState.useInterviews = e.target.checked;
  });

  $('chk-title-card').addEventListener('change', (e) => {
    AppState.addTitleCard = e.target.checked;
    e.target.checked ? show('title-text-row') : hide('title-text-row');
  });
  $('input-title-text').addEventListener('input', (e) => { AppState.titleText = e.target.value; });

  $('chk-end-card').addEventListener('change', (e) => {
    AppState.addEndCard = e.target.checked;
    e.target.checked ? show('end-text-row') : hide('end-text-row');
  });
  $('input-end-text').addEventListener('input', (e) => { AppState.endText = e.target.value; });

  $('chk-section-markers').addEventListener('change', (e) => {
    AppState.addSectionMarkers = e.target.checked;
  });
  $('chk-media-labels').addEventListener('change', (e) => {
    AppState.addMediaLabels = e.target.checked;
  });

  // =========================================================================
  // STEP 4 — Gerar
  // =========================================================================

  $('btn-generate').addEventListener('click', generateRoughCut);

  // Toggle do log
  $('btn-toggle-log').addEventListener('click', () => {
    const logPanel = $('log-panel');
    if (!logPanel) return;
    const isHidden = logPanel.classList.toggle('hidden');
    $('btn-toggle-log').textContent = isHidden ? 'Ver log' : 'Ocultar log';
  });

  // =========================================================================
  // Init
  // =========================================================================

  activateStep(1);
  Log.info('AutoRecap carregado. Versão MVP — veja README para limitações.');
});
