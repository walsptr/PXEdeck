# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m6-smoke.spec.ts >> T15 smoke: Debian 12 & Rocky 9 UEFI → Done + SSH; Ubuntu /dev/vdz → Failed installer-error → install ulang
- Location: e2e-kvm/m6-smoke.spec.ts:281:7

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "pxe-test-m6-node41: job1 failed/timeout-installing",
+ ]
```

# Test source

```ts
  193 |     const ev1 = await jobEvents(j1.id)
  194 |     writeEvents(node, "job1", ev1)
  195 |     evidence.push(`${node.name}-job1-events.txt`)
  196 |     const errEv = ev1.filter((e) => e.kind === "installer" && /installer gagal/.test(e.message))
  197 |     note(node, `job1 akhir=${f.job.status}/${f.job.failureReason} dalam ${Math.round(f.ms / 1000)} dtk; event installer error-commands=${errEv.length}; urutan=${f.seen.join(">")}`)
  198 |     if (f.job.status !== "failed" || f.job.failureReason !== "installer-error") problems.push(`job1 ${f.job.status}/${f.job.failureReason} (harap failed/installer-error ≤ 15 mnt)`)
  199 |     if (errEv.length < 1) problems.push("job1 tanpa event installer dari error-commands")
  200 |     if (f.job.status !== "failed") {
  201 |       return { node: node.name, ok: false, note: problems.join("; "), durationS: Math.round((Date.now() - t0) / 1000), evidence }
  202 |     }
  203 |     // Install ulang dengan disk otomatis.
  204 |     await configure(node, "")
  205 |   } else {
  206 |     await configure(node, "")
  207 |   }
  208 | 
  209 |   const j = await install(node)
  210 |   const r = await follow(node, j.id, node.role === "failpath" ? "job2" : "job1", INSTALL_TIMEOUT_MS)
  211 |   const evs = await jobEvents(j.id)
  212 |   const label = node.role === "failpath" ? "job2" : "job1"
  213 |   writeEvents(node, label, evs)
  214 |   evidence.push(`${node.name}-${label}-events.txt`)
  215 |   note(node, `${label} akhir=${r.job.status}/${r.job.failureReason ?? "-"} dalam ${Math.round(r.ms / 1000)} dtk; urutan=${r.seen.join(">")}; stages=${r.job.stages.map((s) => `${s.stage}@${s.source}`).join(",")}`)
  216 |   if (r.job.status !== "done") problems.push(`${label} ${r.job.status}/${r.job.failureReason ?? "timeout 30 mnt"}`)
  217 |   // Event installer per tahap (CR-4-6: callback dari /proc/cmdline di d-i/chroot, %pre/%post).
  218 |   const inst = evs.filter((e) => e.kind === "installer").map((e) => e.message.split("\n")[0].slice(0, 100))
  219 |   note(node, `event installer (${inst.length}): ${inst.join(" | ")}`)
  220 |   if (r.job.status === "done") {
  221 |     const up = await waitSsh(node, 10 * 60_000)
  222 |     note(node, `ssh key yang di-inject: ${up ? "OK" : "TIDAK tersambung dalam 10 mnt"}`)
  223 |     if (!up) problems.push("SSH key gagal")
  224 |     else evidence.push(...fetchInstallerLogs(node))
  225 |   }
  226 |   const consoleTail = consoleLog(node).slice(-200_000)
  227 |   note(node, `console log: ${consoleTail.length} byte terakhir dibaca; kernel panic=${/Kernel panic/.test(consoleTail)}`)
  228 |   note(node, `jumlah job host=${await jobsCount(node.mac)}`)
  229 |   return { node: node.name, ok: problems.length === 0, note: problems.join("; ") || "Done + SSH key", durationS: Math.round((Date.now() - t0) / 1000), evidence }
  230 | }
  231 | 
  232 | if (SMOKE) {
  233 |   const NODES = kvmNodes()
  234 | 
  235 |   test.beforeAll(async ({ playwright }) => {
  236 |     api = await playwright.request.newContext({ baseURL: BASE })
  237 |   })
  238 | 
  239 |   test.afterAll(async () => {
  240 |     await api?.dispose()
  241 |     const [, adminPw] = adminCredentials()
  242 |     const findings = scanEvidence([PASSWORD, adminPw])
  243 |     writeFileSync(
  244 |       path.join(KVM.runsDir, "evidence-scan.txt"),
  245 |       findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password node/admin, token /boot/, private key (teks & base64)\n",
  246 |     )
  247 |     record({ ac: "smoke-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan (scan harness)`, evidence: ["evidence-scan.txt"] })
  248 |     writeResults({ smoke: true, nodes: NODES.map((n) => ({ name: n.name, fw: n.fw, os: n.os, role: n.role, hostname: n.hostname })) })
  249 |   })
  250 | 
  251 |   test("T15 login admin API: tanpa sesi 401, login 204 + cookie pxe_session, sesi → 200", async () => {
  252 |     const no = await api.get("/api/settings")
  253 |     const [user, pw] = adminCredentials()
  254 |     const bad = await api.post("/api/auth/login", { data: { username: user, password: `${pw}-salah` }, headers: ORIGIN })
  255 |     const r = await api.post("/api/auth/login", { data: { username: user, password: pw }, headers: ORIGIN })
  256 |     const setCookie = r.headers()["set-cookie"] ?? ""
  257 |     const cookies = await api.storageState()
  258 |     const sess = cookies.cookies.find((c) => c.name === "pxe_session")
  259 |     const yes = await api.get("/api/settings")
  260 |     const ok = no.status() === 401 && bad.status() === 401 && r.status() === 204 && /pxe_session=/.test(setCookie) && /HttpOnly/i.test(setCookie) && !!sess && yes.status() === 200
  261 |     writeFileSync(
  262 |       path.join(KVM.runsDir, "smoke-login.txt"),
  263 |       [
  264 |         `GET /api/settings tanpa sesi: ${no.status()}`,
  265 |         `POST /api/auth/login password salah: ${bad.status()}`,
  266 |         `POST /api/auth/login: ${r.status()}`,
  267 |         `Set-Cookie atribut: ${setCookie.split(";").slice(1).map((s) => s.trim()).join("; ")} (nilai tidak dicatat)`,
  268 |         `cookie pxe_session di jar: ${!!sess}`,
  269 |         `GET /api/settings dengan sesi: ${yes.status()}`,
  270 |       ].join("\n") + "\n",
  271 |     )
  272 |     record({ ac: "smoke-login", status: ok ? "PASS" : "FAIL", note: `401/401/${r.status()}/${yes.status()}`, evidence: ["smoke-login.txt"] })
  273 |     expect(no.status()).toBe(401)
  274 |     expect(bad.status()).toBe(401)
  275 |     expect(r.status()).toBe(204)
  276 |     expect(setCookie).toMatch(/pxe_session=/)
  277 |     expect(sess).toBeTruthy()
  278 |     expect(yes.status()).toBe(200)
  279 |   })
  280 | 
  281 |   test("T15 smoke: Debian 12 & Rocky 9 UEFI → Done + SSH; Ubuntu /dev/vdz → Failed installer-error → install ulang", async () => {
  282 |     test.setTimeout(100 * 60_000)
  283 |     const settled = await Promise.allSettled(NODES.map((n) => runInstallNode(n)))
  284 |     const outcomes: Outcome[] = settled.map((s, i) =>
  285 |       s.status === "fulfilled"
  286 |         ? s.value
  287 |         : { node: NODES[i].name, ok: false, note: `exception: ${String((s.reason as Error)?.message ?? s.reason).slice(0, 400)}`, durationS: -1, evidence: [`${NODES[i].name}-timeline.txt`] },
  288 |     )
  289 |     for (const [i, o] of outcomes.entries()) {
  290 |       const n = NODES[i]
  291 |       record({ ac: `smoke-${n.os}${n.role === "failpath" ? "-failpath" : ""}`, node: o.node, status: o.ok ? "PASS" : "FAIL", durationS: o.durationS, note: o.note, evidence: o.evidence })
  292 |     }
> 293 |     expect(outcomes.filter((o) => !o.ok).map((o) => `${o.node}: ${o.note}`)).toEqual([])
      |                                                                              ^ Error: expect(received).toEqual(expected) // deep equality
  294 |   })
  295 | }
  296 | 
```