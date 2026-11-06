"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Logout01Icon } from "@hugeicons/core-free-icons"

import { Spinner } from "@/components/ui/spinner"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { logout, useSession } from "@/hooks/use-session"
import { LOGIN_PATH } from "@/lib/auth-next"

/**
 * Identitas + logout di footer sidebar (M6-T8, plan §2.8): username admin (mono 13 px, muted) dan
 * tombol tertiary "Keluar" (ikon + teks 14/500). Mode sidebar ikon: hanya tombol ikon ber-tooltip
 * (label aksesibel tetap "Keluar"). Logout → cache query dibersihkan lalu navigasi dokumen ke
 * `/login` (Back tidak menampilkan data lama: halaman dashboard di-render ulang server → redirect).
 */
export function SidebarAccount({
  navigate = (href: string) => window.location.replace(href),
}: {
  navigate?: (href: string) => void
}) {
  const session = useSession()
  const qc = useQueryClient()
  const [busy, setBusy] = React.useState(false)

  async function onLogout() {
    if (busy) return
    setBusy(true)
    const r = await logout()
    if (!r.ok) {
      setBusy(false)
      toast.error("Gagal keluar", { description: r.message })
      return
    }
    await qc.cancelQueries()
    qc.clear()
    navigate(LOGIN_PATH)
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem className="flex flex-col gap-1">
        <span
          className="type-data truncate px-2 text-muted-foreground group-data-[collapsible=icon]:hidden"
          data-testid="sidebar-username"
          title={session.data?.username}
        >
          {session.data ? (
            <>
              <span className="sr-only">Masuk sebagai </span>
              {session.data.username}
            </>
          ) : (
            " "
          )}
        </span>
        <SidebarMenuButton
          type="button"
          tooltip="Keluar"
          onClick={onLogout}
          disabled={busy}
          data-testid="logout"
          className="font-medium"
        >
          {busy ? <Spinner /> : <HugeiconsIcon icon={Logout01Icon} strokeWidth={2} />}
          <span>Keluar</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
