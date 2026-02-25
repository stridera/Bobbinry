'use client'

import Link from 'next/link'

const PILLARS = [
  {
    title: 'Write',
    description: 'A distraction-free editor with modular tools. Outline chapters, organize scenes, build worlds — all in one workspace.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
    delay: '0s',
  },
  {
    title: 'Publish',
    description: 'Share your work with the world. Publish chapters, build an audience, and offer subscriptions — your writing, your terms.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
    delay: '0.15s',
  },
  {
    title: 'Read',
    description: 'Discover stories from a growing community. Follow authors, track your reading progress, and support the writers you love.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    ),
    delay: '0.3s',
  },
]

export function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
      {/* Top bar */}
      <header className="absolute top-0 inset-x-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <span className="font-display text-xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
            Bobbinry
          </span>
          <div className="flex items-center gap-3">
            <Link
              href="/explore"
              className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors hidden sm:block"
            >
              Explore
            </Link>
            <Link
              href="/marketplace"
              className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors hidden sm:block"
            >
              Bobbins
            </Link>
            <Link
              href="/login"
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28">
        {/* Background gradient */}
        <div
          className="absolute inset-0 animate-gradient-shift opacity-30 dark:opacity-20"
          style={{
            background: 'linear-gradient(135deg, #f0f7f6 0%, #fdf8ef 25%, #f4f7f0 50%, #f0f7f6 75%, #fdf8ef 100%)',
          }}
        />
        <div
          className="absolute inset-0 animate-gradient-shift opacity-0 dark:opacity-20"
          style={{
            background: 'linear-gradient(135deg, #112323 0%, #3c1c0d 25%, #172012 50%, #112323 75%, #3c1c0d 100%)',
          }}
        />

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-bold text-gray-900 dark:text-gray-100 tracking-tight leading-[1.1] animate-fade-in-up">
            Where stories
            <span className="block text-blue-600 dark:text-blue-400">come to life</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
            A modular platform for writers and worldbuilders. Write with powerful tools, publish on your terms, and find your audience.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
            <Link
              href="/signup"
              className="px-8 py-3 text-base font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-600/20 hover:shadow-blue-600/30 transition-all"
            >
              Start Writing — Free
            </Link>
            <Link
              href="/explore"
              className="px-8 py-3 text-base font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-gray-300 dark:hover:border-gray-600 shadow-sm transition-all"
            >
              Explore Stories
            </Link>
          </div>
        </div>
      </section>

      {/* Three Pillars */}
      <section className="py-20 sm:py-28">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
              One platform, three pillars
            </h2>
            <p className="mt-3 text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
              Everything you need to go from first draft to published work — and build a readership along the way.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PILLARS.map((pillar) => (
              <div
                key={pillar.title}
                className="group relative bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-8 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-lg transition-all animate-fade-in-up"
                style={{ animationDelay: pillar.delay }}
              >
                <div className="w-14 h-14 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-5 group-hover:scale-110 transition-transform">
                  {pillar.icon}
                </div>
                <h3 className="font-display text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                  {pillar.title}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  {pillar.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Powered by Bobbins */}
      <section className="py-20 sm:py-28 bg-white dark:bg-gray-900 border-y border-gray-200 dark:border-gray-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div className="animate-slide-in-left">
              <span className="text-xs font-semibold tracking-widest uppercase text-blue-600 dark:text-blue-400">Modular by design</span>
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100 tracking-tight mt-3">
                Powered by Bobbins
              </h2>
              <p className="mt-4 text-gray-600 dark:text-gray-400 leading-relaxed">
                Bobbins are installable modules that extend your workspace. Add a manuscript editor, a corkboard for scenes, a glossary for your world, or build your own.
              </p>
              <p className="mt-3 text-gray-600 dark:text-gray-400 leading-relaxed">
                Every workspace is different because every writer is different. Install only what you need.
              </p>
              <Link
                href="/marketplace"
                className="inline-flex items-center gap-2 mt-6 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                Browse the Marketplace
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </div>

            {/* Decorative bobbin cards */}
            <div className="relative">
              <div className="space-y-3">
                {[
                  { name: 'Manuscript', desc: 'Books, chapters, and scenes', color: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800' },
                  { name: 'Corkboard', desc: 'Drag-and-drop scene organization', color: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800' },
                  { name: 'Dictionary', desc: 'Worldbuilding glossary', color: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800' },
                ].map((bobbin, i) => (
                  <div
                    key={bobbin.name}
                    className={`${bobbin.color} border rounded-xl p-4 animate-fade-in-up`}
                    style={{ animationDelay: `${0.1 * (i + 1)}s` }}
                  >
                    <div className="font-display font-semibold text-gray-900 dark:text-gray-100">{bobbin.name}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{bobbin.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 sm:py-28">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
            Ready to start your story?
          </h2>
          <p className="mt-4 text-gray-600 dark:text-gray-400 text-lg">
            Join Bobbinry and bring your writing to life — for free.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/signup"
              className="px-8 py-3 text-base font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-600/20 transition-all"
            >
              Create Your Account
            </Link>
            <Link
              href="/explore"
              className="px-8 py-3 text-base font-semibold text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              Or start reading
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="font-display text-sm font-semibold text-gray-400 dark:text-gray-500">
            Bobbinry
          </span>
          <div className="flex items-center gap-6 text-sm text-gray-400 dark:text-gray-500">
            <Link href="/explore" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Explore</Link>
            <Link href="/marketplace" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Marketplace</Link>
            <Link href="/login" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
