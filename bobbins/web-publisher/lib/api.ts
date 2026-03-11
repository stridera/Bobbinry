const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100'

export async function apiFetchLocal(path: string, token: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  })
}
