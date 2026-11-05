"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, InformationCircleIcon } from "@hugeicons/core-free-icons"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSettings, type SettingsResponse } from "@/hooks/use-settings"

type Row = {
  label: string
  /** Nilai teknis (IP, CIDR, path, URL) → mono; teks biasa → sans. */
  value: React.ReactNode
  mono?: boolean
  hint?: string
}

const UNKNOWN_HOST_LABEL: Record<SettingsResponse["unknownHostAction"], string> =
  {
    local: "Boot lokal (exit ke firmware)",
    wait: "Tunggu tugas instalasi (loop iPXE), lalu boot lokal",
  }

function sections(s: SettingsResponse): {
  title: string
  description: string
  rows: Row[]
}[] {
  return [
    {
      title: "Jaringan provisioning",
      description: "Subnet DHCP yang dilayani dnsmasq dan aturan IP statis host.",
      rows: [
        { label: "Interface", value: s.interface, mono: true },
        { label: "Subnet", value: s.cidr, mono: true },
        { label: "Gateway", value: s.gateway, mono: true },
        { label: "DNS", value: s.dns.join(", "), mono: true },
        {
          label: "Range DHCP dinamis",
          value: `${s.dynamicRange[0]}–${s.dynamicRange[1]}`,
          mono: true,
          hint: "IP statis host tidak boleh berada di range ini.",
        },
        { label: "PXE server", value: s.pxeServer, mono: true },
      ],
    },
    {
      title: "Boot & media",
      description: "Lokasi file boot TFTP dan URL HTTP yang dipakai client PXE.",
      rows: [
        { label: "TFTP root", value: s.tftpRoot, mono: true },
        { label: "Base URL HTTP", value: s.baseUrl, mono: true },
        { label: "Media URL", value: s.mediaUrl, mono: true },
      ],
    },
    {
      title: "Provisioning",
      description: "Perilaku boot dan masa berlaku token konfigurasi per host.",
      rows: [
        {
          label: "Host tanpa tugas install",
          value: UNKNOWN_HOST_LABEL[s.unknownHostAction] ?? s.unknownHostAction,
        },
        {
          label: "TTL token konfigurasi",
          value: `${s.tokenTtlMin} menit`,
          mono: true,
        },
      ],
    },
    {
      title: "Job & watchdog",
      description:
        "Batas waktu tiap tahap job install; lewat batas, job dan host ditandai Failed.",
      rows: [
        {
          label: "Timeout Booting",
          value: `${s.jobTimeouts.bootingMin} menit`,
          mono: true,
        },
        {
          label: "Timeout Installing",
          value: `${s.jobTimeouts.installingMin} menit`,
          mono: true,
        },
        {
          label: "Timeout Configuring",
          value: `${s.jobTimeouts.configuringMin} menit`,
          mono: true,
        },
        {
          label: "Batas penyajian installer",
          value: `${s.maxInstallerBoots} kali per job`,
          mono: true,
          hint: "PXE boot berikutnya saat Booting setelah batas ini → boot lokal dan job Failed.",
        },
        {
          label: "Pemeriksaan lease DHCP",
          value: s.insecureNoLeaseCheck
            ? "Nonaktif (PXE_INSECURE_NO_LEASE_CHECK=1)"
            : "Aktif",
          mono: s.insecureNoLeaseCheck,
        },
      ],
    },
  ]
}

const noopSubscribe = () => () => {}

/** Halaman Settings read-only (AC-4.6): nilai dari `GET /api/settings`. */
export function SettingsView() {
  const settings = useSettings()
  // Cache settings dipakai bersama sidebar; bila segmen halaman ter-hydrate setelah query
  // sidebar selesai, render pertama tetap harus sama dengan HTML server (skeleton).
  const hydrated = React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Alert>
        <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
        <AlertTitle>Read-only</AlertTitle>
        <AlertDescription>
          Konfigurasi dibaca dari environment server (
          <span className="type-data text-xs">PXE_*</span>). Mengubahnya
          butuh menulis ulang konfigurasi dnsmasq sebagai root, jadi belum bisa
          dari dashboard — ubah env lalu restart layanan.
        </AlertDescription>
      </Alert>

      {!hydrated || settings.isPending ? (
        Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-xl" />
        ))
      ) : settings.isError ? (
        <Alert variant="destructive">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          <AlertTitle>Gagal memuat settings server</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{settings.error.message}</span>
            <Button variant="outline" onClick={() => settings.refetch()}>
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
        {settings.data.insecureNoLeaseCheck && (
          <Alert variant="destructive" data-testid="insecure-lease-warning">
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
            <AlertTitle>Pemeriksaan lease DHCP dinonaktifkan</AlertTitle>
            <AlertDescription>
              <span>
                Server berjalan dengan{" "}
                <span className="type-data text-xs">
                  PXE_INSECURE_NO_LEASE_CHECK=1
                </span>
                : installer dan konfigurasi per host dilayani tanpa mencocokkan IP
                klien dengan lease dnsmasq. Gunakan hanya di lab terisolasi.
              </span>
            </AlertDescription>
          </Alert>
        )}
        {sections(settings.data).map((sec) => (
          <Card key={sec.title} data-slot="settings-section">
            <CardHeader>
              <CardTitle className="type-section-title">{sec.title}</CardTitle>
              <CardDescription className="type-caption">
                {sec.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col">
                {sec.rows.map((r) => (
                  <div
                    key={r.label}
                    className="grid gap-1 border-t border-hairline-soft py-3 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[12rem_1fr] sm:gap-4"
                  >
                    <dt className="type-caption text-muted-foreground">
                      {r.label}
                    </dt>
                    <dd className="flex min-w-0 flex-col gap-0.5">
                      <span
                        className={
                          r.mono
                            ? "type-data break-all text-foreground"
                            : "type-body text-foreground"
                        }
                      >
                        {r.value}
                      </span>
                      {r.hint && (
                        <span className="type-caption text-muted-foreground">
                          {r.hint}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ))}
        </>
      )}
    </div>
  )
}
