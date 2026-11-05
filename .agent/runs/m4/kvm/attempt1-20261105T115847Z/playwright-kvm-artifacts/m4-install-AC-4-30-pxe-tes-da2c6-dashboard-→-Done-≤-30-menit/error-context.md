# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m4-install.spec.ts >> AC-4.30 pxe-test-m4-node11 (uefi) install via dashboard → Done ≤ 30 menit
- Location: e2e-kvm/m4-install.spec.ts:58:7

# Error details

```
Error: expect(received).toMatchObject(expected)

- Expected  - 1
+ Received  + 1

  Object {
-   "firmware": "uefi",
+   "firmware": null,
    "vendor": "QEMU/KVM",
  }
```

# Test source

```ts
  1   | // Suite KVM M4 (M4-T13) — DIJALANKAN HANYA lewat `infra/kvm-run.sh m4` (lihat playwright.config.ts).
  2   | //  - AC-4.30 (UEFI, node11) / AC-4.33 (BIOS, node12): PXE boot → host muncul (vendor QEMU,
  3   | //    firmware) → Sheet: hostname <m>-nodeNN, IP statis 10.99.0.(10+NN)/24 gw 10.99.0.1 DNS 10.99.0.2,
  4   | //    user + password acak per run (tidak dicatat), key ed25519 sekali pakai, sudo, nonaktifkan
  5   | //    password SSH → Simpan & Install → `infra/node.sh reset` → status Booting → Installing →
  6   | //    Configuring → Done ≤ 30 menit (diamati di UI tanpa reload + API).
  7   | //  - AC-4.31: verify-node.sh lewat SSH dengan key yang di-inject; login password ditolak; reboot →
  8   | //    kembali dari disk (tanpa kernel installer kedua di serial log), status tetap Done.
  9   | //  - AC-4.32: selama job aktif, /boot/<mac>.ipxe dari host (10.99.0.1) → lokal tanpa token,
  10  | //    current_ip tidak berubah; token acak → 404.
  11  | //  - AC-4.34 (bagian harness): results.json + scan bukti (password run, token di path /boot/,
  12  | //    private key). Cleanup VM/network dilakukan kvm-run.sh (trap EXIT).
  13  | import { readFileSync, writeFileSync } from "node:fs"
  14  | import path from "node:path"
  15  | 
  16  | import { expect, test, type Page } from "@playwright/test"
  17  | 
  18  | import {
  19  |   consoleLog,
  20  |   installerBoots,
  21  |   KVM,
  22  |   kvmNodes,
  23  |   passwordLoginRejected,
  24  |   publicKey,
  25  |   randomPassword,
  26  |   record,
  27  |   resetNode,
  28  |   scanEvidence,
  29  |   ssh,
  30  |   writeResults,
  31  | } from "./kvm-harness"
  32  | 
  33  | test.describe.configure({ mode: "serial" })
  34  | 
  35  | const INSTALL_TIMEOUT_MS = 30 * 60_000
  36  | const PASSWORD = randomPassword()
  37  | const NODES = kvmNodes()
  38  | const shot = (name: string) => path.join(KVM.runsDir, "screenshots", `${name}.png`)
  39  | const hostId = (mac: string) => mac.replaceAll(":", "")
  40  | const TOKEN_RE = /\/boot\/[0-9a-f:]{17}\/[A-Za-z0-9_-]{43}\//
  41  | 
  42  | async function apiHost(page: Page, mac: string) {
  43  |   const r = await page.request.get(`/api/hosts/${hostId(mac)}`)
  44  |   return r.status() === 200 ? r.json() : null
  45  | }
  46  | 
  47  | test.afterAll(() => {
  48  |   const findings = scanEvidence([PASSWORD])
  49  |   writeFileSync(path.join(KVM.runsDir, "evidence-scan.txt"), findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password run, token /boot/, private key\n")
  50  |   record({ ac: "AC-4.34-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan`, evidence: ["evidence-scan.txt"] })
  51  |   writeResults({ nodes: NODES.map((n) => n.name) })
  52  | })
  53  | 
  54  | for (const node of NODES) {
  55  |   const ac = node.fw === "uefi" ? "AC-4.30" : "AC-4.33"
  56  |   const hostname = `${KVM.run}-node${node.nn}`
  57  | 
  58  |   test(`${ac} ${node.name} (${node.fw}) install via dashboard → Done ≤ 30 menit`, async ({ page }) => {
  59  |     const t0 = Date.now()
  60  |     const statusLog: string[] = []
  61  |     // ---- 1. discovery: node sudah PXE boot sejak dibuat kvm-run ----
  62  |     await page.goto("/hosts")
  63  |     await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true))
  64  |     const row = page.locator("main table").first().locator("tbody tr").filter({ has: page.getByText(node.mac, { exact: true }) })
  65  |     await expect(row).toHaveCount(1, { timeout: 10 * 60_000 })
  66  |     const discovered = await apiHost(page, node.mac)
> 67  |     expect(discovered).toMatchObject({ vendor: "QEMU/KVM", firmware: node.fw })
      |                        ^ Error: expect(received).toMatchObject(expected)
  68  |     await page.screenshot({ path: shot(`${node.name}-discovered`) })
  69  | 
  70  |     // ---- 2. konfigurasi lewat Sheet ----
  71  |     await row.getByRole("button", { name: /^Aksi untuk/ }).click()
  72  |     await page.getByRole("menuitem", { name: "Install OS" }).click()
  73  |     const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
  74  |     await sheet.locator('[id="os-ubuntu-24.04"]').click()
  75  |     await sheet.getByRole("tab", { name: /^Credentials/ }).click()
  76  |     await sheet.locator("#cred-user").fill(KVM.user)
  77  |     await sheet.locator("#cred-pass").fill(PASSWORD)
  78  |     if ((await sheet.locator("#cred-sudo").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-sudo").click()
  79  |     if ((await sheet.locator("#cred-nopw").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-nopw").click()
  80  |     await sheet.getByRole("tab", { name: /^Network/ }).click()
  81  |     await sheet.getByRole("radio", { name: "Static" }).click()
  82  |     await sheet.locator("#net-ip").fill(node.ip)
  83  |     await expect(sheet.locator("#net-gw")).toHaveValue(KVM.gateway)
  84  |     await expect(sheet.getByRole("button", { name: `Hapus DNS ${KVM.dns}` })).toBeVisible()
  85  |     await sheet.getByRole("tab", { name: /^Hostname/ }).click()
  86  |     await sheet.locator("#hn-name").fill(hostname)
  87  |     await sheet.getByRole("tab", { name: /^SSH Keys/ }).click()
  88  |     await sheet.getByRole("button", { name: "Tempel / unggah key baru" }).click()
  89  |     await sheet.locator("#key-0").fill(publicKey())
  90  |     await sheet.locator("#key-name-0").fill(`${KVM.run}-${node.nn}-run-key`)
  91  |     await page.screenshot({ path: shot(`${node.name}-sheet`), mask: [sheet.locator("#cred-pass")] })
  92  | 
  93  |     await sheet.getByRole("button", { name: "Simpan & Install" }).click()
  94  |     const confirm = page.getByRole("alertdialog", { name: /^Install OS ke / })
  95  |     const installed = page.waitForResponse((r) => r.url().endsWith(`/api/hosts/${hostId(node.mac)}/install`))
  96  |     await confirm.getByRole("button", { name: "Hapus disk & install" }).click()
  97  |     expect((await installed).status()).toBe(200)
  98  |     const pill = row.locator("[data-status]")
  99  |     await expect(pill).toHaveAttribute("data-status", "booting")
  100 |     statusLog.push(`${new Date().toISOString()} booting (UI)`)
  101 | 
  102 |     // ---- 3. AC-4.32: negatif selama job aktif (dari host 10.99.0.1) ----
  103 |     const before = await apiHost(page, node.mac)
  104 |     const local = await (await page.request.get(`/boot/${node.mac}.ipxe?platform=efi`)).text()
  105 |     const forged = await page.request.get(`/boot/${node.mac}/${"A".repeat(43)}/user-data`)
  106 |     const after = await apiHost(page, node.mac)
  107 |     const neg = !/\bkernel\b/.test(local) && !TOKEN_RE.test(local) && forged.status() === 404 && after.currentIp === before.currentIp
  108 |     writeFileSync(
  109 |       path.join(KVM.runsDir, `${node.name}-negative.txt`),
  110 |       `GET /boot/${node.mac}.ipxe dari host:\n${local}\nGET /boot/${node.mac}/<token-acak>/user-data → ${forged.status()}\ncurrent_ip sebelum=${before.currentIp} sesudah=${after.currentIp}\n`,
  111 |     )
  112 |     record({ ac: "AC-4.32", node: node.name, status: neg ? "PASS" : "FAIL", evidence: [`${node.name}-negative.txt`] })
  113 |     expect(neg).toBe(true)
  114 | 
  115 |     // ---- 4. reboot paksa node agar PXE boot ulang → installer ----
  116 |     resetNode(node)
  117 |     const seen = new Set<string>(["booting"])
  118 |     const deadline = Date.now() + INSTALL_TIMEOUT_MS
  119 |     let last = "booting"
  120 |     while (Date.now() < deadline) {
  121 |       const st = await pill.getAttribute("data-status")
  122 |       if (st && st !== last) {
  123 |         statusLog.push(`${new Date().toISOString()} ${st} (UI)`)
  124 |         seen.add(st)
  125 |         last = st
  126 |         await page.screenshot({ path: shot(`${node.name}-${st}`) })
  127 |       }
  128 |       if (st === "done" || st === "failed") break
  129 |       await page.waitForTimeout(2_000)
  130 |     }
  131 |     writeFileSync(path.join(KVM.runsDir, `${node.name}-status.txt`), statusLog.join("\n") + "\n")
  132 |     const durationS = Math.round((Date.now() - t0) / 1000)
  133 |     const ordered = ["booting", "installing", "configuring", "done"].every((s) => seen.has(s))
  134 |     record({ ac, node: node.name, status: ordered && last === "done" ? "PASS" : "FAIL", durationS, note: [...seen].join(" → "), evidence: [`${node.name}-status.txt`, `${node.name}-console.txt`] })
  135 |     expect(last, statusLog.join("\n")).toBe("done")
  136 |     expect([...seen]).toEqual(["booting", "installing", "configuring", "done"])
  137 |     expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
  138 |     const done = await apiHost(page, node.mac)
  139 |     expect(done).toMatchObject({ status: "done", osInstalled: "ubuntu-24.04", osAssigned: null, hostname, mgmtIp: node.ip })
  140 |   })
  141 | 
  142 |   test(`AC-4.31 ${node.name}: SSH key login, verifikasi, password ditolak, reboot dari disk`, async ({ page }) => {
  143 |     const t0 = Date.now()
  144 |     const env = [
  145 |       `EXPECT_HOSTNAME=${hostname}`,
  146 |       `EXPECT_IP=${node.ip}`,
  147 |       `EXPECT_PREFIX=${KVM.prefix}`,
  148 |       `EXPECT_MAC=${node.mac}`,
  149 |       `EXPECT_GW=${KVM.gateway}`,
  150 |       `EXPECT_DNS=${KVM.dns}`,
  151 |       `EXPECT_USER=${KVM.user}`,
  152 |       `EXPECT_PUBKEY='${publicKey()}'`,
  153 |     ].join(" ")
  154 |     const script = readFileSync(path.join(__dirname, "verify-node.sh"), "utf8")
  155 |     const v1 = ssh(node.ip, `${env} bash -s`, script)
  156 |     const pw = passwordLoginRejected(node.ip)
  157 |     const installsBefore = installerBoots(node)
  158 | 
  159 |     // Reboot → harus kembali dari disk (boot lokal), tanpa kernel installer kedua.
  160 |     ssh(node.ip, "sudo -n systemctl reboot")
  161 |     let back = false
  162 |     const deadline = Date.now() + 10 * 60_000
  163 |     await page.waitForTimeout(20_000)
  164 |     while (Date.now() < deadline) {
  165 |       if (ssh(node.ip, "true").code === 0) {
  166 |         back = true
  167 |         break
```