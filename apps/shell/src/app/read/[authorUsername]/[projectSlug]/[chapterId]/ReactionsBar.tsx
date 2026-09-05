import type { ReaderThemeClasses } from './reader-theme'
import { REACTION_EMOJIS, type ReactionCount } from './types'

interface ReactionsBarProps {
  theme: ReaderThemeClasses
  reactions: ReactionCount[]
  signedIn: boolean
  onToggle: (reactionType: string) => void
}

/** Toggle buttons for a signed-in reader, read-only counts otherwise. Hidden when there is nothing to show. */
export function ReactionsBar({ theme, reactions, signedIn, onToggle }: ReactionsBarProps) {
  const { borderColor, hoverBg, reactionActive } = theme
  const nonZero = reactions.filter(r => r.count > 0)
  if (!signedIn && nonZero.length === 0) return null

  return (
    <div className={`mt-12 pt-6 border-t ${borderColor}`}>
      <div className="flex flex-wrap gap-2">
        {signedIn ? (
          Object.entries(REACTION_EMOJIS).map(([type, emoji]) => {
            const count = reactions.find(r => r.reactionType === type)?.count ?? 0
            return (
              <button
                key={type}
                onClick={() => onToggle(type)}
                className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                  count > 0 ? reactionActive : `${borderColor} ${hoverBg}`
                }`}
              >
                {emoji} {count > 0 && count}
              </button>
            )
          })
        ) : (
          nonZero.map(r => (
            <span key={r.reactionType} className={`px-3 py-1.5 rounded-full border text-sm ${reactionActive}`}>
              {REACTION_EMOJIS[r.reactionType] || r.reactionType} {r.count}
            </span>
          ))
        )}
      </div>
    </div>
  )
}
