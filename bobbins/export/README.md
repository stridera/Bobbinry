# Export

Export your manuscript as PDF, EPUB, Markdown, or plain text. Templating
and metadata (cover image, ISBN, language) are configured via
`projectExportConfig` on the API side.

- Server-side rendering: PDF via `pdfkit`, EPUB via `epub-gen-memory`,
  Markdown via `turndown`. Output is streamed to the user as a download.
- No client-side panels — invoked from the project menu.
