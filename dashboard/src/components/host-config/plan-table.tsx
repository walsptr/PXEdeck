import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { IpText } from "@/components/host-config/ip-text"
import type { Host } from "@/lib/types"

/** Preview pemetaan host → nilai baru (IP / hostname) dengan status per baris. */
export function PlanTable({
  hosts,
  rows,
  valueLabel,
  currentOf,
}: {
  hosts: Host[]
  rows: { hostId: string; value: string | null; error: string | null }[]
  valueLabel: string
  currentOf: (h: Host) => string | null
}) {
  const byId = new Map(hosts.map((h) => [h.id, h]))
  const bad = rows.filter((r) => r.error).length
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="type-column-label text-muted-foreground">Preview</span>
        <Badge variant={bad ? "destructive" : "secondary"}>
          {bad ? `${bad} bermasalah` : `${rows.length} host siap`}
        </Badge>
      </div>
      <div className="max-h-72 overflow-auto rounded-xl border border-border bg-card">
        <Table aria-label={`Preview ${valueLabel}`}>
          <TableHeader>
            <TableRow>
              <TableHead>MAC</TableHead>
              <TableHead>Saat ini</TableHead>
              <TableHead>{valueLabel}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const h = byId.get(r.hostId)!
              const cur = currentOf(h)
              return (
                <TableRow
                  key={r.hostId}
                  data-host-id={r.hostId}
                  data-state={r.error ? "error" : "ok"}
                >
                  <TableCell className="type-data">{h.mac}</TableCell>
                  <TableCell className="type-data text-muted-foreground">
                    {cur ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-col gap-0.5">
                      <span className="type-data">{r.value || "—"}</span>
                      {r.error && (
                        <span className="type-caption text-destructive">
                          <IpText text={r.error} />
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
