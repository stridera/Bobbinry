import { BobbinryAPI } from '@bobbinry/sdk'

// One client for the bobbin: the SDK owns the API origin, so this file no
// longer reads NEXT_PUBLIC_API_URL itself (two copies of that had drifted to
// different default ports).
const api = new BobbinryAPI()

/**
 * Authenticated fetch for panels that receive a bare `apiToken` prop.
 * `path` may carry the legacy `/api` prefix; the SDK base already includes it.
 */
export async function apiFetchLocal(path: string, token: string, init?: RequestInit) {
  api.setAuthToken(token)
  return api.fetch(path.replace(/^\/api(?=\/)/, ''), init)
}
