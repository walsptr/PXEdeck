import type { z } from "zod"

import { parseHostId, type ApiFieldError } from "@/lib/host-config"

// Konvensi kode status API host:
//  400 `{error}`            id di URL bukan 12 hex, body bukan JSON
//  400 `{error, errors[]}`  body melanggar skema zod
//  404 `{error}`            id valid tetapi host tidak ada
//  422 `{error, errors[]}`  validasi semantik gagal (lihat config-service)

/** Pesan 400 untuk id host yang bentuknya salah. */
export const INVALID_HOST_ID = "ID host tidak valid (harus 12 digit hex)"

export function hostNotFound() {
  return Response.json({ error: "Host tidak ditemukan" }, { status: 404 })
}

/**
 * Validasi id host dari segmen URL `[id]`. Huruf besar dinormalisasi ke kecil;
 * selain 12 hex → Response 400.
 */
export function hostIdParam(
  raw: string,
): { id: string } | { response: Response } {
  const id = parseHostId(raw)
  if (!id) {
    return {
      response: Response.json({ error: INVALID_HOST_ID }, { status: 400 }),
    }
  }
  return { id }
}

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
