# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m6-smoke.spec.ts >> T15 smoke: Debian 12 & Rocky 9 UEFI → Done + SSH; Ubuntu /dev/vdz → Failed installer-error → install ulang
- Location: e2e-kvm/m6-smoke.spec.ts:321:7

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
  233 |   } else {
  234 |     await configure(node, "")
  235 |   }
  236 | 
  237 |   const j = await install(node)
  238 |   const r = await follow(node, j.id, node.role === "failpath" ? "job2" : "job1", INSTALL_TIMEOUT_MS)
  239 |   const evs = await jobEvents(j.id)
  240 |   const label = node.role === "failpath" ? "job2" : "job1"
  241 |   writeEvents(node, label, evs)
  242 |   evidence.push(`${node.name}-${label}-events.txt`)
  243 |   note(node, `${label} akhir=${r.job.status}/${r.job.failureReason ?? "-"} dalam ${Math.round(r.ms / 1000)} dtk; urutan=${r.seen.join(">")}; stages=${r.job.stages.map((s) => `${s.stage}@${s.source}`).join(",")}`)
  244 |   if (r.job.status !== "done") problems.push(`${label} ${r.job.status}/${r.job.failureReason ?? "timeout 30 mnt"}`)
  245 |   // Event installer per tahap (CR-4-6: callback dari /proc/cmdline di d-i/chroot, %pre/%post).
  246 |   const inst = evs.filter((e) => e.kind === "installer").map((e) => e.message.split("\n")[0].slice(0, 100))
  247 |   note(node, `event installer (${inst.length}): ${inst.join(" | ")}`)
  248 |   // M6-T15 (BUG-M6-6/7): disk otomatis Debian/Rocky dipilih saat runtime → event installer.
  249 |   if (node.os !== "ubuntu" && r.job.status === "done" && !inst.some((m) => /disk target dipilih/.test(m))) problems.push("event 'disk target dipilih' tidak ada")
  250 |   if (r.job.status === "done") {
  251 |     const up = await waitSsh(node, 10 * 60_000)
  252 |     note(node, `ssh key yang di-inject: ${up ? "OK" : "TIDAK tersambung dalam 10 mnt"}`)
  253 |     if (!up) problems.push("SSH key gagal")
  254 |     else {
  255 |       evidence.push(...fetchInstallerLogs(node))
  256 |       const f = ssh(node.ip, "echo \"# hostname: $(hostname)\"; echo '# locale'; localectl status 2>&1; cat /etc/default/locale /etc/locale.conf 2>/dev/null; echo '# timezone'; timedatectl show -p Timezone 2>&1; echo '# id'; id; echo '# sudo -n true'; sudo -n true && echo sudo-ok; echo '# os-release'; head -n 3 /etc/os-release; echo '# lsblk'; lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT 2>&1")
  257 |       writeFileSync(path.join(KVM.runsDir, `${node.name}-facts.txt`), f.out)
  258 |       evidence.push(`${node.name}-facts.txt`)
  259 |       if (!new RegExp(`# hostname: ${node.hostname}\\b`).test(f.out)) problems.push("hostname target tidak sesuai config")
  260 |     }
  261 |   }
  262 |   const consoleTail = consoleLog(node).slice(-200_000)
  263 |   note(node, `console log: ${consoleTail.length} byte terakhir dibaca; kernel panic=${/Kernel panic/.test(consoleTail)}`)
  264 |   if (node.os === "rocky") {
  265 |     nfsSnapshot(node, "akhir")
  266 |     evidence.push(`${node.name}-nfs.txt`)
  267 |   }
  268 |   note(node, `jumlah job host=${await jobsCount(node.mac)}`)
  269 |   return { node: node.name, ok: problems.length === 0, note: problems.join("; ") || "Done + SSH key", durationS: Math.round((Date.now() - t0) / 1000), evidence }
  270 | }
  271 | 
  272 | if (SMOKE) {
  273 |   const NODES = kvmNodes()
  274 | 
  275 |   test.beforeAll(async ({ playwright }) => {
  276 |     api = await playwright.request.newContext({ baseURL: BASE })
  277 |   })
  278 | 
  279 |   test.afterAll(async () => {
  280 |     await api?.dispose()
  281 |     const [, adminPw] = adminCredentials()
  282 |     const findings = scanEvidence([PASSWORD, adminPw])
  283 |     writeFileSync(
  284 |       path.join(KVM.runsDir, "evidence-scan.txt"),
  285 |       findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password node/admin, token /boot/, private key (teks & base64)\n",
  286 |     )
  287 |     record({ ac: "smoke-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan (scan harness)`, evidence: ["evidence-scan.txt"] })
  288 |     writeResults({ smoke: true, nodes: NODES.map((n) => ({ name: n.name, fw: n.fw, os: n.os, role: n.role, hostname: n.hostname })) })
  289 |   })
  290 | 
  291 |   test("T15 login admin API: tanpa sesi 401, login 204 + cookie pxe_session, sesi → 200", async () => {
  292 |     const no = await api.get("/api/settings")
  293 |     const [user, pw] = adminCredentials()
  294 |     const bad = await api.post("/api/auth/login", { data: { username: user, password: `${pw}-salah` }, headers: ORIGIN })
  295 |     const r = await api.post("/api/auth/login", { data: { username: user, password: pw }, headers: ORIGIN })
  296 |     const setCookie = r.headers()["set-cookie"] ?? ""
  297 |     const cookies = await api.storageState()
  298 |     const sess = cookies.cookies.find((c) => c.name === "pxe_session")
  299 |     const yes = await api.get("/api/settings")
  300 |     const ok = no.status() === 401 && bad.status() === 401 && r.status() === 204 && /pxe_session=/.test(setCookie) && /HttpOnly/i.test(setCookie) && !!sess && yes.status() === 200
  301 |     writeFileSync(
  302 |       path.join(KVM.runsDir, "smoke-login.txt"),
  303 |       [
  304 |         `GET /api/settings tanpa sesi: ${no.status()}`,
  305 |         `POST /api/auth/login password salah: ${bad.status()}`,
  306 |         `POST /api/auth/login: ${r.status()}`,
  307 |         `Set-Cookie atribut: ${setCookie.split(";").slice(1).map((s) => s.trim()).join("; ")} (nilai tidak dicatat)`,
  308 |         `cookie pxe_session di jar: ${!!sess}`,
  309 |         `GET /api/settings dengan sesi: ${yes.status()}`,
  310 |       ].join("\n") + "\n",
  311 |     )
  312 |     record({ ac: "smoke-login", status: ok ? "PASS" : "FAIL", note: `401/401/${r.status()}/${yes.status()}`, evidence: ["smoke-login.txt"] })
  313 |     expect(no.status()).toBe(401)
  314 |     expect(bad.status()).toBe(401)
  315 |     expect(r.status()).toBe(204)
  316 |     expect(setCookie).toMatch(/pxe_session=/)
  317 |     expect(sess).toBeTruthy()
  318 |     expect(yes.status()).toBe(200)
  319 |   })
  320 | 
  321 |   test("T15 smoke: Debian 12 & Rocky 9 UEFI → Done + SSH; Ubuntu /dev/vdz → Failed installer-error → install ulang", async () => {
  322 |     test.setTimeout(100 * 60_000)
  323 |     const settled = await Promise.allSettled(NODES.map((n) => runInstallNode(n)))
  324 |     const outcomes: Outcome[] = settled.map((s, i) =>
  325 |       s.status === "fulfilled"
  326 |         ? s.value
  327 |         : { node: NODES[i].name, ok: false, note: `exception: ${String((s.reason as Error)?.message ?? s.reason).slice(0, 400)}`, durationS: -1, evidence: [`${NODES[i].name}-timeline.txt`] },
  328 |     )
  329 |     for (const [i, o] of outcomes.entries()) {
  330 |       const n = NODES[i]
  331 |       record({ ac: `smoke-${n.os}${n.role === "failpath" ? "-failpath" : ""}`, node: o.node, status: o.ok ? "PASS" : "FAIL", durationS: o.durationS, note: o.note, evidence: o.evidence })
  332 |     }
> 333 |     expect(outcomes.filter((o) => !o.ok).map((o) => `${o.node}: ${o.note}`)).toEqual([])
      |                                                                              ^ Error: expect(received).toEqual(expected) // deep equality
  334 |   })
  335 | }
  336 | 
```