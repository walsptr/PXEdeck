# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m6-smoke.spec.ts >> T15 smoke: Debian 12 & Rocky 9 UEFI → Done + SSH; Ubuntu /dev/vdz → Failed installer-error → install ulang
- Location: e2e-kvm/m6-smoke.spec.ts:324:7

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "pxe-test-m6-node41: job1 failed/installer-error",
+ ]
```

# Test source

```ts
  236 |   } else {
  237 |     await configure(node, INSTALL_DISK)
  238 |   }
  239 | 
  240 |   const j = await install(node)
  241 |   const r = await follow(node, j.id, node.role === "failpath" ? "job2" : "job1", INSTALL_TIMEOUT_MS)
  242 |   const evs = await jobEvents(j.id)
  243 |   const label = node.role === "failpath" ? "job2" : "job1"
  244 |   writeEvents(node, label, evs)
  245 |   evidence.push(`${node.name}-${label}-events.txt`)
  246 |   note(node, `${label} akhir=${r.job.status}/${r.job.failureReason ?? "-"} dalam ${Math.round(r.ms / 1000)} dtk; urutan=${r.seen.join(">")}; stages=${r.job.stages.map((s) => `${s.stage}@${s.source}`).join(",")}`)
  247 |   if (r.job.status !== "done") problems.push(`${label} ${r.job.status}/${r.job.failureReason ?? "timeout 30 mnt"}`)
  248 |   // Event installer per tahap (CR-4-6: callback dari /proc/cmdline di d-i/chroot, %pre/%post).
  249 |   const inst = evs.filter((e) => e.kind === "installer").map((e) => e.message.split("\n")[0].slice(0, 100))
  250 |   note(node, `event installer (${inst.length}): ${inst.join(" | ")}`)
  251 |   // M6-T15 (BUG-M6-6/7): disk otomatis Debian/Rocky dipilih saat runtime → event installer.
  252 |   if (node.os !== "ubuntu" && INSTALL_DISK === "" && r.job.status === "done" && !inst.some((m) => /disk target dipilih/.test(m))) problems.push("event 'disk target dipilih' tidak ada")
  253 |   if (r.job.status === "done") {
  254 |     const up = await waitSsh(node, 10 * 60_000)
  255 |     note(node, `ssh key yang di-inject: ${up ? "OK" : "TIDAK tersambung dalam 10 mnt"}`)
  256 |     if (!up) problems.push("SSH key gagal")
  257 |     else {
  258 |       evidence.push(...fetchInstallerLogs(node))
  259 |       const f = ssh(node.ip, "echo \"# hostname: $(hostname)\"; echo '# locale'; localectl status 2>&1; cat /etc/default/locale /etc/locale.conf 2>/dev/null; echo '# timezone'; timedatectl show -p Timezone 2>&1; echo '# id'; id; echo '# sudo -n true'; sudo -n true && echo sudo-ok; echo '# os-release'; head -n 3 /etc/os-release; echo '# lsblk'; lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT 2>&1")
  260 |       writeFileSync(path.join(KVM.runsDir, `${node.name}-facts.txt`), f.out)
  261 |       evidence.push(`${node.name}-facts.txt`)
  262 |       if (!new RegExp(`# hostname: ${node.hostname}\\b`).test(f.out)) problems.push("hostname target tidak sesuai config")
  263 |     }
  264 |   }
  265 |   const consoleTail = consoleLog(node).slice(-200_000)
  266 |   note(node, `console log: ${consoleTail.length} byte terakhir dibaca; kernel panic=${/Kernel panic/.test(consoleTail)}`)
  267 |   if (node.os === "rocky") {
  268 |     nfsSnapshot(node, "akhir")
  269 |     evidence.push(`${node.name}-nfs.txt`)
  270 |   }
  271 |   note(node, `jumlah job host=${await jobsCount(node.mac)}`)
  272 |   return { node: node.name, ok: problems.length === 0, note: problems.join("; ") || "Done + SSH key", durationS: Math.round((Date.now() - t0) / 1000), evidence }
  273 | }
  274 | 
  275 | if (SMOKE) {
  276 |   const NODES = kvmNodes()
  277 | 
  278 |   test.beforeAll(async ({ playwright }) => {
  279 |     api = await playwright.request.newContext({ baseURL: BASE })
  280 |   })
  281 | 
  282 |   test.afterAll(async () => {
  283 |     await api?.dispose()
  284 |     const [, adminPw] = adminCredentials()
  285 |     const findings = scanEvidence([PASSWORD, adminPw])
  286 |     writeFileSync(
  287 |       path.join(KVM.runsDir, "evidence-scan.txt"),
  288 |       findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password node/admin, token /boot/, private key (teks & base64)\n",
  289 |     )
  290 |     record({ ac: "smoke-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan (scan harness)`, evidence: ["evidence-scan.txt"] })
  291 |     writeResults({ smoke: true, nodes: NODES.map((n) => ({ name: n.name, fw: n.fw, os: n.os, role: n.role, hostname: n.hostname })) })
  292 |   })
  293 | 
  294 |   test("T15 login admin API: tanpa sesi 401, login 204 + cookie pxe_session, sesi → 200", async () => {
  295 |     const no = await api.get("/api/settings")
  296 |     const [user, pw] = adminCredentials()
  297 |     const bad = await api.post("/api/auth/login", { data: { username: user, password: `${pw}-salah` }, headers: ORIGIN })
  298 |     const r = await api.post("/api/auth/login", { data: { username: user, password: pw }, headers: ORIGIN })
  299 |     const setCookie = r.headers()["set-cookie"] ?? ""
  300 |     const cookies = await api.storageState()
  301 |     const sess = cookies.cookies.find((c) => c.name === "pxe_session")
  302 |     const yes = await api.get("/api/settings")
  303 |     const ok = no.status() === 401 && bad.status() === 401 && r.status() === 204 && /pxe_session=/.test(setCookie) && /HttpOnly/i.test(setCookie) && !!sess && yes.status() === 200
  304 |     writeFileSync(
  305 |       path.join(KVM.runsDir, "smoke-login.txt"),
  306 |       [
  307 |         `GET /api/settings tanpa sesi: ${no.status()}`,
  308 |         `POST /api/auth/login password salah: ${bad.status()}`,
  309 |         `POST /api/auth/login: ${r.status()}`,
  310 |         `Set-Cookie atribut: ${setCookie.split(";").slice(1).map((s) => s.trim()).join("; ")} (nilai tidak dicatat)`,
  311 |         `cookie pxe_session di jar: ${!!sess}`,
  312 |         `GET /api/settings dengan sesi: ${yes.status()}`,
  313 |       ].join("\n") + "\n",
  314 |     )
  315 |     record({ ac: "smoke-login", status: ok ? "PASS" : "FAIL", note: `401/401/${r.status()}/${yes.status()}`, evidence: ["smoke-login.txt"] })
  316 |     expect(no.status()).toBe(401)
  317 |     expect(bad.status()).toBe(401)
  318 |     expect(r.status()).toBe(204)
  319 |     expect(setCookie).toMatch(/pxe_session=/)
  320 |     expect(sess).toBeTruthy()
  321 |     expect(yes.status()).toBe(200)
  322 |   })
  323 | 
  324 |   test("T15 smoke: Debian 12 & Rocky 9 UEFI → Done + SSH; Ubuntu /dev/vdz → Failed installer-error → install ulang", async () => {
  325 |     test.setTimeout(100 * 60_000)
  326 |     const settled = await Promise.allSettled(NODES.map((n) => runInstallNode(n)))
  327 |     const outcomes: Outcome[] = settled.map((s, i) =>
  328 |       s.status === "fulfilled"
  329 |         ? s.value
  330 |         : { node: NODES[i].name, ok: false, note: `exception: ${String((s.reason as Error)?.message ?? s.reason).slice(0, 400)}`, durationS: -1, evidence: [`${NODES[i].name}-timeline.txt`] },
  331 |     )
  332 |     for (const [i, o] of outcomes.entries()) {
  333 |       const n = NODES[i]
  334 |       record({ ac: `smoke-${n.os}${n.role === "failpath" ? "-failpath" : ""}`, node: o.node, status: o.ok ? "PASS" : "FAIL", durationS: o.durationS, note: o.note, evidence: o.evidence })
  335 |     }
> 336 |     expect(outcomes.filter((o) => !o.ok).map((o) => `${o.node}: ${o.note}`)).toEqual([])
      |                                                                              ^ Error: expect(received).toEqual(expected) // deep equality
  337 |   })
  338 | }
  339 | 
```