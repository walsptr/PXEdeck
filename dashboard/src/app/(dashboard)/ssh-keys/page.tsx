import type { Metadata } from "next"
import { Key01Icon } from "@hugeicons/core-free-icons"

import { PagePlaceholder } from "@/components/page-placeholder"

export const metadata: Metadata = { title: "SSH Keys" }

export default function Page() {
  return (
    <PagePlaceholder
      icon={Key01Icon}
      title="SSH Keys — dibangun di tahap 4"
      description="Library public key dengan fingerprint SHA256."
    />
  )
}
