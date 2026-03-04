import sharp from 'sharp'
import { getObject, putObject } from './s3'

const VARIANT_CONFIGS = {
  thumb: { width: 400, quality: 80 },
  medium: { width: 1200, quality: 80 },
} as const

export type VariantName = keyof typeof VARIANT_CONFIGS

export function variantKey(originalKey: string, variant: VariantName): string {
  const lastDot = originalKey.lastIndexOf('.')
  if (lastDot === -1) return `${originalKey}_${variant}.webp`
  return `${originalKey.substring(0, lastDot)}_${variant}.webp`
}

export async function generateVariants(originalKey: string): Promise<void> {
  const obj = await getObject(originalKey)
  if (!obj) throw new Error(`Original not found in S3: ${originalKey}`)

  // Read the full body into a buffer
  const chunks: Uint8Array[] = []
  const reader = obj.body as NodeJS.ReadableStream
  for await (const chunk of reader) {
    chunks.push(chunk as Uint8Array)
  }
  const buffer = Buffer.concat(chunks)

  await Promise.all(
    (Object.entries(VARIANT_CONFIGS) as [VariantName, { width: number; quality: number }][]).map(
      async ([variant, config]) => {
        const resized = await sharp(buffer)
          .resize(config.width, undefined, { withoutEnlargement: true, fit: 'inside' })
          .webp({ quality: config.quality })
          .toBuffer()

        await putObject(variantKey(originalKey, variant), resized, 'image/webp')
      }
    )
  )
}
