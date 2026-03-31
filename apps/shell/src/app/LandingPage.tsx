'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'

const PILLARS = [
  {
    title: 'Write',
    description: 'A distraction-free editor with modular tools. Outline chapters, organize scenes, build worlds — all in one workspace.',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="icon-write" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        <path fill="url(#icon-write)" d="M21.731 2.269a2.625 2.625 0 00-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 000-3.712zM19.513 8.199l-3.712-3.712-8.4 8.4a5.25 5.25 0 00-1.32 2.214l-.8 2.685a.75.75 0 00.933.933l2.685-.8a5.25 5.25 0 002.214-1.32l8.4-8.4z" />
        <path fill="url(#icon-write)" d="M5.25 5.25a3 3 0 00-3 3v10.5a3 3 0 003 3h10.5a3 3 0 003-3V13.5a.75.75 0 00-1.5 0v5.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5V8.25a1.5 1.5 0 011.5-1.5h5.25a.75.75 0 000-1.5H5.25z" />
      </svg>
    ),
    delay: '0s',
  },
  {
    title: 'Publish',
    description: 'Share your work with the world. Publish chapters, build an audience, and offer subscriptions — your writing, your terms.',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="icon-publish" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <path fill="url(#icon-publish)" d="M11.25 4.533A9.707 9.707 0 006 3a9.735 9.735 0 00-3.25.555.75.75 0 00-.5.707v14.25a.75.75 0 001 .707A8.237 8.237 0 016 18.75c1.995 0 3.823.707 5.25 1.886V4.533zM12.75 20.636A8.214 8.214 0 0118 18.75c.966 0 1.89.166 2.75.47a.75.75 0 001-.708V4.262a.75.75 0 00-.5-.707A9.735 9.735 0 0018 3a9.707 9.707 0 00-5.25 1.533v16.103z" />
      </svg>
    ),
    delay: '0.15s',
  },
  {
    title: 'Read',
    description: 'Discover stories from a growing community. Follow authors, track your reading progress, and support the writers you love.',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="icon-read" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <path fill="url(#icon-read)" d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
        <path fill="url(#icon-read)" fillRule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 010-1.113zM17.25 12a5.25 5.25 0 11-10.5 0 5.25 5.25 0 0110.5 0z" clipRule="evenodd" />
      </svg>
    ),
    delay: '0.3s',
  },
]

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry && entry.isIntersecting) {
          el.classList.add('animate-fade-in-up')
          observer.disconnect()
        }
      },
      { threshold: 0.15 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return ref
}

export function LandingPage() {
  const pillarsRef = useScrollReveal()
  const bobbinsRef = useScrollReveal()
  const ctaRef = useScrollReveal()

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
              href="/bobbins"
              className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors hidden sm:block"
            >
              Bobbins
            </Link>
            <Link
              href="/login"
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950 rounded-lg transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950 active:scale-[0.97] transition-all"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-28 pb-16 sm:pt-40 sm:pb-28">
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
              className="px-8 py-3 text-base font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-600/20 hover:shadow-blue-600/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950 active:scale-[0.97] transition-all"
            >
              Start Writing — Free
            </Link>
            <Link
              href="/explore"
              className="px-8 py-3 text-base font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-gray-300 dark:hover:border-gray-600 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950 active:scale-[0.97] transition-all"
            >
              Explore Stories
            </Link>
          </div>
        </div>
      </section>

      {/* Three Pillars */}
      <section className="py-20 sm:py-28">
        <div ref={pillarsRef} className="max-w-5xl mx-auto px-4 sm:px-6 opacity-0">
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
        <div ref={bobbinsRef} className="max-w-4xl mx-auto px-4 sm:px-6 opacity-0">
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
                href="/bobbins"
                className="inline-flex items-center gap-2 mt-6 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                Browse Bobbins
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </div>

            {/* Decorative bobbin cards */}
            <div className="relative">
              <div className="space-y-3">
                {[
                  { name: 'Manuscript', desc: 'Books, chapters, and scenes', color: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800', hoverColor: 'hover:border-blue-400 dark:hover:border-blue-600', icon: '📖' },
                  { name: 'Corkboard', desc: 'Drag-and-drop scene organization', color: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800', hoverColor: 'hover:border-purple-400 dark:hover:border-purple-600', icon: '📌' },
                  { name: 'Dictionary', desc: 'Worldbuilding glossary', color: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800', hoverColor: 'hover:border-green-400 dark:hover:border-green-600', icon: '📚' },
                ].map((bobbin, i) => (
                  <div
                    key={bobbin.name}
                    className={`${bobbin.color} ${bobbin.hoverColor} border rounded-xl p-4 animate-fade-in-up cursor-default hover:shadow-md hover:-translate-y-0.5 transition-all duration-200`}
                    style={{ animationDelay: `${0.1 * (i + 1)}s` }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg" aria-hidden="true">{bobbin.icon}</span>
                      <span className="font-display font-semibold text-gray-900 dark:text-gray-100">{bobbin.name}</span>
                    </div>
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
        <div ref={ctaRef} className="max-w-3xl mx-auto px-4 sm:px-6 text-center opacity-0">
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
            Ready to start your story?
          </h2>
          <p className="mt-4 text-gray-600 dark:text-gray-400 text-lg">
            Join Bobbinry and bring your writing to life — for free.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/signup"
              className="px-8 py-3 text-base font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-600/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950 active:scale-[0.97] transition-all"
            >
              Create Your Account
            </Link>
            <Link
              href="/explore"
              className="px-8 py-3 text-base font-semibold text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950 rounded-xl transition-colors"
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
            <Link href="/bobbins" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Bobbins</Link>
            <Link href="/docs" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Developers</Link>
            <Link href="/login" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
