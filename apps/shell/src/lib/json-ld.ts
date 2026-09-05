/**
 * Serialize an object for a `<script type="application/ld+json">` body.
 *
 * `JSON.stringify` alone is not safe here: a `</script>` inside a user-controlled
 * string (project name, description, author bio) closes the element and the
 * rest is parsed as markup. Escaping `<` keeps the output valid JSON while
 * making that impossible.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
