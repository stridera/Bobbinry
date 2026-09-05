/**
 * React Hooks for Bobbinry SDK
 *
 * Common patterns extracted into reusable hooks
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { BobbinrySDK, EntityQuery, Message } from './index'

export function useEntityList<T = any>(
  sdk: BobbinrySDK,
  query: EntityQuery
) {
  const [data, setData] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetch = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await sdk.entities.query<T>(query)
      setData(result.data)
      setTotal(result.total)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      setData([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [sdk, JSON.stringify(query)])

  useEffect(() => {
    fetch()
  }, [fetch])

  return {
    data,
    total,
    loading,
    error,
    refetch: fetch
  }
}

/**
 * Hook to listen to message bus events with automatic cleanup
 *
 * @example
 * useMessageBus('manuscript.editor.selection.v1', (message) => {
 *   console.log('Selected:', message.payload.text)
 * })
 */
export function useMessageBus(
  topic: string | string[],
  handler: (message: Message) => void,
  enabled = true
) {
  const handlerRef = useRef(handler)

  // Update handler ref when it changes
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (!enabled) return

    const topics = Array.isArray(topic) ? topic : [topic]

    const messageHandler = (event: MessageEvent) => {
      const msg = event.data

      // Validate message format
      if (!msg || typeof msg !== 'object') return

      // Check if this is a new envelope format BUS_EVENT
      if (msg.namespace === 'BUS' && msg.type === 'BUS_EVENT' && msg.payload?.topic) {
        if (topics.includes(msg.payload.topic)) {
          handlerRef.current(msg.payload)
        }
      }
    }

    window.addEventListener('message', messageHandler)

    return () => {
      window.removeEventListener('message', messageHandler)
    }
  }, [topic, enabled])
}

/**
 * Hook to create an entity with optimistic updates
 *
 * @example
 * const { create, creating } = useCreateEntity(sdk, 'scenes', {
 *   onSuccess: (newEntity) => console.log('Created:', newEntity.id)
 * })
 */
export function useCreateEntity<T = any>(
  sdk: BobbinrySDK,
  collection: string,
  options: {
    onSuccess?: (entity: T) => void
    onError?: (error: Error) => void
  } = {}
) {
  const [creating, setCreating] = useState(false)

  const create = useCallback(async (data: Partial<T>) => {
    try {
      setCreating(true)
      const entity = await sdk.entities.create<T>(collection, data)
      options.onSuccess?.(entity)
      return entity
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      options.onError?.(error)
      throw error
    } finally {
      setCreating(false)
    }
  }, [sdk, collection, options.onSuccess, options.onError])

  return {
    create,
    creating
  }
}

/**
 * Hook to update an entity with optimistic updates
 *
 * @example
 * const { update, updating } = useUpdateEntity(sdk, 'scenes', {
 *   onSuccess: (updatedEntity) => console.log('Updated:', updatedEntity.id)
 * })
 */
export function useUpdateEntity<T = any>(
  sdk: BobbinrySDK,
  collection: string,
  options: {
    onSuccess?: (entity: T) => void
    onError?: (error: Error) => void
  } = {}
) {
  const [updating, setUpdating] = useState(false)

  const update = useCallback(async (id: string, data: Partial<T>) => {
    try {
      setUpdating(true)
      const entity = await sdk.entities.update<T>(collection, id, data)
      options.onSuccess?.(entity)
      return entity
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      options.onError?.(error)
      throw error
    } finally {
      setUpdating(false)
    }
  }, [sdk, collection, options.onSuccess, options.onError])

  return {
    update,
    updating
  }
}

/**
 * Hook to delete an entity
 *
 * @example
 * const { remove, deleting } = useDeleteEntity(sdk, 'scenes', {
 *   onSuccess: () => console.log('Deleted successfully')
 * })
 */
export function useDeleteEntity(
  sdk: BobbinrySDK,
  collection: string,
  options: {
    onSuccess?: () => void
    onError?: (error: Error) => void
  } = {}
) {
  const [deleting, setDeleting] = useState(false)

  const remove = useCallback(async (id: string) => {
    try {
      setDeleting(true)
      await sdk.entities.delete(collection, id)
      options.onSuccess?.()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      options.onError?.(error)
      throw error
    } finally {
      setDeleting(false)
    }
  }, [sdk, collection, options.onSuccess, options.onError])

  return {
    remove,
    deleting
  }
}

/**
 * Hook to debounce a value
 * @param value - Value to debounce
 * @param delay - Delay in milliseconds (default: 500ms)
 * @returns Debounced value
 *
 * @example
 * const [searchTerm, setSearchTerm] = useState('')
 * const debouncedSearch = useDebounce(searchTerm, 300)
 *
 * useEffect(() => {
 *   // API call with debouncedSearch
 * }, [debouncedSearch])
 */
export function useDebounce<T>(value: T, delay = 500): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  handler: (event: MouseEvent | TouchEvent) => void
) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      // Do nothing if clicking ref's element or descendent elements
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return
      }
      handler(event)
    }

    document.addEventListener('mousedown', listener)
    document.addEventListener('touchstart', listener)

    return () => {
      document.removeEventListener('mousedown', listener)
      document.removeEventListener('touchstart', listener)
    }
  }, [ref, handler])
}
