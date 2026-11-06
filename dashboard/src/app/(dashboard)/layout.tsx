import { Suspense } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { DashboardShellFallback } from "@/components/dashboard-shell-fallback"
import { TopBar } from "@/components/top-bar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

import { SessionGate } from "./session-gate"

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // M6: seluruh shell dashboard dirender hanya setelah sesi tervalidasi di server (SessionGate,
    // di dalam Suspense karena membaca cookie — Cache Components). Tanpa flash konten terproteksi;
    // OBS-M6-L1: fallback = kerangka statis tanpa data (bukan layar kosong).
    <Suspense fallback={<DashboardShellFallback />}>
      <SessionGate>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset className="min-w-0">
            <TopBar />
            {/* SidebarInset sudah me-render <main>; konten cukup <div> agar hanya ada satu landmark (CR-1-2). */}
            <div
              data-slot="page-content"
              className="flex min-w-0 flex-1 flex-col gap-6 p-6 md:p-8"
            >
              {children}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </SessionGate>
    </Suspense>
  )
}
