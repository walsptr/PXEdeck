import { Skeleton } from "@/components/ui/skeleton"

/**
 * OBS-M6-L1: kerangka shell dashboard selama sesi divalidasi di server (`SessionGate`, Suspense).
 * Hanya bentuk statis (sidebar krem + top bar 64 px + area konten) tanpa data apa pun, jadi tidak
 * membocorkan konten terproteksi; menggantikan layar kosong ±300 ms pada muat penuh.
 */
export function DashboardShellFallback() {
  return (
    <div className="flex min-h-svh w-full" aria-busy="true" data-testid="shell-fallback">
      <div aria-hidden className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
      <div aria-hidden className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4 md:px-8">
          <Skeleton className="h-7 w-40" />
        </div>
        <div className="flex flex-col gap-6 p-6 md:p-8">
          <Skeleton className="h-10 w-full max-w-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
      <span className="sr-only">Memuat dashboard…</span>
    </div>
  )
}
