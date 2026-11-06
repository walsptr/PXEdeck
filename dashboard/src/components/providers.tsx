"use client"

import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { toast } from "sonner"

import { TooltipProvider } from "@/components/ui/tooltip"
import { loginHref, LOGIN_PATH } from "@/lib/auth-next"
import { defaultQueryRetry, RATE_LIMITED_MESSAGE, setApiListener } from "@/lib/api-client"

/** id toast rate limit — sonner mengganti toast ber-id sama (tidak menumpuk). */
export const RATE_LIMIT_TOAST_ID = "api-rate-limit"

/** Navigasi dokumen penuh (dapat diganti di test). */
export type Navigate = (href: string) => void

const replaceLocation: Navigate = (href) => window.location.replace(href)

/**
 * Pasang penanganan global 401/429 dari `apiFetch` (M6-T8, plan §2.8 "Sesi habis"):
 *  - 401 → hentikan semua query (cancel + bersihkan cache: tidak ada data lama yang tersisa di
 *    memori), lalu SEKALI pindah ke `/login?next=<path+query saat ini>` dengan navigasi dokumen
 *    (`location.replace`: state klien, polling, dan SSE ikut berakhir; Back tidak kembali ke
 *    halaman berdata). Di halaman `/login` sendiri tidak ada redirect.
 *  - 429 → satu toast "Terlalu banyak request" (id tetap, tidak menumpuk); `apiFetch` menahan
 *    request sampai `Retry-After` lewat.
 */
export function useApiSessionHandling(client: QueryClient, navigate: Navigate = replaceLocation) {
  React.useEffect(
    () =>
      setApiListener({
        onUnauthorized: () => {
          void client.cancelQueries()
          client.clear()
          const { pathname, search } = window.location
          if (pathname === LOGIN_PATH) return
          navigate(loginHref(`${pathname}${search}`))
        },
        onRateLimited: (sec) => {
          toast.error(RATE_LIMITED_MESSAGE, {
            id: RATE_LIMIT_TOAST_ID,
            description: `Server membatasi request. Pembaruan otomatis dilanjutkan dalam ${sec} detik.`,
          })
        },
      }),
    [client, navigate],
  )
}

/**
 * Halaman dashboard yang dipulihkan dari back/forward cache (Back setelah logout / sesi habis)
 * dimuat ulang dari server: Proxy + layout server memeriksa sesi lagi sehingga data lama di DOM
 * tidak pernah tampil (AC-6.31). `reload` dapat diganti di test.
 */
const reloadPage = () => window.location.reload()

export function useReloadOnBfcacheRestore(reload: () => void = reloadPage) {
  React.useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) reload()
    }
    window.addEventListener("pageshow", onShow)
    return () => window.removeEventListener("pageshow", onShow)
  }, [reload])
}

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // M6: 401/429 tidak di-retry (sesi habis / rate limit ditangani global).
      queries: { staleTime: 2_000, refetchOnWindowFocus: true, retry: defaultQueryRetry },
    },
  })
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(makeQueryClient)
  useApiSessionHandling(client)
  useReloadOnBfcacheRestore()

  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </QueryClientProvider>
  )
}
