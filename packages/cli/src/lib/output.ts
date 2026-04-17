/** Output a value — JSON mode emits raw JSON, pretty mode formats for humans */
export function output(data: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  } else if (typeof data === 'string') {
    process.stdout.write(data + '\n')
  } else {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  }
}

/** Format a simple table from an array of objects */
export function formatTable(rows: Record<string, string | number | undefined>[], columns: { key: string; label: string; width?: number }[]): string {
  if (rows.length === 0) return '  (none)'

  // Compute column widths
  const widths = columns.map(col => {
    const maxContent = Math.max(
      col.label.length,
      ...rows.map(r => String(r[col.key] ?? '').length)
    )
    return col.width ? Math.min(col.width, maxContent) : maxContent
  })

  // Header
  const header = columns.map((col, i) => col.label.padEnd(widths[i])).join('  ')
  const separator = widths.map(w => '─'.repeat(w)).join('──')

  // Rows
  const body = rows.map(row =>
    columns.map((col, i) => {
      const val = String(row[col.key] ?? '')
      return val.length > widths[i] ? val.slice(0, widths[i] - 1) + '…' : val.padEnd(widths[i])
    }).join('  ')
  ).join('\n')

  return `${header}\n${separator}\n${body}`
}

/** Format a relative time like "2 hours ago" */
export function timeAgo(date: string | Date): string {
  const now = Date.now()
  const then = new Date(date).getTime()
  const diff = now - then

  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`

  const years = Math.floor(months / 12)
  return `${years}y ago`
}

/** Truncate a UUID to first 8 chars for display */
export function shortId(id: string): string {
  return id.slice(0, 8)
}
