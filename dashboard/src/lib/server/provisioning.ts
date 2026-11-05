// Akses file konfigurasi per job + callback status (M4-T5, DEC-008).
//
// `GET /boot/{mac}/{token}/{file}` dilayani hanya bila: token cocok dengan
// job (sha256), MAC path = MAC host job, job `booting|installing`, belum lewat
// `token_expires_at`, IP sumber ∈ IP lease MAC ∪ `current_ip` host, dan file
// dikenal untuk metode OS job. Semua penolakan → 404 seragam (alasan dicatat
// tanpa token). Fetch pertama file utama → host & job `installing`.
//
// `POST /boot/{mac}/{token}/status` (`stage=installing|configuring|done|
// failed`): token cocok, job belum final, belum expired, IP ∈ lease ∪
// current_ip ∪ IP statis host ∪ mgmt_ip (DEC-013). Maju saja (`failed` dari
// mana pun → failure_reason `installer-error`); sama → 200 no-op; mundur → 409;
// stage tak dikenal → 400. `done`/`failed` mencabut token.
//
// M5 (DEC-014): sapuan timeout host pemilik token sebelum otorisasi; setiap
// akses sah/transisi dicatat sebagai event job (tanpa token).
import { configOrDefault, peekConfig } from "@/lib/server/db/repos/configs"
import { getHost, setHostStatus } from "@/lib/server/db/repos/hosts"
import {
  ACTIVE_JOB_STATUSES,
  getJobByTokenHash,
  updateJob,
  type Job,
  type JobStatus,
} from "@/lib/server/db/repos/jobs"
import { getImage } from "@/lib/server/db/repos/os-images"
import { getKey } from "@/lib/server/db/repos/ssh-keys"
import { getDb, tx } from "@/lib/server/db"
import { parseBootMac } from "@/lib/server/discovery"
import { buildContext, installerFile, InstallerInputError } from "@/lib/server/installers"
import { failJob, logJobEvent, STAGE_LABEL, sweepJobs } from "@/lib/server/job-lifecycle"
import { ipMatchesLease } from "@/lib/server/leases"
import { getSettings } from "@/lib/server/settings"
import { hashToken, isTokenShape } from "@/lib/server/tokens"
import type { Host } from "@/lib/types"

export type Denied = { ok: false; status: 404; reason: string }

type Authorized = { ok: true; mac: string; token: string; job: Job; host: Host }

function deny(reason: string): Denied {
  return { ok: false, status: 404, reason }
}

/**
 * Cek token + MAC + TTL (tanpa IP/status). Panggil di dalam `tx`. Sapuan timeout host pemilik
 * token dijalankan lebih dulu (DEC-014 §2): token job yang baru gagal karena timeout ikut dicabut,
 * sehingga callback terlambat → 404.
 */
function authorize(rawMac: string, token: string, now: Date): Authorized | Denied {
  const mac = parseBootMac(rawMac)
  if (!mac) return deny("mac-invalid")
  if (!isTokenShape(token)) return deny("token-shape")
  const hash = hashToken(token)
  const pre = getJobByTokenHash(hash)
  if (pre) sweepJobs(now, pre.hostId)
  const job = getJobByTokenHash(hash)
  if (!job) return deny(pre ? "token-revoked" : "token-unknown")
  const host = getHost(job.hostId)
  if (!host || host.mac !== mac) return deny("mac-mismatch")
  if (!job.tokenExpiresAt || Date.parse(job.tokenExpiresAt) <= now.getTime())
    return deny("token-expired")
  return { ok: true, mac, token, job, host }
}

function ipAllowed(host: Host, ip: string | null, extra: (string | null)[] = []): boolean {
  if (!ip) return false
  if (ipMatchesLease(host.mac, ip) === true) return true
  return [host.currentIp, ...extra].includes(ip)
}

export type FileResult =
  | { ok: true; body: string; contentType: string }
  | Denied

export function serveConfigFile(input: {
  mac: string
  token: string
  file: string
  ip: string | null
  now?: Date
}): FileResult {
  const now = input.now ?? new Date()
  const s = getSettings()
  getDb()
  return tx((): FileResult => {
    const a = authorize(input.mac, input.token, now)
    if (!a.ok) return a
    const { job, host, mac } = a
    if (job.status !== "booting" && job.status !== "installing") return deny(`job-${job.status}`)
    if (!ipAllowed(host, input.ip)) return deny("ip")
    const img = getImage(job.osImageId)
    if (!img) return deny("image")
    const file = installerFile(img.method, input.file)
    if (!file) return deny("file")
    const cfg = peekConfig(host.id)
    if (!cfg) return deny("config")
    let body: string
    try {
      body = file.render(
        buildContext({
          host,
          config: cfg,
          jobId: job.id,
          image: img,
          libraryKeys: cfg.sshKeyIds.map(getKey).filter((k) => k !== null),
          mediaUrl: s.mediaUrl,
          serverIp: s.network.pxeServer,
          callbackUrl: `${s.baseUrl}/boot/${mac}/${input.token}/status`,
        }),
      )
    } catch (e) {
      if (e instanceof InstallerInputError) return deny(`generator: ${e.message}`)
      throw e
    }
    const at = now.toISOString()
    logJobEvent(job.id, {
      at,
      kind: "system",
      level: "info",
      source: "config-fetch",
      message: `File ${input.file} diambil dari IP ${input.ip}`,
    })
    if (file.primary && job.status === "booting") {
      updateJob(
        job.id,
        {
          status: "installing",
          stages: [...job.stages, { stage: "installing", at, source: "config-fetch" }],
        },
        at,
      )
      setHostStatus(host.id, "installing", at)
      logJobEvent(job.id, {
        at,
        kind: "stage",
        level: "info",
        source: "config-fetch",
        message: `${STAGE_LABEL.installing}: konfigurasi ${input.file} diambil installer`,
      })
    }
    return { ok: true, body, contentType: file.contentType }
  })
}

export const CALLBACK_STAGES = ["installing", "configuring", "done", "failed"] as const
export type CallbackStage = (typeof CALLBACK_STAGES)[number]

const ORDER: Record<JobStatus, number> = {
  booting: 0,
  installing: 1,
  configuring: 2,
  done: 3,
  failed: 4,
}

/** Keputusan transisi (fungsi murni). */
export function transition(
  from: JobStatus,
  to: CallbackStage,
): "apply" | "noop" | "conflict" {
  if (from === to) return "noop"
  if (to === "failed") return "apply"
  return ORDER[to] > ORDER[from] ? "apply" : "conflict"
}

export type StatusResult =
  | { ok: true; status: 200; changed: boolean }
  | { ok: false; status: 400 | 409; reason: string }
  | Denied

export function handleStatusCallback(input: {
  mac: string
  token: string
  stage: string
  ip: string | null
  now?: Date
}): StatusResult {
  const now = input.now ?? new Date()
  getDb()
  return tx((): StatusResult => {
    const a = authorize(input.mac, input.token, now)
    if (!a.ok) return a
    const { job, host } = a
    if (!ACTIVE_JOB_STATUSES.includes(job.status)) return deny(`job-${job.status}`)
    const cfg = configOrDefault(host)
    const staticIp = cfg.network.mode === "static" ? cfg.network.ip : null
    if (!ipAllowed(host, input.ip, [staticIp, host.mgmtIp])) return deny("ip")
    if (!(CALLBACK_STAGES as readonly string[]).includes(input.stage))
      return { ok: false, status: 400, reason: "stage" }
    const stage = input.stage as CallbackStage
    const t = transition(job.status, stage)
    if (t === "noop") return { ok: true, status: 200, changed: false }
    if (t === "conflict") return { ok: false, status: 409, reason: "backward" }
    const at = now.toISOString()
    if (stage === "failed") {
      failJob(job, "installer-error", at, "callback", `${STAGE_LABEL.failed}: installer melaporkan gagal (callback dari IP ${input.ip})`)
      setHostStatus(host.id, "failed", at, { lastSeen: at })
      return { ok: true, status: 200, changed: true }
    }
    const final = stage === "done"
    updateJob(
      job.id,
      {
        status: stage,
        stages: [...job.stages, { stage, at, source: "callback" }],
        ...(final ? { finishedAt: at, tokenHash: null, tokenExpiresAt: null } : {}),
      },
      at,
    )
    logJobEvent(job.id, {
      at,
      kind: "stage",
      level: "info",
      source: "callback",
      message: `${STAGE_LABEL[stage]} (callback dari IP ${input.ip})`,
    })
    if (stage === "done") {
      setHostStatus(host.id, "done", at, {
        osInstalled: job.osImageId,
        osAssigned: null,
        currentIp: input.ip,
        lastSeen: at,
      })
    } else {
      setHostStatus(host.id, stage, at, { lastSeen: at })
    }
    return { ok: true, status: 200, changed: true }
  })
}

// ---- Log installer (M5-T4, plan §2.4, DEC-014 §4) ----

/** Batas body log (byte); diperiksa sebelum otorisasi (route, `readBodyLimited`). */
export const LOG_MAX_BODY_BYTES = 16 * 1024
/** Batas baris per request log. */
export const LOG_MAX_LINES = 200
/** Batas request log per job per menit. */
export const LOG_RATE_PER_MIN = 60

const RATE_KEY = Symbol.for("pxe.logRate")
const rateStore = (): Map<string, number[]> => {
  const g = globalThis as typeof globalThis & { [RATE_KEY]?: Map<string, number[]> }
  return (g[RATE_KEY] ??= new Map())
}

/** Kosongkan penghitung laju (test). */
export function resetLogRate(): void {
  rateStore().clear()
}

/** Catat request di jendela 60 dtk; false bila melewati batas (tidak dicatat). */
function rateAllow(jobId: string, nowMs: number): boolean {
  const store = rateStore()
  const recent = (store.get(jobId) ?? []).filter((t) => nowMs - t < 60_000)
  if (recent.length >= LOG_RATE_PER_MIN) {
    store.set(jobId, recent)
    return false
  }
  recent.push(nowMs)
  store.set(jobId, recent)
  // Bersihkan entri basi job lain agar peta tidak tumbuh tanpa batas.
  if (store.size > 1000) {
    for (const [k, v] of store) if (!v.some((t) => nowMs - t < 60_000)) store.delete(k)
  }
  return true
}

/** Pecah body log menjadi baris (tanpa \r); baris kosong (setelah trim) dibuang. */
export function splitLogLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replaceAll("\r", ""))
    .filter((l) => l.trim() !== "")
}

export type LogResult =
  | { ok: true; status: 200; accepted: number }
  | { ok: false; status: 413 | 429; reason: string }
  | Denied

/**
 * `POST /boot/{mac}/{token}/log` (body teks, ukuran sudah dibatasi route). Otorisasi identik
 * dengan callback status (token + MAC + TTL + job aktif + IP ∈ lease ∪ current_ip ∪ IP statis ∪
 * mgmt_ip) → selain itu 404 seragam. > LOG_MAX_LINES baris → 413; > LOG_RATE_PER_MIN request/menit
 * per job → 429. Setiap baris → event `installer` (diredaksi, dibersihkan, dipotong 2048 di repo);
 * baris berawalan `ERROR` → level `error`.
 */
export function handleLogPost(input: {
  mac: string
  token: string
  text: string
  ip: string | null
  now?: Date
}): LogResult {
  const now = input.now ?? new Date()
  getDb()
  return tx((): LogResult => {
    const a = authorize(input.mac, input.token, now)
    if (!a.ok) return a
    const { job, host } = a
    if (!ACTIVE_JOB_STATUSES.includes(job.status)) return deny(`job-${job.status}`)
    const cfg = configOrDefault(host)
    const staticIp = cfg.network.mode === "static" ? cfg.network.ip : null
    if (!ipAllowed(host, input.ip, [staticIp, host.mgmtIp])) return deny("ip")
    const lines = splitLogLines(input.text)
    if (lines.length > LOG_MAX_LINES) return { ok: false, status: 413, reason: "lines" }
    if (!rateAllow(job.id, now.getTime())) return { ok: false, status: 429, reason: "rate" }
    const at = now.toISOString()
    for (const line of lines) {
      logJobEvent(job.id, {
        at,
        kind: "installer",
        level: /^\s*ERROR\b/.test(line) ? "error" : "info",
        source: "installer",
        message: line,
      })
    }
    return { ok: true, status: 200, accepted: lines.length }
  })
}

/** Ambil `stage` dari body form (`stage=done`) atau JSON (`{"stage":"done"}`). */
export function parseStageBody(text: string, contentType: string | null): string | null {
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase()
  if (ct === "application/json") {
    try {
      const v = (JSON.parse(text) as { stage?: unknown })?.stage
      return typeof v === "string" ? v : null
    } catch {
      return null
    }
  }
  return new URLSearchParams(text).get("stage")
}
