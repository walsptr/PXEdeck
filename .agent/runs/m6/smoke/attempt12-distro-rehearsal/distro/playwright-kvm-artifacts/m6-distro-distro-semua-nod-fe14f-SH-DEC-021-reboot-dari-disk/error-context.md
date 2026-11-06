# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m6-distro.spec.ts >> distro: semua node Done ≤ 30 mnt tanpa reload, event berurutan, SSH + DEC-021 + reboot dari disk
- Location: e2e-kvm/m6-distro.spec.ts:164:7

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "pxe-test-m6distro-node24: login password tidak ditolak",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - generic [ref=f1e2]:
    - generic [ref=f1e5]:
      - list [ref=f1e7]:
        - listitem [ref=f1e8]:
          - link "PXE Lab 10.99.0.2" [ref=f1e9] [cursor=pointer]:
            - /url: /hosts
            - generic [ref=f1e18]:
              - generic [ref=f1e19]: PXE Lab
              - generic [ref=f1e20]: 10.99.0.2
      - navigation "Navigasi utama" [ref=f1e24]:
        - list [ref=f1e25]:
          - listitem [ref=f1e26]:
            - link "Hosts" [ref=f1e27] [cursor=pointer]:
              - /url: /hosts
          - listitem [ref=f1e32]:
            - link "OS Images" [ref=f1e33] [cursor=pointer]:
              - /url: /os-images
          - listitem [ref=f1e38]:
            - link "SSH Keys" [ref=f1e39] [cursor=pointer]:
              - /url: /ssh-keys
          - listitem [ref=f1e44]:
            - link "Provisioning Jobs" [ref=f1e45] [cursor=pointer]:
              - /url: /jobs
          - listitem [ref=f1e53]:
            - link "Settings" [ref=f1e54] [cursor=pointer]:
              - /url: /settings
      - list [ref=f1e60]:
        - listitem [ref=f1e61]:
          - generic "pxeadmin" [ref=f1e62]:
            - generic [ref=f1e63]: Masuk sebagai
            - text: pxeadmin
          - button "Keluar" [ref=f1e64]
    - main [ref=f1e69]:
      - generic [ref=f1e70]:
        - button "Toggle Sidebar" [ref=f1e71]
        - heading "Hosts" [level=1] [ref=f1e73]
        - generic [ref=f1e74]:
          - button "Cari MAC, hostname, IP… Ctrl K" [ref=f1e75]:
            - generic [ref=f1e79]: Cari MAC, hostname, IP…
            - generic [ref=f1e80]: Ctrl K
          - group "Status server PXE" [ref=f1e81]:
            - generic [ref=f1e82]:
              - generic [ref=f1e84]: DHCP
              - generic [ref=f1e85]: online
            - generic [ref=f1e86]:
              - generic [ref=f1e88]: TFTP
              - generic [ref=f1e89]: online
            - generic [ref=f1e90]:
              - generic [ref=f1e92]: HTTP
              - generic [ref=f1e93]: online
      - generic [ref=f1e95]:
        - generic [ref=f1e96]:
          - generic [ref=f1e97]:
            - group [ref=f1e98]:
              - group [ref=f1e99]
              - textbox "Cari host" [ref=f1e103]:
                - /placeholder: Cari MAC, hostname, atau IP
            - button "Status" [ref=f1e104]
            - combobox "Filter OS" [ref=f1e105]:
              - generic: Semua OS
          - generic [ref=f1e106]: 2 host · live, tiap 5 detik
        - table [ref=f1e111]:
          - rowgroup [ref=f1e112]:
            - row [ref=f1e113]:
              - columnheader [ref=f1e114]:
                - checkbox "Pilih semua host" [ref=f1e115]
              - columnheader [ref=f1e116]:
                - button "MAC Address" [ref=f1e117]
              - columnheader [ref=f1e121]:
                - button "Hostname" [ref=f1e122]
              - columnheader [ref=f1e126]:
                - button "IP" [ref=f1e127]
              - columnheader [ref=f1e131]:
                - button "Vendor" [ref=f1e132]
              - columnheader [ref=f1e136]:
                - button "OS" [ref=f1e137]
              - columnheader [ref=f1e141]:
                - button "Status" [ref=f1e142]
              - columnheader [ref=f1e146]:
                - button "Last seen" [ref=f1e147]
              - columnheader "Aksi" [ref=f1e150]
          - rowgroup [ref=f1e152]:
            - row [ref=f1e153]:
              - cell [ref=f1e154]:
                - checkbox "Pilih m6-node24" [ref=f1e155]
              - cell "52:54:00:99:00:24 Salin MAC" [ref=f1e156]:
                - generic [ref=f1e157]:
                  - generic [ref=f1e158]: 52:54:00:99:00:24
                  - button "Salin MAC" [ref=f1e159]
              - cell "m6-node24" [ref=f1e160]
              - cell "10.99.0.102 mgmt 10.99.0.34" [ref=f1e161]:
                - generic [ref=f1e162]:
                  - generic [ref=f1e163]: 10.99.0.102
                  - generic [ref=f1e164]: mgmt 10.99.0.34
              - cell "QEMU/KVM" [ref=f1e165]
              - cell "Rocky Linux 9" [ref=f1e166]
              - cell "Done" [ref=f1e169]
              - cell "3 menit yang lalu" [ref=f1e172]
              - cell [ref=f1e173]:
                - button "Aksi untuk m6-node24" [ref=f1e174]
            - row [ref=f1e175]:
              - cell [ref=f1e176]:
                - checkbox "Pilih m6-node23" [ref=f1e177]
              - cell "52:54:00:99:00:23 Salin MAC" [ref=f1e178]:
                - generic [ref=f1e179]:
                  - generic [ref=f1e180]: 52:54:00:99:00:23
                  - button "Salin MAC" [ref=f1e181]
              - cell "m6-node23" [ref=f1e182]
              - cell "10.99.0.101 mgmt 10.99.0.33" [ref=f1e183]:
                - generic [ref=f1e184]:
                  - generic [ref=f1e185]: 10.99.0.101
                  - generic [ref=f1e186]: mgmt 10.99.0.33
              - cell "QEMU/KVM" [ref=f1e187]
              - cell "Debian 12 (bookworm)" [ref=f1e188]
              - cell "Done" [ref=f1e191]
              - cell "7 menit yang lalu" [ref=f1e194]
              - cell [ref=f1e195]:
                - button "Aksi untuk m6-node23" [ref=f1e196]
  - region "Notifications alt+T"
  - alert [ref=f1e197]
```

# Test source

```ts
  177 |           note(n, `${st} (UI, +${Math.round((Date.now() - started) / 1000)} dtk)`)
  178 |           await page.screenshot({ path: shot(`${n.name}-${st}`) })
  179 |         }
  180 |         if (st === "done" || st === "failed") {
  181 |           pending.delete(n.name)
  182 |           doneS[n.name] = Math.round((Date.now() - started) / 1000)
  183 |         }
  184 |       }
  185 |       await page.waitForTimeout(3_000)
  186 |     }
  187 |     const noReload = await page.evaluate(STILL_NO_RELOAD)
  188 |     const failures: string[] = []
  189 |     for (const n of NODES) {
  190 |       const ac = n.os === "debian" ? "AC-6.48" : "AC-6.49"
  191 |       const problems: string[] = []
  192 |       const js = await jobs(n.mac)
  193 |       const evs = js[0] ? await jobLog(js[0].id) : []
  194 |       const msgs = evs.filter((e) => e.kind === "installer").map((e) => e.message.split("\n")[0])
  195 |       const order = inOrder(msgs, EXPECTED_EVENTS[n.os])
  196 |       note(n, `event installer: ${msgs.join(" | ")}`)
  197 |       if (JSON.stringify(seen[n.name]) !== JSON.stringify(["booting", "installing", "configuring", "done"])) problems.push(`urutan status ${seen[n.name]?.join(">")}`)
  198 |       if ((doneS[n.name] ?? 1e9) > INSTALL_TIMEOUT_MS / 1000) problems.push("lewat 30 mnt")
  199 |       if (!order.ok) problems.push(`event hilang/tidak berurutan: ${order.missing.join(", ")}`)
  200 |       if (!noReload) problems.push("halaman di-reload")
  201 |       let up = false
  202 |       for (let i = 0; i < 60 && !up; i++) {
  203 |         up = ssh(n.ip, "true").code === 0
  204 |         if (!up) await page.waitForTimeout(10_000)
  205 |       }
  206 |       const envs = [
  207 |         `EXPECT_HOSTNAME=${n.hostname}`, `EXPECT_IP=${n.ip}`, `EXPECT_PREFIX=${KVM.prefix}`, `EXPECT_MAC=${n.mac}`,
  208 |         `EXPECT_GW=${KVM.gateway}`, `EXPECT_DNS=${KVM.dns}`, `EXPECT_USER=${KVM.user}`, `EXPECT_PUBKEY='${publicKey()}'`,
  209 |       ].join(" ")
  210 |       const script = readFileSync(path.join(__dirname, "verify-node.sh"), "utf8")
  211 |       const v1 = ssh(n.ip, `${envs} bash -s`, script)
  212 |       const pw = passwordLoginRejected(n.ip)
  213 |       const facts = ssh(
  214 |         n.ip,
  215 |         "bash -s",
  216 |         [
  217 |           'echo "# hostname: $(hostname)"',
  218 |           "echo '# locale'; localectl status 2>&1 | head -n 3",
  219 |           "echo '# sudo'; sudo -n true && echo sudo-ok",
  220 |           "echo '# apt trusted=yes (DEC-021 §2)'; n=$(sudo -n grep -rl 'trusted=yes' /etc/apt 2>/dev/null | wc -l); echo \"trusted_files=$n\"",
  221 |           "echo '# 00AllowUnauthenticated'; if sudo -n test -e /etc/apt/apt.conf.d/00AllowUnauthenticated; then echo allow_unauth=ADA; else echo allow_unauth=tidak-ada; fi",
  222 |           "echo '# UEFI fallback'; if sudo -n test -f /boot/efi/EFI/BOOT/BOOTX64.EFI; then echo bootx64=ADA; else echo bootx64=TIDAK; fi",
  223 |           "echo '# cmdline'; cat /proc/cmdline",
  224 |           "echo '# lsblk'; lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT",
  225 |         ].join("\n") + "\n",
  226 |       )
  227 |       // Log installer nyata (bahan fixture AC-6.17; disamarkan redact-evidence.sh oleh kvm-run.sh).
  228 |       const dir = path.join(KVM.runsDir, "installer-logs")
  229 |       mkdirSync(dir, { recursive: true })
  230 |       for (const f of INSTALLER_LOGS[n.os]) {
  231 |         const r = ssh(n.ip, `sudo -n cat ${f}`, undefined, { maxBuffer: 256 * 1024 * 1024, stdoutOnly: true })
  232 |         if (r.code === 0) writeFileSync(path.join(dir, `${n.name}-${path.basename(f)}${path.extname(f) ? "" : ".log"}`), r.out)
  233 |         note(n, `log installer ${f}: exit=${r.code} bytes=${r.out.length}`)
  234 |       }
  235 |       // Reboot dari disk.
  236 |       const jobsBefore = js.length
  237 |       ssh(n.ip, "sudo -n systemctl reboot")
  238 |       await page.waitForTimeout(20_000)
  239 |       let back = false
  240 |       const deadline = Date.now() + 10 * 60_000
  241 |       while (Date.now() < deadline && !back) {
  242 |         back = ssh(n.ip, "true").code === 0
  243 |         if (!back) await page.waitForTimeout(5_000)
  244 |       }
  245 |       const after = back ? ssh(n.ip, `hostname; cat /proc/cmdline`) : { code: -1, out: "" }
  246 |       const v2 = back ? ssh(n.ip, `${envs} bash -s`, script) : { code: -1, out: "node tidak kembali" }
  247 |       const host = (await (await page.request.get(`/api/hosts/${hostId(n.mac)}`)).json()) as { status: string; hostname: string; mgmtIp: string }
  248 |       const jobsAfter = (await jobs(n.mac)).length
  249 |       const f = facts.out
  250 |       if (v1.code !== 0) problems.push(`verify-node exit ${v1.code}`)
  251 |       if (!pw.ok) problems.push("login password tidak ditolak")
  252 |       if (!f.includes(`# hostname: ${n.hostname}`)) problems.push("hostname")
  253 |       if (!f.includes("sudo-ok")) problems.push("sudo")
  254 |       if (!/en_US\.UTF-8/.test(f)) problems.push("locale")
  255 |       if (n.os === "debian" && !f.includes("trusted_files=0")) problems.push("trusted=yes tersisa di /etc/apt (DEC-021 §2)")
  256 |       if (n.os === "debian" && !f.includes("allow_unauth=tidak-ada")) problems.push("00AllowUnauthenticated tersisa (DEC-021 §2)")
  257 |       if (!f.includes("bootx64=ADA")) problems.push("\\EFI\\BOOT\\BOOTX64.EFI tidak ada")
  258 |       if (!back || !after.out.startsWith(n.hostname) || INSTALLER_CMDLINE.test(after.out) || v2.code !== 0) problems.push(`reboot: kembali=${back} v2=${v2.code}`)
  259 |       if (host.status !== "done" || jobsAfter !== jobsBefore) problems.push(`sesudah reboot status=${host.status} job ${jobsBefore}->${jobsAfter}`)
  260 |       const file = `${n.name}-verify-ssh.txt`
  261 |       writeFileSync(
  262 |         path.join(KVM.runsDir, file),
  263 |         [
  264 |           `# ${ac} ${n.name} (${n.os}): ${seen[n.name]?.join(" → ")} dalam ${doneS[n.name]} dtk; UI tanpa reload=${noReload}`,
  265 |           `# event installer berurutan: ${order.ok} ${order.missing.join(", ")}`, ...msgs.map((m) => `  ${m}`),
  266 |           "# verify-node.sh sebelum reboot", v1.out, `# exit=${v1.code}`,
  267 |           "# login password", pw.out.trim(), `# ditolak=${pw.ok}`,
  268 |           "# fakta node", f,
  269 |           `# reboot: kembali=${back}`, after.out, "# verify-node.sh sesudah reboot", v2.out, `# exit=${v2.code}`,
  270 |           `# host sesudah reboot: status=${host.status} hostname=${host.hostname} mgmtIp=${host.mgmtIp}; job ${jobsBefore}->${jobsAfter}`,
  271 |           `# masalah: ${problems.join("; ") || "tidak ada"}`,
  272 |         ].join("\n") + "\n",
  273 |       )
  274 |       record({ ac, node: n.name, status: problems.length ? "FAIL" : "PASS", durationS: doneS[n.name], note: problems.join("; ") || `${seen[n.name]?.join("→")} ${doneS[n.name]}s; verify ${v1.code}/${v2.code}`, evidence: [file, `${n.name}-timeline.txt`, "installer-logs/"] })
  275 |       if (problems.length) failures.push(`${n.name}: ${problems.join("; ")}`)
  276 |     }
> 277 |     expect(failures).toEqual([])
      |                      ^ Error: expect(received).toEqual(expected) // deep equality
  278 |   })
  279 | }
  280 | 
```