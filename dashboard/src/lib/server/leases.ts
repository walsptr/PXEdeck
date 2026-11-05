// Parser file lease dnsmasq (M4-T3). Format baris IPv4:
//   <expiry-epoch> <mac> <ip> <hostname|*> <client-id|*>
// expiry 0 = tidak kedaluwarsa. Baris IPv6 (`duid …`, IP v6), MAC
// non-ethernet (`<hwtype>-…`), baris rusak, dan lease kedaluwarsa diabaikan.
// Satu MAC bisa punya beberapa lease (OVMF PXE vs iPXE memakai client-id
// berbeda) → semua IP dikembalikan.
import { readFileSync, statSync } from "node:fs"

import { isIpv4 } from "@/lib/net"
import { getSettings } from "@/lib/server/settings"

export type Lease = {
  mac: string
  ip: string
  /** Epoch detik; 0 = tak terbatas. */
  expiry: number
  hostname: string | null
}

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/

/** Parse isi file lease (fungsi murni). `nowSec` untuk menyaring lease lewat. */
export function parseLeases(text: string, nowSec: number): Lease[] {
  const out: Lease[] = []
  for (const raw of text.split("\n")) {
    const f = raw.trim().split(/\s+/)
    if (f.length < 4) continue
    const [exp, macRaw, ip, host] = f
    if (!/^\d{1,12}$/.test(exp)) continue
    const mac = macRaw.toLowerCase()
    if (!MAC_RE.test(mac) || !isIpv4(ip)) continue
    const expiry = Number(exp)
    if (expiry !== 0 && expiry <= nowSec) continue
    out.push({
      mac,
      ip,
      expiry,
      hostname: host === "*" || !/^[A-Za-z0-9.-]{1,63}$/.test(host) ? null : host,
    })
  }
  return out
}

/** MAC → himpunan IP lease aktif. */
export function leaseMap(leases: Lease[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const l of leases) {
    let s = m.get(l.mac)
    if (!s) m.set(l.mac, (s = new Set()))
    s.add(l.ip)
  }
  return m
}

type CacheEntry = { mtimeMs: number; size: number; text: string }
const cache = new Map<string, CacheEntry>()

/** Jumlah pembacaan file sebenarnya (untuk test cache). */
export let leaseFileReads = 0

/**
 * Baca file lease dengan cache berdasarkan mtime+ukuran. File tidak ada /
 * tidak terbaca → daftar kosong tanpa error. `force` = abaikan cache (dipakai
 * sebelum menolak request yang IP-nya belum ada di lease, R8).
 */
export function readLeaseFile(
  file: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  force = false,
): Lease[] {
  let st
  try {
    st = statSync(file)
  } catch {
    cache.delete(file)
    return []
  }
  let entry = cache.get(file)
  if (force || !entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
    try {
      const text = readFileSync(file, "utf8")
      leaseFileReads++
      entry = { mtimeMs: st.mtimeMs, size: st.size, text }
      cache.set(file, entry)
    } catch {
      return []
    }
  }
  return parseLeases(entry.text, nowSec)
}

/** Kosongkan cache (test). */
export function clearLeaseCache() {
  cache.clear()
  leaseFileReads = 0
}

/** Lease aktif dari `PXE_DNSMASQ_LEASES`; null bila tidak dikonfigurasi (dev). */
export function currentLeases(force = false): Lease[] | null {
  const file = getSettings().dnsmasqLeases
  return file ? readLeaseFile(file, Math.floor(Date.now() / 1000), force) : null
}

/**
 * Apakah `ip` termasuk IP lease `mac`? null bila lease tidak dikonfigurasi.
 * Bila belum cocok, file dibaca ulang sekali (lease baru ditulis dnsmasq
 * hampir bersamaan dengan request HTTP).
 */
export function ipMatchesLease(mac: string, ip: string | null): boolean | null {
  const first = currentLeases()
  if (first === null) return null
  if (!ip) return false
  const has = (ls: Lease[]) => ls.some((l) => l.mac === mac && l.ip === ip)
  if (has(first)) return true
  return has(currentLeases(true) ?? [])
}
