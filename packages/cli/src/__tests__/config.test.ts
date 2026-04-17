import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Set XDG_CONFIG_HOME before importing config module
const testConfigDir = join(tmpdir(), `bobbinry-test-${process.pid}-${Date.now()}`)
process.env.XDG_CONFIG_HOME = testConfigDir

import { loadConfig, saveConfig, getConfigPath, getConfigValue, setConfigValue, resolveApiKey, resolveApiUrl } from '../lib/config.js'
import type { CliConfig } from '../lib/config.js'

const configDir = join(testConfigDir, 'bobbinry')

beforeEach(() => {
  // Clean slate
  if (existsSync(configDir)) {
    rmSync(configDir, { recursive: true })
  }
  delete process.env.BOBBINRY_API_KEY
  delete process.env.BOBBINRY_API_URL
})

afterEach(() => {
  if (existsSync(testConfigDir)) {
    rmSync(testConfigDir, { recursive: true })
  }
})

describe('config path', () => {
  it('uses XDG_CONFIG_HOME when set', () => {
    expect(getConfigPath()).toBe(join(configDir, 'config.json'))
  })
})

describe('loadConfig', () => {
  it('returns empty config when no file exists', () => {
    const config = loadConfig()
    expect(config).toEqual({})
  })

  it('reads config from JSON file', () => {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      apiKey: 'bby_fromjson',
      apiUrl: 'https://custom.api',
      defaultProject: 'proj-1',
    }))

    const config = loadConfig()
    expect(config.apiKey).toBe('bby_fromjson')
    expect(config.apiUrl).toBe('https://custom.api')
    expect(config.defaultProject).toBe('proj-1')
  })

  it('falls back to legacy .env when config.json missing', () => {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, '.env'), 'BOBBINRY_API_KEY=bby_fromenv\n')

    const config = loadConfig()
    expect(config.apiKey).toBe('bby_fromenv')
  })

  it('handles quoted values in legacy .env', () => {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, '.env'), 'BOBBINRY_API_KEY="bby_quoted"\n')

    const config = loadConfig()
    expect(config.apiKey).toBe('bby_quoted')
  })

  it('prefers config.json over legacy .env', () => {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ apiKey: 'bby_json' }))
    writeFileSync(join(configDir, '.env'), 'BOBBINRY_API_KEY=bby_env\n')

    const config = loadConfig()
    expect(config.apiKey).toBe('bby_json')
  })
})

describe('saveConfig', () => {
  it('creates config directory and file', () => {
    saveConfig({ apiKey: 'bby_saved' })

    expect(existsSync(join(configDir, 'config.json'))).toBe(true)
    const raw = readFileSync(join(configDir, 'config.json'), 'utf-8')
    expect(JSON.parse(raw).apiKey).toBe('bby_saved')
  })

  it('overwrites existing config', () => {
    saveConfig({ apiKey: 'bby_first' })
    saveConfig({ apiKey: 'bby_second', apiUrl: 'https://new.api' })

    const config = loadConfig()
    expect(config.apiKey).toBe('bby_second')
    expect(config.apiUrl).toBe('https://new.api')
  })
})

describe('getConfigValue / setConfigValue', () => {
  it('sets and gets api-key', () => {
    setConfigValue('api-key', 'bby_setget')
    expect(getConfigValue('api-key')).toBe('bby_setget')
  })

  it('sets and gets api-url', () => {
    setConfigValue('api-url', 'https://my.api')
    expect(getConfigValue('api-url')).toBe('https://my.api')
  })

  it('sets and gets default-project', () => {
    setConfigValue('default-project', 'proj-123')
    expect(getConfigValue('default-project')).toBe('proj-123')
  })

  it('throws on unknown key', () => {
    expect(() => setConfigValue('unknown', 'val')).toThrow('Unknown config key')
  })

  it('returns undefined for unset key', () => {
    expect(getConfigValue('api-key')).toBeUndefined()
  })
})

describe('resolveApiKey', () => {
  it('uses flag value first', () => {
    process.env.BOBBINRY_API_KEY = 'bby_env'
    saveConfig({ apiKey: 'bby_config' })

    expect(resolveApiKey('bby_flag')).toBe('bby_flag')
  })

  it('uses env var second', () => {
    process.env.BOBBINRY_API_KEY = 'bby_env'
    saveConfig({ apiKey: 'bby_config' })

    expect(resolveApiKey()).toBe('bby_env')
  })

  it('uses config file third', () => {
    saveConfig({ apiKey: 'bby_config' })

    expect(resolveApiKey()).toBe('bby_config')
  })

  it('falls back to legacy env fourth', () => {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, '.env'), 'BOBBINRY_API_KEY=bby_legacy\n')

    expect(resolveApiKey()).toBe('bby_legacy')
  })

  it('returns undefined when nothing configured', () => {
    expect(resolveApiKey()).toBeUndefined()
  })
})

describe('resolveApiUrl', () => {
  it('uses flag value first', () => {
    expect(resolveApiUrl('http://flag.api')).toBe('http://flag.api')
  })

  it('uses env var second', () => {
    process.env.BOBBINRY_API_URL = 'http://env.api'
    expect(resolveApiUrl()).toBe('http://env.api')
  })

  it('uses config file third', () => {
    saveConfig({ apiUrl: 'http://config.api' })
    expect(resolveApiUrl()).toBe('http://config.api')
  })

  it('defaults to production', () => {
    expect(resolveApiUrl()).toBe('https://api.bobbinry.com')
  })
})
