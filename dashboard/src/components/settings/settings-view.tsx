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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  useSettings,
  vlanNetworksOf,
  type SettingsResponse,
} from "@/hooks/use-settings"

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
    accessSection(s),
  ]
}

/**
 * M6 (AC-6.1): blok "Akses" read-only — admin (username mono; hash password tidak pernah dikirim
 * server), sesi, dan rate limit dari env `PXE_SESSION_*`, `PXE_LOGIN_*`, `PXE_API_RATE_PER_MIN`.
 */
function accessSection(s: SettingsResponse) {
  const a = s.auth
  return {
    title: "Akses",
    description: "Login admin, masa berlaku sesi, dan pembatasan percobaan login serta request API.",
    rows: [
      a?.adminConfigured && a.adminUsername
        ? { label: "Admin", value: a.adminUsername, mono: true }
        : {
            label: "Admin",
            value: "Belum dikonfigurasi",
            hint: "Isi PXE_ADMIN_USERNAME dan PXE_ADMIN_PASSWORD_HASH (npm run admin:hash), lalu restart.",
          },
      ...(a
        ? [
            {
              label: "Sesi idle",
              value: `${a.sessionIdleMin} menit`,
              mono: true,
              hint: "Sesi berakhir bila tidak ada aktivitas selama ini.",
            },
            { label: "Masa berlaku sesi maks.", value: `${a.sessionMaxHours} jam`, mono: true },
            {
              label: "Batas login gagal",
              value: `${a.loginMaxFailures} kali / ${a.loginWindowMin} menit`,
              mono: true,
              hint: "Per IP + username; lewat batas, login dikunci sementara.",
            },
            {
              label: "Batas request API",
              value: `${a.apiRatePerMin} / menit per sesi`,
              mono: true,
            },
          ]
        : []),
    ] satisfies Row[],
  }
}

/**
 * M7 (DEC-024 §4, AC-7.12): blok read-only "VLAN management" — VLAN terdaftar dari env
 * `PXE_VLAN_NETWORKS` (VLAN · Subnet · Gateway, mono). IP statis host dengan VLAN ini divalidasi
 * terhadap subnet VLAN, bukan subnet PXE.
 */
export function VlanNetworksCard({ settings }: { settings: SettingsResponse }) {
  const vlans = vlanNetworksOf(settings)
  return (
    <Card data-slot="settings-section" data-testid="settings-vlan">
      <CardHeader>
        <CardTitle className="type-section-title">VLAN management</CardTitle>
        <CardDescription className="type-caption">
          IP statis host dengan VLAN terdaftar divalidasi terhadap subnet VLAN itu (tanpa DHCP
          dashboard); VLAN lain mengikuti subnet provisioning.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {vlans.length === 0 ? (
          <p className="type-body text-muted-foreground" data-testid="settings-vlan-empty">
            Tidak ada VLAN management terdaftar (
            <span className="type-data">PXE_VLAN_NETWORKS</span>)
          </p>
        ) : (
          <Table aria-label="VLAN management terdaftar">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-0">VLAN</TableHead>
                <TableHead>Subnet</TableHead>
                <TableHead>Gateway</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vlans.map((v) => (
                <TableRow key={v.vlan} data-vlan={v.vlan}>
                  <TableCell className="type-data pl-0">{v.vlan}</TableCell>
                  <TableCell className="type-data">{v.cidr}</TableCell>
                  <TableCell className="type-data">{v.gateway}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
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
              {settings.data.insecureConfirmed && (
                <span data-testid="insecure-confirmed" className="mt-1 block">
                  Mode production: dikonfirmasi lewat{" "}
                  <span className="type-data text-xs">PXE_INSECURE_NO_LEASE_CHECK_CONFIRM</span>.
                  Nonaktifkan flag ini setelah selesai.
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}
        {sections(settings.data).map((sec, i) => (
          <React.Fragment key={sec.title}>
          <Card data-slot="settings-section">
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
                    <dd className="flex min-w-0 flex-col gap-0.5" data-label={r.label}>
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
          {/* VLAN management tepat setelah "Jaringan provisioning". */}
          {i === 0 && <VlanNetworksCard settings={settings.data} />}
          </React.Fragment>
        ))}
        </>
      )}
    </div>
  )
}
