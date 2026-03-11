# Dictionary Panel

Native right-side panel that listens to `manuscript.editor.selection.v1` and
shows a definition plus thesaurus results for the selected word.

- Contributes a native panel via `shell.rightPanel`.
- Uses the shared Bobbinry SDK message-bus hook to observe editor selections.
- Looks up definitions via Free Dictionary API and synonyms/antonyms via Datamuse.
