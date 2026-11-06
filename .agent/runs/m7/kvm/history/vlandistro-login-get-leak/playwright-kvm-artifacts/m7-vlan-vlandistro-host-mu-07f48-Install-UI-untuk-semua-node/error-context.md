# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m7-vlan.spec.ts >> vlandistro: host muncul tanpa reload → Sheet VLAN 20 → Simpan & Install (UI) untuk semua node
- Location: e2e-kvm/m7-vlan.spec.ts:320:7

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/hosts$/
Received string:  "http://10.99.0.2/login?username=pxeadmin&password=<REDACTED-admin-password>"
Timeout: 30000ms

Call log:
  - Expect "toHaveURL" with timeout 30000ms
    63 × locator resolved to <html lang="id" class="h-full antialiased">…</html>
       - unexpected value "http://10.99.0.2/login?username=pxeadmin&password=<REDACTED-admin-password>"

```

```yaml
- main:
  - text: PXE Lab
  - region "Masuk":
    - heading "Masuk" [level=1]
    - paragraph: Masuk sebagai admin untuk mengelola host PXE dan provisioning OS.
    - form "Masuk":
      - group:
        - text: Username
        - textbox "Username"
      - group:
        - text: Password
        - group:
          - textbox "Password"
          - group:
            - button "Tampilkan kata sandi":
              - img
      - button "Masuk"
- region "Notifications alt+T"
- alert
```

# Test source

```ts
  145 | function pwRejected(out: string): boolean {
  146 |   const methods = (/Permission denied \(([a-z,-]*)\)/.exec(out)?.[1] ?? "").split(",")
  147 |   return !out.includes("(exit 0)") && methods.includes("publickey") && !methods.includes("password") && !methods.includes("keyboard-interactive")
  148 | }
  149 | 
  150 | /** Sheet lengkap satu host lewat UI (tab Network VLAN-aware) → Simpan & Install. */
  151 | async function configureInstall(node: KvmNode, first: boolean): Promise<Locator> {
  152 |   const row = hostRow(node.mac)
  153 |   await expect(row).toHaveCount(1, { timeout: 10 * 60_000 })
  154 |   await row.getByRole("button", { name: /^Aksi untuk/ }).click()
  155 |   await page.getByRole("menuitem", { name: "Install OS" }).click()
  156 |   const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
  157 |   await sheet.locator(`[id="os-${OS_ID[node.os]}"]`).click()
  158 |   await sheet.locator("#os-disk").fill("")
  159 |   await sheet.getByRole("tab", { name: /^Credentials/ }).click()
  160 |   await sheet.locator("#cred-user").fill(KVM.user)
  161 |   if (first) {
  162 |     await sheet.getByRole("button", { name: "Buat password acak" }).click()
  163 |     const v = await sheet.locator("#cred-pass").inputValue()
  164 |     expect(v.length).toBeGreaterThanOrEqual(12)
  165 |     generated.push(v)
  166 |   } else {
  167 |     await sheet.locator("#cred-pass").fill(PASSWORD)
  168 |   }
  169 |   if ((await sheet.locator("#cred-sudo").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-sudo").click()
  170 |   if ((await sheet.locator("#cred-nopw").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-nopw").click()
  171 |   await sheet.getByRole("tab", { name: /^Network/ }).click()
  172 |   await sheet.getByRole("radio", { name: "Static" }).click()
  173 |   // Tab Network VLAN-aware (M7-T6): VLAN terdaftar → prefix & gateway jaringan VLAN terisi otomatis.
  174 |   await sheet.locator("#net-vlan").fill(String(VLAN))
  175 |   await expect(sheet.locator("#net-gw")).toHaveValue(KVM.gateway)
  176 |   await expect(sheet.locator("#net-prefix")).toHaveValue(String(KVM.prefix))
  177 |   await sheet.locator("#net-ip").fill(node.ip)
  178 |   await expect(sheet.locator('[data-slot="field-error"]')).toHaveCount(0)
  179 |   await expect(sheet.getByRole("button", { name: `Hapus DNS ${KVM.dns}` })).toBeVisible()
  180 |   await sheet.getByRole("tab", { name: /^Hostname/ }).click()
  181 |   await sheet.locator("#hn-name").fill(node.hostname)
  182 |   await sheet.getByRole("tab", { name: /^SSH Keys/ }).click()
  183 |   const [kType, kBlob] = publicKey().split(/\s+/)
  184 |   const lib = (await (await page.request.get("/api/ssh-keys")).json()) as { id: string; publicKey: string }[]
  185 |   const inLib = lib.find((k) => k.publicKey.split(/\s+/)[1] === kBlob && k.publicKey.startsWith(kType))
  186 |   if (inLib) {
  187 |     const cb = sheet.locator(`[id="lib-${inLib.id}"]`)
  188 |     if ((await cb.getAttribute("aria-checked")) !== "true") await cb.click()
  189 |     await expect(cb).toHaveAttribute("aria-checked", "true")
  190 |   } else {
  191 |     await sheet.getByRole("button", { name: "Tempel / unggah key baru" }).click()
  192 |     await sheet.locator("#key-0").fill(publicKey())
  193 |     await sheet.locator("#key-name-0").fill(`${KVM.run}-run-key`)
  194 |   }
  195 |   await sheet.getByRole("tab", { name: /^Network/ }).click()
  196 |   await page.screenshot({ path: shot(`${node.name}-sheet-network`), mask: [sheet.locator("#cred-pass")] })
  197 |   await sheet.getByRole("button", { name: "Simpan & Install" }).click()
  198 |   const confirm = page.getByRole("alertdialog", { name: /^Install OS ke / })
  199 |   const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/hosts/${hostId(node.mac)}`), { timeout: 60_000 })
  200 |   const installed = page.waitForResponse((r) => r.url().endsWith(`/api/hosts/${hostId(node.mac)}/install`), { timeout: 60_000 })
  201 |   await confirm.getByRole("button", { name: "Hapus disk & install" }).click()
  202 |   const s = await saved
  203 |   const sentBody = s.request().postDataJSON() as { network?: { vlan?: number; gateway?: string; prefix?: number } }
  204 |   expect(s.status(), await s.text()).toBe(200)
  205 |   expect((await installed).status()).toBe(200)
  206 |   const pill = row.locator("[data-status]").first()
  207 |   await expect(pill).toHaveAttribute("data-status", "booting")
  208 |   note(node, `install dibuat (UI) os=${OS_ID[node.os]} ip=${node.ip}/${KVM.prefix} vlan=${sentBody.network?.vlan} gw=${sentBody.network?.gateway} generator=${first}`)
  209 |   resetNode(node)
  210 |   note(node, "node.sh reset")
  211 |   return pill
  212 | }
  213 | 
  214 | type Watch = { seen: string[]; last: string; doneS: number }
  215 | 
  216 | /** Jejak status dari API (job terakhir) bila worker di-restart setelah test sebelumnya gagal. */
  217 | async function watchFromApi(n: KvmNode): Promise<Watch> {
  218 |   const j = (await jobs(n.mac))[0]
  219 |   if (!j) return { seen: [], last: "", doneS: -1 }
  220 |   const seen: string[] = []
  221 |   for (const s of j.stages) if (seen[seen.length - 1] !== s.stage) seen.push(s.stage)
  222 |   const first = j.stages[0] ? Date.parse(j.stages[0].at) : NaN
  223 |   const lastAt = j.stages.length ? Date.parse(j.stages[j.stages.length - 1].at) : NaN
  224 |   note(n, `jejak status dari API (worker di-restart): ${seen.join(">")}`)
  225 |   return { seen, last: j.status, doneS: Number.isFinite(first) && Number.isFinite(lastAt) ? Math.round((lastAt - first) / 1000) : -1 }
  226 | }
  227 | 
  228 | if (ACTIVE) {
  229 |   if (TOPOLOGY !== "vlan") throw new Error("m7-vlan: PXE_KVM_TOPOLOGY harus vlan")
  230 |   const NODES = kvmNodes()
  231 |   const pills = new Map<string, Locator>()
  232 |   const watched = new Map<string, Watch>()
  233 |   // Tanpa mode serial: test gagal (mis. AC-7.20) tidak boleh menghentikan instalasi/verifikasi node lain.
  234 |   // Setelah worker di-restart, status dibaca ulang dari tabel/API (watchOrApi).
  235 | 
  236 |   test.beforeAll(async ({ browser }: { browser: Browser }) => {
  237 |     ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, locale: "id-ID" })
  238 |     page = await ctx.newPage()
  239 |     const [user, pw] = adminCredentials()
  240 |     await page.goto("/hosts")
  241 |     await expect(page).toHaveURL(/\/login\?next=%2Fhosts$/)
  242 |     await page.getByLabel("Username").fill(user)
  243 |     await page.getByLabel("Password", { exact: true }).fill(pw)
  244 |     await page.getByTestId("login-submit").click()
> 245 |     await expect(page).toHaveURL(/\/hosts$/, { timeout: 30_000 })
      |                        ^ Error: expect(page).toHaveURL(expected) failed
  246 |   })
  247 | 
  248 |   test.afterAll(async () => {
  249 |     await ctx?.close()
  250 |     const [, adminPw] = adminCredentials()
  251 |     const findings = scanEvidence([PASSWORD, adminPw, ...generated])
  252 |     writeFileSync(
  253 |       path.join(KVM.runsDir, "evidence-scan.txt"),
  254 |       findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password node/admin/generator, token /boot/, private key (teks & base64)\n",
  255 |     )
  256 |     record({ ac: "AC-7.30-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan (scan harness)`, evidence: ["evidence-scan.txt"] })
  257 |     writeResults({ scenario: SCEN, vlan: VLAN, nodes: NODES.map((n) => ({ name: n.name, fw: n.fw, os: n.os, ip: n.ip, hostname: n.hostname })) })
  258 |   })
  259 | 
  260 |   if (CORE) {
  261 |     test("AC-7.20 perimeter & topologi: switch-check, server-listen-vlan, VLAN server, settings, host tanpa route VLAN", async ({ playwright }) => {
  262 |       const t0 = Date.now()
  263 |       const problems: string[] = []
  264 |       const anon = await playwright.request.newContext({ baseURL: BASE })
  265 |       const login = await anon.get("/login")
  266 |       const noSess = await anon.get("/api/settings")
  267 |       const media = await anon.head("/media/ubuntu-24.04/casper/vmlinuz")
  268 |       await anon.dispose()
  269 |       const set = (await (await page.request.get("/api/settings")).json()) as { cidr?: string; vlanNetworks?: { vlan: number; cidr: string; gateway: string; prefix: number }[] }
  270 |       if (login.status() !== 200) problems.push(`GET /login ${login.status()}`)
  271 |       if (noSess.status() !== 401) problems.push(`/api/settings tanpa sesi ${noSess.status()}`)
  272 |       if (media.status() !== 200) problems.push(`HEAD vmlinuz ${media.status()}`)
  273 |       if (set.cidr !== PXE_CIDR) problems.push(`cidr ${set.cidr}`)
  274 |       if (!set.vlanNetworks?.some((v) => v.vlan === VLAN && v.cidr === VLAN_CIDR && v.gateway === KVM.gateway && v.prefix === 24)) problems.push(`vlanNetworks ${JSON.stringify(set.vlanNetworks)}`)
  275 |       const rd = (f: string) => (existsSync(path.join(KVM.runsDir, f)) ? readFileSync(path.join(KVM.runsDir, f), "utf8") : "")
  276 |       const sw = rd("switch-check.txt")
  277 |       for (const want of ["sw-p1 10 pvid-untagged", "sw-p1 20 tagged", "sw-up 10 tagged", "sw-up 20 tagged", "sw-p2 20 pvid-untagged", "OK   br0 vlan_filtering 1", "OK   br0 vlan_default_pvid 0", "RESULT: PASS"]) {
  278 |         if (!sw.includes(want)) problems.push(`switch-check tanpa "${want}"`)
  279 |       }
  280 |       const lv = rd("server-listen-vlan.txt")
  281 |       if (!/RESULT: PASS/.test(lv) || !/OK +dnsmasq DHCP listen udp %pxe10:67/.test(lv)) problems.push("server-listen-vlan.txt bukan PASS / tanpa %pxe10:67")
  282 |       const srv = serverRun(String.raw`
  283 | echo "# ip -d link pxe10/mgmt20"; ip -d -o link show pxe10; ip -d -o link show mgmt20
  284 | echo "# ip -br addr"; ip -br addr
  285 | echo "# ip_forward=$(cat /proc/sys/net/ipv4/ip_forward)"
  286 | echo "# ss -lunp"; ss -lunp
  287 | echo "# ss -ltnp"; ss -ltnp`)
  288 |       writeFileSync(path.join(KVM.runsDir, "ac-7.20-server-net.txt"), srv.out)
  289 |       if (!/pxe10@trunk0:.* vlan protocol 802\.1Q id 10 /.test(srv.out)) problems.push("pxe10 bukan VLAN 10 di trunk0")
  290 |       if (!/mgmt20@trunk0:.* vlan protocol 802\.1Q id 20 /.test(srv.out)) problems.push("mgmt20 bukan VLAN 20 di trunk0")
  291 |       if (!/# ip_forward=0/.test(srv.out)) problems.push("ip_forward bukan 0")
  292 |       // dnsmasq hanya di pxe10/10.99.10.2 (DEC-023 §3).
  293 |       const dnsmasqSock = srv.out.split("\n").filter((l) => /"dnsmasq"/.test(l))
  294 |       // Sah: alamat 10.99.10.2 (53/69) atau terikat device pxe10 (`0.0.0.0%pxe10:67`, link-local `%pxe10`).
  295 |       const badSock = dnsmasqSock.filter((l) => !/\s(10\.99\.10\.2:(53|67|69)|\S*%pxe10\]?:\d+)\s/.test(l))
  296 |       if (!dnsmasqSock.length || badSock.length) problems.push(`socket dnsmasq di luar pxe10: ${badSock.join(" | ") || "tidak ada socket"}`)
  297 |       const pre = rd("kvm-run-preflight.txt")
  298 |       const route = (pre.split("# ip route get 10.99.10.2")[1] ?? "").split("\n").slice(0, 3).join(" ").trim()
  299 |       if (!route) problems.push("preflight tanpa `ip route get 10.99.10.2`")
  300 |       // Host tidak pernah menyasar VLAN 10/20: kvm-run.txt (sampai tahap ini) tanpa alamat VLAN.
  301 |       const kr = rd("kvm-run.txt")
  302 |       if (/10\.99\.(10|20)\.\d/.test(kr)) problems.push("kvm-run.txt memuat alamat 10.99.10/20")
  303 |       const file = "ac-7.20-perimeter.txt"
  304 |       writeFileSync(
  305 |         path.join(KVM.runsDir, file),
  306 |         [
  307 |           `GET /login (tanpa sesi): ${login.status()}`, `GET /api/settings tanpa sesi: ${noSess.status()}`, `HEAD /media/ubuntu-24.04/casper/vmlinuz: ${media.status()}`,
  308 |           `GET /api/settings (sesi): cidr=${set.cidr} vlanNetworks=${JSON.stringify(set.vlanNetworks)}`,
  309 |           `host ip route get 10.99.10.2 (baca saja, preflight): ${route}`,
  310 |           `socket dnsmasq: ${dnsmasqSock.map((l) => l.replace(/\s+/g, " ")).join(" | ")}`,
  311 |           `switch-check.txt RESULT PASS: ${/RESULT: PASS/.test(sw)}; server-listen-vlan.txt RESULT PASS: ${/RESULT: PASS/.test(lv)}`,
  312 |           `masalah: ${problems.join("; ") || "tidak ada"}`,
  313 |         ].join("\n") + "\n",
  314 |       )
  315 |       record({ ac: "AC-7.20", status: problems.length ? "FAIL" : "PASS", durationS: Math.round((Date.now() - t0) / 1000), note: problems.join("; ") || "topologi & perimeter sesuai §2.1–2.3", evidence: [file, "ac-7.20-server-net.txt", "switch-check.txt", "server-listen-vlan.txt", "kvm-run-preflight.txt"] })
  316 |       expect(problems).toEqual([])
  317 |     })
  318 |   }
  319 | 
  320 |   test(`${SCEN}: host muncul tanpa reload → Sheet VLAN 20 → Simpan & Install (UI) untuk semua node`, async () => {
  321 |     test.setTimeout(20 * 60_000)
  322 |     await page.goto("/hosts")
  323 |     await page.evaluate(NO_RELOAD)
  324 |     for (const n of NODES) {
  325 |       await expect(hostRow(n.mac)).toHaveCount(1, { timeout: 10 * 60_000 })
  326 |       const h = await hostJson(n.mac)
  327 |       note(n, `host muncul (tanpa reload) currentIp=${h.currentIp}`)
  328 |       await page.screenshot({ path: shot(`${n.name}-discovered`) })
  329 |     }
  330 |     for (const [i, n] of NODES.entries()) pills.set(n.name, await configureInstall(n, i === 0))
  331 |     expect(await page.evaluate(STILL_NO_RELOAD)).toBe(true)
  332 |   })
  333 | 
  334 |   test(`${SCEN}: Booting → Installing → Configuring → Done ≤ 30 mnt tanpa reload`, async () => {
  335 |     test.setTimeout(35 * 60_000)
  336 |     const started = Date.now()
  337 |     for (const n of NODES) watched.set(n.name, { seen: [], last: "", doneS: -1 })
  338 |     const pending = new Set(NODES.map((n) => n.name))
  339 |     while (pending.size && Date.now() - started < INSTALL_TIMEOUT_MS) {
  340 |       for (const n of NODES) {
  341 |         if (!pending.has(n.name)) continue
  342 |         const w = watched.get(n.name)!
  343 |         const st = (await (pills.get(n.name) ?? hostRow(n.mac).locator("[data-status]").first()).getAttribute("data-status")) ?? ""
  344 |         if (st && st !== w.last) {
  345 |           w.seen.push(st)
```