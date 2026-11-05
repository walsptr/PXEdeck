"use client"

import * as React from "react"
import { toast } from "sonner"
import { cn } from "cn"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  DiscIcon,
  InformationCircleIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"

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
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { RegisterImageDialog } from "@/components/os-images/register-image-dialog"
import {
  useDeleteOsImage,
  useOsImages,
  type OsImageInfo,
} from "@/hooks/use-os-images"

const COLS = 9

/**
 * DR-5-1: baris tabel → kartu di bawah `md` (flex-wrap; urutan sel lewat `order`):
 * (1) ID · dipakai · hapus, (2) nama + versi, (3) arsitektur · metode · bootable, lalu
 * ketersediaan (sebaris bila tersedia; alasan tidak tersedia di baris sendiri), (4) sumber.
 */
const ROW_MOBILE =
  "max-md:flex max-md:flex-wrap max-md:items-start max-md:gap-x-3 max-md:gap-y-1 max-md:px-4 max-md:py-3"

/**
 * Path/URL mono yang dipenggal di "/" (DR-5-1): setiap segmen (beserta "/" penutupnya) adalah
 * `inline-block` sehingga baris hanya pecah di batas segmen — bukan per karakter atau di "-"
 * (`ubuntu-` / `24.04`). Segmen yang sendirian lebih lebar dari kolom tetap dipecah
 * (`wrap-break-word`) agar tidak melebar keluar. textContent tidak berubah.
 */
function PathText({ value, className, ...props }: React.ComponentProps<"span"> & { value: string }) {
  const parts = value.split("/")
  return (
    <span className={cn("type-data min-w-0 text-xs wrap-break-word", className)} {...props}>
      {parts.map((p, i) => (
        <span key={i} className="inline-block max-w-full">
          {p}
          {i < parts.length - 1 && "/"}
        </span>
      ))}
    </span>
  )
}

function SourceCell({ img }: { img: OsImageInfo }) {
  const s = img.source
  if (!s) return <span className="text-muted-soft">—</span>
  const row = (label: string, v: string, className?: string) => (
    <div className={cn("flex gap-2", className)}>
      <span className="type-caption w-10 shrink-0 text-muted-foreground">{label}</span>
      {v ? <PathText value={v} /> : <span className="text-muted-soft">—</span>}
    </div>
  )
  return (
    <div
      className="flex w-full flex-col whitespace-normal md:w-64 md:gap-0.5"
      data-testid="img-source"
    >
      {row("kernel", s.kernel)}
      {row("initrd", s.initrd)}
      {/* Mobile: URL repo sudah berakhiran path repo → baris "repo" disembunyikan (DR-5-1). */}
      {row("repo", s.repo, img.repoUrl ? "max-md:hidden" : undefined)}
      {img.repoUrl && (
        <div className="flex gap-2">
          <span className="type-caption w-10 shrink-0 text-muted-foreground">URL</span>
          <PathText value={img.repoUrl} className="text-body" data-testid="img-repo-url" />
        </div>
      )}
    </div>
  )
}

/** DR-4-5: "tidak tersedia" = keterbatasan, bukan error → muted + ikon info (bukan merah). */
function AvailabilityCell({ img }: { img: OsImageInfo }) {
  if (img.available)
    return (
      <span className="flex items-center gap-1.5 text-body" data-testid="img-available" data-available="true">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4 text-success" />
        Tersedia
      </span>
    )
  return (
    <span
      className="type-caption flex items-start md:max-w-40 gap-1.5 whitespace-normal text-muted-foreground"
      data-testid="img-available"
      data-available="false"
    >
      <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} className="mt-0.5 size-4 shrink-0" />
      <span>{img.reason ?? "Media tidak tersedia"}</span>
    </span>
  )
}

/** Halaman OS Images (M5-T9, plan §2.8). */
export function OsImagesView() {
  const images = useOsImages()
  const [registerOpen, setRegisterOpen] = React.useState(false)
  // I-5-3: `toDelete` dipertahankan setelah dialog ditutup agar judul tidak kosong selama
  // animasi tutup; visibilitas dikendalikan `deleteOpen`.
  const [toDelete, setToDelete] = React.useState<OsImageInfo | null>(null)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const del = useDeleteOsImage()
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  function closeDelete() {
    setDeleteOpen(false)
    setDeleteError(null)
    del.reset()
  }

  function runDelete() {
    if (!toDelete) return
    const img = toDelete
    setDeleteError(null)
    del.mutate(img.id, {
      onSuccess: () => {
        closeDelete()
        toast.success(
          <span>
            OS image <span className="type-data">{img.id}</span> dihapus
          </span>,
        )
      },
      onError: (e) => setDeleteError(e.message),
    })
  }

  const list = images.data ?? []

  return (
    <div className="flex flex-col gap-4" data-testid="os-images-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="type-body max-w-2xl text-body">
          Image installer yang bisa ditugaskan ke host. Media dibaca dari root media server PXE;
          status ketersediaan diperiksa saat halaman dimuat.
        </p>
        <Button onClick={() => setRegisterOpen(true)} data-testid="img-register">
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} data-icon="inline-start" />
          Daftarkan image
        </Button>
      </div>

      {images.isError && (
        <Alert variant="destructive">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          <AlertTitle>Gagal memuat OS image</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{images.error.message}</span>
            <Button variant="outline" onClick={() => images.refetch()}>
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!images.isPending && !images.isError && list.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border bg-canvas-soft py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={DiscIcon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>Belum ada OS image</EmptyTitle>
            <EmptyDescription>
              Daftarkan image dari media yang sudah ada di server PXE.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {/*
            DR-5-1: di bawah `md` tabel dirender sebagai daftar kartu (satu DOM, tanpa duplikasi
            testid) — header disembunyikan, tiap baris jadi flex-wrap dengan label inline;
            kolom Sumber selebar kartu sehingga path tidak dipecah per karakter.
          */}
          <Table
            data-testid="os-images-table"
            // Padding horizontal sel tengah sedikit dirapatkan agar 9 kolom muat di 1440 px tanpa
            // scroll horizontal (kolom aksi tetap terlihat).
            className="max-md:block md:[&_td:not(:first-child):not(:last-child)]:px-2.5 md:[&_th:not(:first-child):not(:last-child)]:px-2.5"
          >
            <TableHeader className="max-md:hidden">
              <TableRow>
                <TableHead className="pl-4">ID</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Arsitektur</TableHead>
                <TableHead>Metode</TableHead>
                <TableHead>Sumber</TableHead>
                <TableHead>Ketersediaan</TableHead>
                <TableHead>Bootable</TableHead>
                <TableHead>Dipakai</TableHead>
                <TableHead className="w-12 pr-4">
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="max-md:block">
              {images.isPending
                ? Array.from({ length: 4 }, (_, i) => (
                    <TableRow key={i} className={cn(ROW_MOBILE, "hover:bg-transparent")}>
                      {Array.from({ length: COLS }, (_, j) => (
                        <TableCell key={j} className="max-md:p-0">
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : list.map((img) => (
                    <TableRow
                      key={img.id}
                      className={ROW_MOBILE}
                      data-testid="os-image-row"
                      data-image-id={img.id}
                    >
                      <TableCell className="pl-4 align-top max-md:order-1 max-md:min-w-0 max-md:flex-1 max-md:p-0">
                        <span className="type-data">{img.id}</span>
                      </TableCell>
                      <TableCell className="align-top max-md:order-3 max-md:basis-full max-md:p-0">
                        <div className="flex flex-col gap-0.5 max-md:flex-row max-md:flex-wrap max-md:items-baseline max-md:gap-x-1.5">
                          <span className="text-foreground">{img.name}</span>
                          <span className="type-caption text-muted-foreground">{img.version}</span>
                        </div>
                      </TableCell>
                      <TableCell className="align-top max-md:order-4 max-md:p-0">
                        <span className="type-data">{img.arch}</span>
                      </TableCell>
                      <TableCell className="align-top text-body max-md:order-4 max-md:p-0">
                        {img.method}
                      </TableCell>
                      <TableCell className="align-top max-md:order-6 max-md:basis-full max-md:p-0">
                        <SourceCell img={img} />
                      </TableCell>
                      <TableCell
                        className={cn(
                          "align-top max-md:order-5 max-md:p-0",
                          !img.available && "max-md:basis-full",
                        )}
                      >
                        <AvailabilityCell img={img} />
                      </TableCell>
                      <TableCell className="align-top text-body max-md:order-4 max-md:p-0">
                        <span className="max-md:hidden">{img.bootable ? "Ya" : "Tidak"}</span>
                        <span className="md:hidden">{img.bootable ? "bootable" : "tidak bootable"}</span>
                      </TableCell>
                      <TableCell
                        className="align-top text-body max-md:order-1 max-md:p-0"
                        data-testid="img-used-by"
                      >
                        <span className="text-muted-foreground md:hidden">Dipakai </span>
                        <span className="type-data text-xs">{img.usedBy ?? 0}</span> host
                      </TableCell>
                      <TableCell className="pr-4 text-right align-top max-md:order-2 max-md:-my-1.5 max-md:p-0">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Hapus ${img.id}`}
                          onClick={() => {
                            setToDelete(img)
                            setDeleteOpen(true)
                          }}
                        >
                          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>
      )}

      <RegisterImageDialog open={registerOpen} onOpenChange={setRegisterOpen} />

      <AlertDialog open={deleteOpen} onOpenChange={(o) => !o && closeDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Hapus OS image <span className="font-mono tracking-normal">{toDelete?.id}</span>?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Image dihapus dari katalog dashboard; file media di server tidak disentuh.
              {toDelete?.usedBy ? (
                <>
                  {" "}
                  Image ini masih dipakai{" "}
                  <span className="type-data text-xs">{toDelete.usedBy}</span> host — server akan
                  menolak penghapusan.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <Alert variant="destructive" data-testid="delete-error">
              <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
              <AlertTitle>Tidak bisa dihapus</AlertTitle>
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Batal</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={del.isPending}
              onClick={(e) => {
                e.preventDefault()
                runDelete()
              }}
            >
              {del.isPending && <Spinner data-icon="inline-start" />}
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
