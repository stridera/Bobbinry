import {
  READER_PREFS_KEY,
  AUTOPLAY_KEY,
  readTtsPrefs,
  writeTtsPrefs,
  setAutoplayTarget,
  consumeAutoplayTarget,
  normalizeHrefPath,
} from '../lib/prefs'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
}

describe('tts prefs', () => {
  it('returns defaults when nothing is stored', () => {
    expect(readTtsPrefs(new MemoryStorage())).toEqual({ voiceURI: null, rate: 1, autoAdvance: true })
  })

  it('merges into the shared reader prefs blob without clobbering other keys', () => {
    const storage = new MemoryStorage()
    storage.setItem(READER_PREFS_KEY, JSON.stringify({ readerTheme: 'sepia', fontSize: 'large' }))

    writeTtsPrefs({ rate: 1.4, voiceURI: 'Voice A' }, storage)
    writeTtsPrefs({ autoAdvance: false }, storage)

    const blob = JSON.parse(storage.getItem(READER_PREFS_KEY)!)
    expect(blob).toEqual({
      readerTheme: 'sepia',
      fontSize: 'large',
      ttsRate: 1.4,
      ttsVoiceURI: 'Voice A',
      ttsAutoAdvance: false,
    })
    expect(readTtsPrefs(storage)).toEqual({ voiceURI: 'Voice A', rate: 1.4, autoAdvance: false })
  })

  it('clamps stored rates and survives corrupt JSON', () => {
    const storage = new MemoryStorage()
    storage.setItem(READER_PREFS_KEY, '{not json')
    expect(readTtsPrefs(storage).rate).toBe(1)
    writeTtsPrefs({ rate: 9 }, storage)
    expect(readTtsPrefs(storage).rate).toBe(2)
  })

  it('is a no-op without storage', () => {
    expect(() => writeTtsPrefs({ rate: 1 }, null)).not.toThrow()
    expect(readTtsPrefs(null).rate).toBe(1)
  })
})

describe('autoplay handoff', () => {
  it('matches on decoded pathname and ignores the query string', () => {
    const storage = new MemoryStorage()
    setAutoplayTarget('/read/elena/my%20book/chapter-2?viewAs=marcus', storage)
    expect(storage.getItem(AUTOPLAY_KEY)).toBe('/read/elena/my book/chapter-2')
    expect(consumeAutoplayTarget('/read/elena/my book/chapter-2?x=1', storage)).toBe(true)
    expect(storage.getItem(AUTOPLAY_KEY)).toBeNull()
  })

  it('clears a stale target that points elsewhere and does not fire', () => {
    const storage = new MemoryStorage()
    setAutoplayTarget('/read/elena/book/chapter-2', storage)
    expect(consumeAutoplayTarget('/read/elena/book/chapter-3', storage)).toBe(false)
    expect(storage.getItem(AUTOPLAY_KEY)).toBeNull()
    expect(consumeAutoplayTarget('/read/elena/book/chapter-2', storage)).toBe(false)
  })

  it('normalizes trailing slashes and hashes', () => {
    expect(normalizeHrefPath('/a/b/#top')).toBe('/a/b')
    expect(normalizeHrefPath('/a/b?q=1')).toBe('/a/b')
  })
})
