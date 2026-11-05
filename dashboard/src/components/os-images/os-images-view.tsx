"use client"

import * as React from "react"
import { toast } from "sonner"
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

function SourceCell({ img }: { img: OsImageInfo }) {
  const s = img.source
  if (!s) return <span className="text-muted-soft">—</span>
  const row = (label: string, v: string) => (
    <div className="flex gap-2">
      <span className="type-caption w-12 shrink-0 text-muted-foreground">{label}</span>
      {v ? (
        <span className="type-data text-xs wrap-anywhere">{v}</span>
      ) : (
        <span className="text-muted-soft">—</span>
      )}
    </div>
  )
  return (
    <div className="flex max-w-80 flex-col gap-0.5 whitespace-normal" data-testid="img-source">
      {row("kernel", s.kernel)}
      {row("initrd", s.initrd)}
      {row("repo", s.repo)}
      {img.repoUrl && (
        <div className="flex gap-2">
          <span className="type-caption w-12 shrink-0 text-muted-foreground">URL</span>
          <span className="type-data text-xs wrap-anywhere text-body" data-testid="img-repo-url">
            {img.repoUrl}
          </span>
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
      className="type-caption flex max-w-56 items-start gap-1.5 whitespace-normal text-muted-foreground"
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
  const [toDelete, setToDelete] = React.useState<OsImageInfo | null>(null)
  const del = useDeleteOsImage()
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  function closeDelete() {
    setToDelete(null)
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
          <Table data-testid="os-images-table">
            <TableHeader>
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
            <TableBody>
              {images.isPending
                ? Array.from({ length: 4 }, (_, i) => (
                    <TableRow key={i} className="hover:bg-transparent">
                      {Array.from({ length: COLS }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : list.map((img) => (
                    <TableRow key={img.id} data-testid="os-image-row" data-image-id={img.id}>
                      <TableCell className="pl-4 align-top">
                        <span className="type-data">{img.id}</span>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-foreground">{img.name}</span>
                          <span className="type-caption text-muted-foreground">{img.version}</span>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <span className="type-data">{img.arch}</span>
                      </TableCell>
                      <TableCell className="align-top text-body">{img.method}</TableCell>
                      <TableCell className="align-top">
                        <SourceCell img={img} />
                      </TableCell>
                      <TableCell className="align-top">
                        <AvailabilityCell img={img} />
                      </TableCell>
                      <TableCell className="align-top text-body">
                        {img.bootable ? "Ya" : "Tidak"}
                      </TableCell>
                      <TableCell className="align-top text-body" data-testid="img-used-by">
                        <span className="type-data text-xs">{img.usedBy ?? 0}</span> host
                      </TableCell>
                      <TableCell className="pr-4 text-right align-top">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Hapus ${img.id}`}
                          onClick={() => setToDelete(img)}
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

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && closeDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Hapus OS image <span className="type-data">{toDelete?.id}</span>?
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
