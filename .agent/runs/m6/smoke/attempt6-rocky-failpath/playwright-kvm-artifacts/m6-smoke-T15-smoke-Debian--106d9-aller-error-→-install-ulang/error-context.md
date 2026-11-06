# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m6-smoke.spec.ts >> T15 smoke: Debian 12 & Rocky 9 UEFI → Done + SSH; Ubuntu /dev/vdz → Failed installer-error → install ulang
- Location: e2e-kvm/m6-smoke.spec.ts:319:7

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "pxe-test-m6-node44: job1 installing/null (harap failed/installer-error ≤ 15 mnt); job1 tanpa event installer dari error-commands",
+ ]
```

# Test source

```ts
  231 |     // Install ulang dengan disk otomatis.
  232 |     await configure(node, "")
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
  248 |   if (r.job.status === "done") {
  249 |     const up = await waitSsh(node, 10 * 60_000)
  250 |     note(node, `ssh key yang di-inject: ${up ? "OK" : "TIDAK tersambung dalam 10 mnt"}`)
  251 |     if (!up) problems.push("SSH key gagal")
  252 |     else {
  253 |       evidence.push(...fetchInstallerLogs(node))
  254 |       const f = ssh(node.ip, "echo \"# hostname: $(hostname)\"; echo '# locale'; localectl status 2>&1; cat /etc/default/locale /etc/locale.conf 2>/dev/null; echo '# timezone'; timedatectl show -p Timezone 2>&1; echo '# id'; id; echo '# sudo -n true'; sudo -n true && echo sudo-ok; echo '# os-release'; head -n 3 /etc/os-release")
  255 |       writeFileSync(path.join(KVM.runsDir, `${node.name}-facts.txt`), f.out)
  256 |       evidence.push(`${node.name}-facts.txt`)
  257 |       if (!new RegExp(`# hostname: ${node.hostname}\\b`).test(f.out)) problems.push("hostname target tidak sesuai config")
  258 |     }
  259 |   }
  260 |   const consoleTail = consoleLog(node).slice(-200_000)
  261 |   note(node, `console log: ${consoleTail.length} byte terakhir dibaca; kernel panic=${/Kernel panic/.test(consoleTail)}`)
  262 |   if (node.os === "rocky") {
  263 |     nfsSnapshot(node, "akhir")
  264 |     evidence.push(`${node.name}-nfs.txt`)
  265 |   }
  266 |   note(node, `jumlah job host=${await jobsCount(node.mac)}`)
  267 |   return { node: node.name, ok: problems.length === 0, note: problems.join("; ") || "Done + SSH key", durationS: Math.round((Date.now() - t0) / 1000), evidence }
  268 | }
  269 | 
  270 | if (SMOKE) {
  271 |   const NODES = kvmNodes()
  272 | 
  273 |   test.beforeAll(async ({ playwright }) => {
  274 |     api = await playwright.request.newContext({ baseURL: BASE })
  275 |   })
  276 | 
  277 |   test.afterAll(async () => {
  278 |     await api?.dispose()
  279 |     const [, adminPw] = adminCredentials()
  280 |     const findings = scanEvidence([PASSWORD, adminPw])
  281 |     writeFileSync(
  282 |       path.join(KVM.runsDir, "evidence-scan.txt"),
  283 |       findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password node/admin, token /boot/, private key (teks & base64)\n",
  284 |     )
  285 |     record({ ac: "smoke-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan (scan harness)`, evidence: ["evidence-scan.txt"] })
  286 |     writeResults({ smoke: true, nodes: NODES.map((n) => ({ name: n.name, fw: n.fw, os: n.os, role: n.role, hostname: n.hostname })) })
  287 |   })
  288 | 
  289 |   test("T15 login admin API: tanpa sesi 401, login 204 + cookie pxe_session, sesi → 200", async () => {
  290 |     const no = await api.get("/api/settings")
  291 |     const [user, pw] = adminCredentials()
  292 |     const bad = await api.post("/api/auth/login", { data: { username: user, password: `${pw}-salah` }, headers: ORIGIN })
  293 |     const r = await api.post("/api/auth/login", { data: { username: user, password: pw }, headers: ORIGIN })
  294 |     const setCookie = r.headers()["set-cookie"] ?? ""
  295 |     const cookies = await api.storageState()
  296 |     const sess = cookies.cookies.find((c) => c.name === "pxe_session")
  297 |     const yes = await api.get("/api/settings")
  298 |     const ok = no.status() === 401 && bad.status() === 401 && r.status() === 204 && /pxe_session=/.test(setCookie) && /HttpOnly/i.test(setCookie) && !!sess && yes.status() === 200
  299 |     writeFileSync(
  300 |       path.join(KVM.runsDir, "smoke-login.txt"),
  301 |       [
  302 |         `GET /api/settings tanpa sesi: ${no.status()}`,
  303 |         `POST /api/auth/login password salah: ${bad.status()}`,
  304 |         `POST /api/auth/login: ${r.status()}`,
  305 |         `Set-Cookie atribut: ${setCookie.split(";").slice(1).map((s) => s.trim()).join("; ")} (nilai tidak dicatat)`,
  306 |         `cookie pxe_session di jar: ${!!sess}`,
  307 |         `GET /api/settings dengan sesi: ${yes.status()}`,
  308 |       ].join("\n") + "\n",
  309 |     )
  310 |     record({ ac: "smoke-login", status: ok ? "PASS" : "FAIL", note: `401/401/${r.status()}/${yes.status()}`, evidence: ["smoke-login.txt"] })
  311 |     expect(no.status()).toBe(401)
  312 |     expect(bad.status()).toBe(401)
  313 |     expect(r.status()).toBe(204)
  314 |     expect(setCookie).toMatch(/pxe_session=/)
  315 |     expect(sess).toBeTruthy()
  316 |     expect(yes.status()).toBe(200)
  317 |   })
  318 | 
  319 |   test("T15 smoke: Debian 12 & Rocky 9 UEFI → Done + SSH; Ubuntu /dev/vdz → Failed installer-error → install ulang", async () => {
  320 |     test.setTimeout(100 * 60_000)
  321 |     const settled = await Promise.allSettled(NODES.map((n) => runInstallNode(n)))
  322 |     const outcomes: Outcome[] = settled.map((s, i) =>
  323 |       s.status === "fulfilled"
  324 |         ? s.value
  325 |         : { node: NODES[i].name, ok: false, note: `exception: ${String((s.reason as Error)?.message ?? s.reason).slice(0, 400)}`, durationS: -1, evidence: [`${NODES[i].name}-timeline.txt`] },
  326 |     )
  327 |     for (const [i, o] of outcomes.entries()) {
  328 |       const n = NODES[i]
  329 |       record({ ac: `smoke-${n.os}${n.role === "failpath" ? "-failpath" : ""}`, node: o.node, status: o.ok ? "PASS" : "FAIL", durationS: o.durationS, note: o.note, evidence: o.evidence })
  330 |     }
> 331 |     expect(outcomes.filter((o) => !o.ok).map((o) => `${o.node}: ${o.note}`)).toEqual([])
      |                                                                              ^ Error: expect(received).toEqual(expected) // deep equality
  332 |   })
  333 | }
  334 | 
```