import { Manifest } from '@bobbinry/types'
import Ajv from 'ajv'
import { parse as parseYAML } from 'yaml'
import * as fs from 'fs'
import { manifestSchema } from './schema'

export interface CompilerOptions {
  projectId: string
  dryRun?: boolean
}

export interface CompilerResult {
  success: boolean
  migrations: string[]
  errors: string[]
  warnings: string[]
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export class ManifestCompiler {
  constructor(private options: CompilerOptions) {
    // TODO: Use options for future compiler configuration
    // For now, store the options for potential future use
    void this.options;
  }

  async compile(manifest: Manifest): Promise<CompilerResult> {
    const result: CompilerResult = {
      success: false,
      migrations: [],
      errors: [],
      warnings: []
    }

    try {
      // Validate manifest against JSON schema
      if (!this.validateManifest(manifest)) {
        result.errors.push('Manifest validation failed')
        return result
      }

      // Generate database migrations from collections
      const migrations = await this.generateMigrations(manifest)
      result.migrations = migrations

      // Register UI views
      await this.registerViews(manifest)

      // Set up entity map for Shell SDK
      await this.updateEntityMap(manifest)

      // v0.2: Process extensions and contributions
      await this.processExtensions(manifest)

      // v0.2: Set up pub/sub topics
      await this.processPubSub(manifest)

      // v0.2: Configure offline behavior
      await this.processOfflineConfig(manifest)

      // v0.2: Set up sync policies
      await this.processSyncConfig(manifest)

      // v0.2: Handle augmentations
      await this.processAugmentations(manifest)

      result.success = true
    } catch (error) {
      result.errors.push(`Compilation failed: ${error}`)
    }

    return result
  }

  private validateManifest(manifest: Manifest): boolean {
    const validation = this.validateManifestWithDetails(manifest)
    if (!validation.valid) {
      console.error('Manifest validation failed:', validation.errors)
    }
    return validation.valid
  }

  validateManifestWithDetails(manifest: Manifest): ValidationResult {
    try {
      const ajv = new Ajv({ allErrors: true })
      const validate = ajv.compile(manifestSchema)
      const valid = validate(manifest)

      if (!valid) {
        const errors = validate.errors?.map(err =>
          `${err.instancePath || 'root'}: ${err.message}`
        ) || ['Unknown validation error']

        return { valid: false, errors }
      }

      return { valid: true, errors: [] }
    } catch (error) {
      return {
        valid: false,
        errors: [`Schema validation setup failed: ${error}`]
      }
    }
  }

  static async parseManifestFile(filePath: string): Promise<Manifest> {
    const content = fs.readFileSync(filePath, 'utf8')

    if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
      return parseYAML(content) as Manifest
    } else if (filePath.endsWith('.json')) {
      return JSON.parse(content) as Manifest
    } else {
      throw new Error('Unsupported manifest format. Use .yaml, .yml, or .json')
    }
  }

  private async generateMigrations(manifest: Manifest): Promise<string[]> {
    const migrations: string[] = []

    if (!manifest.data?.collections) {
      return migrations
    }

    // SECURITY: Never trust manifest for infrastructure decisions
    // Storage tier and execution mode are determined by:
    // 1. Bobbin provenance (first-party vs external)
    // 2. Admin configuration in bobbins_installed table
    // 3. Runtime performance metrics (auto-promotion)
    
    // All external bobbins start in Tier 1 (JSONB) regardless of manifest claims
    // Promotion happens based on actual usage, not manifest hints
    
    // TODO: Generate Drizzle migrations for each collection
    // Default to Tier 1 for initial install
    for (const collection of manifest.data.collections) {
      const migration = this.generateCollectionMigration(collection, false)
      migrations.push(migration)
    }

    return migrations
  }

  private generateCollectionMigration(collection: any, preferPhysical: boolean = false): string {
    // TODO: Transform collection definition to SQL DDL
    const tier = preferPhysical ? 'Tier 2 (physical table)' : 'Tier 1 (JSONB)'
    return `-- Migration for ${collection.name} [${tier}] (TODO: implement)`
  }

  private async registerViews(manifest: Manifest): Promise<void> {
    if (!manifest.ui?.views) {
      return
    }

    const executionMode = manifest.execution?.mode || 'sandboxed'
    const bobbinId = manifest.id

    console.log(`[ManifestCompiler] Registering ${manifest.ui.views.length} views for ${bobbinId} (${executionMode} mode)`)

    for (const view of manifest.ui.views) {
      const viewId = `${bobbinId}.${view.id}`

      console.log(`[ManifestCompiler] Registering view: ${viewId} (${executionMode})`)

      // View registration will be handled by shell at runtime
      // The manifest data is stored and processed when bobbin is installed
      // This method is primarily for validation and logging during compilation

      // TODO: In future, could generate view registration code or config files here
      // For now, the shell will read manifest.execution.mode at runtime
    }
  }

  private async updateEntityMap(manifest: Manifest): Promise<void> {
    // TODO: Update entity routing map for SDK
    if (manifest.data?.collections) {
      console.log(`Updating entity map for ${manifest.data.collections.length} collections`)
    }
  }

  // v0.2: Process extensions and register with shell slots
  private async processExtensions(manifest: Manifest): Promise<void> {
    if (!manifest.extensions?.contributions) {
      return
    }

    for (const contribution of manifest.extensions.contributions) {
      console.log(`Registering extension contribution: ${contribution.id} in slot ${contribution.slot}`)

      // TODO: Register with shell extension registry
      // TODO: Validate slot exists and is available
      // TODO: Set up conditional rendering based on 'when' conditions
      // TODO: Configure pub/sub subscriptions for extension
    }
  }

  // v0.2: Set up pub/sub topic registry and configure LEB
  private async processPubSub(manifest: Manifest): Promise<void> {
    if (manifest.pubsub?.produces) {
      for (const producer of manifest.pubsub.produces) {
        console.log(`Setting up topic producer: ${producer.topic} (${producer.qos})`)
        // TODO: Register topic with Local Event Bus
        // TODO: Set up rate limiting based on producer.rate
        // TODO: Configure topic QoS and sensitivity levels
      }
    }

    if (manifest.pubsub?.consumes) {
      for (const consumer of manifest.pubsub.consumes) {
        console.log(`Setting up topic consumer: ${consumer.topic} (intent: ${consumer.intent})`)
        // TODO: Validate topic exists in registry
        // TODO: Check sensitivity level compatibility
      }
    }
  }

  // v0.2: Configure offline caching behavior
  private async processOfflineConfig(manifest: Manifest): Promise<void> {
    if (!manifest.offline) {
      return
    }

    console.log(`Configuring offline behavior: ${manifest.offline.defaultCache}`)

    // TODO: Set up Service Worker caching strategy
    // TODO: Configure IndexedDB storage policies
    // TODO: Set up field redaction for offline storage

    if (manifest.offline.redactFields) {
      console.log(`Redacting fields for offline storage: ${manifest.offline.redactFields.join(', ')}`)
    }
  }

  // v0.2: Set up sync and conflict resolution policies
  private async processSyncConfig(manifest: Manifest): Promise<void> {
    if (!manifest.sync) {
      return
    }

    console.log(`Setting up sync policy: ${manifest.sync.conflictPolicy}`)

    // TODO: Configure conflict resolution strategies
    // TODO: Set up field-level sync policies
    // TODO: Integrate with offline storage layer

    if (manifest.sync.fieldPolicies) {
      for (const [field, policy] of Object.entries(manifest.sync.fieldPolicies)) {
        console.log(`Field ${field} sync policy: ${policy}`)
      }
    }
  }

  // v0.2: Handle collection augmentations (adding fields to existing collections)
  private async processAugmentations(manifest: Manifest): Promise<void> {
    if (!manifest.augmentations?.collections) {
      return
    }

    for (const augmentation of manifest.augmentations.collections) {
      console.log(`Augmenting collection ${augmentation.target} with ${augmentation.fields.length} fields`)

      // TODO: Validate target collection exists
      // TODO: Generate migration to add fields to existing collection
      // TODO: Update entity map with new field definitions
      // TODO: Preserve existing data during augmentation
    }
  }
}

export * from '@bobbinry/types'