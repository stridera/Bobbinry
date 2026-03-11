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

      // Collect all manifests: root-level .manifest.yaml and subdirectory manifest.yaml
      const entries = fs.readdirSync(manifestsDir, { withFileTypes: true })
      const manifestPaths: { label: string; filePath: string }[] = []

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subManifest = path.join(manifestsDir, entry.name, 'manifest.yaml')
          if (fs.existsSync(subManifest)) {
            manifestPaths.push({ label: `${entry.name}/manifest.yaml`, filePath: subManifest })
          }
        } else if (entry.name.endsWith('.manifest.yaml') || entry.name.endsWith('.manifest.json')) {
          manifestPaths.push({ label: entry.name, filePath: path.join(manifestsDir, entry.name) })
        }
      }

      expect(manifestPaths.length).toBeGreaterThan(0)

      manifestPaths.forEach(({ label, filePath }) => {
        const manifestContent = fs.readFileSync(filePath, 'utf-8')

        let manifest
        if (filePath.endsWith('.yaml')) {
          manifest = parseYAML(manifestContent)
        } else {
          manifest = JSON.parse(manifestContent)
        }

        const result = compiler.validateManifestWithDetails(manifest)
        if (!result.valid) {
          console.error(`${label} validation errors:`, result.errors)
        }
        expect(result.valid).toBe(true)
      })
    })

    it('should ensure every bobbin directory has a discoverable manifest', () => {
      if (!fs.existsSync(manifestsDir)) {
        console.warn('Bobbins directory not found, skipping test')
        return
      }

      const entries = fs.readdirSync(manifestsDir, { withFileTypes: true })
      const bobbinDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'))
      const missing: string[] = []

      for (const dir of bobbinDirs) {
        const subManifest = path.join(manifestsDir, dir.name, 'manifest.yaml')
        const rootManifest = path.join(manifestsDir, `${dir.name}.manifest.yaml`)

        if (!fs.existsSync(subManifest) && !fs.existsSync(rootManifest)) {
          missing.push(dir.name)
        }
      }

      if (missing.length > 0) {
        console.error(
          `Bobbin directories without manifest files: ${missing.join(', ')}. ` +
          `Each bobbin must have either bobbins/<name>.manifest.yaml or bobbins/<name>/manifest.yaml`
        )
      }
      expect(missing).toEqual([])
    })
  })

  describe('Execution Mode Validation', () => {
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

    it('should accept native execution mode without signature (schema validation only)', () => {
      const manifest = {
        id: 'test-bobbin',
        name: 'Test Bobbin',
        version: '1.0.0',
        capabilities: {},
        execution: {
          mode: 'native'
        }
      }

      // Schema validation should pass - signature enforcement happens in verifySignature()
      const result = compiler.validateManifestWithDetails(manifest as any)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
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

    it('should allow manifest with omitted execution field', () => {
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
