type Labels = Record<string, string | number | boolean>

type TimingStat = {
  count: number
  sumMs: number
  maxMs: number
}

const counters = new Map<string, number>()
const timings = new Map<string, TimingStat>()

function key(name: string, labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) {
    return name
  }
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
  return `${name}{${parts.join(',')}}`
}

export function incrementCounter(name: string, labels?: Labels, amount: number = 1): void {
  const metricKey = key(name, labels)
  counters.set(metricKey, (counters.get(metricKey) || 0) + amount)
}

export function observeTimingMs(name: string, ms: number, labels?: Labels): void {
  const metricKey = key(name, labels)
  const current = timings.get(metricKey) || { count: 0, sumMs: 0, maxMs: 0 }
  current.count += 1
  current.sumMs += ms
  current.maxMs = Math.max(current.maxMs, ms)
  timings.set(metricKey, current)
}

export function getMetricsSnapshot(): {
  counters: Record<string, number>
  timingsMs: Record<string, { count: number; avgMs: number; maxMs: number }>
} {
  const counterSnapshot = Object.fromEntries(counters.entries())
  const timingSnapshot = Object.fromEntries(
    [...timings.entries()].map(([metricKey, value]) => ([
      metricKey,
      {
        count: value.count,
        avgMs: value.count > 0 ? Number((value.sumMs / value.count).toFixed(2)) : 0,
        maxMs: Number(value.maxMs.toFixed(2))
      }
    ]))
  )

  return { counters: counterSnapshot, timingsMs: timingSnapshot }
}

