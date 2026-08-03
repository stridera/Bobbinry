/**
 * Unbiased random token generation for user-facing credentials.
 *
 * Shared by API keys (`bby_`) and RSS feed tokens (`bby_rss_`), which both
 * previously carried their own copy of a base62 encoder built on `byte % 62`.
 * That is modulo-biased: a byte is 0-255 and 256 = 4 * 62 + 8, so the first
 * eight characters of the alphabet came up 5/256 of the time against 4/256 for
 * the other 54 — a 25% over-representation.
 *
 * The practical cost was small (~0.004 bits per character, so ~0.14 bits off a
 * 32-character token), but there is no reason to hand-wave about bias in
 * credential generation when rejection sampling is this cheap.
 */

import { randomBytes } from 'crypto'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * Largest multiple of 62 that fits in a byte. Bytes at or above this are the
 * biased tail and get redrawn rather than folded back into the alphabet.
 */
const UNBIASED_CEILING = 248 // 4 * 62

/**
 * A cryptographically random base62 string of exactly `length` characters,
 * with every character equally likely.
 */
export function randomBase62(length: number): string {
  let result = ''

  // Each draw keeps ~97% of its bytes (248/256), so this effectively never
  // loops more than twice; the loop is here for correctness, not throughput.
  while (result.length < length) {
    for (const byte of randomBytes(length - result.length)) {
      if (byte >= UNBIASED_CEILING) continue
      result += BASE62[byte % 62]
    }
  }

  return result
}
