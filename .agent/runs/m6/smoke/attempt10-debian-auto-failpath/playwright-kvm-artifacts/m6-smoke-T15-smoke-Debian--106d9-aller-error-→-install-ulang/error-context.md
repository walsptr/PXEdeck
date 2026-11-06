# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m6-smoke.spec.ts >> T15 smoke: Debian 12 & Rocky 9 UEFI → Done + SSH; Ubuntu /dev/vdz → Failed installer-error → install ulang
- Location: e2e-kvm/m6-smoke.spec.ts:337:7

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 4

- Array []
+ Array [
+   "pxe-test-m6-node41: job1 failed/timeout-installing",
+   "pxe-test-m6-node45: job2 failed/timeout-installing",
+ ]
```

# Test source

```ts
  249 |   const inst = evs.filter((e) => e.kind === "installer").map((e) => e.message.split("\n")[0].slice(0, 100))
  250 |   note(node, `event installer (${inst.length}): ${inst.join(" | ")}`)
  251 |   // M6-T15 (BUG-M6-6/7): disk otomatis Debian/Rocky dipilih saat runtime → event installer.
  252 |   if (node.os !== "ubuntu" && INSTALL_DISK === "" && r.job.status === "done" && !inst.some((m) => /disk target dipilih/.test(m))) problems.push("event 'disk target dipilih' tidak ada")
  253 |   // BUG-M6-8: d-i netboot memuat driver disk virtio dari server sebelum partman.
  254 |   if (node.os === "debian" && r.job.status === "done" && !inst.some((m) => /modul disk virtio dimuat/.test(m))) problems.push("event 'modul disk virtio dimuat' tidak ada")
  255 |   if (r.job.status === "done") {
  256 |     const up = await waitSsh(node, 10 * 60_000)
  257 |     note(node, `ssh key yang di-inject: ${up ? "OK" : "TIDAK tersambung dalam 10 mnt"}`)
  258 |     if (!up) problems.push("SSH key gagal")
  259 |     else {
  260 |       evidence.push(...fetchInstallerLogs(node))
  261 |       const f = ssh(node.ip, "echo \"# hostname: $(hostname)\"; echo '# locale'; localectl status 2>&1; cat /etc/default/locale /etc/locale.conf 2>/dev/null; echo '# timezone'; timedatectl show -p Timezone 2>&1; echo '# id'; id; echo '# sudo -n true'; sudo -n true && echo sudo-ok; echo '# os-release'; head -n 3 /etc/os-release; echo '# lsblk'; lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT 2>&1")
  262 |       writeFileSync(path.join(KVM.runsDir, `${node.name}-facts.txt`), f.out)
  263 |       evidence.push(`${node.name}-facts.txt`)
  264 |       if (!new RegExp(`# hostname: ${node.hostname}\\b`).test(f.out)) problems.push("hostname target tidak sesuai config")
  265 |       // Reboot → boot dari disk tanpa reinstall: SSH kembali, hostname sama, status host done, jumlah job tetap.
  266 |       const jobsBefore = await jobsCount(node.mac)
  267 |       ssh(node.ip, "sudo -n systemctl reboot")
  268 |       await new Promise((res) => setTimeout(res, 20_000))
  269 |       const back = await waitSsh(node, 10 * 60_000)
  270 |       const hn = back ? ssh(node.ip, "hostname; cat /proc/cmdline").out : ""
  271 |       const h = (await (await api.get(`/api/hosts/${hostId(node.mac)}`)).json()) as { status: string }
  272 |       const jobsAfter = await jobsCount(node.mac)
  273 |       const rb = `reboot: kembali=${back} hostname=${hn.split("\n")[0]} status=${h.status} job ${jobsBefore}->${jobsAfter} installerCmdline=${/\b(auto=true|inst\.ks=|autoinstall)\b/.test(hn)}`
  274 |       note(node, rb)
  275 |       if (!back || !hn.startsWith(node.hostname) || h.status !== "done" || jobsAfter !== jobsBefore || /\b(auto=true|inst\.ks=|autoinstall)\b/.test(hn)) problems.push(rb)
  276 |     }
  277 |   }
  278 |   const consoleTail = consoleLog(node).slice(-200_000)
  279 |   note(node, `console log: ${consoleTail.length} byte terakhir dibaca; kernel panic=${/Kernel panic/.test(consoleTail)}`)
  280 |   if (node.os === "rocky") {
  281 |     nfsSnapshot(node, "akhir")
  282 |     evidence.push(`${node.name}-nfs.txt`)
  283 |   }
  284 |   note(node, `jumlah job host=${await jobsCount(node.mac)}`)
  285 |   return { node: node.name, ok: problems.length === 0, note: problems.join("; ") || "Done + SSH key", durationS: Math.round((Date.now() - t0) / 1000), evidence }
  286 | }
  287 | 
  288 | if (SMOKE) {
  289 |   const NODES = kvmNodes()
  290 | 
  291 |   test.beforeAll(async ({ playwright }) => {
  292 |     api = await playwright.request.newContext({ baseURL: BASE })
  293 |   })
  294 | 
  295 |   test.afterAll(async () => {
  296 |     await api?.dispose()
  297 |     const [, adminPw] = adminCredentials()
  298 |     const findings = scanEvidence([PASSWORD, adminPw])
  299 |     writeFileSync(
  300 |       path.join(KVM.runsDir, "evidence-scan.txt"),
  301 |       findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password node/admin, token /boot/, private key (teks & base64)\n",
  302 |     )
  303 |     record({ ac: "smoke-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan (scan harness)`, evidence: ["evidence-scan.txt"] })
  304 |     writeResults({ smoke: true, nodes: NODES.map((n) => ({ name: n.name, fw: n.fw, os: n.os, role: n.role, hostname: n.hostname })) })
  305 |   })
  306 | 
  307 |   test("T15 login admin API: tanpa sesi 401, login 204 + cookie pxe_session, sesi → 200", async () => {
  308 |     const no = await api.get("/api/settings")
  309 |     const [user, pw] = adminCredentials()
  310 |     const bad = await api.post("/api/auth/login", { data: { username: user, password: `${pw}-salah` }, headers: ORIGIN })
  311 |     const r = await api.post("/api/auth/login", { data: { username: user, password: pw }, headers: ORIGIN })
  312 |     const setCookie = r.headers()["set-cookie"] ?? ""
  313 |     const cookies = await api.storageState()
  314 |     const sess = cookies.cookies.find((c) => c.name === "pxe_session")
  315 |     const yes = await api.get("/api/settings")
  316 |     const ok = no.status() === 401 && bad.status() === 401 && r.status() === 204 && /pxe_session=/.test(setCookie) && /HttpOnly/i.test(setCookie) && !!sess && yes.status() === 200
  317 |     writeFileSync(
  318 |       path.join(KVM.runsDir, "smoke-login.txt"),
  319 |       [
  320 |         `GET /api/settings tanpa sesi: ${no.status()}`,
  321 |         `POST /api/auth/login password salah: ${bad.status()}`,
  322 |         `POST /api/auth/login: ${r.status()}`,
  323 |         `Set-Cookie atribut: ${setCookie.split(";").slice(1).map((s) => s.trim()).join("; ")} (nilai tidak dicatat)`,
  324 |         `cookie pxe_session di jar: ${!!sess}`,
  325 |         `GET /api/settings dengan sesi: ${yes.status()}`,
  326 |       ].join("\n") + "\n",
  327 |     )
  328 |     record({ ac: "smoke-login", status: ok ? "PASS" : "FAIL", note: `401/401/${r.status()}/${yes.status()}`, evidence: ["smoke-login.txt"] })
  329 |     expect(no.status()).toBe(401)
  330 |     expect(bad.status()).toBe(401)
  331 |     expect(r.status()).toBe(204)
  332 |     expect(setCookie).toMatch(/pxe_session=/)
  333 |     expect(sess).toBeTruthy()
  334 |     expect(yes.status()).toBe(200)
  335 |   })
  336 | 
  337 |   test("T15 smoke: Debian 12 & Rocky 9 UEFI → Done + SSH; Ubuntu /dev/vdz → Failed installer-error → install ulang", async () => {
  338 |     test.setTimeout(100 * 60_000)
  339 |     const settled = await Promise.allSettled(NODES.map((n) => runInstallNode(n)))
  340 |     const outcomes: Outcome[] = settled.map((s, i) =>
  341 |       s.status === "fulfilled"
  342 |         ? s.value
  343 |         : { node: NODES[i].name, ok: false, note: `exception: ${String((s.reason as Error)?.message ?? s.reason).slice(0, 400)}`, durationS: -1, evidence: [`${NODES[i].name}-timeline.txt`] },
  344 |     )
  345 |     for (const [i, o] of outcomes.entries()) {
  346 |       const n = NODES[i]
  347 |       record({ ac: `smoke-${n.os}${n.role === "failpath" ? "-failpath" : ""}`, node: o.node, status: o.ok ? "PASS" : "FAIL", durationS: o.durationS, note: o.note, evidence: o.evidence })
  348 |     }
> 349 |     expect(outcomes.filter((o) => !o.ok).map((o) => `${o.node}: ${o.note}`)).toEqual([])
      |                                                                              ^ Error: expect(received).toEqual(expected) // deep equality
  350 |   })
  351 | }
  352 | 
```