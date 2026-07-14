export type ParagraphSpacing = 'standard' | 'manuscript'
export type ParagraphIndent = 'none' | 'first-line' | 'every'
export type SceneBreakStyle = 'asterism' | 'rule' | 'blank-line'

export interface ManuscriptDisplaySettings {
  paragraphSpacing: ParagraphSpacing
  paragraphIndent: ParagraphIndent
  codeBlockWrap: boolean
  sceneBreakStyle: SceneBreakStyle
  dropCaps: boolean
  smartDashes: boolean
  smartEllipsis: boolean
}

export type PartialManuscriptDisplaySettings = {
  [K in keyof ManuscriptDisplaySettings]?: ManuscriptDisplaySettings[K] | null
}

export const MANUSCRIPT_DISPLAY_DEFAULTS: ManuscriptDisplaySettings = {
  paragraphSpacing: 'standard',
  paragraphIndent: 'none',
  codeBlockWrap: false,
  sceneBreakStyle: 'asterism',
  dropCaps: false,
  smartDashes: false,
  smartEllipsis: false,
}

export interface DisplayPreset {
  id: string
  name: string
  description: string
  values: PartialManuscriptDisplaySettings
}

/**
 * Named style presets that one-click set the cascading display fields.
 * Adding a new preset here lights it up in every UI surface automatically
 * (editor popup, project dashboard card, user settings page).
 */
export const DISPLAY_PRESETS: readonly DisplayPreset[] = [
  {
    id: 'manuscript',
    name: 'Manuscript',
    description: 'Traditional novel: no extra paragraph spacing, first-line indents, asterism scene breaks.',
    values: {
      paragraphSpacing: 'manuscript',
      paragraphIndent: 'first-line',
      sceneBreakStyle: 'asterism',
      codeBlockWrap: false,
      dropCaps: false,
    },
  },
  {
    id: 'paperback',
    name: 'Paperback',
    description: 'Manuscript style plus drop caps on the opening paragraph after each heading.',
    values: {
      paragraphSpacing: 'manuscript',
      paragraphIndent: 'first-line',
      sceneBreakStyle: 'asterism',
      codeBlockWrap: false,
      dropCaps: true,
    },
  },
  {
    id: 'web',
    name: 'Web',
    description: 'HTML / blog style: visible space between paragraphs, no indent, plain horizontal rule scene breaks.',
    values: {
      paragraphSpacing: 'standard',
      paragraphIndent: 'none',
      sceneBreakStyle: 'rule',
      codeBlockWrap: true,
      dropCaps: false,
    },
  },
  {
    id: 'litrpg',
    name: 'LitRPG',
    description: 'Manuscript style but with code-block word-wrap turned on, since LitRPGs use code blocks for system messages.',
    values: {
      paragraphSpacing: 'manuscript',
      paragraphIndent: 'first-line',
      sceneBreakStyle: 'asterism',
      codeBlockWrap: true,
      dropCaps: false,
    },
  },
  {
    id: 'inherit',
    name: 'Inherit',
    description: 'Clears every override at this scope so the layer above takes over (project inherits user; chapter inherits project).',
    values: {
      paragraphSpacing: null,
      paragraphIndent: null,
      sceneBreakStyle: null,
      codeBlockWrap: null,
      dropCaps: null,
      smartDashes: null,
      smartEllipsis: null,
    },
  },
] as const

/** @deprecated Use DISPLAY_PRESETS.find(p => p.id === 'manuscript') */
export const MANUSCRIPT_PRESET: PartialManuscriptDisplaySettings =
  DISPLAY_PRESETS.find(p => p.id === 'manuscript')?.values ?? {}

export const PARAGRAPH_SPACING_VALUES: readonly ParagraphSpacing[] = ['standard', 'manuscript'] as const
export const PARAGRAPH_INDENT_VALUES: readonly ParagraphIndent[] = ['none', 'first-line', 'every'] as const
export const SCENE_BREAK_VALUES: readonly SceneBreakStyle[] = ['asterism', 'rule', 'blank-line'] as const

export const PARAGRAPH_SPACING_LABELS: Record<ParagraphSpacing, string> = {
  standard: 'Standard',
  manuscript: 'Manuscript',
}

export const PARAGRAPH_INDENT_LABELS: Record<ParagraphIndent, string> = {
  none: 'No indent',
  'first-line': 'First-line indent',
  every: 'Every paragraph indented',
}

export const SCENE_BREAK_LABELS: Record<SceneBreakStyle, string> = {
  asterism: 'Asterism (* * *)',
  rule: 'Horizontal rule',
  'blank-line': 'Blank line',
}

export const DISPLAY_FIELD_LABELS: Record<keyof ManuscriptDisplaySettings, string> = {
  paragraphSpacing: 'Paragraph spacing',
  paragraphIndent: 'Paragraph indent',
  codeBlockWrap: 'Code block wrap',
  sceneBreakStyle: 'Scene break style',
  dropCaps: 'Drop caps',
  smartDashes: 'Smart dashes',
  smartEllipsis: 'Smart ellipsis',
}

/** Human label for a single resolved display-settings value. */
export function displayValueLabel<K extends keyof ManuscriptDisplaySettings>(
  field: K,
  value: ManuscriptDisplaySettings[K],
): string {
  switch (field) {
    case 'paragraphSpacing':
      return PARAGRAPH_SPACING_LABELS[value as ParagraphSpacing]
    case 'paragraphIndent':
      return PARAGRAPH_INDENT_LABELS[value as ParagraphIndent]
    case 'sceneBreakStyle':
      return SCENE_BREAK_LABELS[value as SceneBreakStyle]
    default:
      return value ? 'On' : 'Off'
  }
}

/** Compact one-line summary of resolved settings, e.g. "standard spacing, code wrap". */
export function summarizeDisplaySettings(s: ManuscriptDisplaySettings): string {
  const parts: string[] = []
  parts.push(s.paragraphSpacing === 'manuscript' ? 'manuscript ¶ spacing' : 'standard spacing')
  if (s.paragraphIndent === 'first-line') parts.push('first-line indent')
  else if (s.paragraphIndent === 'every') parts.push('all ¶ indented')
  if (s.codeBlockWrap) parts.push('code wrap')
  if (s.dropCaps) parts.push('drop caps')
  if (s.smartDashes) parts.push('smart dashes')
  if (s.smartEllipsis) parts.push('smart ellipsis')
  if (s.sceneBreakStyle !== MANUSCRIPT_DISPLAY_DEFAULTS.sceneBreakStyle) parts.push(`${s.sceneBreakStyle} breaks`)
  return parts.join(', ')
}

function pick<T>(...candidates: (T | null | undefined)[]): T | undefined {
  for (const c of candidates) {
    if (c !== null && c !== undefined) return c
  }
  return undefined
}

export function resolveDisplaySettings(
  user?: PartialManuscriptDisplaySettings | null,
  project?: PartialManuscriptDisplaySettings | null,
  content?: PartialManuscriptDisplaySettings | null,
): ManuscriptDisplaySettings {
  return {
    paragraphSpacing:
      pick(content?.paragraphSpacing, project?.paragraphSpacing, user?.paragraphSpacing) ??
      MANUSCRIPT_DISPLAY_DEFAULTS.paragraphSpacing,
    paragraphIndent:
      pick(content?.paragraphIndent, project?.paragraphIndent, user?.paragraphIndent) ??
      MANUSCRIPT_DISPLAY_DEFAULTS.paragraphIndent,
    codeBlockWrap:
      pick(content?.codeBlockWrap, project?.codeBlockWrap, user?.codeBlockWrap) ??
      MANUSCRIPT_DISPLAY_DEFAULTS.codeBlockWrap,
    sceneBreakStyle:
      pick(content?.sceneBreakStyle, project?.sceneBreakStyle, user?.sceneBreakStyle) ??
      MANUSCRIPT_DISPLAY_DEFAULTS.sceneBreakStyle,
    dropCaps:
      pick(content?.dropCaps, project?.dropCaps, user?.dropCaps) ??
      MANUSCRIPT_DISPLAY_DEFAULTS.dropCaps,
    smartDashes:
      pick(content?.smartDashes, project?.smartDashes, user?.smartDashes) ??
      MANUSCRIPT_DISPLAY_DEFAULTS.smartDashes,
    smartEllipsis:
      pick(content?.smartEllipsis, project?.smartEllipsis, user?.smartEllipsis) ??
      MANUSCRIPT_DISPLAY_DEFAULTS.smartEllipsis,
  }
}

export function displaySettingsToClass(s: ManuscriptDisplaySettings): string {
  const classes: string[] = ['ms-display']
  classes.push(`ms-spacing-${s.paragraphSpacing}`)
  classes.push(`ms-indent-${s.paragraphIndent}`)
  if (s.codeBlockWrap) classes.push('ms-codewrap')
  classes.push(`ms-break-${s.sceneBreakStyle}`)
  if (s.dropCaps) classes.push('ms-dropcap')
  return classes.join(' ')
}

export function sanitizeDisplaySettings(input: unknown): PartialManuscriptDisplaySettings {
  if (!input || typeof input !== 'object') return {}
  const obj = input as Record<string, unknown>
  const out: PartialManuscriptDisplaySettings = {}
  if (typeof obj.paragraphSpacing === 'string' && (PARAGRAPH_SPACING_VALUES as readonly string[]).includes(obj.paragraphSpacing)) {
    out.paragraphSpacing = obj.paragraphSpacing as ParagraphSpacing
  }
  if (typeof obj.paragraphIndent === 'string' && (PARAGRAPH_INDENT_VALUES as readonly string[]).includes(obj.paragraphIndent)) {
    out.paragraphIndent = obj.paragraphIndent as ParagraphIndent
  }
  if (typeof obj.codeBlockWrap === 'boolean') out.codeBlockWrap = obj.codeBlockWrap
  if (typeof obj.sceneBreakStyle === 'string' && (SCENE_BREAK_VALUES as readonly string[]).includes(obj.sceneBreakStyle)) {
    out.sceneBreakStyle = obj.sceneBreakStyle as SceneBreakStyle
  }
  if (typeof obj.dropCaps === 'boolean') out.dropCaps = obj.dropCaps
  if (typeof obj.smartDashes === 'boolean') out.smartDashes = obj.smartDashes
  if (typeof obj.smartEllipsis === 'boolean') out.smartEllipsis = obj.smartEllipsis
  return out
}
