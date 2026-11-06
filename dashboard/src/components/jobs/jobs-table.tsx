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

/**
 * DR-5-7: baris terpilih = `canvas-soft` + indikator kiri ink 2px (sel pertama; baris lain
 * transparan agar konten tidak bergeser). Teks muted di baris terpilih naik ke `text-body`
 * (#5a5852 di atas #fafaf7 ≈ 6.9:1) — muted #807d72 di sana hanya ≈ 3.9:1.
 */
const JOB_ROW = [
  "cursor-pointer focus-visible:bg-canvas-soft focus-visible:outline-none",
  "[&>td:first-child]:border-l-2 [&>td:first-child]:border-l-transparent",
  "data-[state=selected]:bg-canvas-soft data-[state=selected]:[&>td:first-child]:border-l-foreground",
  "data-[state=selected]:[&_.text-muted-foreground]:text-body",
].join(" ")

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
      <span
        data-testid="job-row-os"
        className="type-caption truncate text-body"
        title={label(job.osImageId) ?? undefined}
      >
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
          className="type-caption max-w-56 whitespace-normal text-body"
        >
          {reason}
        </span>
      )}
    </div>
  )
}

/** Dibuat (relatif, tooltip waktu absolut) + durasi job (mono) dalam satu sel. */
function TimeCell({ job }: { job: JobSummary }) {
  const now = useNow()
  if (!now) return <span className="text-muted-foreground">…</span>
  return (
    <div className="flex flex-col gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="type-caption cursor-default text-body" data-testid="job-row-created">
            {formatRelative(job.createdAt, now)}
          </span>
        </TooltipTrigger>
        <TooltipContent>{formatDateTime(job.createdAt)}</TooltipContent>
      </Tooltip>
      <span className="type-data text-xs text-muted-foreground" data-testid="job-row-duration">
        {formatDuration(jobDurationMs(job, now))}
      </span>
    </div>
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
    id: "time",
    header: "Dibuat / durasi",
    cell: ({ row }) => <TimeCell job={row.original} />,
    meta: { headClassName: "pr-4", cellClassName: "pr-4" },
  }),
])

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
          <TableRow
            key={group.id}
            className="hover:bg-transparent [&>th:first-child]:border-l-2 [&>th:first-child]:border-l-transparent"
          >
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
                className={JOB_ROW}
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
