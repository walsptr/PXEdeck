"use client"

import * as React from "react"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useJobLog, type LogConnection } from "@/hooks/use-job-log"
import { formatClock } from "@/lib/jobs"
import { cn } from "@/lib/utils"

/** DR-6-8: penjelasan 404 job, dipakai bersama log viewer dan detail job (tanpa mengulang judul). */
export const JOB_NOT_FOUND_EXPLANATION =
  "Mungkin sudah dihapus oleh retensi riwayat atau host dihapus."

const CONNECTION: Record<LogConnection, { label: string; dot: string; important?: boolean }> = {
  connecting: { label: "Menyambung…", dot: "bg-muted-soft" },
  live: { label: "Live", dot: "bg-success" },
  reconnecting: { label: "Terputus — mencoba ulang", dot: "bg-muted-soft" },
  polling: { label: "Live (polling tiap 5 dtk)", dot: "bg-success" },
  ended: { label: "Selesai", dot: "bg-muted-soft" },
  // CR-5-5 / M6: status final penting → bukan `muted` (DEC-017 §9).
  "not-found": { label: "Job tidak ditemukan", dot: "bg-destructive", important: true },
  session: { label: "Sesi berakhir — masuk lagi", dot: "bg-destructive", important: true },
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
            className={cn(
              "type-caption flex items-center gap-1.5",
              conn.important ? "text-foreground" : "text-muted-foreground",
            )}
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
          <p
            data-testid="log-empty"
            data-state={connection}
            className={cn(
              "px-4 py-2",
              connection === "not-found" || connection === "session"
                ? "text-body"
                : "text-muted-foreground",
            )}
          >
            {connection === "ended"
              ? "Job ini tidak punya log."
              : connection === "not-found"
                ? `Job tidak ditemukan — ${JOB_NOT_FOUND_EXPLANATION.toLowerCase()}`
                : connection === "session"
                  ? "Sesi berakhir. Masuk lagi untuk melihat log."
                  : "Menunggu log…"}
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
                    {/* CR-5-7: waktu kemunculan terakhir event gabungan. */}
                    {e.lastAt && e.lastAt !== e.at && (
                      <>
                        {" "}
                        · terakhir{" "}
                        <time dateTime={e.lastAt} data-testid="log-last-at">
                          {formatClock(e.lastAt)}
                        </time>
                      </>
                    )}
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
