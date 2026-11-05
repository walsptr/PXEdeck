"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useHosts } from "@/hooks/use-hosts"
import { JOB_STATUS_LABEL } from "@/lib/jobs"
import { JOB_STATUSES, type JobStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

const ALL = "__all"

export function JobStatusFilter({
  value,
  onChange,
}: {
  value: JobStatus | null
  onChange: (v: JobStatus | null) => void
}) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => onChange(v === ALL ? null : (v as JobStatus))}
    >
      <SelectTrigger
        size="sm"
        className="min-w-40 data-[size=sm]:h-9"
        aria-label="Filter status job"
        data-testid="jobs-status-filter"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={ALL}>Semua status</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          {JOB_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {JOB_STATUS_LABEL[s]}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/** Combobox host (hostname/MAC mono) untuk filter `?host=`. */
export function JobHostFilter({
  value,
  onChange,
}: {
  value: string | null
  onChange: (hostId: string | null) => void
}) {
  const [open, setOpen] = React.useState(false)
  const { data } = useHosts()
  const hosts = data?.hosts ?? []
  const current = hosts.find((h) => h.id === value)

  function pick(id: string | null) {
    setOpen(false)
    onChange(id)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Filter host"
          data-testid="jobs-host-filter"
          className="h-9 min-w-52 justify-between"
        >
          {value ? (
            <span className="type-data truncate">
              {current ? (current.hostname ?? current.mac) : value}
            </span>
          ) : (
            <span>Semua host</span>
          )}
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Cari hostname atau MAC…" />
          <CommandList>
            <CommandEmpty>Host tidak ditemukan.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__all semua host" onSelect={() => pick(null)}>
                Semua host
                <HugeiconsIcon
                  icon={Tick02Icon}
                  strokeWidth={2}
                  className={cn("ml-auto", value ? "invisible" : undefined)}
                />
              </CommandItem>
              {hosts.map((h) => (
                <CommandItem
                  key={h.id}
                  value={[h.mac, h.hostname, h.id].filter(Boolean).join(" ")}
                  onSelect={() => pick(h.id)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="type-data truncate">{h.hostname ?? h.mac}</span>
                    {h.hostname && (
                      <span className="type-data truncate text-xs text-muted-foreground">
                        {h.mac}
                      </span>
                    )}
                  </span>
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    strokeWidth={2}
                    className={cn("ml-auto", h.id === value ? undefined : "invisible")}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
