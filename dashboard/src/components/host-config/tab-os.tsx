"use client"

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
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { OsForm } from "@/components/host-config/form-state"
import { LOCALES, TIMEZONES } from "@/lib/host-config"
import { OS_IMAGES } from "@/lib/os-images"
import type { Host } from "@/lib/types"

const PARTITION_LABEL = {
  auto: "Auto",
  lvm: "LVM",
  custom: "Custom",
} as const

const PARTITION_HELP = {
  auto: "Partisi standar (ext4) di seluruh disk target.",
  lvm: "Volume group LVM di seluruh disk target — mudah diperbesar nanti.",
  custom: "Konfigurasi storage sendiri (format sesuai metode installer).",
} as const

export function TabOs({
  value,
  onChange,
  hosts,
}: {
  value: OsForm
  onChange: (v: Partial<OsForm>) => void
  hosts: Host[]
}) {
  const image = OS_IMAGES.find((i) => i.id === value.osImageId)
  const installed = hosts.filter((h) => h.osInstalled).length

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend variant="label">OS image</FieldLegend>
        <RadioGroup
          value={value.osImageId}
          onValueChange={(osImageId) => onChange({ osImageId })}
          className="grid gap-2 sm:grid-cols-2"
        >
          {OS_IMAGES.map((img) => (
            <FieldLabel key={img.id} htmlFor={`os-${img.id}`}>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>
                    {img.name} {img.version}
                  </FieldTitle>
                  <FieldDescription>
                    <span className="type-data text-xs">{img.arch}</span> ·{" "}
                    {img.method}
                  </FieldDescription>
                </FieldContent>
                <RadioGroupItem value={img.id} id={`os-${img.id}`} />
              </Field>
            </FieldLabel>
          ))}
        </RadioGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">Profil instalasi</FieldLegend>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="os-disk">Disk target</FieldLabel>
            <Input
              id="os-disk"
              className="type-data"
              placeholder="otomatis — disk terbesar"
              value={value.disk}
              onChange={(e) => onChange({ disk: e.target.value })}
            />
            <FieldDescription>
              Kosongkan untuk memilih disk terbesar, atau isi path seperti{" "}
              <span className="type-data text-xs">/dev/sda</span> /{" "}
              <span className="type-data text-xs">/dev/nvme0n1</span>.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>Skema partisi</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              value={value.partition}
              onValueChange={(v) =>
                v && onChange({ partition: v as OsForm["partition"] })
              }
            >
              {(Object.keys(PARTITION_LABEL) as OsForm["partition"][]).map(
                (k) => (
                  <ToggleGroupItem key={k} value={k} className="px-4">
                    {PARTITION_LABEL[k]}
                  </ToggleGroupItem>
                ),
              )}
            </ToggleGroup>
            <FieldDescription>
              {PARTITION_HELP[value.partition]}
            </FieldDescription>
          </Field>

          {value.partition === "custom" && (
            <Field>
              <FieldLabel htmlFor="os-storage">Konfigurasi storage</FieldLabel>
              <Textarea
                id="os-storage"
                spellCheck={false}
                className="type-data min-h-32"
                placeholder={
                  "layout:\n  name: direct\n  match:\n    size: largest"
                }
                value={value.customStorage}
                onChange={(e) => onChange({ customStorage: e.target.value })}
              />
              <FieldDescription>
                Untuk Ubuntu: blok{" "}
                <span className="type-data text-xs">storage</span> autoinstall
                (YAML). Untuk kickstart/preseed: perintah partisi sesuai format
                masing-masing.
              </FieldDescription>
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="os-tz">Timezone</FieldLabel>
              <Select
                value={value.timezone}
                onValueChange={(v) =>
                  onChange({ timezone: v as OsForm["timezone"] })
                }
              >
                <SelectTrigger id="os-tz" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="os-locale">Locale</FieldLabel>
              <Select
                value={value.locale}
                onValueChange={(v) =>
                  onChange({ locale: v as OsForm["locale"] })
                }
              >
                <SelectTrigger id="os-locale" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {LOCALES.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">
          Yang akan terjadi saat install
        </FieldLegend>
        <ol className="type-body flex list-decimal flex-col gap-1.5 rounded-xl border border-border bg-canvas-soft py-3 pr-4 pl-8 text-body">
          <li>
            {hosts.length === 1 ? "Host" : `${hosts.length} host`} boot dari
            jaringan dan menjalankan installer{" "}
            <span className="font-medium text-foreground">
              {image ? `${image.name} ${image.version}` : "—"}
            </span>
            {image && (
              <>
                {" "}
                via <Badge variant="secondary">{image.method}</Badge>
              </>
            )}
            .
          </li>
          <li>
            Disk{" "}
            <span className="type-data text-xs">
              {value.disk.trim() || "terbesar"}
            </span>{" "}
            <span className="font-medium text-destructive">
              dihapus seluruhnya
            </span>{" "}
            lalu dipartisi {PARTITION_LABEL[value.partition]}.
          </li>
          <li>
            Locale <span className="type-data text-xs">{value.locale}</span>,
            timezone <span className="type-data text-xs">{value.timezone}</span>
            ; credentials, network, hostname dan SSH key diambil dari
            konfigurasi tersimpan.
          </li>
          <li>
            Setelah selesai host reboot ke disk lokal dan tidak di-install
            ulang.
          </li>
        </ol>
        {installed > 0 && (
          <FieldDescription className="text-destructive">
            {installed} host sudah punya OS terpasang — data di disknya akan
            hilang.
          </FieldDescription>
        )}
      </FieldSet>
    </FieldGroup>
  )
}
