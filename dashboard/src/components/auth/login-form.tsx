"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { parseRetryAfter, resetApiState } from "@/lib/api-client"
import { safeNextPath } from "@/lib/auth-next"

export const LOGIN_FAILED_TEXT = "Username atau password salah"
export const NETWORK_ERROR_TEXT =
  "Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi."

/** "Terlalu banyak percobaan. Coba lagi dalam N menit." — N dari `Retry-After` (dibulatkan ke atas). */
export function lockoutText(retryAfterSec: number): string {
  const n = Math.max(1, Math.ceil(retryAfterSec / 60))
  return `Terlalu banyak percobaan. Coba lagi dalam ${n} menit.`
}

/**
 * Pesan error login dari respons server. 401 → teks seragam (tanpa membedakan username ada/tidak);
 * 429 → lockout dengan N menit; lainnya → pesan server bila ada.
 */
export async function loginErrorText(res: Response): Promise<string> {
  if (res.status === 401) return LOGIN_FAILED_TEXT
  if (res.status === 429) return lockoutText(parseRetryAfter(res.headers.get("retry-after")))
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === "string" && body.error
    ? body.error
    : `Login gagal (${res.status})`
}

/**
 * Form login admin (M6-T8, plan §2.8). Username mono (konsisten dengan tab Credentials),
 * password dengan tombol tampilkan/sembunyikan, tombol "Masuk" primary satu-satunya elemen oranye.
 * Error → Alert `role=alert` yang menerima fokus. Sukses → `next` yang disanitasi (`/hosts`).
 */
export function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = React.useState<{ text: string; n: number } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [show, setShow] = React.useState(false)
  const alertRef = React.useRef<HTMLDivElement>(null)

  // Fokus ke Alert setiap kali error (juga bila teksnya sama dengan sebelumnya — `n` berubah).
  React.useEffect(() => {
    if (error) alertRef.current?.focus()
  }, [error])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    const f = new FormData(e.currentTarget)
    setBusy(true)
    let text: string | null = null
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          username: String(f.get("username") ?? ""),
          password: String(f.get("password") ?? ""),
        }),
      })
      if (res.status === 204) {
        resetApiState()
        // Tetap "busy" sampai navigasi selesai (komponen dilepas).
        router.replace(safeNextPath(params.get("next")))
        return
      }
      text = await loginErrorText(res)
    } catch {
      text = NETWORK_ERROR_TEXT
    }
    setBusy(false)
    setError((prev) => ({ text: text!, n: (prev?.n ?? 0) + 1 }))
  }

  return (
    <form onSubmit={onSubmit} aria-labelledby="login-title" className="flex flex-col gap-6">
      {error && (
        <Alert
          ref={alertRef}
          variant="destructive"
          role="alert"
          tabIndex={-1}
          data-testid="login-error"
          className="outline-none focus-visible:ring-[3px] focus-visible:ring-destructive/20"
        >
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          <AlertTitle>Gagal masuk</AlertTitle>
          <AlertDescription>{error.text}</AlertDescription>
        </Alert>
      )}
      <FieldGroup className="gap-5">
        <Field>
          <FieldLabel htmlFor="login-username">Username</FieldLabel>
          <Input
            id="login-username"
            name="username"
            className="type-data"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={64}
            required
            autoFocus
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="login-password">Password</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="login-password"
              name="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={256}
              required
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-sm"
                aria-label={show ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                aria-controls="login-password"
                onClick={() => setShow((s) => !s)}
              >
                <HugeiconsIcon icon={show ? ViewOffIcon : ViewIcon} strokeWidth={2} />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      </FieldGroup>
      <Button type="submit" className="w-full" disabled={busy} data-testid="login-submit">
        {busy && <Spinner data-icon="inline-start" aria-label="Memproses" />}
        Masuk
      </Button>
    </form>
  )
}
