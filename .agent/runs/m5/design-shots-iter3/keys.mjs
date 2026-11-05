import { createRequire } from "node:module"
import path from "node:path"
const DASH = "/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard"
const require = createRequire(path.join(DASH, "package.json"))
const jiti = require("jiti").createJiti(path.join(DASH, "x.ts"), { alias: { "@": path.join(DASH, "src") } })
const F = await jiti.import(path.join(DASH, "src/test/fixtures.ts"))
for (const [name, k] of [["ops-laptop", F.SSH_ED25519_B], ["ci-runner-rsa-panjang-sekali-namanya", F.SSH_RSA], ["bastion-ecdsa", F.SSH_ECDSA]]) {
  const r = await fetch("http://localhost:3260/api/ssh-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, publicKey: k.publicKey }) })
  console.log(r.status, (await r.text()).slice(0, 150))
}
