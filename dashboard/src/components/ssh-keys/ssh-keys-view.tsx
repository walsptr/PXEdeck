"use client"

import * as React from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  Delete02Icon,
  Edit02Icon,
  Key01Icon,
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
import { Field, FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
import { AddKeyDialog } from "@/components/ssh-keys/add-key-dialog"
import {
  apiErrorMessage,
  useDeleteSshKey,
  useRenameSshKey,
  useSshKeyLibrary,
  type SshKeyInfo,
} from "@/hooks/use-ssh-keys"
import { formatDate, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

const COLS = 7

/**
 * DR-5-10 (M6): di bawah `lg` baris tabel → kartu (satu DOM, tanpa duplikasi testid — pola
 * OS Images DR-5-1). Urutan lewat `order`: (1) nama + tipe · hapus, (2) dibuat · dipakai,
 * (3) fingerprint mono utuh selebar kartu. Batas `lg` (bukan `md`): di 768–1023 px sidebar
 * terbuka menyisakan ±450 px sedangkan tabel butuh ±584 px (audit M6) → kolom Hapus terdorong
 * keluar. Tabel `≥ lg` tidak berubah.
 */
const ROW_MOBILE =
  "max-lg:flex max-lg:flex-wrap max-lg:items-start max-lg:gap-x-4 max-lg:gap-y-1.5 max-lg:px-4 max-lg:py-3"

/** Nama key yang bisa diubah langsung di tabel (PATCH `{name}`). */
function NameCell({
  k,
  editing,
  onEdit,
  onDone,
}: {
  k: SshKeyInfo
  editing: boolean
  onEdit: () => void
  onDone: () => void
}) {
  const [draft, setDraft] = React.useState(k.name)
  const rename = useRenameSshKey()
  const [error, setError] = React.useState<string | null>(null)

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1 max-lg:items-start">
          {/*
            DR-5-2: nama panjang dipotong (nama lengkap di `title`) agar kolom aksi tetap terlihat.
            DR-5-10: di kartu (< lg) nama dibungkus utuh (tanpa titik pecah → `wrap-anywhere`).
          */}
          <span
            className="max-w-48 truncate text-foreground max-lg:max-w-full max-lg:min-w-0 max-lg:overflow-visible max-lg:whitespace-normal max-lg:wrap-anywhere"
            title={k.comment ? `${k.name} (${k.comment})` : k.name}
            data-testid="key-name"
          >
            {k.name}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Ubah nama ${k.name}`}
            onClick={() => {
              setDraft(k.name)
              setError(null)
              onEdit()
            }}
          >
            <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
          </Button>
        </div>
        {/* Kolom Tipe disembunyikan di bawah xl → tipe tampil di bawah nama. */}
        <span className="type-data text-xs text-muted-foreground xl:hidden" data-testid="key-type-inline">
          {k.type}
        </span>
      </div>
    )
  }

  function save(e?: React.FormEvent) {
    e?.preventDefault()
    const name = draft.trim()
    if (name === k.name) return onDone()
    rename.mutate(
      { id: k.id, name },
      {
        onSuccess: () => onDone(),
        onError: (err) => setError(apiErrorMessage(err)),
      },
    )
  }

  return (
    <form
      onSubmit={save}
      className="flex min-w-64 flex-col gap-1 max-lg:w-full max-lg:min-w-0"
      data-testid="key-rename-form"
    >
      <Field data-invalid={Boolean(error) || undefined} className="gap-1">
        <div className="flex items-center gap-1.5">
          <Input
            autoFocus
            value={draft}
            maxLength={64}
            aria-label={`Nama baru untuk ${k.name}`}
            aria-invalid={Boolean(error) || undefined}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                onDone()
              }
            }}
            className="h-8"
          />
          <Button type="submit" variant="outline" size="sm" disabled={rename.isPending}>
            {rename.isPending && <Spinner data-icon="inline-start" />}
            Simpan
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={rename.isPending}>
            Batal
          </Button>
        </div>
        <FieldError className="whitespace-normal">{error}</FieldError>
      </Field>
    </form>
  )
}

/** Halaman SSH Keys (M5-T9, plan §2.8): library public key — tambah, ubah nama, hapus. */
export function SshKeysView() {
  const keys = useSshKeyLibrary()
  const [addOpen, setAddOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  // I-5-3: `toDelete` dipertahankan setelah dialog ditutup agar judul tidak kosong selama
  // animasi tutup; visibilitas dikendalikan `deleteOpen`.
  const [toDelete, setToDelete] = React.useState<SshKeyInfo | null>(null)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const del = useDeleteSshKey()
  const list = keys.data ?? []

  function closeDelete() {
    setDeleteOpen(false)
    setDeleteError(null)
    del.reset()
  }

  function runDelete() {
    if (!toDelete) return
    const k = toDelete
    setDeleteError(null)
    del.mutate(k.id, {
      onSuccess: () => {
        closeDelete()
        toast.success(
          <span>
            Key “{k.name}” dihapus
          </span>,
        )
      },
      onError: (e) => setDeleteError(e.message),
    })
  }

  return (
    <div className="flex flex-col gap-4" data-testid="ssh-keys-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="type-body max-w-2xl text-body">
          Library public key untuk di-inject ke <span className="type-data text-xs">authorized_keys</span>{" "}
          host saat instalasi. Hanya public key yang disimpan.
        </p>
        <Button onClick={() => setAddOpen(true)} data-testid="key-add">
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} data-icon="inline-start" />
          Tambah key
        </Button>
      </div>

      {keys.isError && (
        <Alert variant="destructive">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          <AlertTitle>Gagal memuat SSH key</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{keys.error.message}</span>
            <Button variant="outline" onClick={() => keys.refetch()}>
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!keys.isPending && !keys.isError && list.length === 0 ? (
        <Empty
          className="rounded-xl border border-dashed border-border bg-canvas-soft py-16"
          data-testid="ssh-keys-empty"
        >
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Key01Icon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>Belum ada SSH key</EmptyTitle>
            <EmptyDescription>
              Tambahkan public key di sini, atau dari tab SSH Keys saat mengonfigurasi host.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table data-testid="ssh-keys-table" className="max-lg:block">
            <TableHeader className="max-lg:hidden">
              <TableRow>
                <TableHead className="pl-4">Nama</TableHead>
                <TableHead className="max-xl:hidden">Tipe</TableHead>
                <TableHead>Fingerprint</TableHead>
                <TableHead className="max-2xl:hidden">Komentar</TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead>Dipakai</TableHead>
                <TableHead className="w-12 pr-4">
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="max-lg:block">
              {keys.isPending
                ? Array.from({ length: 3 }, (_, i) => (
                    <TableRow key={i} className={cn(ROW_MOBILE, "hover:bg-transparent")}>
                      {Array.from({ length: COLS }, (_, j) => (
                        <TableCell
                          key={j}
                          className={cn(
                            "max-lg:p-0",
                            j === 1 ? "max-xl:hidden" : j === 3 ? "max-2xl:hidden" : undefined,
                          )}
                        >
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : list.map((k) => (
                    <TableRow
                      key={k.id}
                      data-testid="ssh-key-row"
                      data-key-id={k.id}
                      className={ROW_MOBILE}
                    >
                      <TableCell className="pl-4 align-top max-lg:order-1 max-lg:min-w-0 max-lg:flex-1 max-lg:basis-[calc(100%-4rem)] max-lg:p-0 max-lg:whitespace-normal">
                        <NameCell
                          k={k}
                          editing={editingId === k.id}
                          onEdit={() => setEditingId(k.id)}
                          onDone={() => setEditingId(null)}
                        />
                      </TableCell>
                      <TableCell className="max-xl:hidden">
                        <span className="type-data text-xs">{k.type}</span>
                      </TableCell>
                      <TableCell className="max-lg:order-4 max-lg:min-w-0 max-lg:basis-full max-lg:p-0">
                        {/* DR-5-2: fingerprint boleh wrap (hash base64 tanpa spasi). DR-5-10: utuh selebar kartu. */}
                        <span
                          className="type-data block max-w-48 text-xs break-all whitespace-normal max-lg:max-w-full"
                          data-testid="key-fingerprint"
                        >
                          {k.fingerprint}
                        </span>
                      </TableCell>
                      <TableCell className="max-2xl:hidden">
                        {k.comment ? (
                          <span
                            className="type-data block max-w-40 truncate text-xs text-body"
                            title={k.comment}
                          >
                            {k.comment}
                          </span>
                        ) : (
                          <span className="text-muted-soft">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-lg:order-3 max-lg:p-0">
                        <span className="type-caption text-muted-foreground lg:hidden">Dibuat </span>
                        <time
                          dateTime={k.createdAt}
                          title={formatDateTime(k.createdAt)}
                          className="type-caption text-body"
                        >
                          {formatDate(k.createdAt)}
                        </time>
                      </TableCell>
                      <TableCell
                        className="text-body max-lg:order-3 max-lg:p-0"
                        data-testid="key-used-by"
                      >
                        <span className="type-caption text-muted-foreground lg:hidden">Dipakai </span>
                        <span className="type-data text-xs">{k.usedBy}</span> host
                      </TableCell>
                      <TableCell className="pr-4 text-right max-lg:order-2 max-lg:-my-1 max-lg:p-0">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Hapus ${k.name}`}
                          onClick={() => {
                            setToDelete(k)
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

      <AddKeyDialog open={addOpen} onOpenChange={setAddOpen} />

      <AlertDialog open={deleteOpen} onOpenChange={(o) => !o && closeDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Hapus key “{toDelete?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Key dihapus dari library; host yang sudah terpasang tidak berubah.
              {toDelete?.usedBy ? (
                <>
                  {" "}
                  Key ini masih dipakai{" "}
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
