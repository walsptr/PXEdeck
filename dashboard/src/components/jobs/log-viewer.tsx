"use client"

import * as React from "react"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useJobLog, type LogConnection } from "@/hooks/use-job-log"
import { formatClock } from "@/lib/jobs"
import { cn } from "@/lib/utils"

const CONNECTION: Record<LogConnection, { label: string; dot: string }> = {
  connecting: { label: "Menyambung…", dot: "bg-muted-soft" },
  live: { label: "Live", dot: "bg-success" },
  reconnecting: { label: "Terputus — mencoba ulang", dot: "bg-muted-soft" },
  polling: { label: "Live (polling tiap 5 dtk)", dot: "bg-success" },
  ended: { label: "Selesai", dot: "bg-muted-soft" },
}

/**
 * Log job live (plan §2.8): card putih hairline, mono 13 px, baris `HH:MM:SS sumber pesan`
 * (waktu & sumber muted), level error = `semantic-error`, event gabungan `×n`. Indikator koneksi
 * dan toggle "Ikuti log" (autoscroll ke baris terbaru).
 */
export function LogViewer({ jobId }: { jobId: string }) {
  const { events, connection } = useJobLog(jobId)
  const [follow, setFollow] = React.useState(true)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const conn = CONNECTION[connection]
  const switchId = React.useId()

  React.useEffect(() => {
    const el = scrollRef.current
    if (follow && el) el.scrollTop = el.scrollHeight
  }, [events, follow])

  return (
    <section
      aria-label="Log job"
      data-testid="job-log"
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="type-section-title">Log</h3>
          <span
            data-testid="log-connection"
            data-state={connection}
            role="status"
            className="type-caption flex items-center gap-1.5 text-muted-foreground"
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", conn.dot)} />
            {conn.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id={switchId}
            checked={follow}
            onCheckedChange={setFollow}
            data-testid="log-follow"
          />
          <Label htmlFor={switchId} className="type-caption text-body">
            Ikuti log
          </Label>
        </div>
      </div>
      <div
        ref={scrollRef}
        role="log"
        aria-label={`Log job ${jobId}`}
        tabIndex={0}
        data-testid="log-lines"
        className="h-96 overflow-auto rounded-xl border border-border bg-card py-2 font-mono text-[13px] leading-5 focus-visible:outline-2 focus-visible:outline-ring/50"
      >
        {events.length === 0 ? (
          <p className="px-4 py-2 text-muted-foreground">
            {connection === "ended" ? "Job ini tidak punya log." : "Menunggu log…"}
          </p>
        ) : (
          events.map((e) => (
            <div
              key={e.seq}
              data-testid="log-line"
              data-seq={e.seq}
              data-level={e.level}
              className={cn(
                "flex flex-wrap gap-x-3 px-4 whitespace-pre-wrap",
                e.level === "error" ? "text-destructive" : "text-foreground",
              )}
            >
              <span className="shrink-0 text-muted-foreground">{formatClock(e.at)}</span>
              <span className="w-24 shrink-0 truncate text-muted-foreground" title={e.source}>
                {e.source}
              </span>
              <span className="w-full min-w-0 wrap-anywhere sm:w-auto sm:flex-1">
                {e.message}
                {e.repeat > 1 && (
                  <span data-testid="log-repeat" className="ml-2 text-muted-foreground">
                    ×{e.repeat}
                  </span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
