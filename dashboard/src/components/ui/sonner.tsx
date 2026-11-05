"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { CheckmarkCircle02Icon, InformationCircleIcon, Alert02Icon, MultiplicationSignCircleIcon, Loading03Icon } from "@hugeicons/core-free-icons"

// Hanya tema terang (tanpa token `.dark`, CR-1-6): next-themes tidak dipakai.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: (
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4" />
        ),
        info: (
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} className="size-4" />
        ),
        warning: (
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-4" />
        ),
        error: (
          <HugeiconsIcon icon={MultiplicationSignCircleIcon} strokeWidth={2} className="size-4" />
        ),
        loading: (
          <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          // Panel mengambang: radius 12px seperti Sheet/Dialog (I-1-5).
          "--border-radius": "var(--radius-xl)",
        } as React.CSSProperties
      }
      toastOptions={{
        // DR-1-2: tanpa drop shadow (SPEC §1). Sonner menyetel `box-shadow: 0 4px 12px …` pada
        // `[data-sonner-toast][data-styled=true]` (juga saat :focus-visible) — ditimpa dengan
        // !important; fokus keyboard memakai ring spread-only (offset 0, blur 0). Hairline 1px.
        classNames: {
          toast:
            "cn-toast shadow-none! border! border-border! rounded-xl! focus-visible:ring-[3px] focus-visible:ring-ring/50",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
