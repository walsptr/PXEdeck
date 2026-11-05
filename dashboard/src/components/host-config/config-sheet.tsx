"use client"

import * as React from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  buildPayload,
  initialForm,
  SECTION_LABEL,
  SECTION_ORDER,
  sectionErrors,
  type Context,
  type FormState,
} from "@/components/host-config/form-state"
import { SectionErrors } from "@/components/host-config/section-errors"
import { TabCredentials } from "@/components/host-config/tab-credentials"
import { TabHostname } from "@/components/host-config/tab-hostname"
import { TabNetwork } from "@/components/host-config/tab-network"
import { TabOs } from "@/components/host-config/tab-os"
import { TabSsh } from "@/components/host-config/tab-ssh"
import {
  ApiError,
  useHostConfig,
  useInstall,
  useSaveConfig,
} from "@/hooks/use-host-config"
import { useFailureText } from "@/hooks/use-jobs"
import { installBlockReason, useOsImages } from "@/hooks/use-os-images"
import { useActiveNetwork } from "@/hooks/use-settings"
import type {
  CsvRowResult,
  InstallResult,
  PublicHostConfig,
  SaveResult,
  SectionKey,
} from "@/lib/host-config"
import type { MgmtNetwork } from "@/lib/net"
import { canonicalOsImageId, osLabel } from "@/lib/os-images"
import type { Host, HostWithJob } from "@/lib/types"
import { jobsHref } from "@/lib/jobs"
import { cn } from "@/lib/utils"

export type ConfigSheetTarget = {
  hostIds: string[]
  tab: SectionKey
  /** Aksi spesifik (mis. "Set IP") langsung menandai bagian itu untuk disimpan. */
  preselect?: boolean
}

export function ConfigSheet({
  target,
  onClose,
  allHosts,
  onSaved,
}: {
  target: ConfigSheetTarget | null
  onClose: () => void
  allHosts: Host[]
  onSaved: (result: SaveResult) => void
}) {
  return (
    <Sheet open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        {target && (
          <SheetBody
            key={target.hostIds.join(",")}
            target={target}
            allHosts={allHosts}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Alasan gagal job terakhir host (M5, `lastJob`) + tautan ke log job. */
function LastJobNote({ host }: { host: HostWithJob }) {
  const failureText = useFailureText()
  const job = host.lastJob
  if (host.status !== "failed" || job?.status !== "failed") return null
  return (
    <p
      data-testid="sheet-last-job-failure"
      className="type-caption flex flex-wrap items-baseline gap-x-2 text-muted-foreground"
    >
      <span>
        <span className="font-medium text-destructive">Install terakhir gagal:</span>{" "}
        {failureText(job.failureReason) ?? "alasan tidak tercatat"}
      </span>
      <Link
        href={jobsHref({ host: host.id, job: job.id })}
        className="text-foreground underline underline-offset-4"
      >
        Lihat log
      </Link>
    </p>
  )
}

function SheetBody({
  target,
  allHosts,
  onClose,
  onSaved,
}: {
  target: ConfigSheetTarget
  allHosts: Host[]
  onClose: () => void
  onSaved: (result: SaveResult) => void
}) {
  const hosts = React.useMemo(() => {
    const byId = new Map(allHosts.map((h) => [h.id, h]))
    return target.hostIds
      .map((id) => byId.get(id))
      .filter((h): h is Host => Boolean(h))
  }, [allHosts, target.hostIds])
  const single = hosts.length === 1 ? hosts[0] : null
  const config = useHostConfig(single?.id ?? null)
  const network = useActiveNetwork()
  const failed = (single && config.isError) || network.isError
  const loading = (single && config.isPending) || network.isPending

  // DR-4-1: hostname/MAC di judul memakai mono (ukuran ikut judul, bukan 13 px `type-data`); DR-4-2: judul 600 eksplisit (tailwind-merge tidak
  // mengenali utility `type-*`, sehingga `font-medium` bawaan SheetTitle menang tanpa ini).
  const title = single ? (
    <>
      Konfigurasi{" "}
      <span className="font-mono tracking-normal" data-testid="sheet-title-host">
        {single.hostname ?? single.mac}
      </span>
    </>
  ) : (
    `Konfigurasi ${hosts.length} host`
  )

  return (
    <>
      <SheetHeader className="border-b border-border">
        <SheetTitle className="type-section-title font-semibold">{title}</SheetTitle>
        <SheetDescription>
          {single ? (
            <span className="type-data">{single.mac}</span>
          ) : (
            "Hanya bagian yang Anda ubah yang diterapkan ke semua host terpilih."
          )}
        </SheetDescription>
        {single && <LastJobNote host={single} />}
      </SheetHeader>
      {hosts.length === 0 ? (
        <p className="p-6 text-body">Host tidak lagi tersedia.</p>
      ) : failed ? (
        // CR-3-13: jangan render form dari nilai default bila data gagal dimuat.
        <div className="p-6">
          <Alert variant="destructive">
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
            <AlertTitle>
              {single && config.isError
                ? "Gagal memuat konfigurasi host"
                : "Gagal memuat parameter jaringan"}
            </AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <span>
                {(config.error ?? network.error)?.message}. Form tidak
                ditampilkan agar nilai tersimpan tidak tertimpa default.
              </span>
              <Button
                variant="outline"
                onClick={() => {
                  if (single && config.isError) config.refetch()
                  if (network.isError) network.refetch()
                }}
              >
                Coba lagi
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : loading || !network.data ? (
        <div className="flex flex-col gap-3 p-6">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <ConfigForm
          hosts={hosts}
          allHosts={allHosts}
          config={config.data}
          net={network.data}
          initialTab={target.tab}
          preselect={Boolean(target.preselect)}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </>
  )
}

function ConfigForm({
  hosts,
  allHosts,
  config,
  net,
  initialTab,
  preselect,
  onClose,
  onSaved,
}: {
  hosts: Host[]
  allHosts: Host[]
  config?: PublicHostConfig
  net: MgmtNetwork
  initialTab: SectionKey
  preselect: boolean
  onClose: () => void
  onSaved: (result: SaveResult) => void
}) {
  const [initial] = React.useState(() => initialForm(hosts, config, net))
  const [form, setForm] = React.useState<FormState>(initial)
  const [dirty, setDirty] = React.useState<Set<SectionKey>>(
    () => new Set(preselect ? [initialTab] : []),
  )
  const [tab, setTab] = React.useState<SectionKey>(initialTab)
  const [csvRows, setCsvRows] = React.useState<CsvRowResult[] | null>(null)
  const [serverErrors, setServerErrors] = React.useState<
    Partial<Record<SectionKey, string[]>>
  >({})
  const [confirmInstall, setConfirmInstall] = React.useState(false)
  /** Host yang gagal di-install pada percobaan terakhir (ditampilkan per host di Sheet). */
  const [installFailed, setInstallFailed] = React.useState<
    InstallResult["failed"]
  >([])
  /** Host yang berhasil mulai diinstal pada percobaan bulk yang sebagian gagal (DR-4-4). */
  const [installStarted, setInstallStarted] = React.useState<string[]>([])
  /** Error install yang tidak per host (mis. 403/5xx) — Alert di Sheet, bukan toast (DR-4-3). */
  const [installError, setInstallError] = React.useState<string | null>(null)

  const save = useSaveConfig()
  const install = useInstall()
  const busy = save.isPending || install.isPending

  const ctx: Context = { hosts, allHosts, config, net }
  const bulk = hosts.length > 1

  function update<K extends SectionKey>(
    section: K,
    patch: Partial<FormState[K]>,
  ) {
    setForm((f) => ({ ...f, [section]: { ...f[section], ...patch } }))
    setDirty((d) => (d.has(section) ? d : new Set(d).add(section)))
    setServerErrors((e) => (e[section] ? { ...e, [section]: undefined } : e))
  }

  function resetSection(section: SectionKey) {
    setForm((f) => ({ ...f, [section]: initial[section] }))
    setDirty((d) => {
      const n = new Set(d)
      n.delete(section)
      return n
    })
    if (section === "credentials") setCsvRows(null)
    setServerErrors((e) => ({ ...e, [section]: undefined }))
  }

  const csvInvalid = csvRows
    ? csvRows.filter((r) => r.errors.length).length
    : null
  const clientErrors = sectionErrors(form, dirty, ctx, csvInvalid)
  const blocking = SECTION_ORDER.filter(
    (k) => dirty.has(k) && clientErrors[k]?.length,
  )
  const dirtyList = SECTION_ORDER.filter((k) => dirty.has(k))

  const installOsId = dirty.has("os")
    ? form.os.osImageId
    : hosts.length === 1
      ? (config?.os?.osImageId ?? hosts[0].osAssigned)
      : null
  const installOs = osLabel(installOsId)
  // Image yang pasti ditolak server (media tidak tersedia / Windows): Install dinonaktifkan.
  const images = useOsImages()
  const installBlocked = installOsId
    ? installBlockReason(
        images.data?.find((i) => i.id === canonicalOsImageId(installOsId)),
      )
    : null
  const hostLabel = (id: string) => {
    const h = hosts.find((x) => x.id === id)
    return h ? (h.hostname ?? h.mac) : id
  }

  async function submit(andInstall: boolean) {
    const ids = hosts.map((h) => h.id)
    setServerErrors({})
    if (andInstall) {
      setInstallFailed([])
      setInstallStarted([])
      setInstallError(null)
    }
    let phase: "save" | "install" = "save"
    try {
      if (dirtyList.length > 0) {
        const result = await save.mutateAsync({
          hostIds: ids,
          payload: buildPayload(form, dirty, ctx),
        })
        onSaved(result)
        if (!andInstall) {
          toast.success(
            bulk
              ? `Konfigurasi ${result.updated} host disimpan`
              : "Konfigurasi disimpan",
            { description: dirtyList.map((k) => SECTION_LABEL[k]).join(", ") },
          )
        }
      }
      if (andInstall) {
        phase = "install"
        const r = await install.mutateAsync(ids)
        if (r.failed.length) {
          // DR-4-3/DR-4-4: Sheet tetap terbuka (juga bila sebagian host berhasil) dan alasan per
          // host + ringkasan yang berhasil tampil di Alert dalam Sheet — tanpa toast yang menutupi
          // footer.
          setInstallFailed(r.failed)
          setInstallStarted(r.started)
          return
        }
        if (r.started.length) {
          toast.success(`Instalasi dimulai di ${r.started.length} host`, {
            description:
              "Status akan bergerak dari Booting sampai Done di tabel.",
          })
        }
      }
      onClose()
    } catch (e) {
      if (e instanceof ApiError && e.errors.length) {
        const grouped: Partial<Record<SectionKey, string[]>> = {}
        // Error di luar lima tab (mis. `hostIds`: id host invalid/tidak dikenal) tidak
        // punya tab; tampilkan di toast agar tidak hilang.
        const other: string[] = []
        for (const err of e.errors) {
          if ((SECTION_ORDER as readonly string[]).includes(err.section))
            (grouped[err.section as SectionKey] ??= []).push(err.message)
          else other.push(err.message)
        }
        setServerErrors(grouped)
        const first = SECTION_ORDER.find((k) => grouped[k])
        if (first) setTab(first)
        toast.error("Konfigurasi ditolak server", {
          description: other.length ? other.join("\n") : e.message,
        })
      } else if (phase === "install") {
        // Mis. 403 "Host tidak diizinkan" (guardMutation) atau 5xx: Alert di Sheet (DR-4-3).
        setInstallError((e as Error).message)
      } else {
        toast.error("Gagal menyimpan", { description: (e as Error).message })
      }
    }
  }

  return (
    <>
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as SectionKey)}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="overflow-x-auto border-b border-border px-6 py-3">
          <TabsList>
            {SECTION_ORDER.map((k) => {
              const hasErr = Boolean(
                (dirty.has(k) && clientErrors[k]?.length) ||
                  serverErrors[k]?.length,
              )
              return (
                <TabsTrigger key={k} value={k} className="gap-1.5 px-3">
                  {SECTION_LABEL[k]}
                  {(dirty.has(k) || serverErrors[k]) && (
                    <>
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 rounded-full",
                          hasErr ? "bg-destructive" : "bg-foreground",
                        )}
                      />
                      <span className="sr-only">
                        {hasErr ? "(ada error)" : "(diubah)"}
                      </span>
                    </>
                  )}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {installError && (
            <Alert variant="destructive" className="mb-5" data-slot="install-error">
              <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
              <AlertTitle>Gagal memulai instalasi</AlertTitle>
              <AlertDescription>{installError}</AlertDescription>
            </Alert>
          )}
          {installFailed.length > 0 && (
            <Alert variant="destructive" className="mb-5" data-slot="install-errors">
              <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
              <AlertTitle>
                Install ditolak untuk {installFailed.length} host
              </AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <ul className="flex flex-col gap-1">
                  {installFailed.map((f) => (
                    <li key={f.hostId}>
                      <span className="type-data">{hostLabel(f.hostId)}</span>
                      : {f.message}
                    </li>
                  ))}
                </ul>
                {installStarted.length > 0 && (
                  <p data-slot="install-started" className="text-foreground">
                    {installStarted.length} host mulai diinstal:{" "}
                    {installStarted.map((id, i) => (
                      <React.Fragment key={id}>
                        {i > 0 && ", "}
                        <span className="type-data">{hostLabel(id)}</span>
                      </React.Fragment>
                    ))}
                    . Status bergerak dari Booting di tabel.
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}
          {SECTION_ORDER.map((k) => (
            <TabsContent key={k} value={k} className="flex flex-col gap-5">
              <SectionErrors errors={serverErrors[k]} title="Ditolak server" />
              {k === "os" && (
                <TabOs
                  value={form.os}
                  onChange={(p) => update("os", p)}
                  hosts={hosts}
                />
              )}
              {k === "credentials" && (
                <TabCredentials
                  value={form.credentials}
                  onChange={(p) => update("credentials", p)}
                  hosts={hosts}
                  hasPassword={Boolean(config?.hasPassword)}
                  csvRows={csvRows}
                  onCsvRows={setCsvRows}
                />
              )}
              {k === "network" && (
                <TabNetwork
                  value={form.network}
                  onChange={(p) => update("network", p)}
                  ctx={ctx}
                />
              )}
              {k === "hostname" && (
                <TabHostname
                  form={form}
                  dirty={dirty}
                  onChange={(p) => update("hostname", p)}
                  ctx={ctx}
                />
              )}
              {k === "ssh" && (
                <TabSsh
                  value={form.ssh}
                  onChange={(p) => update("ssh", p)}
                  defaultUser={
                    dirty.has("credentials")
                      ? form.credentials.username
                      : (config?.username ?? "")
                  }
                />
              )}
              {dirty.has(k) && clientErrors[k]?.length ? (
                <SectionErrors errors={clientErrors[k]} />
              ) : null}
            </TabsContent>
          ))}
        </div>
      </Tabs>

      <SheetFooter className="gap-3 border-t border-border bg-canvas-soft">
        <div className="flex min-h-7 flex-wrap items-center gap-1.5">
          <span className="type-caption text-muted-foreground">
            {dirtyList.length ? "Akan disimpan:" : "Belum ada perubahan."}
          </span>
          {dirtyList.map((k) => (
            <Badge key={k} variant="outline" className="h-7 gap-1 overflow-visible bg-card pr-1">
              {SECTION_LABEL[k]}
              <Button
                variant="ghost"
                size="icon-xs"
                // Area klik 38px (padding box 22 + 2×8) tanpa membesarkan badge; badge overflow-visible agar
                // pseudo-element tidak terpotong (DR-3-3/DR-3-4).
                className="relative after:absolute after:-inset-2 after:content-['']"
                aria-label={`Batalkan perubahan ${SECTION_LABEL[k]}`}
                onClick={() => resetSection(k)}
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              </Button>
            </Badge>
          ))}
        </div>
        {installBlocked && (
          <p
            id="install-blocked"
            className="type-caption text-destructive"
          >
            Install tidak tersedia: {installBlocked}.
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button
            variant="outline"
            disabled={busy || dirtyList.length === 0 || blocking.length > 0}
            onClick={() => submit(false)}
          >
            {save.isPending && !confirmInstall && (
              <Spinner data-icon="inline-start" />
            )}
            Simpan konfigurasi
          </Button>
          <Button
            disabled={busy || blocking.length > 0 || Boolean(installBlocked)}
            aria-describedby={installBlocked ? "install-blocked" : undefined}
            onClick={() => setConfirmInstall(true)}
          >
            {dirtyList.length ? "Simpan & Install" : "Install"}
          </Button>
        </div>
      </SheetFooter>

      <AlertDialog open={confirmInstall} onOpenChange={setConfirmInstall}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Install OS ke{" "}
              {bulk ? (
                `${hosts.length} host`
              ) : (
                <span className="font-mono tracking-normal" data-testid="install-confirm-host">
                  {hosts[0].hostname ?? hosts[0].mac}
                </span>
              )}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <p>
                  {installOs ? (
                    <>
                      <span className="font-medium text-foreground">
                        {installOs}
                      </span>{" "}
                      akan di-install.{" "}
                    </>
                  ) : (
                    "OS sesuai konfigurasi masing-masing host. "
                  )}
                  <span className="font-medium text-destructive">
                    Seluruh isi disk target akan dihapus
                  </span>{" "}
                  dan tidak bisa dikembalikan.
                </p>
                <ul className="type-data flex flex-col gap-0.5 text-xs">
                  {hosts.slice(0, 5).map((h) => (
                    <li key={h.id}>
                      {h.mac}
                      {h.hostname ? ` · ${h.hostname}` : ""}
                    </li>
                  ))}
                  {hosts.length > 5 && (
                    <li>… dan {hosts.length - 5} host lainnya</li>
                  )}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                submit(true).finally(() => setConfirmInstall(false))
              }}
            >
              {busy && <Spinner data-icon="inline-start" />}
              Hapus disk & install
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
