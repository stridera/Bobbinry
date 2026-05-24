import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Mock the DB and email modules before importing the system under test.
// ---------------------------------------------------------------------------

const mockReturning = jest.fn() as jest.MockedFunction<() => Promise<Array<{ jobName: string }>>>
const mockOnConflictDoUpdate = jest.fn().mockReturnValue({ returning: mockReturning })
const mockInsertValues = jest.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate })
const mockInsert = jest.fn().mockReturnValue({ values: mockInsertValues })

const mockUpdateWhere = jest.fn() as jest.MockedFunction<() => Promise<unknown>>
const mockUpdateSet = jest.fn().mockReturnValue({ where: mockUpdateWhere })
const mockUpdate = jest.fn().mockReturnValue({ set: mockUpdateSet })

// Each select() call returns a fresh "from" chain. We track call shape so
// we can return different results for: the cron_runs lastSentAt read
// (uses .from().where().limit()), the count queries (uses .from().where()),
// and the admin emails read (uses .from().innerJoin().where()).
type SelectShape = 'cron' | 'count' | 'admin'
let nextSelectShape: SelectShape = 'count'
let lastSentAtValue: Date | null = null
let countValue = 0
let adminEmailsValue: string[] = ['admin@example.com']

function thenable<T>(result: T) {
  return {
    then: (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject),
    finally: (cb: () => void) => Promise.resolve(result).finally(cb),
    limit: jest.fn().mockImplementation(() => Promise.resolve(result)),
  }
}

const mockSelect = jest.fn().mockImplementation((shape: Record<string, unknown>) => {
  // Distinguish the cron_runs lastSentAt read by its select shape: { lastSentAt: ... }.
  const isCronRead = shape && 'lastSentAt' in shape
  if (isCronRead) nextSelectShape = 'cron'
  else if (shape && 'email' in shape) nextSelectShape = 'admin'
  else nextSelectShape = 'count'

  return {
    from: jest.fn().mockImplementation(() => {
      const shape = nextSelectShape
      if (shape === 'admin') {
        return {
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockImplementation(async () =>
              adminEmailsValue.map((email) => ({ email }))),
          }),
        }
      }
      if (shape === 'cron') {
        return {
          where: jest.fn().mockImplementation(() => thenable([{ lastSentAt: lastSentAtValue }])),
        }
      }
      // count query
      return {
        where: jest.fn().mockImplementation(() => thenable([{ count: countValue }])),
      }
    }),
  }
})

jest.mock('../../../db/connection', () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    select: (...args: unknown[]) => mockSelect(...(args as [Record<string, unknown>])),
  },
}))

const mockSendEmail = jest.fn() as jest.MockedFunction<() => Promise<boolean>>
jest.mock('../../../lib/email', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...(args as [])),
  buildAdminDailyReportHtml: () => '<html />',
  buildAdminDailyReportText: () => 'text',
}))

import {
  processAdminDailyReport,
  todayFireTime,
  getCutoff,
  gatherReportData,
} from '../../admin-daily-report'

function setReportInputs(opts: {
  count?: number
  lastSentAt?: Date | null
  adminEmails?: string[]
} = {}) {
  countValue = opts.count ?? 0
  lastSentAtValue = opts.lastSentAt ?? null
  adminEmailsValue = opts.adminEmails ?? ['admin@example.com']
}

beforeEach(() => {
  jest.clearAllMocks()
  mockReturning.mockResolvedValue([{ jobName: 'admin_daily_report' }])
  mockUpdateWhere.mockResolvedValue(undefined)
  mockSendEmail.mockResolvedValue(true)
  setReportInputs()
})

describe('todayFireTime', () => {
  it("returns today's 14:00 UTC regardless of current time of day", () => {
    expect(todayFireTime(new Date('2026-05-10T10:00:00Z')).toISOString()).toBe('2026-05-10T14:00:00.000Z')
    expect(todayFireTime(new Date('2026-05-10T15:00:00Z')).toISOString()).toBe('2026-05-10T14:00:00.000Z')
    expect(todayFireTime(new Date('2026-05-10T14:00:00Z')).toISOString()).toBe('2026-05-10T14:00:00.000Z')
  })
})

describe('getCutoff', () => {
  const now = new Date('2026-05-10T14:00:00Z')

  it('falls back to now-24h when lastSentAt is NULL', async () => {
    setReportInputs({ lastSentAt: null })
    const { cutoff, capped } = await getCutoff(now)
    expect(cutoff.toISOString()).toBe('2026-05-09T14:00:00.000Z')
    expect(capped).toBe(false)
  })

  it('uses lastSentAt when it is within 7 days', async () => {
    const lastSent = new Date('2026-05-09T14:00:00Z')
    setReportInputs({ lastSentAt: lastSent })
    const { cutoff, capped } = await getCutoff(now)
    expect(cutoff).toEqual(lastSent)
    expect(capped).toBe(false)
  })

  it('caps the cutoff at now-7d when lastSentAt is older', async () => {
    setReportInputs({ lastSentAt: new Date('2026-04-01T00:00:00Z') })
    const { cutoff, capped } = await getCutoff(now)
    expect(cutoff.toISOString()).toBe('2026-05-03T14:00:00.000Z')
    expect(capped).toBe(true)
  })
})

describe('gatherReportData', () => {
  it('includes the new activity metrics from count queries', async () => {
    setReportInputs({ count: 3 })
    const report = await gatherReportData(new Date('2026-05-09T14:00:00Z'))
    // Each count query returns 3 in this test; just verify the new fields land.
    expect(report.newComments).toBe(3)
    expect(report.newReactions).toBe(3)
    expect(report.newAnnotations).toBe(3)
    expect(report.entitiesEdited).toBe(3)
    expect(report.pendingComments).toBe(3)
  })
})

describe('processAdminDailyReport', () => {
  it('skips with skipped=before_fire_time when now is before today 14:00 UTC and not forced', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-10T13:59:00Z'))
    const result = await processAdminDailyReport()
    expect(result).toMatchObject({ ok: true, claimed: false, skipped: 'before_fire_time' })
    expect(mockInsert).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  it('returns claimed=false when the atomic claim loses (concurrent tick)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-10T14:01:00Z'))
    mockReturning.mockResolvedValueOnce([])
    const result = await processAdminDailyReport()
    expect(result).toMatchObject({ ok: true, claimed: false, skipped: 'already_ran' })
    expect(mockSendEmail).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  it('force=true bypasses the time gate and the claim gate', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-10T08:00:00Z'))
    setReportInputs({ count: 1 })
    const result = await processAdminDailyReport({ force: true })
    expect(result).toMatchObject({ ok: true, claimed: true, sent: true })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })

  it('writes lastStatus=failed when sendEmail returns false', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-10T14:01:00Z'))
    setReportInputs({ count: 1 })
    mockSendEmail.mockResolvedValueOnce(false)
    const result = await processAdminDailyReport()
    expect(result).toMatchObject({ ok: false, claimed: true, sent: false })
    expect(result.error).toContain('sendEmail returned false')
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ lastStatus: 'failed' }))
    jest.useRealTimers()
  })

  it('writes lastStatus=skipped when no growth and no errors', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-10T14:01:00Z'))
    setReportInputs({ count: 0 })
    const result = await processAdminDailyReport()
    expect(result).toMatchObject({ ok: true, claimed: true, skipped: 'no_growth' })
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ lastStatus: 'skipped' }))
    jest.useRealTimers()
  })

  it('writes lastSentAt alongside lastStatus=success on a successful send', async () => {
    const fakeNow = new Date('2026-05-10T14:01:00Z')
    jest.useFakeTimers().setSystemTime(fakeNow)
    setReportInputs({ count: 1 })
    const result = await processAdminDailyReport()
    expect(result).toMatchObject({ ok: true, claimed: true, sent: true })
    const successCall = mockUpdateSet.mock.calls.find(
      (call) => (call[0] as { lastStatus?: string }).lastStatus === 'success',
    )
    expect(successCall).toBeDefined()
    expect(successCall![0]).toEqual(
      expect.objectContaining({ lastStatus: 'success', lastSentAt: expect.any(Date) }),
    )
    jest.useRealTimers()
  })
})
