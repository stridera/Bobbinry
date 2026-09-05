import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useEntityList, useCreateEntity, useUpdateEntity, useDeleteEntity, useDebounce } from '../hooks'
import type { BobbinrySDK, EntityQuery, EntityResult } from '../index'

function createMockSDK() {
  const entities = {
    get: jest.fn() as jest.MockedFunction<BobbinrySDK['entities']['get']>,
    query: jest.fn() as jest.MockedFunction<BobbinrySDK['entities']['query']>,
    create: jest.fn() as jest.MockedFunction<BobbinrySDK['entities']['create']>,
    update: jest.fn() as jest.MockedFunction<BobbinrySDK['entities']['update']>,
    delete: jest.fn() as jest.MockedFunction<BobbinrySDK['entities']['delete']>,
  }

  return { entities } as unknown as BobbinrySDK
}

describe('useEntityList', () => {
  it('fetches list with query params', async () => {
    const sdk = createMockSDK()
    ;(sdk.entities.query as jest.Mock).mockResolvedValue({
      data: [{ id: '1' }, { id: '2' }],
      total: 2,
      hasMore: false,
    } as EntityResult)

    const query: EntityQuery = { collection: 'books', limit: 10 }
    const { result } = renderHook(() => useEntityList(sdk, query))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.data).toHaveLength(2)
    expect(result.current.total).toBe(2)
    expect(sdk.entities.query).toHaveBeenCalledWith(query)
  })

  it('handles query error', async () => {
    const sdk = createMockSDK()
    ;(sdk.entities.query as jest.Mock).mockRejectedValue(new Error('fail'))

    const { result } = renderHook(() => useEntityList(sdk, { collection: 'x' }))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.data).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.error?.message).toBe('fail')
  })
})

describe('useCreateEntity', () => {
  it('calls sdk.entities.create and invokes onSuccess', async () => {
    const sdk = createMockSDK()
    const created = { id: 'new', title: 'New Book' }
    ;(sdk.entities.create as jest.Mock).mockResolvedValue(created)

    const onSuccess = jest.fn()
    const { result } = renderHook(() => useCreateEntity(sdk, 'books', { onSuccess }))

    expect(result.current.creating).toBe(false)

    let entity: any
    await act(async () => {
      entity = await result.current.create({ title: 'New Book' })
    })

    expect(entity).toEqual(created)
    expect(onSuccess).toHaveBeenCalledWith(created)
    expect(sdk.entities.create).toHaveBeenCalledWith('books', { title: 'New Book' })
  })

  it('invokes onError on failure', async () => {
    const sdk = createMockSDK()
    ;(sdk.entities.create as jest.Mock).mockRejectedValue(new Error('create failed'))

    const onError = jest.fn()
    const { result } = renderHook(() => useCreateEntity(sdk, 'books', { onError }))

    await act(async () => {
      await expect(result.current.create({ title: 'Bad' })).rejects.toThrow('create failed')
    })

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'create failed' }))
  })
})

describe('useUpdateEntity', () => {
  it('calls sdk.entities.update and invokes onSuccess', async () => {
    const sdk = createMockSDK()
    const updated = { id: 'e1', title: 'Updated' }
    ;(sdk.entities.update as jest.Mock).mockResolvedValue(updated)

    const onSuccess = jest.fn()
    const { result } = renderHook(() => useUpdateEntity(sdk, 'books', { onSuccess }))

    await act(async () => {
      await result.current.update('e1', { title: 'Updated' })
    })

    expect(onSuccess).toHaveBeenCalledWith(updated)
    expect(sdk.entities.update).toHaveBeenCalledWith('books', 'e1', { title: 'Updated' })
  })
})

describe('useDeleteEntity', () => {
  it('calls sdk.entities.delete and invokes onSuccess', async () => {
    const sdk = createMockSDK()
    ;(sdk.entities.delete as jest.Mock).mockResolvedValue(undefined)

    const onSuccess = jest.fn()
    const { result } = renderHook(() => useDeleteEntity(sdk, 'books', { onSuccess }))

    await act(async () => {
      await result.current.remove('e1')
    })

    expect(onSuccess).toHaveBeenCalled()
    expect(sdk.entities.delete).toHaveBeenCalledWith('books', 'e1')
  })

  it('invokes onError on failure', async () => {
    const sdk = createMockSDK()
    ;(sdk.entities.delete as jest.Mock).mockRejectedValue(new Error('delete failed'))

    const onError = jest.fn()
    const { result } = renderHook(() => useDeleteEntity(sdk, 'books', { onError }))

    await act(async () => {
      await expect(result.current.remove('e1')).rejects.toThrow('delete failed')
    })

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'delete failed' }))
  })
})

describe('useDebounce', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  it('debounces value updates', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: 'initial' } }
    )

    expect(result.current).toBe('initial')

    rerender({ value: 'updated' })
    expect(result.current).toBe('initial') // Not yet updated

    act(() => { jest.advanceTimersByTime(300) })
    expect(result.current).toBe('updated')
  })

  it('resets timer on rapid changes', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 500),
      { initialProps: { value: 'a' } }
    )

    rerender({ value: 'b' })
    act(() => { jest.advanceTimersByTime(200) })

    rerender({ value: 'c' })
    act(() => { jest.advanceTimersByTime(200) })

    // Timer was reset, 'b' should not appear
    expect(result.current).toBe('a')

    act(() => { jest.advanceTimersByTime(300) })
    expect(result.current).toBe('c')
  })
})
