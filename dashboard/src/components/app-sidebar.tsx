"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { ServerStack01Icon } from "@hugeicons/core-free-icons"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { NAV_ITEMS, navItemFor } from "@/lib/nav"

export function AppSidebar() {
  const pathname = usePathname()
  const active = navItemFor(pathname)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/hosts">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-foreground text-background">
                  <HugeiconsIcon icon={ServerStack01Icon} strokeWidth={2} />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="font-semibold tracking-tight">PXE Lab</span>
                  <span className="type-data text-xs text-muted-foreground">
                    10.10.10.1
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Navigasi utama">
              <SidebarMenu>
                {NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active?.href === item.href}
                      tooltip={item.label}
                      className="font-medium"
                    >
                      <Link
                        href={item.href}
                        aria-current={
                          active?.href === item.href ? "page" : undefined
                        }
                      >
                        <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <p className="type-caption truncate px-2 text-muted-foreground group-data-[collapsible=icon]:hidden">
          Ubuntu 24.04.5 · dnsmasq
        </p>
      </SidebarFooter>
    </Sidebar>
  )
}
