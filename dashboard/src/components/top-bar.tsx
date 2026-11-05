"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Search01Icon } from "@hugeicons/core-free-icons"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { LiveServerStatus } from "@/components/server-status"
import { StatusPill } from "@/components/status-pill"
import { useHosts } from "@/hooks/use-hosts"
import { NAV_ITEMS, navItemFor } from "@/lib/nav"

export function TopBar() {
  const pathname = usePathname()
  const router = useRouter()
  const current = navItemFor(pathname)
  const [open, setOpen] = React.useState(false)
  const { data } = useHosts({ enabled: open })
  const hosts = data?.hosts ?? []

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:px-8">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="data-[orientation=vertical]:h-5"
      />
      <h1 className="type-page-title truncate">
        {current?.label ??
          (pathname === "/design" ? "Design tokens" : "Dashboard")}
      </h1>

      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-keyshortcuts="Control+K Meta+K"
          className="hidden h-9 w-64 items-center gap-2 rounded-lg border border-border bg-card px-3 text-left text-sm text-muted-soft transition-colors hover:border-hairline-strong md:flex"
        >
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="size-4 text-muted-foreground"
          />
          <span className="flex-1 truncate">Cari MAC, hostname, IP…</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        <LiveServerStatus />
      </div>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Pencarian global"
        description="Cari host atau buka halaman"
      >
        <Command>
          <CommandInput placeholder="Cari MAC, hostname, IP, atau halaman…" />
          <CommandList>
            <CommandEmpty>Tidak ada hasil.</CommandEmpty>
            {hosts.length > 0 && (
              <CommandGroup heading="Host">
                {hosts.map((h) => (
                  <CommandItem
                    key={h.id}
                    value={[h.mac, h.hostname, h.currentIp, h.mgmtIp]
                      .filter(Boolean)
                      .join(" ")}
                    onSelect={() => {
                      setOpen(false)
                      router.push(`/hosts?q=${encodeURIComponent(h.mac)}`)
                    }}
                  >
                    <span className="type-data">{h.mac}</span>
                    <span className="type-data truncate text-muted-foreground">
                      {h.hostname ?? h.currentIp ?? ""}
                    </span>
                    <StatusPill status={h.status} className="ml-auto h-5" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading="Halaman">
              {NAV_ITEMS.map((item) => (
                <CommandItem
                  key={item.href}
                  value={item.label}
                  onSelect={() => {
                    setOpen(false)
                    router.push(item.href)
                  }}
                >
                  <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </header>
  )
}
