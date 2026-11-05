import type { Metadata } from "next"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon, Search01Icon } from "@hugeicons/core-free-icons"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PROVISION_STATUSES, StatusPill } from "@/components/status-pill"

export const metadata: Metadata = { title: "Design tokens" }

const SWATCHES = [
  ["canvas", "bg-background", "#f7f7f4"],
  ["canvas-soft", "bg-canvas-soft", "#fafaf7"],
  ["surface-card", "bg-card", "#ffffff"],
  ["ink", "bg-foreground", "#26251e"],
  ["body", "bg-body", "#5a5852"],
  ["muted", "bg-muted-foreground", "#807d72"],
  ["muted-soft", "bg-muted-soft", "#a09c92"],
  ["hairline", "bg-border", "#e6e5e0"],
  ["hairline-soft", "bg-hairline-soft", "#efeee8"],
  ["hairline-strong", "bg-hairline-strong", "#cfcdc4"],
  ["primary", "bg-primary", "#f54e00"],
  ["primary-active", "bg-primary-active", "#d04200"],
  ["error", "bg-destructive", "#cf2d56"],
  ["success", "bg-success", "#1f8a65"],
] as const

export default function DesignPage() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="type-section-title">Warna</CardTitle>
          <CardDescription>
            Token dari design system, dipetakan ke variabel shadcn.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {SWATCHES.map(([name, cls, hex]) => (
            <div key={name} className="flex flex-col gap-2">
              <div className={`h-12 rounded-lg border border-border ${cls}`} />
              <div className="flex flex-col">
                <span className="type-caption font-medium">{name}</span>
                <span className="type-data text-xs text-muted-foreground">
                  {hex}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="type-section-title">Tipografi</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="type-page-title">Judul halaman 26/400</p>
            <p className="type-section-title">Judul section 17/600</p>
            <p className="type-body text-body">
              Body 14/400: host akan muncul otomatis saat PXE boot.
            </p>
            <p className="type-caption text-muted-foreground">
              Caption 13/400 — terakhir terlihat 2 menit lalu
            </p>
            <p className="type-column-label text-muted-foreground">
              Label kolom tabel
            </p>
            <p className="type-data">
              52:54:00:10:10:11 · 10.10.10.11 · node01
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="type-section-title">
              Status provisioning
            </CardTitle>
            <CardDescription>
              Pastel hanya untuk pill dan timeline.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {PROVISION_STATUSES.map((s) => (
              <StatusPill key={s} status={s} />
            ))}
            <Badge variant="secondary">Badge netral</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="type-section-title">Tombol</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button>
              <HugeiconsIcon
                icon={PlusSignIcon}
                strokeWidth={2}
                data-icon="inline-start"
              />
              Install OS
            </Button>
            <Button variant="outline">Simpan konfigurasi</Button>
            <Button variant="ghost">Batal</Button>
            <Button variant="dark">Reboot ke PXE</Button>
            <Button variant="destructive">Hapus</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="type-section-title">Input</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="ds-host">Hostname</FieldLabel>
                <Input
                  id="ds-host"
                  className="font-mono"
                  placeholder="node-01"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ds-search">Cari</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="ds-search"
                    placeholder="MAC, hostname, IP"
                  />
                </InputGroup>
              </Field>
            </FieldGroup>
            <Tabs defaultValue="os">
              <TabsList>
                <TabsTrigger value="os">OS</TabsTrigger>
                <TabsTrigger value="cred">Credentials</TabsTrigger>
                <TabsTrigger value="net">Network</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
