/**
 * At-rest secret encryption for tokens stored in the database (OAuth refresh
 * tokens, long-lived API credentials, etc.).
 *
 * Uses AES-256-GCM with a key derived from NEXTAUTH_SECRET. The format is
 *
 *   v1:<base64url(iv)>:<base64url(ciphertext || auth-tag)>
 *
 * A value that doesn't start with `v1:` is treated as legacy plaintext so
 * tokens written before this helper existed continue to decrypt (they'll be
 * re-encrypted on the next write).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

const VERSION = 'v1'
const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

function deriveKey(): Buffer {
  const material = process.env.NEXTAUTH_SECRET || process.env.API_JWT_SECRET
  if (!material) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot encrypt secrets: NEXTAUTH_SECRET/API_JWT_SECRET not set')
    }
    // Dev-only — mirrors middleware/auth.ts fallback so dev workflows don't crash.
    return createHash('sha256').update('development-secret-only-for-local-dev').digest()
  }
  return createHash('sha256').update(material).digest()
}

export function encryptSecret(plain: string): string {
  if (!plain) return ''
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, deriveKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const payload = Buffer.concat([ciphertext, tag]).toString('base64url')
  return `${VERSION}:${iv.toString('base64url')}:${payload}`
}

/**
 * Decrypts a `v1:iv:payload` envelope. Returns legacy plaintext as-is so
 * existing unencrypted values keep working until the next write rotates them.
 */
export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return ''
  if (!stored.startsWith(`${VERSION}:`)) return stored

  const parts = stored.split(':')
  if (parts.length !== 3) return ''

  try {
    const iv = Buffer.from(parts[1]!, 'base64url')
    const combined = Buffer.from(parts[2]!, 'base64url')
    if (iv.length !== IV_LEN || combined.length < TAG_LEN) return ''
    const ciphertext = combined.subarray(0, combined.length - TAG_LEN)
    const tag = combined.subarray(combined.length - TAG_LEN)

    const decipher = createDecipheriv(ALGO, deriveKey(), iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return plain.toString('utf8')
  } catch {
    return ''
  }
}
