/**
 * index.js — Entrypoint do painel UXP para Premiere Pro
 *
 * Módulos nativos UXP:
 *   - require('uxp')        → utilitários UXP (entrypoints, storage, etc.)
 *   - require('premierepro') → API nativa do Premiere Pro
 *
 * Limitações consideradas:
 *   - Toda a API do Premiere é assíncrona (Promise-based)
 *   - Sem alert() / confirm() — feedback via DOM
 *   - getActiveProject() retorna null se nenhum projeto estiver aberto
 *   - getActiveSequence() retorna null se não houver sequência ativa
 */

const { entrypoints } = require('uxp');
const ppro = require('premierepro');

// ---------------------------------------------------------------------------
// Registro do painel — obrigatório para o UXP reconhecer o entrypoint
// ---------------------------------------------------------------------------
entrypoints.setup({
  panels: {
    mainPanel: {
      show() {
        // Chamado quando o painel se torna visível
      },
      hide() {
        // Chamado quando o painel é ocultado
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Referências ao DOM
// ---------------------------------------------------------------------------
const btnGetSequence = document.getElementById('btn-get-sequence');
const resultEl = document.getElementById('result');
const sequenceNameEl = document.getElementById('sequence-name');
const errorEl = document.getElementById('error');
const errorMessageEl = document.getElementById('error-message');

// ---------------------------------------------------------------------------
// Helpers de UI
// ---------------------------------------------------------------------------

function showResult(name) {
  sequenceNameEl.textContent = name;
  resultEl.classList.remove('result--hidden');
  errorEl.classList.add('error--hidden');
}

function showError(message) {
  errorMessageEl.textContent = message;
  errorEl.classList.remove('error--hidden');
  resultEl.classList.add('result--hidden');
}

function clearFeedback() {
  resultEl.classList.add('result--hidden');
  errorEl.classList.add('error--hidden');
}

// ---------------------------------------------------------------------------
// Lógica principal — lê a sequência ativa via API do Premiere
// ---------------------------------------------------------------------------

async function getActiveSequenceName() {
  // 1. Obtém o projeto ativo
  const project = await ppro.app.getActiveProject();

  if (!project) {
    showError('Nenhum projeto aberto no Premiere.');
    return;
  }

  // 2. Obtém a sequência ativa dentro do projeto
  const sequence = await project.getActiveSequence();

  if (!sequence) {
    showError('Nenhuma sequência ativa no projeto.');
    return;
  }

  // 3. Exibe o nome da sequência
  showResult(sequence.name);
}

// ---------------------------------------------------------------------------
// Evento do botão
// ---------------------------------------------------------------------------

btnGetSequence.addEventListener('click', () => {
  clearFeedback();
  btnGetSequence.disabled = true;

  getActiveSequenceName()
    .catch((err) => {
      // Erros inesperados da API (ex.: Premiere em estado inválido)
      showError('Erro ao acessar a API: ' + (err && err.message ? err.message : String(err)));
    })
    .finally(() => {
      btnGetSequence.disabled = false;
    });
});
