"use client"

import * as React from "react"
import {
  createColumnHelper,
  metaHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"

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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { StatusPill } from "@/components/status-pill"
import { useFailureText } from "@/hooks/use-jobs"
import { useNow } from "@/hooks/use-now"
import { useOsLabel } from "@/hooks/use-os-images"
import { formatDateTime, formatRelative } from "@/lib/format"
import { formatDuration, jobDurationMs } from "@/lib/jobs"
import type { JobSummary } from "@/lib/types"

const features = tableFeatures({
  columnMeta: metaHelper<{ headClassName?: string; cellClassName?: string }>(),
})

const helper = createColumnHelper<typeof features, JobSummary>()

function HostCell({ job }: { job: JobSummary }) {
  const label = useOsLabel()
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="type-data truncate text-foreground">
        {job.host?.hostname ?? job.host?.mac ?? job.hostId}
      </span>
      {job.host?.hostname && (
        <span className="type-data truncate text-xs text-muted-foreground">
          {job.host.mac}
        </span>
      )}
      <span data-testid="job-row-os" className="type-caption truncate text-body">
        {label(job.osImageId)}
      </span>
    </div>
  )
}

function StatusCell({ job }: { job: JobSummary }) {
  const failureText = useFailureText()
  const reason = job.status === "failed" ? failureText(job.failureReason) : null
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusPill status={job.status} />
      {reason && (
        <span
          data-testid="job-row-failure"
          className="type-caption max-w-56 whitespace-normal text-muted-foreground"
        >
          {reason}
        </span>
      )}
    </div>
  )
}

function CreatedCell({ iso }: { iso: string }) {
  const now = useNow()
  if (!now) return <span className="text-muted-foreground">…</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="type-caption cursor-default text-body">
          {formatRelative(iso, now)}
        </span>
      </TooltipTrigger>
      <TooltipContent>{formatDateTime(iso)}</TooltipContent>
    </Tooltip>
  )
}

function DurationCell({ job }: { job: JobSummary }) {
  const now = useNow()
  if (!now && !job.finishedAt) return <span className="text-muted-foreground">…</span>
  return (
    <span className="type-data text-xs text-body">
      {formatDuration(jobDurationMs(job, now))}
    </span>
  )
}

const columns = helper.columns([
  helper.display({
    id: "host",
    header: "Host / OS",
    cell: ({ row }) => <HostCell job={row.original} />,
    meta: { headClassName: "pl-4", cellClassName: "pl-4 max-w-48" },
  }),
  helper.display({
    id: "status",
    header: "Status",
    cell: ({ row }) => <StatusCell job={row.original} />,
  }),
  helper.display({
    id: "created",
    header: "Dibuat",
    cell: ({ row }) => <CreatedCell iso={row.original.createdAt} />,
  }),
  helper.display({
    id: "duration",
    header: "Durasi",
    cell: ({ row }) => <DurationCell job={row.original} />,
    meta: { headClassName: "pr-4", cellClassName: "pr-4" },
  }),
])

export const JOBS_TABLE_COLUMNS = columns.length

/** Daftar job (TanStack Table). Klik baris / Enter memilih job untuk panel detail. */
export function JobsTable({
  jobs,
  loading,
  selectedId,
  onSelect,
  empty,
}: {
  jobs: JobSummary[]
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  empty: React.ReactNode
}) {
  const table = useTable({
    features,
    columns,
    data: jobs,
    getRowId: (j) => j.id,
  })
  const rows = table.getRowModel().rows

  return (
    <Table data-testid="jobs-table">
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((header) => (
              <TableHead
                key={header.id}
                className={header.column.columnDef.meta?.headClassName}
              >
                {header.isPlaceholder ? null : <table.FlexRender header={header} />}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {loading ? (
          Array.from({ length: 5 }, (_, i) => (
            <TableRow key={i} className="hover:bg-transparent">
              {columns.map((c) => (
                <TableCell key={c.id}>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={columns.length} className="h-32 text-center">
              {empty}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => {
            const selected = row.id === selectedId
            return (
              <TableRow
                key={row.id}
                data-testid="job-row"
                data-job-id={row.id}
                data-state={selected ? "selected" : undefined}
                aria-current={selected ? "true" : undefined}
                tabIndex={0}
                onClick={() => onSelect(row.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSelect(row.id)
                  }
                }}
                className="cursor-pointer focus-visible:bg-canvas-soft focus-visible:outline-none"
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
            )
          })
        )}
      </TableBody>
    </Table>
  )
}
