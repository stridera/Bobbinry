/**
 * ViewRouter listens for bobbinry:navigate events, resolves the target view
 * through viewRegistry, and loads its component. The `active` state pairs a
 * loaded Component with the navigation it was loaded for, so an in-flight
 * view swap never hands a stale component the new target's props.
 */

import { render, screen, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useEffect } from 'react'
import { viewRegistry, type ViewRegistryEntry } from '@/lib/view-registry'
import { __resetShellPrefsForTests, getShellPref, setShellPref } from '@/lib/shell-prefs'
import { ViewRouter } from '../ViewRouter'

jest.mock('@/hooks/useBreadcrumb', () => ({
  useBreadcrumb: () => [],
}))

const sdk = {} as any

function flush() {
  return act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function navigate(detail: Record<string, unknown>) {
  return act(async () => {
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', { detail }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** A fake view component that logs every props object it renders with and its mount/unmount events. */
function trackingComponent(testId: string) {
  const propsLog: any[] = []
  const events: string[] = []
  function Comp(props: any) {
    propsLog.push(props)
    useEffect(() => {
      events.push('mount')
      return () => { events.push('unmount') }
    }, [])
    return <div data-testid={testId} />
  }
  return { Comp, propsLog, events }
}

/** A componentLoader whose promises resolve on demand, to test the in-flight window. */
function deferredLoader(Comp: React.ComponentType<any>) {
  const resolvers: Array<() => void> = []
  const loader = jest.fn(() => new Promise<React.ComponentType<any>>(resolve => {
    resolvers.push(() => resolve(Comp))
  }))
  return { loader, resolveNext: () => resolvers.shift()?.() }
}

function baseEntry(overrides: Partial<ViewRegistryEntry> & Pick<ViewRegistryEntry, 'viewId' | 'bobbinId' | 'componentLoader'>): ViewRegistryEntry {
  return {
    capabilities: [],
    metadata: { name: overrides.viewId, type: 'custom', source: 'test' },
    ...overrides,
  }
}

beforeEach(() => {
  viewRegistry.clear()
  localStorage.clear()
  __resetShellPrefsForTests()
  // jsdom's window persists across tests in this file; a leftover
  // history.state from a prior test's navigate would otherwise be replayed
  // on the next mount.
  window.history.replaceState(null, '', '/')
})

describe('ViewRouter', () => {
  it('loads the single registered view for an entity type and renders it with the event props', async () => {
    const { Comp, propsLog } = trackingComponent('widget-view')
    viewRegistry.register(baseEntry({
      viewId: 'proj.widget', bobbinId: 'proj', handlers: ['widget'],
      componentLoader: () => Promise.resolve(Comp),
    }))

    render(<ViewRouter projectId="p1" sdk={sdk} />)
    await navigate({ entityType: 'widget', entityId: 'w-1', bobbinId: 'proj', metadata: { foo: 'bar' } })

    expect(screen.getByTestId('widget-view')).toBeInTheDocument()
    expect(propsLog.at(-1)).toMatchObject({
      entityType: 'widget', entityId: 'w-1', bobbinId: 'proj', metadata: { foo: 'bar' },
    })
  })

  it('never hands the outgoing view the incoming target while its replacement is still loading', async () => {
    const { Comp: CompA, propsLog: propsA } = trackingComponent('view-a')
    const { Comp: CompB, propsLog: propsB } = trackingComponent('view-b')
    const loaderA = deferredLoader(CompA)
    const loaderB = deferredLoader(CompB)

    viewRegistry.register(baseEntry({ viewId: 'bobbin-a.container', bobbinId: 'bobbin-a', handlers: ['container'], componentLoader: loaderA.loader }))
    viewRegistry.register(baseEntry({ viewId: 'bobbin-b.notes', bobbinId: 'bobbin-b', handlers: ['notes'], componentLoader: loaderB.loader }))

    render(<ViewRouter projectId="p1" sdk={sdk} />)
    await navigate({ entityType: 'container', entityId: 'uuid-1', bobbinId: 'bobbin-a' })
    await act(async () => { loaderA.resolveNext(); await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByTestId('view-a')).toBeInTheDocument()

    // View B's loader is left pending here — assert A never sees uuid-2.
    await navigate({ entityType: 'notes', entityId: 'uuid-2', bobbinId: 'bobbin-b' })
    expect(propsA.some(p => p.entityId === 'uuid-2')).toBe(false)
    expect(screen.queryByTestId('view-a')).not.toBeInTheDocument()

    await act(async () => { loaderB.resolveNext(); await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByTestId('view-b')).toBeInTheDocument()
    expect(propsB.at(-1)).toMatchObject({ entityId: 'uuid-2' })
  })

  it('keeps the same-view component mounted for a new target and swaps its props once loaded', async () => {
    const { Comp, propsLog, events } = trackingComponent('view-a')
    const loader = deferredLoader(Comp)
    viewRegistry.register(baseEntry({ viewId: 'bobbin-a.container', bobbinId: 'bobbin-a', handlers: ['container'], componentLoader: loader.loader }))

    render(<ViewRouter projectId="p1" sdk={sdk} />)
    await navigate({ entityType: 'container', entityId: 'uuid-1', bobbinId: 'bobbin-a' })
    await act(async () => { loader.resolveNext(); await Promise.resolve(); await Promise.resolve() })
    expect(events).toEqual(['mount'])

    await navigate({ entityType: 'container', entityId: 'uuid-3', bobbinId: 'bobbin-a' })
    // Same view, new target still loading — component stays up, not unmounted.
    expect(events).toEqual(['mount'])
    expect(screen.getByTestId('view-a')).toBeInTheDocument()

    await act(async () => { loader.resolveNext(); await Promise.resolve(); await Promise.resolve() })
    expect(events).toEqual(['mount'])
    expect(propsLog.at(-1)).toMatchObject({ entityId: 'uuid-3' })
  })

  it('honors a saved view preference among siblings, but ignores a preference pointing at a wildcard view', async () => {
    const outline = trackingComponent('outline')
    const table = trackingComponent('table')
    const dashboard = trackingComponent('dashboard')

    viewRegistry.register(baseEntry({ viewId: 'sib.outline', bobbinId: 'sib', handlers: ['chapter'], priority: 10, componentLoader: () => Promise.resolve(outline.Comp) }))
    viewRegistry.register(baseEntry({ viewId: 'sib.table', bobbinId: 'sib', handlers: ['chapter'], priority: 5, componentLoader: () => Promise.resolve(table.Comp) }))
    viewRegistry.register(baseEntry({ viewId: 'sib.dashboard', bobbinId: 'sib', handlers: ['*'], priority: 1, componentLoader: () => Promise.resolve(dashboard.Comp) }))

    setShellPref('viewPreferences', 'chapter', 'sib.table')
    render(<ViewRouter projectId="p1" sdk={sdk} />)
    await navigate({ entityType: 'chapter', entityId: 'ch-1', bobbinId: 'sib' })
    expect(screen.getByTestId('table')).toBeInTheDocument()

    // A preference recorded for a wildcard view (handlers: ['*']) must not
    // hijack default navigation — falls back to the highest-priority sibling.
    setShellPref('viewPreferences', 'chapter', 'sib.dashboard')
    await navigate({ entityType: 'chapter', entityId: 'ch-2', bobbinId: 'sib' })
    expect(screen.getByTestId('outline')).toBeInTheDocument()
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument()
  })

  it('writes lastNav for the project and for project:bobbinId with only nav fields, stripping extras', async () => {
    const { Comp } = trackingComponent('view-x')
    viewRegistry.register(baseEntry({ viewId: 'x.view', bobbinId: 'x', handlers: ['thing'], componentLoader: () => Promise.resolve(Comp) }))

    render(<ViewRouter projectId="proj-1" sdk={sdk} />)
    await navigate({ entityType: 'thing', entityId: 't-1', bobbinId: 'x', metadata: { note: 'hi' }, stray: 'drop-me' })

    const expected = { entityType: 'thing', entityId: 't-1', bobbinId: 'x', metadata: { note: 'hi' } }
    expect(getShellPref('lastNav', 'proj-1', null)).toEqual(expected)
    expect(getShellPref('lastNav', 'proj-1:x', null)).toEqual(expected)
  })

  it('hides views that require a real entity when entityId is a non-UUID sentinel', async () => {
    const editor = trackingComponent('editor')
    const list = trackingComponent('list')
    viewRegistry.register(baseEntry({ viewId: 'y.editor', bobbinId: 'y', handlers: ['doc'], requiresEntity: true, priority: 10, componentLoader: () => Promise.resolve(editor.Comp) }))
    viewRegistry.register(baseEntry({ viewId: 'y.list', bobbinId: 'y', handlers: ['doc'], requiresEntity: false, priority: 5, componentLoader: () => Promise.resolve(list.Comp) }))

    render(<ViewRouter projectId="p1" sdk={sdk} />)
    await navigate({ entityType: 'doc', entityId: 'ROOT', bobbinId: 'y' })

    // Only the non-entity view is compatible with the sentinel id, so the tab
    // bar (which needs >1 compatible view) doesn't render — assert via the
    // rendered view choice instead.
    expect(screen.getByTestId('list')).toBeInTheDocument()
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'y.editor' })).not.toBeInTheDocument()

    // With a real UUID, both views are compatible; the tab bar appears and
    // the higher-priority (editor) view is the default.
    await navigate({ entityType: 'doc', entityId: '11111111-2222-4333-8444-555555555555', bobbinId: 'y' })
    await flush()
    expect(screen.getByTestId('editor')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'y.editor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'y.list' })).toBeInTheDocument()
  })
})
