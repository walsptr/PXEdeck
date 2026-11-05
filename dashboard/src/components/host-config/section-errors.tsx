import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon } from "@hugeicons/core-free-icons"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

/** Ringkasan error bagian ini (client + server). */
export function SectionErrors({
  errors,
  title,
}: {
  errors?: string[]
  title?: string
}) {
  if (!errors?.length) return null
  return (
    <Alert variant="destructive">
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
      <AlertTitle>{title ?? "Perlu diperbaiki"}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
