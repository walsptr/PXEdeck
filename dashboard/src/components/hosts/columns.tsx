"use client"

import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  metaHelper,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  type FilterFn,
  type Row,
} from "@tanstack/react-table"

import { Checkbox } from "@/components/ui/checkbox"
import { StatusPill } from "@/components/status-pill"
import { CopyButton } from "@/components/hosts/copy-button"
import { RowActions } from "@/components/hosts/host-actions"
import { SortableHeader } from "@/components/hosts/sortable-header"
import { LastSeen } from "@/components/hosts/last-seen"
import { ipToNumber } from "@/lib/format"
import { osLabel } from "@/lib/os-images"
import { PROVISION_STATUSES, type Host } from "@/lib/types"

export const features = tableFeatures({
  columnMeta: metaHelper<{ headClassName?: string; cellClassName?: string }>(),
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowSelectionFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
})

type F = typeof features

/** Normalisasi untuk pencarian MAC: "52-54-00", "525400", "52:54:00" setara. */
function compact(s: string) {
  return s.toLowerCase().replace(/[^0-9a-z.]/g, "")
}

/** Pencarian global: MAC, hostname, IP saat ini, IP management. */
export const hostGlobalFilter: FilterFn<F, Host> = (row, _columnId, value) => {
  const q = String(value ?? "")
    .trim()
    .toLowerCase()
  if (!q) return true
  const h = row.original
  const hay = [h.hostname, h.currentIp, h.mgmtIp].filter(Boolean) as string[]
  if (hay.some((v) => v.toLowerCase().includes(q))) return true
  const cq = compact(q)
  return cq.length > 0 && compact(h.mac).includes(cq)
}

/** Filter OS: cocok dengan OS terpasang ATAU yang ditugaskan; "none" = belum ada OS. */
const osFilter: FilterFn<F, Host> = (row, _columnId, value) => {
  if (!value) return true
  const h = row.original
  if (value === "none") return !h.osInstalled && !h.osAssigned
  return h.osInstalled === value || h.osAssigned === value
}

/** Filter status: nilai filter berupa daftar status yang diizinkan. */
const statusFilter: FilterFn<F, Host> = (row, _columnId, value) => {
  const allowed = value as Host["status"][] | undefined
  return !allowed?.length || allowed.includes(row.original.status)
}

const statusOrder = (s: Host["status"]) => PROVISION_STATUSES.indexOf(s)

function SelectCell({ row }: { row: Row<F, Host> }) {
  const handler = row.getToggleSelectedHandler()
  const checked = row.getIsSelected()
  return (
    <Checkbox
      checked={checked}
      aria-label={`Pilih ${row.original.hostname ?? row.original.mac}`}
      // Handler membaca target.checked + shiftKey (untuk seleksi rentang dengan Shift).
      onClick={(e) =>
        handler({
          target: { checked: !checked },
          shiftKey: e.shiftKey,
          nativeEvent: e.nativeEvent,
        })
      }
    />
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="type-data">{children}</span>
}

function Dash() {
  return <span className="text-muted-soft">—</span>
}

const helper = createColumnHelper<F, Host>()

export const columns = helper.columns([
  helper.display({
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllRowsSelected()
            ? true
            : table.getIsSomeRowsSelected()
              ? "indeterminate"
              : false
        }
        onCheckedChange={(v) => table.toggleAllRowsSelected(v === true)}
        aria-label="Pilih semua host"
      />
    ),
    cell: ({ row }) => <SelectCell row={row} />,
    meta: { headClassName: "w-10 pl-4", cellClassName: "pl-4" },
  }),
  helper.accessor("mac", {
    header: ({ column }) => (
      <SortableHeader column={column}>MAC Address</SortableHeader>
    ),
    sortFn: "alphanumeric",
    cell: ({ getValue }) => (
      <div className="flex items-center gap-1">
        <Mono>{getValue()}</Mono>
        <CopyButton value={getValue()} label="MAC" />
      </div>
    ),
  }),
  helper.accessor((h) => h.hostname ?? "", {
    id: "hostname",
    header: ({ column }) => (
      <SortableHeader column={column}>Hostname</SortableHeader>
    ),
    sortFn: "alphanumeric",
    sortUndefined: "last",
    cell: ({ row }) =>
      row.original.hostname ? <Mono>{row.original.hostname}</Mono> : <Dash />,
  }),
  helper.accessor((h) => ipToNumber(h.currentIp ?? h.mgmtIp), {
    id: "ip",
    header: ({ column }) => <SortableHeader column={column}>IP</SortableHeader>,
    sortFn: "basic",
    cell: ({ row }) => {
      const { currentIp, mgmtIp } = row.original
      return (
        <div className="flex flex-col gap-0.5">
          {currentIp ? <Mono>{currentIp}</Mono> : <Dash />}
          {mgmtIp && mgmtIp !== currentIp && (
            <span className="type-caption text-muted-foreground">
              mgmt <span className="type-data text-xs">{mgmtIp}</span>
            </span>
          )}
          {mgmtIp && mgmtIp === currentIp && (
            <span className="type-caption text-muted-foreground">
              mgmt statis
            </span>
          )}
        </div>
      )
    },
  }),
  helper.accessor((h) => h.vendor ?? "", {
    id: "vendor",
    header: ({ column }) => (
      <SortableHeader column={column}>Vendor</SortableHeader>
    ),
    sortFn: "alphanumeric",
    cell: ({ row }) =>
      row.original.vendor ? (
        <span className="text-body">{row.original.vendor}</span>
      ) : (
        <Dash />
      ),
  }),
  helper.accessor((h) => osLabel(h.osInstalled ?? h.osAssigned) ?? "", {
    id: "os",
    header: ({ column }) => <SortableHeader column={column}>OS</SortableHeader>,
    sortFn: "alphanumeric",
    filterFn: osFilter,
    cell: ({ row }) => {
      const { osInstalled, osAssigned } = row.original
      if (!osInstalled && !osAssigned) return <Dash />
      return (
        <div className="flex flex-col gap-0.5">
          {osInstalled ? (
            <span>{osLabel(osInstalled)}</span>
          ) : (
            <span className="text-muted-foreground">Belum terpasang</span>
          )}
          {osAssigned && (
            <span className="type-caption text-muted-foreground">
              → {osLabel(osAssigned)}
            </span>
          )}
        </div>
      )
    },
  }),
  helper.accessor("status", {
    header: ({ column }) => (
      <SortableHeader column={column}>Status</SortableHeader>
    ),
    sortFn: (a, b) =>
      statusOrder(a.original.status) - statusOrder(b.original.status),
    filterFn: statusFilter,
    cell: ({ getValue }) => <StatusPill status={getValue()} />,
  }),
  helper.accessor((h) => Date.parse(h.lastSeen), {
    id: "lastSeen",
    header: ({ column }) => (
      <SortableHeader column={column}>Last seen</SortableHeader>
    ),
    sortFn: "basic",
    sortDescFirst: true,
    cell: ({ row }) => <LastSeen iso={row.original.lastSeen} />,
  }),
  helper.display({
    id: "actions",
    header: () => <span className="sr-only">Aksi</span>,
    cell: ({ row }) => <RowActions host={row.original} />,
    meta: { headClassName: "w-12 pr-4", cellClassName: "pr-4 text-right" },
  }),
])
