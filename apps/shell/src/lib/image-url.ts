export function getVariantUrl(originalUrl: string, variant: 'thumb' | 'medium'): string {
  // URL format: .../api/images/{encodedKey}
  // The key has a file extension — replace it with __variant.webp
  const lastDot = originalUrl.lastIndexOf('.')
  if (lastDot === -1) return `${originalUrl}__${variant}.webp`
  return `${originalUrl.substring(0, lastDot)}__${variant}.webp`
}
