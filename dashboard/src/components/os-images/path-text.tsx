import * as React from "react"
import { cn } from "cn"

/**
 * Path/URL mono yang dipenggal di "/" (DR-5-1): setiap segmen (beserta "/" penutupnya) adalah
 * `inline-block` sehingga baris hanya pecah di batas segmen — bukan per karakter atau di "-"
 * (`ubuntu-` / `24.04`). Segmen yang sendirian lebih lebar dari kolom tetap dipecah
 * (`wrap-anywhere` pada segmen) agar tidak melebar keluar. DR-5-12/DR-5-13: `wrap-anywhere`
 * (bukan `wrap-break-word`) karena hanya `anywhere` yang ikut mengecilkan lebar min-content — di
 * tabel `table-layout: auto` dan item flex kartu, `break-word` tetap memakai lebar token utuh
 * sebagai batas bawah sehingga tabel/kartu melebar. textContent tidak berubah.
 */
export function PathText({
  value,
  lead,
  className,
  ...props
}: React.ComponentProps<"span"> & {
  value: string
  /** Teks pembuka (mis. "(") yang menempel di segmen pertama — tidak tertinggal sendirian di ujung baris. */
  lead?: string
}) {
  const parts = value.split("/")
  return (
    <span
      data-slot="path-text"
      className={cn("type-data min-w-0 text-xs wrap-anywhere", className)}
      {...props}
    >
      {parts.map((p, i) => (
        <span key={i} data-slot="path-segment" className="inline-block max-w-full">
          {i === 0 && lead}
          {p}
          {i < parts.length - 1 && (
            <>
              /<wbr />
            </>
          )}
        </span>
      ))}
    </span>
  )
}

/** Token data teknis tanpa "/" (mis. id image) — mono, utuh bila muat, dipecah hanya bila lebih lebar dari baris. */
function DataToken({ value }: { value: string }) {
  return (
    <span data-slot="data-token" className="type-data inline-block max-w-full text-xs wrap-anywhere max-xl:inline">
      {value}
    </span>
  )
}

const MEDIA_MISSING_RE = /^Media (\S+) tidak tersedia \((\S+) tidak ada\)$/
const PATHISH_RE = /^([("'`[]*)(\S*\/\S*?)([)"'`\],.;:]*)$/

/**
 * Kalimat alasan "tidak tersedia" dengan data teknis mono (DR-5-11): path → `PathText` (pecah
 * hanya setelah "/"), id image → token mono utuh. DR-5-14: span kalimat TIDAK memakai
 * `wrap-anywhere` (kata biasa tidak dipenggal di tengah; `vmlinuz`/`ubuntu-22.04` tetap utuh) —
 * hanya token data yang lebih lebar dari baris yang dipecah. textContent = `reason` apa adanya.
 *
 * Format server dikenali: `Media <id> tidak tersedia (<path> tidak ada)`. Format lain: setiap
 * token yang memuat "/" dirender sebagai path; sisanya teks biasa.
 */
export function ReasonText({
  reason,
  className,
  ...props
}: React.ComponentProps<"span"> & { reason: string }) {
  const m = MEDIA_MISSING_RE.exec(reason)
  return (
    <span
      data-slot="reason-text"
      // BUG-M6-L2 (DR-5-8): di kartu (< xl) segmen path & id dirender `inline` (baris terisi penuh,
      // pecah diutamakan di "/" lewat <wbr>, `wrap-anywhere` path hanya bila satu segmen > baris) —
      // segmen inline-block meninggalkan sisa baris kosong sehingga kartu ID/path panjang > 520 px.
      // Tabel (≥ xl, DR-5-14) tetap inline-block: nama file/id tidak terbelah.
      className={cn("min-w-0 wrap-break-word max-xl:[&_[data-slot=path-segment]]:inline", className)}
      {...props}
    >
      {m ? (
        <>
          Media <DataToken value={m[1]} /> tidak tersedia <PathText lead="(" value={m[2]} /> tidak ada)
        </>
      ) : (
        reason.split(/(\s+)/).map((tok, i) => {
          const p = PATHISH_RE.exec(tok)
          if (!p || !p[2].replace(/\//g, "")) return <React.Fragment key={i}>{tok}</React.Fragment>
          return (
            <React.Fragment key={i}>
              <PathText lead={p[1]} value={p[2]} />
              {p[3]}
            </React.Fragment>
          )
        })
      )}
    </span>
  )
}
