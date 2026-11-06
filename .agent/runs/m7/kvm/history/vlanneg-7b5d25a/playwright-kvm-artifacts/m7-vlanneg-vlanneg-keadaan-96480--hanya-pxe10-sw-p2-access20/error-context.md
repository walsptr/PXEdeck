# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m7-vlanneg.spec.ts >> vlanneg: keadaan akhir — host negatif tidak ada di dashboard (UI + API), dnsmasq/nginx tanpa jawaban, dnsmasq hanya pxe10, sw-p2 access20
- Location: e2e-kvm/m7-vlanneg.spec.ts:45:7

# Error details

```
Error: env VM MACS
```

# Test source

```ts
  1   | // Helper bersama suite KVM M7 (m7-vlan.spec.ts, m7-vlanneg.spec.ts). Batas keras CLAUDE.md / DEC-023 §4:
  2   | // host hanya ssh ke root@10.99.0.2 (server) dan root@10.99.0.3 (switch) dengan key infra di .agent/keys;
  3   | // semua yang menyentuh VLAN 10/20 dijalankan DI VM server (skrip lewat stdin `bash -s`) atau lewat relay.
  4   | import { spawnSync } from "node:child_process"
  5   | import path from "node:path"
  6   | 
  7   | const SSH_OPTS = ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes"]
  8   | 
  9   | function infraKey(): string {
  10  |   const key = path.resolve(process.env.PXE_KVM_INFRA_KEY ?? "")
  11  |   if (!/\/\.agent\/keys\/infra_ed25519$/.test(key)) throw new Error(`key infra ${key}`)
  12  |   return key
  13  | }
  14  | 
  15  | function vmRun(host: "10.99.0.2" | "10.99.0.3", script: string, envs: Record<string, string>, timeoutMs: number): { code: number; out: string } {
  16  |   const assigns = Object.entries(envs).map(([k, v]) => {
> 17  |     if (!/^[A-Z][A-Z0-9_]*$/.test(k) || !/^[A-Za-z0-9.:_/-]*$/.test(v)) throw new Error(`env VM ${k}`)
      |                                                                               ^ Error: env VM MACS
  18  |     return `${k}=${v}`
  19  |   })
  20  |   const r = spawnSync("ssh", ["-i", infraKey(), ...SSH_OPTS, `root@${host}`, `${assigns.join(" ")} bash -s`], {
  21  |     encoding: "utf8",
  22  |     timeout: timeoutMs,
  23  |     input: script,
  24  |     maxBuffer: 64 * 1024 * 1024,
  25  |   })
  26  |   return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
  27  | }
  28  | 
  29  | /** Skrip root DI VM pxe-test-server (10.99.0.2). Nilai env hanya karakter aman (divalidasi). */
  30  | export function serverRun(script: string, envs: Record<string, string> = {}, timeoutMs = 120_000) {
  31  |   return vmRun("10.99.0.2", script, envs, timeoutMs)
  32  | }
  33  | 
  34  | /** Skrip root DI VM pxe-test-switch (10.99.0.3), baca saja. */
  35  | export function switchRun(script: string, envs: Record<string, string> = {}, timeoutMs = 60_000) {
  36  |   return vmRun("10.99.0.3", script, envs, timeoutMs)
  37  | }
  38  | 
  39  | export type NginxLine = { ip: string; at: string; method: string; uri: string; status: number }
  40  | /** Baris log nginx `pxe` ('$remote_addr [$time_iso8601] "$method $pxe_log_uri" $status …') untuk MAC. */
  41  | export function nginxLinesFor(mac: string): NginxLine[] {
  42  |   const r = serverRun(`grep -aF -- "$NODE_MAC" /var/log/nginx/pxe-access.log || true`, { NODE_MAC: mac })
  43  |   const out: NginxLine[] = []
  44  |   for (const l of r.out.split("\n")) {
  45  |     const m = /^(\S+) \[([^\]]+)\] "(\S+) (\S+)" (\d{3}) /.exec(l)
  46  |     if (m) out.push({ ip: m[1], at: m[2], method: m[3], uri: m[4].replace(/(\/boot\/[^/]+\/)[A-Za-z0-9_-]{43}/, "$1<token>"), status: Number(m[5]) })
  47  |   }
  48  |   return out
  49  | }
  50  | 
  51  | export type DhcpTx = { at: string; xid: string; msgs: string[]; vendor: string; user: string }
  52  | /** Transaksi DHCP dari MAC di log dnsmasq (xid, pesan, vendor class opsi 60, user class opsi 77). */
  53  | export function dhcpTransactions(mac: string): DhcpTx[] {
  54  |   const r = serverRun(String.raw`
  55  | L=/var/log/dnsmasq-pxe.log
  56  | for x in $(grep -aE "DHCP(DISCOVER|REQUEST)\([a-z0-9]+\) .*$NODE_MAC" "$L" | awk '{print $5}' | sort -u); do
  57  |   grep -aE "dnsmasq-dhcp\[[0-9]+\]: $x (DHCP|vendor class|user class)" "$L"
  58  | done`, { NODE_MAC: mac })
  59  |   const txs = new Map<string, DhcpTx>()
  60  |   for (const l of r.out.split("\n")) {
  61  |     const m = /^(\w+ +\d+ [\d:]+) dnsmasq-dhcp\[\d+\]: (\d+) (.*)$/.exec(l)
  62  |     if (!m) continue
  63  |     const [, at, xid, rest] = m
  64  |     const t = txs.get(xid) ?? { at, xid, msgs: [], vendor: "-", user: "-" }
  65  |     if (rest.startsWith("vendor class:")) t.vendor = rest.slice(13).trim()
  66  |     else if (rest.startsWith("user class:")) t.user = rest.slice(11).trim()
  67  |     else if (rest.includes(mac)) {
  68  |       const msg = rest.split("(")[0]
  69  |       if (!t.msgs.includes(msg)) t.msgs.push(msg)
  70  |     }
  71  |     txs.set(xid, t)
  72  |   }
  73  |   return [...txs.values()]
  74  | }
  75  | /** Klien firmware/iPXE (boot PXE ulang), bukan OS terpasang. */
  76  | export const isBootClient = (t: DhcpTx) => /^(PXEClient|HTTPClient):/.test(t.vendor) || t.user === "iPXE"
  77  | 
  78  | export type CapPkt = { header: string; body: string; src: string; vlan: number | null; msgType: string; client: string }
  79  | /** Paket dari ringkasan `tcpdump -nn -e -v -r` (relay capture-stop). */
  80  | export function parseCapture(text: string): CapPkt[] {
  81  |   const pkts: CapPkt[] = []
  82  |   let cur: CapPkt | null = null
  83  |   for (const l of text.split("\n")) {
  84  |     const h = /^\d{2}:\d{2}:\d{2}\.\d+ ([0-9a-f:]{17}) > /.exec(l)
  85  |     if (h) {
  86  |       cur = { header: l, body: "", src: h[1], vlan: null, msgType: "", client: "" }
  87  |       const v = /\bvlan (\d+),/.exec(l)
  88  |       if (v) cur.vlan = Number(v[1])
  89  |       pkts.push(cur)
  90  |       continue
  91  |     }
  92  |     if (!cur) continue
  93  |     cur.body += l + "\n"
  94  |     const t = /DHCP-Message \(53\), length 1: (\w+)/.exec(l)
  95  |     if (t) cur.msgType = t[1]
  96  |     const c = /Client-Ethernet-Address ([0-9a-f:]{17})/.exec(l)
  97  |     if (c) cur.client = c[1]
  98  |   }
  99  |   return pkts
  100 | }
  101 | 
  102 | /** MTU VLAN 20 dari mgmt20 server ke node (DF): 1472 B ICMP = 1500 B IP; 1473 harus ditolak lokal. */
  103 | export function mtuCheck(nodeIp: string): { ok: boolean; out: string } {
  104 |   const r = serverRun(String.raw`
  105 | echo "# ip -d link mgmt20"; ip -d link show mgmt20 | head -n 3
  106 | echo "# ping -M do -s 1472 -c 3 $NODE_IP (dari mgmt20)"
  107 | ping -M do -s 1472 -c 3 -W 2 -I mgmt20 "$NODE_IP"; echo "# exit-1472=$?"
  108 | echo "# ping -M do -s 1473 -c 1 $NODE_IP (harus ditolak: > MTU 1500, DF)"
  109 | ping -M do -s 1473 -c 1 -W 2 -I mgmt20 "$NODE_IP"; echo "# exit-1473=$?"
  110 | `, { NODE_IP: nodeIp })
  111 |   const ok = /# exit-1472=0/.test(r.out) && /3 packets transmitted, 3 received/.test(r.out) && !/# exit-1473=0/.test(r.out)
  112 |   return { ok, out: r.out }
  113 | }
  114 | 
  115 | /** Penanda kernel installer di serial (Ubuntu casper/NFS, Rocky inst.ks, Debian preseed). */
  116 | export const INSTALLER_MARK = /netboot=nfs|casper\/vmlinuz|inst\.ks=|inst\.stage2=|preseed\/url=|auto=true priority=critical/g
  117 | 
```