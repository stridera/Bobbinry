/**
 * React Hooks for Bobbinry SDK
 *
 * Common patterns extracted into reusable hooks
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { BobbinrySDK, EntityQuery, Message } from './index'

/**
 * Hook to fetch and cache a single entity
 *
 * @example
 * const { data, loading, error, refetch } = useEntity(sdk, 'scenes', sceneId)
 */
export function useEntity<T = any>(
  sdk: BobbinrySDK,
  collection: string,
  id: string | null | undefined
) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetch = useCallback(async () => {
    if (!id) {
      setData(null)
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      const entity = await sdk.entities.get<T>(collection, id)
      setData(entity)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [sdk, collection, id])

  useEffect(() => {
    fetch()
  }, [fetch])

  return {
    data,
    loading,
    error,
    refetch: fetch
  }
}

/**
 * Hook to query a list of entities with pagination
 *
 * @example
 * const { data, total, loading, error, refetch } = useEntityList(sdk, {
 *   collection: 'scenes',
 *   limit: 50,
 *   sort: [{ field: 'created_at', direction: 'desc' }]
 * })
 */
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

/**
 * Hook to persist state in localStorage
 * @param key - localStorage key
 * @param initialValue - Initial value if key doesn't exist
 * @returns [value, setValue] tuple like useState
 *
 * @example
 * const [name, setName] = useLocalStorage('user-name', 'Anonymous')
 *
 * // Value persists across page reloads
 * setName('John Doe')
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((val: T) => T)) => void] {
  // State to store our value
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue
    }

    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error)
      return initialValue
    }
  })

  // Return a wrapped version of useState's setter function that
  // persists the new value to localStorage.
  const setValue = (value: T | ((val: T) => T)) => {
    try {
      // Allow value to be a function so we have same API as useState
      const valueToStore = value instanceof Function ? value(storedValue) : value
      setStoredValue(valueToStore)

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(valueToStore))
      }
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error)
    }
  }

  return [storedValue, setValue]
}

/**
 * Hook to track previous value of a prop/state
 * @param value - Current value
 * @returns Previous value
 *
 * @example
 * const [count, setCount] = useState(0)
 * const previousCount = usePrevious(count)
 *
 * // previousCount will be undefined on first render,
 * // then will always be one step behind count
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined)

  useEffect(() => {
    ref.current = value
  }, [value])

  return ref.current
}

/**
 * Hook to detect clicks outside of a ref element
 * @param ref - React ref to element
 * @param handler - Function to call when click outside occurs
 *
 * @example
 * const modalRef = useRef(null)
 * useClickOutside(modalRef, () => setIsOpen(false))
 *
 * return <div ref={modalRef}>Modal content</div>
 */
export function useClickOutside(
  ref: React.RefObject<HTMLElement>,
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

/**
 * Hook to manage boolean state with helpful toggle/set functions
 * @param initialValue - Initial boolean value (default: false)
 * @returns [value, { toggle, setTrue, setFalse, setValue }]
 *
 * @example
 * const [isOpen, { toggle, setTrue, setFalse }] = useBoolean()
 *
 * <button onClick={toggle}>Toggle</button>
 * <button onClick={setTrue}>Open</button>
 * <button onClick={setFalse}>Close</button>
 */
export function useBoolean(initialValue = false) {
  const [value, setValue] = useState(initialValue)

  const toggle = useCallback(() => setValue(v => !v), [])
  const setTrue = useCallback(() => setValue(true), [])
  const setFalse = useCallback(() => setValue(false), [])

  return [
    value,
    {
      toggle,
      setTrue,
      setFalse,
      setValue
    }
  ] as const
}
