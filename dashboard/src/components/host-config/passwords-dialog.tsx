"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, Download01Icon } from "@hugeicons/core-free-icons"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { downloadText } from "@/components/host-config/tab-credentials"
import { toCsv } from "@/lib/credentials"
import type { SaveResult } from "@/lib/host-config"

type Generated = NonNullable<SaveResult["generatedPasswords"]>

/**
 * Password acak hanya ada di memori browser sampai dialog ditutup —
 * server hanya menyimpan hash-nya. Karena ini satu-satunya kesempatan melihat
 * password, dialog tidak bisa ditutup (Escape, klik overlay, tombol) sebelum
 * CSV diunduh atau user mengonfirmasi sudah menyimpannya (CR-3-6).
 */
export function PasswordsDialog({
  passwords,
  onClose,
}: {
  passwords: Generated | null
  onClose: () => void
}) {
  const [downloaded, setDownloaded] = React.useState(false)
  const [confirmed, setConfirmed] = React.useState(false)
  // Reset saat batch password baru datang (prop `open` berubah tidak memanggil onOpenChange).
  const [shownFor, setShownFor] = React.useState(passwords)
  if (shownFor !== passwords) {
    setShownFor(passwords)
    setDownloaded(false)
    setConfirmed(false)
  }
  const canClose = downloaded || confirmed

  function close() {
    if (!canClose) return
    onClose()
  }

  function guard(e: Event) {
    if (!canClose) e.preventDefault()
  }

  function download() {
    if (!passwords) return
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "")
    downloadText(
      `pxe-passwords-${stamp}.csv`,
      toCsv([
        ["mac", "hostname", "username", "password"],
        ...passwords.map((p) => [
          p.mac,
          p.hostname ?? "",
          p.username,
          p.password,
        ]),
      ]) + "\r\n",
    )
    setDownloaded(true)
  }

  return (
    <Dialog
      open={passwords !== null}
      onOpenChange={(o) => {
        if (!o) close()
      }}
    >
      <DialogContent
        className="sm:max-w-xl"
        showCloseButton={false}
        onEscapeKeyDown={guard}
        onInteractOutside={guard}
      >
        <DialogHeader>
          <DialogTitle>Password acak dibuat</DialogTitle>
          <DialogDescription>
            {passwords?.length} host mendapat password unik. Server hanya
            menyimpan hash-nya.
          </DialogDescription>
        </DialogHeader>
        <Alert>
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          <AlertTitle>Hanya ditampilkan sekali</AlertTitle>
          <AlertDescription>
            Unduh CSV sekarang. Setelah dialog ditutup, password tidak bisa
            dilihat lagi — buat ulang jika hilang.
          </AlertDescription>
        </Alert>
        <div className="max-h-72 overflow-auto rounded-xl border border-border bg-card">
          <Table aria-label="Password yang dibuat">
            <TableHeader>
              <TableRow>
                <TableHead>MAC</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Password</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {passwords?.map((p) => (
                <TableRow key={p.mac} data-mac={p.mac}>
                  <TableCell className="type-data">
                    {p.mac}
                    {p.hostname && (
                      <span className="type-caption ml-1.5 text-muted-foreground">
                        {p.hostname}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="type-data">{p.username}</TableCell>
                  <TableCell className="type-data select-all">
                    {p.password}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          {!downloaded && (
            <Field orientation="horizontal" className="mr-auto w-auto">
              <Checkbox
                id="passwords-saved"
                checked={confirmed}
                onCheckedChange={(v) => setConfirmed(v === true)}
              />
              <FieldLabel htmlFor="passwords-saved" className="font-normal">
                Saya sudah menyimpan password
              </FieldLabel>
            </Field>
          )}
          <Button variant="outline" disabled={!canClose} onClick={close}>
            Selesai
          </Button>
          <Button onClick={download}>
            <HugeiconsIcon
              icon={Download01Icon}
              strokeWidth={2}
              data-icon="inline-start"
            />
            Unduh CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
