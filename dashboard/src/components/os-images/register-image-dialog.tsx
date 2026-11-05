"use client"

import * as React from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon } from "@hugeicons/core-free-icons"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import {
  osImageFieldErrors,
  useCreateOsImage,
  type NewOsImagePayload,
  type OsImageField,
} from "@/hooks/use-os-images"
import { useSettings } from "@/hooks/use-settings"
import type { InstallMethod } from "@/lib/os-images"

type Hint = { kernel: string; initrd: string; repo: string }

const METHODS: { value: InstallMethod; label: string; hint: Hint }[] = [
  {
    value: "autoinstall",
    label: "autoinstall (Ubuntu)",
    hint: { kernel: "ubuntu-24.04/casper/vmlinuz", initrd: "ubuntu-24.04/casper/initrd", repo: "ubuntu-24.04" },
  },
  {
    value: "preseed",
    label: "preseed (Debian)",
    hint: { kernel: "debian-netboot/linux", initrd: "debian-netboot/initrd.gz", repo: "debian-12" },
  },
  {
    value: "kickstart",
    label: "kickstart (RHEL/Rocky)",
    hint: { kernel: "rocky-9/images/pxeboot/vmlinuz", initrd: "rocky-9/images/pxeboot/initrd.img", repo: "rocky-9" },
  },
  {
    value: "unattend",
    label: "unattend (Windows)",
    hint: { kernel: "kosong (tidak bootable)", initrd: "kosong (tidak bootable)", repo: "windows-2022" },
  },
]

type Form = {
  id: string
  name: string
  version: string
  arch: "amd64" | "arm64"
  method: InstallMethod
  bootable: boolean
  kernel: string
  initrd: string
  repo: string
}

const INITIAL: Form = {
  id: "",
  name: "",
  version: "",
  arch: "amd64",
  method: "autoinstall",
  bootable: true,
  kernel: "",
  initrd: "",
  repo: "",
}

function toPayload(f: Form): NewOsImagePayload {
  return {
    id: f.id.trim(),
    name: f.name.trim(),
    version: f.version.trim(),
    arch: f.arch,
    method: f.method,
    bootable: f.bootable,
    source: { kernel: f.kernel.trim(), initrd: f.initrd.trim(), repo: f.repo.trim() },
  }
}

type Errors = Partial<Record<OsImageField | "form", string[]>>

/**
 * Dialog "Daftarkan image" (DEC-015 §3: path media lokal relatif `PXE_MEDIA_ROOT`, tanpa unduh
 * URL). Validasi di server; error 400/409 ditampilkan per field.
 */
export function RegisterImageDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        {open && <RegisterForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function RegisterForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = React.useState<Form>(INITIAL)
  const [errors, setErrors] = React.useState<Errors>({})
  const create = useCreateOsImage()
  const mediaUrl = useSettings().data?.mediaUrl
  const method = METHODS.find((m) => m.value === form.method)!

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    create.mutate(toPayload(form), {
      onSuccess: (img) => {
        toast.success(
          <span>
            OS image <span className="type-data">{img.id}</span> didaftarkan
          </span>,
        )
        onDone()
      },
      onError: (err) => setErrors(osImageFieldErrors(err)),
    })
  }

  const err = (k: OsImageField) => errors[k]?.map((message) => ({ message }))
  const invalid = (k: OsImageField) => Boolean(errors[k]?.length)

  const text = (
    k: "id" | "name" | "version" | "kernel" | "initrd" | "repo",
    label: string,
    opts: { mono?: boolean; placeholder?: string; description?: React.ReactNode } = {},
  ) => {
    const field: OsImageField =
      k === "kernel" || k === "initrd" || k === "repo" ? `source.${k}` : k
    const id = `img-${k}`
    return (
      <Field data-invalid={invalid(field) || undefined}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          name={k}
          value={form[k]}
          onChange={(e) => set(k, e.target.value)}
          placeholder={opts.placeholder}
          aria-invalid={invalid(field) || undefined}
          className={opts.mono ? "font-mono" : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        {opts.description && <FieldDescription>{opts.description}</FieldDescription>}
        <FieldError errors={err(field)} data-testid={`img-error-${field}`} />
      </Field>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <DialogHeader>
        <DialogTitle className="type-section-title font-semibold">Daftarkan OS image</DialogTitle>
        <DialogDescription>
          Media harus sudah ada di server PXE (path relatif terhadap root media). Registrasi
          dari URL/ISO jarak jauh belum didukung.
        </DialogDescription>
      </DialogHeader>

      {errors.form?.length ? (
        <Alert variant="destructive" data-testid="img-error-form">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          <AlertTitle>Registrasi ditolak server</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-0.5">
              {errors.form.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        {text("id", "ID", {
          mono: true,
          placeholder: "ubuntu-24.04-hwe",
          description: "Huruf kecil, angka, titik, minus. Tidak bisa diubah.",
        })}
        <div className="grid gap-4 sm:grid-cols-2">
          {text("name", "Nama", { placeholder: "Ubuntu Server" })}
          {text("version", "Versi", { placeholder: "24.04.5 LTS" })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={invalid("arch") || undefined}>
            <FieldLabel htmlFor="img-arch">Arsitektur</FieldLabel>
            <Select value={form.arch} onValueChange={(v) => set("arch", v as Form["arch"])}>
              <SelectTrigger id="img-arch" className="w-full font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="amd64" className="font-mono">amd64</SelectItem>
                  <SelectItem value="arm64" className="font-mono">arm64</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldError errors={err("arch")} />
          </Field>
          <Field data-invalid={invalid("method") || undefined}>
            <FieldLabel htmlFor="img-method">Metode</FieldLabel>
            <Select
              value={form.method}
              onValueChange={(v) => {
                set("method", v as InstallMethod)
                if (v === "unattend") set("bootable", false)
              }}
            >
              <SelectTrigger id="img-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldError errors={err("method")} />
          </Field>
        </div>
        <Field orientation="horizontal" data-invalid={invalid("bootable") || undefined}>
          <FieldContent>
            <FieldLabel htmlFor="img-bootable">Bootable via PXE</FieldLabel>
            <FieldDescription>
              Wajib punya kernel dan initrd. Windows (unattend) belum bisa bootable.
            </FieldDescription>
            <FieldError errors={err("bootable")} data-testid="img-error-bootable" />
          </FieldContent>
          <Switch
            id="img-bootable"
            checked={form.bootable}
            onCheckedChange={(v) => set("bootable", v)}
            aria-invalid={invalid("bootable") || undefined}
          />
        </Field>
        <FieldSet data-invalid={invalid("source") || undefined}>
          <FieldLegend variant="label">Sumber media</FieldLegend>
          <FieldDescription>Path relatif root media, tanpa / di awal.</FieldDescription>
          <FieldGroup className="gap-4">
            {text("kernel", "Kernel", {
              mono: true,
              placeholder: method.hint.kernel,
            })}
            {text("initrd", "Initrd", {
              mono: true,
              placeholder: method.hint.initrd,
            })}
            {text("repo", "Repo / root installer", {
              mono: true,
              placeholder: method.hint.repo,
              description: (
                <>
                  URL:{" "}
                  <span className="type-data text-xs break-all" data-testid="img-repo-url">
                    {mediaUrl ?? "…"}/{form.repo.trim() || "<repo>"}
                  </span>
                </>
              ),
            })}
          </FieldGroup>
          <FieldError errors={err("source")} data-testid="img-error-source" />
        </FieldSet>
      </FieldGroup>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={create.isPending}>
          Batal
        </Button>
        <Button type="submit" disabled={create.isPending} data-testid="img-submit">
          {create.isPending && <Spinner data-icon="inline-start" />}
          Daftarkan image
        </Button>
      </DialogFooter>
    </form>
  )
}
