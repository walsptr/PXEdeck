// Helper integration test route handler (dipanggil langsung, tanpa server HTTP).
export function ctx(id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { params: Promise.resolve({ id }) } as any
}

export function jsonReq(url: string, method: string, body?: unknown, raw?: string) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
}
