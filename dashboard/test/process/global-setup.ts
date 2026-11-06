// Build standalone sekali sebelum uji level proses (plan §2.9). `PXE_PROCESS_REUSE_BUILD=1` memakai
// `.next/standalone/server.js` yang sudah ada (mis. run kedua berturut-turut); selain itu selalu build
// ulang dari sumber saat ini sehingga yang diuji = kode di working tree.
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

export const DASHBOARD = path.resolve(__dirname, "../..")
export const SERVER_JS = path.join(DASHBOARD, ".next/standalone/server.js")

export default function setup() {
  if (process.env.PXE_PROCESS_REUSE_BUILD === "1" && existsSync(SERVER_JS)) return
  execFileSync(process.execPath, [path.join(DASHBOARD, "node_modules/next/dist/bin/next"), "build"], {
    cwd: DASHBOARD,
    // Build tidak membutuhkan admin; env PXE_* pengembang tidak diteruskan (hanya flag standalone).
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PXE_STANDALONE: "1", NEXT_TELEMETRY_DISABLED: "1" } as unknown as NodeJS.ProcessEnv,
    stdio: ["ignore", "ignore", "inherit"],
    timeout: 600_000,
  })
  if (!existsSync(SERVER_JS)) throw new Error(`build standalone tidak menghasilkan ${SERVER_JS}`)
}
