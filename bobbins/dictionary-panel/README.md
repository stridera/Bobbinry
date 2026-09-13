# Dictionary Panel

Native right-side panel that listens to `manuscript.editor.selection.v1` and
shows a definition plus thesaurus results for the selected word.

- Contributes a native panel via `shell.rightPanel`.
- Uses the shared Bobbinry SDK message-bus hook to observe editor selections.
- Looks up definitions (`/api/dictionary/:word`, Free Dictionary API with a
  Wiktionary fallback) and synonyms/antonyms (`/api/thesaurus/:word`, Datamuse)
  through the Bobbinry API, so the browser never calls a third party directly.
