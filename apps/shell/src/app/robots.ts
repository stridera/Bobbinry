import type { MetadataRoute } from 'next'

// Promised on /ai-policy; keep the two in sync. Each token is separate from its
// company's search crawler (Google-Extended vs Googlebot, Applebot-Extended vs
// Applebot), so blocking these doesn't affect search.
const AI_TRAINING_CRAWLERS = [
  'GPTBot',
  'ClaudeBot',
  'anthropic-ai',
  'CCBot',
  'Google-Extended',
  'Applebot-Extended',
  'Bytespider',
  'meta-externalagent',
]

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://bobbinry.com'

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/dashboard/',
          '/projects/',
          '/settings/',
          '/admin/',
          '/library/',
          '/membership/',
          '/backups/',
          '/publish/',
          '/api/',
        ],
      },
      {
        userAgent: AI_TRAINING_CRAWLERS,
        disallow: '/',
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
