import { HugeiconsIcon } from "@hugeicons/react"
import { InformationCircleIcon, ServerStack01Icon } from "@hugeicons/core-free-icons"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Kerangka halaman login (plan §2.8, AC-6.30): kanvas krem penuh tanpa sidebar/top bar; nama
 * produk 17/600 di atas card; card putih hairline 1px radius 12 TANPA shadow (elemen biasa
 * ber-`border`, bukan `Card` yang memakai `ring`/box-shadow), lebar maks 400, padding 32 (24 di
 * layar sempit). Judul "Masuk" 26/400 −0.325 px; deskripsi caption 13 px.
 */
export function LoginCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 py-10 sm:px-6">
      <div className="flex items-center gap-2.5" data-testid="login-brand">
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background"
        >
          <HugeiconsIcon icon={ServerStack01Icon} strokeWidth={2} className="size-4" />
        </span>
        <span className="type-section-title">PXE Lab</span>
      </div>
      <section
        aria-labelledby="login-title"
        data-testid="login-card"
        className="flex w-full max-w-[400px] flex-col gap-6 rounded-xl border border-border bg-card p-6 sm:p-8"
      >
        <header className="flex flex-col gap-1.5">
          <h1 id="login-title" className="type-page-title text-foreground">
            Masuk
          </h1>
          <p className="type-caption text-muted-foreground">
            Masuk sebagai admin untuk mengelola host PXE dan provisioning OS.
          </p>
        </header>
        {children}
      </section>
    </main>
  )
}

/** Placeholder setinggi form selama bagian dinamis halaman login dimuat (tanpa lompatan layout). */
export function LoginFormFallback() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="flex flex-col gap-5">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-11 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-10 w-full" />
    </div>
  )
}

/**
 * Admin belum dikonfigurasi (non-production): Alert netral berisi langkah konfigurasi. Nama
 * perintah & variabel env mono. Tidak ada kredensial default.
 */
export function AdminNotConfigured() {
  return (
    <Alert data-testid="login-admin-missing">
      <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
      <AlertTitle>Admin belum dikonfigurasi</AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5 text-body">
        <span>
          Buat hash password dengan <span className="type-data text-xs text-foreground">npm run admin:hash</span>{" "}
          (password dibaca dari stdin), lalu isi{" "}
          <span className="type-data text-xs text-foreground">PXE_ADMIN_USERNAME</span> dan{" "}
          <span className="type-data text-xs text-foreground">PXE_ADMIN_PASSWORD_HASH</span> di environment
          server dan restart dashboard.
        </span>
      </AlertDescription>
    </Alert>
  )
}
