'use client'

/**
 * UserBadges — config-driven badge pill component
 *
 * Renders a row of colored pills for user badges.
 * Adding a new badge type only requires adding an entry to BADGE_CONFIG.
 */

const BADGE_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  owner: {
    label: 'Owner',
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    text: 'text-amber-800 dark:text-amber-300',
  },
  supporter: {
    label: 'Supporter',
    bg: 'bg-purple-100 dark:bg-purple-900/40',
    text: 'text-purple-800 dark:text-purple-300',
  },
  moderator: {
    label: 'Moderator',
    bg: 'bg-blue-100 dark:bg-blue-900/40',
    text: 'text-blue-800 dark:text-blue-300',
  },
  crowdfunder: {
    label: 'Crowdfunder',
    bg: 'bg-green-100 dark:bg-green-900/40',
    text: 'text-green-800 dark:text-green-300',
  },
  beta_tester: {
    label: 'Beta Tester',
    bg: 'bg-teal-100 dark:bg-teal-900/40',
    text: 'text-teal-800 dark:text-teal-300',
  },
  contributor: {
    label: 'Contributor',
    bg: 'bg-indigo-100 dark:bg-indigo-900/40',
    text: 'text-indigo-800 dark:text-indigo-300',
  },
}

interface UserBadgesProps {
  badges: string[]
  size?: 'sm' | 'md'
  className?: string
}

export function UserBadges({ badges, size = 'sm', className = '' }: UserBadgesProps) {
  if (!badges || badges.length === 0) return null

  const sizeClasses = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'

  return (
    <span className={`inline-flex flex-wrap gap-1 ${className}`}>
      {badges.map(badge => {
        const config = BADGE_CONFIG[badge]
        if (!config) return null

        return (
          <span
            key={badge}
            className={`inline-flex items-center rounded-full font-medium ${sizeClasses} ${config.bg} ${config.text}`}
          >
            {config.label}
          </span>
        )
      })}
    </span>
  )
}
