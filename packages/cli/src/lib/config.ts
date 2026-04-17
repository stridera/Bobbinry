import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface CliConfig {
  apiKey?: string
  apiUrl?: string
  defaultProject?: string
}

const CONFIG_DIR_NAME = 'bobbinry'
const CONFIG_FILE = 'config.json'
const LEGACY_ENV_FILE = '.env'
const DEFAULT_API_URL = 'https://api.bobbinry.com'

function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  const base = xdg || join(homedir(), '.config')
  return join(base, CONFIG_DIR_NAME)
}

export function getConfigPath(): string {
  return join(getConfigDir(), CONFIG_FILE)
}

/** Try to read the legacy ~/.config/bobbinry/.env file for BOBBINRY_API_KEY */
function readLegacyEnv(): string | undefined {
  const envPath = join(getConfigDir(), LEGACY_ENV_FILE)
  try {
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('BOBBINRY_API_KEY=')) {
        return trimmed.slice('BOBBINRY_API_KEY='.length).replace(/^["']|["']$/g, '')
      }
    }
  } catch {
    // file doesn't exist
  }
  return undefined
}

export function loadConfig(): CliConfig {
  const configPath = getConfigPath()
  try {
    const raw = readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as CliConfig
  } catch {
    // Config file doesn't exist or is invalid — check legacy .env
    const legacyKey = readLegacyEnv()
    if (legacyKey) {
      return { apiKey: legacyKey }
    }
    return {}
  }
}

export function saveConfig(config: CliConfig): void {
  const dir = getConfigDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const configPath = getConfigPath()
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  chmodSync(configPath, 0o600)
}

export function getConfigValue(key: string): string | undefined {
  const config = loadConfig()
  switch (key) {
    case 'api-key': return config.apiKey
    case 'api-url': return config.apiUrl
    case 'default-project': return config.defaultProject
    default: return undefined
  }
}

export function setConfigValue(key: string, value: string): void {
  const config = loadConfig()
  switch (key) {
    case 'api-key': config.apiKey = value; break
    case 'api-url': config.apiUrl = value; break
    case 'default-project': config.defaultProject = value; break
    default: throw new Error(`Unknown config key: ${key}. Valid keys: api-key, api-url, default-project`)
  }
  saveConfig(config)
}

/**
 * Resolve the API key from multiple sources in priority order:
 * 1. --api-key flag
 * 2. BOBBINRY_API_KEY env var
 * 3. config.json
 * 4. legacy .env
 */
export function resolveApiKey(flagValue?: string): string | undefined {
  if (flagValue) return flagValue
  if (process.env.BOBBINRY_API_KEY) return process.env.BOBBINRY_API_KEY
  const config = loadConfig()
  if (config.apiKey) return config.apiKey
  return readLegacyEnv()
}

/**
 * Resolve the API base URL.
 * 1. --api-url flag
 * 2. BOBBINRY_API_URL env var
 * 3. config.json
 * 4. default (https://api.bobbinry.com)
 */
export function resolveApiUrl(flagValue?: string): string {
  if (flagValue) return flagValue
  if (process.env.BOBBINRY_API_URL) return process.env.BOBBINRY_API_URL
  const config = loadConfig()
  return config.apiUrl || DEFAULT_API_URL
}
