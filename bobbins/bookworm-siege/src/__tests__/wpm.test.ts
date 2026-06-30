import { WpmTracker } from '../lib/wpm'

describe('WpmTracker', () => {
  it('counts words within the rolling 60s window', () => {
    const t = new WpmTracker()
    t.add(0)
    t.add(1_000)
    t.add(2_000)
    expect(t.wpm(2_000)).toBe(3)
  })

  it('drops words older than 60s', () => {
    const t = new WpmTracker()
    t.add(0)
    t.add(10_000)
    // at t=61s, the word at 0ms is outside the window, the one at 10s is inside
    expect(t.wpm(61_000)).toBe(1)
  })

  it('returns zero once all words age out', () => {
    const t = new WpmTracker()
    t.addMany(5, 0)
    expect(t.wpm(0)).toBe(5)
    expect(t.wpm(60_001)).toBe(0)
  })

  it('addMany records multiple words at one timestamp', () => {
    const t = new WpmTracker()
    t.addMany(40, 5_000)
    expect(t.wpm(5_000)).toBe(40)
  })

  it('reset clears the buffer', () => {
    const t = new WpmTracker()
    t.addMany(3, 0)
    t.reset()
    expect(t.wpm(0)).toBe(0)
  })
})
