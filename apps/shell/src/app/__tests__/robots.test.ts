import robots from '../robots'

function rulesList() {
  const { rules } = robots()
  return Array.isArray(rules) ? rules : [rules]
}

describe('robots', () => {
  it('asks AI-training crawlers to stay out of the whole site, as /ai-policy promises', () => {
    const aiRule = rulesList().find(
      rule => Array.isArray(rule.userAgent) && rule.userAgent.includes('GPTBot')
    )

    expect(aiRule?.disallow).toBe('/')
    expect(aiRule?.userAgent).toEqual(
      expect.arrayContaining([
        'GPTBot',
        'ClaudeBot',
        'CCBot',
        'Google-Extended',
        'Applebot-Extended',
        'Bytespider',
        'meta-externalagent',
      ])
    )
  })

  it('leaves ordinary search crawlers on the public site', () => {
    const everyone = rulesList().find(rule => rule.userAgent === '*')

    expect(everyone?.allow).toBe('/')
    expect(everyone?.disallow).not.toContain('/read/')
  })
})
