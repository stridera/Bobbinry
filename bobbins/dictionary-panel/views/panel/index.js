
// Dictionary panel: listens for bus events from the editor
// Expected envelope: { namespace: 'BUS', type: 'BUS_EVENT', payload: { topic, data, source } }
const stateEl = document.getElementById('status');
const entryEl = document.getElementById('entry');
const wordEl = document.getElementById('word');
const defsEl = document.getElementById('defs');

// Set initial theme to light
document.body.classList.add('light');

let lexicon = {};
async function loadLexicon() {
  try {
    const res = await fetch('lexicon.json');
    lexicon = await res.json();
  } catch {}
}
function normalize(w) { return (w || '').trim().toLowerCase().replace(/[^a-zA-Z\-']/g,''); }
function showStatus(msg){ stateEl.textContent = msg; stateEl.hidden = false; entryEl.hidden = true; }
function showEntry(word, defs){ wordEl.textContent = word; defsEl.textContent = '- ' + defs.join('\n- '); stateEl.hidden = true; entryEl.hidden = false; }

window.addEventListener('message', (ev) => {
  const d = ev.data || {};

  // Handle new message envelope format
  if (d.namespace === 'SHELL') {
    if (d.type === 'SHELL_INIT' || d.type === 'SHELL_CONFIG_RESPONSE') {
      document.body.classList.remove('light', 'dark');
      document.body.classList.add(d.payload.config.theme);
      return;
    }
    if (d.type === 'SHELL_THEME_UPDATE') {
      document.body.classList.remove('light', 'dark');
      document.body.classList.add(d.payload.theme);
      return;
    }
  }

  // Handle BUS message envelope format
  if (d.namespace === 'BUS' && d.type === 'BUS_EVENT') {
    const topic = d.payload?.topic;
    if (topic === 'manuscript.editor.selection.v1') {
      const w = normalize(d.payload?.data?.text || '');
      if (!w || w.indexOf(' ') !== -1) { showStatus('Select a single word…'); return; }
      if (lexicon[w]) showEntry(w, lexicon[w]); else showStatus(`No local entry for "${w}".`);
    }
    return;
  }
});

function announceReady(){ parent.postMessage({ type: 'view:ready', id: 'dictionary.panel' }, '*'); }
await loadLexicon();
announceReady();
showStatus('Select a word in the editor…');
