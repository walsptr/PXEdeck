const rtf = new Intl.RelativeTimeFormat("id", { numeric: "auto" })

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
]

/** "baru saja", "2 menit yang lalu", "3 jam yang lalu", … */
export function formatRelative(iso: string, now: number): string {
  const diff = Date.parse(iso) - now
  if (Math.abs(diff) < 45_000) return "baru saja"
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms || unit === "minute") {
      return rtf.format(Math.round(diff / ms), unit)
    }
  }
  return "baru saja"
}

const dtf = new Intl.DateTimeFormat("id", {
  dateStyle: "medium",
  timeStyle: "medium",
})

export function formatDateTime(iso: string): string {
  return dtf.format(new Date(iso))
}

/** Bandingkan IPv4 secara numerik untuk sorting. */
export function ipToNumber(ip: string | null): number {
  if (!ip) return -1
  return ip.split(".").reduce((acc, oct) => acc * 256 + Number(oct), 0)
}
