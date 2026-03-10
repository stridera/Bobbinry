import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { compareSemver, getMigrationsToRun, checkAndUpgradeBobbin } from '../../bobbin-upgrader'
import type { Migration } from '../../bobbin-upgrader'

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0)
  })

  it('returns -1 when a < b', () => {
    expect(compareSemver('1.0.0', '1.1.0')).toBe(-1)
    expect(compareSemver('1.0.0', '2.0.0')).toBe(-1)
    expect(compareSemver('1.0.0', '1.0.1')).toBe(-1)
    expect(compareSemver('0.9.9', '1.0.0')).toBe(-1)
  })

  it('returns 1 when a > b', () => {
    expect(compareSemver('2.0.0', '1.0.0')).toBe(1)
    expect(compareSemver('1.1.0', '1.0.0')).toBe(1)
    expect(compareSemver('1.0.1', '1.0.0')).toBe(1)
  })

  it('handles different segment lengths', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0)
    expect(compareSemver('1.0', '1.0.1')).toBe(-1)
    expect(compareSemver('1.1', '1.0.1')).toBe(1)
  })
})

describe('getMigrationsToRun', () => {
  const migrations: Migration[] = [
    { version: '2.0.0', description: 'v2 migration', up: 'SELECT 1', down: 'SELECT 1' },
    { version: '1.1.0', description: 'v1.1 migration', up: 'SELECT 1' },
    { version: '3.0.0', description: 'v3 migration', up: 'SELECT 1' }
  ]

  it('filters migrations greater than fromVersion', () => {
    const result = getMigrationsToRun(migrations, '1.0.0')
    expect(result).toHaveLength(3)
    expect(result.map(m => m.version)).toEqual(['1.1.0', '2.0.0', '3.0.0'])
  })

  it('excludes the current version', () => {
    const result = getMigrationsToRun(migrations, '1.1.0')
    expect(result).toHaveLength(2)
    expect(result.map(m => m.version)).toEqual(['2.0.0', '3.0.0'])
  })

  it('returns empty array when no migrations apply', () => {
    expect(getMigrationsToRun(migrations, '3.0.0')).toEqual([])
    expect(getMigrationsToRun(migrations, '4.0.0')).toEqual([])
  })

  it('returns empty array for empty migrations list', () => {
    expect(getMigrationsToRun([], '1.0.0')).toEqual([])
  })

  it('sorts results ascending by version', () => {
    const result = getMigrationsToRun(migrations, '0.0.1')
    for (let i = 1; i < result.length; i++) {
      expect(compareSemver(result[i - 1].version, result[i].version)).toBe(-1)
    }
  })
})

describe('checkAndUpgradeBobbin', () => {
  const TEST_PROJECT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  const makeInstalledRow = (overrides: Record<string, any> = {}) => ({
    id: 'install-uuid-1',
    projectId: TEST_PROJECT_ID,
    bobbinId: 'manuscript',
    version: '1.0.0',
    manifestJson: { version: '1.0.0', name: 'Manuscript' },
    enabled: true,
    installedAt: new Date(),
    configUpdatedBy: null,
    configUpdatedAt: null,
    ...overrides
  })

  const mockOnConflictDoNothing = jest.fn().mockResolvedValue(undefined as never)
  const mockValues = jest.fn().mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing })
  let mockTx: any
  let mockDb: any

  beforeEach(() => {
    mockOnConflictDoNothing.mockClear()
    mockValues.mockClear()
    mockTx = {
      insert: jest.fn().mockReturnValue({ values: mockValues }),
      execute: jest.fn().mockResolvedValue(undefined as never),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined as never)
        })
      })
    }
    mockDb = {
      transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => fn(mockTx))
    }
  })

  it('returns null when disk version equals installed version', async () => {
    const row = makeInstalledRow({ version: '1.0.0' })
    const manifest = { version: '1.0.0' }
    const result = await checkAndUpgradeBobbin(mockDb as any, row as any, manifest, TEST_PROJECT_ID)
    expect(result).toBeNull()
  })

  it('returns null when disk version is lower than installed', async () => {
    const row = makeInstalledRow({ version: '2.0.0' })
    const manifest = { version: '1.0.0' }
    const result = await checkAndUpgradeBobbin(mockDb as any, row as any, manifest, TEST_PROJECT_ID)
    expect(result).toBeNull()
  })

  it('returns null when disk manifest has no version', async () => {
    const row = makeInstalledRow()
    const manifest = {}
    const result = await checkAndUpgradeBobbin(mockDb as any, row as any, manifest, TEST_PROJECT_ID)
    expect(result).toBeNull()
  })

  it('upgrades successfully with no migrations', async () => {
    const row = makeInstalledRow({ version: '1.0.0' })
    const manifest = { version: '2.0.0' }
    const result = await checkAndUpgradeBobbin(mockDb as any, row as any, manifest, TEST_PROJECT_ID)

    expect(result).toEqual({
      bobbinId: 'manuscript',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      migrationsRun: 0,
      success: true
    })
    expect(mockDb.transaction).toHaveBeenCalled()
  })

  it('runs migrations and replaces {{project_id}} placeholder', async () => {
    const row = makeInstalledRow({ version: '1.0.0' })
    const manifest = {
      version: '2.0.0',
      compatibility: {
        migrations: [
          {
            version: '2.0.0',
            description: 'Test migration',
            up: "UPDATE entities SET entity_data = '{}' WHERE project_id = '{{project_id}}'",
            down: 'SELECT 1'
          }
        ]
      }
    }

    const result = await checkAndUpgradeBobbin(mockDb as any, row as any, manifest, TEST_PROJECT_ID)

    expect(result).toEqual({
      bobbinId: 'manuscript',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      migrationsRun: 1,
      success: true
    })

    // Verify the SQL had the placeholder replaced
    expect(mockTx.execute).toHaveBeenCalled()
    const executedSql = mockTx.execute.mock.calls[0][0]
    expect(executedSql.queryChunks[0].value[0]).toContain(TEST_PROJECT_ID)
    expect(executedSql.queryChunks[0].value[0]).not.toContain('{{project_id}}')
  })

  it('snapshots old manifest via insert with onConflictDoNothing', async () => {
    const row = makeInstalledRow({ version: '1.0.0' })
    const manifest = { version: '2.0.0' }

    await checkAndUpgradeBobbin(mockDb as any, row as any, manifest, TEST_PROJECT_ID)

    expect(mockTx.insert).toHaveBeenCalled()
    expect(mockOnConflictDoNothing).toHaveBeenCalled()
  })

  it('returns failure result and rolls back on migration error', async () => {
    const failTx = {
      ...mockTx,
      execute: jest.fn().mockRejectedValue(new Error('column does not exist') as never)
    }
    const failDb = {
      transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => fn(failTx))
    }

    const row = makeInstalledRow({ version: '1.0.0' })
    const manifest = {
      version: '2.0.0',
      compatibility: {
        migrations: [
          { version: '2.0.0', description: 'Bad migration', up: 'INVALID SQL' }
        ]
      }
    }

    const result = await checkAndUpgradeBobbin(failDb as any, row as any, manifest, TEST_PROJECT_ID)

    expect(result).toEqual({
      bobbinId: 'manuscript',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      migrationsRun: 0,
      success: false,
      error: 'column does not exist'
    })
  })

  it('rejects invalid project ID format', async () => {
    const row = makeInstalledRow({ version: '1.0.0' })
    const manifest = {
      version: '2.0.0',
      compatibility: {
        migrations: [
          { version: '2.0.0', description: 'Test', up: "SELECT '{{project_id}}'" }
        ]
      }
    }

    const result = await checkAndUpgradeBobbin(mockDb as any, row as any, manifest, 'not-a-uuid')

    expect(result?.success).toBe(false)
    expect(result?.error).toContain('Invalid project ID format')
  })
})
