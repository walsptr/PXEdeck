// Helper test B-5: jalankan perintah sh hasil generator yang menurunkan URL callback dari
// /proc/cmdline, terhadap cmdline kernel palsu (file sementara di dalam project), dan pindai teks
// hasil generator untuk token — termasuk di dalam payload base64 (bertingkat, UTF-16LE).
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

import { TEST_TMP_ROOT } from "./db"

const U_RE = /u=\$\(tr ' ' '\\n' < \/proc\/cmdline \| sed -n '[^']*' \| head -n 1\)/

function withTmp<T>(fn: (dir: string) => T): T {
  mkdirSync(TEST_TMP_ROOT, { recursive: true })
  const d = mkdtempSync(path.join(TEST_TMP_ROOT, "cmdline-"))
  try {
    return fn(d)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}

/** Ekspresi `u=$(…/proc/cmdline…)` di dalam perintah generator (null bila tidak ada). */
export function urlExpr(cmd: string): string | null {
  return U_RE.exec(cmd)?.[0] ?? null
}

/** Nilai `$u` setelah ekspresi di `cmd` dijalankan `sh` dengan cmdline kernel `kernelCmdline`. */
export function evalCallbackUrl(cmd: string, kernelCmdline: string): string {
  const expr = urlExpr(cmd)
  if (!expr) throw new Error(`tanpa ekspresi u=$(…/proc/cmdline…): ${cmd}`)
  return withTmp((d) => {
    const f = path.join(d, "cmdline")
    writeFileSync(f, `${kernelCmdline}\n`)
    return execFileSync("sh", ["-c", `${expr.replace("/proc/cmdline", f)}; printf %s "$u"`], { encoding: "utf8" })
  })
}

/**
 * Jalankan perintah tulis file URL callback (`firstbootInstallCmds()[1]`) dengan root
 * `<root>/etc/pxe-callback` dipetakan ke direktori sementara → {isi, mode} atau null bila file
 * tidak ditulis.
 */
export function runUrlFileCmd(cmd: string, root: string, kernelCmdline: string): { content: string; mode: string } | null {
  return withTmp((d) => {
    const f = path.join(d, "cmdline")
    writeFileSync(f, `${kernelCmdline}\n`)
    mkdirSync(path.join(d, "etc/pxe-callback"), { recursive: true })
    const script = cmd.replace("/proc/cmdline", f).replaceAll(`${root}/etc/pxe-callback/`, `${d}/etc/pxe-callback/`)
    execFileSync("sh", ["-c", script])
    const out = path.join(d, "etc/pxe-callback/url")
    try {
      return { content: readFileSync(out, "utf8"), mode: (statSync(out).mode & 0o777).toString(8) }
    } catch {
      return null
    }
  })
}

const B64_RUN = /[A-Za-z0-9+/]{16,}={0,2}/g

/**
 * true bila `needle` muncul di `text` apa adanya ATAU di dalam payload base64 (hingga `depth`
 * tingkat, UTF-8 maupun UTF-16LE, semua offset 0–3).
 */
export function containsSecret(text: string, needle: string, depth = 3): boolean {
  if (text.includes(needle)) return true
  if (depth === 0) return false
  for (const m of text.matchAll(B64_RUN)) {
    for (let off = 0; off < 4; off++) {
      const s = m[0].slice(off).replace(/=+$/, "")
      const buf = Buffer.from(s.slice(0, s.length - (s.length % 4)), "base64")
      for (const dec of [buf.toString("utf8"), buf.toString("utf16le")]) {
        if (containsSecret(dec, needle, depth - 1)) return true
      }
    }
  }
  return false
}
