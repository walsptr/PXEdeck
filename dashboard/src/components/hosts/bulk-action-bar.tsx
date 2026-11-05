"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon,
  ComputerIcon,
  DiscIcon,
  Key01Icon,
  RouterIcon,
  UserIcon,
} from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { BulkAction } from "@/components/hosts/host-actions"

const SECONDARY: {
  action: BulkAction
  label: string
  icon: typeof UserIcon
}[] = [
  { action: "credentials", label: "Set Credentials", icon: UserIcon },
  { action: "hostname", label: "Set Hostname", icon: ComputerIcon },
  { action: "ip", label: "Set IP", icon: RouterIcon },
  { action: "ssh", label: "Inject SSH Key", icon: Key01Icon },
]

export function BulkActionBar({
  count,
  hiddenCount,
  onAction,
  onClear,
}: {
  count: number
  /** Host terpilih yang sedang tidak terlihat karena filter/pencarian. */
  hiddenCount: number
  onAction: (action: BulkAction) => void
  onClear: () => void
}) {
  if (count === 0) return null

  return (
    <div className="pointer-events-none sticky bottom-6 z-20 flex justify-center">
      <div
        role="toolbar"
        aria-label="Aksi untuk host terpilih"
        className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-xl border border-hairline-strong bg-card p-2 animate-in fade-in slide-in-from-bottom-2"
      >
        <span className="type-body px-2 font-medium whitespace-nowrap">
          <span className="type-data">{count}</span> host dipilih
          {hiddenCount > 0 && (
            <span className="type-caption font-normal text-muted-foreground">
              {" "}
              ({hiddenCount} tersembunyi oleh filter)
            </span>
          )}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClear}
          aria-label="Batalkan pilihan"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
        <Separator
          orientation="vertical"
          className="data-[orientation=vertical]:h-6"
        />
        {SECONDARY.map((b) => (
          <Button
            key={b.action}
            variant="outline"
            size="sm"
            onClick={() => onAction(b.action)}
          >
            <HugeiconsIcon
              icon={b.icon}
              strokeWidth={2}
              data-icon="inline-start"
            />
            {b.label}
          </Button>
        ))}
        <Button size="sm" onClick={() => onAction("install")}>
          <HugeiconsIcon
            icon={DiscIcon}
            strokeWidth={2}
            data-icon="inline-start"
          />
          Install OS
        </Button>
      </div>
    </div>
  )
}
