"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Delete02Icon,
  PlusSignIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import type { NewKeyForm, SshForm } from "@/components/host-config/form-state"
import { useSshKeys } from "@/hooks/use-host-config"
import { parseSshKey, sshFingerprint } from "@/lib/ssh-key"

/** Parse + fingerprint (async karena Web Crypto). */
function useKeyInfo(publicKey: string) {
  return useQuery({
    queryKey: ["ssh-key-info", publicKey.trim()],
    queryFn: async () => {
      const parsed = parseSshKey(publicKey)
      if ("error" in parsed) return { error: parsed.error }
      return {
        type: parsed.type,
        comment: parsed.comment,
        fingerprint: await sshFingerprint(parsed.blob),
      }
    },
    enabled: publicKey.trim().length > 0,
    staleTime: Infinity,
  })
}

function NewKeyEditor({
  index,
  value,
  onChange,
  onRemove,
}: {
  index: number
  value: NewKeyForm
  onChange: (v: Partial<NewKeyForm>) => void
  onRemove: () => void
}) {
  const info = useKeyInfo(value.publicKey).data
  const fileRef = React.useRef<HTMLInputElement>(null)
  const invalid = info && "error" in info ? info.error : null

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (file.size > 16_384) {
      toast.error("File terlalu besar untuk public key")
      return
    }
    const text = (await file.text()).trim()
    onChange({
      publicKey: text,
      name: value.name || file.name.replace(/\.pub$/, ""),
    })
  }

  return (
    <FieldSet className="rounded-xl border border-border bg-canvas-soft p-4">
      <div className="flex items-center justify-between gap-2">
        <FieldLegend variant="label" className="mb-0">
          Key baru #{index + 1}
        </FieldLegend>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileRef.current?.click()}
          >
            <HugeiconsIcon
              icon={Upload01Icon}
              strokeWidth={2}
              data-icon="inline-start"
            />
            Unggah .pub
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hapus key baru"
            onClick={onRemove}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".pub,text/plain"
            className="sr-only"
            onChange={onFile}
          />
        </div>
      </div>
      <FieldGroup className="gap-3">
        <Field data-invalid={invalid ? true : undefined}>
          <FieldLabel htmlFor={`key-${index}`} className="sr-only">
            Public key
          </FieldLabel>
          <Textarea
            id={`key-${index}`}
            spellCheck={false}
            className="type-data min-h-20 text-xs break-all"
            placeholder="ssh-ed25519 AAAAC3Nza… user@host"
            value={value.publicKey}
            aria-invalid={invalid ? true : undefined}
            onChange={(e) => onChange({ publicKey: e.target.value })}
          />
          {invalid ? (
            <FieldError>{invalid}</FieldError>
          ) : info && "fingerprint" in info ? (
            <FieldDescription className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{info.type}</Badge>
              <span className="type-data text-xs break-all">
                {info.fingerprint}
              </span>
              {info.comment && (
                <span className="type-caption">{info.comment}</span>
              )}
            </FieldDescription>
          ) : null}
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            id={`key-save-${index}`}
            checked={value.saveToLibrary}
            onCheckedChange={(v) => onChange({ saveToLibrary: v === true })}
          />
          <FieldLabel htmlFor={`key-save-${index}`} className="font-normal">
            Simpan ke library SSH Keys
          </FieldLabel>
        </Field>
        {value.saveToLibrary && (
          <Field>
            <FieldLabel htmlFor={`key-name-${index}`}>Nama key</FieldLabel>
            <Input
              id={`key-name-${index}`}
              placeholder="Laptop ops"
              value={value.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </Field>
        )}
      </FieldGroup>
    </FieldSet>
  )
}

export function TabSsh({
  value,
  onChange,
  defaultUser,
}: {
  value: SshForm
  onChange: (v: Partial<SshForm>) => void
  defaultUser: string
}) {
  const { data: keys, isPending } = useSshKeys()

  function toggleKey(id: string, on: boolean) {
    onChange({
      keyIds: on ? [...value.keyIds, id] : value.keyIds.filter((k) => k !== id),
    })
  }

  function updateNew(i: number, patch: Partial<NewKeyForm>) {
    onChange({
      newKeys: value.newKeys.map((k, j) => (j === i ? { ...k, ...patch } : k)),
    })
  }

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend variant="label">Dari library</FieldLegend>
        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : !keys?.length ? (
          <FieldDescription>
            Library masih kosong — tambahkan key di bawah.
          </FieldDescription>
        ) : (
          <FieldGroup className="gap-2">
            {keys.map((k) => (
              <FieldLabel key={k.id} htmlFor={`lib-${k.id}`}>
                <Field orientation="horizontal">
                  <Checkbox
                    id={`lib-${k.id}`}
                    checked={value.keyIds.includes(k.id)}
                    onCheckedChange={(v) => toggleKey(k.id, v === true)}
                  />
                  <FieldContent className="min-w-0">
                    <FieldTitle>
                      {k.name} <Badge variant="secondary">{k.type}</Badge>
                    </FieldTitle>
                    <FieldDescription className="type-data truncate text-xs">
                      {k.fingerprint}
                      {k.comment ? ` · ${k.comment}` : ""}
                    </FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>
            ))}
          </FieldGroup>
        )}
      </FieldSet>

      {value.newKeys.map((k, i) => (
        <NewKeyEditor
          key={i}
          index={i}
          value={k}
          onChange={(patch) => updateNew(i, patch)}
          onRemove={() =>
            onChange({ newKeys: value.newKeys.filter((_, j) => j !== i) })
          }
        />
      ))}

      <Button
        variant="outline"
        className="self-start"
        onClick={() =>
          onChange({
            newKeys: [
              ...value.newKeys,
              { name: "", publicKey: "", saveToLibrary: true },
            ],
          })
        }
      >
        <HugeiconsIcon
          icon={PlusSignIcon}
          strokeWidth={2}
          data-icon="inline-start"
        />
        Tempel / unggah key baru
      </Button>

      <Field>
        <FieldLabel htmlFor="ssh-user">User target</FieldLabel>
        <Input
          id="ssh-user"
          className="type-data"
          placeholder={defaultUser || "ubuntu"}
          value={value.user}
          onChange={(e) => onChange({ user: e.target.value })}
        />
        <FieldDescription>
          Key ditulis ke{" "}
          <span className="type-data text-xs">~/.ssh/authorized_keys</span> user
          ini. Kosongkan untuk memakai user dari tab Credentials
          {defaultUser ? (
            <>
              {" "}
              (<span className="type-data text-xs">{defaultUser}</span>)
            </>
          ) : null}
          .
        </FieldDescription>
      </Field>
    </FieldGroup>
  )
}
