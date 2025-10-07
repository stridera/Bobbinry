/**
 * Cryptographic utilities for manifest signature verification
 * 
 * Uses Ed25519 signatures for manifest integrity verification
 */

import * as nacl from 'tweetnacl'
import * as util from 'tweetnacl-util'

/**
 * Verify an Ed25519 signature for a manifest
 * 
 * @param manifestJson - The manifest JSON string (without signature field)
 * @param signature - Base64-encoded signature
 * @param publicKey - Base64-encoded public key
 * @returns true if signature is valid
 */
export function verifyManifestSignature(
  manifestJson: string,
  signature: string,
  publicKey: string
): boolean {
  try {
    // Decode base64 strings
    const signatureBytes = util.decodeBase64(signature)
    const publicKeyBytes = util.decodeBase64(publicKey)
    const messageBytes = util.decodeUTF8(manifestJson)

    // Verify signature
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes)
  } catch (error) {
    // Invalid encoding or verification failure
    return false
  }
}

/**
 * Sign a manifest (for development/testing)
 * 
 * @param manifestJson - The manifest JSON string
 * @param secretKey - Base64-encoded secret key (64 bytes)
 * @returns Base64-encoded signature
 */
export function signManifest(manifestJson: string, secretKey: string): string {
  const secretKeyBytes = util.decodeBase64(secretKey)
  const messageBytes = util.decodeUTF8(manifestJson)
  const signature = nacl.sign.detached(messageBytes, secretKeyBytes)
  return util.encodeBase64(signature)
}

/**
 * Generate a new Ed25519 keypair (for development/testing)
 * 
 * @returns Object with base64-encoded public and secret keys
 */
export function generateKeypair(): { publicKey: string; secretKey: string } {
  const keypair = nacl.sign.keyPair()
  return {
    publicKey: util.encodeBase64(keypair.publicKey),
    secretKey: util.encodeBase64(keypair.secretKey)
  }
}

/**
 * List of trusted public keys for manifest verification
 * In production, these would be managed through a secure key management system
 */
const TRUSTED_PUBLIC_KEYS = new Set<string>([
  // First-party Anthropic/Bobbinry public key (placeholder)
  process.env.BOBBINRY_PUBLIC_KEY || '',
  
  // Add more trusted keys as needed for verified publishers
])

/**
 * Check if a public key is trusted
 */
export function isTrustedPublicKey(publicKey: string): boolean {
  return TRUSTED_PUBLIC_KEYS.has(publicKey)
}

/**
 * Add a trusted public key (for runtime configuration)
 */
export function addTrustedPublicKey(publicKey: string): void {
  TRUSTED_PUBLIC_KEYS.add(publicKey)
}
