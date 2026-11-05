"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Upload01Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/hooks/use-host-config"
import { apiErrorMessage, useCreateSshKey } from "@/hooks/use-ssh-keys"
import { parseSshKey, sshFingerprint } from "@/lib/ssh-key"

/** Batas ukuran file `.pub` (sama dengan batas server `publicKey` 16 KB). */
const MAX_FILE = 16_384

/**
 * Parse sinkron + fingerprint lewat react-query. Query key memakai blob yang sudah lolos parse —
 * teks mentah (bisa private key yang salah tempel) tidak masuk cache (CR-3-5).
 */
function useKeyPreview(publicKey: string) {
  const parsed = React.useMemo(
    () => (publicKey.trim() ? parseSshKey(publicKey) : null),
    [publicKey],
  )
  const ok = parsed && !("error" in parsed) ? parsed : null
  const fp = useQuery({
    queryKey: ["ssh-key-fp", ok?.type, ok?.normalized.split(" ")[1]],
    queryFn: () => sshFingerprint(ok!.blob),
    enabled: ok !== null,
    staleTime: Infinity,
  })
  return { parsed, ok, fingerprint: fp.data }
}

export function AddKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {open && <AddKeyForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function AddKeyForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = React.useState("")
  const [publicKey, setPublicKey] = React.useState("")
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [nameError, setNameError] = React.useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const create = useCreateSshKey()
  const { parsed, ok, fingerprint } = useKeyPreview(publicKey)
  const keyError = parsed && "error" in parsed ? parsed.error : null

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    setFileError(null)
    setServerError(null)
    if (!file) return
    if (file.size > MAX_FILE) {
      setFileError("File terlalu besar untuk public key (maks 16 KB)")
      return
    }
    setPublicKey((await file.text()).trim())
    if (!name.trim()) setName(file.name.replace(/\.pub$/, "").slice(0, 64))
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    setNameError(null)
    const finalName = name.trim() || ok?.comment.slice(0, 64) || ""
    create.mutate(
      { name: finalName, publicKey: publicKey.trim() },
      {
        onSuccess: (key) => {
          toast.success(
            <span>
              Key “{key.name}” ditambahkan
            </span>,
          )
          onDone()
        },
        onError: (err) => {
          const nameIssue =
            err instanceof ApiError &&
            err.status === 400 &&
            err.errors[0]?.message.startsWith("name")
          if (nameIssue) setNameError(apiErrorMessage(err))
          else setServerError(apiErrorMessage(err))
        },
      },
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <DialogHeader>
        <DialogTitle className="type-section-title font-semibold">Tambah SSH key</DialogTitle>
        <DialogDescription>
          Tempel atau unggah public key OpenSSH (<span className="type-data text-xs">.pub</span>):
          ssh-ed25519, ssh-rsa, atau ecdsa-sha2-nistp*. Jangan pernah menempel private key.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={Boolean(nameError) || undefined}>
          <FieldLabel htmlFor="key-new-name">Nama</FieldLabel>
          <Input
            id="key-new-name"
            value={name}
            maxLength={64}
            aria-invalid={Boolean(nameError) || undefined}
            onChange={(e) => {
              setName(e.target.value)
              setNameError(null)
            }}
            placeholder={ok?.comment || "laptop-ops"}
            autoComplete="off"
          />
          <FieldDescription>Kosong → memakai komentar key.</FieldDescription>
          <FieldError data-testid="key-new-name-error">{nameError}</FieldError>
        </Field>
        <Field data-invalid={Boolean(keyError || fileError || serverError) || undefined}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="key-new-public">Public key</FieldLabel>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <HugeiconsIcon icon={Upload01Icon} strokeWidth={2} data-icon="inline-start" />
              Unggah .pub
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".pub,text/plain"
              className="sr-only"
              tabIndex={-1}
              aria-label="Unggah file public key"
              data-testid="key-new-file"
              onChange={onFile}
            />
          </div>
          <Textarea
            id="key-new-public"
            value={publicKey}
            onChange={(e) => {
              setPublicKey(e.target.value)
              setServerError(null)
            }}
            rows={4}
            spellCheck={false}
            placeholder="ssh-ed25519 AAAA… user@host"
            aria-invalid={Boolean(keyError || fileError || serverError) || undefined}
            className="font-mono text-xs break-all"
          />
          {ok && (
            <dl
              className="type-caption grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-muted-foreground"
              data-testid="key-new-preview"
            >
              <dt>Tipe</dt>
              <dd className="type-data text-xs text-foreground">{ok.type}</dd>
              <dt>Fingerprint</dt>
              <dd className="type-data text-xs break-all text-foreground" data-testid="key-new-fingerprint">
                {fingerprint ?? "…"}
              </dd>
              {ok.comment && (
                <>
                  <dt>Komentar</dt>
                  <dd className="type-data text-xs text-foreground">{ok.comment}</dd>
                </>
              )}
            </dl>
          )}
          <FieldError data-testid="key-new-error">
            {fileError ?? keyError ?? serverError}
          </FieldError>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={create.isPending}>
          Batal
        </Button>
        <Button
          type="submit"
          disabled={create.isPending || !ok}
          data-testid="key-new-submit"
        >
          {create.isPending && <Spinner data-icon="inline-start" />}
          Tambah key
        </Button>
      </DialogFooter>
    </form>
  )
}
