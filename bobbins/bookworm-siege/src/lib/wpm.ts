/**
 * Live words-per-minute over a rolling window.
 *
 * Pure logic: the caller supplies `now` (ms) rather than this module calling
 * Date.now(), so it stays deterministic and testable.
 */

const WINDOW_MS = 60_000

export class WpmTracker {
  private timestamps: number[] = []

  /** Record one completed word at time `now` (ms). */
  add(now: number): void {
    this.timestamps.push(now)
    this.prune(now)
  }

  /** Record `n` completed words at time `now`. */
  addMany(n: number, now: number): void {
    for (let i = 0; i < n; i++) this.timestamps.push(now)
    this.prune(now)
  }

  /** Words completed within the last 60s as of `now` — this is the live WPM. */
  wpm(now: number): number {
    this.prune(now)
    return this.timestamps.length
  }

  reset(): void {
    this.timestamps = []
  }

  private prune(now: number): void {
    const cutoff = now - WINDOW_MS
    // timestamps are monotonically appended, so drop from the front.
    let i = 0
    while (i < this.timestamps.length) {
      const ts = this.timestamps[i]
      if (ts === undefined || ts >= cutoff) break
      i++
    }
    if (i > 0) this.timestamps.splice(0, i)
  }
}
