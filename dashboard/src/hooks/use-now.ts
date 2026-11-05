"use client"

import * as React from "react"

const listeners = new Set<() => void>()
let now = Date.now()
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  if (!timer) {
    timer = setInterval(() => {
      now = Date.now()
      listeners.forEach((l) => l())
    }, 15_000)
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

/** Waktu sekarang yang diperbarui tiap 15 detik, untuk teks "x menit lalu". */
export function useNow() {
  return React.useSyncExternalStore(
    subscribe,
    () => now,
    () => 0,
  )
}
