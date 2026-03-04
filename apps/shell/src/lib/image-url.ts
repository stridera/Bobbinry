export function getVariantUrl(originalUrl: string, variant: 'thumb' | 'medium'): string {
  // URL format: .../api/images/{encodedKey}
  // The key has a file extension — replace it with _variant.webp
  const lastDot = originalUrl.lastIndexOf('.')
  if (lastDot === -1) return `${originalUrl}_${variant}.webp`
  return `${originalUrl.substring(0, lastDot)}_${variant}.webp`
}
