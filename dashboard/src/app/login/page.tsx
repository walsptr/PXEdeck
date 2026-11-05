import type { Metadata } from "next"
import { Suspense } from "react"

import { LoginForm } from "./login-form"

export const metadata: Metadata = { title: "Masuk" }

// PLACEHOLDER backend-dev (M6-T2): form minimal agar redirect/login berfungsi. Halaman login sesuai
// design system (M6-T8, `components/auth/**`) menggantikan file ini.
export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  )
}
