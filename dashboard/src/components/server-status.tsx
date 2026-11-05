"use client"

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

const STATE_DOT: Record<ServiceState, string> = {
  online: "bg-success",
  offline: "bg-destructive",
  unknown: "bg-muted-soft",
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
                className="h-6 gap-1.5 bg-card px-2 sm:px-2.5"
              >
                <span
                  aria-hidden
                  data-slot="status-dot"
                  className={cn("size-1.5 rounded-full", STATE_DOT[state])}
                />
                <span className="type-data sr-only text-[11px] font-medium sm:not-sr-only">
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
