// M5 iterasi 3 (backend-dev): perbaikan temuan gate iter2 pada redaksi log job.
//   CR-5-18  sekuens ANSI utuh (CSI/OSC) di tengah token/path/hash tidak lagi memecah pola secret;
//            AC-5.13 (`dua[31m merah\tkolom`) tetap
//   SR-5-12  `\r` dinormalisasi sebelum redaksi body log; karakter format Unicode (Cf) dibuang
//   SR-5-11  pola baris isi key linear (16 KB < 20 ms)
//   CR-5-19  baris kosong / kata tunggal di atas footer END yatim tidak tertelan
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { applyConfig } from "@/lib/server/config-service"
import { getDb } from "@/lib/server/db"
import {
  cleanAndRedact,
  cleanEventMessage,
  eventsAfter,
  stripAnsi,
  stripControl,
} from "@/lib/server/db/repos/job-events"
import { getActiveJob } from "@/lib/server/db/repos/jobs"
import { decideBoot } from "@/lib/server/discovery"
import { installHosts } from "@/lib/server/install-service"
import { clearLeaseCache } from "@/lib/server/leases"
import { handleLogPost } from "@/lib/server/provisioning"
import { HASH_REDACTED, REDACTED, REDACTED_KEY, redactSecrets } from "@/lib/server/redact"
import { stopWatchdog } from "@/lib/server/watchdog"
import { makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD } from "@/test/fixtures"

const MEDIA = makeMediaRoot(tmpDir("m5i3-media"))
withDb("empty", {
  PXE_MGMT_CIDR: "10.99.0.0/24",
  PXE_MGMT_GATEWAY: "10.99.0.1",
  PXE_MGMT_DNS: "10.99.0.2",
  PXE_SERVER_IP: "10.99.0.2",
  PXE_DHCP_RANGE: "10.99.0.100-10.99.0.200",
  PXE_MEDIA_ROOT: MEDIA,
  PXE_INSECURE_NO_LEASE_CHECK: "1",
})

const MAC = "52:54:00:99:00:12"
const ID = "525400990012"
const IP = "10.99.0.151"
const T0 = Date.parse("2026-11-06T10:00:00.000Z")
const at = (sec: number) => new Date(T0 + sec * 1000)
const TOKEN_RE = /\/boot\/[0-9a-f:]{17}\/([A-Za-z0-9_-]{43})\//
const TOK = "abcDEF0123456789_-abcDEF0123456789_-abcDEFG" // 43
const HASH = `$6$saltsalt$${"Q".repeat(86)}`
const ESC = "\x1b"
const BEL = "\x07"
const KEY_LINES = Array.from({ length: 6 }, (_, i) =>
  Buffer.from(`fixture-key-line-${i}-`.padEnd(48, String.fromCharCode(97 + i))).toString("base64"),
)
const BEGIN = "-----BEGIN OPENSSH PRIVATE KEY-----"
const END = "-----END OPENSSH PRIVATE KEY-----"
const splice = (s: string, i: number, c: string) => s.slice(0, i) + c + s.slice(i)

if (TOK.length !== 43) throw new Error("TOK 43")

beforeEach(() => clearLeaseCache())
afterEach(() => stopWatchdog())

async function ready(): Promise<string> {
  decideBoot({ mac: MAC, platform: "efi", ip: IP, wait: 0, now: at(0) })
  const r = await applyConfig([ID], {
    os: { osImageId: "ubuntu-24.04", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
    credentials: { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: true },
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  expect(installHosts([ID], at(0)).started).toEqual([ID])
  return TOKEN_RE.exec(decideBoot({ mac: MAC, platform: "efi", ip: IP, wait: 0, now: at(1) }).script)![1]
}
const installerMessages = () =>
  eventsAfter(getActiveJob(ID)!.id, 0, 1000)
    .filter((e) => e.kind === "installer")
    .map((e) => e.message)
const allMessages = () =>
  (getDb().prepare("SELECT message FROM job_events").all() as { message: string }[]).map((r) => r.message)
const post = (token: string, text: string, sec = 2) =>
  handleLogPost({ mac: MAC, token, text, ip: IP, now: at(sec) })
/** Tidak ada potongan TOK ≥ 8 karakter yang tersisa. */
const assertNoTokPiece = (s: string, tok = TOK) => {
  for (let i = 0; i + 8 <= tok.length; i++) expect(s).not.toContain(tok.slice(i, i + 8))
}

// ---------------------------------------------------------------------------
describe("CR-5-18 sekuens ANSI di tengah secret", () => {
  const seqs: [string, string][] = [
    ["ESC[0m", `${ESC}[0m`],
    ["ESC[31;1m", `${ESC}[31;1m`],
    ["ESC[1m", `${ESC}[1m`],
    ["OSC ESC]0;judul BEL", `${ESC}]0;judul${BEL}`],
    ["OSC ESC]8;;x ESC\\", `${ESC}]8;;x${ESC}\\`],
    ["CSI 8-bit \\x9b2K", "\x9b2K"],
    ["ESC(B", `${ESC}(B`],
  ]
  const cases = seqs.flatMap(([n, q]): [string, string, string][] => [
    [`token= + ${n}`, `token=${splice(TOK, 20, q)}`, `token=${REDACTED}`],
    [`path /boot/<mac>/<token> + ${n}`, `GET /boot/${MAC}/${splice(TOK, 20, q)}/status`, `GET /boot/${MAC}/${REDACTED}/status`],
    [`hash $6$ + ${n}`, `pw $6$saltsalt$${"Q".repeat(18)}${q}${"Q".repeat(68)} end`, `pw ${HASH_REDACTED} end`],
  ])

  it.each(cases)("cleanEventMessage: %s", (_n, input, want) => {
    const out = cleanEventMessage(input)
    expect(out).toBe(want)
    assertNoTokPiece(out)
    expect(out).not.toMatch(/Q{8}/)
    // Kontrol: tanpa pembuangan sekuens ANSI (urutan iterasi 2) secret memang bocor. Pengecualian:
    // `\x9b2K` di dalam hash — `\x9b` (C1) sudah dibuang di iterasi 2 dan sisa `2K` menyatu dengan
    // isi hash sehingga `HASH_PARTIAL_RE` sudah menangkapnya.
    if (!(input.includes("\x9b") && input.includes("$6$"))) expect(redactSecrets(stripControl(input))).not.toBe(want)
  })

  it.each(cases)("handleLogPost → DB: %s", async (_n, input, want) => {
    const token = await ready()
    expect(post(token, `awal\n${input}\nakhir\n`)).toMatchObject({ ok: true, status: 200, accepted: 3 })
    expect(installerMessages()).toEqual(["awal", want, "akhir"])
    for (const m of allMessages()) {
      assertNoTokPiece(m)
      expect(m).not.toMatch(/Q{8}/)
    }
  })

  it("secret di baris lain: seluruh body memakai salinan bersih teredaksi", async () => {
    const token = await ready()
    const body = `warna ${ESC}[32mOK${ESC}[0m\ntoken=${splice(TOK, 10, `${ESC}[0m`)}\n`
    expect(post(token, body)).toMatchObject({ ok: true, accepted: 2 })
    expect(installerMessages()).toEqual(["warna OK", `token=${REDACTED}`])
  })

  it("AC-5.13 tetap: tanpa secret, sisa sekuens (`[31m`) dipertahankan seperti sebelumnya", async () => {
    expect(cleanEventMessage(`dua${BEL}${ESC}[31m merah\tkolom`)).toBe("dua[31m merah\tkolom")
    expect(cleanAndRedact(`a${ESC}[0m\nb`, true)).toBe("a[0m\nb")
    const token = await ready()
    expect(post(token, `dua${BEL}${ESC}[31m merah\tkolom\n`)).toMatchObject({ ok: true, accepted: 1 })
    expect(installerMessages()).toEqual(["dua[31m merah\tkolom"])
  })

  it("stripAnsi: membuang sekuens utuh, OSC tanpa terminator tidak menelan baris berikutnya", () => {
    expect(stripAnsi(`a${ESC}[0mb${ESC}[31;1mc${ESC}]0;t${BEL}d${ESC}]8;;u${ESC}\\e\x9b2Kf${ESC}(Bg`)).toBe("abcdefg")
    // OSC tanpa terminator: bukan sekuens utuh; baris berikutnya utuh. M6 (CR-5-30): `ESC]` tanpa
    // byte intermediate tidak lagi dibuang `stripAnsi` (sebelumnya alternatif ke-4 menelan `]`);
    // hanya byte ESC-nya yang dibuang `stripControl`.
    expect(stripAnsi(`a${ESC}]0;tanpa-akhir\nbaris2`)).toBe(`a${ESC}]0;tanpa-akhir\nbaris2`)
    expect(stripControl(stripAnsi(`a${ESC}]0;tanpa-akhir\nbaris2`), true)).toBe("a]0;tanpa-akhir\nbaris2")
    expect(stripAnsi("teks biasa [31m")).toBe("teks biasa [31m")
  })

  it("idempoten dan teks tanpa secret identik", () => {
    for (const [, input] of cases) {
      const once = cleanEventMessage(input)
      expect(cleanEventMessage(once)).toBe(once)
    }
    expect(cleanEventMessage("Memasang paket: 42%")).toBe("Memasang paket: 42%")
  })
})

// ---------------------------------------------------------------------------
describe("SR-5-12 `\\r` dan karakter format Unicode (Cf)", () => {
  it("(a) header key dipecah `\\r`, tanpa footer → tak satu pun baris isi key tersimpan", async () => {
    const token = await ready()
    const body = `satu\n-----BEGIN OPENSSH PRIV\rATE KEY-----\n${KEY_LINES.join("\n")}\n`
    expect(post(token, body)).toMatchObject({ ok: true, status: 200 })
    expect(installerMessages()).toEqual(["satu", REDACTED_KEY])
    for (const m of allMessages()) {
      for (const l of KEY_LINES) expect(m).not.toContain(l)
      expect(m).not.toContain("PRIVATE KEY-----")
      expect(m).not.toContain("ATE KEY-----")
    }
  })

  it("(a) varian CRLF + header `\\r` dengan footer", async () => {
    const token = await ready()
    const body = ["satu", `-----BEGIN OPENSSH PRIV\rATE KEY-----`, ...KEY_LINES, END, "dua"].join("\r\n")
    expect(post(token, body)).toMatchObject({ ok: true })
    expect(installerMessages()).toEqual(["satu", REDACTED_KEY, "dua"])
  })

  it("(b) token path dipecah `\\r` → tidak ada potongan token tersimpan", async () => {
    const token = await ready()
    const body = `GET /boot/${MAC}/${splice(TOK, 20, "\r")}/status\ntoken=${splice(TOK, 5, "\r")}\n`
    expect(post(token, body)).toMatchObject({ ok: true, accepted: 2 })
    expect(installerMessages()).toEqual([`GET /boot/${MAC}/${REDACTED}/status`, `token=${REDACTED}`])
    for (const m of allMessages()) assertNoTokPiece(m)
  })

  const CF = [0x00ad, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff]
  it.each(CF.map((c) => [`U+${c.toString(16).toUpperCase().padStart(4, "0")}`, String.fromCharCode(c)]))(
    "(c) %s di dalam token (posisi < 8) → teredaksi",
    (_n, ch) => {
      expect(cleanEventMessage(`/boot/${MAC}/${splice(TOK, 3, ch)}/status`)).toBe(`/boot/${MAC}/${REDACTED}/status`)
      expect(cleanEventMessage(`token=${splice(TOK, 7, ch)}`)).toBe(`token=${REDACTED}`)
      expect(cleanEventMessage(`pw ${splice(HASH, 4, ch)} end`)).toBe(`pw ${HASH_REDACTED} end`)
      expect(stripControl(`a${ch}b`)).toBe("ab")
      expect(stripControl(`a${ch}b\nc`, true)).toBe("ab\nc")
    },
  )

  it("(c) U+200B di posisi 3 token lewat handleLogPost → token tidak tersimpan utuh", async () => {
    const token = await ready()
    expect(post(token, `GET /boot/${MAC}/${splice(TOK, 3, "​")}/status\n`)).toMatchObject({ ok: true, accepted: 1 })
    expect(installerMessages()).toEqual([`GET /boot/${MAC}/${REDACTED}/status`])
    for (const m of allMessages()) assertNoTokPiece(m)
  })

  it("karakter non-Cf (huruf beraksen, emoji tanpa ZWJ) tidak dibuang", () => {
    expect(stripControl("café ✓")).toBe("café ✓")
  })
})

// ---------------------------------------------------------------------------
describe("SR-5-11 baris isi key linear", () => {
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
    ["spasi + ! + footer", `${" ".repeat(16384)}!\n${END}`, `${" ".repeat(16384)}!\n${REDACTED_KEY}`],
    ["spasi + ! + spasi + footer", `${" ".repeat(8192)}!${" ".repeat(8192)}\n${END}`, `${" ".repeat(8192)}!${" ".repeat(8192)}\n${REDACTED_KEY}`],
    ["tab + footer di baris sama", `${"\t".repeat(16384)}!${END}`, REDACTED_KEY],
  ])("16 KB %s: diredaksi < 20 ms (terbaik dari 5)", (_n, input, want) => {
    expect(redactSecrets(input)).toBe(want)
    expect(bestOf(5, () => redactSecrets(input))).toBeLessThan(20)
    expect(bestOf(5, () => cleanEventMessage(input))).toBeLessThan(20)
  })
  it("16 KB lewat handleLogPost < 50 ms (termasuk transaksi DB; terbaik dari 5, CR-5-25)", async () => {
    const token = await ready()
    let runs = 0
    const best = bestOf(5, () => {
      expect(post(token, `${" ".repeat(16384)}!\n${END}\n`, 2 + runs++)).toMatchObject({ ok: true })
    })
    expect(runs).toBe(5)
    expect(best).toBeLessThan(50)
    expect(installerMessages().at(-1)).toBe(REDACTED_KEY)
  })
})

// ---------------------------------------------------------------------------
describe("CR-5-19 footer END yatim tidak menelan baris diagnostik", () => {
  it("probe review: `Langkah\\nSelesai\\n\\n<b64>\\n<b64>\\nEND\\nafter` → Langkah/Selesai/kosong utuh", () => {
    const body = `Langkah\nSelesai\n\n${KEY_LINES[0]}\n${KEY_LINES[1]}\n${END}\nafter`
    expect(redactSecrets(body)).toBe(`Langkah\nSelesai\n\n${REDACTED_KEY}\nafter`)
  })
  it.each(["Done", "OK", "DONE", "Selesai", "done", "Traceback", "  OK  ", ""])("kata tunggal %j tepat di atas footer tidak tertelan", (w) => {
    expect(redactSecrets(`awal\n${w}\n${END}\nakhir`)).toBe(`awal\n${w}\n${REDACTED_KEY}\nakhir`)
    expect(redactSecrets(`awal\n${w}\n${KEY_LINES[0]}\n${END}`)).toBe(`awal\n${w}\n${REDACTED_KEY}`)
  })
  it("ekor key asli tetap teredaksi: baris 64/70 karakter, baris kosong di antaranya, baris akhir pendek", () => {
    for (const last of ["AQIDBAU=", "AAAAAAECAwQF7g==", "c2hAaG9zdAECAwQF", "AQID1g==", "Zm9v/w==", "AAAAAAECAwQFBg"]) {
      const body = `Selesai\n${KEY_LINES.join("\n")}\n\n${KEY_LINES[0]}\n${last}\n${END}\nlanjut`
      const out = redactSecrets(body)
      expect(out).toBe(`Selesai\n${REDACTED_KEY}\nlanjut`)
    }
    // Baris berawalan/berakhiran spasi tetap dianggap isi key.
    expect(redactSecrets(`x y\n  ${KEY_LINES[0]}\t\n${END}`)).toBe(`x y\n${REDACTED_KEY}`)
    // Kasus lama (iterasi 2) tetap: baris kosong di awal teks ikut tersamarkan.
    expect(redactSecrets(`\n${KEY_LINES[0]}\n${END}`)).toBe(REDACTED_KEY)
  })
  it("baris pendek non-adjacent (di atas baris key) tidak tertelan walau berbentuk base64", () => {
    expect(redactSecrets(`ABCD1234\n${KEY_LINES[0]}\n${END}`)).toBe(`ABCD1234\n${REDACTED_KEY}`)
  })
  it("handleLogPost: diagnostik di atas ekor key (request kedua) tersimpan", async () => {
    const token = await ready()
    expect(post(token, `${BEGIN}\n${KEY_LINES.slice(0, 3).join("\n")}\n`)).toMatchObject({ ok: true })
    expect(post(token, `Langkah\nSelesai\n\n${KEY_LINES.slice(3).join("\n")}\n${END}\nOK\n`, 3)).toMatchObject({ ok: true })
    expect(installerMessages()).toEqual([REDACTED_KEY, "Langkah", "Selesai", REDACTED_KEY, "OK"])
    for (const m of allMessages()) for (const l of KEY_LINES) expect(m).not.toContain(l)
  })
})

// ---------------------------------------------------------------------------
// Iterasi 3 lanjutan (SR-5-16/CR-5-24): `stripAnsi` bisa menelan karakter awal secret
// (`ESC-----B`, `ESC$6`, `ESC/b`, `ESC[t`, `token=<20>ESC<23>`). Bila body juga memuat secret lain
// yang hanya terlihat di salinan bersih-ANSI, secret yang terpotong itu dulu ikut tersimpan.
// Kini deteksi dari salinan mentah (kontrol dibuang) dan salinan bersih-ANSI digabung per karakter.
describe("SR-5-16 / CR-5-24 secret terpotong `stripAnsi` + secret kedua di body yang sama", () => {
  const KEY_BEGIN_ESC = `${ESC}${BEGIN}`
  const HASH_SPLIT = `$6$s$QQQQQ${ESC}[0m${"Q".repeat(80)}`
  const cases: [string, string, string][] = [
    ["(2) ESC/boot path + hash", `GET ${ESC}/boot/${MAC}/${TOK} ${HASH}`, `GET oot/${MAC}/${REDACTED} ${HASH_REDACTED}`],
    ["(2) \\x9b/boot path + hash", `GET \x9b/boot/${MAC}/${TOK} ${HASH}`, `GET oot/${MAC}/${REDACTED} ${HASH_REDACTED}`],
    ["(3) ESC[token= + hash", `${ESC}[token=${TOK} ${HASH}`, `oken=${REDACTED} ${HASH_REDACTED}`],
    ["(4) token= + ESC$6$", `token=${TOK} pw=${ESC}${HASH}`, `token=${REDACTED} pw=$${REDACTED}`],
    ["CR-5-24 token=<20>ESC<23> + hash dipecah ANSI", `token=${splice(TOK, 20, ESC)} ${HASH_SPLIT}`, `token=${REDACTED} ${HASH_REDACTED}`],
    [
      "CR-5-24 path dipecah ANSI + token=ESC<43>",
      `GET /boot/${MAC}/${splice(TOK, 20, `${ESC}[0m`)} token=${ESC}${TOK}`,
      `GET /boot/${MAC}/${REDACTED} token=${REDACTED}`,
    ],
  ]
  const noLeak = (m: string) => {
    assertNoTokPiece(m)
    expect(m).not.toMatch(/Q{8}/)
    expect(m).not.toContain("saltsalt")
    for (const l of KEY_LINES) expect(m).not.toContain(l)
  }

  it.each(cases)("cleanEventMessage: %s", (_n, input, want) => {
    const out = cleanEventMessage(input)
    expect(out).toBe(want)
    noLeak(out)
    expect(cleanEventMessage(out)).toBe(out)
  })

  it.each(cases)("handleLogPost → DB: %s", async (_n, input, want) => {
    const token = await ready()
    expect(post(token, `awal\n${input}\nakhir\n`)).toMatchObject({ ok: true, status: 200, accepted: 3 })
    expect(installerMessages()).toEqual(["awal", want, "akhir"])
    for (const m of allMessages()) noLeak(m)
  })

  it("(1) cleanAndRedact/cleanEventMessage: token= + ESC-----BEGIN tanpa footer → tak satu pun baris key", () => {
    const out = cleanAndRedact(`token=${TOK}\n${KEY_BEGIN_ESC}\n${KEY_LINES.join("\n")}\n`, true)
    expect(out).toBe(`token=${REDACTED}\n${REDACTED_KEY}`)
    noLeak(out)
    const one = cleanEventMessage(`token=${TOK} ${KEY_BEGIN_ESC} ${KEY_LINES[0]}`)
    expect(one).toBe(`token=${REDACTED} ${REDACTED_KEY}`)
    noLeak(one)
  })

  it("(1) handleLogPost: token= + ESC-----BEGIN tanpa footer → tak satu pun baris key tersimpan", async () => {
    const token = await ready()
    const body = `token=${TOK}\n${KEY_BEGIN_ESC}\n${KEY_LINES.join("\n")}\n`
    expect(post(token, body)).toMatchObject({ ok: true, status: 200, accepted: 2 })
    expect(installerMessages()).toEqual([`token=${REDACTED}`, REDACTED_KEY])
    for (const m of allMessages()) noLeak(m)
  })

  it("secret terpotong `stripAnsi` tanpa secret kedua tetap teredaksi (jalur salinan mentah)", () => {
    expect(cleanEventMessage(`GET ${ESC}/boot/${MAC}/${TOK}`)).toBe(`GET /boot/${MAC}/${REDACTED}`)
    expect(cleanEventMessage(`token=${splice(TOK, 20, ESC)}`)).toBe(`token=${REDACTED}`)
  })
})

// ---------------------------------------------------------------------------
// SR-5-17 / CR-5-23: baris akhir key yang pendek & berbentuk kata (ekor RSA `…AQID`) tepat di atas
// footer END yatim tidak lagi menghentikan pemindaian bila di atasnya ada baris isi key ≥ 16.
describe("SR-5-17 / CR-5-23 baris akhir key pendek berbentuk kata", () => {
  const LINE64 = KEY_LINES[0]
  const LINE70 = Buffer.from("fixture-key-line-seventy-".padEnd(52, "z")).toString("base64").slice(0, 70)
  if (LINE64.length !== 64 || LINE70.length !== 70) throw new Error("panjang fixture")
  const rows = ["AQID", "BAUG", "AQIDBAUG", "Abcdef", "AAAA", "QUJD", "Ab"].flatMap((last) =>
    [LINE64, LINE70].flatMap((line) =>
      ["", "\n", "\n\n"].map((blank): [string, number, string, string, string] => [last, line.length, JSON.stringify(blank), line, blank]),
    ),
  )
  it.each(rows)("%s di bawah baris key %i karakter, baris kosong %s → seluruh ekor teredaksi", (last, _len, _b, line, blank) => {
    const out = redactSecrets(`Langkah\nSelesai\n${line}\n${line}\n${last}\n${blank}${END}\nafter`)
    expect(out).toBe(`Langkah\nSelesai\n${REDACTED_KEY}\nafter`)
    expect(out).not.toContain(line)
  })

  it("baris kosong di antara baris key dan baris pendek: tetap teredaksi", () => {
    expect(redactSecrets(`x y\n${LINE64}\n\nAQID\n${END}`)).toBe(`x y\n${REDACTED_KEY}`)
  })

  it("CR-5-19 tetap: kata pendek di atas teks biasa / baris pendek tidak tertelan", () => {
    for (const w of ["Done", "OK", "Selesai", "AQID"]) {
      expect(redactSecrets(`awal\n${w}\n${END}\nakhir`)).toBe(`awal\n${w}\n${REDACTED_KEY}\nakhir`)
      expect(redactSecrets(`awal\n${w}\n\n${END}\nakhir`)).toBe(`awal\n${w}\n\n${REDACTED_KEY}\nakhir`)
      // Baris non-kosong di atasnya pendek (< 16) → bukan baris isi key → kata tetap utuh.
      expect(redactSecrets(`ABCD1234\n${w}\n${END}`)).toBe(`ABCD1234\n${w}\n${REDACTED_KEY}`)
    }
  })

  it("handleLogPost: ekor RSA `AQID` + baris kosong pada request kedua tidak meloloskan baris key", async () => {
    const token = await ready()
    expect(post(token, `${BEGIN}\n${KEY_LINES.slice(0, 3).join("\n")}\n`)).toMatchObject({ ok: true })
    expect(post(token, `Langkah\n${KEY_LINES.slice(3).join("\n")}\nAQID\n\n${END}\nOK\n`, 3)).toMatchObject({ ok: true })
    expect(installerMessages()).toEqual([REDACTED_KEY, "Langkah", REDACTED_KEY, "OK"])
    for (const m of allMessages()) for (const l of KEY_LINES) expect(m).not.toContain(l)
  })
})
