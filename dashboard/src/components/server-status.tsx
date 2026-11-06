"use client"

import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  Cancel01Icon,
  HelpCircleIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"

import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useServerStatus, type ServiceState } from "@/hooks/use-server-status"
import { cn } from "@/lib/utils"

export type ServiceStatus = {
  name: "DHCP" | "TFTP" | "HTTP"
  /** Status tiga nilai dari `GET /api/server-status`; bila kosong diturunkan dari `online`. */
  state?: ServiceState
  online: boolean
  detail: string
}

const SERVICE_NAMES = ["DHCP", "TFTP", "HTTP"] as const

const STATE_LABEL: Record<ServiceState, string> = {
  online: "online",
  offline: "offline",
  unknown: "tidak diketahui",
}

/**
 * DR-6-5 (WCAG 1.4.1): state tidak hanya dibedakan warna — tiap state punya glyph sendiri
 * (online = centang di lingkaran terisi, offline = silang di lingkaran terisi, tidak diketahui =
 * tanda tanya bergaris tanpa isi). Warna tetap token status (hijau/merah/netral).
 */
const STATE_DOT: Record<ServiceState, string> = {
  online: "bg-success text-white",
  offline: "bg-destructive text-white",
  unknown: "bg-transparent text-body",
}

const STATE_ICON: Record<ServiceState, IconSvgElement> = {
  online: Tick02Icon,
  offline: Cancel01Icon,
  unknown: HelpCircleIcon,
}

// Nilai default hanya untuk pemakaian presentasional/test (AC-1.11). Top bar memakai
// `LiveServerStatus` yang membaca GET /api/server-status.
const STATIC_STATUS: ServiceStatus[] = SERVICE_NAMES.map((name) => ({
  name,
  online: true,
  detail: "status statis",
}))

export function ServerStatus({
  services = STATIC_STATUS,
  checkedAt,
}: {
  services?: ServiceStatus[]
  checkedAt?: string
}) {
  return (
    <div
      role="group"
      aria-label="Status server PXE"
      className="flex items-center gap-1.5"
    >
      {services.map((s) => {
        const state: ServiceState = s.state ?? (s.online ? "online" : "offline")
        return (
          <Tooltip key={s.name}>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                data-service={s.name}
                data-online={state === "online"}
                data-state={state}
                className="h-6 gap-1 bg-card px-1.5 sm:gap-1.5 sm:px-2.5"
              >
                <span
                  aria-hidden
                  data-slot="status-dot"
                  data-glyph={state}
                  className={cn(
                    "flex size-3.5 shrink-0 items-center justify-center rounded-full",
                    STATE_DOT[state],
                  )}
                >
                  <HugeiconsIcon
                    icon={STATE_ICON[state]}
                    strokeWidth={state === "unknown" ? 2 : 3}
                    className={state === "unknown" ? "size-3.5" : "size-2.5"}
                  />
                </span>
                {/* DR-6-5: nama layanan terlihat di semua lebar (bukan sr-only di < sm). */}
                <span
                  data-slot="service-name"
                  className="type-data text-[11px] font-medium"
                >
                  {s.name}
                </span>
                <span className="sr-only"> {STATE_LABEL[state]}</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="flex flex-col gap-0.5">
              <span>
                {s.name} {STATE_LABEL[state]}
              </span>
              <span className="type-data text-[11px] opacity-80">{s.detail}</span>
              {checkedAt && (
                <span className="text-[11px] opacity-70">
                  Diperiksa {formatTime(checkedAt)}
                </span>
              )}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString("id-ID", { hour12: false })
}

/** Status server nyata (polling `GET /api/server-status`, AC-4.7). */
export function LiveServerStatus() {
  const { data, error, isPending } = useServerStatus()
  const services: ServiceStatus[] = data
    ? data.services
    : SERVICE_NAMES.map((name) => ({
        name,
        state: "unknown",
        online: false,
        detail: isPending
          ? "memeriksa…"
          : `status tidak bisa dibaca: ${error?.message ?? "error"}`,
      }))
  return <ServerStatus services={services} checkedAt={data?.checkedAt} />
}
