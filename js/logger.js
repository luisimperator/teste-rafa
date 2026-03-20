/**
 * js/logger.js — Log panel de debug em tempo real
 *
 * Expõe um objeto global `Log` usado por todos os outros módulos.
 * Exibe mensagens no painel de log da UI com nível, timestamp e cor.
 */

const Log = (() => {
  const MAX_ENTRIES = 200;
  let _container = null;

  const LEVELS = {
    info:  { label: 'INFO',  css: 'log--info'  },
    ok:    { label: 'OK',    css: 'log--ok'    },
    warn:  { label: 'WARN',  css: 'log--warn'  },
    error: { label: 'ERROR', css: 'log--error' },
    debug: { label: 'DBG',   css: 'log--debug' },
    ph:    { label: 'PH',    css: 'log--ph'    }, // PLACEHOLDER
  };

  function _ts() {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
  }

  function _append(level, msg) {
    if (!_container) _container = document.getElementById('log-container');
    if (!_container) { console.log('[' + level + ']', msg); return; }

    // Limita entradas
    while (_container.children.length >= MAX_ENTRIES) {
      _container.removeChild(_container.firstChild);
    }

    const def = LEVELS[level] || LEVELS.info;
    const row = document.createElement('div');
    row.className = 'log-row ' + def.css;

    const ts   = document.createElement('span');
    ts.className = 'log-ts';
    ts.textContent = _ts();

    const lbl  = document.createElement('span');
    lbl.className = 'log-level';
    lbl.textContent = def.label;

    const text = document.createElement('span');
    text.className = 'log-msg';
    text.textContent = msg;

    row.appendChild(ts);
    row.appendChild(lbl);
    row.appendChild(text);
    _container.appendChild(row);
    _container.scrollTop = _container.scrollHeight;
  }

  return {
    info:  (msg) => _append('info',  msg),
    ok:    (msg) => _append('ok',    msg),
    warn:  (msg) => _append('warn',  msg),
    error: (msg) => _append('error', msg),
    debug: (msg) => _append('debug', msg),
    /** Marca explicitamente código que é PLACEHOLDER */
    ph:    (msg) => _append('ph',    '[PLACEHOLDER] ' + msg),
    clear: () => { if (_container) _container.innerHTML = ''; },
  };
})();
