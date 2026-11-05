// Status layanan PXE nyata (M4-T6, CR-1-7). Tanpa operasi jaringan: hanya
// pidfile dnsmasq + keberadaan file, sehingga aman (dan cepat) di host dev.
//  - DHCP: pid di PXE_DNSMASQ_PIDFILE hidup (`process.kill(pid, 0)`; EPERM =
//    hidup, milik user lain) → online; pidfile basi/rusak → offline;
//    PXE_DNSMASQ_PIDFILE kosong → unknown.
//  - TFTP: dnsmasq hidup + `snponly.efi` & `undionly.kpxe` ada di
//    PXE_TFTP_ROOT → online; salah satu tidak → offline; pidfile kosong →
//    unknown.
//  - HTTP: handler ini menjawab; PXE_MEDIA_ROOT terbaca → online; tidak ada
//    (host dev) → unknown; ada tapi tidak terbaca → offline.
import { accessSync, constants, existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { getSettings, type Settings } from "@/lib/server/settings"

export type ServiceState = "online" | "offline" | "unknown"

export type ServiceStatusInfo = {
  name: "DHCP" | "TFTP" | "HTTP"
  state: ServiceState
  /** Kompatibel komponen M1 (`online` boolean). unknown → false. */
  online: boolean
  detail: string
}

export type ServerStatusResponse = {
  services: ServiceStatusInfo[]
  checkedAt: string
}

export const TFTP_FILES = ["snponly.efi", "undionly.kpxe"] as const

export type StatusProbe = {
  readFile: (p: string) => string
  exists: (p: string) => boolean
  readable: (p: string) => boolean
  /** true bila proses `pid` hidup. */
  alive: (pid: number) => boolean
}

export const realProbe: StatusProbe = {
  readFile: (p) => readFileSync(p, "utf8"),
  exists: existsSync,
  readable: (p) => {
    try {
      accessSync(p, constants.R_OK)
      return true
    } catch {
      return false
    }
  },
  alive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM"
    }
  },
}

/** State dnsmasq dari pidfile (fungsi murni terhadap `probe`). */
export function dnsmasqState(pidfile: string | null, probe: StatusProbe): ServiceState {
  if (!pidfile) return "unknown"
  let raw: string
  try {
    raw = probe.readFile(pidfile).trim()
  } catch {
    return "offline"
  }
  if (!/^\d{1,10}$/.test(raw)) return "offline"
  const pid = Number(raw)
  if (pid <= 1) return "offline"
  return probe.alive(pid) ? "online" : "offline"
}

export function computeServerStatus(
  s: Settings,
  probe: StatusProbe = realProbe,
  now: Date = new Date(),
): ServerStatusResponse {
  const dhcp = dnsmasqState(s.dnsmasqPidfile, probe)
  const missing = TFTP_FILES.filter((f) => !probe.exists(path.join(s.tftpRoot, f)))
  const tftp: ServiceState = dhcp !== "online" ? dhcp : missing.length ? "offline" : "online"
  const http: ServiceState = !probe.exists(s.mediaRoot)
    ? "unknown"
    : probe.readable(s.mediaRoot)
      ? "online"
      : "offline"
  const svc = (name: ServiceStatusInfo["name"], state: ServiceState, detail: string): ServiceStatusInfo => ({
    name,
    state,
    online: state === "online",
    detail,
  })
  return {
    services: [
      svc(
        "DHCP",
        dhcp,
        dhcp === "unknown"
          ? "dnsmasq · pidfile tidak dikonfigurasi"
          : `dnsmasq · ${s.dhcpInterface}:67/udp`,
      ),
      svc(
        "TFTP",
        tftp,
        tftp === "unknown"
          ? "dnsmasq · pidfile tidak dikonfigurasi"
          : missing.length && dhcp === "online"
            ? `file hilang di ${s.tftpRoot}: ${missing.join(", ")}`
            : `dnsmasq · ${s.network.pxeServer}:69/udp`,
      ),
      svc(
        "HTTP",
        http,
        http === "unknown" ? `media ${s.mediaRoot} tidak ada` : `${s.baseUrl} · media ${s.mediaRoot}`,
      ),
    ],
    checkedAt: now.toISOString(),
  }
}

export function getServerStatus(): ServerStatusResponse {
  return computeServerStatus(getSettings())
}
