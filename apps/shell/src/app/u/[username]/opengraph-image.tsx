import { ImageResponse } from 'next/og'
import { config } from '@/lib/config'

export const runtime = 'edge'

export const alt = 'Profile on Bobbinry'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({
  params,
}: {
  params: { username: string }
}) {
  const { username } = await params

  let displayName = username
  let bio: string | null = null
  let avatarUrl: string | null = null
  let projectCount = 0
  let badges: string[] = []

  try {
    const res = await fetch(
      `${config.apiUrl}/api/users/by-username/${encodeURIComponent(username)}`
    )
    if (res.ok) {
      const data = await res.json()
      const profile = data.profile
      displayName =
        profile?.displayName || profile?.userName || profile?.username || username
      bio = profile?.bio || null
      avatarUrl = profile?.avatarUrl || null

      if (profile?.userId) {
        const [projectsRes, badgesRes] = await Promise.all([
          fetch(
            `${config.apiUrl}/api/users/${profile.userId}/published-projects`
          ),
          fetch(`${config.apiUrl}/api/users/${profile.userId}/badges`),
        ])

        if (projectsRes.ok) {
          const projectsData = await projectsRes.json()
          projectCount = projectsData.projects?.length || 0
        }

        if (badgesRes.ok) {
          const badgesData = await badgesRes.json()
          badges = badgesData.badges || []
        }
      }
    }
  } catch {
    // Fall through to defaults
  }

  const truncatedBio = bio
    ? bio.length > 140
      ? bio.slice(0, 137) + '...'
      : bio
    : null

  const initial = displayName.charAt(0).toUpperCase()

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background:
            'linear-gradient(145deg, #1a1917 0%, #231f1b 40%, #1a2423 100%)',
          fontFamily: 'Georgia, serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Subtle texture lines */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.04,
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 39px, #d0c5b7 39px, #d0c5b7 40px)',
          }}
        />

        {/* Teal accent bar at top */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '4px',
            background: 'linear-gradient(90deg, #33706b, #5ba69f, #33706b)',
          }}
        />

        {/* Avatar */}
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            width={120}
            height={120}
            style={{
              width: '120px',
              height: '120px',
              borderRadius: '60px',
              objectFit: 'cover',
              marginBottom: '24px',
              border: '3px solid #33706b',
            }}
          />
        ) : (
          <div
            style={{
              width: '120px',
              height: '120px',
              borderRadius: '60px',
              background: '#33706b',
              color: '#faf8f4',
              fontSize: '52px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '24px',
            }}
          >
            {initial}
          </div>
        )}

        {/* Display name */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '8px',
          }}
        >
          <div
            style={{
              fontSize: '48px',
              fontWeight: 700,
              color: '#f3ede5',
              letterSpacing: '-1.5px',
            }}
          >
            {displayName}
          </div>
          {badges.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: '6px',
              }}
            >
              {badges.slice(0, 3).map((badge, i) => (
                <div
                  key={i}
                  style={{
                    padding: '4px 12px',
                    borderRadius: '12px',
                    background: 'rgba(91, 166, 159, 0.15)',
                    border: '1px solid rgba(91, 166, 159, 0.3)',
                    color: '#5ba69f',
                    fontSize: '14px',
                    fontWeight: 600,
                  }}
                >
                  {badge}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Username */}
        <div
          style={{
            fontSize: '22px',
            color: '#5ba69f',
            marginBottom: '20px',
          }}
        >
          {`@${username}`}
        </div>

        {/* Bio */}
        {truncatedBio && (
          <div
            style={{
              fontSize: '18px',
              color: '#968778',
              maxWidth: '600px',
              textAlign: 'center',
              lineHeight: 1.5,
              marginBottom: '24px',
            }}
          >
            {truncatedBio}
          </div>
        )}

        {/* Stats */}
        {projectCount > 0 && (
          <div
            style={{
              fontSize: '16px',
              color: '#6b5e52',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {`${projectCount} published work${projectCount !== 1 ? 's' : ''}`}
          </div>
        )}

        {/* Bobbinry branding */}
        <div
          style={{
            position: 'absolute',
            bottom: '32px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              background: '#33706b',
              color: '#faf8f4',
              fontSize: '16px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            B
          </div>
          <div
            style={{
              fontSize: '16px',
              color: '#6b5e52',
            }}
          >
            Bobbinry
          </div>
        </div>
      </div>
    ),
    { ...size }
  )
}
