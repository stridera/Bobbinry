import { createSpeechController, clampRate, loadVoices, pickDefaultVoice } from '../lib/speech'
import type { Segment } from '../lib/segments'

class FakeUtterance {
  text: string
  rate = 1
  lang = ''
  voice: unknown = null
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

class FakeSynth {
  spoken: FakeUtterance[] = []
  cancelCalls = 0
  pauseCalls = 0
  resumeCalls = 0
  speaking = false
  pending = false
  paused = false
  speak(utterance: FakeUtterance) {
    this.spoken.push(utterance)
    this.speaking = true
  }
  cancel() {
    this.cancelCalls += 1
    this.speaking = false
  }
  pause() {
    this.pauseCalls += 1
    this.paused = true
  }
  resume() {
    this.resumeCalls += 1
    this.paused = false
  }
  getVoices() {
    return []
  }
  /** Simulate the engine finishing the most recent utterance. */
  finishCurrent() {
    const current = this.spoken[this.spoken.length - 1]
    this.speaking = false
    current?.onend?.()
  }
}

function seg(text: string, chunks: string[] = [text]): Segment {
  return { el: null, text, chunks }
}

beforeAll(() => {
  ;(globalThis as any).SpeechSynthesisUtterance = FakeUtterance
})

describe('createSpeechController', () => {
  it('speaks segments chunk by chunk and reports segment starts and the end', () => {
    const synth = new FakeSynth()
    const starts: number[] = []
    const onEnd = jest.fn()
    const states: string[] = []
    const controller = createSpeechController(synth as unknown as SpeechSynthesis, {
      onSegmentStart: i => starts.push(i),
      onEnd,
      onStateChange: s => states.push(s),
    })

    controller.play([seg('One.'), seg('Two. Three.', ['Two.', 'Three.'])])
    expect(synth.spoken.map(u => u.text)).toEqual(['One.'])
    expect(controller.getState()).toBe('playing')

    synth.finishCurrent()
    expect(synth.spoken.map(u => u.text)).toEqual(['One.', 'Two.'])
    synth.finishCurrent()
    expect(synth.spoken.map(u => u.text)).toEqual(['One.', 'Two.', 'Three.'])
    expect(onEnd).not.toHaveBeenCalled()

    synth.finishCurrent()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(starts).toEqual([0, 1])
    expect(controller.getState()).toBe('idle')
    expect(states).toEqual(['playing', 'idle'])
  })

  it('ignores callbacks from utterances cancelled by stop()', () => {
    const synth = new FakeSynth()
    const onEnd = jest.fn()
    const controller = createSpeechController(synth as unknown as SpeechSynthesis, { onEnd })

    controller.play([seg('One.'), seg('Two.')])
    const first = synth.spoken[0]!
    controller.stop()
    expect(synth.cancelCalls).toBeGreaterThan(0)
    expect(controller.getState()).toBe('idle')

    first.onend?.()
    expect(synth.spoken).toHaveLength(1)
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('does not fire onEnd for engine errors, but does call onError', () => {
    const synth = new FakeSynth()
    const onEnd = jest.fn()
    const onError = jest.fn()
    const controller = createSpeechController(synth as unknown as SpeechSynthesis, { onEnd, onError })

    controller.play([seg('One.')])
    synth.spoken[0]!.onerror?.({ error: 'synthesis-failed' })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()
    expect(controller.getState()).toBe('idle')
  })

  it('treats interrupted/canceled errors as benign', () => {
    const synth = new FakeSynth()
    const onError = jest.fn()
    const controller = createSpeechController(synth as unknown as SpeechSynthesis, { onError })
    controller.play([seg('One.')])
    synth.spoken[0]!.onerror?.({ error: 'interrupted' })
    expect(onError).not.toHaveBeenCalled()
    expect(controller.getState()).toBe('playing')
  })

  it('restarts the current chunk with the new rate while playing', () => {
    const synth = new FakeSynth()
    const controller = createSpeechController(synth as unknown as SpeechSynthesis)
    controller.play([seg('One.'), seg('Two.')])
    controller.setRate(1.5)
    expect(synth.spoken).toHaveLength(2)
    expect(synth.spoken[1]!.text).toBe('One.')
    expect(synth.spoken[1]!.rate).toBe(1.5)

    // The old utterance's late onend must not advance the queue.
    synth.spoken[0]!.onend?.()
    expect(synth.spoken).toHaveLength(2)
  })

  it('pauses and resumes through the engine', () => {
    const synth = new FakeSynth()
    const controller = createSpeechController(synth as unknown as SpeechSynthesis)
    controller.play([seg('One.')])
    controller.pause()
    expect(synth.pauseCalls).toBe(1)
    expect(controller.getState()).toBe('paused')
    controller.resume()
    expect(synth.resumeCalls).toBe(1)
    expect(controller.getState()).toBe('playing')
  })

  it('ends immediately for an empty segment list', () => {
    const synth = new FakeSynth()
    const onEnd = jest.fn()
    const controller = createSpeechController(synth as unknown as SpeechSynthesis, { onEnd })
    controller.play([])
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toBe('idle')
  })
})

describe('clampRate', () => {
  it('clamps to the supported range and rounds to a tenth', () => {
    expect(clampRate(0.1)).toBe(0.5)
    expect(clampRate(5)).toBe(2)
    expect(clampRate(1.26)).toBe(1.3)
    expect(clampRate(Number.NaN)).toBe(1)
  })
})

describe('pickDefaultVoice', () => {
  const voice = (name: string, lang: string, isDefault = false) =>
    ({ name, lang, default: isDefault, voiceURI: name, localService: true }) as SpeechSynthesisVoice

  it('prefers the default voice for the page language', () => {
    const voices = [voice('fr', 'fr-FR', true), voice('en1', 'en-US'), voice('en2', 'en-GB', true)]
    expect(pickDefaultVoice(voices, 'en-AU')?.name).toBe('en2')
  })

  it('falls back to any voice for the language, then the engine default', () => {
    expect(pickDefaultVoice([voice('fr', 'fr-FR', true), voice('en1', 'en-US')], 'en')?.name).toBe('en1')
    expect(pickDefaultVoice([voice('fr', 'fr-FR', true), voice('de', 'de-DE')], 'en')?.name).toBe('fr')
    expect(pickDefaultVoice([], 'en')).toBeNull()
  })
})

describe('loadVoices', () => {
  it('resolves immediately when voices are already available', async () => {
    const synth = { getVoices: () => [{ name: 'a' }] } as unknown as SpeechSynthesis
    await expect(loadVoices(synth)).resolves.toHaveLength(1)
  })

  it('waits for voiceschanged', async () => {
    let listener: (() => void) | null = null
    const list: unknown[] = []
    const synth = {
      getVoices: () => list,
      addEventListener: (_: string, fn: () => void) => {
        listener = fn
      },
      removeEventListener: jest.fn(),
    } as unknown as SpeechSynthesis
    const promise = loadVoices(synth, 5000)
    list.push({ name: 'late' })
    listener!()
    await expect(promise).resolves.toHaveLength(1)
  })
})
