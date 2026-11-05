import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import type { ProvisionStatus } from "@/lib/types"

export { PROVISION_STATUSES } from "@/lib/types"

export const STATUS_LABEL: Record<ProvisionStatus, string> = {
  discovered: "Discovered",
  booting: "Booting",
  installing: "Installing",
  configuring: "Configuring",
  done: "Done",
  failed: "Failed",
  offline: "Offline",
}

// Pastel tahap provisioning hanya dipakai di sini (status pill / timeline).
const STATUS_CLASS: Record<ProvisionStatus, string> = {
  discovered: "bg-stage-discovered text-foreground",
  booting: "bg-stage-booting text-foreground",
  installing: "bg-stage-installing text-foreground",
  configuring: "bg-stage-configuring text-foreground",
  done: "bg-stage-done text-white",
  failed: "bg-destructive text-white",
  // M6 (DEC-017 §9): label status tidak boleh `muted` — muted di atas surface-strong hanya 3,26:1;
  // `body` ≈ 5,6:1. Tetap abu (SPEC "Offline abu").
  offline: "bg-secondary text-body",
}

export function StatusPill({
  status,
  className,
}: {
  status: ProvisionStatus
  className?: string
}) {
  return (
    <Badge
      data-status={status}
      className={cn("h-6 px-2.5 font-medium", STATUS_CLASS[status], className)}
    >
      {STATUS_LABEL[status]}
    </Badge>
  )
}
