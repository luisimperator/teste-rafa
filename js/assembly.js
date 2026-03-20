/**
 * js/assembly.js — Algoritmo de rough cut com estrutura narrativa
 *
 * Responsável por:
 * 1. Calcular o plano de montagem (clip plan) sem chamar o Premiere
 * 2. Executar o plano chamando PremierePro.insertVideoClip para cada entrada
 *
 * O algoritmo produz uma estrutura narrativa real:
 *   Abertura → Introdução → Bloco A → Bloco B → Bloco C → Fechamento
 *
 * Cada seção tem estilo próprio de duração de clip e aceita ou não entrevistas.
 * Os cortes são opcionalmente snapped ao beat-grid baseado no BPM manual.
 */

'use strict';

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Seleciona o próximo clipe de uma lista evitando repetição imediata.
 * Mantém uma janela de "recently used" proporcional ao total de clipes.
 */
function makeAntiRepeatPicker(items) {
  const windowSize = Math.max(2, Math.floor(items.length * 0.4));
  const recent = [];
  let pool = shuffle([...items]);

  return function pick() {
    // Re-embaralha pool quando esgotado
    if (pool.length === 0) pool = shuffle([...items]);

    // Tenta pegar o primeiro não-recente
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      if (!recent.includes(candidate)) {
        pool.splice(i, 1);
        recent.push(candidate);
        if (recent.length > windowSize) recent.shift();
        return candidate;
      }
    }
    // Fallback: pega o primeiro disponível mesmo que seja recente
    const item = pool.shift();
    recent.push(item);
    if (recent.length > windowSize) recent.shift();
    return item;
  };
}

// ---------------------------------------------------------------------------
// Cálculo do plano de montagem — puro (sem chamadas ao Premiere)
// ---------------------------------------------------------------------------

/**
 * Retorna o array de entradas do plano de montagem para uma seção.
 * Cada entrada: { item, duration, type, sectionId, beatSnapped }
 *
 * @param {object}   section      — entrada de NARRATIVE_SECTIONS
 * @param {number}   sectionDur   — duração desta seção em segundos
 * @param {Function} pickBroll    — anti-repeat picker para b-roll
 * @param {Function} pickInterview — anti-repeat picker para entrevistas (pode ser null)
 * @param {number}   bpm
 * @param {string}   rhythm       — 'calmo' | 'equilibrado' | 'energetico'
 * @param {number}   freqMult     — multiplicador de frequência de corte
 * @param {boolean}  useInterviews
 */
function buildSectionPlan(section, sectionDur, pickBroll, pickInterview,
                          bpm, rhythm, freqMult, useInterviews) {
  const preset  = RHYTHM_PRESETS[rhythm] || RHYTHM_PRESETS.equilibrado;
  const range   = preset[section.style] || preset.varied;
  const entries = [];
  let elapsed   = 0;

  // Quantos segundos desta seção reservar para entrevistas
  const interviewBudget =
    (useInterviews && pickInterview && section.interviewable)
      ? sectionDur * INTERVIEW_MAX_PCT
      : 0;

  let interviewUsed = 0;
  let clipCount     = 0;

  // Intervalo (em clips) para inserir uma entrevista
  const interviewEvery =
    interviewBudget > 0
      ? Math.max(3, Math.floor(sectionDur / INTERVIEW_CLIP_DURATION / 2))
      : Infinity;

  while (elapsed < sectionDur && entries.length < 300) {
    const remaining = sectionDur - elapsed;

    // Slot de entrevista?
    const isInterviewSlot =
      interviewBudget > 0 &&
      clipCount > 0 &&
      clipCount % interviewEvery === 0 &&
      interviewUsed < interviewBudget;

    if (isInterviewSlot && pickInterview) {
      const dur = Math.min(INTERVIEW_CLIP_DURATION, remaining, interviewBudget - interviewUsed);
      if (dur > 0.5) {
        const item = pickInterview();
        entries.push({ item, duration: dur, type: 'interview', sectionId: section.id });
        elapsed      += dur;
        interviewUsed += dur;
        clipCount++;
        continue;
      }
    }

    // Clipe de B-roll
    let rawDur = randomBetween(range[0], range[1]) * freqMult;
    rawDur = Math.min(rawDur, remaining);
    if (rawDur < 0.3) break;

    // Snap ao beat-grid se a seção for beatSnap
    const duration = section.beatSnap
      ? Analysis.snapDurationToBeat(rawDur, bpm, 1)
      : rawDur;

    const item = pickBroll();
    entries.push({ item, duration, type: 'broll', sectionId: section.id, beatSnapped: section.beatSnap });
    elapsed += duration;
    clipCount++;
  }

  return entries;
}

/**
 * Constrói o plano completo de montagem para todas as seções narrativas.
 * Retorna: { sections: [...], clips: [...] }
 *   sections: [{id, name, startSec, durationSec}]
 *   clips:    [{item, duration, type, sectionId, startSec}]
 */
function buildClipPlan(state, brollItems, interviewItems) {
  const {
    durationSec, bpm, rhythm, cutFreq,
    useInterviews, addTitleCard, addEndCard,
  } = state;

  const freqMult     = CUT_FREQ_MULTIPLIER[cutFreq] || 1.0;
  const pickBroll    = makeAntiRepeatPicker(brollItems);
  const pickInterview = interviewItems.length > 0 ? makeAntiRepeatPicker(interviewItems) : null;

  // Desconta cartelas do tempo total de vídeo
  const titleOffset = addTitleCard ? TITLE_CARD_DURATION : 0;
  const endOffset   = addEndCard   ? END_CARD_DURATION   : 0;
  const videoDur    = Math.max(5, durationSec - titleOffset - endOffset);

  const sectionMeta  = []; // [{id, name, startSec, durationSec}]
  const allClips     = []; // [{item, duration, type, sectionId, startSec}]
  let   cursor       = titleOffset;

  for (const section of NARRATIVE_SECTIONS) {
    const sectionDur = parseFloat((videoDur * section.pct).toFixed(3));
    const startSec   = cursor;

    const entries = buildSectionPlan(
      section, sectionDur,
      pickBroll, pickInterview,
      bpm, rhythm, freqMult, useInterviews
    );

    // Atribui startSec real a cada clipe
    let localCursor = startSec;
    for (const entry of entries) {
      entry.startSec = localCursor;
      localCursor   += entry.duration;
      allClips.push(entry);
    }

    sectionMeta.push({ id: section.id, name: section.name, startSec, durationSec: sectionDur });
    cursor += sectionDur;
  }

  return { sections: sectionMeta, clips: allClips, totalVideoDur: cursor };
}

// ---------------------------------------------------------------------------
// Execução do plano — chama PremierePro
// ---------------------------------------------------------------------------

async function executePlan(sequence, plan, onProgress) {
  const total  = plan.clips.length;
  let   done   = 0;

  for (const clip of plan.clips) {
    await PremierePro.insertVideoClip(
      sequence, clip.item, clip.startSec, clip.duration, clip.type
    );
    done++;
    if (onProgress) {
      const pct = Math.round((done / total) * 100);
      onProgress(pct, 'Inserindo clipe ' + done + ' de ' + total + '...');
    }
  }

  Log.ok(total + ' clipes inseridos na timeline.');
}

// ---------------------------------------------------------------------------
// Ponto de extensão para futuras análises por IA
// ---------------------------------------------------------------------------

/**
 * EXTENSION POINT — Análise avançada de clipes
 *
 * No futuro, esta função poderia receber uma lista de ProjectItems e
 * retornar scores e metadados para cada um:
 *   { item, stabilityScore, hasMotion, hasFace, emotionScore, quality }
 *
 * Com esses dados, buildSectionPlan poderia:
 * - Priorizar clipes estáveis na abertura
 * - Usar clipes de ação nos blocos energéticos
 * - Selecionar trechos específicos (in/out) de cada clipe
 *
 * PLACEHOLDER: retorna objetos sem score (sem análise real)
 */
async function analyzeClips(projectItems) {
  Log.ph('analyzeClips: análise por IA não implementada — retornando items sem score.');
  return projectItems.map((item) => ({
    item,
    stabilityScore: null,   // PLACEHOLDER: análise de estabilização
    hasMotion:      null,   // PLACEHOLDER: detecção de movimento
    hasFace:        null,   // PLACEHOLDER: detecção de rosto
    emotionScore:   null,   // PLACEHOLDER: análise de emoção
    quality:        null,   // PLACEHOLDER: score de qualidade geral
    bestInPoint:    null,   // PLACEHOLDER: melhor ponto de entrada
  }));
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

const Assembly = {
  buildClipPlan,
  executePlan,
  analyzeClips,  // extension point
};
