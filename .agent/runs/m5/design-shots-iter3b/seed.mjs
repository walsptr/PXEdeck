import { createRequire } from "node:module"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
const DASH = "/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard"
const require = createRequire(path.join(DASH, "package.json"))
const { createJiti } = require("jiti")
const jiti = createJiti(path.join(DASH, "x.ts"), { alias: { "@": path.join(DASH, "src") } })
const ROOT = path.join(DASH, ".e2e-data/design-m5-iter3b")
const { openDbAt } = await jiti.import(path.join(DASH, "src/lib/server/db/index.ts"))
const { BUILTIN_SOURCES } = await jiti.import(path.join(DASH, "src/lib/server/db/seed.ts"))
for (const n of ["main", "insecure"]) openDbAt(path.join(ROOT, `db/${n}.db`), "demo").close()
for (const id of ["ubuntu-24.04", "debian-12", "rocky-9"]) {
  const s = BUILTIN_SOURCES[id].source
  for (const f of [s.kernel, s.initrd]) { mkdirSync(path.dirname(path.join(ROOT, "media", f)), { recursive: true }); writeFileSync(path.join(ROOT, "media", f), "dummy\n") }
}
mkdirSync(path.join(ROOT, "leases"), { recursive: true }); writeFileSync(path.join(ROOT, "leases/main.leases"), "")
console.log("ok")
