import type { z } from "zod"

import type { ApiFieldError } from "@/lib/host-config"

/** Baca + validasi body JSON. Mengembalikan data atau Response 400. */
export async function readJson<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ data: z.infer<T> } | { response: Response }> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return {
      response: Response.json(
        { error: "Body bukan JSON yang valid" },
        { status: 400 },
      ),
    }
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const errors: ApiFieldError[] = parsed.error.issues.map((i) => ({
      section: String(i.path[0] ?? "hostIds") as ApiFieldError["section"],
      message: `${i.path.join(".")}: ${i.message}`,
    }))
    return {
      response: Response.json(
        { error: "Input tidak valid", errors },
        { status: 400 },
      ),
    }
  }
  return { data: parsed.data }
}

export function validationFailed(errors: ApiFieldError[]) {
  return Response.json(
    { error: errors[0]?.message ?? "Validasi gagal", errors },
    { status: 422 },
  )
}
