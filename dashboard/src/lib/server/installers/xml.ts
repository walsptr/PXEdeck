// Escape XML (O10): & < > " ' (teks dan atribut). Karakter kontrol selain
// TAB/LF/CR ditolak (tidak valid di XML 1.0).
export function xmlEscape(s: string): string {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)) throw new Error("Karakter kontrol tidak valid di XML")
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}
