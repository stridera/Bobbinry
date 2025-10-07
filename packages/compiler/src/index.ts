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

      // Verify signature for native bobbins
      const signatureResult = await this.verifySignature(manifest)
      if (!signatureResult.valid) {
        result.errors.push(...signatureResult.errors)
        return result
      }
      if (signatureResult.warnings) {
        result.warnings.push(...signatureResult.warnings)
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

  /**
   * Verify signature for native bobbins
   *
   * Native bobbins must be cryptographically signed in production to ensure they haven't been tampered with.
   * In development mode, we allow a special 'dev_mode_skip' signature.
   *
   * @param manifest - The manifest to verify
   * @returns Validation result with errors/warnings
   */
  private async verifySignature(manifest: Manifest): Promise<ValidationResult & { warnings?: string[] }> {
    // Only verify signatures for native execution mode
    if (!manifest.execution || manifest.execution.mode !== 'native') {
      return { valid: true, errors: [] }
    }

    const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
    const signature = manifest.execution.signature

    // Development mode: allow dev_mode_skip
    if (isDevelopment) {
      if (signature === 'dev_mode_skip') {
        return {
          valid: true,
          errors: [],
          warnings: [`Native bobbin '${manifest.id}' using dev_mode_skip signature - this is only allowed in development`]
        }
      }

      // In dev, we're more lenient - missing signature gets a warning but still passes
      if (!signature) {
        return {
          valid: true,
          errors: [],
          warnings: [`Native bobbin '${manifest.id}' has no signature - this would fail in production`]
        }
      }
    }

    // Production mode: require valid signature
    if (!isDevelopment) {
      if (!signature) {
        return {
          valid: false,
          errors: [`Native bobbin '${manifest.id}' requires a valid Ed25519 signature in production`]
        }
      }

      if (signature === 'dev_mode_skip') {
        return {
          valid: false,
          errors: [`Native bobbin '${manifest.id}' cannot use dev_mode_skip signature in production`]
        }
      }

      // Implement Ed25519 signature verification
      const { verifyManifestSignature, isTrustedPublicKey } = await import('./crypto')
      
      // Parse signature (should be an object with publicKey and signature fields)
      let sigData: { publicKey: string; signature: string }
      try {
        if (typeof signature === 'string') {
          sigData = JSON.parse(signature)
        } else {
          sigData = signature as { publicKey: string; signature: string }
        }
      } catch {
        return {
          valid: false,
          errors: [`Native bobbin '${manifest.id}' has invalid signature format`]
        }
      }

      if (!sigData.publicKey || !sigData.signature) {
        return {
          valid: false,
          errors: [`Native bobbin '${manifest.id}' signature missing publicKey or signature field`]
        }
      }

      // Check if public key is trusted
      if (!isTrustedPublicKey(sigData.publicKey)) {
        return {
          valid: false,
          errors: [
            `Native bobbin '${manifest.id}' signed with untrusted public key`,
            `Only bobbins signed by verified publishers can run in native mode`
          ]
        }
      }

      // Create manifest without signature for verification
      const manifestCopy = { ...manifest }
      delete (manifestCopy as any).execution?.signature
      const manifestJson = JSON.stringify(manifestCopy, null, 2)

      // Verify signature
      const isValid = verifyManifestSignature(
        manifestJson,
        sigData.signature,
        sigData.publicKey
      )

      if (!isValid) {
        return {
          valid: false,
          errors: [`Native bobbin '${manifest.id}' has invalid signature - verification failed`]
        }
      }

      // Signature is valid
      return {
        valid: true,
        errors: [],
        warnings: [`Native bobbin '${manifest.id}' signature verified successfully`]
      }
    }

    // Should never reach here, but TypeScript wants exhaustive checking
    return { valid: true, errors: [] }
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
    const { generateCollectionMigration } = require('./migration-generator')
    
    return generateCollectionMigration(collection, {
      bobbinId: 'unknown', // TODO: Pass actual bobbin ID
      projectId: this.options.projectId,
      tier: preferPhysical ? 'tier2' : 'tier1'
    })
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

    // Validate slot availability
    const validSlots = new Set([
      'sidebar.top',
      'sidebar.bottom',
      'toolbar.left',
      'toolbar.right',
      'context-menu',
      'entity-panel',
      'settings-panel'
    ])

    for (const contribution of manifest.extensions.contributions) {
      console.log(`Registering extension contribution: ${contribution.id} in slot ${contribution.slot}`)

      // Validate slot exists
      if (!validSlots.has(contribution.slot)) {
        console.warn(`Unknown slot: ${contribution.slot}. Extension ${contribution.id} may not render.`)
      }

      // Validate conditional rendering
      if (contribution.when) {
        this.validateConditions(contribution.when)
      }

      // Extension registration happens at runtime in the shell
      // The manifest is stored and the shell will:
      // 1. Load the extension component (native or sandboxed)
      // 2. Register it with the ExtensionRegistry
      // 3. Subscribe to relevant pub/sub topics
      // 4. Evaluate 'when' conditions for visibility

      // Log configuration for debugging
      console.log(`  - Type: ${contribution.type}`)
      console.log(`  - Entry: ${contribution.entry}`)
      if (contribution.icon) console.log(`  - Icon: ${contribution.icon}`)
      if (contribution.label) console.log(`  - Label: ${contribution.label}`)
      if (contribution.when) console.log(`  - Conditional: ${JSON.stringify(contribution.when)}`)
    }
  }

  private validateConditions(conditions: any): void {
    // Validate conditional expressions
    const validConditionTypes = ['entityType', 'projectHas', 'userHas', 'viewIs']
    
    if (typeof conditions === 'object') {
      for (const key of Object.keys(conditions)) {
        if (!validConditionTypes.includes(key)) {
          console.warn(`Unknown condition type: ${key}`)
        }
      }
    }
  }

  // v0.2: Set up pub/sub topic registry and configure LEB
  private async processPubSub(manifest: Manifest): Promise<void> {
    const topicRegistry = new Map<string, any>()

    // Register topics that this bobbin produces
    if (manifest.pubsub?.produces) {
      for (const producer of manifest.pubsub.produces) {
        console.log(`Setting up topic producer: ${producer.topic} (${producer.qos})`)

        // Validate QoS level
        const validQoS = ['at-most-once', 'at-least-once', 'exactly-once']
        if (producer.qos && !validQoS.includes(producer.qos)) {
          console.warn(`Invalid QoS level: ${producer.qos}. Defaulting to 'at-most-once'`)
        }

        // Set up rate limiting
        let rateLimit = { messages: 100, window: 60000 } // Default: 100 msgs/min
        if (producer.rate) {
          const [messages, seconds] = producer.rate.split('/')
          rateLimit = {
            messages: parseInt(messages || '100', 10),
            window: parseInt(seconds || '60', 10) * 1000
          }
          console.log(`  - Rate limit: ${rateLimit.messages} messages per ${rateLimit.window / 1000}s`)
        }

        // Register topic configuration
        topicRegistry.set(producer.topic, {
          type: 'producer',
          qos: producer.qos,
          sensitivity: producer.sensitivity || 'low',
          rateLimit,
          description: producer.description
        })

        console.log(`  - QoS: ${producer.qos}`)
        console.log(`  - Sensitivity: ${producer.sensitivity || 'low'}`)
      }
    }

    // Validate topics that this bobbin consumes
    if (manifest.pubsub?.consumes) {
      for (const consumer of manifest.pubsub.consumes) {
        console.log(`Setting up topic consumer: ${consumer.topic} (intent: ${consumer.intent})`)

        // In production, validate that topic exists in registry
        // For now, just log the configuration
        const existingTopic = topicRegistry.get(consumer.topic)
        if (existingTopic) {
          console.log(`  - Topic registered by this bobbin`)
        } else {
          console.log(`  - Topic expected from another bobbin or system`)
        }

        // Validate sensitivity compatibility
        if (consumer.minSensitivity) {
          const levels = { low: 0, medium: 1, high: 2 }
          const minLevel = levels[consumer.minSensitivity as keyof typeof levels] || 0
          
          if (existingTopic) {
            const topicLevel = levels[existingTopic.sensitivity as keyof typeof levels] || 0
            if (topicLevel < minLevel) {
              console.warn(`  - Warning: Topic sensitivity (${existingTopic.sensitivity}) below minimum (${consumer.minSensitivity})`)
            }
          }
          
          console.log(`  - Minimum sensitivity: ${consumer.minSensitivity}`)
        }

        // Log intent
        console.log(`  - Intent: ${consumer.intent}`)
      }
    }

    // Topic configuration will be loaded by the shell's event bus at runtime
    // The manifest is stored and the shell will:
    // 1. Initialize the Local Event Bus with topic definitions
    // 2. Set up rate limiting per topic
    // 3. Configure QoS guarantees
    // 4. Validate sensitivity levels for producers/consumers
    // 5. Subscribe bobbins to their declared topics
  }

  // v0.2: Configure offline caching behavior
  private async processOfflineConfig(manifest: Manifest): Promise<void> {
    if (!manifest.offline) {
      return
    }

    console.log(`Configuring offline behavior: ${manifest.offline.defaultCache}`)

    // Validate cache strategy
    const validStrategies = ['cache-first', 'network-first', 'cache-only', 'network-only']
    if (manifest.offline.defaultCache && !validStrategies.includes(manifest.offline.defaultCache)) {
      console.warn(`Invalid cache strategy: ${manifest.offline.defaultCache}. Using 'network-first'`)
    }

    // Configure IndexedDB storage policies
    if (manifest.offline.maxAge) {
      console.log(`  - Max cache age: ${manifest.offline.maxAge}ms`)
    }

    if (manifest.offline.maxSize) {
      console.log(`  - Max cache size: ${manifest.offline.maxSize} entries`)
    }

    // Set up field redaction for offline storage
    if (manifest.offline.redactFields && manifest.offline.redactFields.length > 0) {
      console.log(`  - Redacting fields for offline storage:`)
      for (const field of manifest.offline.redactFields) {
        console.log(`    * ${field}`)
      }
    }

    // Configure collection-specific caching
    if (manifest.offline.collections) {
      console.log(`  - Collection-specific caching:`)
      for (const [collection, config] of Object.entries(manifest.offline.collections)) {
        console.log(`    * ${collection}: ${JSON.stringify(config)}`)
      }
    }

    // Offline configuration will be loaded by the shell at runtime
    // The shell will:
    // 1. Configure Service Worker with appropriate caching strategy
    // 2. Set up IndexedDB with storage limits
    // 3. Apply field redaction rules before storing
    // 4. Implement cache expiration based on maxAge
  }

  // v0\.2: Set up sync and conflict resolution policies
  private async processSyncConfig(manifest: Manifest): Promise<void> {
    if (!manifest.sync) {
      return
    }

    console.log(`Setting up sync policy: ${manifest.sync.conflictPolicy}`)

    // Validate conflict resolution strategy
    const validPolicies = ['last-write-wins', 'first-write-wins', 'manual', 'merge']
    if (manifest.sync.conflictPolicy && !validPolicies.includes(manifest.sync.conflictPolicy)) {
      console.warn(`Invalid conflict policy: ${manifest.sync.conflictPolicy}. Using 'last-write-wins'`)
    }

    console.log(`  - Conflict resolution: ${manifest.sync.conflictPolicy}`)

    // Configure sync interval
    if (manifest.sync.syncInterval) {
      console.log(`  - Sync interval: ${manifest.sync.syncInterval}ms`)
    }

    // Set up field-level sync policies
    if (manifest.sync.fieldPolicies && Object.keys(manifest.sync.fieldPolicies).length > 0) {
      console.log(`  - Field-specific sync policies:`)
      for (const [field, policy] of Object.entries(manifest.sync.fieldPolicies)) {
        console.log(`    * ${field}: ${policy}`)
        
        // Validate policy
        if (!['merge', 'client-wins', 'server-wins', 'no-sync'].includes(policy as string)) {
          console.warn(`    - Warning: Unknown field policy '${policy}' for field '${field}'`)
        }
      }
    }

    // Configure optimistic updates
    if (manifest.sync.optimisticUpdates !== undefined) {
      console.log(`  - Optimistic updates: ${manifest.sync.optimisticUpdates ? 'enabled' : 'disabled'}`)
    }

    // Sync configuration will be loaded by the shell's offline system at runtime
    // The shell will:
    // 1. Configure conflict resolution strategies per collection
    // 2. Apply field-level policies during sync
    // 3. Set up automatic sync intervals
    // 4. Enable/disable optimistic updates
    // 5. Track version vectors for conflict detection
  }

  // v0\.2: Handle collection augmentations (adding fields to existing collections)
  private async processAugmentations(manifest: Manifest): Promise<void> {
    if (!manifest.augmentations?.collections) {
      return
    }

    for (const augmentation of manifest.augmentations.collections) {
      console.log(`Augmenting collection ${augmentation.target} with ${augmentation.fields.length} fields`)

      // Parse target collection reference (format: bobbinId.collectionName)
      const [targetBobbinId, targetCollection] = augmentation.target.split('.')
      
      if (!targetBobbinId || !targetCollection) {
        console.error(`  - Error: Invalid target format '${augmentation.target}'. Expected 'bobbinId.collectionName'`)
        continue
      }

      console.log(`  - Target: ${targetBobbinId}.${targetCollection}`)

      // Validate that no field names conflict
      const newFieldNames = augmentation.fields.map(f => f.name)
      const duplicates = newFieldNames.filter((name, index) => newFieldNames.indexOf(name) !== index)
      if (duplicates.length > 0) {
        console.error(`  - Error: Duplicate field names: ${duplicates.join(', ')}`)
        continue
      }

      // Log field additions
      console.log(`  - Adding fields:`)
      for (const field of augmentation.fields) {
        console.log(`    * ${field.name} (${field.type})${field.required ? ' [required]' : ''}`)
        
        if (field.default !== undefined) {
          console.log(`      - Default: ${JSON.stringify(field.default)}`)
        }
      }

      // Generate migration for augmentation
      // For Tier 1 (JSONB), no schema change needed
      // For Tier 2 (physical tables), need ALTER TABLE statements
      console.log(`  - Migration strategy:`)
      console.log(`    * Tier 1 (JSONB): No schema change needed`)
      console.log(`    * Tier 2 (physical): ALTER TABLE to add columns`)

      // Augmentation will be applied at runtime by the shell
      // The shell will:
      // 1. Validate that target collection exists in installed bobbins
      // 2. Check for field name conflicts
      // 3. For Tier 2 collections, apply ALTER TABLE migrations
      // 4. Update entity map with augmented schema
      // 5. Preserve all existing data (new fields nullable or with defaults)
      // 6. Make augmented fields available to all bobbins

      // Security: Augmentations require explicit permission
      if (augmentation.requiredPermission) {
        console.log(`  - Required permission: ${augmentation.requiredPermission}`)
      }
    }
  }
}

export * from '@bobbinry/types'