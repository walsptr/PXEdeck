"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useNow } from "@/hooks/use-now"
import { formatDateTime, formatRelative } from "@/lib/format"

export function LastSeen({ iso }: { iso: string }) {
  const now = useNow()
  if (!now) return <span className="text-muted-foreground">…</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="type-caption cursor-default text-body">
          {formatRelative(iso, now)}
        </span>
      </TooltipTrigger>
      <TooltipContent>{formatDateTime(iso)}</TooltipContent>
    </Tooltip>
  )
}
