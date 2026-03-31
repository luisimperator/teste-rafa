/**
 * js/premiere.js — Wrapper para a API oficial do Premiere Pro (UXP)
 *
 * TODAS as chamadas à API do Premiere ficam aqui.
 * Nenhum outro módulo deve chamar `ppro` diretamente.
 *
 * API real utilizada: require('premierepro')
 *   - ppro.app.getActiveProject()
 *   - project.importFiles(paths, suppressUI, bin, asNumberedStills)
 *   - project.rootItem  (ProjectItem raiz)
 *   - project.createNewSequence(name, presetPath)
 *   - project.getActiveSequence()
 *   - sequence.videoTracks / audioTracks
 *   - track.insertClip(item, timeTicks)
 *   - track.name (setter)
 *   - sequence.markers.createMarker(timeTicks)
 *
 * PLACEHOLDERS marcados individualmente abaixo.
 */

'use strict';

const ppro = require('premierepro');

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function _getChildren(item) {
  const c = item.children;
  if (!c) return [];
  if (Array.isArray(c)) return c;
  const arr = [];
  for (let i = 0; i < c.numItems; i++) arr.push(c[i]);
  return arr;
}

function _findItemByName(name, bin) {
  for (const child of _getChildren(bin)) {
    if (child.name === name) return child;
    if (child.type === 2) {  // ProjectItemType.BIN
      const found = _findItemByName(name, child);
      if (found) return found;
    }
  }
  return null;
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Projeto
// ---------------------------------------------------------------------------

async function getProject() {
  // Verifica se ppro.Project está disponível (requer apiVersion:2 no manifest)
  if (!ppro || !ppro.Project) {
    const keys = ppro ? Object.keys(ppro).join(', ') || '(vazio)' : 'módulo não carregado';
    throw new Error(
      'ppro.Project indisponível — chaves do módulo: [' + keys + ']. ' +
      'Verifique se o manifest tem "data":{"apiVersion":2} no host.'
    );
  }
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error('Nenhum projeto aberto no Premiere Pro.');
  return project;
}

// ---------------------------------------------------------------------------
// Importação de arquivos
// ---------------------------------------------------------------------------

async function importPaths(project, paths) {
  Log.info('Importando ' + paths.length + ' arquivo(s)...');
  try {
    project.importFiles(paths, true, project.rootItem, false);
    // Aguarda o Premiere registrar os itens no painel do projeto
    await _sleep(1500);
    Log.ok('Importação concluída.');
  } catch (err) {
    Log.error('Erro na importação: ' + err.message);
    throw err;
  }
}

async function findProjectItem(project, filename) {
  const item = _findItemByName(filename, project.rootItem);
  if (!item) Log.warn('Item não encontrado no projeto: ' + filename);
  return item;
}

// ---------------------------------------------------------------------------
// Sequência
// ---------------------------------------------------------------------------

async function createSequence(project, name) {
  Log.info('Criando sequência "' + name + '"...');
  try {
    const seq = await project.createNewSequence(name, '');
    if (seq) {
      Log.ok('Sequência criada: ' + name);
      return seq;
    }
  } catch (err) {
    Log.warn('createNewSequence falhou (' + err.message + '), usando sequência ativa como fallback.');
  }

  const active = await project.getActiveSequence();
  if (active) {
    Log.info('Usando sequência ativa: ' + active.name);
    return active;
  }

  throw new Error(
    'Não foi possível criar nem encontrar uma sequência. ' +
    'Crie ou abra uma sequência no Premiere Pro e tente novamente.'
  );
}

// ---------------------------------------------------------------------------
// Trilha de áudio — música
// ---------------------------------------------------------------------------

async function insertMusic(sequence, musicItem) {
  Log.info('Inserindo música em A1...');
  try {
    const tracks = sequence.audioTracks;
    if (!tracks || tracks.length === 0) {
      Log.warn('Nenhuma faixa de áudio disponível na sequência.');
      return;
    }
    const track = tracks[0];
    await track.insertClip(musicItem, 0);

    // Tenta definir label de cor
    try {
      const clips = track.clips;
      if (clips && clips.length > 0) {
        clips[clips.length - 1].label = CLIP_LABELS.music;
      }
    } catch (_) { /* label opcional */ }

    // Tenta nomear a track
    try { track.name = 'Música'; } catch (_) {}

    Log.ok('Música inserida em A1.');
  } catch (err) {
    Log.error('Falha ao inserir música: ' + err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Track de vídeo — nomear e configurar
// ---------------------------------------------------------------------------

async function prepareVideoTracks(sequence) {
  try {
    const vt = sequence.videoTracks;
    if (vt && vt.length > 0) { try { vt[0].name = 'B-Roll'; }    catch (_) {} }
    if (vt && vt.length > 1) { try { vt[1].name = 'Entrevistas'; } catch (_) {} }
    if (vt && vt.length > 2) { try { vt[2].name = 'Assets'; }     catch (_) {} }
    Log.ok('Tracks de vídeo nomeadas.');
  } catch (err) {
    Log.warn('Não foi possível nomear tracks: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// Inserção de um clipe de vídeo em V1
// ---------------------------------------------------------------------------

/**
 * @param {object} sequence
 * @param {object} item       - ProjectItem
 * @param {number} startSec   - tempo de início em segundos
 * @param {number} targetDur  - duração desejada em segundos
 * @param {string} clipType   - 'broll' | 'interview' | 'asset'
 * @returns {number} próximo startSec
 */
async function insertVideoClip(sequence, item, startSec, targetDur, clipType) {
  const vTrack = sequence.videoTracks[0];
  if (!vTrack) throw new Error('V1 não encontrada na sequência.');

  const startTick = toTicks(startSec);

  try {
    await vTrack.insertClip(item, startTick);

    // Tenta trimmar o clipe ao tamanho desejado
    // PLACEHOLDER: clip.end pode não estar acessível em todas versões da API UXP
    try {
      const clips = vTrack.clips;
      if (clips && clips.length > 0) {
        const inserted = clips[clips.length - 1];
        if (inserted && inserted.end !== undefined) {
          inserted.end = startTick + toTicks(targetDur);
          Log.debug('Trim aplicado: ' + item.name + ' → ' + targetDur.toFixed(2) + 's');
        } else {
          Log.ph('clip.end indisponível — trim não aplicado para: ' + item.name);
        }
      }
    } catch (trimErr) {
      Log.ph('Trim não suportado nesta versão da API: ' + trimErr.message);
    }

    // Tenta aplicar label de cor por tipo de mídia
    try {
      const clips = vTrack.clips;
      if (clips && clips.length > 0 && AppState.addMediaLabels) {
        clips[clips.length - 1].label = CLIP_LABELS[clipType] || 0;
      }
    } catch (_) {}

  } catch (err) {
    Log.error('Erro ao inserir clipe ' + item.name + ': ' + err.message);
    // Não lança — continua com o próximo clipe
  }

  return startSec + targetDur;
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

/**
 * Cria um marker na sequência.
 * @param {object} sequence
 * @param {number} timeSec  — tempo em segundos
 * @param {string} name
 * @param {string} [comment]
 */
function createMarker(sequence, timeSec, name, comment) {
  try {
    const markers = sequence.markers;
    if (!markers) return;
    const m = markers.createMarker(toTicks(timeSec));
    m.name     = name;
    m.comments = comment || '';
    m.type     = 0; // comment marker
    Log.debug('Marker: "' + name + '" em ' + timeSec.toFixed(1) + 's');
  } catch (err) {
    Log.warn('Marker não criado ("' + name + '"): ' + err.message);
  }
}

function createSectionMarkers(sequence, sections) {
  Log.info('Adicionando markers de seção...');
  for (const s of sections) {
    createMarker(sequence, s.startSec, '[ ' + s.name.toUpperCase() + ' ]',
                 'Seção gerada pelo AutoRecap');
  }
}

function createTitleCardMarker(sequence, timeSec, text) {
  // PLACEHOLDER: cartela real precisaria de Mogrt/gráfico importado.
  // Aqui adicionamos apenas um marker para o editor posicionar o gráfico.
  createMarker(sequence, timeSec, '[TÍTULO] ' + (text || 'NOME DO EVENTO'),
               'PLACEHOLDER — posicione aqui o gráfico de título.');
  Log.ph('Cartela de título = marker apenas. Adicione o gráfico manualmente.');
}

function createEndCardMarker(sequence, timeSec, text) {
  // PLACEHOLDER: mesmo motivo da cartela de título.
  createMarker(sequence, timeSec, '[FIM] ' + (text || 'FIM'),
               'PLACEHOLDER — posicione aqui o gráfico de encerramento.');
  Log.ph('Cartela final = marker apenas. Adicione o gráfico manualmente.');
}

// ---------------------------------------------------------------------------
// Escaneamento do painel do projeto
// Lê todos os itens de clip (tipo 1 ou 4) do painel do projeto recursivamente.
// Esta é a forma recomendada de selecionar mídia no Premiere Pro UXP,
// pois não depende de permissão de localFileSystem.
// ---------------------------------------------------------------------------

const AUDIO_EXT = new Set(['mp3','wav','aac','m4a','aif','aiff','ogg','flac','wma']);
const VIDEO_EXT = new Set(['mp4','mov','avi','mxf','r3d','braw','mkv','mpg','mpeg','m2v','dv']);

function _guessMediaType(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (VIDEO_EXT.has(ext)) return 'video';
  return 'other';
}

async function scanProjectItems(project) {
  const items = [];

  function collect(bin) {
    const children = _getChildren(bin);
    for (const child of children) {
      // type 2 = bin/folder — recurse
      if (child.type === 2) {
        collect(child);
      } else if (child.name && child.name.trim()) {
        const mediaType = _guessMediaType(child.name);
        if (mediaType !== 'other') {
          items.push({ item: child, name: child.name, mediaType });
        }
      }
    }
  }

  collect(project.rootItem);
  Log.ok('Projeto escaneado: ' + items.length + ' item(s) de mídia encontrado(s).');
  return items;
}

/**
 * Verifica se um objeto é um ProjectItem (vem do scan) ou um File (vem do picker).
 * ProjectItem tem propriedade `type` numérica; File tem `nativePath`.
 */
function isProjectItem(obj) {
  return obj && typeof obj.type === 'number' && !obj.nativePath;
}

// ---------------------------------------------------------------------------
// Exporta funções como propriedades do objeto PremierePro
// (acessível globalmente pelos outros módulos)
// ---------------------------------------------------------------------------

const PremierePro = {
  getProject,
  importPaths,
  findProjectItem,
  scanProjectItems,
  isProjectItem,
  createSequence,
  insertMusic,
  prepareVideoTracks,
  insertVideoClip,
  createSectionMarkers,
  createTitleCardMarker,
  createEndCardMarker,
  createMarker,
};
