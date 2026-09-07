jest.mock('@/lib/api', () => ({ apiFetch: jest.fn() }))

import { apiFetch } from '@/lib/api'
import {
  __resetShellPrefsForTests, flushShellPrefs, getShellPref, getShellPrefs, setShellPref, startShellPrefsSync,
  SHELL_PREFS_MIRROR_KEY,
} from '../shell-prefs'

const apiFetchMock = apiFetch as jest.Mock
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body })
const flushPromises = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }
const patchBodies = () => apiFetchMock.mock.calls.filter(([, , init]) => init?.method === 'PATCH').map(([, , init]) => JSON.parse(init.body))

describe('shell-prefs store', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    localStorage.clear()
    apiFetchMock.mockReset()
    __resetShellPrefsForTests()
  })
  afterEach(() => { jest.useRealTimers() })

  it('imports the legacy localStorage keys once, removes them, and queues them for upload', async () => {
    localStorage.setItem('shellPanelWidth:left', '320')
    localStorage.setItem('shellPanelCollapsed:right', 'true')
    localStorage.setItem('shellLeftRail:active', 'manuscript.manuscript-navigation')
    localStorage.setItem('viewPreferences', JSON.stringify({ container: 'manuscript.table' }))
    localStorage.setItem('bobbinry:lastNav:p1', JSON.stringify({ entityType: 'content', entityId: 'c1', bobbinId: 'manuscript' }))

    expect(getShellPref('panelWidth', 'left', 280)).toBe(320)
    expect(getShellPref('panelCollapsed', 'right', false)).toBe(true)
    expect(getShellPref('viewPreferences', 'container', null)).toBe('manuscript.table')
    expect(getShellPref('lastNav', 'p1', null)).toEqual({ entityType: 'content', entityId: 'c1', bobbinId: 'manuscript' })
    expect(localStorage.getItem('shellPanelWidth:left')).toBeNull()
    expect(localStorage.getItem('viewPreferences')).toBeNull()
    expect(JSON.parse(localStorage.getItem(SHELL_PREFS_MIRROR_KEY)!).leftRail).toEqual({ active: 'manuscript.manuscript-navigation' })

    apiFetchMock.mockImplementation(() => ok({ prefs: {} }))
    startShellPrefsSync('tok')
    await flushPromises()
    jest.advanceTimersByTime(1000)
    await flushPromises()
    expect(patchBodies()).toHaveLength(1)
    expect(patchBodies()[0].prefs.panelWidth).toEqual({ left: 320 })
  })

  it('lets the server win over the mirror and uploads local-only keys once', async () => {
    localStorage.setItem(SHELL_PREFS_MIRROR_KEY, JSON.stringify({ panelWidth: { left: 300, right: 400 }, leftRail: { active: 'a' } }))
    apiFetchMock.mockImplementation((path: string, _t: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? ok({ prefs: {} }) : ok({ prefs: { panelWidth: { left: 350 } } }))

    startShellPrefsSync('tok')
    await flushPromises()
    expect(getShellPrefs().panelWidth).toEqual({ left: 350, right: 400 })
    jest.advanceTimersByTime(1000)
    await flushPromises()
    const bodies = patchBodies()
    expect(bodies).toHaveLength(1)
    expect(bodies[0].prefs).toEqual({ panelWidth: { right: 400 }, leftRail: { active: 'a' } })
  })

  it('coalesces rapid writes into one debounced PATCH and mirrors immediately', async () => {
    apiFetchMock.mockImplementation(() => ok({ prefs: {} }))
    startShellPrefsSync('tok')
    await flushPromises()
    setShellPref('panelWidth', 'left', 301)
    setShellPref('panelWidth', 'left', 302)
    setShellPref('rightRail', 'split', 0.4)
    expect(JSON.parse(localStorage.getItem(SHELL_PREFS_MIRROR_KEY)!).panelWidth.left).toBe(302)
    expect(patchBodies()).toHaveLength(0)
    jest.advanceTimersByTime(800)
    await flushPromises()
    expect(patchBodies()).toEqual([{ prefs: { panelWidth: { left: 302 }, rightRail: { split: 0.4 } } }])
  })

  it('sends null to delete, retries a failed batch on the next flush, and flushes with keepalive on pagehide', async () => {
    apiFetchMock.mockImplementation(() => ok({ prefs: {} }))
    startShellPrefsSync('tok')
    await flushPromises()
    setShellPref('viewPreferences', 'container', 'manuscript.table')
    jest.advanceTimersByTime(800)
    await flushPromises()
    expect(patchBodies()).toHaveLength(1)

    apiFetchMock.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }))
    setShellPref('viewPreferences', 'container', null)
    jest.advanceTimersByTime(800)
    await flushPromises()
    expect(patchBodies()).toHaveLength(2)

    setShellPref('leftRail', 'active', 'x')
    window.dispatchEvent(new Event('pagehide'))
    await flushPromises()
    const last = apiFetchMock.mock.calls.at(-1)!
    expect(last[2].keepalive).toBe(true)
    expect(JSON.parse(last[2].body).prefs).toEqual({ viewPreferences: { container: null }, leftRail: { active: 'x' } })
  })

  it('does nothing on the network without a token', async () => {
    setShellPref('panelWidth', 'left', 1)
    jest.advanceTimersByTime(1000)
    await flushShellPrefs()
    expect(apiFetchMock).not.toHaveBeenCalled()
  })
})
