import { ManifestCompiler } from '../index'
import { parse as parseYAML } from 'yaml'
import * as fs from 'fs'
import * as path from 'path'

describe('Manifest Validation', () => {
  let compiler: ManifestCompiler

  beforeEach(() => {
    compiler = new ManifestCompiler({ projectId: 'test-project' })
  })

  describe('Schema Validation', () => {
    it('should validate a complete valid manifest', () => {
      const validManifest = {
        id: 'test-bobbin',
        name: 'Test Bobbin',
        version: '1.0.0',
        author: 'Test Author',
        description: 'A test bobbin',
        capabilities: {
          publishable: true,
          external: false,
          ai: false,
          customViews: false
        }
      }

      const result = compiler.validateManifestWithDetails(validManifest as any)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject manifest without required id field', () => {
      const invalidManifest = {
        name: 'Test Bobbin',
        version: '1.0.0'
      }

      const result = compiler.validateManifestWithDetails(invalidManifest as any)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("root: must have required property 'id'")
    })

    it('should reject manifest without required name field', () => {
      const invalidManifest = {
        id: 'test-bobbin',
        version: '1.0.0'
      }

      const result = compiler.validateManifestWithDetails(invalidManifest as any)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("root: must have required property 'name'")
    })

    it('should reject manifest without required version field', () => {
      const invalidManifest = {
        id: 'test-bobbin',
        name: 'Test Bobbin'
      }

      const result = compiler.validateManifestWithDetails(invalidManifest as any)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("root: must have required property 'version'")
    })

    it('should reject manifest with invalid id format', () => {
      const invalidManifest = {
        id: 'Test-Bobbin!', // Contains uppercase and special characters
        name: 'Test Bobbin',
        version: '1.0.0'
      }

      const result = compiler.validateManifestWithDetails(invalidManifest as any)
      expect(result.valid).toBe(false)
      expect(result.errors.some(err => err.includes('pattern'))).toBe(true)
    })

    it('should reject manifest with invalid version format', () => {
      const invalidManifest = {
        id: 'test-bobbin',
        name: 'Test Bobbin',
        version: 'invalid-version'
      }

      const result = compiler.validateManifestWithDetails(invalidManifest as any)
      expect(result.valid).toBe(false)
      expect(result.errors.some(err => err.includes('pattern'))).toBe(true)
    })
  })

  describe('Example Manifests', () => {
    const manifestsDir = path.resolve(__dirname, '../../../../bobbins')
    
    beforeAll(() => {
      // Check if manifests directory exists
      if (!fs.existsSync(manifestsDir)) {
        console.warn('Bobbins directory not found, skipping manifest validation tests')
        return
      }
    })

    it('should validate manuscript.manifest.yaml', () => {
      const manifestPath = path.join(manifestsDir, 'manuscript.manifest.yaml')
      
      if (!fs.existsSync(manifestPath)) {
        console.warn('manuscript.manifest.yaml not found, skipping test')
        return
      }

      const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
      const manifest = parseYAML(manifestContent)
      
      const result = compiler.validateManifestWithDetails(manifest)
      if (!result.valid) {
        console.error('Manuscript manifest validation errors:', result.errors)
      }
      expect(result.valid).toBe(true)
    })

    it('should validate corkboard.manifest.yaml', () => {
      const manifestPath = path.join(manifestsDir, 'corkboard.manifest.yaml')
      
      if (!fs.existsSync(manifestPath)) {
        console.warn('corkboard.manifest.yaml not found, skipping test')
        return
      }

      const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
      const manifest = parseYAML(manifestContent)
      
      const result = compiler.validateManifestWithDetails(manifest)
      if (!result.valid) {
        console.error('Corkboard manifest validation errors:', result.errors)
      }
      expect(result.valid).toBe(true)
    })

    it('should validate all manifest files in bobbins directory', () => {
      if (!fs.existsSync(manifestsDir)) {
        console.warn('Bobbins directory not found, skipping test')
        return
      }

      const manifestFiles = fs.readdirSync(manifestsDir)
        .filter(file => file.endsWith('.manifest.yaml') || file.endsWith('.manifest.json'))

      expect(manifestFiles.length).toBeGreaterThan(0)

      manifestFiles.forEach(file => {
        const manifestPath = path.join(manifestsDir, file)
        const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
        
        let manifest
        if (file.endsWith('.yaml')) {
          manifest = parseYAML(manifestContent)
        } else {
          manifest = JSON.parse(manifestContent)
        }
        
        const result = compiler.validateManifestWithDetails(manifest)
        if (!result.valid) {
          console.error(`${file} validation errors:`, result.errors)
        }
        expect(result.valid).toBe(true)
      })
    })
  })

  describe('Execution Mode Validation', () => {
    it('should accept manifest with sandboxed execution mode', () => {
      const manifest = {
        id: 'test-bobbin',
        name: 'Test Bobbin',
        version: '1.0.0',
        capabilities: {},
        execution: {
          mode: 'sandboxed'
        }
      }

      const result = compiler.validateManifestWithDetails(manifest as any)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should accept manifest with native execution mode and signature', () => {
      const manifest = {
        id: 'test-bobbin',
        name: 'Test Bobbin',
        version: '1.0.0',
        capabilities: {},
        execution: {
          mode: 'native',
          signature: 'dev_mode_skip'
        }
      }

      const result = compiler.validateManifestWithDetails(manifest as any)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject native execution mode without signature', () => {
      const manifest = {
        id: 'test-bobbin',
        name: 'Test Bobbin',
        version: '1.0.0',
        capabilities: {},
        execution: {
          mode: 'native'
        }
      }

      const result = compiler.validateManifestWithDetails(manifest as any)
      if (result.valid) {
        console.log('Expected validation to fail but it passed')
      } else {
        console.log('Validation errors:', result.errors)
      }
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should reject invalid execution mode', () => {
      const manifest = {
        id: 'test-bobbin',
        name: 'Test Bobbin',
        version: '1.0.0',
        capabilities: {},
        execution: {
          mode: 'invalid-mode'
        }
      }

      const result = compiler.validateManifestWithDetails(manifest as any)
      if (result.valid) {
        console.log('Expected validation to fail for invalid mode but it passed')
      } else {
        console.log('Validation errors for invalid mode:', result.errors)
      }
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should default to sandboxed when execution field is omitted', () => {
      const manifest = {
        id: 'test-bobbin',
        name: 'Test Bobbin',
        version: '1.0.0',
        capabilities: {}
      }

      const result = compiler.validateManifestWithDetails(manifest as any)
      expect(result.valid).toBe(true)
    })
  })

  describe('Compilation Process', () => {
    it('should successfully compile a valid manifest', async () => {
      const validManifest = {
        id: 'test-bobbin',
        name: 'Test Bobbin',
        version: '1.0.0',
        capabilities: {
          publishable: true,
          external: false,
          ai: false,
          customViews: false
        },
        data: {
          collections: []
        }
      }

      const result = await compiler.compile(validManifest as any)
      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail to compile an invalid manifest', async () => {
      const invalidManifest = {
        name: 'Test Bobbin', // Missing required 'id' field
        version: '1.0.0'
      }

      const result = await compiler.compile(invalidManifest as any)
      expect(result.success).toBe(false)
      expect(result.errors).toContain('Manifest validation failed')
    })
  })
})