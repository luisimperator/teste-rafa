/**
 * js/state.js — Estado global da aplicação + constantes de configuração
 *
 * Um único objeto `AppState` compartilhado por todos os módulos.
 * Todas as constantes de ritmo, narrativa e assembly ficam aqui
 * para facilitar calibração e extensão futura.
 */

// ---------------------------------------------------------------------------
// Constantes de tempo do Premiere Pro
// ---------------------------------------------------------------------------

const TICKS_PER_SECOND = 254016000000;

function toTicks(seconds) {
  return Math.round(seconds * TICKS_PER_SECOND);
}

// ---------------------------------------------------------------------------
// Presets de ritmo — duração por estilo de cena (segundos)
// ---------------------------------------------------------------------------

const RHYTHM_PRESETS = {
  calmo: {
    punch:  [2.5, 5.0],  // abertura + fechamento
    medium: [4.0, 8.0],  // intro
    varied: [3.0, 7.0],  // blocos principais
    build:  [2.5, 5.0],  // construção final
  },
  equilibrado: {
    punch:  [1.0, 2.5],
    medium: [2.5, 5.0],
    varied: [1.5, 4.5],
    build:  [1.5, 3.0],
  },
  energetico: {
    punch:  [0.5, 1.5],
    medium: [1.0, 2.5],
    varied: [0.8, 2.5],
    build:  [0.8, 1.5],
  },
};

// Multiplicadores de frequência de corte sobre o preset de ritmo
const CUT_FREQ_MULTIPLIER = {
  baixa:  1.6,
  media:  1.0,
  alta:   0.55,
};

// ---------------------------------------------------------------------------
// Estrutura narrativa do aftermovie
// Cada seção define: nome, percentual do tempo total, estilo de clip, se
// aceita entrevistas e se é "snap to beat" prioritário.
// ---------------------------------------------------------------------------

const NARRATIVE_SECTIONS = [
  { id: 'abertura',   name: 'Abertura',    pct: 0.10, style: 'punch',  interviewable: false, beatSnap: true  },
  { id: 'intro',      name: 'Introdução',  pct: 0.10, style: 'medium', interviewable: false, beatSnap: false },
  { id: 'bloco_a',    name: 'Bloco A',     pct: 0.25, style: 'varied', interviewable: true,  beatSnap: false },
  { id: 'bloco_b',    name: 'Bloco B',     pct: 0.20, style: 'varied', interviewable: true,  beatSnap: false },
  { id: 'bloco_c',    name: 'Bloco C',     pct: 0.15, style: 'build',  interviewable: true,  beatSnap: true  },
  { id: 'fechamento', name: 'Fechamento',  pct: 0.20, style: 'punch',  interviewable: false, beatSnap: true  },
];

// Percentual máximo de cada seção interviewable reservado para entrevistas
const INTERVIEW_MAX_PCT = 0.30;

// Duração padrão de um trecho de entrevista (segundos)
const INTERVIEW_CLIP_DURATION = 18;

// Duração de cartela de título / cartela final (segundos)
const TITLE_CARD_DURATION = 3;
const END_CARD_DURATION   = 3;

// Fallback de duração da música quando não é possível ler os metadados
// PLACEHOLDER: duração real precisaria de análise de metadados do arquivo
const MUSIC_DURATION_FALLBACK = 180;

// Etiquetas (labels) de cor no Premiere Pro — inteiros 0-15
const CLIP_LABELS = {
  music:     5,   // Cerulean
  broll:     8,   // Mango
  interview: 7,   // Rose
  asset:     4,   // Lavender
};

// ---------------------------------------------------------------------------
// Estado da aplicação
// ---------------------------------------------------------------------------

const AppState = {
  step: 1,

  // — Mídia —
  music:        null,       // UXP File
  broll:        [],         // UXP File[]
  interviews:   [],         // UXP File[]
  assets:       [],         // UXP File[] (logo, título, etc.)
  hasInterviews: false,
  hasAssets:     false,

  // — Análise —
  bpm:          120,        // BPM manual ou simulado
  analysed:     false,

  // — Configuração —
  durationSec:  60,         // segundos
  format:       '16:9',     // PLACEHOLDER: afeta apenas UI
  rhythm:       'equilibrado',
  cutFreq:      'media',
  useInterviews: false,
  addTitleCard:  false,
  titleText:     '',
  addEndCard:    false,
  endText:       '',
  addSectionMarkers: true,
  addMediaLabels:    true,

  // — Runtime —
  generating: false,
};
