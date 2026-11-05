/**
 * DR-5-3: pesan penolakan install dari server sudah diawali `"<label host>: "` (label =
 * hostname, atau MAC bila belum ada hostname). UI menampilkan label sekali dalam font mono, jadi
 * prefix itu dibuang dari pesan. Kontrak API tidak berubah; pesan tanpa prefix dikembalikan utuh.
 */
export function stripHostPrefix(
  message: string,
  labels: ReadonlyArray<string | null | undefined>,
): string {
  for (const l of labels) {
    if (!l) continue
    const prefix = `${l}: `
    if (message.startsWith(prefix)) return message.slice(prefix.length)
  }
  return message
}
