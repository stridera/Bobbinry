/**
 * Tests for signature verification of native bobbins
 */

import { ManifestCompiler } from '../index'
import type { Manifest } from '@bobbinry/types'

describe('Signature Verification', () => {
  let compiler: ManifestCompiler
  const originalEnv = process.env.NODE_ENV

  beforeEach(() => {
    compiler = new ManifestCompiler({ projectId: 'test-project' })
  })

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })

  const createNativeManifest = (signature?: string): Manifest => ({
    id: 'test-native',
    name: 'Test Native Bobbin',
    version: '1.0.0',
    author: 'Test',
    description: 'Test native bobbin',
    capabilities: {},
    execution: {
      mode: 'native',
      ...(signature !== undefined && { signature })
    }
  })

  const createSandboxedManifest = (): Manifest => ({
    id: 'test-sandboxed',
    name: 'Test Sandboxed Bobbin',
    version: '1.0.0',
    author: 'Test',
    description: 'Test sandboxed bobbin',
    capabilities: {},
    execution: {
      mode: 'sandboxed'
    }
  })

  describe('Development Mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development'
    })

    it('should accept dev_mode_skip signature for native bobbins', async () => {
      const manifest = createNativeManifest('dev_mode_skip')
      const result = await compiler.compile(manifest)

      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.warnings.some(w => w.includes('dev_mode_skip signature - this is only allowed in development'))).toBe(true)
    })

    it('should accept native bobbin without signature in dev (with warning)', async () => {
      const manifest = createNativeManifest()
      delete manifest.execution?.signature
      const result = await compiler.compile(manifest)

      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.warnings.some(w => w.includes('has no signature - this would fail in production'))).toBe(true)
    })

    it('should not require signature for sandboxed bobbins', async () => {
      const manifest = createSandboxedManifest()
      const result = await compiler.compile(manifest)

      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('Production Mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production'
    })

    it('should reject native bobbin without signature', async () => {
      const manifest = createNativeManifest()
      delete manifest.execution?.signature
      const result = await compiler.compile(manifest)

      expect(result.success).toBe(false)
      expect(result.errors.some(e => e.includes('requires a valid Ed25519 signature in production'))).toBe(true)
    })

    it('should reject native bobbin with dev_mode_skip in production', async () => {
      const manifest = createNativeManifest('dev_mode_skip')
      const result = await compiler.compile(manifest)

      expect(result.success).toBe(false)
      expect(result.errors.some(e => e.includes('cannot use dev_mode_skip signature in production'))).toBe(true)
    })

    it('should reject native bobbin with invalid signature', async () => {
      const manifest = createNativeManifest('invalid-signature-string')
      const result = await compiler.compile(manifest)

      expect(result.success).toBe(false)
      // Should get an error about signature parsing or validation
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should not require signature for sandboxed bobbins', async () => {
      const manifest = createSandboxedManifest()
      const result = await compiler.compile(manifest)

      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('Test Mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test'
    })

    it('should treat test mode like development mode', async () => {
      const manifest = createNativeManifest('dev_mode_skip')
      const result = await compiler.compile(manifest)

      expect(result.success).toBe(true)
      expect(result.warnings.some(w => w.includes('dev_mode_skip signature - this is only allowed in development'))).toBe(true)
    })
  })

  describe('Manifest without execution field', () => {
    it('should pass validation when execution field is omitted', async () => {
      const manifest: Manifest = {
        id: 'test-no-execution',
        name: 'Test No Execution',
        version: '1.0.0',
        author: 'Test',
        description: 'Test without execution field',
        capabilities: {}
      }

      const result = await compiler.compile(manifest)
      expect(result.success).toBe(true)
    })
  })
})
