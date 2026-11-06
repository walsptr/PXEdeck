import * as React from "react"

/** IPv4, opsional dengan prefix CIDR (`10.99.0.0/24`). */
const IP_TOKEN = /\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?/g

/**
 * DR-6-7: pesan validasi jaringan (`lib/net.ts`, mis. "Di luar subnet 10.99.0.0/24") dipecah saat
 * render — IP/CIDR dirender mono (`type-data`, SPEC: data teknis mono), teks lain tetap sans. Teks
 * pesan dan textContent tidak berubah (API/test lain bergantung pada pesan persisnya).
 */
export function IpText({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(IP_TOKEN)) {
    const at = m.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    parts.push(
      <span key={at} data-slot="ip-token" className="type-data">
        {m[0]}
      </span>,
    )
    last = at + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
