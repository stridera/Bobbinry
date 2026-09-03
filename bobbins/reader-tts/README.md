# Read Aloud (`reader-tts`)

Reader-side bobbin that speaks a published chapter using the browser's Web Speech API
(`window.speechSynthesis`). No server audio, no provider keys.

## What it does

- Adds a **Listen** control to the reader toolbar (`reader.toolbar` slot) on `/read/...` pages.
- Play / pause / stop, playback speed, and a voice picker built from the browser's voices.
- Highlights the paragraph being read and keeps it scrolled into view.
- Reads the chapter title first, then rolls into the next chapter automatically when the
  current one ends (toggle in the popover).
- Preferences (voice, rate, auto-advance) persist in the `bobbinry-reader-prefs` localStorage
  blob so they work for signed-out readers too.

## Availability

Reader-type bobbins (`capabilities.readerBobbinType: reader`) are on for everyone by default.
Signed-in readers can switch it off under **Settings > Reader Bobbins**, which records an
opt-out row in `user_bobbins_installed` with `isEnabled = false`.

The shell loads the catalog from `GET /api/public/reader-bobbins` and registers each manifest's
`extensions` on the reader page (`apps/shell/src/hooks/useReaderBobbins.ts`).

## Layout

```
src/
├── index.ts              # package exports
├── panels/listen.tsx     # toolbar control (default export)
└── lib/
    ├── segments.ts       # chapter DOM -> ordered, chunked text segments
    ├── speech.ts         # speechSynthesis queue/controller + voice loading
    ├── highlight.ts      # inline, theme-aware paragraph highlight
    └── prefs.ts          # localStorage prefs + auto-advance handoff flag
```

## Browser notes

- Chrome cuts off long utterances, so text is queued in sentence-sized chunks.
- iOS Safari only speaks inside a user gesture; play starts synchronously in the click handler.
- Auto-advance relies on client-side navigation keeping the document's user activation. A hard
  reload on the next chapter will not auto-start.
- If the browser has no `speechSynthesis`, the control renders nothing.

## Testing

```bash
bun run --filter @bobbinry/reader-tts test
```
