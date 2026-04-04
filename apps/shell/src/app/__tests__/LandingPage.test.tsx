import { render, screen } from '@testing-library/react'
import { LandingPage } from '../LandingPage'

describe('LandingPage', () => {
  it('does not hide major sections when IntersectionObserver is unavailable', () => {
    const originalObserver = global.IntersectionObserver

    delete (global as typeof globalThis & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver

    render(<LandingPage />)

    expect(screen.getByText('One platform, three pillars').closest('.opacity-0')).toBeNull()
    expect(screen.getByText('Powered by Bobbins').closest('.opacity-0')).toBeNull()
    expect(screen.getByText('Ready to start your story?').closest('.opacity-0')).toBeNull()

    global.IntersectionObserver = originalObserver
  })
})
