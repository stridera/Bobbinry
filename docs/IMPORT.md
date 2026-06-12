# Manuscript Import

Bobbinry's import wizard lets writers upload an existing manuscript and have
it split into chapters automatically. The wizard surfaces a preview step
where users review and edit the proposed split before any chapters are
created.

## Where it lives

| Piece | Location |
| --- | --- |
| Upload primitive | `apps/api/src/routes/uploads.ts` (`'import'` context) |
| Parse + commit routes | `apps/api/src/routes/import.ts` |
| Per-format parsers | `apps/api/src/lib/import-parsers/*.ts` |
| Wizard UI | `apps/shell/src/app/projects/[projectId]/components/dashboard/import/ImportWizard.tsx` |
| HTML sanitizer (shared with commit) | `apps/api/src/lib/sanitize-html.ts` |

## Format support matrix

| Format | Split strategy | Inline emphasis | Embedded images | Notes |
| --- | --- | --- | --- | --- |
| `.txt` | `^(Chapter\|Prologue\|Epilogue\|Part\|Book)\b...` regex | n/a (plain text) | n/a | Leading prose before the first marker becomes a "Prelude" segment. |
| `.md` | `#` and `##` ATX headings | preserved (marked → sanitize) | inline `data:` URIs uploaded | Setext-style underlined headings come through as one segment with a `STRUCTURE_GUESSED` warning. |
| `.docx` | Explicit `<w:br w:type="page"/>` via mammoth's `transformDocument`; falls back to top-level `<h1>` when no page breaks exist | bold / italic / underline / strike preserved | extracted via mammoth's `convertImage` hook, uploaded to S3, `<img src>` rewritten | Soft (auto-paginated) page breaks are ignored. |
| `.epub` | One segment per `linear="yes"` spine item | preserved from the original XHTML | manifest images resolved against the chapter's directory, uploaded, `src` rewritten | epub3 nav documents and image-only spine items are skipped. |
| `.odt` | `<text:soft-page-break/>` (LibreOffice's pagination); falls back to top-level `<h1>` | **dropped in v1** — surfaces `FORMATTING_LOST` warning | `Pictures/` folder uploaded via shared helper | Inline emphasis would require resolving `text:span` style-name chains against `styles.xml`. |
| `.rtf` | Synthetic `<h1>` markers from chapter-keyword lines | **dropped in v1** — surfaces `FORMATTING_LOST` warning | dropped | Hand-rolled extractor; known non-content destinations (`fonttbl`, `colortbl`, `pict`, `info`, headers/footers, …) are skipped. |
| `.pdf` | Heuristic: lines whose font is ≥ 1.4× the body font, or that match the chapter-keyword regex, AND are ≤ 100 chars | none (text-only) | dropped | Always lossy — surfaces `FORMATTING_LOST`. Lines grouped into paragraphs by vertical gap. |
| `.html` | _(not yet implemented)_ | — | — | Planned. |

All sanitized output passes through the same Tiptap-safe whitelist
(`apps/api/src/lib/import-parsers/sanitize.ts`) before reaching the editor:
`<script>`, `<iframe>`, `on*` handlers, `javascript:` URLs, and CSS
`expression()` are dropped.

## Limits

- Source file upload: **25 MB** on the free tier, **50 MB** on supporter
  (matches the existing `getSizeLimits` multiplier).
- Parse response payload cap: **10 MB** of rendered HTML (per
  `PARSE_PAYLOAD_CAP_BYTES` in `apps/api/src/routes/import.ts`).
- Commit batch cap: **500 segments** per request.
- Zip-bomb defense (epub, odt): **250 MB** total uncompressed, **50 MB**
  per entry, **5000** entries (`apps/api/src/lib/import-parsers/zip-safe.ts`).

## Error codes

The parse and commit endpoints return a stable `code` field on every error.

### `POST /api/import/parse`

| Code | HTTP | Meaning |
| --- | --- | --- |
| `IMPORT_VALIDATION_FAILED` | 400 | Request body failed Zod validation. |
| `IMPORT_FORMAT_UNSUPPORTED` | 400 | The upload's stored Content-Type isn't one we know how to parse. |
| `IMPORT_UPLOAD_NOT_FOUND` | 404 | No upload row matches `{fileKey, projectId, userId}` with `context='import'`. |
| `IMPORT_SOURCE_MISSING` | 404 | The S3 object referenced by the upload row is gone. |
| `IMPORT_ZIP_BOMB` | 413 | Zip-based source exceeds one of the zip-safe caps. |
| `IMPORT_PAYLOAD_TOO_LARGE` | 413 | Parsed HTML exceeds the preview-cap budget. |
| `IMPORT_PARSE_FAILED` | 422 | The format-specific parser threw. |
| `IMPORT_SOURCE_READ_FAILED` | 500 | S3 GET succeeded but the stream couldn't be drained. |
| `IMPORT_FORMAT_NOT_YET_IMPLEMENTED` | 501 | Format is recognized but no parser is wired up yet (currently `.html`). |
| `IMPORT_INTERNAL_ERROR` | 500 | Unhandled exception. |

### `POST /api/import/commit`

| Code | HTTP | Meaning |
| --- | --- | --- |
| `IMPORT_VALIDATION_FAILED` | 400 | Request body failed Zod validation (includes too-many-segments cap). |
| `IMPORT_MANUSCRIPT_NOT_INSTALLED` | 400 | The manuscript bobbin isn't installed in the target project. |
| `IMPORT_CONTAINER_NOT_FOUND` | 422 | The target container doesn't exist, isn't a manuscript container, or belongs to a different project. |
| `IMPORT_INTERNAL_ERROR` | 500 | Unhandled exception; transaction rolled back. |

## Telemetry

The route fires the following events via `serverEventBus` (see
`apps/api/src/lib/event-bus.ts`); they're fire-and-forget and meant for
future analytics dashboards:

| Event | Payload |
| --- | --- |
| `import:parseCompleted` | `{ format, segmentCount, durationMs }` |
| `import:parseFailed` | `{ format, code, durationMs }` |
| `import:commitCompleted` | `{ containerId, segmentCount, durationMs }` |
| `import:commitFailed` | `{ containerId, code, durationMs }` |

## Explicitly not in scope (v1)

- Scrivener `.scriv` bundles.
- Background job processing — parse + commit are synchronous; the wizard
  surfaces progress in the UI.
- In-UI customization of the chapter-keyword regex for `.txt` imports.
- Footnotes, endnotes, comments, and tracked changes — stripped silently.
- Inline emphasis preservation for `.odt` and `.rtf`.
- Tables — preserved only via cheerio passthrough for `.epub`/`.html`;
  flattened to text for everything else.
- Custom paragraph styles, fonts, colors, and line spacing — dropped.
- "Create new container" inside the wizard (user picks an existing one).
- Resumable uploads.
- Re-using the import flow for non-manuscript bobbins — the route
  hard-codes `collection: 'content'`.

## Adding a new format

1. Add the MIME to `ALLOWED_IMPORT_TYPES` in
   `apps/api/src/routes/uploads.ts` and `extFromMime`/`buildS3Key`.
2. Add the format to `SupportedFormat` and `formatFromMime` in
   `apps/api/src/lib/import-parsers/index.ts`.
3. Write `apps/api/src/lib/import-parsers/<format>.ts` exporting an async
   `parse<Format>(buffer, ctx): Promise<ParserResult>`.
4. Add a `case '<format>':` branch in `parseBuffer` that lazy-imports the
   new module.
5. Update the wizard hint text in
   `apps/shell/src/app/projects/[projectId]/components/dashboard/ImportManuscript.tsx`
   and `import/ImportWizard.tsx`.
