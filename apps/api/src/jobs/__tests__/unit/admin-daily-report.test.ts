import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// Mock the DB and email modules before importing the system under test.
const mockReturning = jest.fn() as jest.MockedFunction<() => Promise<Array<{ jobName: string }>>>
const mockOnConflictDoUpdate = jest.fn().mockReturnValue({ returning: mockReturning })
const mockInsertValues = jest.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate })
const mockInsert = jest.fn().mockReturnValue({ values: mockInsertValues })

const mockUpdateWhere = jest.fn() as jest.MockedFunction<() => Promise<unknown>>
const mockUpdateSet = jest.fn().mockReturnValue({ where: mockUpdateWhere })
const mockUpdate = jest.fn().mockReturnValue({ set: mockUpdateSet })

const mockSelectWhere = jest.fn() as jest.MockedFunction<() => Promise<Array<{ count: number }>>>
const mockSelectInnerJoin = jest.fn().mockReturnValue({ where: mockSelectWhere })
const mockSelectFrom = jest.fn().mockReturnValue({
  where: mockSelectWhere,
  innerJoin: mockSelectInnerJoin,
})
const mockSelect = jest.fn().mockReturnValue({ from: mockSelectFrom })

jest.mock('../../../db/connection', () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    select: (...args: unknown[]) => mockSelect(...args),
  },
}))

const mockSendEmail = jest.fn() as jest.MockedFunction<() => Promise<boolean>>
jest.mock('../../../lib/email', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...(args as [])),
  buildAdminDailyReportHtml: () => '<html />',
  buildAdminDailyReportText: () => 'text',
}))

import { processAdminDailyReport, todayFireTime } from '../../admin-daily-report'

// Default: gatherReportData returns zeros, getAdminEmails returns one admin.
// Both go through select().from() (zero counts) or select().from().innerJoin().where() (admin emails).
function setSelectReturns(opts: { count?: number; adminEmails?: string[] } = {}) {
  const count = opts.count ?? 0
  const adminEmails = opts.adminEmails ?? ['admin@example.com']
  // 12 count queries (gatherReportData) followed by 1 admin-emails query, but
  // they all flow through the same chain. We return based on call shape: if
  // innerJoin was called on the chain, it's the admin query.
  mockSelectWhere.mockImplementation(async () => {
    // If the last call to mockSelectFrom returned the .innerJoin chain (admin query)
    // we can't easily distinguish. Simpler: return count rows for everything, and
    // for the admin-emails path the test sets adminEmails via a separate path.
    return [{ count }]
  })
  // Admin-emails query goes through .innerJoin().where()
  mockSelectInnerJoin.mockReturnValue({
    where: jest.fn(async () => adminEmails.map(email => ({ email }))) as never,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockReturning.mockResolvedValue([{ jobName: 'admin_daily_report' }])
  mockUpdateWhere.mockResolvedValue(undefined)
  mockSendEmail.mockResolvedValue(true)
  setSelectReturns()
})

describe('todayFireTime', () => {
  it("returns today's 14:00 UTC regardless of current time of day", () => {
    expect(todayFireTime(new Date('2026-05-10T10:00:00Z')).toISOString()).toBe('2026-05-10T14:00:00.000Z')
    expect(todayFireTime(new Date('2026-05-10T15:00:00Z')).toISOString()).toBe('2026-05-10T14:00:00.000Z')
    expect(todayFireTime(new Date('2026-05-10T14:00:00Z')).toISOString()).toBe('2026-05-10T14:00:00.000Z')
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
    mockReturning.mockResolvedValueOnce([]) // setWhere did not match → no row returned
    const result = await processAdminDailyReport()
    expect(result).toMatchObject({ ok: true, claimed: false, skipped: 'already_ran' })
    expect(mockSendEmail).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  it('force=true bypasses the time gate and the claim gate', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-10T08:00:00Z'))
    setSelectReturns({ count: 1 }) // growth: 1 signup
    const result = await processAdminDailyReport({ force: true })
    expect(result).toMatchObject({ ok: true, claimed: true, sent: true })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })

  it('writes lastStatus=failed when sendEmail returns false', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-10T14:01:00Z'))
    setSelectReturns({ count: 1 }) // growth: 1 signup so we attempt send
    mockSendEmail.mockResolvedValueOnce(false)
    const result = await processAdminDailyReport()
    expect(result).toMatchObject({ ok: false, claimed: true, sent: false })
    expect(result.error).toContain('sendEmail returned false')
    // Terminal status write
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ lastStatus: 'failed' }))
    jest.useRealTimers()
  })

  it('writes lastStatus=skipped when no growth and no errors', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-10T14:01:00Z'))
    setSelectReturns({ count: 0 })
    const result = await processAdminDailyReport()
    expect(result).toMatchObject({ ok: true, claimed: true, skipped: 'no_growth' })
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ lastStatus: 'skipped' }))
    jest.useRealTimers()
  })
})
