import Link from 'next/link'

const GITHUB_REPO = 'https://github.com/stridera/Bobbinry'
const GUIDE_URL = `${GITHUB_REPO}/blob/main/docs/BOBBIN_DEVELOPMENT_GUIDE.md`

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Nav */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link
            href="/"
            className="font-display text-lg font-bold text-gray-900 dark:text-gray-100 tracking-tight"
          >
            Bobbinry
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/bobbins"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              Bobbins
            </Link>
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        {/* Hero */}
        <section className="mb-16">
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
            Build Your Own Bobbin
          </h1>
          <p className="mt-4 text-lg text-gray-600 dark:text-gray-400 max-w-2xl leading-relaxed">
            Bobbins are reviewed native packages that extend the Bobbinry shell. The developer guide is the source of truth for manifests, panels, notifications, actions, and external integrations.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href={GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
            >
              Open Developer Guide
            </a>
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              View on GitHub
            </a>
            <a
              href={`${GITHUB_REPO}/issues`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
            >
              Report an Issue
            </a>
          </div>
        </section>

        {/* Getting Started */}
        <section className="mb-14">
          <h2 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Getting Started</h2>
          <div className="prose-section">
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              You&apos;ll need <a href="https://bun.sh" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Bun</a> installed. Then clone the repo and scaffold a new bobbin:
            </p>
            <pre className="bg-gray-900 dark:bg-gray-800 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto mb-4">
              <code>{`git clone ${GITHUB_REPO}.git
cd Bobbinry
bun install

# Scaffold a new bobbin
node scripts/create-bobbin.js`}</code>
            </pre>
            <p className="text-gray-600 dark:text-gray-400">
              The scaffold script will create a new directory under <code className="text-sm bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">bobbins/</code> with the manifest, package.json, and starter view files.
            </p>
          </div>
        </section>

        {/* Bobbin Structure */}
        <section className="mb-14">
          <h2 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Bobbin Structure</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Every bobbin lives in its own directory with this layout:
          </p>
          <pre className="bg-gray-900 dark:bg-gray-800 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto mb-4">
            <code>{`bobbins/my-bobbin/
├── manifest.yaml       # Bobbin configuration & metadata
├── package.json        # Dependencies
├── tsconfig.json       # TypeScript config
├── src/
│   ├── index.ts        # Entry point
│   ├── views/          # React views (native mode)
│   └── panels/         # React panels (native mode)
└── dist/
    └── views/          # Native React views`}</code>
          </pre>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            The <code className="text-sm bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">manifest.yaml</code> defines your bobbin&apos;s identity, data collections, and UI views:
          </p>
          <pre className="bg-gray-900 dark:bg-gray-800 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
            <code>{`id: my-bobbin
name: My Bobbin
version: 1.0.0
author: Your Name
description: What this bobbin does
capabilities:
  customViews: true
data:
  collections:
    - name: MyEntity
      fields:
        - { name: title, type: text, required: true }
        - { name: content, type: markdown }

ui:
  views:
    - id: my-view
      name: My View
      type: editor
      source: MyEntity`}</code>
          </pre>
        </section>

        {/* Key Concepts */}
        <section className="mb-14">
          <h2 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Key Concepts</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                title: 'Collections',
                description: 'Data models defined in your manifest. Each collection gets its own database table with the fields you specify. Supports text, markdown, number, boolean, and relation types.',
              },
              {
                title: 'Views',
                description: 'UI components that render inside the Bobbinry workspace. Can be editors, lists, boards, or any custom layout. Each view connects to a collection.',
              },
              {
                title: 'Execution Modes',
                description: 'Bobbins are native-only. Use the existing panel and view patterns as the baseline for new bobbins.',
              },
              {
                title: 'Panels & Notifications',
                description: 'Use shell slots for panels, SDK helpers for shell notifications, and inline panel state for local success and error messaging.',
              },
            ].map((concept) => (
              <div
                key={concept.title}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5"
              >
                <h3 className="font-display font-semibold text-gray-900 dark:text-gray-100 mb-1.5">{concept.title}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{concept.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* SDK Quick Reference */}
        <section className="mb-14">
          <h2 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">SDK Quick Reference</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Native views receive a <code className="text-sm bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">BobbinrySDK</code> instance as a prop. Core APIs:
          </p>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-900 dark:text-gray-100">Method</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-900 dark:text-gray-100">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {[
                  ['sdk.setProject(id)', 'Set the active project context'],
                  ['sdk.entities.query({ collection, limit, sort })', 'Query entities from a collection'],
                  ['sdk.entities.get(collection, id)', 'Get a single entity by ID'],
                  ['sdk.entities.create(collection, data)', 'Create a new entity'],
                  ['sdk.entities.update(collection, id, data)', 'Update an existing entity'],
                  ['sdk.entities.delete(collection, id)', 'Delete an entity'],
                ].map(([method, desc]) => (
                  <tr key={method}>
                    <td className="px-4 py-2.5 font-mono text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">{method}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-gray-500 dark:text-gray-500 text-sm mt-3">
            For cross-bobbin coordination, prefer the SDK helpers such as <code className="text-sm bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">useMessageBus()</code> and <code className="text-sm bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">sdk.messageBus.send()</code>.
          </p>
        </section>

        {/* Example */}
        <section className="mb-14">
          <h2 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Example: A Simple View</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Here&apos;s a minimal native view that lists and creates entities:
          </p>
          <pre className="bg-gray-900 dark:bg-gray-800 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
            <code>{`import { useState, useEffect } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

export default function NotesView({ sdk, projectId }: {
  sdk: BobbinrySDK
  projectId: string
}) {
  const [notes, setNotes] = useState([])

  useEffect(() => {
    sdk.setProject(projectId)
    sdk.entities.query({ collection: 'notes', limit: 50 })
      .then(res => setNotes(res.data))
  }, [projectId])

  const addNote = async () => {
    const note = await sdk.entities.create('notes', {
      title: 'New Note',
      content: ''
    })
    setNotes(prev => [...prev, note])
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <header className="flex items-center justify-between border-b
        border-gray-200 dark:border-gray-700 p-4">
        <h1 className="font-semibold text-gray-900 dark:text-gray-100">
          Notes
        </h1>
        <button onClick={addNote}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white
            rounded-md hover:bg-blue-700">
          Add Note
        </button>
      </header>
      <ul className="flex-1 overflow-auto divide-y
        divide-gray-100 dark:divide-gray-800">
        {notes.map(note => (
          <li key={note.id} className="px-4 py-3
            text-gray-700 dark:text-gray-300">
            {note.title}
          </li>
        ))}
      </ul>
    </div>
  )
}`}</code>
          </pre>
        </section>

        {/* API Access */}
        <section className="mb-14">
          <h2 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">API Access</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Bobbinry provides a REST API for programmatic read-only access to your projects, entities, stats, and profile.
            Authenticate with a personal API key using a Bearer token.
          </p>

          <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Getting an API Key</h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Generate an API key from your{' '}
            <Link href="/settings/api-keys" className="text-blue-600 dark:text-blue-400 hover:underline">
              API Keys settings
            </Link>
            . Each key is scoped to specific permissions and can optionally have an expiration date.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {[
              { scope: 'projects:read', description: 'Read your projects and their settings' },
              { scope: 'entities:read', description: 'Read entities across your collections' },
              { scope: 'stats:read', description: 'Read dashboard stats and recent activity' },
              { scope: 'profile:read', description: 'Read your profile information' },
            ].map((s) => (
              <div
                key={s.scope}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-3"
              >
                <code className="text-xs font-mono text-blue-600 dark:text-blue-400">{s.scope}</code>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{s.description}</p>
              </div>
            ))}
          </div>

          <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Making Requests</h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Pass your key in the <code className="text-sm bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">Authorization</code> header:
          </p>
          <pre className="bg-gray-900 dark:bg-gray-800 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto mb-4">
            <code>{`curl -H "Authorization: Bearer bby_..." \\
  https://api.bobbinry.com/api/projects`}</code>
          </pre>

          <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Available Endpoints</h3>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-900 dark:text-gray-100">Endpoint</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-900 dark:text-gray-100">Scope</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-900 dark:text-gray-100">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {[
                  ['GET /api/projects', 'projects:read', 'List your projects'],
                  ['GET /api/projects/:projectId', 'projects:read', 'Get a single project'],
                  ['GET /api/collections/:collection/entities', 'entities:read', 'Query entities in a collection'],
                  ['GET /api/entities/:entityId', 'entities:read', 'Get a single entity'],
                  ['GET /api/dashboard/stats', 'stats:read', 'Dashboard stats and recent activity'],
                  ['GET /api/auth/session', 'profile:read', 'Your session and profile information'],
                ].map(([endpoint, scope, desc]) => (
                  <tr key={endpoint}>
                    <td className="px-4 py-2.5 font-mono text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">{endpoint}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{scope}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Links */}
        <section className="mb-8">
          <h2 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Resources</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: 'GitHub Repository', href: GITHUB_REPO, external: true },
              { label: 'Report an Issue', href: `${GITHUB_REPO}/issues`, external: true },
              { label: 'Browse Existing Bobbins', href: '/bobbins', external: false },
              { label: 'Manage API Keys', href: '/settings/api-keys', external: false },
            ].map((link) => (
              <a
                key={link.label}
                href={link.href}
                target={link.external ? '_blank' : undefined}
                rel={link.external ? 'noopener noreferrer' : undefined}
                className="flex items-center justify-between bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:border-blue-300 dark:hover:border-blue-700 transition-colors group"
              >
                {link.label}
                <svg
                  className="w-4 h-4 text-gray-400 dark:text-gray-500 group-hover:text-blue-500 transition-colors"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </a>
            ))}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-3">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Study these bobbins:</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">bobbins/manuscript/</code>{' '}
                <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">bobbins/corkboard/</code>{' '}
                <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">bobbins/dictionary-panel/</code>
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-6">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-center justify-between text-sm text-gray-400 dark:text-gray-500">
          <Link href="/" className="font-display font-semibold hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            Bobbinry
          </Link>
          <a
            href={GITHUB_REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  )
}
