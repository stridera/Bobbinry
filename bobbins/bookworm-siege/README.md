# Bookworm Siege

A typing tower-defense game that lives in the editor's right panel and keeps you writing.

Small **bookworms** crawl up a winding path toward your castle (your manuscript). **Every
word you type fires a tower** — launching the word you just typed as a projectile. Keep up
your target WPM and your towers out-kill the swarm; slow down and the bookworms pile up at
the gate (gently — there is no hard loss).

## How to play

1. Open a chapter in the manuscript editor. The game appears in the right panel.
2. Set a **word goal** and a **target WPM**, then press **Start**.
3. Write. Each completed word fires a tower. Every few words triggers a **burst** (all towers
   fire at once).
4. If you stall and the bookworms start breaching the gate, a **surprise word** appears above
   the castle. Type it for a big **catch-up burst** that clears the siege — and, ideally, a
   nudge down a new, unexpected path. The word is hidden until you need it. (We used to hand
   out plastic ninjas at write-ins: "if you're stuck, throw in a ninja.")
5. Reach your word goal to win. Your best run is saved locally.

## How it works

The manuscript editor broadcasts real-time typing events on `window`:

- `bobbinry:editor-content-update` → `{ text }` (full document text on each edit)
- `bobbinry:view-context-change` → `{ wordCount }` (authoritative running word count)

The panel diffs the incoming text to detect newly-completed words, fires a tower per word,
and runs a `requestAnimationFrame` canvas game loop. No backend, no database — configuration
and high score live in `localStorage`.

## Files

- `src/panels/game-panel.tsx` — React panel: config screen, canvas, HUD, event wiring, loop.
- `src/lib/words.ts` — extract newly-completed words from a full-text diff (pure, tested).
- `src/lib/wpm.ts` — rolling-window words-per-minute (pure, tested).
- `src/lib/config.ts` — config + high-score types and `localStorage` persistence.
- `src/lib/engine.ts` — game state and per-frame simulation (spawn, move, fire, collide, burst).
- `src/lib/render.ts` — canvas drawing.
