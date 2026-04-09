# Reader Feedback

View and manage reader annotations, error reports, and suggestions in the
editor. Pairs with the reader-side annotation tool to surface feedback
directly next to the text it references.

- Contributes a `shell.rightPanel` panel that opens for content entities.
- Reads from the `chapter_annotations` table; supports
  acknowledged / resolved / dismissed states.
- Annotation creation lives on the reader side; this bobbin is the
  author-facing inbox.
