"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, ComputerIcon } from "@hugeicons/core-free-icons"
import {
  useTable,
  type ColumnFiltersState,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table"

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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
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
import {
  ConfigSheet,
  type ConfigSheetTarget,
} from "@/components/host-config/config-sheet"
import { PasswordsDialog } from "@/components/host-config/passwords-dialog"
import { BulkActionBar } from "@/components/hosts/bulk-action-bar"
import { columns, features, hostGlobalFilter } from "@/components/hosts/columns"
import {
  HostActionsProvider,
  type BulkAction,
  type HostAction,
} from "@/components/hosts/host-actions"
import { HostsToolbar } from "@/components/hosts/hosts-toolbar"
import { useDeleteHost, useHosts } from "@/hooks/use-hosts"
import {
  IN_PROGRESS_STATUSES,
  PROVISION_STATUSES,
  type Host,
  type ProvisionStatus,
} from "@/lib/types"
import type { SaveResult, SectionKey } from "@/lib/host-config"
import { cn } from "@/lib/utils"
import { useActiveNetwork } from "@/hooks/use-settings"

const EMPTY: Host[] = []
const DEFAULT_SORT: SortingState = [{ id: "lastSeen", desc: true }]

type Confirm = { kind: "delete"; host: Host } | null

/** Tab sheet yang dibuka oleh tiap aksi. */
const BULK_TAB: Record<BulkAction, SectionKey> = {
  install: "os",
  credentials: "credentials",
  hostname: "hostname",
  ip: "network",
  ssh: "ssh",
}

function filterValue<T>(
  filters: ColumnFiltersState,
  id: string,
): T | undefined {
  return filters.find((f) => f.id === id)?.value as T | undefined
}

function setFilter(
  filters: ColumnFiltersState,
  id: string,
  value: unknown,
): ColumnFiltersState {
  const rest = filters.filter((f) => f.id !== id)
  const empty = value == null || (Array.isArray(value) && value.length === 0)
  return empty ? rest : [...rest, { id, value }]
}

export function HostsView({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter()
  const { data, isPending, isError, error, isFetching, refetch } = useHosts()
  const deleteHost = useDeleteHost()

  const [sorting, setSorting] = React.useState<SortingState>(DEFAULT_SORT)
  const [globalFilter, setGlobalFilter] = React.useState(initialQuery)
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  )
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [confirm, setConfirm] = React.useState<Confirm>(null)
  const [sheet, setSheet] = React.useState<ConfigSheetTarget | null>(null)
  const [passwords, setPasswords] = React.useState<NonNullable<
    SaveResult["generatedPasswords"]
  > | null>(null)

  const hosts = data?.hosts ?? EMPTY

  const table = useTable({
    features,
    columns,
    data: hosts,
    getRowId: (h) => h.id,
    state: { sorting, globalFilter, columnFilters, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    globalFilterFn: hostGlobalFilter,
    getColumnCanGlobalFilter: (column) => column.id === "mac",
    enableSortingRemoval: false,
  })

  const statuses = filterValue<ProvisionStatus[]>(columnFilters, "status") ?? []
  const os = filterValue<string>(columnFilters, "os") ?? null

  const statusCounts = React.useMemo(() => {
    const counts = Object.fromEntries(
      PROVISION_STATUSES.map((s) => [s, 0]),
    ) as Record<ProvisionStatus, number>
    for (const h of hosts) counts[h.status]++
    return counts
  }, [hosts])
  const inProgress = IN_PROGRESS_STATUSES.reduce(
    (n, s) => n + statusCounts[s],
    0,
  )

  // Hanya host yang masih ada di data yang dihitung sebagai terpilih.
  const selectedHosts = table.getSelectedRowModel().rows.map((r) => r.original)

  const onHostAction = React.useCallback(
    (action: HostAction, host: Host) => {
      switch (action) {
        case "logs":
          router.push(`/jobs?host=${host.id}`)
          return
        case "reboot":
          // "Reboot ke PXE" butuh IPMI/Redfish (di luar M4; API → 501). Item menu nonaktif.
          return
        case "delete":
          setConfirm({ kind: "delete", host })
          return
        case "install":
        case "edit":
          setSheet({ hostIds: [host.id], tab: "os", preselect: action === "install" })
          return
      }
    },
    [router],
  )

  function onBulkAction(action: BulkAction) {
    // Urutan bulk = urutan tampilan tabel, lalu host terpilih yang tersembunyi filter.
    const visible = table
      .getRowModel()
      .rows.filter((r) => r.getIsSelected())
      .map((r) => r.id)
    const hidden = selectedHosts
      .map((h) => h.id)
      .filter((id) => !visible.includes(id))
    setSheet({
      hostIds: [...visible, ...hidden],
      tab: BULK_TAB[action],
      preselect: true,
    })
  }

  function runConfirm() {
    if (!confirm) return
    const { host } = confirm
    // DR-2-3: hostname/MAC di judul toast memakai mono.
    const name = <span className="type-data">{host.hostname ?? host.mac}</span>
    deleteHost.mutate(host.id, {
      onSuccess: () => {
        setRowSelection((old) => {
          const next = { ...old }
          delete next[host.id]
          return next
        })
        toast.success(<span>{name} dihapus dari daftar</span>)
      },
      onError: (e) =>
        toast.error(
          <span>Gagal menghapus {name}</span>,
          { description: e.message },
        ),
    })
    setConfirm(null)
  }

  function resetFilters() {
    setGlobalFilter("")
    setColumnFilters([])
  }

  const rows = table.getRowModel().rows

  return (
    <HostActionsProvider value={{ onHostAction }}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <HostsToolbar
            query={globalFilter}
            onQueryChange={setGlobalFilter}
            statuses={statuses}
            onStatusesChange={(s) =>
              setColumnFilters((f) => setFilter(f, "status", s))
            }
            statusCounts={statusCounts}
            os={os}
            onOsChange={(v) => setColumnFilters((f) => setFilter(f, "os", v))}
            onReset={resetFilters}
          />
          <div className="type-caption flex items-center gap-2 text-muted-foreground">
            {isFetching ? (
              <Spinner className="size-3.5" />
            ) : (
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  isError ? "bg-destructive" : "bg-success",
                )}
              />
            )}
            <span>
              <span className="type-data text-xs">{hosts.length}</span> host
              {inProgress > 0 && (
                <>
                  {" · "}
                  <span className="type-data text-xs">{inProgress}</span> sedang
                  provisioning
                </>
              )}
              {" · "}live, tiap 5 detik
            </span>
          </div>
        </div>

        {isError && (
          <Alert variant="destructive">
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
            <AlertTitle>Gagal memuat data host</AlertTitle>
            <AlertDescription>
              {error.message}. Dashboard akan mencoba lagi otomatis.
            </AlertDescription>
          </Alert>
        )}

        {!isPending && hosts.length === 0 && !isError ? (
          <NoHosts onRefresh={() => refetch()} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id}>
                    {group.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className={header.column.columnDef.meta?.headClassName}
                        aria-sort={ariaSort(header.column)}
                      >
                        {header.isPlaceholder ? null : (
                          <table.FlexRender header={header} />
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {isPending ? (
                  <LoadingRows cols={columns.length} />
                ) : rows.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={columns.length}
                      className="h-40 text-center"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-body">
                          Tidak ada host yang cocok dengan filter.
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={resetFilters}
                        >
                          Reset filter
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() ? "selected" : undefined}
                      className="group/row"
                    >
                      {row.getAllCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cell.column.columnDef.meta?.cellClassName}
                        >
                          <table.FlexRender cell={cell} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <BulkActionBar
          count={selectedHosts.length}
          hiddenCount={
            selectedHosts.length -
            table.getFilteredSelectedRowModel().rows.length
          }
          onAction={onBulkAction}
          onClear={() => setRowSelection({})}
        />
      </div>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus host?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm ? (
                <>
                  <span className="type-data">{confirm.host.mac}</span> akan
                  dihapus dari dashboard. Host akan muncul lagi sebagai
                  Discovered jika melakukan PXE boot.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={runConfirm}>
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ConfigSheet
        target={sheet}
        onClose={() => setSheet(null)}
        allHosts={hosts}
        onSaved={(r) =>
          r.generatedPasswords?.length && setPasswords(r.generatedPasswords)
        }
      />
      <PasswordsDialog
        passwords={passwords}
        onClose={() => setPasswords(null)}
      />
    </HostActionsProvider>
  )
}

function ariaSort(column: {
  getCanSort: () => boolean
  getIsSorted: () => false | "asc" | "desc"
}): React.AriaAttributes["aria-sort"] {
  if (!column.getCanSort()) return undefined
  const s = column.getIsSorted()
  return s === "asc" ? "ascending" : s === "desc" ? "descending" : "none"
}

function LoadingRows({ cols }: { cols: number }) {
  return Array.from({ length: 6 }, (_, i) => (
    <TableRow key={i} className="hover:bg-transparent">
      {Array.from({ length: cols }, (_, j) => (
        <TableCell key={j}>
          <Skeleton className={j === 0 ? "size-4" : "h-4 w-24"} />
        </TableCell>
      ))}
    </TableRow>
  ))
}

function NoHosts({ onRefresh }: { onRefresh: () => void }) {
  // Subnet aktif dari server (CR-2-6), bukan nilai lab hard-coded.
  const cidr = useActiveNetwork().data?.cidr
  return (
    <Empty className="rounded-xl border border-dashed border-border bg-canvas-soft py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={ComputerIcon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>Belum ada host</EmptyTitle>
        <EmptyDescription>
          Host akan muncul otomatis di sini saat melakukan PXE boot di jaringan
          provisioning{" "}
          {cidr ? <span className="type-data">{cidr}</span> : "management"}.
          Pastikan Network/PXE boot (IPv4) aktif di BIOS/UEFI node.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={onRefresh}>
          Muat ulang
        </Button>
      </EmptyContent>
    </Empty>
  )
}
