"use client"

import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type ServiceStatus = {
  name: "DHCP" | "TFTP" | "HTTP"
  online: boolean
  detail: string
}

// Tahap 1: data statis. Tahap 4 diganti dengan GET /api/server/status.
const MOCK_STATUS: ServiceStatus[] = [
  { name: "DHCP", online: true, detail: "dnsmasq · enp7s0:67/udp" },
  { name: "TFTP", online: true, detail: "dnsmasq · 10.10.10.1:69/udp" },
  { name: "HTTP", online: true, detail: "apache2 · :80 /pxe/" },
]

export function ServerStatus({
  services = MOCK_STATUS,
}: {
  services?: ServiceStatus[]
}) {
  return (
    <div className="flex items-center gap-1.5">
      {services.map((s) => (
        <Tooltip key={s.name}>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="h-6 gap-1.5 bg-card px-2 sm:px-2.5">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  s.online ? "bg-success" : "bg-destructive",
                )}
              />
              <span className="type-data hidden text-[11px] font-medium sm:inline">
                {s.name}
              </span>
              <span className="sr-only">{s.online ? "online" : "offline"}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {s.name} {s.online ? "online" : "offline"} — {s.detail}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}
