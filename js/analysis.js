/**
 * js/analysis.js — Análise de BPM e metadados de mídia
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  O que é REAL aqui:                                             │
 * │  • Leitura de nome/tamanho dos arquivos (UXP File API)          │
 * │  • Beat-grid sintético calculado do BPM manual                  │
 * │  • Snap de duração de clipe ao beat grid (algoritmo real)       │
 * │                                                                 │
 * │  O que é PLACEHOLDER:                                           │
 * │  • Auto-detecção de BPM via áudio (Web Audio API indisponível   │
 * │    no ambiente UXP do Premiere; requereria lib nativa externa)  │
 * │  • Duração real da música (metadados não expostos via API UXP)  │
 * │  • Score de qualidade por clipe (requer análise de vídeo/IA)    │
 * │  • Agrupamento inteligente por tipo de cena                     │
 * └─────────────────────────────────────────────────────────────────┘
 */

'use strict';

// ---------------------------------------------------------------------------
// Beat-grid — real, calculado a partir do BPM manual
// ---------------------------------------------------------------------------

/**
 * Retorna um array com os timestamps (segundos) de cada beat.
 * Funciona de verdade: posiciona cortes nos beats da música
 * desde que o BPM manual esteja correto.
 */
function buildBeatGrid(bpm, totalDurationSec) {
  const interval = 60 / bpm;
  const beats = [];
  for (let t = 0; t < totalDurationSec; t += interval) {
    beats.push(parseFloat(t.toFixed(6)));
  }
  return beats;
}

/**
 * Ajusta uma duração de clipe para bater no beat mais próximo.
 * @param {number} targetDur  — duração desejada (segundos)
 * @param {number} bpm
 * @param {number} minBeats   — mínimo de beats (evita clipes muito curtos)
 */
function snapDurationToBeat(targetDur, bpm, minBeats) {
  minBeats = minBeats || 1;
  const interval = 60 / bpm;
  const beats = Math.max(minBeats, Math.round(targetDur / interval));
  return beats * interval;
}

// ---------------------------------------------------------------------------
// Metadados de arquivo (real via UXP File API)
// ---------------------------------------------------------------------------

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileInfo(file) {
  return {
    name: file.name || file.nativePath.split(/[\\/]/).pop(),
    size: formatBytes(file.size),
    // PLACEHOLDER: duração real precisaria de análise de metadados do arquivo
    duration: null,
  };
}

// ---------------------------------------------------------------------------
// Simulação de BPM (PLACEHOLDER — documentado claramente)
// ---------------------------------------------------------------------------

/**
 * "Analisa" a música e retorna um BPM sugerido.
 *
 * PLACEHOLDER: não realiza análise real de áudio. Retorna 120 BPM como
 * padrão (BPM mais comum em músicas de evento/aftermovie).
 * Uma implementação real precisaria de:
 *   - WebAudio API (não disponível no UXP do Premiere)
 *   - Uma lib nativa de análise de áudio (ex: essentia.js, aubio via WASM)
 *   - Ou um serviço externo com API REST
 *
 * Extension point: substitua o corpo desta função por chamada real.
 */
async function simulateBpmDetection(musicFile, onProgress) {
  Log.ph('Auto-detecção de BPM: simulando análise (retornará 120 BPM).');
  Log.ph('Implementação real requer Web Audio API ou lib de análise de áudio.');

  const steps = [
    [200,  'Lendo arquivo de áudio...'],
    [400,  'Extraindo forma de onda...'],
    [500,  'Detectando transientes...'],
    [300,  'Calculando periodicidade...'],
    [200,  'Refinando BPM...'],
  ];

  let elapsed = 0;
  for (const [delay, label] of steps) {
    await new Promise((r) => setTimeout(r, delay));
    elapsed += delay;
    const pct = Math.round((elapsed / 1600) * 100);
    if (onProgress) onProgress(pct, label);
  }

  // PLACEHOLDER: valor fixo — ajuste manual recomendado
  const simulatedBpm = 120;
  Log.ph('BPM simulado retornado: ' + simulatedBpm + '. Ajuste conforme necessário.');
  return simulatedBpm;
}

// ---------------------------------------------------------------------------
// Resumo de mídia — real
// ---------------------------------------------------------------------------

function buildMediaSummary(state) {
  return {
    musicName:      state.music ? getFileInfo(state.music).name : null,
    musicSize:      state.music ? getFileInfo(state.music).size : null,
    brollCount:     state.broll.length,
    interviewCount: state.interviews.length,
    assetCount:     state.assets.length,
    totalFiles:     (state.music ? 1 : 0) + state.broll.length +
                    state.interviews.length + state.assets.length,
    // PLACEHOLDER: duração total de footage requer leitura de metadados dos vídeos
    totalFootageEstimate: null,
  };
}

// ---------------------------------------------------------------------------
// API pública do módulo
// ---------------------------------------------------------------------------

const Analysis = {
  buildBeatGrid,
  snapDurationToBeat,
  getFileInfo,
  formatBytes,
  simulateBpmDetection,
  buildMediaSummary,
};
