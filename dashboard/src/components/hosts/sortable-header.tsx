"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
} from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"

type SortableColumn = {
  getIsSorted: () => false | "asc" | "desc"
  getToggleSortingHandler: () => undefined | ((event: unknown) => void)
}

/** Header kolom yang bisa di-sort; tetap memakai gaya label kolom tabel. */
export function SortableHeader({
  column,
  children,
}: {
  column: SortableColumn
  children: React.ReactNode
}) {
  const sorted = column.getIsSorted()
  const icon =
    sorted === "asc"
      ? ArrowUp01Icon
      : sorted === "desc"
        ? ArrowDown01Icon
        : ArrowUpDownIcon
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className={cn(
        "-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 uppercase transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/15",
        sorted && "text-foreground",
      )}
    >
      {children}
      <HugeiconsIcon
        icon={icon}
        strokeWidth={2}
        className={cn("size-3", !sorted && "opacity-40")}
      />
    </button>
  )
}
