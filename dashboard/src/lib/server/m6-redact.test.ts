// M6-T4 (backend-dev): redaksi log job (plan §2.5, DEC-017 §10 / O14).
//   AC-6.14 CR-5-30 / SR-5-19   escape pemakan karakter + SGR di secret yang sama (salinan `sgr`),
//                                `token=` parsial, alternatif ke-4 ANSI_RE ber-intermediate
//   AC-6.15 SR-5-18/20/13, CR-5-21  karakter tak terlihat (DI, surrogate tunggal, Co, Mn) + normalisasi
//                                encoding (persen dua lapis, `\/`, `\$`, `$$`, `\u002F`); teks biasa identik;
//                                idempoten; performa linear (SR-5-11 ≤ 20/50 ms)
//   AC-6.16 CR-5-20 a/b/c, SR-5-14, SR-5-15  prefiks log di ekor key, rangkaian isi key tanpa
//                                BEGIN/END, > 64 footer yatim, tabel perilaku terdokumentasi, docstring
//   AC-6.17 (struktur) SR-5-5(c)  fixture log installer (sintetis sekarang; nyata dari KVM M6 → T14)
// Semua probe reviewer M5 (review-security-iter2/3, review-code-iter2/3) dijadikan fixture regresi.
import { readFileSync } from "node:fs"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { applyConfig } from "@/lib/server/config-service"
import { getDb } from "@/lib/server/db"
import { cleanAndRedact, cleanEventMessage, stripAnsi, stripControl } from "@/lib/server/db/repos/job-events"
import { getActiveJob } from "@/lib/server/db/repos/jobs"
import { eventsAfter } from "@/lib/server/db/repos/job-events"
import { decideBoot } from "@/lib/server/discovery"
import { installHosts } from "@/lib/server/install-service"
import { clearLeaseCache } from "@/lib/server/leases"
import { handleLogPost } from "@/lib/server/provisioning"
import {
  HASH_REDACTED,
  identityView,
  MARK_KEY,
  MARK_PLAIN,
  matchView,
  REDACTED,
  REDACTED_B64,
  REDACTED_KEY,
  redactSecrets,
  secretMarks,
} from "@/lib/server/redact"
import { stopWatchdog } from "@/lib/server/watchdog"
import { makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD } from "@/test/fixtures"
import { checkStored, chunkBodies, expandTemplate, FIXTURE_KEY_BODY, listFixtures, SYNTHETIC_DIR } from "@/test/installer-logs"

const MEDIA = makeMediaRoot(tmpDir("m6t4-media"))
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
const TOK = "abcDEF0123456789_-abcDEF0123456789_-abcDEFG" // 43, sintetis
const TOK2 = "ZyxWVU9876543210-_ZyxWVU9876543210-_ZyxWVUT" // 43, sintetis
const HASH = `$6$saltsalt$${"Q".repeat(86)}`
const HASH2 = `$6$pepper$${"R".repeat(86)}`
const ESC = "\x1b"
const KEY_LINES = Array.from({ length: 6 }, (_, i) =>
  Buffer.from(`fixture-key-line-${i}-`.padEnd(48, String.fromCharCode(97 + i))).toString("base64"),
)
const LINE70 = (i: number) => Buffer.from(`fixture-openssh-seventy-${i}-`.padEnd(53, String.fromCharCode(107 + i))).toString("base64").slice(0, 70)
const BEGIN = "-----BEGIN OPENSSH PRIVATE KEY-----"
const END = "-----END OPENSSH PRIVATE KEY-----"
const splice = (s: string, i: number, c: string) => s.slice(0, i) + c + s.slice(i)
const pct = (s: string) => s.replace(/[/:$=]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"))

if (TOK.length !== 43 || TOK2.length !== 43) throw new Error("TOK 43")
if (KEY_LINES[0].length !== 64 || LINE70(0).length !== 70) throw new Error("panjang fixture key")

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
  eventsAfter(getActiveJob(ID)!.id, 0, 5000)
    .filter((e) => e.kind === "installer")
    .map((e) => e.message)
const allMessages = () =>
  (getDb().prepare("SELECT message FROM job_events").all() as { message: string }[]).map((r) => r.message)
const post = (token: string, text: string, sec = 2) => handleLogPost({ mac: MAC, token, text, ip: IP, now: at(sec) })

/** Tidak ada potongan ≥ 8 karakter dari TOK/TOK2, badan hash, maupun baris isi key. */
function noLeak(s: string) {
  for (const t of [TOK, TOK2]) for (let i = 0; i + 8 <= t.length; i++) expect(s).not.toContain(t.slice(i, i + 8))
  expect(s).not.toMatch(/Q{8}|R{8}/)
  expect(s).not.toContain("saltsalt")
  for (const l of KEY_LINES) expect(s).not.toContain(l.slice(0, 16))
  for (let i = 0; i < 4; i++) expect(s).not.toContain(LINE70(i).slice(0, 16))
}

// ---------------------------------------------------------------------------
// AC-6.14
describe("AC-6.14 CR-5-30 / SR-5-19: escape pemakan karakter + SGR pada secret yang sama", () => {
  const SGR = `${ESC}[0m`
  const probes: [string, string][] = [
    ["(a) pw=ESC$6$salt ESC[0m salt$<86>", `pw=${ESC}$6$salt${SGR}salt$${"Q".repeat(86)}`],
    ["(b) ESC[token=<20> ESC[0m <23>", `${ESC}[token=${TOK.slice(0, 20)}${SGR}${TOK.slice(20)}`],
    ["(c) GET ESC/boot/<mac>/<5> ESC[0m <38>", `GET ${ESC}/boot/${MAC}/${TOK.slice(0, 5)}${SGR}${TOK.slice(5)}`],
    ["CR-5-30 token=<20> ESC[0m ESC <23>", `token=${TOK.slice(0, 20)}${SGR}${ESC}${TOK.slice(20)}`],
    ["(c') \\x9b/boot + SGR 8-bit", `GET \x9b/boot/${MAC}/${TOK.slice(0, 5)}\x9b0m${TOK.slice(5)}`],
    ["(b') ESC[token= + OSC 8", `${ESC}[token=${TOK.slice(0, 20)}${ESC}]8;;http://x${ESC}\\${TOK.slice(20)}`],
    ["(a') ESC$6 + SGR warna", `pw=${ESC}$6$salt${ESC}[31;1msalt$${"Q".repeat(86)}`],
    ["ESC-intermediate (ESC(B) + SGR", `token=${TOK.slice(0, 10)}${ESC}(B${TOK.slice(10, 30)}${SGR}${TOK.slice(30)}`],
    ["ESC7 (tanpa intermediate) di token", `token=${TOK.slice(0, 20)}${ESC}7${TOK.slice(20)}`],
  ]
  const seconds: [string, string][] = [
    ["sendiri", ""],
    ["+ hash kedua", ` ${HASH2}`],
    ["+ token path kedua", ` /boot/${MAC}/${TOK2}/x`],
  ]
  const cases = probes.flatMap(([n, p]) => seconds.map(([sn, s]): [string, string] => [`${n} ${sn}`, `${p}${s}`]))

  it.each(cases)("cleanEventMessage: %s → tanpa potongan secret, idempoten", (_n, input) => {
    const out = cleanEventMessage(input)
    noLeak(out)
    expect(out).toContain("[REDACTED")
    expect(cleanEventMessage(out)).toBe(out)
  })

  it.each(cases)("handleLogPost → DB: %s", async (_n, input) => {
    const token = await ready()
    expect(post(token, `awal\n${input}\nakhir\n`)).toMatchObject({ ok: true, status: 200, accepted: 3 })
    const msgs = installerMessages()
    expect(msgs[0]).toBe("awal")
    expect(msgs[2]).toBe("akhir")
    for (const m of allMessages()) noLeak(m)
  })

  it.each(seconds)("(d) ESC-----BEGIN OPENSSH ESC[0mPRIVATE KEY----- tanpa footer %s → tak satu pun baris isi key", async (_n, s) => {
    const body = `token=${TOK}${s}\n${ESC}-----BEGIN OPENSSH ${SGR}PRIVATE KEY-----\n${KEY_LINES.join("\n")}\n`
    const out = cleanAndRedact(body, true)
    noLeak(out)
    expect(out.split("\n").at(-1)).toBe(REDACTED_KEY)
    const token = await ready()
    expect(post(token, body)).toMatchObject({ ok: true, status: 200 })
    for (const m of allMessages()) noLeak(m)
    expect(installerMessages().at(-1)).toBe(REDACTED_KEY)
  })

  it("hasil persis kasus inti (render dari salinan sgr/bare)", () => {
    expect(cleanEventMessage(`token=${TOK.slice(0, 20)}${SGR}${ESC}${TOK.slice(20)}`)).toBe(`token=${REDACTED}`)
    expect(cleanEventMessage(`pw=${ESC}$6$salt${SGR}salt$${"Q".repeat(86)}`)).toBe(`pw=${HASH_REDACTED}`)
    expect(cleanEventMessage(`${ESC}[token=${TOK.slice(0, 20)}${SGR}${TOK.slice(20)}`)).toBe(`[token=${REDACTED}`)
    expect(cleanEventMessage(`GET ${ESC}/boot/${MAC}/${TOK.slice(0, 5)}${SGR}${TOK.slice(5)}/status`)).toBe(`GET /boot/${MAC}/${REDACTED}/status`)
  })

  it("alternatif ke-4 ANSI_RE wajib ber-intermediate: ESC+huruf/angka tidak menelan karakter", () => {
    expect(stripAnsi(`a${ESC}tb`)).toBe(`a${ESC}tb`)
    expect(stripAnsi(`a${ESC}7b${ESC}=c`)).toBe(`a${ESC}7b${ESC}=c`)
    expect(stripAnsi(`a${ESC}(Bb${ESC}#8c${ESC} Fd`)).toBe("abcd")
    expect(stripControl(stripAnsi(`x${ESC}token=1`))).toBe("xtoken=1")
  })

  it("`token=` parsial 8..43 tersamar; < 8 tetap", () => {
    for (let n = 8; n <= 43; n++) {
      expect(redactSecrets(`token=${TOK.slice(0, n)}`), String(n)).toBe(`token=${REDACTED}`)
      expect(redactSecrets(`"token": "${TOK.slice(43 - n)}"`), String(n)).toBe(`"token": "${REDACTED}"`)
    }
    for (let n = 1; n < 8; n++) expect(redactSecrets(`token=${TOK.slice(0, n)}`)).toBe(`token=${TOK.slice(0, n)}`)
    expect(redactSecrets("token=terlalu-pendek")).toBe(`token=${REDACTED}`)
  })

  it("AC-5.13 tidak berubah: tanpa secret, sisa SGR `[31m` dipertahankan", () => {
    expect(cleanEventMessage(`dua\x07${ESC}[31m merah\tkolom`)).toBe("dua[31m merah\tkolom")
    expect(cleanAndRedact(`a${ESC}[0m\nb`, true)).toBe("a[0m\nb")
  })
})

// ---------------------------------------------------------------------------
// AC-6.15
describe("AC-6.15 SR-5-18 / SR-5-20 / SR-5-13 / CR-5-21: karakter tak terlihat & normalisasi encoding", () => {
  const INVIS: [string, string][] = [
    ["U+034F CGJ", "\u034F"],
    ["U+FE0F VS16", "\uFE0F"],
    ["U+FE00 VS1", "\uFE00"],
    ["U+3164 Hangul filler", "\u3164"],
    ["U+115F", "\u115F"],
    ["U+200B ZWSP", "\u200B"],
    ["U+2064", "\u2064"],
    ["\\uD800 surrogate tunggal", "\uD800"],
    ["\\uDC00 surrogate tunggal", "\uDC00"],
    ["U+E001 PUA (= MARK_KEY)", "\uE001"],
    ["U+E000 PUA (= MARK_PLAIN)", "\uE000"],
    ["U+F8FF PUA", "\uF8FF"],
    ["U+0301 tanda gabung", "\u0301"],
    ["U+20DD Me", "\u20DD"],
    ["U+E0041 tag", "\u{E0041}"],
    ["U+FFFF0 PUA plane 15", "\u{FFFF0}"],
  ]
  const shapes = (ch: string): [string, string][] => [
    ["path pos 3", `GET /boot/${MAC}/${splice(TOK, 3, ch)}/status`],
    ["path pos 20", `GET /boot/${MAC}/${splice(TOK, 20, ch)}/status`],
    ["token= pos 7", `token=${splice(TOK, 7, ch)}`],
    ["hash pos 4", `pw ${splice(HASH, 4, ch)} end`],
    ["hash pos 40", `pw ${splice(HASH, 40, ch)} end`],
    ["hash di prefiks $6$", `pw $${ch}6$saltsalt$${"Q".repeat(86)} end`],
    ["dua karakter + ANSI", `token=${splice(splice(TOK, 30, `${ESC}[0m`), 5, ch + ch)}`],
  ]
  const cases = INVIS.flatMap(([n, ch]) => shapes(ch).map(([s, input]): [string, string] => [`${n} ${s}`, input]))

  it.each(cases)("%s → tersamar (cleanEventMessage + redactSecrets)", (_n, input) => {
    const out = cleanEventMessage(input)
    noLeak(out)
    expect(cleanEventMessage(out)).toBe(out)
    // `redactSecrets` murni pola (tanpa pembuangan ANSI — itu tugas `cleanAndRedact`).
    if (!input.includes(ESC)) noLeak(redactSecrets(input))
  })

  it.each(INVIS.slice(0, 6))("%s lewat handleLogPost → DB (path + hash + token= dalam satu body, CRLF)", async (_n, ch) => {
    const token = await ready()
    const body = [`GET /boot/${MAC}/${splice(TOK, 3, ch)}/status`, `pw ${splice(HASH, 9, ch)}`, `token=${splice(TOK2, 12, ch)}`, "selesai"].join("\r\n")
    expect(post(token, body)).toMatchObject({ ok: true, accepted: 4 })
    for (const m of allMessages()) noLeak(m)
    expect(installerMessages().at(-1)).toBe("selesai")
  })

  const ENC: [string, string][] = [
    ["JSON \\/boot\\/", `{"url":"http:\\/\\/10.99.0.2\\/boot\\/${MAC}\\/${TOK}\\/status"}`],
    ["JSON ganda \\\\\\/", `"url":"http:\\\\\\/\\\\\\/10.99.0.2\\\\\\/boot\\\\\\/${MAC}\\\\\\/${TOK}\\\\\\/status"`],
    ["JSON \\u002F", `u=\\u002Fboot\\u002F${MAC}\\u002F${TOK}\\u002Fstatus`],
    ["persen penuh %2F", `u=${pct(`/boot/${MAC}/`)}${TOK}${pct("/status")}`],
    ["persen ganda %252F", `u=${pct(`/boot/${MAC}/`).replaceAll("%", "%25")}${TOK}%252Fstatus`],
    ["persen campur /boot%2F", `GET /boot%2F${MAC}%2F${TOK}%2Fstatus`],
    ["persen huruf kecil %2f%3a", `GET %2fboot%2f52%3a54%3a00%3a99%3a00%3a12%2f${TOK}`],
    ["token%3D", `q?token%3D${TOK}&x=1`],
    ["token%253D (ganda)", `q?token%253D${TOK}&x=1`],
    ["\\\"token\\\":\\\"…\\\"", `echo "{\\"token\\":\\"${TOK}\\"}"`],
    ["\\$6\\$", `pw \\$6\\$saltsalt\\$${"Q".repeat(86)}`],
    ["$$6$$", `pw $$6$$saltsalt$$${"Q".repeat(86)}`],
    ["%246%24", `pw=%246%24saltsalt%24${"Q".repeat(86)}`],
    ["%25246%2524 (ganda)", `pw=%25246%2524saltsalt%2524${"Q".repeat(86)}`],
    ["persen + ANSI + ZW", `u=%2Fboot%2F${MAC}%2F${splice(splice(TOK, 25, `${ESC}[0m`), 4, "\u200B")}`],
    ["persen + surrogate", `u=%2Fboot%2F${MAC}%2F${splice(TOK, 25, "\uD800")}`],
  ]
  it.each(ENC)("%s → tersamar, idempoten", (_n, input) => {
    for (const out of input.includes(ESC) ? [cleanEventMessage(input)] : [cleanEventMessage(input), redactSecrets(input)]) {
      noLeak(out)
      expect(out).toContain("[REDACTED")
      expect(redactSecrets(out)).toBe(out)
    }
  })
  it.each(ENC)("%s lewat handleLogPost → DB", async (_n, input) => {
    const token = await ready()
    expect(post(token, `a\n${input}\nb\n`)).toMatchObject({ ok: true, accepted: 3 })
    for (const m of allMessages()) noLeak(m)
    expect(installerMessages()[0]).toBe("a")
    expect(installerMessages()[2]).toBe("b")
  })

  it("hasil persis: tampilan mempertahankan encoding asli di luar secret", () => {
    expect(redactSecrets(`GET /boot%2F${MAC}%2F${TOK}%2Fstatus`)).toBe(`GET /boot%2F${MAC}%2F${REDACTED}%2Fstatus`)
    expect(redactSecrets(`{"u":"\\/boot\\/${MAC}\\/${TOK}\\/s"}`)).toBe(`{"u":"\\/boot\\/${MAC}\\/${REDACTED}\\/s"}`)
    expect(redactSecrets(`q?token%3D${TOK}&x=1`)).toBe(`q?token%3D${REDACTED}&x=1`)
    expect(redactSecrets(`pw \\$6\\$saltsalt\\$${"Q".repeat(86)} x`)).toBe(`pw \\$6\\$${REDACTED} x`)
    expect(redactSecrets(`pw $$6$$saltsalt$$${"Q".repeat(86)} x`)).toBe(`pw $$6$$${REDACTED} x`)
    expect(cleanEventMessage(`token=${splice(TOK, 7, "\u034F")} ok`)).toBe(`token=${REDACTED} ok`)
  })

  it("surrogate tunggal dibuang dari tampilan (tidak tersimpan sebagai teks UTF-16 rusak)", () => {
    expect(stripControl("a\uD800b\uDC00c")).toBe("abc")
    expect(stripControl("a\uD800\nb", true)).toBe("a\nb")
    expect(cleanEventMessage("x\uDBFFy")).toBe("xy")
    // Pasangan surrogate yang sah (emoji) tetap.
    expect(cleanEventMessage("ok 👍 \u{1F600}")).toBe("ok 👍 \u{1F600}")
  })

  it("sentinel di teks tidak membuat karakter secret lolos (SR-5-20)", () => {
    // `secretMarks` membandingkan dengan sentinel: tanpa pembuangan \p{Co}, karakter U+E000 di dalam
    // token yang disamarkan MARK_PLAIN tidak terdeteksi berubah.
    const input = `token=${splice(TOK, 10, MARK_PLAIN)}`
    expect(redactSecrets(input)).toBe(`token=${REDACTED}`)
    expect(redactSecrets(`${splice(BEGIN, 5, MARK_KEY)}\n${KEY_LINES[0]}`)).not.toContain(KEY_LINES[0])
  })

  const BENIGN = [
    "Get:1 http://10.99.0.2/media/ubuntu-24.04 noble/main amd64 openssh-server amd64 1:9.6p1-3ubuntu13 [510 kB]",
    "Setting up openssh-server (1:9.6p1-3ubuntu13) ...",
    "2026-11-06 10:00:01,104 INFO subiquity.server.server:612 loaded autoinstall config from /autoinstall.yaml",
    "10:00:03,001 INF anaconda.modules.payloads.payload.dnf: Downloading packages: 412/412 (100%)",
    "Nov  6 10:00:03 main-menu[234]: INFO: Menu item 'netcfg' selected",
    "    [=========================>                        ]  51% 5.0 GiB / 9.8 GiB",
    "Progress: [ 87%] [##########################################........]",
    "partition uuid=6f2c3a50-7d1e-4b2a-9c0d-2e8f5a1b7c34 size=1127219200 path=/boot/efi",
    "/boot/efi/EFI/ubuntu/shimx64.efi /boot/grub/grub.cfg /boot/vmlinuz-6.8.0-31-generic /boot/initrd.img-6.8.0-31-generic",
    "/boot/52:54:00:99:00:12.ipxe?platform=efi",
    "http://10.99.0.2/media/debian-12/dists/bookworm/Release",
    "curl http://10.99.0.2/media/a%20b%2Fc.iso?x=%3D1",
    "echo $$ ; echo $$$ ; kill -0 $$",
    "printf %s \\$HOME \\\"quoted\\\" \\/path",
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "256 SHA256:tGtNbP1X+RksP19dZQTf2WS9arMo1SsDTGSaoVgrRRU root@m6-node14 (ED25519)",
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFIXTUREfixtureFIXTUREfixtureFIXTUREfix ops@lab",
    "-----BEGIN SSH HOST KEY FINGERPRINTS-----",
    "café ✓ ❤️ 👍🏽 🇮🇩 naïve résumé",
    "tab\tdan\tkolom",
    "token pendek7 tanpa tanda sama dengan",
    "token=pendek7",
    "kunci: \uE123 (ikon Nerd Font)",
  ]
  it.each(BENIGN)("teks biasa identik (redactSecrets, cleanEventMessage, handleLogPost): %j", async (t) => {
    expect(redactSecrets(t)).toBe(t)
    expect(cleanEventMessage(t)).toBe(t)
    const token = await ready()
    expect(post(token, `${t}\n`)).toMatchObject({ ok: true, accepted: 1 })
    expect(installerMessages()).toEqual([t])
  })

  it("teks biasa multi-baris (body gabungan) identik", () => {
    const body = BENIGN.join("\n")
    expect(redactSecrets(body)).toBe(body)
    expect(cleanAndRedact(body, true)).toBe(body)
  })

  it("matchView: peta indeks mencakup seluruh rentang mentah yang di-decode", () => {
    const v = matchView(identityView("a%252Fb\\/c\u034Fd$$e"))
    expect(v.text).toBe("a/b/cd$e")
    expect([v.start[1], v.end[1]]).toEqual([1, 6]) // `%252F` (dua lapis) → `/`
    expect([v.start[3], v.end[3]]).toEqual([7, 9]) // `\/` → `/`
    expect([v.start[5], v.end[5]]).toEqual([11, 12]) // `d` (CGJ sebelumnya dibuang)
    expect([v.start[6], v.end[6]]).toEqual([12, 14]) // `$$` → `$`
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
    ["%25 berulang", "%25".repeat(5461)],
    ["backslash berulang", "\\".repeat(16384)],
    ["$ berulang", "$".repeat(16384)],
    ["ESC + SGR campur", `${ESC}[0m${ESC}`.repeat(3300)],
    ["karakter tak terlihat", "\u034F\uFE0F\uE000\u0301".repeat(4096)],
    ["base64 64 kolom tanpa END", `${KEY_LINES[0]}\n`.repeat(250)],
    ["log campur", `${BENIGN.join("\n")}\n`.repeat(12).slice(0, 16384)],
    ["footer yatim berulang", `${KEY_LINES[0]}\n${END}\n`.repeat(166)],
  ])("16 KB %s: linear (≤ 20 ms terbaik dari 5)", (_n, input) => {
    expect(input.length).toBeGreaterThan(15000)
    expect(bestOf(5, () => redactSecrets(input))).toBeLessThan(20)
    expect(bestOf(5, () => cleanEventMessage(input))).toBeLessThan(20)
  })
  it("16 KB log campuran (log installer + encoding/escape/tak terlihat + secret) lewat handleLogPost ≤ 50 ms (terbaik dari 5)", async () => {
    const token = await ready()
    const noisy = [
      `GET /boot%2F${MAC}%2F${TOK}%2Fstatus ${ESC}[32mOK${ESC}[0m`,
      `{"url":"\\/boot\\/${MAC}\\/${splice(TOK, 9, "\u034F")}\\/log"} $$6$$saltsalt$$${"Q".repeat(86)}`,
      "%25\\$$\u034F".repeat(40),
    ]
    const lines: string[] = []
    for (let i = 0; lines.join("\n").length < 15800; i++) lines.push(i % 4 === 3 ? noisy[i % 3] : BENIGN[i % BENIGN.length])
    // Baris digabung per ±2 KB (8 baris): batas 50 ms mengukur redaksi, bukan biaya INSERT per baris.
    const joined = Array.from({ length: 8 }, (_, k) => lines.filter((_, j) => j % 8 === k).join(" | "))
    const body = `${joined.join("\n")}\n${KEY_LINES[0]}\n${END}\n`
    expect(body.length).toBeGreaterThan(15000)
    let runs = 0
    const best = bestOf(5, () => {
      expect(post(token, body, 2 + runs++)).toMatchObject({ ok: true })
    })
    expect(best).toBeLessThan(50)
  })
})

// ---------------------------------------------------------------------------
// AC-6.16
describe("AC-6.16 CR-5-20 a/b/c + SR-5-14 + SR-5-15", () => {
  const PREFIXES = [
    "[    1.234] ",
    "[12345.678901] ",
    "cloud-init[1234]: ",
    "2026-11-06T01:02:03Z ",
    "2026-11-06T01:02:03.123+07:00 ",
    "2026-11-06 01:02:03,123 DEBUG ",
    "Nov  6 01:02:03 node12 cloud-init[1234]: ",
    "Nov  6 01:02:03 in-target: ",
    "Nov 16 01:02:03 kernel: [   21.384511] ",
    "01:02:03,123 INF program: ",
    "log-output: ",
  ]
  it.each(PREFIXES)("(a) ekor key berprefiks %j + footer yatim → seluruh ekor tersamar", (p) => {
    const lines = [...KEY_LINES.slice(0, 4), "AQID"].map((l) => p + l)
    const out = redactSecrets(`Langkah\n${lines.join("\n")}\n${p}${END}\nafter`)
    expect(out).toBe(`Langkah\n${REDACTED_KEY}\nafter`)
    noLeak(out)
  })
  it.each(PREFIXES)("(a) via handleLogPost (request kedua) %j", async (p) => {
    const token = await ready()
    expect(post(token, `${p}${BEGIN}\n${KEY_LINES.slice(0, 2).map((l) => p + l).join("\n")}\n`)).toMatchObject({ ok: true })
    expect(post(token, `Langkah\n${KEY_LINES.slice(2).map((l) => p + l).join("\n")}\n${p}${END}\nOK\n`, 3)).toMatchObject({ ok: true })
    // Prefiks baris BEGIN tetap tampil (blok dimulai dari BEGIN); ekor yatim disamarkan seluruh baris.
    expect(installerMessages()).toEqual([`${p}${REDACTED_KEY}`, "Langkah", REDACTED_KEY, "OK"])
    for (const m of allMessages()) noLeak(m)
  })
  it("(a) baris teks biasa berprefiks di atas ekor key tidak tertelan", () => {
    const out = redactSecrets(`cloud-init[1]: Selesai menulis file\ncloud-init[1]: ${KEY_LINES[0]}\ncloud-init[1]: ${END}`)
    expect(out).toBe(`cloud-init[1]: Selesai menulis file\n${REDACTED_KEY}`)
  })

  it.each([
    ["64 kolom (PEM)", KEY_LINES.slice(0, 4), "AQIDBAU="],
    ["70 kolom (OpenSSH)", [0, 1, 2, 3].map(LINE70), "c2hAaG9zdAECAwQF"],
    ["2 baris saja", KEY_LINES.slice(0, 2), null],
    ["berprefiks", KEY_LINES.slice(0, 3).map((l) => `cloud-init[9]: ${l}`), null],
  ])("(b) body hanya isi key %s tanpa BEGIN/END → tersamar", async (_n, lines, tail) => {
    const body = ["sebelum", ...lines, ...(tail ? [tail] : []), "sesudah"].join("\n")
    const out = redactSecrets(body)
    expect(out).toBe(`sebelum\n${REDACTED_KEY}\nsesudah`)
    noLeak(out)
    if (tail) expect(out).not.toContain(tail)
    const token = await ready()
    expect(post(token, `${body}\n`)).toMatchObject({ ok: true })
    expect(installerMessages()).toEqual(["sebelum", REDACTED_KEY, "sesudah"])
  })
  it("(b) negatif: satu baris 64, digest hex 64, baris berspasi, kata tunggal di bawah rangkaian tetap utuh", () => {
    for (const t of [
      `x\n${KEY_LINES[0]}\ny`,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855\n9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08",
      `${"a".repeat(64)}\n${"b".repeat(64)}`,
      `${KEY_LINES[0].slice(0, 63)}\n${KEY_LINES[1].slice(0, 63)}`,
      `${KEY_LINES[0]} x\n${KEY_LINES[1]} y`,
    ]) {
      expect(redactSecrets(t)).toBe(t)
    }
    expect(redactSecrets(`${KEY_LINES[0]}\n${KEY_LINES[1]}\nDone\nlanjut`)).toBe(`${REDACTED_KEY}\nDone\nlanjut`)
    // Rangkaian campuran 64 lalu 70: masing-masing < 2 → tidak dianggap isi key.
    expect(redactSecrets(`${KEY_LINES[0]}\n${LINE70(0)}`)).toBe(`${KEY_LINES[0]}\n${LINE70(0)}`)
  })

  it("(c) 70 footer yatim dalam satu body → semua ekor tersamar (tanpa batas 64)", async () => {
    const blocks = Array.from({ length: 70 }, (_, i) => `teks-${i}\n${KEY_LINES[i % 6]}\n${END}`)
    const out = redactSecrets(blocks.join("\n"))
    expect(out).toBe(Array.from({ length: 70 }, (_, i) => `teks-${i}\n${REDACTED_KEY}`).join("\n"))
    noLeak(out)
    const token = await ready()
    expect(post(token, `${blocks.slice(0, 66).join("\n")}\n`)).toMatchObject({ ok: true, accepted: 132 })
    for (const m of allMessages()) noLeak(m)
    expect(installerMessages().filter((m) => m === REDACTED_KEY)).toHaveLength(66)
  })
  it("(c) footer berurutan di baris yang sama / bertumpuk", () => {
    expect(redactSecrets(`${KEY_LINES[0]}\n${END}${END}\nx`)).toBe(`${REDACTED_KEY}\nx`)
    expect(redactSecrets(`a\n${END}\n${KEY_LINES[1]}\n${END}\nb`)).toBe(`a\n${REDACTED_KEY}\n${REDACTED_KEY}\nb`)
  })

  // SR-5-15: tabel perilaku terdokumentasi di header `redact.ts` — hasil = yang didokumentasikan.
  const MID = "3c7b5b0e4f1a4d0e8a2b6c1d9e8f7a6b"
  it.each([
    ["awk '{print $6$7}'", "awk '{print $6$7}'", `awk '{print ${HASH_REDACTED}}'`],
    ["BEGIN tanpa footer menelan sisa body", `a\n${BEGIN}\nb3Bl\nDone\nlanjut`, `a\n${REDACTED_KEY}`],
    ["footer yatim + kata pendek di atas baris key", `x y\n${KEY_LINES[0]}\nDone\n${END}\nz`, `x y\n${REDACTED_KEY}\nz`],
    ["footer yatim: kata di atas teks biasa tetap", `awal\nDone\n${END}\nz`, `awal\nDone\n${REDACTED_KEY}\nz`],
    ["path BLS machine-id", `/boot/${MID}/initramfs`, `/boot/${MID}/${REDACTED}`],
    ["token= bukan token (≥ 8)", "token=bukan-token-asli", `token=${REDACTED}`],
    ["isi sertifikat PEM tanpa header (64 kolom)", `${KEY_LINES[2]}\n${KEY_LINES[3]}`, REDACTED_KEY],
  ])("perilaku terdokumentasi: %s", (_n, input, want) => {
    expect(redactSecrets(input)).toBe(want)
  })
  it("perilaku terdokumentasi: emoji ber-ZWJ terpecah (ZWJ dibuang dari tampilan)", () => {
    expect(cleanEventMessage("keluarga 👨\u200D👩\u200D👧")).toBe("keluarga 👨👩👧")
  })
  it("sisa risiko terdokumentasi (diketahui lolos): token ter-wrap, <token>X, satu baris key tanpa BEGIN/END", () => {
    expect(redactSecrets(`/boot/${MAC}/${TOK.slice(0, 40)}\n${TOK.slice(40)}`)).toBe(`/boot/${MAC}/${REDACTED}\n${TOK.slice(40)}`)
    expect(redactSecrets(`/boot/${MAC}/${TOK}X/s`)).toBe(`/boot/${MAC}/${TOK}X/s`)
    expect(redactSecrets(`a\n${KEY_LINES[0]}\nb`)).toBe(`a\n${KEY_LINES[0]}\nb`)
  })

  it("docstring: header redact.ts memuat tabel & sisa risiko; job-events.ts tanpa klaim berlebih", () => {
    const dir = path.resolve(__dirname)
    const redactSrc = readFileSync(path.join(dir, "redact.ts"), "utf8")
    for (const s of ["awk '{print $6$7}'", "BEGIN … PRIVATE KEY", "footer END yatim", "machine-id", "ZWJ", "Sisa risiko", "ter-wrap"])
      expect(redactSrc, s).toContain(s)
    const jobEventsSrc = readFileSync(path.join(dir, "db/repos/job-events.ts"), "utf8")
    expect(jobEventsSrc).not.toContain("tidak lagi meloloskan sisa secret")
    expect(redactSrc).not.toContain("tidak lagi meloloskan sisa secret")
  })
})

// ---------------------------------------------------------------------------
// AC-6.17 (struktur; fixture nyata menyusul dari run KVM M6 — T14)
describe("AC-6.17 SR-5-5(c) fixture log installer (template + secret sintetis)", () => {
  const fixtures = listFixtures(SYNTHETIC_DIR)
  it("fixture sintetis tersedia untuk kelima format (subiquity, curtin, anaconda, program, d-i syslog)", () => {
    expect(fixtures.map((f) => f.name)).toEqual([
      "anaconda.log",
      "curtin-install.log",
      "di-syslog.log",
      "program.log",
      "subiquity-server-debug.log",
    ])
    for (const f of fixtures) {
      // File fixture tidak memuat secret apa pun (hanya placeholder).
      expect(f.template, f.name).not.toMatch(/\$6\$|PRIVATE KEY|\/boot\/[0-9A-Fa-f:%-]{12,40}\/[A-Za-z0-9_-]{8}|token["']?\s*[=:]\s*["']?[A-Za-z0-9_-]{8}/i)
      expect(f.template, f.name).toMatch(/\{\{(TOKEN|HASH|KEY|KEY_BODY)\}\}/)
    }
  })
  const rows = fixtures.flatMap((f) =>
    ([
      ["LF, 200 baris/16 KB", 200, "\n"],
      ["CRLF", 200, "\r\n"],
      ["potongan kecil 7 baris (key terpecah antar-request)", 7, "\n"],
    ] as const).map(([mode, maxLines, eol]): [string, string, string, number, string] => [f.name, mode, f.template, maxLines, eol]),
  )
  it.each(rows)("%s (%s) via handleLogPost: secret sintetis tersamar, baris biasa identik", async (_name, _mode, tpl, maxLines, eol) => {
    const token = await ready()
    const lines = expandTemplate(tpl, { mac: MAC, token })
    const bodies = chunkBodies(
      lines.map((l) => l.text),
      maxLines,
      16 * 1024,
      eol,
    )
    bodies.forEach((b, i) => expect(post(token, b, 2 + i)).toMatchObject({ ok: true, status: 200 }))
    // Potongan 7 baris memisahkan baris akhir isi key (< 16 karakter) ke request berikutnya → sisa
    // risiko terdokumentasi, diizinkan maksimal 1 kali dan hanya pada mode itu.
    const allow = maxLines === 7 && tpl.includes("{{KEY_BODY}}") ? 1 : 0
    expect(checkStored(installerMessages(), lines, token, { allowShortKeyTail: allow })).toEqual([])
  })
  it("kontrol: harness mendeteksi kebocoran dan over-redaksi", () => {
    const lines = expandTemplate("biasa\nGET /boot/{{MAC}}/{{TOKEN}}/x\n", { mac: MAC, token: TOK })
    expect(checkStored(["biasa", `GET /boot/${MAC}/${TOK}/x`], lines, TOK)).not.toEqual([])
    expect(checkStored([REDACTED, `GET /boot/${MAC}/${REDACTED}/x`], lines, TOK)).not.toEqual([])
    expect(checkStored(["biasa", `GET /boot/${MAC}/${REDACTED}/x`], lines, TOK)).toEqual([])
    const tail = FIXTURE_KEY_BODY.at(-1)!
    expect(tail.length).toBeLessThan(16)
    const keyLines = expandTemplate("a\n{{KEY_BODY}}\nb\n", { mac: MAC, token: TOK })
    expect(checkStored(["a", REDACTED_KEY, tail, "b"], keyLines, TOK)).not.toEqual([])
    expect(checkStored(["a", REDACTED_KEY, tail, "b"], keyLines, TOK, { allowShortKeyTail: 1 })).toEqual([])
    expect(REDACTED_B64).toBe("[REDACTED-B64]")
  })
  it("secretMarks: panjang tetap (invarian sentinel)", () => {
    const t = `a token=${TOK} ${HASH} ${BEGIN}\n${KEY_LINES[0]}`
    expect(secretMarks(t)).toHaveLength(t.length)
  })
})
