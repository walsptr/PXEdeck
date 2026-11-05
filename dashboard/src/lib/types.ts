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

export type HostsResponse = {
  hosts: Host[]
  serverTime: string
}
