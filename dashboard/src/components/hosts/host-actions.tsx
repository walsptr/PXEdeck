"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ComputerTerminal01Icon,
  Delete02Icon,
  DiscIcon,
  Edit02Icon,
  MoreHorizontalIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Host } from "@/lib/types"

export type HostAction = "install" | "edit" | "logs" | "reboot" | "delete"
export type BulkAction = "install" | "credentials" | "hostname" | "ip" | "ssh"

type Ctx = {
  onHostAction: (action: HostAction, host: Host) => void
}

const HostActionsContext = React.createContext<Ctx | null>(null)

export const HostActionsProvider = HostActionsContext.Provider

function useHostActions() {
  const ctx = React.useContext(HostActionsContext)
  if (!ctx) throw new Error("RowActions harus di dalam HostActionsProvider")
  return ctx
}

export function RowActions({ host }: { host: Host }) {
  const { onHostAction } = useHostActions()
  const label = host.hostname ?? host.mac

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Aksi untuk ${label}`}
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => onHostAction("install", host)}>
            <HugeiconsIcon icon={DiscIcon} strokeWidth={2} />
            Install OS
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onHostAction("edit", host)}>
            <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
            Edit konfigurasi
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onHostAction("logs", host)}>
            <HugeiconsIcon icon={ComputerTerminal01Icon} strokeWidth={2} />
            Lihat log
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onHostAction("reboot", host)}>
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
            Reboot ke PXE
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => onHostAction("delete", host)}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            Hapus
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
