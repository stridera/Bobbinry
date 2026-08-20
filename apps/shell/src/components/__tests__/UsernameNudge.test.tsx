import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { UsernameNudge } from '../UsernameNudge'

describe('UsernameNudge', () => {
  it('links to settings so the author can choose a username', () => {
    render(<UsernameNudge />)
    expect(screen.getByRole('status')).toHaveTextContent(/set a username/i)
    expect(screen.getByRole('link', { name: /choose a username/i })).toHaveAttribute('href', '/settings')
  })
})
