// Dictionary + Thesaurus panel
// Uses Free Dictionary API and Datamuse API

const statusEl = document.getElementById('status');
const entryEl = document.getElementById('entry');
const thesaurusEl = document.getElementById('thesaurus');
const tabs = document.querySelectorAll('.tab');

let activeTab = 'dictionary';
let currentWord = '';
let cachedResults = {}; // { word: { dict, thesaurus } }

// ── Theme ──
document.body.classList.add('light');

// ── Tabs ──
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    if (target === activeTab) return;
    activeTab = target;
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === target));
    renderCurrentWord();
  });
});

// ── Normalize selected text ──
function normalize(w) {
  return (w || '').trim().toLowerCase().replace(/[^a-zA-Z\-']/g, '');
}

// ── Display helpers ──
function showStatus(msg) {
  statusEl.querySelector('.status-text').textContent = msg;
  statusEl.style.display = '';
  entryEl.classList.remove('visible');
  thesaurusEl.classList.remove('visible');
}

function showLoading() {
  statusEl.style.display = 'none';
  entryEl.classList.remove('visible');
  thesaurusEl.classList.remove('visible');
  const target = activeTab === 'dictionary' ? entryEl : thesaurusEl;
  target.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  target.classList.add('visible');
}

// ── Dictionary API ──
async function fetchDictionary(word) {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!res.ok) return null;
  return res.json();
}

// ── Thesaurus API (Datamuse) ──
async function fetchThesaurus(word) {
  const [synRes, antRes] = await Promise.all([
    fetch(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word)}&max=20`),
    fetch(`https://api.datamuse.com/words?rel_ant=${encodeURIComponent(word)}&max=12`),
  ]);
  const synonyms = synRes.ok ? await synRes.json() : [];
  const antonyms = antRes.ok ? await antRes.json() : [];
  return {
    synonyms: synonyms.map(w => w.word),
    antonyms: antonyms.map(w => w.word),
  };
}

// ── Render dictionary entry ──
function renderDictionary(data) {
  if (!data || !data.length) {
    entryEl.innerHTML = '<div class="error-msg">No definition found for this word.</div>';
    entryEl.classList.add('visible');
    statusEl.style.display = 'none';
    return;
  }

  const entry = data[0];
  const word = entry.word;

  // Find phonetic with audio
  const phoneticObj = entry.phonetics?.find(p => p.text) || {};
  const audioObj = entry.phonetics?.find(p => p.audio) || {};

  let html = '<div class="word-heading">';
  html += `<div class="word-text">${esc(word)}</div>`;
  if (phoneticObj.text) {
    html += `<div class="phonetic">${esc(phoneticObj.text)}`;
    if (audioObj.audio) {
      html += `<button class="phonetic-play" data-audio="${esc(audioObj.audio)}" title="Listen">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>`;
    }
    html += '</div>';
  }
  html += '</div>';

  // Group meanings by part of speech
  for (const meaning of entry.meanings || []) {
    html += `<div class="pos-section">`;
    html += `<div class="pos-label">${esc(meaning.partOfSpeech)}</div>`;
    html += `<ol class="def-list">`;

    const defs = (meaning.definitions || []).slice(0, 4);
    defs.forEach((def, i) => {
      html += `<li class="def-item">`;
      html += `<span class="def-number">${i + 1}</span>`;
      html += `<div class="def-content">`;
      html += `<div class="def-text">${esc(def.definition)}</div>`;
      if (def.example) {
        html += `<div class="def-example">"${esc(def.example)}"</div>`;
      }
      html += `</div></li>`;
    });

    html += `</ol></div>`;
  }

  // Source
  if (entry.sourceUrls?.[0]) {
    html += `<div class="source">Source: <a href="${esc(entry.sourceUrls[0])}" target="_blank" rel="noopener">Wiktionary</a></div>`;
  }

  entryEl.innerHTML = html;
  statusEl.style.display = 'none';
  entryEl.classList.add('visible');
  thesaurusEl.classList.remove('visible');

  // Audio playback
  entryEl.querySelectorAll('.phonetic-play').forEach(btn => {
    btn.addEventListener('click', () => {
      const audio = new Audio(btn.dataset.audio);
      audio.play().catch(() => {});
    });
  });
}

// ── Render thesaurus ──
function renderThesaurus(word, data) {
  if (!data || (!data.synonyms.length && !data.antonyms.length)) {
    thesaurusEl.innerHTML = '<div class="error-msg">No synonyms or antonyms found.</div>';
    thesaurusEl.classList.add('visible');
    statusEl.style.display = 'none';
    return;
  }

  let html = `<div class="thesaurus-word">${esc(word)}</div>`;

  if (data.synonyms.length) {
    html += '<div class="thesaurus-section">';
    html += '<div class="thesaurus-label">Synonyms</div>';
    html += '<div class="word-chips">';
    for (const syn of data.synonyms) {
      html += `<button class="word-chip synonym" data-word="${esc(syn)}">${esc(syn)}</button>`;
    }
    html += '</div></div>';
  }

  if (data.antonyms.length) {
    html += '<div class="thesaurus-section">';
    html += '<div class="thesaurus-label">Antonyms</div>';
    html += '<div class="word-chips">';
    for (const ant of data.antonyms) {
      html += `<button class="word-chip antonym" data-word="${esc(ant)}">${esc(ant)}</button>`;
    }
    html += '</div></div>';
  }

  html += '<div class="source">Source: <a href="https://www.datamuse.com/api/" target="_blank" rel="noopener">Datamuse API</a></div>';

  thesaurusEl.innerHTML = html;
  statusEl.style.display = 'none';
  thesaurusEl.classList.add('visible');
  entryEl.classList.remove('visible');

  // Click chip to look up that word
  thesaurusEl.querySelectorAll('.word-chip').forEach(chip => {
    chip.addEventListener('click', () => lookupWord(chip.dataset.word));
  });
}

// ── Main lookup ──
async function lookupWord(word) {
  currentWord = word;
  showLoading();

  try {
    if (!cachedResults[word]) {
      const [dict, thesaurus] = await Promise.all([
        fetchDictionary(word),
        fetchThesaurus(word),
      ]);
      cachedResults[word] = { dict, thesaurus };
    }
    // Only render if this is still the current word
    if (currentWord === word) renderCurrentWord();
  } catch {
    if (currentWord === word) {
      showStatus('Failed to fetch. Check your connection.');
    }
  }
}

function renderCurrentWord() {
  const data = cachedResults[currentWord];
  if (!data) return;

  if (activeTab === 'dictionary') {
    renderDictionary(data.dict);
  } else {
    renderThesaurus(currentWord, data.thesaurus);
  }
}

// ── Escape HTML ──
function esc(s) {
  const el = document.createElement('span');
  el.textContent = s || '';
  return el.innerHTML;
}

// ── Message handling ──
window.addEventListener('message', (ev) => {
  const d = ev.data || {};

  // Shell messages (theme)
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

  // Bus messages (editor selection)
  if (d.namespace === 'BUS' && d.type === 'BUS_EVENT') {
    const topic = d.payload?.topic;
    if (topic === 'manuscript.editor.selection.v1') {
      const w = normalize(d.payload?.data?.text || '');
      if (!w || w.includes(' ')) {
        showStatus('Select a single word to look it up');
        return;
      }
      lookupWord(w);
    }
  }
});

// ── Init ──
function announceReady() {
  parent.postMessage({ type: 'view:ready', id: 'dictionary.panel' }, '*');
}

announceReady();
showStatus('Select a word in the editor to look it up');
