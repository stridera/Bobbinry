import { useState } from 'react'
import { paletteClasses, isPaletteToken, PALETTE_TOKENS } from '@bobbinry/ui-components'
import {
  characterInitial,
  type ChapterColorFields,
  type CharacterColorRef,
  type CharactersById,
} from '../lib/chapterColors'

export interface ChapterMetaPatch {
  pov_character_id?: string | null
  featured_character_ids?: string[]
  manual_color?: string | null
}

interface ChapterMetaMenuProps {
  chapterColor: ChapterColorFields
  characters: CharactersById
  /** Resolved stripe/swatch classes for the chapter's effective colour, or null. */
  colorClasses: ReturnType<typeof paletteClasses>
  povCharacter: CharacterColorRef | null
  featuredCharacters: CharacterColorRef[]
  onPatch: (patch: ChapterMetaPatch) => void
}

type MetaView = 'main' | 'pov' | 'featured' | 'color'

/**
 * POV character + colour picker. Combined dropdown: pick POV character, add
 * featured characters, or set a manual colour override. Mirrors the right-click
 * menu in the navigation panel; either path works.
 */
export function ChapterMetaMenu({ chapterColor, characters, colorClasses, povCharacter, featuredCharacters, onPatch }: ChapterMetaMenuProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<MetaView>('main')
  const close = () => { setOpen(false); setView('main') }
  const patchAndClose = (patch: ChapterMetaPatch) => { onPatch(patch); close() }

  const characterList: CharacterColorRef[] = Array.from(characters.values()).sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? ''),
  )
  const backButton = (label: string) => (
    <button
      type="button"
      onClick={() => setView('main')}
      className="w-full text-left px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-700"
    >
      ← {label}
    </button>
  )

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setView('main') }}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset bg-white text-gray-700 ring-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-gray-700/60 transition-colors"
        title={povCharacter?.name ? `POV: ${povCharacter.name}` : 'Set POV character'}
      >
        <span
          aria-hidden
          className={`inline-block h-3 w-3 rounded-full ${colorClasses?.swatchBg ?? 'bg-gray-300 dark:bg-gray-600'}`}
        />
        <span>
          {povCharacter?.name
            ? `POV: ${povCharacter.name}`
            : isPaletteToken(chapterColor.manual_color)
              ? 'Custom color'
              : 'POV'}
        </span>
        {featuredCharacters.length > 0 && (
          <span className="flex items-center gap-0.5 ml-1">
            {featuredCharacters.slice(0, 3).map(c => {
              const cls = paletteClasses(c.color)
              return (
                <span
                  key={c.id}
                  title={c.name ?? 'Unnamed'}
                  className={`inline-flex items-center justify-center h-3 w-3 rounded-full text-[7px] font-semibold text-white ring-1 ring-white dark:ring-gray-800 ${cls?.chipBg ?? 'bg-gray-300 dark:bg-gray-600'}`}
                >
                  {characterInitial(c.name)}
                </span>
              )
            })}
            {featuredCharacters.length > 3 && (
              <span className="text-[10px] text-gray-500 dark:text-gray-400">+{featuredCharacters.length - 3}</span>
            )}
          </span>
        )}
        <svg className="w-3 h-3 opacity-60" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <path d="M2 4l4 4 4-4z" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} aria-hidden="true" />
          <div className="absolute left-0 top-full mt-1 z-20 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg overflow-hidden">
            {view === 'main' && (
              <>
                <button
                  type="button"
                  onClick={() => setView('pov')}
                  className="flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                >
                  <span className="flex items-center gap-2">
                    <span>🎭</span>
                    <span>POV character</span>
                  </span>
                  <span className="flex items-center gap-1 text-gray-400">
                    {povCharacter ? (
                      <>
                        <span className={`h-2.5 w-2.5 rounded-full ${paletteClasses(povCharacter.color)?.swatchBg ?? 'bg-gray-300 dark:bg-gray-600'}`} />
                        <span className="truncate max-w-[100px]">{povCharacter.name}</span>
                      </>
                    ) : (
                      <span className="italic">none</span>
                    )}
                    <span className="ml-1">▸</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setView('featured')}
                  className="flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border-t border-gray-200 dark:border-gray-700"
                >
                  <span className="flex items-center gap-2">
                    <span>👥</span>
                    <span>Featured characters</span>
                  </span>
                  <span className="flex items-center gap-0.5 text-gray-400">
                    <span>{featuredCharacters.length || '—'}</span>
                    <span className="ml-1">▸</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setView('color')}
                  className="flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border-t border-gray-200 dark:border-gray-700"
                >
                  <span className="flex items-center gap-2">
                    <span>🎨</span>
                    <span>Custom color</span>
                  </span>
                  <span className="flex items-center gap-1 text-gray-400">
                    {isPaletteToken(chapterColor.manual_color) ? (
                      <>
                        <span className={`h-2.5 w-2.5 rounded-full ${paletteClasses(chapterColor.manual_color)?.swatchBg}`} />
                        <span>{paletteClasses(chapterColor.manual_color)?.label}</span>
                      </>
                    ) : (
                      <span className="italic">none</span>
                    )}
                    <span className="ml-1">▸</span>
                  </span>
                </button>
              </>
            )}

            {view === 'pov' && (
              <div className="max-h-72 overflow-y-auto">
                {backButton('POV character')}
                <button
                  type="button"
                  onClick={() => patchAndClose({ pov_character_id: null })}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 ${chapterColor.pov_character_id == null ? 'font-semibold' : ''}`}
                >
                  <span className="h-3 w-3 rounded-full border border-gray-300 dark:border-gray-600" />
                  <span className="italic text-gray-500 dark:text-gray-400">(none)</span>
                </button>
                {characterList.length === 0 && (
                  <div className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400 italic">No characters yet</div>
                )}
                {characterList.map(char => {
                  const cls = paletteClasses(char.color)
                  const isCurrent = char.id === chapterColor.pov_character_id
                  return (
                    <button
                      key={char.id}
                      type="button"
                      onClick={() => patchAndClose({ pov_character_id: char.id, manual_color: null })}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 ${isCurrent ? 'font-semibold' : ''}`}
                    >
                      <span className={`h-3 w-3 rounded-full ${cls?.swatchBg ?? 'bg-gray-300 dark:bg-gray-600'}`} />
                      <span className="truncate flex-1 text-left">{char.name ?? 'Unnamed'}</span>
                      {isCurrent && <span className="text-blue-500">✓</span>}
                    </button>
                  )
                })}
              </div>
            )}

            {view === 'featured' && (
              <div className="max-h-72 overflow-y-auto">
                {backButton('Featured characters')}
                {characterList.length === 0 && (
                  <div className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400 italic">No characters yet</div>
                )}
                {characterList.map(char => {
                  const cls = paletteClasses(char.color)
                  const current = new Set(chapterColor.featured_character_ids ?? [])
                  const isOn = current.has(char.id)
                  return (
                    <button
                      key={char.id}
                      type="button"
                      onClick={() => {
                        const next = new Set(current)
                        if (isOn) next.delete(char.id)
                        else next.add(char.id)
                        onPatch({ featured_character_ids: Array.from(next) })
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                    >
                      <span className={`inline-flex items-center justify-center h-3.5 w-3.5 rounded border ${isOn ? 'bg-gray-900 dark:bg-gray-100 border-gray-900 dark:border-gray-100 text-white dark:text-gray-900' : 'border-gray-400 dark:border-gray-500'}`}>
                        {isOn && <span className="text-[10px] leading-none">✓</span>}
                      </span>
                      <span className={`h-3 w-3 rounded-full ${cls?.swatchBg ?? 'bg-gray-300 dark:bg-gray-600'}`} />
                      <span className="truncate flex-1 text-left">{char.name ?? 'Unnamed'}</span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={close}
                  className="w-full text-left px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border-t border-gray-200 dark:border-gray-700"
                >
                  Done
                </button>
              </div>
            )}

            {view === 'color' && (
              <div>
                {backButton('Custom color')}
                <div className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">
                  Overrides POV character color.
                </div>
                <div className="px-3 pb-3 grid grid-cols-6 gap-2">
                  {PALETTE_TOKENS.map(token => {
                    const cls = paletteClasses(token)
                    if (!cls) return null
                    const isCurrent = token === chapterColor.manual_color
                    return (
                      <button
                        key={token}
                        type="button"
                        title={cls.label}
                        onClick={() => patchAndClose({ manual_color: token })}
                        className={`h-6 w-6 rounded-full ${cls.swatchBg} ring-offset-2 ring-offset-white dark:ring-offset-gray-800 transition ${isCurrent ? 'ring-2 ring-gray-900 dark:ring-gray-100' : 'hover:ring-2 hover:ring-gray-300 dark:hover:ring-gray-500'}`}
                      />
                    )
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => patchAndClose({ manual_color: null })}
                  className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 border-t border-gray-200 dark:border-gray-700"
                >
                  Clear custom color
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
