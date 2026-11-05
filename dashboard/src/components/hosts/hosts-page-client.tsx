"use client"

import { useSearchParams } from "next/navigation"

import { HostsView } from "@/components/hosts/hosts-view"

/** Membaca ?q= (dari pencarian global) sebagai query awal tabel. */
export function HostsPageClient() {
  const q = useSearchParams().get("q") ?? ""
  return <HostsView key={q} initialQuery={q} />
}
