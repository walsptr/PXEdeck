# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m7-vlansmoke.spec.ts >> T10 smoke VLAN: node port1 (VLAN 10 native) → IP statis VLAN 20 → Done + relay verify + MTU + reboot dari disk
- Location: e2e-kvm/m7-vlansmoke.spec.ts:367:7

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "pxe-test-m7vlansmoke-node43: job booting/timeout 30 mnt (urutan booting)",
+ ]
```

# Test source

```ts
  283 |   evidence.push(`${node.name}-mtu.txt`)
  284 |   const mtuOk = /# exit-1472=0/.test(mtu.out) && /3 packets transmitted, 3 received/.test(mtu.out) && !/# exit-1473=0/.test(mtu.out)
  285 |   verdicts.MTU = `${mtuOk ? "PASS" : "FAIL"}: ping DF 1472 B (frame 1518 B ber-tag) ${/3 received/.test(mtu.out) ? "3/3" : "gagal"}; 1473 ${/# exit-1473=0/.test(mtu.out) ? "LOLOS (tak terduga)" : "ditolak"}`
  286 |   if (!mtuOk) problems.push("MTU VLAN 20 (lihat mtu.txt)")
  287 | 
  288 |   // Reboot dari disk lewat relay.
  289 |   const jobsBefore = await jobsCount(node.mac)
  290 |   const marksBefore = (consoleLog(node).match(INSTALLER_MARK) ?? []).length
  291 |   const consoleLenBefore = consoleLog(node).length
  292 |   const rb = await relayAsync("reboot", node, {}, 60_000)
  293 |   note(node, `reboot (relay): ${rb.out.trim().split("\n").pop()}`)
  294 |   await sleep(30_000)
  295 |   const back = await waitSshRelay(node, 10 * 60_000)
  296 |   const v2 = back ? await relayAsync("verify", node, verifyEnv(node), 5 * 60_000) : { code: -1, out: "node tidak kembali" }
  297 |   const cons = consoleLog(node)
  298 |   const marksAfter = (cons.match(INSTALLER_MARK) ?? []).length
  299 |   const localBoot = /boot dari disk lokal|Tidak ada instalasi aktif/.test(cons.slice(consoleLenBefore))
  300 |   const h = await hostJson(node.mac)
  301 |   const jobsAfter = await jobsCount(node.mac)
  302 |   const rbLine = `reboot: kembali=${back} verify2=${v2.code} status=${h.status} currentIp=${h.currentIp} job ${jobsBefore}->${jobsAfter} penanda-installer-serial ${marksBefore}->${marksAfter} iPXE-boot-lokal=${localBoot}`
  303 |   note(node, rbLine)
  304 |   if (!back || v2.code !== 0 || h.status !== "done" || jobsAfter !== jobsBefore || marksAfter !== marksBefore) problems.push(rbLine)
  305 | 
  306 |   // O6: DHCP dari MAC sesudah Done (hanya boot PXE ulang yang boleh), dicatat dengan waktu Done.
  307 |   const dhcp = serverRun(DHCP_LOG, { NODE_MAC: node.mac })
  308 |   writeFileSync(path.join(KVM.runsDir, `${node.name}-dhcp-after.txt`), `# Done (API) pada ${doneAt.toISOString()}; reboot verifikasi setelahnya\n${dhcp.out}`)
  309 |   evidence.push(`${node.name}-dhcp-after.txt`)
  310 | 
  311 |   const parentNoIp = (o: string) => /^OK +parent \S+ tanpa IPv4/m.test(o) && /^OK +tidak ada IPv4 di interface lain/m.test(o)
  312 |   const childUp = (o: string) => /^OK +anak VLAN 802\.1Q id \d+ di \S+ ditemukan/m.test(o) && /^OK +ip -4 addr \S+ memuat /m.test(o)
  313 |   if (node.os === "rocky") verdicts.O6 = `${parentNoIp(v1.out) && parentNoIp(v2.out) ? "PASS" : "FAIL"}: parent native tanpa IPv4 sebelum reboot=${parentNoIp(v1.out)} sesudah=${parentNoIp(v2.out)}`
  314 |   if (node.os === "debian") verdicts.O10 = `${childUp(v1.out) && childUp(v2.out) ? "PASS" : "FAIL"}: anak VLAN ifupdown naik sebelum reboot=${childUp(v1.out)} sesudah=${childUp(v2.out)} (tanpa paket vlan tambahan)`
  315 |   verdicts.parentNoIPv4 = `${parentNoIp(v1.out) && parentNoIp(v2.out)}`
  316 | 
  317 |   const file = `${node.name}-relay-verify.txt`
  318 |   writeFileSync(
  319 |     path.join(KVM.runsDir, file),
  320 |     [
  321 |       `# ${node.name} (${node.os}, ${node.fw}) VLAN ${VLAN} ${node.ip}/${KVM.prefix}: ${r.seen.join(" → ")} dalam ${Math.round(r.ms / 1000)} dtk`,
  322 |       "# verify-node.sh lewat relay (sebelum reboot)", v1.out.trim(), `# exit=${v1.code}`,
  323 |       "# pwcheck (relay)", pw.out.trim(), `# password ditolak=${pwOk}`,
  324 |       "# verify-node.sh lewat relay (sesudah reboot)", v2.out.trim(), `# exit=${v2.code}`,
  325 |       `# ${rbLine}`,
  326 |       `# verdicts: ${JSON.stringify(verdicts)}`,
  327 |       `# masalah: ${problems.join("; ") || "tidak ada"}`,
  328 |     ].join("\n") + "\n",
  329 |   )
  330 |   evidence.push(file)
  331 |   return { node: node.name, ok: problems.length === 0, note: problems.join("; ") || `Done ${Math.round(r.ms / 1000)}s; verify ${v1.code}/${v2.code}; ${Object.entries(verdicts).map(([k, v]) => `${k}=${v.split(":")[0]}`).join(" ")}`, durationS: Math.round((Date.now() - t0) / 1000), evidence, verdicts }
  332 | }
  333 | 
  334 | if (SMOKE) {
  335 |   if (TOPOLOGY !== "vlan") throw new Error("m7-vlansmoke: PXE_KVM_TOPOLOGY harus vlan")
  336 |   const NODES = kvmNodes()
  337 | 
  338 |   test.beforeAll(async ({ playwright }) => {
  339 |     api = await playwright.request.newContext({ baseURL: BASE })
  340 |     const [user, pw] = adminCredentials()
  341 |     const r = await api.post("/api/auth/login", { data: { username: user, password: pw }, headers: ORIGIN })
  342 |     expect(r.status(), "login admin").toBe(204)
  343 |   })
  344 | 
  345 |   test.afterAll(async () => {
  346 |     await api?.dispose()
  347 |     const [, adminPw] = adminCredentials()
  348 |     const findings = scanEvidence([PASSWORD, adminPw])
  349 |     writeFileSync(
  350 |       path.join(KVM.runsDir, "evidence-scan.txt"),
  351 |       findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password node/admin, token /boot/, private key (teks & base64)\n",
  352 |     )
  353 |     record({ ac: "smoke-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan (scan harness)`, evidence: ["evidence-scan.txt"] })
  354 |     writeResults({ smoke: "vlansmoke", vlan: VLAN, nodes: NODES.map((n) => ({ name: n.name, fw: n.fw, os: n.os, ip: n.ip, hostname: n.hostname })) })
  355 |   })
  356 | 
  357 |   test("T10 settings server VLAN: cidr PXE 10.99.10.0/24 + vlanNetworks VLAN 20", async () => {
  358 |     const r = await api.get("/api/settings")
  359 |     expect(r.status()).toBe(200)
  360 |     const s = (await r.json()) as { cidr?: string; vlanNetworks?: { vlan: number; cidr: string; prefix: number; gateway: string }[] }
  361 |     const ok = s.cidr === "10.99.10.0/24" && !!s.vlanNetworks?.some((v) => v.vlan === VLAN && v.cidr === "10.99.20.0/24" && v.gateway === KVM.gateway)
  362 |     writeFileSync(path.join(KVM.runsDir, "smoke-settings.txt"), `cidr=${s.cidr}\nvlanNetworks=${JSON.stringify(s.vlanNetworks)}\n`)
  363 |     record({ ac: "smoke-settings", status: ok ? "PASS" : "FAIL", note: `cidr=${s.cidr} vlanNetworks=${JSON.stringify(s.vlanNetworks)}`, evidence: ["smoke-settings.txt"] })
  364 |     expect(ok).toBe(true)
  365 |   })
  366 | 
  367 |   test("T10 smoke VLAN: node port1 (VLAN 10 native) → IP statis VLAN 20 → Done + relay verify + MTU + reboot dari disk", async () => {
  368 |     test.setTimeout(110 * 60_000)
  369 |     const settled = await Promise.allSettled(NODES.map((n) => runNode(n)))
  370 |     const outcomes: Outcome[] = settled.map((s, i) =>
  371 |       s.status === "fulfilled"
  372 |         ? s.value
  373 |         : { node: NODES[i].name, ok: false, note: `exception: ${String((s.reason as Error)?.message ?? s.reason).slice(0, 400)}`, durationS: -1, evidence: [`${NODES[i].name}-timeline.txt`], verdicts: {} },
  374 |     )
  375 |     for (const [i, o] of outcomes.entries()) {
  376 |       const n = NODES[i]
  377 |       record({ ac: `smoke-vlan-${n.os}`, node: o.node, status: o.ok ? "PASS" : "FAIL", durationS: o.durationS, note: o.note, evidence: o.evidence })
  378 |       for (const [k, v] of Object.entries(o.verdicts)) {
  379 |         if (k === "parentNoIPv4") continue
  380 |         record({ ac: `smoke-${k}`, node: o.node, status: v.startsWith("PASS") ? "PASS" : "FAIL", note: v, evidence: o.evidence })
  381 |       }
  382 |     }
> 383 |     expect(outcomes.filter((o) => !o.ok).map((o) => `${o.node}: ${o.note}`)).toEqual([])
      |                                                                              ^ Error: expect(received).toEqual(expected) // deep equality
  384 |   })
  385 | }
  386 | 
```