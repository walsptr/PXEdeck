"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Download01Icon,
  SparklesIcon,
  Upload01Icon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { CredForm, CredMode } from "@/components/host-config/form-state"
import { useCsvImport } from "@/hooks/use-host-config"
import { generatePassword, PASSWORD_MIN, toCsv } from "@/lib/credentials"
import type { CsvRowResult } from "@/lib/host-config"
import type { Host } from "@/lib/types"

const MODES: { value: CredMode; label: string; help: string }[] = [
  {
    value: "same",
    label: "Sama untuk semua",
    help: "Satu username dan password untuk semua host terpilih.",
  },
  {
    value: "random",
    label: "Password acak per host",
    help: "Password unik dibuat server. Setelah disimpan, daftar password bisa diunduh sebagai CSV — hanya sekali.",
  },
  {
    value: "csv",
    label: "Import CSV",
    help: "Kolom mac,username,password. Baris divalidasi sebelum diterapkan.",
  },
]

export function downloadText(
  filename: string,
  text: string,
  type = "text/csv",
) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  invalid?: boolean
}) {
  const [show, setShow] = React.useState(false)
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        type={show ? "text" : "password"}
        autoComplete="new-password"
        className="type-data"
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <InputGroupAddon align="inline-end">
        <Tooltip>
          <TooltipTrigger asChild>
            <InputGroupButton
              size="icon-sm"
              aria-label={show ? "Sembunyikan password" : "Tampilkan password"}
              onClick={() => setShow((s) => !s)}
            >
              <HugeiconsIcon
                icon={show ? ViewOffIcon : ViewIcon}
                strokeWidth={2}
              />
            </InputGroupButton>
          </TooltipTrigger>
          <TooltipContent>{show ? "Sembunyikan" : "Tampilkan"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <InputGroupButton
              size="icon-sm"
              aria-label="Buat password acak"
              onClick={() => {
                onChange(generatePassword(16))
                setShow(true)
              }}
            >
              <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} />
            </InputGroupButton>
          </TooltipTrigger>
          <TooltipContent>Buat password acak (16 karakter)</TooltipContent>
        </Tooltip>
      </InputGroupAddon>
    </InputGroup>
  )
}

export function TabCredentials({
  value,
  onChange,
  hosts,
  hasPassword,
  csvRows,
  onCsvRows,
}: {
  value: CredForm
  onChange: (v: Partial<CredForm>) => void
  hosts: Host[]
  /** Host tunggal yang sudah punya password tersimpan. */
  hasPassword: boolean
  csvRows: CsvRowResult[] | null
  onCsvRows: (rows: CsvRowResult[] | null) => void
}) {
  const bulk = hosts.length > 1
  const csvImport = useCsvImport()
  const fileRef = React.useRef<HTMLInputElement>(null)

  function setCsv(csv: string) {
    onChange({ csv })
    onCsvRows(null)
  }

  function validateCsv(csv = value.csv) {
    csvImport.mutate(
      { csv, hostIds: hosts.map((h) => h.id) },
      {
        onSuccess: (r) => onCsvRows(r.rows),
        onError: (e) =>
          toast.error("Gagal memvalidasi CSV", { description: e.message }),
      },
    )
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (file.size > 200_000) {
      toast.error("File CSV terlalu besar (maks 200 KB)")
      return
    }
    const text = await file.text()
    setCsv(text)
    validateCsv(text)
  }

  const mode = bulk ? value.mode : "same"
  const showUsername = mode !== "csv"

  return (
    <FieldGroup>
      {bulk && (
        <Field>
          <FieldLabel>Mode</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={mode}
            onValueChange={(v) => v && onChange({ mode: v as CredMode })}
            className="flex-wrap"
          >
            {MODES.map((m) => (
              <ToggleGroupItem key={m.value} value={m.value} className="px-3">
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>
            {MODES.find((m) => m.value === mode)!.help}
          </FieldDescription>
        </Field>
      )}

      {showUsername && (
        <Field>
          <FieldLabel htmlFor="cred-user">Username</FieldLabel>
          <Input
            id="cred-user"
            className="type-data"
            autoComplete="off"
            value={value.username}
            onChange={(e) => onChange({ username: e.target.value })}
          />
        </Field>
      )}

      {mode === "same" && (
        <Field>
          <FieldLabel htmlFor="cred-pass">Password</FieldLabel>
          <PasswordInput
            id="cred-pass"
            value={value.password}
            onChange={(password) => onChange({ password })}
            placeholder={
              !bulk && hasPassword
                ? "kosongkan untuk mempertahankan password saat ini"
                : `minimal ${PASSWORD_MIN} karakter`
            }
          />
          <FieldDescription>
            Disimpan sebagai hash SHA-512 crypt; password asli tidak disimpan
            dan tidak bisa dilihat lagi.
          </FieldDescription>
        </Field>
      )}

      {mode === "random" && (
        <Field>
          <FieldLabel htmlFor="cred-len">Panjang password</FieldLabel>
          <Select
            value={String(value.length)}
            onValueChange={(v) => onChange({ length: Number(v) })}
          >
            <SelectTrigger id="cred-len" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {[12, 16, 20, 24, 32].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} karakter
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      )}

      {mode === "csv" && (
        <Field>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="cred-csv">CSV</FieldLabel>
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  downloadText(
                    "credentials-template.csv",
                    toCsv([
                      ["mac", "username", "password"],
                      ...hosts.map((h) => [h.mac, "ubuntu", ""]),
                    ]) + "\r\n",
                  )
                }
              >
                <HugeiconsIcon
                  icon={Download01Icon}
                  strokeWidth={2}
                  data-icon="inline-start"
                />
                Template
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                <HugeiconsIcon
                  icon={Upload01Icon}
                  strokeWidth={2}
                  data-icon="inline-start"
                />
                Unggah
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={onFile}
              />
            </div>
          </div>
          <Textarea
            id="cred-csv"
            spellCheck={false}
          className="type-data min-h-28"
            placeholder={
              "mac,username,password\n52:54:00:10:10:11,ubuntu,s3cret-pass"
            }
            value={value.csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!value.csv.trim() || csvImport.isPending}
              onClick={() => validateCsv()}
            >
              {csvImport.isPending && <Spinner data-icon="inline-start" />}
              Validasi CSV
            </Button>
            {csvRows && (
              <span className="type-caption text-muted-foreground">
                {csvRows.filter((r) => !r.errors.length).length} valid ·{" "}
                {csvRows.filter((r) => r.errors.length).length} tidak valid
              </span>
            )}
          </div>
          {csvRows && <CsvPreview rows={csvRows} hosts={hosts} />}
        </Field>
      )}

      <FieldSet>
        <FieldLegend variant="label">Opsi</FieldLegend>
        <FieldGroup className="gap-3">
          <FieldLabel htmlFor="cred-sudo">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Jadikan sudoer</FieldTitle>
                <FieldDescription>
                  sudo tanpa password (NOPASSWD), seperti lab saat ini.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="cred-sudo"
                checked={value.sudo}
                onCheckedChange={(sudo) => onChange({ sudo })}
              />
            </Field>
          </FieldLabel>
          <FieldLabel htmlFor="cred-nopw">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Nonaktifkan login password SSH</FieldTitle>
                <FieldDescription>
                  Hanya login dengan SSH key. Pastikan tab SSH Keys berisi
                  minimal satu key.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="cred-nopw"
                checked={value.disableSshPassword}
                onCheckedChange={(disableSshPassword) =>
                  onChange({ disableSshPassword })
                }
              />
            </Field>
          </FieldLabel>
        </FieldGroup>
      </FieldSet>
    </FieldGroup>
  )
}

function CsvPreview({ rows, hosts }: { rows: CsvRowResult[]; hosts: Host[] }) {
  const byId = new Map(hosts.map((h) => [h.id, h]))
  const covered = new Set(
    rows.filter((r) => !r.errors.length).map((r) => r.hostId),
  )
  const untouched = hosts.filter((h) => !covered.has(h.id)).length
  return (
    <div className="flex flex-col gap-2">
      <Table
        aria-label="Preview CSV credentials"
        scrollRegionLabel="Preview CSV credentials"
        containerClassName="max-h-64 overflow-auto rounded-xl border border-border bg-card"
      >
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">Baris</TableHead>
            <TableHead>MAC</TableHead>
            <TableHead>Username</TableHead>
            <TableHead>Hasil</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.line}
              data-line={r.line}
              data-state={r.errors.length ? "error" : "ok"}
            >
              <TableCell className="type-data text-xs text-muted-foreground">
                {r.line}
              </TableCell>
              <TableCell>
                <span className="type-data">{r.mac || "—"}</span>
                {r.hostId && byId.get(r.hostId)?.hostname && (
                  <span className="type-caption ml-1.5 text-muted-foreground">
                    {byId.get(r.hostId)!.hostname}
                  </span>
                )}
              </TableCell>
              <TableCell className="type-data">{r.username || "—"}</TableCell>
              <TableCell className="whitespace-normal">
                {r.errors.length === 0 ? (
                  <Badge variant="secondary">OK</Badge>
                ) : (
                  <span className="type-caption text-destructive">
                    {r.errors.join("; ")}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {untouched > 0 && (
        <FieldDescription>
          {untouched} host terpilih tidak ada di CSV — credentials-nya tidak
          diubah.
        </FieldDescription>
      )}
    </div>
  )
}
