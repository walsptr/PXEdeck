import type { Metadata } from "next"
import { Suspense } from "react"

import { JobsView } from "@/components/jobs/jobs-view"

export const metadata: Metadata = { title: "Provisioning Jobs" }

export default function Page() {
  return (
    <Suspense>
      <JobsView />
    </Suspense>
  )
}
