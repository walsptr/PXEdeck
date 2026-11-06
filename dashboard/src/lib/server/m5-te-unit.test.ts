// M5-T11 (test-engineer): unit settings/hardening M5.
//   AC-5.1  setiap env job baru: default, batas min/max diterima, di luar batas / non-angka → error
//           yang menyebut nama variabel; TTL < jumlah timeout → error menyebut PXE_TOKEN_TTL_MIN
//   AC-5.2  SR-4-2 kombinasi trust proxy × lease × flag + test statis `.env.example`
//   AC-5.3  CR-4-10 IPv6 ditolak; properti: setiap URL yang diterima settings aman untuk iPXE
//   AC-5.4  CR-4-15 requestHost (unit)
//   AC-5.6  CR-4-8 bootDeniedLine/escapeLogValue (unit)
//   AC-5.14 redactSecrets (tabel, idempoten, teks bersih identik)
//   AC-5.21 CR-4-5 waitScript `chain --replace --autofree`, setiap `exit` = `exit 1`
import { describe, expect, it } from "vitest"

import { readFileSync } from "node:fs"
import path from "node:path"

import { bootDeniedLine, escapeLogValue } from "@/lib/server/boot-http"
import { entryScript, installerScript, localBootScript, waitScript, WAIT_MAX_ITERATIONS } from "@/lib/server/boot-script"
import { requestHost } from "@/lib/server/http"
import { HASH_REDACTED, REDACTED, REDACTED_B64, REDACTED_KEY, redactSecrets } from "@/lib/server/redact"
import { FAKE_PRIVATE_KEY } from "@/test/fixtures"
import { isolateEnv } from "@/test/env"
import { testAdminHash } from "@/test/auth"

import { settingsFromEnv, settingsWarnings, type SettingsEnv } from "./settings"

isolateEnv()

const LEASES = "/var/lib/misc/dnsmasq.leases"

// ---------------------------------------------------------------------------
describe("AC-5.1 env job baru (unit)", () => {
  const VARS = [
    { k: "PXE_JOB_BOOTING_TIMEOUT_MIN", def: 60, min: 1, max: 1440, get: (s: ReturnType<typeof settingsFromEnv>) => s.jobTimeouts.bootingMin },
    { k: "PXE_JOB_INSTALLING_TIMEOUT_MIN", def: 120, min: 1, max: 1440, get: (s: ReturnType<typeof settingsFromEnv>) => s.jobTimeouts.installingMin },
    { k: "PXE_JOB_CONFIGURING_TIMEOUT_MIN", def: 60, min: 1, max: 1440, get: (s: ReturnType<typeof settingsFromEnv>) => s.jobTimeouts.configuringMin },
    { k: "PXE_JOB_MAX_INSTALLER_BOOTS", def: 3, min: 1, max: 10, get: (s: ReturnType<typeof settingsFromEnv>) => s.maxInstallerBoots },
    { k: "PXE_WATCHDOG_INTERVAL_SEC", def: 30, min: 5, max: 600, get: (s: ReturnType<typeof settingsFromEnv>) => s.watchdogIntervalSec },
    { k: "PXE_JOB_LOG_MAX_EVENTS", def: 5000, min: 100, max: 100000, get: (s: ReturnType<typeof settingsFromEnv>) => s.jobLogMaxEvents },
    { k: "PXE_JOB_HISTORY_PER_HOST", def: 20, min: 1, max: 1000, get: (s: ReturnType<typeof settingsFromEnv>) => s.jobHistoryPerHost },
  ]
  // TTL besar agar batas atas timeout tahap tidak memicu validasi silang TTL.
  const BIG_TTL = { PXE_TOKEN_TTL_MIN: String(7 * 24 * 60) }
  it.each(VARS)("$k: default $def; $min dan $max diterima", ({ k, def, min, max, get }) => {
    expect(get(settingsFromEnv({}))).toBe(def)
    expect(get(settingsFromEnv({ ...BIG_TTL, [k]: String(min) }))).toBe(min)
    expect(get(settingsFromEnv({ ...BIG_TTL, [k]: String(max) }))).toBe(max)
    expect(get(settingsFromEnv({ ...BIG_TTL, [k]: "" }))).toBe(def)
  })
  it.each(VARS.flatMap(({ k, min, max }) => [String(min - 1), String(max + 1), "abc", "1.5", "1e2", " ", "-5", "0x10"].map((v) => ({ k, v }))).filter(({ v }) => v.trim() !== ""))(
    "$k=$v → error menyebut $k",
    ({ k, v }) => {
      expect(() => settingsFromEnv({ ...BIG_TTL, [k]: v })).toThrow(new RegExp(k))
    },
  )
  it("PXE_INSECURE_NO_LEASE_CHECK: 0/1/true/false diterima, lainnya → error menyebut variabel", () => {
    expect(settingsFromEnv({ PXE_INSECURE_NO_LEASE_CHECK: "true" }).insecureNoLeaseCheck).toBe(true)
    expect(settingsFromEnv({ PXE_INSECURE_NO_LEASE_CHECK: "false" }).insecureNoLeaseCheck).toBe(false)
    for (const v of ["2", "yes", "on"]) expect(() => settingsFromEnv({ PXE_INSECURE_NO_LEASE_CHECK: v })).toThrow(/PXE_INSECURE_NO_LEASE_CHECK/)
  })
  it("PXE_TOKEN_TTL_MIN < booting + installing + configuring → error menyebut PXE_TOKEN_TTL_MIN; = jumlah → diterima", () => {
    const t = { PXE_JOB_BOOTING_TIMEOUT_MIN: "10", PXE_JOB_INSTALLING_TIMEOUT_MIN: "15", PXE_JOB_CONFIGURING_TIMEOUT_MIN: "20" }
    expect(() => settingsFromEnv({ ...t, PXE_TOKEN_TTL_MIN: "44" })).toThrow(/PXE_TOKEN_TTL_MIN/)
    expect(settingsFromEnv({ ...t, PXE_TOKEN_TTL_MIN: "45" }).tokenTtlMin).toBe(45)
    // Default TTL 360 vs timeout besar
    expect(() => settingsFromEnv({ PXE_JOB_INSTALLING_TIMEOUT_MIN: "300" })).toThrow(/PXE_TOKEN_TTL_MIN/)
    // Konfigurasi KVM (dashboard.env) valid
    expect(settingsFromEnv({ PXE_JOB_INSTALLING_TIMEOUT_MIN: "15", PXE_WATCHDOG_INTERVAL_SEC: "15" }).jobTimeouts).toEqual({ bootingMin: 60, installingMin: 15, configuringMin: 60 })
  })
  it("infra/server/dashboard.env (KVM) lolos settings dengan nilai kolom KVM plan §2.1", () => {
    const env: SettingsEnv = {}
    const text = readFileSync(path.resolve(__dirname, "../../../../infra/server/dashboard.env"), "utf8")
    for (const l of text.split("\n")) {
      const m = /^([A-Z_]+)=(.*)$/.exec(l.trim())
      if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1")
    }
    // M6: hash admin di file repo hanya placeholder (disisipkan saat deploy, AC-6.53) → ditolak
    // apa adanya; dengan hash runtime (test) konfigurasi lainnya lolos.
    expect(env.PXE_ADMIN_PASSWORD_HASH).toBe("@PXE_ADMIN_PASSWORD_HASH@")
    expect(() => settingsFromEnv({ ...env, PXE_DB_PATH: ":memory:" })).toThrow(/PXE_ADMIN_PASSWORD_HASH/)
    const s = settingsFromEnv({ ...env, PXE_ADMIN_PASSWORD_HASH: testAdminHash(), PXE_DB_PATH: ":memory:" })
    expect(s.jobTimeouts).toEqual({ bootingMin: 60, installingMin: 15, configuringMin: 60 })
    expect(s).toMatchObject({ maxInstallerBoots: 3, watchdogIntervalSec: 15, jobLogMaxEvents: 5000, jobHistoryPerHost: 20, insecureNoLeaseCheck: false, trustProxy: true })
    expect(s.dnsmasqLeases).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe("AC-5.2 SR-4-2 kombinasi trust proxy × lease × flag (unit + statis)", () => {
  it.each([
    [{ PXE_TRUST_PROXY: "1" }, "error"],
    [{ PXE_TRUST_PROXY: "1", PXE_DNSMASQ_LEASES: LEASES }, "ok"],
    [{ PXE_TRUST_PROXY: "1", PXE_INSECURE_NO_LEASE_CHECK: "1" }, "warn"],
    [{ PXE_TRUST_PROXY: "1", PXE_DNSMASQ_LEASES: LEASES, PXE_INSECURE_NO_LEASE_CHECK: "1" }, "warn"],
    [{ PXE_TRUST_PROXY: "0" }, "ok"],
    [{ PXE_TRUST_PROXY: "0", PXE_INSECURE_NO_LEASE_CHECK: "1" }, "warn"],
    [{}, "ok"],
  ] as const)("%j → %s", (env, want) => {
    if (want === "error") {
      let msg = ""
      try {
        settingsFromEnv(env)
      } catch (e) {
        msg = (e as Error).message
      }
      expect(msg).toMatch(/PXE_TRUST_PROXY/)
      expect(msg).toMatch(/PXE_DNSMASQ_LEASES/)
      expect(msg).toMatch(/PXE_INSECURE_NO_LEASE_CHECK/) // pesan menunjukkan jalan keluar dev
      return
    }
    const s = settingsFromEnv(env)
    const w = settingsWarnings(s)
    if (want === "warn") {
      expect(w).toHaveLength(1)
      expect(w[0]).toMatch(/PXE_INSECURE_NO_LEASE_CHECK=1/)
      expect(w[0]).not.toMatch(/\n/)
    } else {
      expect(w).toEqual([])
    }
  })
  it("statis: .env.example memuat ketiga variabel dengan komentar risiko", () => {
    const text = readFileSync(path.resolve(__dirname, "../../../.env.example"), "utf8")
    const lines = text.split("\n")
    const idx = (k: string) => lines.findIndex((l) => l.startsWith(`${k}=`))
    for (const k of ["PXE_TRUST_PROXY", "PXE_DNSMASQ_LEASES", "PXE_INSECURE_NO_LEASE_CHECK"]) expect(idx(k), k).toBeGreaterThanOrEqual(0)
    expect(lines[idx("PXE_INSECURE_NO_LEASE_CHECK")]).toBe("PXE_INSECURE_NO_LEASE_CHECK=0")
    expect(lines[idx("PXE_TRUST_PROXY")]).toBe("PXE_TRUST_PROXY=0")
    // Komentar tepat di atas variabel (blok komentar berurutan).
    const commentAbove = (k: string) => {
      const out: string[] = []
      for (let i = idx(k) - 1; i >= 0 && lines[i].startsWith("#"); i--) out.unshift(lines[i])
      return out.join("\n")
    }
    expect(commentAbove("PXE_INSECURE_NO_LEASE_CHECK")).toMatch(/RISIKO/)
    expect(commentAbove("PXE_INSECURE_NO_LEASE_CHECK")).toMatch(/dev/i)
    expect(commentAbove("PXE_TRUST_PROXY")).toMatch(/PXE_DNSMASQ_LEASES/)
    expect(commentAbove("PXE_TRUST_PROXY")).toMatch(/DEC-013/)
    for (const k of ["PXE_JOB_BOOTING_TIMEOUT_MIN", "PXE_JOB_INSTALLING_TIMEOUT_MIN", "PXE_JOB_CONFIGURING_TIMEOUT_MIN", "PXE_JOB_MAX_INSTALLER_BOOTS", "PXE_WATCHDOG_INTERVAL_SEC", "PXE_JOB_LOG_MAX_EVENTS", "PXE_JOB_HISTORY_PER_HOST"]) {
      expect(idx(k), k).toBeGreaterThanOrEqual(0)
    }
    // Nilai di .env.example sendiri valid (default produksi).
    const env: SettingsEnv = {}
    for (const l of lines) {
      const m = /^([A-Z_]+)=(.*)$/.exec(l)
      if (m && m[2] !== "") env[m[1]] = m[2]
    }
    expect(() => settingsFromEnv({ ...env, PXE_DB_PATH: ":memory:", PXE_SEED: "empty" })).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
describe("AC-5.3 CR-4-10 URL IPv6 ditolak; URL yang diterima settings aman untuk iPXE", () => {
  it.each([
    ["PXE_BASE_URL", "http://[fd00::2]"],
    ["PXE_BASE_URL", "http://[::1]:8080/pxe"],
    ["PXE_BASE_URL", "https://[2001:db8::1]"],
    ["PXE_MEDIA_URL", "http://[fd00::2]/media"],
    ["PXE_MEDIA_URL", "http://[::ffff:10.99.0.2]/media"],
  ])("%s=%s → error menyebut variabel", (k, v) => {
    expect(() => settingsFromEnv({ [k]: v })).toThrow(new RegExp(`${k}.*IPv6`))
  })
  it("properti: 600 URL acak — setiap URL yang diterima settings lolos entryScript/installerScript; yang tidak aman ditolak settings", () => {
    let seed = 0x5eed
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    const pick = <T,>(a: readonly T[]) => a[rnd(a.length)]
    const hosts = ["10.99.0.2", "pxe.lab.example", "pxe-1.lab", "[fd00::2]", "a_b.lab", "PXE.LAB", "10.99.0.2:8080", "host%20x", "h$x", "x y"]
    const segs = ["", "media", "a_b", "a-b", "x.y", "%41", "$x", "a b", "a;b", "~u", "!", "(x)", "é", "a,b", "a=b", "a'b", "a\"b", "q?x=1", "#f", "a@b"]
    let accepted = 0
    for (let i = 0; i < 600; i++) {
      const u = `${pick(["http", "https", "ftp"])}://${pick(hosts)}${Array.from({ length: rnd(3) }, () => `/${pick(segs)}`).join("")}${pick(["", "/"])}`
      for (const key of ["PXE_BASE_URL", "PXE_MEDIA_URL"] as const) {
        let s
        try {
          s = settingsFromEnv({ [key]: u })
        } catch {
          continue
        }
        accepted++
        expect(() => entryScript(s.baseUrl), u).not.toThrow()
        for (const method of ["autoinstall", "preseed", "kickstart"] as const) {
          expect(
            () =>
              installerScript({
                method,
                mediaUrl: s.mediaUrl,
                mediaRoot: s.mediaRoot,
                serverIp: s.network.pxeServer,
                pxeDns: s.network.dns[0],
                configUrl: `${s.baseUrl}/boot/52:54:00:99:00:11/${"A".repeat(43)}/`,
                source: { kernel: "k/vmlinuz", initrd: "k/initrd", repo: "r" },
                extraArgs: "",
              }),
            `${key}=${u}`,
          ).not.toThrow()
        }
        expect(() => waitScript(s.baseUrl, "52:54:00:99:00:11", 0), u).not.toThrow()
      }
    }
    expect(accepted).toBeGreaterThan(50) // properti tidak hampa
  })
})

// ---------------------------------------------------------------------------
describe("AC-5.4 CR-4-15 requestHost (unit)", () => {
  const r = (h: Record<string, string>, url = "http://fallback.example:3000/api/x") => new Request(url, { headers: h })
  it("trust proxy=0: X-Forwarded-Host diabaikan apa pun nilainya; Host dipakai (huruf kecil, port dipertahankan)", () => {
    expect(requestHost(r({ host: "PXE.Lab:8080", "x-forwarded-host": "localhost" }), false)).toBe("pxe.lab:8080")
    expect(requestHost(r({ "x-forwarded-host": "localhost" }), false)).toBe("fallback.example:3000")
  })
  it("trust proxy=1: entri pertama X-Forwarded-Host dipakai; kosong → Host", () => {
    expect(requestHost(r({ host: "evil", "x-forwarded-host": " Good.Example , evil" }), true)).toBe("good.example")
    expect(requestHost(r({ host: "h.example", "x-forwarded-host": "" }), true)).toBe("h.example")
  })
})

// ---------------------------------------------------------------------------
describe("AC-5.6 CR-4-8 baris log penolakan (unit)", () => {
  it.each([
    ["52:54:00:99:00:11\n[boot] tolak file mac=aa alasan=x", "-"],
    ["%0a[boot] tolak", "-"],
    ["\r\n", "-"],
    ["52-54-00-99-00-11", "52:54:00:99:00:11"],
    ["525400990011", "52:54:00:99:00:11"],
  ])("segmen %j → mac=%s, satu baris", (raw, mac) => {
    for (const p of ["file", "status", "log"] as const) {
      const line = bootDeniedLine(p, raw, "ip")
      expect(line).toBe(`[boot] tolak ${p} mac=${mac} alasan=ip`)
      expect(line).not.toMatch(/[\r\n]/)
    }
  })
  it("reason berisi kontrol/non-ASCII di-escape; panjang dibatasi", () => {
    const l = bootDeniedLine("status", "x", "a\nb\r\tc\u0000é")
    expect(l).toBe("[boot] tolak status mac=- alasan=a\\u000ab\\u000d\\u0009c\\u0000\\u00e9")
    expect(escapeLogValue("x".repeat(500))).toBe(`${"x".repeat(200)}…`)
    expect(escapeLogValue("ok-reason_1")).toBe("ok-reason_1")
  })
})

// ---------------------------------------------------------------------------
describe("AC-5.14 redactSecrets (tabel)", () => {
  const TOK = "abcDEF0123456789_-abcDEF0123456789_-abcDEFG" // 43
  const HASH = `$6$rounds=5000$saltsalt$${"Q".repeat(86)}`
  const HASH2 = `$6$abcdefgh$${"z".repeat(86)}`
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64")
  const b64le = (s: string) => Buffer.from(s, "utf16le").toString("base64")
  if (TOK.length !== 43) throw new Error("TOK 43")
  it.each([
    ["path MAC ':'", `GET /boot/52:54:00:99:00:11/${TOK}/user-data`, `GET /boot/52:54:00:99:00:11/${REDACTED}/user-data`],
    ["path MAC '-'", `/boot/52-54-00-99-00-11/${TOK}/x`, `/boot/52-54-00-99-00-11/${REDACTED}/x`],
    ["path MAC hex", `/boot/525400990011/${TOK}/status`, `/boot/525400990011/${REDACTED}/status`],
    ["path MAC %3A", `/boot/52%3A54%3A00%3A99%3A00%3A11/${TOK}/log`, `/boot/52%3A54%3A00%3A99%3A00%3A11/${REDACTED}/log`],
    ["token=", `token=${TOK}`, `token=${REDACTED}`],
    ["token: ", `Token: ${TOK}`, `Token: ${REDACTED}`],
    ["json token", `{"token":"${TOK}"}`, `{"token":"${REDACTED}"}`],
    ["hash rounds", `pw ${HASH} end`, `pw ${HASH_REDACTED} end`],
    ["hash biasa", `x:${HASH2}:y`, `x:${HASH_REDACTED}:y`],
    ["OpenSSH private key", `a ${FAKE_PRIVATE_KEY} b`, `a ${REDACTED_KEY} b`],
    ["PEM tanpa footer", "-----BEGIN RSA PRIVATE KEY-----\nMIIEow", REDACTED_KEY],
  ])("%s", (_n, input, want) => {
    expect(redactSecrets(input)).toBe(want)
    expect(redactSecrets(redactSecrets(input))).toBe(want) // idempoten
  })
  it.each([
    ["base64 UTF-8 berisi path token", b64(`curl http://10.99.0.2/boot/52:54:00:99:00:11/${TOK}/status`)],
    ["base64 UTF-16LE berisi hash", b64le(`password ${HASH}`)],
    ["base64 offset 1", `x${b64(`zz token=${TOK} zz`)}`],
    ["base64 offset 3", `xyz${b64(`== ${HASH2} ==`)}`],
    ["base64 dua lapis", b64(`printf %s '${b64(`late: ${HASH}`)}' | base64 -d`)],
    ["base64 berisi private key", b64(FAKE_PRIVATE_KEY)],
  ])("%s → [REDACTED-B64]", (_n, blob) => {
    const out = redactSecrets(`echo '${blob}' | base64 -d`)
    expect(out).toContain(REDACTED_B64)
    expect(out).not.toContain(blob.replace(/^x+|^xyz/, "").slice(0, 40))
    expect(redactSecrets(out)).toBe(out)
  })
  it.each([
    "installer: autoinstall mulai",
    "File user-data diambil dari IP 10.99.0.150",
    "/boot/52:54:00:99:00:11.ipxe?platform=efi",
    "token=pendek7", // M6 (CR-5-21): `token=<8..43>` kini disamarkan; batas negatif = 7 karakter
    `/boot/52:54:00:99:00:11/${TOK}x/status`, // 44 karakter → bukan token
    "$6$ tanpa hash lengkap",
    b64("teks base64 biasa tanpa rahasia apa pun di dalamnya, cukup panjang"),
    "",
    "tab\tdan unicode é ✓",
  ])("teks tanpa secret identik: %j", (t) => {
    expect(redactSecrets(t)).toBe(t)
  })
})

// ---------------------------------------------------------------------------
describe("AC-5.21 CR-4-5 script iPXE", () => {
  it("waitScript: chain --replace --autofree ke iterasi berikutnya || exit 1; iterasi terakhir → localBootScript", () => {
    for (let i = 0; i < WAIT_MAX_ITERATIONS; i++) {
      const s = waitScript("http://10.99.0.2", "52:54:00:99:00:11", i)
      const chain = s.split("\n").filter((l) => l.startsWith("chain"))
      expect(chain).toEqual([`chain --replace --autofree http://10.99.0.2/boot/52:54:00:99:00:11.ipxe?platform=\${platform}&wait=${i + 1} || exit 1`])
    }
    expect(waitScript("http://10.99.0.2", "52:54:00:99:00:11", WAIT_MAX_ITERATIONS)).toBe(localBootScript())
  })
  it("setiap `exit` di entryScript, localBootScript, waitScript adalah `exit 1`; setiap chain memakai --replace", () => {
    const scripts = [entryScript("http://10.99.0.2"), localBootScript(), ...Array.from({ length: WAIT_MAX_ITERATIONS + 1 }, (_, i) => waitScript("http://10.99.0.2", "52:54:00:99:00:11", i))]
    let exits = 0
    for (const s of scripts) {
      for (const m of s.matchAll(/\bexit\b([^\n|]*)/g)) {
        exits++
        expect(m[0].trim()).toBe("exit 1")
      }
      for (const l of s.split("\n").filter((x) => /^\s*chain\b/.test(x))) expect(l).toMatch(/^chain --replace --autofree /)
    }
    expect(exits).toBeGreaterThanOrEqual(scripts.length)
  })
})

// ---------------------------------------------------------------------------
describe("AC-5.32 DR-4-7 (statis): placeholder 'dibangun di tahap' tidak ada lagi di src/", () => {
  it("tidak ada string 'dibangun di tahap' di file sumber (selain test ini)", async () => {
    const { readdirSync, statSync } = await import("node:fs")
    const root = path.resolve(__dirname, "../..")
    const hits: string[] = []
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(tsx?|css|md|json)$/.test(f) && p !== __filename && readFileSync(p, "utf8").includes("dibangun di tahap")) hits.push(path.relative(root, p))
      }
    }
    walk(root)
    expect(hits).toEqual([])
    // Halaman yang dulu placeholder sekarang merender view nyata.
    for (const page of ["jobs", "os-images", "ssh-keys"]) {
      const src = readFileSync(path.join(root, "app/(dashboard)", page, "page.tsx"), "utf8")
      expect(src, page).not.toMatch(/PagePlaceholder/)
    }
  })
})
