import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'

describe('SDK Utils', () => {
  describe('Message Bus', () => {
    it('should create a simple message bus', () => {
      class SimpleMessageBus {
        private listeners: Map<string, Function[]> = new Map()

        on(event: string, callback: Function) {
          if (!this.listeners.has(event)) {
            this.listeners.set(event, [])
          }
          this.listeners.get(event)!.push(callback)
        }

        emit(event: string, data: any) {
          const callbacks = this.listeners.get(event) || []
          callbacks.forEach(cb => cb(data))
        }
      }

      const bus = new SimpleMessageBus()
      let received: any = null

      bus.on('test-event', (data: any) => {
        received = data
      })

      bus.emit('test-event', { message: 'hello' })

      expect(received).toEqual({ message: 'hello' })
    })
  })

  describe('API Client', () => {
    it('should construct URL correctly', () => {
      class SimpleAPI {
        constructor(private baseURL: string = 'http://localhost:4100/api') {}

        getProjectURL(projectId: string) {
          return `${this.baseURL}/projects/${projectId}`
        }
      }

      const api = new SimpleAPI('http://test.api/api')
      expect(api.getProjectURL('test-123')).toBe('http://test.api/api/projects/test-123')
    })
  })
})