import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const alt = 'Bobbinry — Where stories come to life'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
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
          background: 'linear-gradient(145deg, #1a1917 0%, #231f1b 40%, #1a2423 100%)',
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

        {/* Logo mark */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '72px',
            height: '72px',
            borderRadius: '16px',
            background: '#33706b',
            color: '#faf8f4',
            fontSize: '40px',
            fontWeight: 700,
            marginBottom: '32px',
            letterSpacing: '-1px',
          }}
        >
          B
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: '64px',
            fontWeight: 700,
            color: '#f3ede5',
            letterSpacing: '-2px',
            marginBottom: '12px',
          }}
        >
          Bobbinry
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: '26px',
            color: '#5ba69f',
            fontStyle: 'italic',
            marginBottom: '40px',
          }}
        >
          Where stories come to life
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: '18px',
            color: '#968778',
            maxWidth: '500px',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          A modular platform for writers and worldbuilders
        </div>
      </div>
    ),
    { ...size }
  )
}
