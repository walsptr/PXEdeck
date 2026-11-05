// Writer baris untuk format berbasis baris (preseed, kickstart): setiap nilai
// wajib satu baris — CR/LF/NUL ditolak, sehingga input tidak bisa menambah
// direktif/section baru.
export function singleLine(v: string, what: string): string {
  if (/[\r\n\0]/.test(v)) throw new Error(`${what}: tidak boleh memuat baris baru`)
  return v
}

/** Baris preseed `d-i <key> <type> <value>`. */
export function di(key: string, type: string, value: string | boolean = ""): string {
  if (!/^[a-z0-9/_-]+$/i.test(key) || !/^[a-z]+$/.test(type)) throw new Error("kunci preseed tidak valid")
  const v = typeof value === "boolean" ? String(value) : singleLine(value, key)
  return v === "" ? `d-i ${key} ${type}` : `d-i ${key} ${type} ${v}`
}
