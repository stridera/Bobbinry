# Dictionary Panel (Sample)

Listens to `manuscript.editor.selection.v1` and shows a definition from a local lexicon.
No external network calls.

- Contributes a right-side panel via `shell.rightPanel`.
- Subscribes to selection events with sensitivity `medium`.
- Uses the View SDK (postMessage) to receive bus events.
