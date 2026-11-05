import type { Metadata } from "next"
import { Suspense } from "react"

import { HostsPageClient } from "@/components/hosts/hosts-page-client"

export const metadata: Metadata = { title: "Hosts" }

export default function HostsPage() {
  return (
    <Suspense>
      <HostsPageClient />
    </Suspense>
  )
}
