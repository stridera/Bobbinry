
// Minimal sample: listens for bus events forwarded by the host via postMessage.
// Expected envelope: { type: 'bus:event', topic: 'manuscript.editor.selection.v1', payload: { text, length } }
const stateEl = document.getElementById('status');
const entryEl = document.getElementById('entry');
const wordEl = document.getElementById('word');
const defsEl = document.getElementById('defs');

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
  if (d.type === 'bus:event' && d.topic === 'manuscript.editor.selection.v1') {
    const w = normalize(d.payload?.text || '');
    if (!w || w.indexOf(' ') !== -1) { showStatus('Select a single word…'); return; }
    if (lexicon[w]) showEntry(w, lexicon[w]); else showStatus(`No local entry for “${w}”.`);
  }
});

function announceReady(){ parent.postMessage({ type: 'view:ready', id: 'dictionary.panel' }, '*'); }
await loadLexicon();
announceReady();
showStatus('Select a word in the editor…');
