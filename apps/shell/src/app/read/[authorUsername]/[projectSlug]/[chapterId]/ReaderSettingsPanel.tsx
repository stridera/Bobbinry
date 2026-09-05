import type { ReaderThemeClasses } from './reader-theme'
import {
  WIDTHS,
  type EntityHighlightStyle,
  type EntityInfoDisplay,
  type FontSize,
  type ReaderPrefs,
  type ReaderTheme,
  type ReaderWidth,
} from './types'

interface ReaderSettingsPanelProps {
  theme: ReaderThemeClasses
  prefs: ReaderPrefs
  onChange: <K extends keyof ReaderPrefs>(key: K, value: ReaderPrefs[K]) => void
  /** Entity controls only make sense when the project publishes entities. */
  hasEntities: boolean
}

const FONT_LABELS: Record<FontSize, string> = { small: 'S', medium: 'M', large: 'L', xlarge: 'XL' }

export function ReaderSettingsPanel({ theme, prefs, onChange, hasEntities }: ReaderSettingsPanelProps) {
  const { borderColor, mutedText, activeBg, hoverBg } = theme
  const button = (active: boolean) => `px-2 py-1 rounded text-xs ${active ? activeBg : hoverBg}`

  return (
    <div className={`${WIDTHS[prefs.readerWidth]} mx-auto px-4 pb-3 border-t ${borderColor} pt-3`}>
      <div className="flex flex-wrap gap-4 text-sm">
        <div>
          <span className={`text-xs ${mutedText} block mb-1`}>Size</span>
          <div className="flex gap-1">
            {(['small', 'medium', 'large', 'xlarge'] as FontSize[]).map(s => (
              <button key={s} onClick={() => onChange('fontSize', s)} className={button(prefs.fontSize === s)}>
                {FONT_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={`text-xs ${mutedText} block mb-1`}>Theme</span>
          <div className="flex gap-1">
            {(['light', 'dark', 'sepia'] as ReaderTheme[]).map(t => (
              <button key={t} onClick={() => onChange('readerTheme', t)} className={`${button(prefs.readerTheme === t)} capitalize`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={`text-xs ${mutedText} block mb-1`}>Width</span>
          <div className="flex gap-1">
            {(['narrow', 'standard', 'wide', 'fit'] as ReaderWidth[]).map(w => (
              <button key={w} onClick={() => onChange('readerWidth', w)} className={`${button(prefs.readerWidth === w)} capitalize`}>
                {w}
              </button>
            ))}
          </div>
        </div>
        {hasEntities && (
          <div>
            <span className={`text-xs ${mutedText} block mb-1`}>Entities</span>
            <div className="flex gap-1">
              {([
                { id: 'highlight' as EntityHighlightStyle, label: 'Highlight' },
                { id: 'underline' as EntityHighlightStyle, label: 'Underline' },
                { id: 'off' as EntityHighlightStyle, label: 'Off' },
              ]).map(opt => (
                <button key={opt.id} onClick={() => onChange('entityHighlightStyle', opt.id)} className={button(prefs.entityHighlightStyle === opt.id)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {hasEntities && prefs.entityHighlightStyle !== 'off' && (
          <div className="hidden lg:block">
            <span className={`text-xs ${mutedText} block mb-1`}>Peek on hover</span>
            <div className="flex gap-1">
              {([{ on: true, label: 'On' }, { on: false, label: 'Off' }]).map(opt => (
                <button key={opt.label} onClick={() => onChange('entityPeekOnHover', opt.on)} className={button(prefs.entityPeekOnHover === opt.on)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {hasEntities && (
          <div className="hidden lg:block">
            <span className={`text-xs ${mutedText} block mb-1`}>Entity info</span>
            <div className="flex gap-1">
              {([
                { id: 'sidebar' as EntityInfoDisplay, label: 'Sidebar' },
                { id: 'popup' as EntityInfoDisplay, label: 'Popup' },
              ]).map(opt => (
                <button key={opt.id} onClick={() => onChange('entityInfoDisplay', opt.id)} className={button(prefs.entityInfoDisplay === opt.id)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
