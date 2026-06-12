/**
 * Shared contracts for the import/export "narrow waists".
 *
 * Import: bobbins (or the built-in wizard) gather and format content into
 * ImportSegments, then write through POST /import/commit — the single
 * validated, sanitized write path. Export: bobbins read the normalized
 * manuscript via GET /projects/:projectId/export/snapshot.
 */

export interface ImportSegment {
  tempId: string
  suggestedTitle: string
  html: string
  wordCount: number
  firstLine: string
  /** Structured title-detection metadata for parsers that can identify a
   *  distinct title element (heading, chapter-marker paragraph, optionally
   *  with a matching subtitle paragraph). Used by the wizard to recompute
   *  the displayed title when the user picks a different separator and to
   *  decide whether the "strip title from body" toggle should be available. */
  titleStructure?: {
    label: string
    subtitle?: string
  }
  /** Body HTML with the title source paragraph(s) removed. Only set when
   *  `titleStructure` is set. Surrounding empty paragraphs are kept so
   *  vertical spacing stays intact. Used when the wizard's strip-from-body
   *  option is enabled. */
  htmlWithoutTitle?: string
}

export interface ImportWarning {
  code:
    | 'IMAGE_FAILED'
    | 'EXTERNAL_IMAGE_LEFT'
    | 'FORMATTING_LOST'
    | 'STRUCTURE_GUESSED'
    | 'EMPTY_DOCUMENT'
  message: string
  detail?: string
}

/** Response shape of POST /import/parse. */
export interface ImportParseResult {
  segments: ImportSegment[]
  warnings: ImportWarning[]
  sourceFormat: string
}

/** Response shape of POST /import/commit. */
export interface ImportCommitResult {
  entities: Array<{ id: string; title: string; order: number }>
}

export interface ExportSnapshotContainer {
  id: string
  title: string
  type: string
  order: number
  parentId: string | null
}

export interface ExportSnapshotContent {
  id: string
  title: string
  html: string
  order: number
  status: string
  containerId: string | null
  wordCount: number
}

/**
 * Normalized manuscript read model returned by
 * GET /projects/:projectId/export/snapshot. The blessed way for export and
 * publisher bobbins to read a manuscript — consumers should not query the
 * manuscript collections directly.
 */
export interface ExportSnapshot {
  project: { id: string; name: string; description?: string | null }
  /** ISO timestamp of when the snapshot was generated. */
  generatedAt: string
  /** Ordered by `order` ascending. */
  containers: ExportSnapshotContainer[]
  /** Ordered by `order` ascending. */
  content: ExportSnapshotContent[]
}
