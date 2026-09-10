import { render, screen } from '@testing-library/react'
import AiPolicyPage from '../ai-policy/page'

describe('AiPolicyPage', () => {
  it('states the core commitments', () => {
    render(<AiPolicyPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'AI at Bobbinry' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'No AI runs on your work today' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Rules for any AI feature we add' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: "We don't train on your writing" })).toBeTruthy()
  })
})
