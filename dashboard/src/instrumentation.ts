// Dipanggil sekali saat server Next start (docs: file-conventions/instrumentation).
// Hanya runtime Node.js: modul server memakai node:sqlite / node:fs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { onServerStart } = await import("@/lib/server/startup")
  onServerStart()
}
