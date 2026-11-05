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
import { PathText, ReasonText } from "@/components/os-images/path-text"
import { RegisterImageDialog } from "@/components/os-images/register-image-dialog"
import {
  useDeleteOsImage,
  useOsImages,
  type OsImageInfo,
} from "@/hooks/use-os-images"

const COLS = 7

/**
 * DR-5-1: baris tabel → kartu di bawah `xl` (flex-wrap; urutan sel lewat `order`):
 * (1) ID · dipakai · hapus, (2) nama + versi, (3) arsitektur · metode · bootable, lalu
 * ketersediaan (sebaris bila tersedia; alasan tidak tersedia di baris sendiri), (4) sumber.
 * DR-5-9: batas kartu dinaikkan dari `md` ke `xl` — tabel butuh kontainer ≥ ~950 px (1280 px ke
 * atas); di 768–1279 px tabel sebelumnya hanya bisa di-scroll horizontal.
 * DR-5-13: sel kartu `basis-full` (Nama, Sumber, Ketersediaan) diberi `min-w-0` — tanpa itu item
 * flex tidak bisa lebih sempit dari token terpanjangnya dan kartu meluber.
 */
const ROW_MOBILE =
  "max-xl:flex max-xl:flex-wrap max-xl:items-start max-xl:gap-x-3 max-xl:gap-y-1 max-xl:px-4 max-xl:py-3"

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
      className="flex w-full flex-col whitespace-normal xl:w-64 xl:gap-0.5"
      data-testid="img-source"
    >
      {row("kernel", s.kernel)}
      {row("initrd", s.initrd)}
      {/* Mobile: URL repo sudah berakhiran path repo → baris "repo" disembunyikan (DR-5-1). */}
      {row("repo", s.repo, img.repoUrl ? "max-xl:hidden" : undefined)}
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
      className="type-caption flex items-start gap-1.5 whitespace-normal text-muted-foreground xl:w-[24ch]"
      data-testid="img-available"
      data-available="false"
    >
      <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} className="mt-0.5 size-4 shrink-0" />
      {/*
        DR-5-11/DR-5-14 (M6): path & id di alasan dirender mono (`ReasonText`/`PathText`), dipecah
        hanya setelah "/" atau bila satu token lebih lebar dari baris. Span alasan sendiri TIDAK
        `wrap-anywhere` (kata/nama file tidak lagi terbelah, mis. `vml|inuz`); lebar kolom di desktop
        tetap `24ch` agar tidak menyempit oleh baris lain ber-ID/nama panjang.
      */}
      <ReasonText reason={img.reason ?? "Media tidak tersedia"} data-testid="img-reason" />
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
            DR-5-1: di bawah `xl` tabel dirender sebagai daftar kartu (satu DOM, tanpa duplikasi
            testid) — header disembunyikan, tiap baris jadi flex-wrap dengan label inline;
            kolom Sumber selebar kartu sehingga path tidak dipecah per karakter.
          */}
          <Table
            data-testid="os-images-table"
            // Padding horizontal sel tengah sedikit dirapatkan agar 7 kolom muat di 1280/1440 px tanpa
            // scroll horizontal (kolom Dipakai + aksi tetap terlihat, DR-5-9).
            className="max-xl:block xl:[&_td:not(:first-child):not(:last-child)]:px-2.5 xl:[&_th:not(:first-child):not(:last-child)]:px-2.5"
          >
            <TableHeader className="max-xl:hidden">
              <TableRow>
                <TableHead className="pl-4">ID</TableHead>
                <TableHead>Nama</TableHead>
                {/*
                  I-5-13 (opsional) TIDAK diterapkan: header "Arsitektur · Metode" (nowrap) melebarkan
                  kolom ±43 px sehingga tabel meluber di 1280 (audit M6). Tetap "Platform".
                */}
                <TableHead>Platform</TableHead>
                <TableHead>Sumber</TableHead>
                <TableHead>Ketersediaan</TableHead>
                <TableHead>Dipakai</TableHead>
                <TableHead className="w-12 pr-4">
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="max-xl:block">
              {images.isPending
                ? Array.from({ length: 4 }, (_, i) => (
                    <TableRow key={i} className={cn(ROW_MOBILE, "hover:bg-transparent")}>
                      {Array.from({ length: COLS }, (_, j) => (
                        <TableCell key={j} className="max-xl:p-0">
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
                      {/*
                        DR-5-8/DR-5-9: ID adalah data inti → dibungkus (wrap), bukan dipotong. Mobile:
                        sel flex-1 + min-w-0 sehingga ID panjang turun baris di dalam selnya sendiri
                        (tidak menimpa "Dipakai"/Hapus). Desktop: lebar kolom dibatasi agar tabel muat
                        tanpa scroll horizontal.
                      */}
                      <TableCell
                        className="pl-4 align-top whitespace-normal xl:max-w-44 max-xl:order-1 max-xl:min-w-0 max-xl:flex-1 max-xl:p-0"
                        data-testid="img-id"
                      >
                        {/*
                          min 12ch: id pendek (`ubuntu-24.04`) tidak dipecah di "-" di desktop.
                          DR-5-12: `wrap-anywhere` — ID tanpa "-" (48 karakter) tidak lagi menjadi
                          lebar minimum kolom sehingga tabel tetap muat di 1280 px.
                        */}
                        <span className="type-data inline-block max-w-full min-w-0 wrap-anywhere xl:min-w-[12ch]">
                          {img.id}
                        </span>
                      </TableCell>
                      <TableCell className="align-top whitespace-normal xl:max-w-40 max-xl:order-3 max-xl:min-w-0 max-xl:basis-full max-xl:p-0">
                        <div className="flex flex-col gap-0.5 max-xl:flex-row max-xl:flex-wrap max-xl:items-baseline max-xl:gap-x-1.5">
                          <span className="min-w-0 wrap-anywhere text-foreground" data-testid="img-name">
                            {img.name}
                          </span>
                          <span className="type-caption text-muted-foreground">{img.version}</span>
                        </div>
                      </TableCell>
                      {/*
                        DR-5-9: arsitektur · metode · bootable digabung satu kolom "Platform" (desktop:
                        bertumpuk; kartu: sebaris) agar tabel muat di 1280 px.
                      */}
                      <TableCell className="align-top text-body max-xl:order-4 max-xl:p-0" data-testid="img-platform">
                        <div className="flex flex-col gap-0.5 max-xl:flex-row max-xl:flex-wrap max-xl:gap-x-3">
                          <span className="type-data">{img.arch}</span>
                          <span>{img.method}</span>
                          <span className={cn(!img.bootable && "text-muted-foreground")}>
                            {img.bootable ? "bootable" : "tidak bootable"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="align-top max-xl:order-6 max-xl:min-w-0 max-xl:basis-full max-xl:p-0">
                        <SourceCell img={img} />
                      </TableCell>
                      <TableCell
                        className={cn(
                          "align-top max-xl:order-5 max-xl:min-w-0 max-xl:p-0",
                          !img.available && "max-xl:basis-full",
                        )}
                      >
                        <AvailabilityCell img={img} />
                      </TableCell>
                      <TableCell
                        className="align-top text-body max-xl:order-1 max-xl:p-0"
                        data-testid="img-used-by"
                      >
                        <span className="text-muted-foreground xl:hidden">Dipakai </span>
                        <span className="type-data text-xs">{img.usedBy ?? 0}</span> host
                      </TableCell>
                      {/* I-5-15: margin bawah -1 (bukan -1.5) agar kotak tombol tidak menyentuh baris nama. */}
                      <TableCell className="pr-4 text-right align-top max-xl:order-2 max-xl:-mt-1.5 max-xl:-mb-1 max-xl:p-0">
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
