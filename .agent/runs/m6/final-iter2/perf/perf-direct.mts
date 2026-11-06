// Pengukuran langsung redactSecrets best-of-5 ×10 untuk input SR-6-4 (sama dengan m6-iter2-be.test.ts:313-330).
// Pakai: node --experimental-strip-types perf-direct.mts <path redact.ts>
const { redactSecrets } = await import(process.argv[2])
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64")
const wrap = (s: string, w: number) => s.match(new RegExp(`.{1,${w}}`, "g"))!.join("\n")
const wrap76 = (s: string) => wrap(s, 76)
const cases: [string, string, number][] = [
  ["base64 ter-wrap 76 kolom tanpa secret (satu rangkaian)", wrap76(b64("z".repeat(12_400))), 20],
  ["banyak rangkaian 2 baris (76 + pendek) tanpa secret", `${wrap76(b64("q".repeat(80)))}\n`.repeat(140), 20],
  ["baris 76 kolom bergantian lebar 64", `${"A".repeat(76)}\n${"B".repeat(64)}\n`.repeat(115), 20],
  ["base64 bersarang 2 lapis ter-wrap (BARU, anggaran 50 ms)", wrap76(b64(wrap76(b64("w".repeat(8600))))), 50],
]
const bestOf = (n: number, f: () => void) => { let b = Infinity; for (let i = 0; i < n; i++) { const t = performance.now(); f(); b = Math.min(b, performance.now() - t) } return b }
for (const [name, input, limit] of cases) {
  const xs = Array.from({ length: 10 }, () => bestOf(5, () => redactSecrets(input)))
  console.log(`${name} (${input.length} char, batas test < ${limit} ms)`)
  console.log(`   redactSecrets best-of-5 x10: min ${Math.min(...xs).toFixed(2)} max ${Math.max(...xs).toFixed(2)} [${xs.map((x) => x.toFixed(1)).join(" ")}]`)
}
