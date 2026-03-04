'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { SiteNav } from '@/components/SiteNav'
import { SkeletonPanel } from '@/components/LoadingState'
import { OptimizedImage } from '@/components/OptimizedImage'

interface ProfileForm {
  username: string
  displayName: string
  bio: string
  avatarUrl: string
  websiteUrl: string
  blueskyHandle: string
  threadsHandle: string
  instagramHandle: string
  discordHandle: string
}

function validateUsername(username: string): string | null {
  if (!username) return null // empty is fine (optional)
  if (username.length < 3 || username.length > 30) return 'Username must be between 3 and 30 characters'
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(username)) return 'Must start with a letter. Only letters, numbers, hyphens, and underscores allowed.'
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(username)) return 'Username cannot look like an ID'
  const reserved = ['admin', 'api', 'read', 'explore', 'dashboard', 'settings', 'publish', 'login', 'signup', 'marketplace', 'bobbins', 'library', 'u', 'auth']
  if (reserved.includes(username.toLowerCase())) return 'This username is reserved'
  return null
}

// Social platform icon components
function BlueskyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.785 2.643 3.593 3.512 6.137 3.045-3.894.695-7.39 2.373-2.882 8.381C8.882 28.227 16.146 18.08 12 10.8zm0 0c1.087-2.114 4.046-6.053 6.798-7.995C21.434.944 22.439 1.266 23.098 1.565 23.861 1.908 24 3.08 24 3.768c0 .69-.378 5.65-.624 6.479-.785 2.643-3.593 3.512-6.137 3.045 3.894.695 7.39 2.373 2.882 8.381C15.118 28.227 7.854 18.08 12 10.8z" />
    </svg>
  )
}

function ThreadsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.186 24h-.007C5.965 23.97 2.634 20.273 2.634 14.618c0-5.986 3.632-9.384 9.552-9.384 4.607 0 7.623 2.368 8.608 6.392l-2.832.728c-.676-2.786-2.574-4.32-5.776-4.32-4.078 0-6.315 2.666-6.315 6.584 0 4.088 2.218 6.67 6.315 6.67 2.1 0 3.722-.578 4.69-1.672.89-1.007 1.323-2.395 1.287-4.128-.297.157-.615.296-.955.414-.86.3-1.8.45-2.794.45-4.378 0-6.56-2.17-6.2-5.536.24-2.244 1.762-4.39 5.356-4.39 2.505 0 4.23 1.258 4.752 3.466l.016.068c.126.587.192 1.224.192 1.904 0 3.32-.835 5.782-2.415 7.113C14.764 23.36 13.5 24 12.186 24zm1.638-11.164c-.983 0-2.175.45-2.335 1.946-.178 1.664.892 2.705 3.007 2.705.625 0 1.19-.088 1.695-.262.067-.556.098-1.14.098-1.743 0-.422-.033-.818-.097-1.186-.322-1.176-1.263-1.46-2.368-1.46z" />
    </svg>
  )
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
    </svg>
  )
}

// Reusable input with optional leading icon
function SocialInput({
  icon,
  label,
  value,
  onChange,
  placeholder,
}: {
  icon: React.ReactNode
  label: string
  value: string
  onChange: (val: string) => void
  placeholder: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none">
          {icon}
        </div>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const { data: session, status, update: updateSession } = useSession()
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [profile, setProfile] = useState<ProfileForm>({
    username: '',
    displayName: '',
    bio: '',
    avatarUrl: '',
    websiteUrl: '',
    blueskyHandle: '',
    threadsHandle: '',
    instagramHandle: '',
    discordHandle: ''
  })

  useEffect(() => {
    if (session?.user?.id && session?.apiToken) {
      loadProfile()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, session?.apiToken])

  const loadProfile = async () => {
    if (!session?.apiToken || !session?.user?.id) return
    try {
      const res = await apiFetch(`/api/users/${session.user.id}/profile`, session.apiToken)
      if (res.ok) {
        const data = await res.json()
        const p = data.profile
        setProfile({
          username: p.username || '',
          displayName: p.displayName || '',
          bio: p.bio || '',
          avatarUrl: p.avatarUrl || '',
          websiteUrl: p.websiteUrl || '',
          blueskyHandle: p.blueskyHandle || '',
          threadsHandle: p.threadsHandle || '',
          instagramHandle: p.instagramHandle || '',
          discordHandle: p.discordHandle || ''
        })
      }
    } catch (err) {
      console.error('Failed to load profile:', err)
    } finally {
      setProfileLoaded(true)
    }
  }

  const usernameError = validateUsername(profile.username)

  const handleAvatarUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/') || !session?.apiToken) return
    setUploadingAvatar(true)
    setProfileError(null)
    try {
      const presignRes = await apiFetch('/api/uploads/presign', session.apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size, context: 'avatar' })
      })
      if (!presignRes.ok) {
        const errBody = await presignRes.json().catch(() => ({}))
        throw new Error(errBody.error || `Presign failed (${presignRes.status})`)
      }
      const { uploadUrl, fileKey } = await presignRes.json()
      const putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`)
      const confirmRes = await apiFetch('/api/uploads/confirm', session.apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey, filename: file.name, contentType: file.type, size: file.size, context: 'avatar' })
      })
      if (!confirmRes.ok) {
        const errBody = await confirmRes.json().catch(() => ({}))
        throw new Error(errBody.error || `Confirm failed (${confirmRes.status})`)
      }
      const { url } = await confirmRes.json()
      setProfile(p => ({ ...p, avatarUrl: url }))
    } catch (err) {
      console.error('Avatar upload failed:', err)
      setProfileError(err instanceof Error ? err.message : 'Avatar upload failed')
    } finally {
      setUploadingAvatar(false)
    }
  }, [session?.apiToken])

  const saveProfile = async () => {
    if (!session?.apiToken || !session?.user?.id) return
    if (usernameError) {
      setProfileError(usernameError)
      return
    }
    setSaving(true)
    setProfileError(null)
    setSuccess(null)
    try {
      const res = await apiFetch(`/api/users/${session.user.id}/profile`, session.apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
      })
      if (res.ok) {
        // Update session so the display name is reflected everywhere
        if (profile.displayName) {
          await updateSession({ name: profile.displayName })
        }
        setSuccess('Profile saved successfully!')
        setTimeout(() => setSuccess(null), 3000)
      } else {
        const data = await res.json().catch(() => ({}))
        setProfileError(data.error || 'Failed to save profile')
      }
    } catch {
      setProfileError('Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="h-7 bg-gray-100 dark:bg-gray-700 rounded w-36 animate-pulse" />
          </div>
        </header>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <SkeletonPanel />
          <SkeletonPanel />
        </div>
      </div>
    )
  }

  if (!session?.user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      {/* Sub-header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">User Settings</h1>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-fade-in">
        {/* Success/Error messages */}
        {success && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <p className="text-sm text-green-700 dark:text-green-300">{success}</p>
          </div>
        )}
        {profileError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-700 dark:text-red-300">{profileError}</p>
          </div>
        )}

        {/* Account Information */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Account Information</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Name
              </label>
              <input
                type="text"
                value={session.user.name || ''}
                disabled
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg cursor-not-allowed opacity-60"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={session.user.email || ''}
                disabled
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg cursor-not-allowed opacity-60"
              />
            </div>
          </div>
        </div>

        {/* Public Profile */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Public Profile</h2>
            {profile.username && (
              <Link
                href={`/u/${profile.username}`}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                View profile &rarr;
              </Link>
            )}
          </div>

          {!profileLoaded ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading profile...</p>
          ) : (
            <div className="space-y-6">
              {/* Identity */}
              <div className="flex gap-6">
                {/* Avatar */}
                <div className="flex-shrink-0">
                  <div className="relative w-24 h-24 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700 group">
                    {profile.avatarUrl ? (
                      <OptimizedImage
                        src={profile.avatarUrl}
                        variant="thumb"
                        alt="Avatar"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500">
                        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-center gap-1 mt-2">
                    <label className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors cursor-pointer">
                      {uploadingAvatar ? 'Uploading...' : profile.avatarUrl ? 'Change' : 'Upload'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        disabled={uploadingAvatar}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleAvatarUpload(file)
                          e.target.value = ''
                        }}
                      />
                    </label>
                    {profile.avatarUrl && (
                      <button
                        type="button"
                        onClick={() => setProfile(p => ({ ...p, avatarUrl: '' }))}
                        className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors cursor-pointer"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {/* Name fields */}
                <div className="flex-1 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        Username
                      </label>
                      <input
                        type="text"
                        value={profile.username}
                        onChange={e => setProfile(p => ({ ...p, username: e.target.value }))}
                        placeholder="your-username"
                        className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      {usernameError ? (
                        <p className="text-xs text-red-500 dark:text-red-400 mt-1">{usernameError}</p>
                      ) : (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Used for your public profile URL</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        Display Name
                      </label>
                      <input
                        type="text"
                        value={profile.displayName}
                        onChange={e => setProfile(p => ({ ...p, displayName: e.target.value }))}
                        placeholder="Your Name"
                        className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Bio
                    </label>
                    <textarea
                      value={profile.bio}
                      onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))}
                      placeholder="Tell readers about yourself..."
                      rows={3}
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    />
                  </div>
                </div>
              </div>

              {/* Divider + Social Links section */}
              <div className="border-t border-gray-100 dark:border-gray-700 pt-5">
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
                  Links & Socials
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Website
                    </label>
                    <div className="relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                      </div>
                      <input
                        type="url"
                        value={profile.websiteUrl}
                        onChange={e => setProfile(p => ({ ...p, websiteUrl: e.target.value }))}
                        placeholder="https://yoursite.com"
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <SocialInput
                      icon={<BlueskyIcon className="w-4 h-4" />}
                      label="Bluesky"
                      value={profile.blueskyHandle}
                      onChange={val => setProfile(p => ({ ...p, blueskyHandle: val }))}
                      placeholder="you.bsky.social"
                    />
                    <SocialInput
                      icon={<ThreadsIcon className="w-4 h-4" />}
                      label="Threads"
                      value={profile.threadsHandle}
                      onChange={val => setProfile(p => ({ ...p, threadsHandle: val }))}
                      placeholder="@username"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <SocialInput
                      icon={<InstagramIcon className="w-4 h-4" />}
                      label="Instagram"
                      value={profile.instagramHandle}
                      onChange={val => setProfile(p => ({ ...p, instagramHandle: val }))}
                      placeholder="@username"
                    />
                    <SocialInput
                      icon={<DiscordIcon className="w-4 h-4" />}
                      label="Discord"
                      value={profile.discordHandle}
                      onChange={val => setProfile(p => ({ ...p, discordHandle: val }))}
                      placeholder="@username"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium text-sm"
                >
                  {saving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Monetization link */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Monetization</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Manage subscription tiers, Stripe connection, and discount codes.
              </p>
            </div>
            <Link
              href="/settings/monetization"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Manage &rarr;
            </Link>
          </div>
        </div>

        {/* Notifications (placeholder) */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Notifications</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">
            Notification preferences will be available in a future update.
          </p>
        </div>
      </div>
    </div>
  )
}
