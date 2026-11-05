"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon,
  FilterHorizontalIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { STATUS_LABEL } from "@/components/status-pill"
import { OS_IMAGES } from "@/lib/os-images"
import { PROVISION_STATUSES, type ProvisionStatus } from "@/lib/types"

const ALL_OS = "__all"

export function HostsToolbar({
  query,
  onQueryChange,
  statuses,
  onStatusesChange,
  statusCounts,
  os,
  onOsChange,
  onReset,
}: {
  query: string
  onQueryChange: (q: string) => void
  statuses: ProvisionStatus[]
  onStatusesChange: (s: ProvisionStatus[]) => void
  statusCounts: Record<ProvisionStatus, number>
  os: string | null
  onOsChange: (os: string | null) => void
  onReset: () => void
}) {
  const filtered = query !== "" || statuses.length > 0 || os !== null

  function toggleStatus(s: ProvisionStatus, on: boolean) {
    onStatusesChange(on ? [...statuses, s] : statuses.filter((x) => x !== s))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className="h-9 w-full sm:w-80">
        <InputGroupAddon>
          <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Cari MAC, hostname, atau IP"
          aria-label="Cari host"
          className="type-data"
        />
        {query && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              onClick={() => onQueryChange("")}
              aria-label="Hapus pencarian"
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-9">
            <HugeiconsIcon
              icon={FilterHorizontalIcon}
              strokeWidth={2}
              data-icon="inline-start"
            />
            Status
            {statuses.length > 0 && (
              <span className="type-data rounded-full bg-secondary px-1.5 text-xs">
                {statuses.length}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Filter status</DropdownMenuLabel>
          <DropdownMenuGroup>
            {PROVISION_STATUSES.map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={statuses.includes(s)}
                onCheckedChange={(on) => toggleStatus(s, on === true)}
                onSelect={(e) => e.preventDefault()}
              >
                <span className="flex-1">{STATUS_LABEL[s]}</span>
                <span className="type-data text-xs text-muted-foreground">
                  {statusCounts[s]}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
          {statuses.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => onStatusesChange([])}>
                  Hapus filter status
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Select
        value={os ?? ALL_OS}
        onValueChange={(v) => onOsChange(v === ALL_OS ? null : v)}
      >
        <SelectTrigger
          size="sm"
          className="min-w-44 data-[size=sm]:h-9"
          aria-label="Filter OS"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ALL_OS}>Semua OS</SelectItem>
            <SelectItem value="none">Belum ada OS</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            {OS_IMAGES.map((img) => (
              <SelectItem key={img.id} value={img.id}>
                {img.name} {img.version}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {filtered && (
        <Button variant="ghost" className="h-9" onClick={onReset}>
          Reset
        </Button>
      )}
    </div>
  )
}
