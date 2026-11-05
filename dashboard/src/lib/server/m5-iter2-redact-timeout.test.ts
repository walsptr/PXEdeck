// M5 iterasi 2 (backend-dev): perbaikan temuan gate iter1.
//   SR-5-1  urutan sanitasi → redaksi: token/hash yang disisipi ESC/\x01 tetap teredaksi
//   SR-5-2  private key multi-baris di body log teredaksi seluruhnya (dengan/tanpa footer, footer yatim)
//   CR-5-1 + SR-5-5(a)  token path parsial (terpotong `cut -c1-240`), percent-encoded, hash `$6$` terpotong
//   CR-5-2 (DEC-016 §1)  timeout Booting dihitung dari entri `booting` pertama; ≥ 2 penyajian installer
//                        tidak mereset timer; Installing tetap dari entri pertama tahapnya
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { applyConfig } from "@/lib/server/config-service"
import { getDb } from "@/lib/server/db"
import {
  appendEvent,
  cleanEventMessage,
  eventsAfter,
  sanitizeMessage,
  stripControl,
} from "@/lib/server/db/repos/job-events"
import { getActiveJob, getJob } from "@/lib/server/db/repos/jobs"
import { decideBoot } from "@/lib/server/discovery"
import { installHosts } from "@/lib/server/install-service"
import { stageEnteredAt, sweepJobs, timeoutMessage } from "@/lib/server/job-lifecycle"
import { clearLeaseCache } from "@/lib/server/leases"
import { handleLogPost, serveConfigFile } from "@/lib/server/provisioning"
import { HASH_REDACTED, markPlaceholder, REDACTED, REDACTED_KEY, redactSecrets, secretMarks } from "@/lib/server/redact"
import { stopWatchdog } from "@/lib/server/watchdog"
import { makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD } from "@/test/fixtures"

const MEDIA = makeMediaRoot(tmpDir("m5i2-media"))
withDb("empty", {
  PXE_MGMT_CIDR: "10.99.0.0/24",
  PXE_MGMT_GATEWAY: "10.99.0.1",
  PXE_MGMT_DNS: "10.99.0.2",
  PXE_SERVER_IP: "10.99.0.2",
  PXE_DHCP_RANGE: "10.99.0.100-10.99.0.200",
  PXE_MEDIA_ROOT: MEDIA,
  PXE_INSECURE_NO_LEASE_CHECK: "1",
})

const MAC = "52:54:00:99:00:11"
const ID = "525400990011"
const IP = "10.99.0.150"
const T0 = Date.parse("2026-11-05T10:00:00.000Z")
const MIN = 60_000
const at = (sec: number) => new Date(T0 + sec * 1000)
const TOKEN_RE = /\/boot\/[0-9a-f:]{17}\/([A-Za-z0-9_-]{43})\//
const TOK = "abcDEF0123456789_-abcDEF0123456789_-abcDEFG" // 43
const HASH = `$6$saltsalt$${"Q".repeat(86)}`
const HASH_ROUNDS = `$6$rounds=5000$saltsalt$${"Q".repeat(86)}`
const ESC = "\x1b"
const SOH = "\x01"
// Isi "private key" palsu: baris base64 64 karakter yang TIDAK memuat pola secret saat didekode,
// sehingga hanya redaksi blok/ekor key yang bisa menyamarkannya.
const KEY_LINES = Array.from({ length: 6 }, (_, i) =>
  Buffer.from(`fixture-key-line-${i}-`.padEnd(48, String.fromCharCode(97 + i))).toString("base64"),
)
const BEGIN = "-----BEGIN OPENSSH PRIVATE KEY-----"
const END = "-----END OPENSSH PRIVATE KEY-----"

if (TOK.length !== 43) throw new Error("TOK 43")

beforeEach(() => clearLeaseCache())
afterEach(() => {
  stopWatchdog()
  vi.useRealTimers()
})

async function ready() {
  decideBoot({ mac: MAC, platform: "efi", ip: IP, wait: 0, now: at(0) })
  const r = await applyConfig([ID], {
    os: { osImageId: "ubuntu-24.04", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
    credentials: { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: true },
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  expect(installHosts([ID], at(0)).started).toEqual([ID])
}
const boot = (sec: number) => decideBoot({ mac: MAC, platform: "efi", ip: IP, wait: 0, now: at(sec) })
const allMessages = () =>
  (getDb().prepare("SELECT message FROM job_events").all() as { message: string }[]).map((r) => r.message)

// ---------------------------------------------------------------------------
describe("SR-5-1 sanitasi sebelum redaksi", () => {
  const splice = (s: string, i: number, c: string) => s.slice(0, i) + c + s.slice(i)
  const cases: [string, string, string][] = [
    ["token= + ESC", `token=${splice(TOK, 20, ESC)}`, `token=${REDACTED}`],
    ["token= + \\x01 berulang", `token=${splice(splice(TOK, 5, SOH), 30, SOH)}`, `token=${REDACTED}`],
    ["json token + ESC", `{"token":"${splice(TOK, 42, ESC)}"}`, `{"token":"${REDACTED}"}`],
    ["path token + \\x01", `/boot/${MAC}/${splice(TOK, 10, SOH)}/status`, `/boot/${MAC}/${REDACTED}/status`],
    ["hash salt + \\x01", `pw ${splice(HASH, 5, SOH)} end`, `pw ${HASH_REDACTED} end`],
    ["hash rounds + ESC di isi hash", `pw ${splice(HASH_ROUNDS, 60, ESC)} end`, `pw ${HASH_REDACTED} end`],
    ["header private key + \\x01", `${splice(BEGIN, 20, SOH)}\n${KEY_LINES[0]}\n${END}`, REDACTED_KEY],
  ]
  it.each(cases)("cleanEventMessage: %s", (_n, input, want) => {
    expect(cleanEventMessage(input)).toBe(want)
    // Urutan lama (redaksi → sanitasi) memang bocor — bukti test ini menguji urutan. M6: kontrol
    // memakai deteksi pola mentah (`secretMarks`, tanpa salinan pencocokan); `redactSecrets` sendiri
    // kini membuang kontrol di salinan pencocokannya (SR-5-18) sehingga tidak lagi bocor.
    const patternOnly = (t: string) => secretMarks(t).replace(/[\uE000-\uE002]+/g, (m) => markPlaceholder(m[0]))
    expect(sanitizeMessage(patternOnly(input))).not.toBe(want)
    expect(redactSecrets(input)).not.toContain(TOK.slice(25, 33))
  })
  it.each(cases)("appendEvent menyimpan pesan teredaksi: %s", (_n, input, want) => {
    getDb()
      .prepare(
        `INSERT INTO hosts (id, mac, status, status_since, first_seen, last_seen) VALUES (?, ?, 'booting', ?, ?, ?)`,
      )
      .run(ID, MAC, at(0).toISOString(), at(0).toISOString(), at(0).toISOString())
    getDb()
      .prepare(
        `INSERT INTO jobs (id, host_id, os_image_id, status, stages, created_at, updated_at) VALUES ('j', ?, 'ubuntu-24.04', 'booting', '[]', ?, ?)`,
      )
      .run(ID, at(0).toISOString(), at(0).toISOString())
    expect(appendEvent("j", { at: at(1).toISOString(), kind: "installer", level: "info", source: "installer", message: input }, 100)).toEqual({ status: "appended", seq: 1 })
    expect(eventsAfter("j", 0)[0].message).toBe(want)
    expect(eventsAfter("j", 0)[0].message).not.toMatch(/[A-Za-z0-9_-]{20,}/)
  })
  it("cleanEventMessage: redaksi lalu potong (token di sekitar batas 2048 tidak tersisa)", () => {
    const msg = `${"x".repeat(2045)}token=${splice(TOK, 3, ESC)}`
    const out = cleanEventMessage(msg)
    expect(out).not.toContain(TOK.slice(0, 8))
    expect(out.endsWith("…[dipotong]")).toBe(true)
  })
  it("stripControl: keepNewlines mempertahankan \\n/\\r/\\t, membuang kontrol lain", () => {
    expect(stripControl("a\x01b\nc\r\n\td\x1be f", true)).toBe("ab\nc\r\n\tdef")
    expect(stripControl("a\x01b\nc\r\n\td\x1be f")).toBe("abc\tdef")
  })
})

// ---------------------------------------------------------------------------
describe("SR-5-2 private key multi-baris", () => {
  const block = (footer: boolean) => [BEGIN, ...KEY_LINES, ...(footer ? [END] : [])].join("\n")
  const assertNoKey = (s: string) => {
    for (const l of KEY_LINES) expect(s).not.toContain(l)
    expect(s).not.toContain("PRIVATE KEY-----")
  }

  it.each([
    ["dengan footer", true],
    ["tanpa footer (terpotong)", false],
  ])("redactSecrets atas body utuh: %s", (_n, footer) => {
    const body = `sebelum\n${block(footer)}\n${footer ? "sesudah\n" : ""}`
    const out = redactSecrets(body)
    assertNoKey(out)
    expect(out.startsWith("sebelum\n")).toBe(true)
    if (footer) expect(out).toBe(`sebelum\n${REDACTED_KEY}\nsesudah\n`)
    expect(redactSecrets(out)).toBe(out)
  })

  it("footer END yatim (BEGIN di request sebelumnya): baris base64 sebelum footer ikut tersamarkan", () => {
    const body = `installer: langkah 3\n${KEY_LINES.slice(2).join("\n")}\n${END}\nsesudah`
    const out = redactSecrets(body)
    assertNoKey(out)
    expect(out).toBe(`installer: langkah 3\n${REDACTED_KEY}\nsesudah`)
    expect(redactSecrets(out)).toBe(out)
    // Footer di baris pertama teks / teks diawali baris kosong.
    expect(redactSecrets(`\n${KEY_LINES[0]}\n${END}`)).toBe(REDACTED_KEY)
    expect(redactSecrets(END)).toBe(REDACTED_KEY)
  })

  it.each([
    ["dengan footer", true],
    ["tanpa footer", false],
  ])("POST log (handleLogPost): blok %s → tak satu pun baris key tersimpan", async (_n, footer) => {
    await ready()
    const token = TOKEN_RE.exec(boot(1).script)![1]
    const body = `satu\n${block(footer).replace("BEGIN OPENSSH", `BEGIN ${SOH}OPENSSH`)}\n${footer ? "dua\n" : ""}`
    const r = handleLogPost({ mac: MAC, token, text: body, ip: IP, now: at(2) })
    expect(r).toMatchObject({ ok: true, status: 200 })
    const jobId = getActiveJob(ID)!.id
    const msgs = eventsAfter(jobId, 0, 1000).filter((e) => e.kind === "installer").map((e) => e.message)
    expect(msgs).toEqual(footer ? ["satu", REDACTED_KEY, "dua"] : ["satu", REDACTED_KEY])
    for (const m of allMessages()) assertNoKey(m)
  })

  it("POST log: blok terpecah dua request → ekor request kedua (base64 + END) tersamarkan", async () => {
    await ready()
    const token = TOKEN_RE.exec(boot(1).script)![1]
    expect(handleLogPost({ mac: MAC, token, text: `${BEGIN}\n${KEY_LINES.slice(0, 3).join("\n")}\n`, ip: IP, now: at(2) })).toMatchObject({ status: 200 })
    expect(handleLogPost({ mac: MAC, token, text: `${KEY_LINES.slice(3).join("\n")}\n${END}\nselesai\n`, ip: IP, now: at(3) })).toMatchObject({ status: 200 })
    const msgs = eventsAfter(getActiveJob(ID)!.id, 0, 1000).filter((e) => e.kind === "installer").map((e) => e.message)
    expect(msgs).toEqual([REDACTED_KEY, REDACTED_KEY, "selesai"])
    for (const m of allMessages()) assertNoKey(m)
  })

  it("POST log: batas 200 baris tetap dihitung dari body mentah (blok key tidak meloloskan > 200 baris)", async () => {
    await ready()
    const token = TOKEN_RE.exec(boot(1).script)![1]
    const body = `${BEGIN}\n${Array.from({ length: 205 }, () => KEY_LINES[0]).join("\n")}\n${END}\n`
    expect(handleLogPost({ mac: MAC, token, text: body, ip: IP, now: at(2) })).toMatchObject({ ok: false, status: 413 })
  })
})

// ---------------------------------------------------------------------------
describe("CR-5-1 + SR-5-5(a) token parsial, percent-encoded, hash terpotong", () => {
  const cut240 = (line: string) => line.slice(0, 240) // setara `cut -c1-240` untuk ASCII
  const urlLine = (pad: number) =>
    `${"p".repeat(pad)} GET http://10.99.0.2/boot/${MAC}/${TOK}/user-data HTTP/1.1 200`

  it("token terpotong `cut -c1-240` di setiap posisi 8..43 → tanpa prefiks token ≥ 8 karakter", () => {
    const prefixLen = ` GET http://10.99.0.2/boot/${MAC}/`.length
    let checked = 0
    for (let keep = 8; keep <= 43; keep++) {
      const pad = 240 - prefixLen - keep
      const line = cut240(urlLine(pad))
      expect(line.endsWith(TOK.slice(0, keep))).toBe(true)
      const out = redactSecrets(line)
      expect(out).toBe(`${"p".repeat(pad)} GET http://10.99.0.2/boot/${MAC}/${REDACTED}`)
      expect(out).not.toContain(TOK.slice(0, 8))
      expect(redactSecrets(out)).toBe(out)
      checked++
    }
    expect(checked).toBe(36)
  })

  it("token terpotong di tengah baris (bukan akhir) dan MAC dalam berbagai bentuk", () => {
    for (const mac of [MAC, "52-54-00-99-00-11", ID, "52%3A54%3A00%3A99%3A00%3A11"]) {
      expect(redactSecrets(`/boot/${mac}/${TOK.slice(0, 12)} lanjut`)).toBe(`/boot/${mac}/${REDACTED} lanjut`)
      expect(redactSecrets(`/boot/${mac}/${TOK.slice(0, 30)}/status`)).toBe(`/boot/${mac}/${REDACTED}/status`)
    }
  })

  it.each([
    ["%2F huruf besar", `GET%20http%3A%2F%2F10.99.0.2%2Fboot%2F52%3A54%3A00%3A99%3A00%3A11%2F${TOK}%2Fuser-data`, `GET%20http%3A%2F%2F10.99.0.2%2Fboot%2F52%3A54%3A00%3A99%3A00%3A11%2F${REDACTED}%2Fuser-data`],
    ["%2f huruf kecil", `u=%2fboot%2f52%3a54%3a00%3a99%3a00%3a11%2f${TOK}%2fstatus`, `u=%2fboot%2f52%3a54%3a00%3a99%3a00%3a11%2f${REDACTED}%2fstatus`],
    ["MAC ':' mentah", `x%2Fboot%2F${MAC}%2F${TOK}`, `x%2Fboot%2F${MAC}%2F${REDACTED}`],
    ["terpotong 10 karakter", `x%2Fboot%2F525400990011%2F${TOK.slice(0, 10)}`, `x%2Fboot%2F525400990011%2F${REDACTED}`],
  ])("percent-encoded: %s", (_n, input, want) => {
    expect(redactSecrets(input)).toBe(want)
    expect(redactSecrets(want)).toBe(want)
  })

  it("hash `$6$` terpotong di setiap panjang → `$6$[REDACTED]`", () => {
    for (let n = 4; n <= HASH.length; n++) {
      const line = cut240(`${"h".repeat(239 - n)} ${HASH}`)
      expect(line.endsWith(` ${HASH.slice(0, n)}`)).toBe(true)
      expect(redactSecrets(line)).toBe(`${"h".repeat(239 - n)} ${HASH_REDACTED}`)
    }
    for (let n = 4; n <= HASH_ROUNDS.length; n++) {
      const out = redactSecrets(`pw ${HASH_ROUNDS.slice(0, n)}`)
      expect(out).not.toContain("saltsalt")
      expect(out).not.toContain("QQ")
      expect(out.startsWith(`pw ${HASH_REDACTED}`)).toBe(true)
    }
  })

  it("negatif: segmen 44 karakter, segmen < 8, `token=` pendek, `$6$` tanpa salt tetap identik", () => {
    for (const t of [
      `/boot/${MAC}/${TOK}x/status`,
      `/boot/${MAC}/abc/status`,
      `%2Fboot%2F${MAC}%2F${TOK}x`,
      "token=pendek7", // M6 (CR-5-21): `token=<8..43>` kini disamarkan; batas negatif = 7 karakter
      "$6$ tanpa hash lengkap",
      "/boot/52:54:00:99:00:11.ipxe?platform=efi",
    ]) {
      expect(redactSecrets(t)).toBe(t)
    }
  })

  it("base64 berisi token terpotong / percent-encoded → [REDACTED-B64]", () => {
    for (const inner of [`curl http://10.99.0.2/boot/${MAC}/${TOK.slice(0, 20)}`, `u=%2Fboot%2F${ID}%2F${TOK}`]) {
      const blob = Buffer.from(inner).toString("base64")
      const out = redactSecrets(`echo ${blob}`)
      expect(out).not.toContain(blob)
    }
  })

  it("POST log: baris ber-token terpotong 240 karakter → DB tanpa prefiks token", async () => {
    await ready()
    const token = TOKEN_RE.exec(boot(1).script)![1]
    const prefixLen = ` GET http://10.99.0.2/boot/${MAC}/`.length
    const lines = [9, 20, 42].map((keep) =>
      cut240(`${"p".repeat(240 - prefixLen - keep)} GET http://10.99.0.2/boot/${MAC}/${token}/user-data`),
    )
    lines.push(`ERROR ${HASH.slice(0, 15)}`)
    expect(handleLogPost({ mac: MAC, token, text: lines.join("\n"), ip: IP, now: at(2) })).toMatchObject({ status: 200, accepted: 4 })
    for (const m of allMessages()) {
      expect(m).not.toContain(token.slice(0, 9))
      expect(m).not.toContain("saltsalt".slice(0, 4) + "salt")
    }
  })
})

// ---------------------------------------------------------------------------
describe("CR-5-2 / DEC-016 §1 timeout Booting absolut", () => {
  it("≥ 2 penyajian installer tidak mereset timer: batas dihitung dari entri booting pertama", async () => {
    await ready() // job dibuat at(0): entri booting pertama
    expect(boot(5 * 60).kind).toBe("installer") // penyajian ke-1 (+5 mnt)
    expect(boot(40 * 60).kind).toBe("installer") // penyajian ke-2 (+40 mnt)
    const job = getActiveJob(ID)!
    expect(job.installerBoots).toBe(2)
    const booting = job.stages.filter((s) => s.stage === "booting")
    expect(booting).toHaveLength(3)
    expect(booting.map((s) => s.source)).toEqual(["install", "boot-script", "boot-script"])
    expect(stageEnteredAt(job)).toBe(T0)
    // Batas booting default 60 mnt dari at(0); dengan semantik lama (entri terakhir) baru gagal di +100 mnt.
    expect(sweepJobs(new Date(T0 + 60 * MIN - 1000))).toEqual([])
    expect(getJob(job.id)!.status).toBe("booting")
    expect(sweepJobs(new Date(T0 + 60 * MIN + 1000))).toEqual([job.id])
    const f = getJob(job.id)!
    expect(f).toMatchObject({ status: "failed", failureReason: "timeout-booting", tokenHash: null })
    expect(eventsAfter(job.id, 0).at(-1)).toMatchObject({ level: "error", source: "watchdog", message: timeoutMessage("booting", 60) })
    // Penyajian ulang tetap tercatat sebagai event.
    expect(eventsAfter(job.id, 0).filter((e) => /^Script installer dilayani \(ke-[12]\//.test(e.message))).toHaveLength(2)
  })

  it("penyajian ke-1 sama dengan saat install: penyajian ke-2 dan ke-3 di +30/+59 mnt tetap gagal di +60 mnt", async () => {
    await ready()
    expect(boot(0).kind).toBe("installer")
    expect(boot(30 * 60).kind).toBe("installer")
    expect(boot(59 * 60).kind).toBe("installer")
    const job = getActiveJob(ID)!
    expect(job.installerBoots).toBe(3)
    expect(sweepJobs(new Date(T0 + 60 * MIN))).toEqual([])
    expect(sweepJobs(new Date(T0 + 60 * MIN + 1))).toEqual([job.id])
    expect(getJob(job.id)!.failureReason).toBe("timeout-booting")
  })

  it("Installing tidak berubah: dihitung dari entri installing (bukan dari booting pertama)", async () => {
    await ready()
    const token = TOKEN_RE.exec(boot(50 * 60).script)![1]
    expect(serveConfigFile({ mac: MAC, token, file: "user-data", ip: IP, now: at(55 * 60) }).ok).toBe(true)
    const job = getActiveJob(ID)!
    expect(job.status).toBe("installing")
    expect(stageEnteredAt(job)).toBe(T0 + 55 * MIN)
    expect(sweepJobs(new Date(T0 + 55 * MIN + 120 * MIN - 1000))).toEqual([])
    expect(sweepJobs(new Date(T0 + 55 * MIN + 120 * MIN + 1000))).toEqual([job.id])
    expect(getJob(job.id)!.failureReason).toBe("timeout-installing")
  })

  it("stageEnteredAt: tanpa entri untuk status → createdAt", () => {
    const job = { status: "booting", stages: [], createdAt: at(7).toISOString() } as unknown as Parameters<typeof stageEnteredAt>[0]
    expect(stageEnteredAt(job)).toBe(T0 + 7000)
  })
})
