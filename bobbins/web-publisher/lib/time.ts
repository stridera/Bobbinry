export type TimeDisplayPreference = 'local' | 'utc'

function parseDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function buildOptions<T extends Intl.DateTimeFormatOptions>(
  options: T,
  timeDisplay: TimeDisplayPreference
): T {
  if (timeDisplay === 'utc') {
    return {
      ...options,
      timeZone: 'UTC',
    }
  }

  return options
}

export function formatDateTime(
  value: string | Date,
  timeDisplay: TimeDisplayPreference,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const date = parseDate(value)
  return date.toLocaleString(undefined, buildOptions(options, timeDisplay))
}

export function formatDate(
  value: string | Date,
  timeDisplay: TimeDisplayPreference,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const date = parseDate(value)
  return date.toLocaleDateString(undefined, buildOptions(options, timeDisplay))
}

export function formatRelativeTime(
  value: string | Date,
  timeDisplay: TimeDisplayPreference,
  nowDate: Date = new Date()
): string {
  const target = parseDate(value)
  const reference = timeDisplay === 'utc'
    ? new Date(nowDate.toISOString())
    : nowDate
  const diff = reference.getTime() - target.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

export function toDateTimeInputValue(
  value: string | Date | null | undefined,
  timeDisplay: TimeDisplayPreference
): string {
  if (!value) return ''

  const date = parseDate(value)
  if (Number.isNaN(date.getTime())) return ''

  if (timeDisplay === 'utc') {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function parseDateTimeInputValue(
  value: string,
  timeDisplay: TimeDisplayPreference
): Date | null {
  if (!value) return null

  if (timeDisplay === 'utc') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
    if (!match) return null

    const [, year, month, day, hours, minutes] = match
    return new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
    ))
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
