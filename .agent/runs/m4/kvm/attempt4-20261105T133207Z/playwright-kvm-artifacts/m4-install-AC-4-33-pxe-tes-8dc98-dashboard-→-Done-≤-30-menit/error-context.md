# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m4-install.spec.ts >> AC-4.33 pxe-test-m4-node12 (bios) install via dashboard → Done ≤ 30 menit
- Location: e2e-kvm/m4-install.spec.ts:58:7

# Error details

```
Error: page.waitForResponse: Test ended.
```

# Test source

```ts
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
  49  |   writeFileSync(path.join(KVM.runsDir, "evidence-scan.txt"), findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password run, token /boot/, private key (teks & base64)\n")
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
  66  |     // Host bisa muncul lebih dulu dari lease dnsmasq (DHCP firmware PXE; firmware belum diketahui,
  67  |     // src/lib/server/discovery.ts) lalu firmware terisi saat iPXE meminta /boot/<mac>.ipxe?platform=.
  68  |     // Tunggu (poll) sampai keduanya tercatat; nilai yang dituntut tidak berubah.
  69  |     await expect
  70  |       .poll(async () => {
  71  |         const h = await apiHost(page, node.mac)
  72  |         return h && { vendor: h.vendor, firmware: h.firmware }
  73  |       }, { timeout: 5 * 60_000, intervals: [1_000, 2_000, 5_000] })
  74  |       .toEqual({ vendor: "QEMU/KVM", firmware: node.fw })
  75  |     await page.screenshot({ path: shot(`${node.name}-discovered`) })
  76  | 
  77  |     // ---- 2. konfigurasi lewat Sheet ----
  78  |     await row.getByRole("button", { name: /^Aksi untuk/ }).click()
  79  |     await page.getByRole("menuitem", { name: "Install OS" }).click()
  80  |     const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
  81  |     await sheet.locator('[id="os-ubuntu-24.04"]').click()
  82  |     await sheet.getByRole("tab", { name: /^Credentials/ }).click()
  83  |     await sheet.locator("#cred-user").fill(KVM.user)
  84  |     await sheet.locator("#cred-pass").fill(PASSWORD)
  85  |     if ((await sheet.locator("#cred-sudo").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-sudo").click()
  86  |     if ((await sheet.locator("#cred-nopw").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-nopw").click()
  87  |     await sheet.getByRole("tab", { name: /^Network/ }).click()
  88  |     await sheet.getByRole("radio", { name: "Static" }).click()
  89  |     await sheet.locator("#net-ip").fill(node.ip)
  90  |     await expect(sheet.locator("#net-gw")).toHaveValue(KVM.gateway)
  91  |     await expect(sheet.getByRole("button", { name: `Hapus DNS ${KVM.dns}` })).toBeVisible()
  92  |     await sheet.getByRole("tab", { name: /^Hostname/ }).click()
  93  |     await sheet.locator("#hn-name").fill(hostname)
  94  |     await sheet.getByRole("tab", { name: /^SSH Keys/ }).click()
  95  |     await sheet.getByRole("button", { name: "Tempel / unggah key baru" }).click()
  96  |     await sheet.locator("#key-0").fill(publicKey())
  97  |     await sheet.locator("#key-name-0").fill(`${KVM.run}-${node.nn}-run-key`)
  98  |     await page.screenshot({ path: shot(`${node.name}-sheet`), mask: [sheet.locator("#cred-pass")] })
  99  | 
  100 |     await sheet.getByRole("button", { name: "Simpan & Install" }).click()
  101 |     const confirm = page.getByRole("alertdialog", { name: /^Install OS ke / })
> 102 |     const installed = page.waitForResponse((r) => r.url().endsWith(`/api/hosts/${hostId(node.mac)}/install`))
      |                            ^ Error: page.waitForResponse: Test ended.
  103 |     await confirm.getByRole("button", { name: "Hapus disk & install" }).click()
  104 |     expect((await installed).status()).toBe(200)
  105 |     const pill = row.locator("[data-status]")
  106 |     await expect(pill).toHaveAttribute("data-status", "booting")
  107 |     statusLog.push(`${new Date().toISOString()} booting (UI)`)
  108 | 
  109 |     // ---- 3. AC-4.32: negatif selama job aktif (dari host 10.99.0.1) ----
  110 |     const before = await apiHost(page, node.mac)
  111 |     const local = await (await page.request.get(`/boot/${node.mac}.ipxe?platform=efi`)).text()
  112 |     const forged = await page.request.get(`/boot/${node.mac}/${"A".repeat(43)}/user-data`)
  113 |     const after = await apiHost(page, node.mac)
  114 |     const neg = !/\bkernel\b/.test(local) && !TOKEN_RE.test(local) && forged.status() === 404 && after.currentIp === before.currentIp
  115 |     writeFileSync(
  116 |       path.join(KVM.runsDir, `${node.name}-negative.txt`),
  117 |       `GET /boot/${node.mac}.ipxe dari host:\n${local}\nGET /boot/${node.mac}/<token-acak>/user-data → ${forged.status()}\ncurrent_ip sebelum=${before.currentIp} sesudah=${after.currentIp}\n`,
  118 |     )
  119 |     record({ ac: "AC-4.32", node: node.name, status: neg ? "PASS" : "FAIL", evidence: [`${node.name}-negative.txt`] })
  120 |     expect(neg).toBe(true)
  121 | 
  122 |     // ---- 4. reboot paksa node agar PXE boot ulang → installer ----
  123 |     resetNode(node)
  124 |     const seen = new Set<string>(["booting"])
  125 |     const deadline = Date.now() + INSTALL_TIMEOUT_MS
  126 |     let last = "booting"
  127 |     while (Date.now() < deadline) {
  128 |       const st = await pill.getAttribute("data-status")
  129 |       if (st && st !== last) {
  130 |         statusLog.push(`${new Date().toISOString()} ${st} (UI)`)
  131 |         seen.add(st)
  132 |         last = st
  133 |         await page.screenshot({ path: shot(`${node.name}-${st}`) })
  134 |       }
  135 |       if (st === "done" || st === "failed") break
  136 |       await page.waitForTimeout(2_000)
  137 |     }
  138 |     writeFileSync(path.join(KVM.runsDir, `${node.name}-status.txt`), statusLog.join("\n") + "\n")
  139 |     const durationS = Math.round((Date.now() - t0) / 1000)
  140 |     const ordered = ["booting", "installing", "configuring", "done"].every((s) => seen.has(s))
  141 |     record({ ac, node: node.name, status: ordered && last === "done" ? "PASS" : "FAIL", durationS, note: [...seen].join(" → "), evidence: [`${node.name}-status.txt`, `${node.name}-console.txt`] })
  142 |     expect(last, statusLog.join("\n")).toBe("done")
  143 |     expect([...seen]).toEqual(["booting", "installing", "configuring", "done"])
  144 |     expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
  145 |     const done = await apiHost(page, node.mac)
  146 |     expect(done).toMatchObject({ status: "done", osInstalled: "ubuntu-24.04", osAssigned: null, hostname, mgmtIp: node.ip })
  147 |   })
  148 | 
  149 |   test(`AC-4.31 ${node.name}: SSH key login, verifikasi, password ditolak, reboot dari disk`, async ({ page }) => {
  150 |     const t0 = Date.now()
  151 |     const env = [
  152 |       `EXPECT_HOSTNAME=${hostname}`,
  153 |       `EXPECT_IP=${node.ip}`,
  154 |       `EXPECT_PREFIX=${KVM.prefix}`,
  155 |       `EXPECT_MAC=${node.mac}`,
  156 |       `EXPECT_GW=${KVM.gateway}`,
  157 |       `EXPECT_DNS=${KVM.dns}`,
  158 |       `EXPECT_USER=${KVM.user}`,
  159 |       `EXPECT_PUBKEY='${publicKey()}'`,
  160 |     ].join(" ")
  161 |     const script = readFileSync(path.join(__dirname, "verify-node.sh"), "utf8")
  162 |     const v1 = ssh(node.ip, `${env} bash -s`, script)
  163 |     const pw = passwordLoginRejected(node.ip)
  164 |     const installsBefore = installerBoots(node)
  165 | 
  166 |     // Reboot → harus kembali dari disk (boot lokal), tanpa kernel installer kedua.
  167 |     ssh(node.ip, "sudo -n systemctl reboot")
  168 |     let back = false
  169 |     const deadline = Date.now() + 10 * 60_000
  170 |     await page.waitForTimeout(20_000)
  171 |     while (Date.now() < deadline) {
  172 |       if (ssh(node.ip, "true").code === 0) {
  173 |         back = true
  174 |         break
  175 |       }
  176 |       await page.waitForTimeout(5_000)
  177 |     }
  178 |     const v2 = back ? ssh(node.ip, `${env} bash -s`, script) : { code: -1, out: "node tidak kembali" }
  179 |     const installsAfter = installerBoots(node)
  180 |     const host = await (await page.request.get(`/api/hosts/${hostId(node.mac)}`)).json()
  181 |     const script2 = await (await page.request.get(`/boot/${node.mac}.ipxe?platform=${node.fw === "uefi" ? "efi" : "pcbios"}`)).text()
  182 |     writeFileSync(
  183 |       path.join(KVM.runsDir, `${node.name}-verify-ssh.txt`),
  184 |       [
  185 |         "# verify-node.sh sebelum reboot", v1.out, `# exit=${v1.code}`,
  186 |         "# login password (PreferredAuthentications=password)", pw.out.trim(), `# ditolak=${pw.ok}`,
  187 |         `# reboot: kembali=${back}`, "# verify-node.sh sesudah reboot", v2.out, `# exit=${v2.code}`,
  188 |         `# kernel installer di serial log: sebelum reboot=${installsBefore} sesudah=${installsAfter}`,
  189 |         `# status host sesudah reboot: ${host.status} osInstalled=${host.osInstalled} osAssigned=${host.osAssigned}`,
  190 |         `# /boot/${node.mac}.ipxe sesudah reboot:`, script2,
  191 |       ].join("\n") + "\n",
  192 |     )
  193 |     const pass = v1.code === 0 && pw.ok && back && v2.code === 0 && installsAfter === installsBefore && host.status === "done" && !/\bkernel\b/.test(script2)
  194 |     record({ ac: "AC-4.31", node: node.name, status: pass ? "PASS" : "FAIL", durationS: Math.round((Date.now() - t0) / 1000), evidence: [`${node.name}-verify-ssh.txt`] })
  195 |     expect(v1.code, v1.out).toBe(0)
  196 |     expect(pw.ok, pw.out).toBe(true)
  197 |     expect(back).toBe(true)
  198 |     expect(v2.code, v2.out).toBe(0)
  199 |     expect(installsAfter).toBe(installsBefore)
  200 |     expect(host).toMatchObject({ status: "done", osInstalled: "ubuntu-24.04", osAssigned: null })
  201 |     expect(script2).not.toMatch(/\bkernel\b/)
  202 |     expect(consoleLog(node).length).toBeGreaterThan(0)
```