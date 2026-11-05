import type { Metadata } from "next"
import { WorkflowSquare01Icon } from "@hugeicons/core-free-icons"

import { PagePlaceholder } from "@/components/page-placeholder"

export const metadata: Metadata = { title: "Provisioning Jobs" }

export default function Page() {
  return (
    <PagePlaceholder
      icon={WorkflowSquare01Icon}
      title="Provisioning Jobs — dibangun di tahap 5"
      description="Riwayat job per host, timeline tahapan, dan log streaming."
    />
  )
}
