import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { setAnalyticsSink, trackEvent } from '../analytics'
import type { AnalyticsEvent, AnalyticsProps } from '../analytics'

type Recorded = { name: AnalyticsEvent; props?: AnalyticsProps }

function recordingSink() {
  const events: Recorded[] = []
  return {
    events,
    sink: (name: AnalyticsEvent, props?: AnalyticsProps) => {
      events.push({ name, props })
    },
  }
}

beforeEach(() => {
  // Detach between tests so buffered events don't leak across cases.
  setAnalyticsSink(null)
})

describe('trackEvent', () => {
  it('forwards events to a registered sink', () => {
    const { events, sink } = recordingSink()
    setAnalyticsSink(sink)

    trackEvent('project_created', { projectId: 'p1' })

    expect(events).toEqual([{ name: 'project_created', props: { projectId: 'p1' } }])
  })

  it('buffers events fired before the sink registers, then flushes in order', () => {
    trackEvent('chapter_view_started', { chapterId: 'c1' })
    trackEvent('reaction_added', { chapterId: 'c1' })

    const { events, sink } = recordingSink()
    setAnalyticsSink(sink)

    expect(events.map(e => e.name)).toEqual(['chapter_view_started', 'reaction_added'])
  })

  it('flushes the buffer only once', () => {
    trackEvent('signup_completed')

    const first = recordingSink()
    setAnalyticsSink(first.sink)
    expect(first.events).toHaveLength(1)

    const second = recordingSink()
    setAnalyticsSink(second.sink)
    expect(second.events).toHaveLength(0)
  })

  it('caps the buffer so a missing sink cannot grow without bound', () => {
    for (let i = 0; i < 200; i++) trackEvent('chapter_view_started', { i })

    const { events, sink } = recordingSink()
    setAnalyticsSink(sink)

    expect(events).toHaveLength(50)
  })

  it('swallows sink errors so analytics cannot break the app', () => {
    setAnalyticsSink(() => {
      throw new Error('posthog exploded')
    })

    expect(() => trackEvent('comment_posted')).not.toThrow()
  })

  it('swallows sink errors raised while flushing the buffer', () => {
    trackEvent('checkout_started')

    expect(() =>
      setAnalyticsSink(() => {
        throw new Error('posthog exploded')
      })
    ).not.toThrow()
  })

  it('stops forwarding once detached', () => {
    const { events, sink } = recordingSink()
    setAnalyticsSink(sink)
    setAnalyticsSink(null)

    trackEvent('project_followed')

    expect(events).toHaveLength(0)
  })
})
