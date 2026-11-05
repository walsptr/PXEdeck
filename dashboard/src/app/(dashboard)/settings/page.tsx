import type { Metadata } from "next"
import { Settings01Icon } from "@hugeicons/core-free-icons"

import { PagePlaceholder } from "@/components/page-placeholder"

export const metadata: Metadata = { title: "Settings" }

export default function Page() {
  return (
    <PagePlaceholder
      icon={Settings01Icon}
      title="Settings — dibangun di tahap 4"
      description="Interface, subnet DHCP, TFTP root, dan base URL HTTP server PXE."
    />
  )
}
