'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'

interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  metadata: {
    projectId?: string
    projectTitle?: string
    chapterId?: string
    chapterTitle?: string
    tierId?: string
    tierName?: string
    url?: string
  } | null
  isRead: boolean
  readAt: string | null
  createdAt: string
  actorId: string | null
  actorName: string | null
}

const POLL_INTERVAL = 30_000

export function useUnreadCount() {
  const { data: session } = useSession()
  const [count, setCount] = useState(0)
  const apiToken = (session as any)?.apiToken as string | undefined

  const refetch = useCallback(async () => {
    if (!apiToken) return
    try {
      const res = await apiFetch('/api/notifications/unread-count', apiToken)
      if (res.ok) {
        const data = await res.json()
        setCount(data.count)
      }
    } catch {
      // silently ignore polling errors
    }
  }, [apiToken])

  useEffect(() => {
    if (!apiToken) return
    refetch()
    const interval = setInterval(refetch, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [apiToken, refetch])

  return { count, refetch }
}

export function useNotifications(limit = 20) {
  const { data: session } = useSession()
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const apiToken = (session as any)?.apiToken as string | undefined

  const fetchNotifications = useCallback(async () => {
    if (!apiToken) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/notifications?limit=${limit}`, apiToken)
      if (res.ok) {
        const data = await res.json()
        setItems(data.notifications)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [apiToken, limit])

  const markRead = useCallback(async (id: string) => {
    if (!apiToken) return
    setItems(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n))
    try {
      await apiFetch(`/api/notifications/${id}/read`, apiToken, { method: 'PUT' })
    } catch {
      // ignore
    }
  }, [apiToken])

  const markAllRead = useCallback(async () => {
    if (!apiToken) return
    setItems(prev => prev.map(n => ({ ...n, isRead: true })))
    try {
      await apiFetch('/api/notifications/read-all', apiToken, { method: 'PUT' })
    } catch {
      // ignore
    }
  }, [apiToken])

  return { notifications: items, loading, fetchNotifications, markRead, markAllRead }
}
