import { ImageResponse } from 'next/og'
import { config } from '@/lib/config'

export const runtime = 'edge'

export const alt = 'Project on Bobbinry'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({
  params,
}: {
  params: { authorUsername: string; projectSlug: string }
}) {
  const { authorUsername, projectSlug } = await params

  let projectName = 'Untitled Project'
  let description: string | null = null
  let authorName = authorUsername
  let coverImage: string | null = null

  try {
    const res = await fetch(
      `${config.apiUrl}/api/public/projects/by-author-and-slug/${encodeURIComponent(authorUsername)}/${encodeURIComponent(projectSlug)}`
    )
    if (res.ok) {
      const data = await res.json()
      projectName = data.project?.name || projectName
      description = data.project?.description || null
      authorName =
        data.author?.displayName ||
        data.author?.userName ||
        data.author?.username ||
        authorUsername
      coverImage = data.project?.coverImage || null
    }
  } catch {
    // Fall through to defaults
  }

  const truncatedDesc = description
    ? description.length > 160
      ? description.slice(0, 157) + '...'
      : description
    : null

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
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

        {/* Content area */}
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            padding: '60px',
            gap: '48px',
          }}
        >
          {/* Cover image or placeholder */}
          {coverImage ? (
            <img
              src={coverImage}
              alt=""
              width={280}
              height={400}
              style={{
                width: '280px',
                height: '400px',
                objectFit: 'cover',
                borderRadius: '12px',
                flexShrink: 0,
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}
            />
          ) : (
            <div
              style={{
                width: '280px',
                height: '400px',
                borderRadius: '12px',
                flexShrink: 0,
                background: 'linear-gradient(135deg, #2a2725 0%, #33706b 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                border: '1px solid rgba(91, 166, 159, 0.2)',
              }}
            >
              <div
                style={{
                  fontSize: '80px',
                  color: 'rgba(91, 166, 159, 0.4)',
                  fontWeight: 700,
                }}
              >
                B
              </div>
            </div>
          )}

          {/* Text content */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              flex: 1,
              minWidth: 0,
            }}
          >
            {/* Project title */}
            <div
              style={{
                fontSize: projectName.length > 40 ? '40px' : '52px',
                fontWeight: 700,
                color: '#f3ede5',
                letterSpacing: '-1.5px',
                lineHeight: 1.1,
                marginBottom: '16px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {projectName}
            </div>

            {/* Author */}
            <div
              style={{
                display: 'flex',
                fontSize: '22px',
                color: '#5ba69f',
                marginBottom: '24px',
              }}
            >
              {`by ${authorName}`}
            </div>

            {/* Description */}
            {truncatedDesc && (
              <div
                style={{
                  fontSize: '18px',
                  color: '#968778',
                  lineHeight: 1.5,
                  maxWidth: '500px',
                }}
              >
                {truncatedDesc}
              </div>
            )}

            {/* Bobbinry branding */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginTop: 'auto',
                paddingTop: '24px',
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
        </div>
      </div>
    ),
    { ...size }
  )
}
