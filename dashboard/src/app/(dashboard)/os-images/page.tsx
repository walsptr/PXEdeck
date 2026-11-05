import type { Metadata } from "next"
import { DiscIcon } from "@hugeicons/core-free-icons"

import { PagePlaceholder } from "@/components/page-placeholder"

export const metadata: Metadata = { title: "OS Images" }

export default function Page() {
  return (
    <PagePlaceholder
      icon={DiscIcon}
      title="OS Images — dibangun di tahap 4"
      description="Daftar image installer (autoinstall, kickstart, preseed, unattend) dan registrasi ISO/URL."
    />
  )
}
