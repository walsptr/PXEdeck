"use client"

import * as React from "react"

const TICK_MS = 15_000
/** Perubahan selisih jam di bawah ambang ini diabaikan (jitter latensi jaringan). */
const OFFSET_JITTER_MS = 1_000

const listeners = new Set<() => void>()
let now = Date.now()
let offset = 0
let timer: ReturnType<typeof setInterval> | null = null

function notify() {
  listeners.forEach((l) => l())
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  if (!timer) {
    timer = setInterval(() => {
      now = Date.now()
      notify()
    }, TICK_MS)
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

/**
 * Selaraskan jam klien dengan `serverTime` dari API (gap G2-4: clock skew). `lastSeen` dibuat
 * dengan jam server, jadi "x menit lalu" dihitung terhadap perkiraan jam server.
 */
export function syncServerClock(serverTimeIso: string, clientNow = Date.now()) {
  const server = Date.parse(serverTimeIso)
  if (Number.isNaN(server)) return
  const next = server - clientNow
  if (Math.abs(next - offset) < OFFSET_JITTER_MS) return
  offset = next
  now = clientNow
  notify()
}

/** Selisih jam server − klien saat ini (ms). */
export function serverClockOffset() {
  return offset
}

/** Waktu sekarang (jam server) yang diperbarui tiap 15 detik, untuk teks "x menit lalu". */
export function useNow() {
  return React.useSyncExternalStore(
    subscribe,
    () => now + offset,
    () => 0,
  )
}
