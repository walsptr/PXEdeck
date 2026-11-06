import type { SshKey } from "@/lib/host-config"
import type { OsImage } from "@/lib/os-images"

export const PROVISION_STATUSES = [
  "discovered",
  "booting",
  "installing",
  "configuring",
  "done",
  "failed",
  "offline",
] as const

export type ProvisionStatus = (typeof PROVISION_STATUSES)[number]

/** Tahap yang berarti host sedang dalam proses instalasi. */
export const IN_PROGRESS_STATUSES: readonly ProvisionStatus[] = [
  "booting",
  "installing",
  "configuring",
]

export type Firmware = "uefi" | "bios"

export type Host = {
  id: string
  /** MAC NIC PXE/management, huruf kecil, dipisah titik dua. */
  mac: string
  hostname: string | null
  /** IP dari lease DHCP terakhir. */
  currentIp: string | null
  /** IP management statis yang dikonfigurasi (pxe-nodes). */
  mgmtIp: string | null
  vendor: string | null
  firmware: Firmware | null
  /** id OS image yang terpasang di disk. */
  osInstalled: string | null
  /** id OS image yang ditugaskan untuk instalasi berikutnya. */
  osAssigned: string | null
  status: ProvisionStatus
  statusSince: string
  lastSeen: string
}

// ---- Job provisioning (M5) ----
// CR-5-9 (M6): SATU sumber tipe kontrak API job/OS image/SSH key. Server (`jobs-service.ts`,
// `repos/os-images.ts`, `library-service.ts`) dan klien (hooks) mengimpor tipe dari modul ini
// (bebas kode server); paritas tipe repo diuji `expectTypeOf` (`types-parity.test.ts`).

export const JOB_STATUSES = [
  "booting",
  "installing",
  "configuring",
  "done",
  "failed",
] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export const FAILURE_REASONS = [
  "timeout-booting",
  "timeout-installing",
  "timeout-configuring",
  "installer-boot-limit",
  "installer-error",
  "superseded",
] as const
export type FailureReason = (typeof FAILURE_REASONS)[number]

export type JobStage = { stage: JobStatus; at: string; source: string }

/** Item `GET /api/jobs` / `GET /api/jobs/:id`. */
export type JobSummary = {
  id: string
  hostId: string
  host: { mac: string; hostname: string | null } | null
  type: "install"
  osImageId: string
  status: JobStatus
  stages: JobStage[]
  failureReason: FailureReason | null
  installerBoots: number
  createdAt: string
  updatedAt: string
  finishedAt: string | null
  eventCount: number
}

export type JobsResponse = {
  jobs: JobSummary[]
  nextBefore: string | null
  serverTime: string
}

export type JobEventLevel = "info" | "warn" | "error"

/** Event log job (`event: log` SSE / mode JSON). */
export type JobLogEvent = {
  seq: number
  at: string
  kind: "stage" | "system" | "installer"
  level: JobEventLevel
  /** install|boot-script|config-fetch|callback|watchdog|installer|operator */
  source: string
  message: string
  repeat: number
  /** CR-5-7: waktu kemunculan terakhir event gabungan (= `at` bila `repeat` 1). */
  lastAt: string
}

export type JobLogResponse = {
  events: JobLogEvent[]
  lastSeq: number
  final: boolean
}

/** Ringkasan job terbaru host (M5, `GET /api/hosts`). */
export type HostLastJob = {
  id: string
  status: JobStatus
  failureReason: FailureReason | null
  createdAt: string
}

/** Host di respons API M5 (+ ringkasan job terbaru; null bila belum pernah punya job). */
export type HostWithJob = Host & { lastJob?: HostLastJob | null }

// ---- Library (M5) ----

/** Path media relatif `PXE_MEDIA_ROOT`. */
export type OsImageSource = { kernel: string; initrd: string; repo: string }

/** Item `GET /api/os-images`. */
export type OsImageInfo = OsImage & {
  bootable: boolean
  available: boolean
  /** Alasan tidak tersedia (null bila tersedia). */
  reason: string | null
  builtin: boolean
  /** Path media relatif PXE_MEDIA_ROOT (UI OS Images). */
  source: OsImageSource
  /** `${PXE_MEDIA_URL}/${source.repo}`. */
  repoUrl: string
  /** Jumlah host yang mereferensikan image (assigned, config, job aktif). */
  usedBy: number
  createdAt: string
}

/** Item `GET /api/ssh-keys` (M5): key + jumlah host pemakai. */
export type SshKeyInfo = SshKey & { usedBy: number }

export type HostsResponse = {
  /** M5: `lastJob` selalu ada di respons API (null bila host belum pernah punya job). */
  hosts: HostWithJob[]
  serverTime: string
}
