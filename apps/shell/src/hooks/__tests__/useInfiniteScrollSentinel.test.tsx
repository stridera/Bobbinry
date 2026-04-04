import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { useInfiniteScrollSentinel } from '../useInfiniteScrollSentinel'

type ObserverInstance = {
  callback: IntersectionObserverCallback
  observe: jest.Mock
  disconnect: jest.Mock
}

const observerInstances: ObserverInstance[] = []

class MockIntersectionObserver {
  callback: IntersectionObserverCallback
  observe = jest.fn()
  disconnect = jest.fn()

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    observerInstances.push(this)
  }
}

function SentinelHarness({ onLoadMore }: { onLoadMore: () => void }) {
  const [showSentinel, setShowSentinel] = useState(true)
  const ref = useInfiniteScrollSentinel({
    enabled: true,
    hasMore: true,
    loading: false,
    onLoadMore,
  })

  return (
    <div>
      <button onClick={() => setShowSentinel(false)}>Hide</button>
      <button onClick={() => setShowSentinel(true)}>Show</button>
      {showSentinel ? <div ref={ref}>Sentinel</div> : null}
    </div>
  )
}

describe('useInfiniteScrollSentinel', () => {
  beforeEach(() => {
    observerInstances.length = 0
    ;(global as typeof globalThis & { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver
  })

  it('re-observes a remounted sentinel and still loads more', () => {
    const onLoadMore = jest.fn()

    render(<SentinelHarness onLoadMore={onLoadMore} />)

    expect(observerInstances).toHaveLength(1)
    expect(observerInstances[0]?.observe).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Hide'))
    expect(observerInstances[0]?.disconnect).toHaveBeenCalled()

    fireEvent.click(screen.getByText('Show'))
    expect(observerInstances).toHaveLength(2)
    expect(observerInstances[1]?.observe).toHaveBeenCalledTimes(1)

    act(() => {
      observerInstances[1]?.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        observerInstances[1] as unknown as IntersectionObserver
      )
    })

    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })
})
