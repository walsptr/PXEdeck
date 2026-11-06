// M6 iterasi 2 (gate-iter1, DEC-022) — backend:
//   R4  SR-6-1 / CR-6-3  install Debian dengan media eksternal (host PXE_MEDIA_URL ≠ PXE_SERVER_IP)
//                        ditolak 422 dengan pesan jelas (pola installBlocker); media lokal tetap jalan.
//   R5  SR-6-2 (AC-6.53) infra/README.md §Asumsi keamanan memuat sisa risiko DEC-021, catatan
//                        DEC-019 §1, dan SR-6-3.
//   SR-6-3 / CR-6-6      peringatan start production tanpa PXE_TRUST_PROXY=1.
//   CR-6-1               total authorized_keys per host ≤ 32 KiB → selain itu 422 (API).
//   SR-6-4               base64 ter-wrap (60/64/76 kolom) digabung sebelum didekode; tetap linear.
import { readFileSync } from "node:fs"
import path from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

import { AUTHORIZED_KEYS_MAX_BYTES } from "@/lib/host-config"
import { applyConfig } from "@/lib/server/config-service"
import { cleanEventMessage } from "@/lib/server/db/repos/job-events"
import { peekConfig } from "@/lib/server/db/repos/configs"
import { getActiveJob } from "@/lib/server/db/repos/jobs"
import { createSshKey } from "@/lib/server/library-service"
import { cleanAndRedact, REDACTED_B64, REDACTED_KEY, redactSecrets } from "@/lib/server/redact"
import { getSettings, trustProxyWarnings } from "@/lib/server/settings"
import { onServerStart } from "@/lib/server/startup"
import { dbSnapshot, makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD, SSH_ED25519 } from "@/test/fixtures"
import { ctx, jsonReq } from "@/test/route"
import { synthKey, synthKeysTotal } from "@/test/synth-keys"

import { POST as bulkInstall } from "@/app/api/hosts/bulk/install/route"
import { POST as install } from "@/app/api/hosts/[id]/install/route"
import { PATCH } from "@/app/api/hosts/[id]/route"

const REPO = path.resolve(__dirname, "../../../..")
const MEDIA = makeMediaRoot(tmpDir("media-iter2"))
withDb("demo", { PXE_MEDIA_ROOT: MEDIA })

const DISC1 = "b083fe5c19e2"
const DISC2 = "b083fe5c19e3"
const patch = (id: string, body: unknown) => PATCH(jsonReq(`/api/hosts/${id}`, "PATCH", body), ctx(id))
const creds = { mode: "same" as const, username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: false }
const os = (osImageId: string) => ({ osImageId, disk: "", partition: "auto" as const, timezone: "UTC", locale: "en_US.UTF-8" })
const newKey = (publicKey: string) => ({ name: "", publicKey, saveToLibrary: false })

async function readyHost(id: string, osImageId: string) {
  const res = await patch(id, { os: os(osImageId), credentials: creds, ssh: { keyIds: [], newKeys: [newKey(SSH_ED25519.publicKey)], user: "" } })
  expect(res.status, await res.clone().text()).toBe(200)
}

// ---------------------------------------------------------------------------
describe("R4 SR-6-1 / CR-6-3: install Debian hanya dari media server PXE lokal (DEC-022 §2)", () => {
  it("default (PXE_MEDIA_URL turunan PXE_BASE_URL = server PXE) → Debian mulai install (200)", async () => {
    await readyHost(DISC1, "debian-12")
    expect(getSettings().mediaUrl).toBe("http://10.10.10.1/media")
    const res = await install(jsonReq("/x", "POST"), ctx(DISC1))
    expect(res.status).toBe(200)
    expect(getActiveJob(DISC1)).toMatchObject({ osImageId: "debian-12", status: "booting" })
  })
  it.each(["http://deb.debian.org/media", "http://10.10.10.2/media", "http://pxe.lab.example/media"])(
    "PXE_MEDIA_URL=%s → install Debian 422 dengan pesan jelas, tanpa job",
    async (url) => {
      await readyHost(DISC1, "debian-12")
      process.env.PXE_MEDIA_URL = url
      const before = dbSnapshot()
      const res = await install(jsonReq("/x", "POST"), ctx(DISC1))
      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.started).toEqual([])
      expect(body.failed).toHaveLength(1)
      expect(body.failed[0].message).toMatch(/^b0:83:fe:5c:19:e2: Debian: media \S+ bukan server PXE lokal \(10\.10\.10\.1\)/)
      expect(body.failed[0].message).toMatch(/DEC-021/)
      expect(body.failed[0].message).toContain("PXE_MEDIA_URL")
      expect(getActiveJob(DISC1)).toBeNull()
      expect(dbSnapshot()).toBe(before)
    },
  )
  it("media eksternal tidak memblokir OS lain: bulk Ubuntu mulai, Debian gagal per host", async () => {
    await readyHost(DISC1, "debian-12")
    await readyHost(DISC2, "ubuntu-24.04")
    process.env.PXE_MEDIA_URL = "http://deb.debian.org/media"
    const res = await bulkInstall(jsonReq("/x", "POST", { hostIds: [DISC1, DISC2] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.started).toEqual([DISC2])
    expect(body.failed).toEqual([{ hostId: DISC1, message: expect.stringMatching(/bukan server PXE lokal/) }])
  })
})

// ---------------------------------------------------------------------------
describe("CR-6-1: total authorized_keys per host ≤ 32 KiB (422)", () => {
  it("tepat 32 KiB (key baru) → 200, tersimpan", async () => {
    const keys = synthKeysTotal(AUTHORIZED_KEYS_MAX_BYTES, 12_000)
    const res = await patch(DISC1, { ssh: { keyIds: [], newKeys: keys.map(newKey), user: "" } })
    expect(res.status, await res.clone().text()).toBe(200)
    expect(peekConfig(DISC1)!.extraKeys).toHaveLength(keys.length)
  })
  it("32 KiB + 1 byte → 422 section ssh dengan pesan batas, tanpa efek", async () => {
    const keys = synthKeysTotal(AUTHORIZED_KEYS_MAX_BYTES + 1, 12_000)
    const before = dbSnapshot()
    const res = await patch(DISC1, { ssh: { keyIds: [], newKeys: keys.map(newKey), user: "" } })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.errors).toContainEqual({
      section: "ssh",
      message: expect.stringMatching(/^Total SSH key 32769 byte melebihi batas 32768 byte \(32 KiB\) per host/),
    })
    expect(dbSnapshot()).toBe(before)
  })
  it("key library terpilih ikut dihitung (library + baru > 32 KiB → 422; library saja ≤ batas → 200)", async () => {
    const ids: string[] = []
    for (const [i, k] of synthKeysTotal(30_000, 10_000).entries()) {
      const r = await createSshKey({ name: `besar-${i}`, publicKey: k })
      if (!r.ok) throw new Error(r.error)
      ids.push(r.value.id)
    }
    expect((await patch(DISC1, { ssh: { keyIds: ids, newKeys: [], user: "" } })).status).toBe(200)
    const res = await patch(DISC1, { ssh: { keyIds: ids, newKeys: [newKey(synthKey(99, 3_000))], user: "" } })
    expect(res.status).toBe(422)
    expect(JSON.stringify(await res.json())).toMatch(/Total SSH key 33001 byte melebihi batas 32768 byte/)
  })
  it("bulk (applyConfig banyak host) juga ditolak, tidak ada host yang berubah", async () => {
    const keys = synthKeysTotal(40_000, 12_000)
    const r = await applyConfig([DISC1, DISC2], { ssh: { keyIds: [], newKeys: keys.map(newKey), user: "" } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.map((e) => e.message).join("\n")).toMatch(/melebihi batas 32768 byte/)
    expect(peekConfig(DISC1)?.extraKeys ?? []).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe("SR-6-3 / CR-6-6: peringatan start production tanpa PXE_TRUST_PROXY=1", () => {
  it("trustProxyWarnings: production + trustProxy false → satu baris; selain itu kosong", () => {
    const s = getSettings()
    expect(s.trustProxy).toBe(false)
    const [w, ...rest] = trustProxyWarnings(s, "production")
    expect(rest).toEqual([])
    expect(w).toMatch(/^peringatan: NODE_ENV=production tanpa PXE_TRUST_PROXY=1/)
    expect(w).toMatch(/batas login per IP berlaku global/)
    expect(trustProxyWarnings(s, "development")).toEqual([])
    expect(trustProxyWarnings(s, undefined)).toEqual([])
    expect(trustProxyWarnings({ ...s, trustProxy: true }, "production")).toEqual([])
  })
  it("onServerStart di production tanpa PXE_TRUST_PROXY → logger.warn `[pxe] peringatan: …`", () => {
    vi.stubEnv("NODE_ENV", "production")
    try {
      const warn = vi.fn()
      onServerStart({ warn, error: vi.fn() }, false)
      const lines = warn.mock.calls.map((c) => String(c[0]))
      expect(lines.filter((l) => l.startsWith("[pxe] peringatan: NODE_ENV=production tanpa PXE_TRUST_PROXY=1"))).toHaveLength(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it("onServerStart di production DENGAN PXE_TRUST_PROXY=1 (+ lease) → tanpa peringatan proxy", () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.PXE_TRUST_PROXY = "1"
    process.env.PXE_DNSMASQ_LEASES = path.join(MEDIA, "dnsmasq.leases")
    try {
      const warn = vi.fn()
      onServerStart({ warn, error: vi.fn() }, false)
      expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).not.toMatch(/PXE_TRUST_PROXY/)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

// ---------------------------------------------------------------------------
describe("R5 SR-6-2 (AC-6.53): infra/README.md §Asumsi keamanan memuat DEC-021, DEC-019 §1, SR-6-3", () => {
  const readme = readFileSync(path.join(REPO, "infra/README.md"), "utf8")
  const section = readme.split(/^## /m).find((s) => s.startsWith("Asumsi keamanan")) ?? ""
  const bullet = (re: RegExp) => section.split(/\n- /).find((b) => re.test(b)) ?? ""

  it("(a) sisa risiko DEC-021: apt tanpa verifikasi tanda tangan, media lokal saja, dibersihkan di late_command + SSH, checksum ISO", () => {
    const b = bullet(/DEC-021/)
    expect(b).not.toBe("")
    for (const re of [
      /tanpa verifikasi tanda tangan/,
      /trusted=yes/,
      /media lokal/,
      /PXE_SERVER_IP/,
      /422/,
      /late_command/,
      /SSH/,
      /checksum/,
      /kvm\/media-checksums\.txt/,
    ])
      expect(b, String(re)).toMatch(re)
  })
  it("(b) DEC-019 §1: polling memperpanjang idle, batas atas absolut PXE_SESSION_MAX_HOURS", () => {
    const b = bullet(/DEC-019/)
    expect(b).not.toBe("")
    for (const re of [/polling/, /idle/, /absolut/, /PXE_SESSION_MAX_HOURS/]) expect(b, String(re)).toMatch(re)
  })
  it("(c) SR-6-3: tanpa PXE_TRUST_PROXY batas login per IP menjadi global + peringatan start", () => {
    const b = bullet(/SR-6-3/)
    expect(b).not.toBe("")
    for (const re of [/PXE_TRUST_PROXY/, /per IP/, /global/, /\[pxe\] peringatan/]) expect(b, String(re)).toMatch(re)
  })
  it("berkas checksum yang dirujuk ada", () => {
    expect(readFileSync(path.join(REPO, ".agent/runs/m6/kvm/media-checksums.txt"), "utf8").length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64")
const wrap = (s: string, w: number) => s.match(new RegExp(`.{1,${w}}`, "g"))!.join("\n")
const wrap76 = (s: string) => wrap(s, 76)
const MAC = "52:54:00:99:00:41"
const TOK = "Lm2nOp5qRsTuVwXyZaBcDeFgHiJkLmNoPqRsTuVwXyZ"
const HASH = `$6$fixturesalt$${"AbCdEfGhIjKlMnOpQrStUvWxYz0123456789./".repeat(3).slice(0, 86)}`

/** Tidak ada baris output yang memuat potongan (≥ 8 karakter) dari baris base64 masukan. */
function expectNoFragment(input: string, output: string) {
  for (const line of input.split("\n")) {
    const core = line.replace(/^.*?([A-Za-z0-9+/]+=*)\s*$/, "$1")
    for (let i = 0; i + 8 <= core.length; i += 4) expect(output, `potongan "${core.slice(i, i + 8)}"`).not.toContain(core.slice(i, i + 8))
  }
}

describe("SR-6-4: base64 ter-wrap digabung sebelum didekode (regresi PoC reviewer)", () => {
  const POC_TOKEN = wrap76(b64(`curl http://10.99.0.2/boot/${MAC}/${TOK}/status`))
  const POC_HASH = wrap76(b64(`password: "${HASH}"`))

  it.each([
    ["wrap76(b64(curl …/boot/<mac>/<tok>/status))", POC_TOKEN],
    ["wrap76(b64(password: \"$6$…\"))", POC_HASH],
  ])("PoC %s: setiap baris → [REDACTED-B64], tanpa potongan body", (_n, input) => {
    expect(input.split("\n").length).toBeGreaterThanOrEqual(2)
    for (const out of [redactSecrets(input), cleanAndRedact(input, true), cleanAndRedact(`${input}\n`, true)]) {
      const lines = out.split("\n").filter((l) => l !== "")
      expect(lines).toEqual(input.split("\n").map(() => REDACTED_B64))
      expectNoFragment(input, out)
    }
    expectNoFragment(input, cleanEventMessage(input))
  })

  it.each([60, 64, 76])("lebar %i, ≥ 3 baris, dengan prefiks log dan teks di sekitarnya", (w) => {
    const blob = wrap(b64(`#!/bin/sh\nexport URL=http://10.99.0.2/boot/${MAC}/${TOK}/log\npasswd_hash='${HASH}'\n`), w)
    expect(blob.split("\n").length).toBeGreaterThanOrEqual(3)
    const input = `mulai unggah\n${blob
      .split("\n")
      .map((l) => `Nov  6 01:02:03 node cloud-init[812]: ${l}`)
      .join("\n")}\nselesai`
    const out = cleanAndRedact(input, true)
    expectNoFragment(blob, out)
    const lines = out.split("\n")
    expect(lines[0]).toBe("mulai unggah")
    if (w === 64) {
      // Lebar 64 = lebar isi PEM: ≥ 2 baris 64 kolom sudah ditandai keyBodyRunRanges (CR-5-20b) sebagai
      // satu blok `[REDACTED PRIVATE KEY]` (over-redaksi yang diterima); yang diasersi: tanpa potongan.
      expect(out).toContain(REDACTED_KEY)
      return
    }
    expect(lines.at(-1)).toBe("selesai")
    for (const l of lines.slice(1, -1)) expect(l).toBe(`Nov  6 01:02:03 node cloud-init[812]: ${REDACTED_B64}`)
  })

  it("rangkaian berakhir di baris lebar penuh (panjang kelipatan lebar) juga tertangkap", () => {
    let payload = `x=http://10.99.0.2/boot/${MAC}/${TOK}/status;`
    while (b64(payload).length % 76 !== 0) payload += "#"
    const input = wrap76(b64(payload))
    expect(input.split("\n").every((l) => l.length === 76)).toBe(true)
    expectNoFragment(input, redactSecrets(input))
  })

  it("rahasia terpotong di batas baris (`/boot/<mac>/` di baris 1, token di baris 2) tertangkap", () => {
    // Padding agar `/boot/<mac>/` berakhir tepat di akhir baris 1 hasil dekode.
    const pre = "y".repeat(57 - `GET /boot/${MAC}/`.length)
    const input = wrap76(b64(`${pre}GET /boot/${MAC}/${TOK} HTTP/1.1`))
    expectNoFragment(input, redactSecrets(input))
  })

  it("dua lapis ter-wrap (base64 dari keluaran `base64` 76 kolom) dengan token melintasi batas baris lapis dalam", () => {
    const pre = "p".repeat(57 - `GET /boot/${MAC}/`.length)
    const inner = wrap76(b64(`${pre}GET /boot/${MAC}/${TOK} HTTP/1.1\n`))
    const input = wrap76(b64(`${inner}\n`))
    expect(input.split("\n").length).toBeGreaterThanOrEqual(3)
    const out = redactSecrets(input)
    expectNoFragment(input, out)
    expect(out.split("\n").every((l) => l === REDACTED_B64)).toBe(true)
  })

  it("tanpa over-redaksi: base64 ter-wrap tanpa secret, baris base64 lebar lain, dan teks biasa tidak berubah", () => {
    const benign = [
      wrap76(b64("Hello world, ini konfigurasi biasa tanpa rahasia apa pun. ".repeat(6))),
      wrap(b64("lorem ipsum dolor sit amet ".repeat(8)), 72),
      "Selesai memasang paket openssh-server curl sudo",
    ].join("\n")
    expect(redactSecrets(benign)).toBe(benign)
    expect(cleanAndRedact(benign, true)).toBe(benign)
  })

  it("baris tidak seragam (lebar berbeda di tengah) tidak digabung — rangkaian baru dimulai", () => {
    const a = wrap76(b64("aman ".repeat(30)))
    const s = wrap76(b64(`k=http://10.99.0.2/boot/${MAC}/${TOK}/status`))
    const input = `${a}\n${s}`
    const out = redactSecrets(input)
    expect(out.startsWith(a)).toBe(true)
    expectNoFragment(s, out)
  })

  const bestOf = (n: number, f: () => void) => {
    let best = Infinity
    for (let i = 0; i < n; i++) {
      const t = performance.now()
      f()
      best = Math.min(best, performance.now() - t)
    }
    return best
  }
  it.each([
    ["base64 ter-wrap 76 kolom tanpa secret (satu rangkaian)", wrap76(b64("z".repeat(12_400)))],
    ["banyak rangkaian 2 baris (76 + pendek) tanpa secret", `${wrap76(b64("q".repeat(80)))}\n`.repeat(140)],
    ["baris 76 kolom bergantian lebar 64", `${"A".repeat(76)}\n${"B".repeat(64)}\n`.repeat(115)],
  ])("16 KB %s: linear (≤ 20 ms terbaik dari 5)", (_n, input) => {
    expect(input.length).toBeGreaterThan(15000)
    expect(bestOf(5, () => redactSecrets(input))).toBeLessThan(20)
    expect(bestOf(5, () => cleanEventMessage(input))).toBeLessThan(20)
  })
  it("16 KB base64 bersarang 2 lapis ter-wrap: ≤ 50 ms (terbaik dari 5)", () => {
    // Kasus terberat: setiap baris juga didekode 2 lapis oleh pass per baris lama (B64_RUN_RE, sejak
    // M5) — ≈ 6 ms dari ≈ 7 ms terukur tanpa beban di mesin dev; pass gabungan SR-6-4 menambah
    // ≈ 1 ms. Di bawah beban suite paralel + coverage pass lama saja bisa > 20 ms, jadi kasus ini
    // memakai anggaran 50 ms (SR-5-11, log campuran). Kasus SR-5-11 lama tetap ≤ 20 ms, tidak diubah.
    const input = wrap76(b64(wrap76(b64("w".repeat(8600)))))
    expect(input.length).toBeGreaterThan(15000)
    expect(bestOf(5, () => redactSecrets(input))).toBeLessThan(50)
    expect(bestOf(5, () => cleanEventMessage(input))).toBeLessThan(50)
  })
})

beforeEach(() => {
  // Setiap test mulai tanpa override media (isolateEnv menghapus PXE_* sebelum test).
  expect(process.env.PXE_MEDIA_URL).toBeUndefined()
})
