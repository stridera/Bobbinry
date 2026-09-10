import type { Metadata } from 'next'
import Link from 'next/link'

const BASE_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://bobbinry.com'
const GITHUB_DISCUSSIONS = 'https://github.com/stridera/Bobbinry/discussions'
const LAST_UPDATED = 'September 10, 2026'
const DESCRIPTION =
  'How Bobbinry handles AI: none on your work today, strict rules for any AI feature we add, and no training on your writing.'

export const metadata: Metadata = {
  title: 'AI Policy | Bobbinry',
  description: DESCRIPTION,
  openGraph: {
    title: 'AI at Bobbinry',
    description: DESCRIPTION,
    url: `${BASE_URL}/ai-policy`,
  },
}

const AT_A_GLANCE = [
  'No AI runs on your work today',
  'Any AI feature stays off until you turn it on',
  'AI will never write your book',
  'We never train on your writing',
]

// Every claim here must stay true of the code. "No AI runs on your work today"
// holds while bobbins/ai-tools stays `visibility: none`; update this page before
// opening it or shipping any AI feature. Robots rules live in ../robots.ts.
const SECTIONS: { title: string; body: string[]; list?: string[] }[] = [
  {
    title: 'No AI runs on your work today',
    body: [
      'Nothing Bobbinry runs uses AI on your writing: not the editor, not your codex, not publishing.',
      'Read-aloud uses the voices built into your own browser or device.',
    ],
  },
  {
    title: 'Rules for any AI feature we add',
    body: ['If we add AI features, or allow bobbins that use AI, every one of them must follow these rules:'],
    list: [
      'Off until you turn it on, one project at a time. Never on by default.',
      'You start it. Anything that would run automatically needs your OK for that project first.',
      'It never writes your book. Suggestions, feedback and analysis only; nothing goes into your chapter text unless you put it there yourself.',
      "It's labeled. Anything an AI tool adds to your project is marked as AI-made, and any bobbin that uses AI is marked in the bobbin directory.",
      "Only what's needed goes out. Your writing is sent only to the AI service doing the work, and only to services whose terms don't allow training on it.",
      'Readers never see AI output unless you publish it.',
    ],
  },
  {
    title: "We don't train on your writing",
    body: [
      "Bobbinry doesn't train AI models on your work, and we don't sell or license your writing to anyone who does.",
    ],
  },
  {
    title: 'Your published chapters and AI crawlers',
    body: [
      'Our robots.txt asks AI-training crawlers from OpenAI, Anthropic, Common Crawl, Google, Apple, ByteDance and Meta to stay away from Bobbinry, including your published chapters.',
      "Reputable crawlers honor that. It's a request rather than a lock, so it can't stop a crawler that ignores the rules. It doesn't affect ordinary search engines, so readers can still find your work.",
    ],
  },
  {
    title: 'Tools you connect with an API key',
    body: [
      'If you give a Bobbinry API key to another tool, such as a Discord bot, that tool acts on your behalf under its own terms. This policy covers Bobbinry itself.',
    ],
  },
  {
    title: 'If this changes',
    body: [
      "We'll update this page and its date before anything here changes, including before any AI feature launches.",
    ],
  },
]

export default function AiPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Nav */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link
            href="/"
            className="font-display text-lg font-bold text-gray-900 dark:text-gray-100 tracking-tight"
          >
            Bobbinry
          </Link>
          <Link
            href="/explore"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            Explore
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        {/* Hero */}
        <section className="mb-10">
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
            AI at Bobbinry
          </h1>
          <p className="mt-4 text-lg text-gray-600 dark:text-gray-400 leading-relaxed">
            Bobbinry is built by and for writers. Today it runs no AI on your work at all. This page is our promise to keep it that way unless you choose otherwise, and the rules any AI feature must follow if we ever add one.
          </p>
          <p className="mt-3 text-sm text-gray-400 dark:text-gray-500">Last updated {LAST_UPDATED}</p>
        </section>

        {/* At a glance */}
        <section className="mb-12 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <ul className="grid gap-3 sm:grid-cols-2">
            {AT_A_GLANCE.map(item => (
              <li key={item} className="flex items-start gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                <span aria-hidden="true" className="text-green-600 dark:text-green-400">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* Commitments */}
        <div className="space-y-10">
          {SECTIONS.map(section => (
            <section key={section.title}>
              <h2 className="font-display text-xl font-semibold text-gray-900 dark:text-gray-100">
                {section.title}
              </h2>
              {section.body.map(paragraph => (
                <p key={paragraph} className="mt-3 text-gray-600 dark:text-gray-400 leading-relaxed">
                  {paragraph}
                </p>
              ))}
              {section.list && (
                <ul className="mt-3 list-disc pl-5 space-y-2 text-gray-600 dark:text-gray-400 leading-relaxed">
                  {section.list.map(item => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <p className="mt-14 text-sm text-gray-500 dark:text-gray-400">
          Questions?{' '}
          <a
            href={GITHUB_DISCUSSIONS}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            Start a discussion on GitHub
          </a>
          .
        </p>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-6">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 flex items-center justify-between text-sm text-gray-400 dark:text-gray-500">
          <Link href="/" className="font-display font-semibold hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            Bobbinry
          </Link>
          <Link href="/docs" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            Developers
          </Link>
        </div>
      </footer>
    </div>
  )
}
