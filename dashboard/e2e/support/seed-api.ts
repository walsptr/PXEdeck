// Prasyarat E2E lewat API publik (bukan seed): seed M4 tidak lagi membawa credentials maupun key
// library (SR-2-1/CR-3-12). Test M2/M3 yang dulu mengandalkan key "Admin workstation" dan user
// `ubuntu` dari seed menyiapkannya sendiri di sini.
import { expect, type APIRequestContext } from "@playwright/test"

import { DUMMY_PASSWORD, SSH_RSA_ADMIN } from "../../src/test/fixtures"

const JSON_HEADERS = { "content-type": "application/json" }

/** Key library "Admin workstation" (idempoten). Mengembalikan id key. */
export async function ensureAdminKey(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/ssh-keys", { headers: JSON_HEADERS, data: { name: "Admin workstation", publicKey: SSH_RSA_ADMIN.publicKey } })
  if (res.status() === 201) return (await res.json()).id
  expect(res.status()).toBe(409)
  const keys = (await (await request.get("/api/ssh-keys")).json()) as { id: string; fingerprint: string }[]
  return keys.find((k) => k.fingerprint === SSH_RSA_ADMIN.fingerprint)!.id
}

/**
 * Host siap seperti seed M2/M3: credentials `ubuntu` + password dummy (sudo), key "Admin
 * workstation" terpilih. Status/OS/network host tidak diubah.
 */
export async function readyLikeSeed(request: APIRequestContext, hostIds: string[], keyId: string) {
  for (const id of hostIds) {
    const res = await request.patch(`/api/hosts/${id}`, {
      headers: JSON_HEADERS,
      data: {
        credentials: { mode: "same", username: "ubuntu", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: false },
        ssh: { keyIds: [keyId], newKeys: [], user: "" },
      },
    })
    expect(res.status(), `PATCH ${id}: ${await res.text()}`).toBe(200)
  }
}
