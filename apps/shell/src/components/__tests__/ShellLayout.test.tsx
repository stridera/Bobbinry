/**
 * ShellLayout owns the panel chrome: widths/collapsed state from shell-prefs,
 * the account sync kickoff, focus mode (Esc + editor-sourced float), and the
 * `revealOn` wiring that lets a bobbin's contribution surface itself when a
 * declared window event fires. Child rails are stubbed so this file exercises
 * only ShellLayout's own logic against the real preference store and
 * extension registry.
 */

import { render, act, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import {
  __resetShellPrefsForTests,
  getShellPref,
  setShellPref,
  startShellPrefsSync,
} from '@/lib/shell-prefs'
import { extensionRegistry } from '@/lib/extensions'
import { ShellLayout } from '../ShellLayout'

jest.mock('@/hooks/useBreadcrumb', () => ({ useBreadcrumb: () => [] }))

// SWC compiles this module's named exports as non-configurable getters
// (Object.defineProperty(..., { get, configurable: false })), so
// jest.spyOn(moduleNamespace, 'startShellPrefsSync') cannot redefine the
// property. This narrow mock keeps every other export real (getShellPref,
// setShellPref, useShellPref, __resetShellPrefsForTests all run the actual
// implementation) and only wraps startShellPrefsSync in a jest.fn that still
// calls through, so it can be asserted on like a spy.
jest.mock('@/lib/shell-prefs', () => {
  const actual = jest.requireActual('@/lib/shell-prefs')
  return { ...actual, startShellPrefsSync: jest.fn(actual.startShellPrefsSync) }
})

const leftRailCalls: any[] = []
const rightRailCalls: any[] = []

jest.mock('../LeftPanelRail', () => ({
  RAIL_WIDTH: 44,
  LeftPanelRail: (props: any) => {
    leftRailCalls.push(props)
    return (
      <div data-testid="left-rail" data-collapsed={String(props.collapsed)} data-width={props.columnWidth}>
        {!props.collapsed && <div data-testid="left-rail-body">LEFT BODY</div>}
      </div>
    )
  },
}))

jest.mock('../RightPanelRail', () => ({
  RightPanelRail: (props: any) => {
    rightRailCalls.push(props)
    return (
      <div
        data-testid="right-rail"
        data-collapsed={String(props.collapsed)}
        data-width={props.columnWidth}
        data-solo={props.soloPanelId ?? ''}
      >
        {!props.collapsed && <div data-testid="right-rail-body">RIGHT BODY</div>}
      </div>
    )
  },
}))

jest.mock('../QuickOpenPalette', () => ({ QuickOpenPalette: () => <div data-testid="quick-open" /> }))
jest.mock('../search/UnifiedSearch', () => ({ UnifiedSearch: () => <div data-testid="unified-search" /> }))
jest.mock('../UserMenu', () => ({ UserMenu: () => <div data-testid="user-menu" /> }))
jest.mock('../bobbins', () => ({ BobbinManagerPopover: () => <div data-testid="bobbin-manager" /> }))

// A macrotask tick — extensionRegistry's slot-change notifications are
// throttled through setTimeout(0), so tests that register a contribution
// must let that timer fire before asserting the shell re-subscribed.
async function tick() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

let registeredBobbins: string[] = []

function registerRightPanel(bobbinId: string, id: string, revealOn: string[]) {
  extensionRegistry.registerExtension(bobbinId, {
    slot: 'shell.rightPanel',
    type: 'panel',
    id,
    title: id,
    revealOn,
  })
  registeredBobbins.push(bobbinId)
  return `${bobbinId}.${id}`
}

beforeEach(() => {
  localStorage.clear()
  __resetShellPrefsForTests()
  leftRailCalls.length = 0
  rightRailCalls.length = 0
  registeredBobbins = []
  jest.restoreAllMocks()
  ;(startShellPrefsSync as jest.Mock).mockClear()
})

afterEach(() => {
  for (const bobbinId of registeredBobbins) extensionRegistry.unregisterBobbin(bobbinId)
})

describe('ShellLayout', () => {
  it('renders panel widths and collapsed state from stored preferences', () => {
    setShellPref('panelWidth', 'left', 321)
    setShellPref('panelWidth', 'right', 410)
    setShellPref('panelCollapsed', 'left', true)
    setShellPref('panelCollapsed', 'right', false)

    render(<ShellLayout>content</ShellLayout>)

    const lastLeft = leftRailCalls.at(-1)
    const lastRight = rightRailCalls.at(-1)
    expect(lastLeft.columnWidth).toBe(321)
    expect(lastLeft.collapsed).toBe(true)
    expect(lastRight.columnWidth).toBe(410)
    expect(lastRight.collapsed).toBe(false)
  })

  it('toggling a panel collapse writes the preference and stops rendering the panel body', () => {
    const { getByTitle, queryByTestId } = render(<ShellLayout>content</ShellLayout>)

    expect(getShellPref('panelCollapsed', 'left', false)).toBe(false)
    expect(queryByTestId('left-rail-body')).toBeInTheDocument()

    act(() => { fireEvent.click(getByTitle('Toggle left panel')) })

    expect(getShellPref('panelCollapsed', 'left', false)).toBe(true)
    expect(queryByTestId('left-rail-body')).not.toBeInTheDocument()
  })

  it('starts the shell-prefs sync exactly once with the token when apiToken is present', () => {
    const spy = startShellPrefsSync as jest.Mock

    render(<ShellLayout context={{ apiToken: 'tok-123' }}>content</ShellLayout>)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('tok-123')
  })

  it('does not start the shell-prefs sync when apiToken is absent', () => {
    const spy = startShellPrefsSync as jest.Mock

    render(<ShellLayout context={{}}>content</ShellLayout>)

    expect(spy).not.toHaveBeenCalled()
  })

  it('reveals the right panel and replays the event when a registered revealOn fires', async () => {
    render(<ShellLayout>content</ShellLayout>)

    const panelId = registerRightPanel('reveal-bobbin', 'preview', ['bobbinry:test-reveal'])
    await tick()

    const revealListener = jest.fn()
    window.addEventListener('bobbinry:reveal-panel', revealListener)

    act(() => {
      window.dispatchEvent(new CustomEvent('bobbinry:test-reveal', { detail: { foo: 'bar' } }))
    })

    expect(revealListener).toHaveBeenCalledTimes(1)
    const detail = revealListener.mock.calls[0][0].detail
    expect(detail.slotId).toBe('shell.rightPanel')
    expect(detail.panelId).toBe(panelId)
    expect(detail.replay).toEqual({ type: 'bobbinry:test-reveal', detail: { foo: 'bar' } })

    window.removeEventListener('bobbinry:reveal-panel', revealListener)
  })

  describe('focus mode', () => {
    it('hides the top-bar chrome on entry and restores it on Escape', () => {
      const { container } = render(<ShellLayout>content</ShellLayout>)
      const header = container.querySelector('header')!
      expect(header.className).toContain('h-12')

      act(() => {
        window.dispatchEvent(new CustomEvent('bobbinry:request-focus-mode', { detail: { active: true } }))
      })
      expect(header.className).toContain('h-0')
      expect(header.className).toContain('opacity-0')

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      })
      expect(header.className).toContain('h-12')
    })

    it('floats the declared panel via soloPanelId when an editor-sourced reveal fires in focus mode', async () => {
      render(<ShellLayout>content</ShellLayout>)

      const panelId = registerRightPanel('editor-bobbin', 'inline-preview', ['bobbinry:test-reveal-editor'])
      await tick()

      act(() => {
        window.dispatchEvent(new CustomEvent('bobbinry:request-focus-mode', { detail: { active: true } }))
      })

      act(() => {
        window.dispatchEvent(new CustomEvent('bobbinry:test-reveal-editor', { detail: { source: 'editor' } }))
      })

      expect(rightRailCalls.at(-1).soloPanelId).toBe(panelId)
    })
  })

  it('re-subscribes to a newly registered contribution after the first render', async () => {
    render(<ShellLayout>content</ShellLayout>)

    const revealListener = jest.fn()
    window.addEventListener('bobbinry:reveal-panel', revealListener)

    // Not registered yet — the event should be a no-op.
    act(() => {
      window.dispatchEvent(new CustomEvent('bobbinry:test-reveal-late', { detail: {} }))
    })
    expect(revealListener).not.toHaveBeenCalled()

    const panelId = registerRightPanel('late-bobbin', 'late-preview', ['bobbinry:test-reveal-late'])
    await tick()

    act(() => {
      window.dispatchEvent(new CustomEvent('bobbinry:test-reveal-late', { detail: {} }))
    })

    expect(revealListener).toHaveBeenCalledTimes(1)
    expect(revealListener.mock.calls[0][0].detail.panelId).toBe(panelId)

    window.removeEventListener('bobbinry:reveal-panel', revealListener)
  })
})
