// M5-T9 hook (jsdom): use-ssh-keys (library + tambah/rename/hapus) dan mutasi use-os-images
// (daftar/hapus + pemetaan error server per field). fetch di-stub.
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./use-host-config"
import {
  OS_IMAGES_KEY,
  osImageFieldErrors,
  useCreateOsImage,
  useDeleteOsImage,
  useOsLabel,
  type NewOsImagePayload,
} from "./use-os-images"
import {
  apiErrorMessage,
  SSH_KEYS_KEY,
  useCreateSshKey,
  useDeleteSshKey,
  useRenameSshKey,
  useSshKeyLibrary,
  type SshKeyInfo,
} from "./use-ssh-keys"

let calls: { url: string; init?: RequestInit }[] = []
let responder: (url: string, init?: RequestInit) => Response

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return responder(url, init)
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const w = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children)
  return { qc, w }
}
const json = (body: unknown, status = 200) => Response.json(body, { status })

const KEY: SshKeyInfo = {
  id: "key-1",
  name: "ops",
  type: "ssh-ed25519",
  publicKey: "ssh-ed25519 AAAA ops@lab",
  fingerprint: "SHA256:abc",
  comment: "ops@lab",
  createdAt: "2026-11-05T10:00:00.000Z",
  usedBy: 2,
}

describe("use-ssh-keys", () => {
  it("library: GET /api/ssh-keys no-store, memuat usedBy", async () => {
    responder = () => json([KEY])
    const { qc, w } = wrapper()
    const r = renderHook(() => useSshKeyLibrary(), { wrapper: w })
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true))
    expect(calls[0]).toEqual({ url: "/api/ssh-keys", init: { cache: "no-store" } })
    expect(qc.getQueryData<SshKeyInfo[]>(SSH_KEYS_KEY)?.[0].usedBy).toBe(2)
  })

  it("tambah: POST JSON; 409 → ApiError membawa pesan server", async () => {
    responder = (_u, init) =>
      JSON.parse(String(init?.body)).name === "dup"
        ? json({ error: 'Key sudah ada di library sebagai "ops"' }, 409)
        : json(KEY, 201)
    const { qc, w } = wrapper()
    const inval = vi.spyOn(qc, "invalidateQueries")
    const r = renderHook(() => useCreateSshKey(), { wrapper: w })
    await act(() => r.result.current.mutateAsync({ name: "ops", publicKey: KEY.publicKey }))
    expect(calls[0].init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } })
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ name: "ops", publicKey: KEY.publicKey })
    expect(inval).toHaveBeenCalledWith({ queryKey: SSH_KEYS_KEY })
    const err = await r.result.current.mutateAsync({ name: "dup", publicKey: "x" }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(409)
    expect(apiErrorMessage(err)).toBe('Key sudah ada di library sebagai "ops"')
  })

  it("rename: PATCH {name} saja; cache diganti per id; 400 → pesan tanpa path zod", async () => {
    const { qc, w } = wrapper()
    qc.setQueryData(SSH_KEYS_KEY, [KEY, { ...KEY, id: "key-2", name: "lain" }])
    responder = (_u, init) =>
      JSON.parse(String(init?.body)).name === ""
        ? json({ error: "Input tidak valid", errors: [{ section: "name", message: "name: Nama wajib" }] }, 400)
        : json({ ...KEY, name: "ops-baru" })
    const r = renderHook(() => useRenameSshKey(), { wrapper: w })
    await act(() => r.result.current.mutateAsync({ id: "key-1", name: "ops-baru" }))
    expect(calls[0].url).toBe("/api/ssh-keys/key-1")
    expect(calls[0].init).toMatchObject({ method: "PATCH" })
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ name: "ops-baru" })
    expect(qc.getQueryData<SshKeyInfo[]>(SSH_KEYS_KEY)?.map((k) => k.name)).toEqual(["ops-baru", "lain"])
    const err = await r.result.current.mutateAsync({ id: "key-1", name: "" }).catch((e) => e)
    expect(apiErrorMessage(err)).toBe("Nama wajib")
    expect(apiErrorMessage(new Error("x"))).toBe("x")
    expect(apiErrorMessage(new ApiError("Input tidak valid", 400, [{ section: "hostIds", message: "tanpa path" }]))).toBe("tanpa path")
  })

  it("hapus: DELETE 204; 409 dipakai → error", async () => {
    responder = (u) => (u.endsWith("key-1") ? new Response(null, { status: 204 }) : json({ error: "Key dipakai 2 host" }, 409))
    const r = renderHook(() => useDeleteSshKey(), { wrapper: wrapper().w })
    await act(() => r.result.current.mutateAsync("key-1"))
    expect(calls[0]).toMatchObject({ url: "/api/ssh-keys/key-1", init: { method: "DELETE" } })
    const err = await r.result.current.mutateAsync("key-2").catch((e) => e)
    expect(err.message).toBe("Key dipakai 2 host")
  })

  it("error tanpa body JSON → status teks", async () => {
    responder = () => new Response("x", { status: 502, statusText: "Bad Gateway" })
    const r = renderHook(() => useDeleteSshKey(), { wrapper: wrapper().w })
    const err = await r.result.current.mutateAsync("key-1").catch((e) => e)
    expect(err.message).toBe("502 Bad Gateway")
  })
})

const IMG: NewOsImagePayload = {
  id: "ubuntu-24.04-hwe",
  name: "Ubuntu Server",
  version: "24.04 HWE",
  arch: "amd64",
  method: "autoinstall",
  bootable: true,
  source: { kernel: "u/vmlinuz", initrd: "u/initrd", repo: "u" },
}

describe("use-os-images mutasi", () => {
  it("daftar: POST JSON 201 + invalidasi katalog; hapus: DELETE", async () => {
    responder = (u, init) =>
      init?.method === "DELETE" ? new Response(null, { status: 204 }) : json({ ...IMG, available: true, reason: null }, 201)
    const { qc, w } = wrapper()
    const inval = vi.spyOn(qc, "invalidateQueries")
    const c = renderHook(() => useCreateOsImage(), { wrapper: w })
    await act(() => c.result.current.mutateAsync(IMG))
    expect(calls[0]).toMatchObject({ url: "/api/os-images", init: { method: "POST", headers: { "content-type": "application/json" } } })
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(IMG)
    expect(inval).toHaveBeenCalledWith({ queryKey: OS_IMAGES_KEY })
    const d = renderHook(() => useDeleteOsImage(), { wrapper: w })
    await act(() => d.result.current.mutateAsync("ubuntu-24.04-hwe"))
    expect(calls[1]).toMatchObject({ url: "/api/os-images/ubuntu-24.04-hwe", init: { method: "DELETE" } })
  })

  it("409 hapus image terpakai → pesan server", async () => {
    responder = () => json({ error: "OS image dipakai 1 host/job" }, 409)
    const d = renderHook(() => useDeleteOsImage(), { wrapper: wrapper().w })
    const err = await d.result.current.mutateAsync("ubuntu-24.04").catch((e) => e)
    expect(err.message).toBe("OS image dipakai 1 host/job")
  })

  it("osImageFieldErrors: 400 per field (path zod), 409 → id, lainnya → form", () => {
    const e400 = new ApiError("Input tidak valid", 400, [
      { section: "id" as never, message: "id: Id: huruf kecil, angka, titik, minus" },
      { section: "source" as never, message: "source.kernel: Path relatif terhadap media (tanpa / di awal)" },
      { section: "source" as never, message: "source: Image bootable wajib punya kernel dan initrd" },
      { section: "hostIds", message: "aneh" },
    ])
    expect(osImageFieldErrors(e400)).toEqual({
      id: ["Id: huruf kecil, angka, titik, minus"],
      "source.kernel": ["Path relatif terhadap media (tanpa / di awal)"],
      source: ["Image bootable wajib punya kernel dan initrd"],
      form: ["aneh"],
    })
    expect(osImageFieldErrors(new ApiError("OS image x sudah ada", 409))).toEqual({ id: ["OS image x sudah ada"] })
    expect(osImageFieldErrors(new ApiError("Body bukan JSON yang valid", 400))).toEqual({ form: ["Body bukan JSON yang valid"] })
    expect(osImageFieldErrors(new Error("jaringan"))).toEqual({ form: ["jaringan"] })
  })

  it("useOsLabel: katalog server (image terdaftar) lalu fallback bawaan / id", async () => {
    responder = () => json([{ ...IMG, available: true, reason: null }])
    const r = renderHook(() => useOsLabel(), { wrapper: wrapper().w })
    await waitFor(() => expect(r.result.current("ubuntu-24.04-hwe")).toBe("Ubuntu Server 24.04 HWE"))
    expect(r.result.current("ubuntu-24.04.5")).toBe("Ubuntu Server 24.04.5 LTS")
    expect(r.result.current("tak-dikenal")).toBe("tak-dikenal")
    expect(r.result.current(null)).toBeNull()
  })
})
