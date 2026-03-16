/**
 * AI Service — thin client for Anthropic and OpenAI APIs.
 * Uses raw fetch to avoid SDK dependencies in the action runtime.
 */

export type AIProvider = 'anthropic' | 'openai'

export interface AIClientConfig {
  provider: AIProvider
  apiKey: string
  model: string
}

export interface AIResponse {
  text: string
  inputTokens?: number
  outputTokens?: number
  model: string
}

const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
}

export function getDefaultModel(provider: AIProvider): string {
  return DEFAULT_MODELS[provider]
}

export const AVAILABLE_MODELS: Record<AIProvider, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
}

export class AIClient {
  private provider: AIProvider
  private apiKey: string
  private model: string

  constructor(config: AIClientConfig) {
    this.provider = config.provider
    this.apiKey = config.apiKey
    this.model = config.model || getDefaultModel(config.provider)
  }

  async generateText(systemPrompt: string, userPrompt: string): Promise<AIResponse> {
    if (this.provider === 'anthropic') {
      return this.callAnthropic(systemPrompt, userPrompt)
    }
    return this.callOpenAI(systemPrompt, userPrompt)
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.generateText(
        'You are a test assistant.',
        'Reply with exactly: "Connection successful"'
      )
      return { success: result.text.length > 0 }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  private async callAnthropic(systemPrompt: string, userPrompt: string): Promise<AIResponse> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      if (response.status === 401) throw new Error('Invalid API key')
      if (response.status === 429) throw new Error('Rate limit exceeded — try again in a moment')
      throw new Error(`Anthropic API error (${response.status}): ${errBody}`)
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>
      usage: { input_tokens: number; output_tokens: number }
      model: string
    }

    const text = data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')

    return {
      text,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      model: data.model,
    }
  }

  private async callOpenAI(systemPrompt: string, userPrompt: string): Promise<AIResponse> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      if (response.status === 401) throw new Error('Invalid API key')
      if (response.status === 429) throw new Error('Rate limit exceeded — try again in a moment')
      throw new Error(`OpenAI API error (${response.status}): ${errBody}`)
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>
      usage: { prompt_tokens: number; completion_tokens: number }
      model: string
    }

    return {
      text: data.choices?.[0]?.message?.content || '',
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      model: data.model,
    }
  }
}
