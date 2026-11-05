import type { Metadata } from "next"
import "./globals.css"

import { Toaster } from "@/components/ui/sonner"
import { Providers } from "@/components/providers"

export const metadata: Metadata = {
  title: { default: "PXE Lab", template: "%s · PXE Lab" },
  description: "Dashboard provisioning host lewat PXE boot",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full font-sans">
        <Providers>{children}</Providers>
        <Toaster theme="light" position="bottom-right" />
      </body>
    </html>
  )
}
