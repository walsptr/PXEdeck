import type { Metadata } from "next"

import { OsImagesView } from "@/components/os-images/os-images-view"

export const metadata: Metadata = { title: "OS Images" }

export default function Page() {
  return <OsImagesView />
}
