// Helper suite KVM (M4-T13). Batas keras CLAUDE.md:
//  - ssh hanya ke 10.99.0.* dengan key di .agent/keys (path dari PXE_KVM_SSH_KEY, dicek).
//  - Perintah VM hanya lewat infra/node.sh (`reset <name>`), nama wajib ^pxe-test-<m>-nodeNN$.
//  - Password acak per run hanya di memori; tidak pernah ditulis ke log/bukti (scanEvidence
//    memverifikasinya).
import { execFileSync, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

export type KvmNode = { name: string; mac: string; fw: "uefi" | "bios"; ip: string; nn: string }

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} kosong (jalankan lewat infra/kvm-run.sh)`)
  return v
}

export const KVM = {
  run: env("PXE_KVM_RUN"),
  runsDir: env("PXE_KVM_RUNS_DIR"),
  user: env("PXE_KVM_NODE_USER"),
  sshKey: env("PXE_KVM_SSH_KEY"),
  sshPub: env("PXE_KVM_SSH_PUBKEY"),
  resetCmd: env("PXE_KVM_RESET_CMD"),
  gateway: env("PXE_KVM_GATEWAY"),
  dns: env("PXE_KVM_DNS"),
  prefix: Number(env("PXE_KVM_PREFIX")),
}

/** Node dari PXE_KVM_NODES ("<name>=<mac>=<fw>=<ip> ..."), divalidasi ketat. */
export function kvmNodes(): KvmNode[] {
  return env("PXE_KVM_NODES")
    .split(/\s+/)
    .filter(Boolean)
    .map((spec) => {
      const [name, mac, fw, ip] = spec.split("=")
      const m = new RegExp(`^pxe-test-${KVM.run}-node([1-8][0-9])$`).exec(name)
      if (!m) throw new Error(`nama node tidak valid: ${name}`)
      if (mac !== `52:54:00:99:00:${m[1]}`) throw new Error(`MAC ${mac} tidak cocok dengan ${name}`)
      if (fw !== "uefi" && fw !== "bios") throw new Error(`firmware ${fw}`)
      if (!/^10\.99\.0\.\d{1,3}$/.test(ip)) throw new Error(`IP ${ip} di luar 10.99.0.*`)
      return { name, mac, fw, ip, nn: m[1] }
    })
}

/** Password acak per run (hanya di memori). */
export function randomPassword(): string {
  return `${randomBytes(18).toString("base64url")}-A1`
}

export function publicKey(): string {
  return readFileSync(KVM.sshPub, "utf8").trim()
}

function assertKeyPath() {
  const k = path.resolve(KVM.sshKey)
  if (!/\/\.agent\/keys\/[^/]+$/.test(k)) throw new Error(`key ${k} bukan di .agent/keys`)
}

const SSH_OPTS = ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes"]

/** ssh <user>@<ip> dengan key sekali pakai; `script` (bila ada) lewat stdin ke `bash -s`. */
export function ssh(ip: string, remote: string, script?: string): { code: number; out: string } {
  if (!/^10\.99\.0\.\d{1,3}$/.test(ip)) throw new Error(`ssh hanya ke 10.99.0.* (${ip})`)
  assertKeyPath()
  const r = spawnSync("ssh", ["-i", KVM.sshKey, ...SSH_OPTS, `${KVM.user}@${ip}`, remote], {
    input: script ?? "",
    encoding: "utf8",
    timeout: 120_000,
  })
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

/** Login password harus ditolak: server hanya menawarkan publickey. */
export function passwordLoginRejected(ip: string): { ok: boolean; out: string } {
  if (!/^10\.99\.0\.\d{1,3}$/.test(ip)) throw new Error(`ssh hanya ke 10.99.0.* (${ip})`)
  const r = spawnSync(
    "ssh",
    [...SSH_OPTS, "-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no", `${KVM.user}@${ip}`, "true"],
    { encoding: "utf8", timeout: 60_000, input: "" },
  )
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
  return { ok: r.status !== 0 && /Permission denied \(publickey\)/.test(out), out }
}

/** `infra/node.sh reset <name>` (virsh reset satu node milik run; bukan server). */
export function resetNode(node: KvmNode) {
  if (!new RegExp(`^pxe-test-${KVM.run}-node[1-8][0-9]$`).test(node.name)) throw new Error(`nama ${node.name}`)
  if (!/\/infra\/node\.sh$/.test(KVM.resetCmd)) throw new Error(`reset cmd ${KVM.resetCmd}`)
  execFileSync(KVM.resetCmd, ["reset", node.name], { stdio: "pipe", timeout: 60_000 })
}

export function consoleLog(node: KvmNode): string {
  const f = path.join(KVM.runsDir, `${node.name}-console.log`)
  return existsSync(f) ? readFileSync(f, "latin1") : ""
}

/** Jumlah kernel installer yang di-boot (Ubuntu casper/NFS) di serial log node. */
export function installerBoots(node: KvmNode): number {
  return (consoleLog(node).match(/netboot=nfs|casper\/vmlinuz/g) ?? []).length
}

// ---- results.json ----
export type AcResult = { ac: string; node?: string; status: "PASS" | "FAIL" | "NOT_RUN"; durationS?: number; note?: string; evidence?: string[] }
const results: AcResult[] = []
export function record(r: AcResult) {
  results.push(r)
  writeResults()
}
export function writeResults(extra: Record<string, unknown> = {}) {
  writeFileSync(
    path.join(KVM.runsDir, "results.json"),
    JSON.stringify({ run: KVM.run, generatedAt: new Date().toISOString(), results, ...extra }, null, 2) + "\n",
  )
}

// ---- scan bukti (AC-4.34) ----
const TOKEN_IN_BOOT_PATH = /(\/boot\/[0-9a-fA-F:%-]{12,40}\/)([A-Za-z0-9_-]{43})(?=\/)/g
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/
// B-5: secret di dalam blob base64 (mis. late-command `printf %s '<b64>' | base64 -d` yang
// dicetak installer ke console serial). Selaras infra/redact-evidence.sh (_b64_secret) dan
// .agent/runs/m4/b64-scan.py: blob >= 40 char, decode di offset 0-3 (UTF-8 & UTF-16LE: NUL
// dibuang), bertingkat hingga 2 lapis lagi (blob dalam >= 16 char). Pola hasil decode: token pada
// path /boot/<mac>/<token>, hash `$6$`, header private key, atau password run.
const B64_RUN = /[A-Za-z0-9+/]{40,}={0,2}/g
const B64_INNER = /[A-Za-z0-9+/]{16,}={0,2}/g
const B64_DECODED_TOKEN = /\/boot\/[0-9a-fA-F:%-]{12,40}\/[A-Za-z0-9_-]{43}/

/** Label secret bila `blob` base64 (setelah decode, bertingkat) memuatnya; null bila bersih. */
export function base64Secret(blob: string, secrets: string[], depth = 2): string | null {
  for (let off = 0; off < 4; off++) {
    let s = blob.slice(off)
    const eq = s.indexOf("=")
    if (eq >= 0) s = s.slice(0, eq)
    if (s.length < 16) continue
    s = s.slice(0, Math.floor(s.length / 4) * 4)
    const dec = Buffer.from(s, "base64").toString("latin1").replace(/\0/g, "")
    if (!dec) continue
    if (B64_DECODED_TOKEN.test(dec)) return "token /boot/ dalam base64"
    if (dec.includes("$6$")) return "hash $6$ dalam base64"
    if (dec.includes("PRIVATE KEY")) return "private key dalam base64"
    for (const sec of secrets) if (sec && dec.includes(sec)) return "password run dalam base64"
    if (depth > 0) {
      for (const inner of new Set(dec.match(B64_INNER) ?? [])) {
        const hit = base64Secret(inner, secrets, depth - 1)
        if (hit) return hit
      }
    }
  }
  return null
}

/**
 * Samarkan token pada path /boot/ di file teks bukti (token sudah dicabut saat itu, R10) lalu
 * pindai: password run, token tersisa, private key, serta token/`$6$`/private key/password run di
 * dalam blob base64 (B-5; tidak disamarkan di sini -> temuan). Mengembalikan daftar temuan
 * (kosong = bersih).
 */
export function scanEvidence(secrets: string[]): string[] {
  const findings: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (st.size < 64 * 1024 * 1024) {
        let text = readFileSync(p, "latin1")
        if (/\.(txt|log|json|md)$/.test(f) && TOKEN_IN_BOOT_PATH.test(text)) {
          text = text.replace(TOKEN_IN_BOOT_PATH, "$1<token>")
          writeFileSync(p, text, "latin1")
        }
        TOKEN_IN_BOOT_PATH.lastIndex = 0
        if (TOKEN_IN_BOOT_PATH.test(text)) findings.push(`${p}: token pada path /boot/`)
        TOKEN_IN_BOOT_PATH.lastIndex = 0
        if (PRIVATE_KEY.test(text)) findings.push(`${p}: private key`)
        for (const s of secrets) if (s && text.includes(s)) findings.push(`${p}: password run`)
        for (const blob of new Set(text.match(B64_RUN) ?? [])) {
          const hit = base64Secret(blob, secrets)
          if (hit) findings.push(`${p}: ${hit} (${blob.slice(0, 16)}…)`)
        }
      }
    }
  }
  walk(KVM.runsDir)
  return findings
}
