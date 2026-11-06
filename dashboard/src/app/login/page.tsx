import type { Metadata } from "next"
import { Suspense } from "react"

import { LoginCard, LoginFormFallback } from "@/components/auth/login-card"

import { LoginGate } from "./login-gate"

export const metadata: Metadata = { title: "Masuk" }

/**
 * Halaman login (M6-T8, plan §2.8): di luar route group `(dashboard)` → tanpa sidebar/top bar.
 * Shell (nama produk + card) statis; bagian yang membaca request (cookie sesi, env admin, `next`)
 * di dalam Suspense (Cache Components).
 */
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <LoginCard>
      <Suspense fallback={<LoginFormFallback />}>
        <LoginGate searchParams={searchParams} />
      </Suspense>
    </LoginCard>
  )
}
