/**
 * The right rail hosts every bobbin's contextual panel. Its load-bearing
 * promises, carried over from the stacked layout it replaced:
 *
 *  1. Every panel stays mounted. Unmounting would kill a writing session in
 *     progress or drop an unsaved note every time the writer glances away.
 *  2. Solo mode (focus mode's floating reference) never writes the saved
 *     arrangement. It is a temporary view, not a change the user made.
 *  3. Pinning moves a panel to the lower pane without remounting it.
 */

import { render, screen, act, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useSyncExternalStore } from 'react'
import { usePanelBadge } from '@bobbinry/sdk'
import { RightPanelRail } from '../RightPanelRail'

const registry = {
  extensions: [] as any[],
  getExtensionsForSlot: jest.fn(() => registry.extensions),
  onSlotChange: jest.fn(() => () => {}),
}

jest.mock('@/lib/extensions', () => ({
  extensionRegistry: {
    getExtensionsForSlot: (...args: any[]) => registry.getExtensionsForSlot(...args),
    onSlotChange: (...args: any[]) => registry.onSlotChange(...args),
  },
}))

jest.mock('../ExtensionProvider', () => ({
  useExtensions: () => ({ extensions: registry.extensions }),
}))

// A tiny external store stands in for the feedback panel's fetched data.
const badgeStore = {
  count: 0,
  listeners: new Set<() => void>(),
  set(n: number) {
    badgeStore.count = n
    badgeStore.listeners.forEach(l => l())
  },
  subscribe(l: () => void) {
    badgeStore.listeners.add(l)
    return () => badgeStore.listeners.delete(l)
  },
}

function FeedbackBody() {
  const count = useSyncExternalStore(badgeStore.subscribe, () => badgeStore.count)
  usePanelBadge(count > 0 ? { count, tone: 'attention' } : null)
  return <div>FEEDBACK BODY</div>
}

function ext(id: string, title: string, body: React.ReactNode, icon?: string) {
  const Component = () => <>{body}</>
  return {
    id,
    bobbinId: id.split('.')[0],
    contribution: { slot: 'shell.rightPanel', type: 'panel', id, title, icon },
    component: Component,
  }
}

const PANELS = [
  ext('entities.entity-preview', 'Entity Preview', <div>PREVIEW BODY</div>, 'eye'),
  ext('notes.chapter-notes', 'Chapter Notes', <div>NOTES BODY</div>, 'note'),
  ext('bookworm-siege.panel', 'Bookworm Siege', <div>SIEGE BODY</div>, 'castle'),
  ext('feedback.reader-feedback', 'Reader Feedback', <FeedbackBody />, 'message'),
]

function renderRail(props: Partial<React.ComponentProps<typeof RightPanelRail>> = {}) {
  return render(
    <RightPanelRail
      collapsed={false}
      columnWidth={320}
      animate={false}
      onToggleCollapse={() => {}}
      {...props}
    />
  )
}

function stateOf(text: string) {
  return screen.getByText(text).closest('[data-panel-id]')?.getAttribute('data-panel-state')
}

beforeEach(() => {
  localStorage.clear()
  registry.extensions = PANELS
  badgeStore.count = 0
})

describe('RightPanelRail', () => {
  it('mounts every panel and shows only the active one', () => {
    renderRail()
    expect(screen.getByText('PREVIEW BODY')).toBeInTheDocument()
    expect(screen.getByText('NOTES BODY')).toBeInTheDocument()
    expect(screen.getByText('SIEGE BODY')).toBeInTheDocument()
    expect(stateOf('PREVIEW BODY')).toBe('active')
    expect(stateOf('NOTES BODY')).toBe('hidden')
    expect(stateOf('SIEGE BODY')).toBe('hidden')
  })

  it('switches the active panel from the rail without remounting anything', () => {
    renderRail()
    const siegeNode = screen.getByText('SIEGE BODY')
    fireEvent.click(screen.getByRole('tab', { name: 'Chapter Notes' }))
    expect(stateOf('NOTES BODY')).toBe('active')
    expect(stateOf('PREVIEW BODY')).toBe('hidden')
    expect(screen.getByText('SIEGE BODY')).toBe(siegeNode)
    expect(localStorage.getItem('shellRightRail:active')).toBe('notes.chapter-notes')
  })

  it('collapses when the active tab is clicked again', () => {
    const onToggleCollapse = jest.fn()
    renderRail({ onToggleCollapse })
    fireEvent.click(screen.getByRole('tab', { name: 'Entity Preview' }))
    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
  })

  it('pins a panel below and brings the next panel up, preserving nodes', () => {
    renderRail()
    const previewNode = screen.getByText('PREVIEW BODY')
    fireEvent.click(screen.getByRole('button', { name: 'Pin Entity Preview below' }))

    expect(stateOf('PREVIEW BODY')).toBe('pinned')
    expect(stateOf('NOTES BODY')).toBe('active')
    expect(screen.getByText('PREVIEW BODY')).toBe(previewNode)
    expect(screen.getByRole('separator', { name: 'Resize panes' })).toBeInTheDocument()
    expect(localStorage.getItem('shellRightRail:pinned')).toBe('entities.entity-preview')

    // Unpinning brings it back to the upper pane.
    fireEvent.click(screen.getByRole('button', { name: 'Unpin Entity Preview' }))
    expect(stateOf('PREVIEW BODY')).toBe('active')
    expect(stateOf('NOTES BODY')).toBe('hidden')
    expect(localStorage.getItem('shellRightRail:pinned')).toBeNull()
  })

  it('activates a panel on bobbinry:reveal-panel, but leaves a pinned one alone', () => {
    localStorage.setItem('shellRightRail:pinned', 'notes.chapter-notes')
    renderRail()
    expect(stateOf('NOTES BODY')).toBe('pinned')

    act(() => {
      window.dispatchEvent(new CustomEvent('bobbinry:reveal-panel', {
        detail: { slotId: 'shell.rightPanel', panelId: 'bookworm-siege.panel' },
      }))
    })
    expect(stateOf('SIEGE BODY')).toBe('active')

    act(() => {
      window.dispatchEvent(new CustomEvent('bobbinry:reveal-panel', {
        detail: { slotId: 'shell.rightPanel', panelId: 'notes.chapter-notes' },
      }))
    })
    expect(stateOf('NOTES BODY')).toBe('pinned')
    expect(stateOf('SIEGE BODY')).toBe('active')
  })

  it('falls back from a stale saved id without overwriting the preference', () => {
    localStorage.setItem('shellRightRail:active', 'uninstalled.panel')
    renderRail()
    expect(stateOf('PREVIEW BODY')).toBe('active')
    expect(localStorage.getItem('shellRightRail:active')).toBe('uninstalled.panel')
  })

  it('shows a badge on the rail for a panel that is not on screen', () => {
    renderRail()
    expect(stateOf('FEEDBACK BODY')).toBe('hidden')
    act(() => badgeStore.set(7))
    const tab = screen.getByRole('tab', { name: 'Reader Feedback, 7 pending' })
    expect(tab).toHaveTextContent('7')
    act(() => badgeStore.set(0))
    expect(screen.getByRole('tab', { name: 'Reader Feedback' })).not.toHaveTextContent('7')
  })

  it('removes the retired stacked-layout keys', () => {
    localStorage.setItem('panelLayout:shell.rightPanel', '{}')
    localStorage.setItem('panelLayout:shell.rightPanel:manuscript', '{}')
    localStorage.setItem('panelLayout:shell.leftPanel', 'keep')
    renderRail()
    expect(localStorage.getItem('panelLayout:shell.rightPanel')).toBeNull()
    expect(localStorage.getItem('panelLayout:shell.rightPanel:manuscript')).toBeNull()
    expect(localStorage.getItem('panelLayout:shell.leftPanel')).toBe('keep')
  })

  describe('solo mode', () => {
    it('renders one chromeless panel, keeps the rest mounted, and writes nothing', () => {
      const setItem = jest.spyOn(Storage.prototype, 'setItem')
      renderRail({ soloPanelId: 'entities.entity-preview' })

      expect(stateOf('PREVIEW BODY')).toBe('active')
      expect(stateOf('NOTES BODY')).toBe('hidden')
      expect(screen.getByText('NOTES BODY')).toBeInTheDocument()
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Pin/ })).not.toBeInTheDocument()
      expect(setItem).not.toHaveBeenCalled()
      setItem.mockRestore()
    })

    it('preserves panel instances across entering and leaving solo mode', () => {
      const { rerender } = renderRail()
      const notesNode = screen.getByText('NOTES BODY')
      const common = { collapsed: false, columnWidth: 320, animate: false, onToggleCollapse: () => {} }

      rerender(<RightPanelRail {...common} soloPanelId="entities.entity-preview" />)
      expect(screen.getByText('NOTES BODY')).toBe(notesNode)

      rerender(<RightPanelRail {...common} />)
      expect(screen.getByText('NOTES BODY')).toBe(notesNode)
      expect(screen.getByRole('tablist')).toBeInTheDocument()
    })
  })
})
