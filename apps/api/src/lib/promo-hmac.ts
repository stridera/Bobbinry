/**
 * HMAC-based campaign code generation and validation.
 *
 * Codes are derived from a campaign secret + sequence number, so no individual
 * codes need to be stored. Validation iterates through the sequence range.
 */

import { createHmac, randomBytes } from 'crypto'

// Safe alphabet: no 0/O, 1/I/L to avoid confusion on printed cards
const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_SUFFIX_LENGTH = 8

/**
 * Generate a random 32-byte hex secret for a new campaign.
 */
export function generateCampaignSecret(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Derive the suffix for a given sequence number using HMAC-SHA256.
 */
function deriveSuffix(secret: string, seq: number): string {
  const hmac = createHmac('sha256', Buffer.from(secret, 'hex'))
  hmac.update(String(seq))
  const hash = hmac.digest()

  let suffix = ''
  for (let i = 0; i < CODE_SUFFIX_LENGTH; i++) {
    suffix += SAFE_ALPHABET[hash[i]! % SAFE_ALPHABET.length]
  }
  return suffix
}

/**
 * Generate a single campaign code for a given sequence number.
 * Format: PREFIX-XXXXXXXX
 */
export function generateCampaignCode(secret: string, prefix: string, seq: number): string {
  return `${prefix}-${deriveSuffix(secret, seq)}`
}

/**
 * Generate campaign codes for a specific sequence range [startSeq..endSeq].
 */
export function generateCampaignCodes(secret: string, prefix: string, startSeq: number, endSeq: number): string[] {
  const codes: string[] = []
  for (let i = startSeq; i <= endSeq; i++) {
    codes.push(generateCampaignCode(secret, prefix, i))
  }
  return codes
}

/**
 * Validate a campaign code by checking its suffix against all sequence numbers.
 * Returns true if the code matches any sequence in 1..codeCount.
 */
export function validateCampaignCode(
  code: string,
  secret: string,
  prefix: string,
  codeCount: number
): boolean {
  const expectedPrefix = `${prefix}-`
  if (!code.startsWith(expectedPrefix)) return false

  const suffix = code.slice(expectedPrefix.length)
  if (suffix.length !== CODE_SUFFIX_LENGTH) return false

  for (let i = 1; i <= codeCount; i++) {
    if (deriveSuffix(secret, i) === suffix) return true
  }
  return false
}

/**
 * Parse a submitted code to extract the prefix (everything before the last dash).
 * Returns null if the code doesn't contain a dash.
 */
export function parseCampaignPrefix(code: string): string | null {
  const dashIndex = code.lastIndexOf('-')
  if (dashIndex === -1) return null
  return code.slice(0, dashIndex)
}
