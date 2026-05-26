/**
 * Zip-bomb defense for zip-based importers (epub, odt, future docx pre-pass).
 *
 * Each format that decompresses an uploaded archive should call
 * assertSafeZip() with the loaded jszip instance BEFORE extracting any
 * entries. The caps are conservative enough for real manuscripts (a long
 * novel with cover art is well under 50 MB) while preventing pathological
 * highly-compressed archives from exhausting memory on the API host.
 */

import type JSZip from 'jszip'

export const MAX_TOTAL_UNCOMPRESSED_BYTES = 250 * 1024 * 1024 // 250 MB
export const MAX_PER_ENTRY_BYTES = 50 * 1024 * 1024 // 50 MB
export const MAX_ENTRY_COUNT = 5000

export class ZipBombError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipBombError'
  }
}

interface JSZipInternalFile {
  /** Some jszip versions expose uncompressed size as `_data.uncompressedSize`. */
  _data?: { uncompressedSize?: number; compressedSize?: number }
  /** Newer versions surface a top-level property. */
  uncompressedSize?: number
}

function entryUncompressedSize(file: unknown): number | null {
  const f = file as JSZipInternalFile
  if (typeof f.uncompressedSize === 'number') return f.uncompressedSize
  if (typeof f._data?.uncompressedSize === 'number') return f._data.uncompressedSize
  return null
}

export function assertSafeZip(zip: JSZip): void {
  const fileEntries = Object.entries(zip.files)

  if (fileEntries.length > MAX_ENTRY_COUNT) {
    throw new ZipBombError(
      `Archive contains ${fileEntries.length} entries — refusing (cap is ${MAX_ENTRY_COUNT}).`,
    )
  }

  let total = 0
  for (const [name, file] of fileEntries) {
    if (file.dir) continue
    const size = entryUncompressedSize(file)
    if (size === null) {
      // jszip didn't surface the size — fall through. The per-extraction
      // size cap in readEntrySafely() catches anomalies at unpack time.
      continue
    }
    if (size > MAX_PER_ENTRY_BYTES) {
      throw new ZipBombError(
        `Archive entry '${name}' is ${size} bytes uncompressed — exceeds per-entry cap of ${MAX_PER_ENTRY_BYTES}.`,
      )
    }
    total += size
    if (total > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new ZipBombError(
        `Archive expands to over ${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes — refusing.`,
      )
    }
  }
}
