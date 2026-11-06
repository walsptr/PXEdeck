// Helper bersama suite KVM M7 (m7-vlan.spec.ts, m7-vlanneg.spec.ts). Batas keras CLAUDE.md / DEC-023 §4:
// host hanya ssh ke root@10.99.0.2 (server) dan root@10.99.0.3 (switch) dengan key infra di .agent/keys;
// semua yang menyentuh VLAN 10/20 dijalankan DI VM server (skrip lewat stdin `bash -s`) atau lewat relay.
import { spawnSync } from "node:child_process"
import path from "node:path"

const SSH_OPTS = ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes"]

function infraKey(): string {
  const key = path.resolve(process.env.PXE_KVM_INFRA_KEY ?? "")
  if (!/\/\.agent\/keys\/infra_ed25519$/.test(key)) throw new Error(`key infra ${key}`)
  return key
}

function vmRun(host: "10.99.0.2" | "10.99.0.3", script: string, envs: Record<string, string>, timeoutMs: number): { code: number; out: string } {
  const assigns = Object.entries(envs).map(([k, v]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k) || !/^[A-Za-z0-9.:_/,-]*$/.test(v)) throw new Error(`env VM ${k}`)
    return `${k}=${v}`
  })
  const r = spawnSync("ssh", ["-i", infraKey(), ...SSH_OPTS, `root@${host}`, `${assigns.join(" ")} bash -s`], {
    encoding: "utf8",
    timeout: timeoutMs,
    input: script,
    maxBuffer: 64 * 1024 * 1024,
  })
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

/** Skrip root DI VM pxe-test-server (10.99.0.2). Nilai env hanya karakter aman (divalidasi). */
export function serverRun(script: string, envs: Record<string, string> = {}, timeoutMs = 120_000) {
  return vmRun("10.99.0.2", script, envs, timeoutMs)
}

/** Skrip root DI VM pxe-test-switch (10.99.0.3), baca saja. */
export function switchRun(script: string, envs: Record<string, string> = {}, timeoutMs = 60_000) {
  return vmRun("10.99.0.3", script, envs, timeoutMs)
}

export type NginxLine = { ip: string; at: string; method: string; uri: string; status: number }
/** Baris log nginx `pxe` ('$remote_addr [$time_iso8601] "$method $pxe_log_uri" $status …') untuk MAC. */
export function nginxLinesFor(mac: string): NginxLine[] {
  const r = serverRun(`grep -aF -- "$NODE_MAC" /var/log/nginx/pxe-access.log || true`, { NODE_MAC: mac })
  const out: NginxLine[] = []
  for (const l of r.out.split("\n")) {
    const m = /^(\S+) \[([^\]]+)\] "(\S+) (\S+)" (\d{3}) /.exec(l)
    if (m) out.push({ ip: m[1], at: m[2], method: m[3], uri: m[4].replace(/(\/boot\/[^/]+\/)[A-Za-z0-9_-]{43}/, "$1<token>"), status: Number(m[5]) })
  }
  return out
}

export type DhcpTx = { at: string; xid: string; msgs: string[]; vendor: string; user: string }
/** Transaksi DHCP dari MAC di log dnsmasq (xid, pesan, vendor class opsi 60, user class opsi 77). */
export function dhcpTransactions(mac: string): DhcpTx[] {
  const r = serverRun(String.raw`
L=/var/log/dnsmasq-pxe.log
for x in $(grep -aE "DHCP(DISCOVER|REQUEST)\([a-z0-9]+\) .*$NODE_MAC" "$L" | awk '{print $5}' | sort -u); do
  grep -aE "dnsmasq-dhcp\[[0-9]+\]: $x (DHCP|vendor class|user class)" "$L"
done`, { NODE_MAC: mac })
  const txs = new Map<string, DhcpTx>()
  for (const l of r.out.split("\n")) {
    const m = /^(\w+ +\d+ [\d:]+) dnsmasq-dhcp\[\d+\]: (\d+) (.*)$/.exec(l)
    if (!m) continue
    const [, at, xid, rest] = m
    const t = txs.get(xid) ?? { at, xid, msgs: [], vendor: "-", user: "-" }
    if (rest.startsWith("vendor class:")) t.vendor = rest.slice(13).trim()
    else if (rest.startsWith("user class:")) t.user = rest.slice(11).trim()
    else if (rest.includes(mac)) {
      const msg = rest.split("(")[0]
      if (!t.msgs.includes(msg)) t.msgs.push(msg)
    }
    txs.set(xid, t)
  }
  return [...txs.values()]
}
/** Klien firmware/iPXE (boot PXE ulang), bukan OS terpasang. */
export const isBootClient = (t: DhcpTx) => /^(PXEClient|HTTPClient):/.test(t.vendor) || t.user === "iPXE"

export type CapPkt = { header: string; body: string; src: string; vlan: number | null; msgType: string; client: string }
/** Paket dari ringkasan `tcpdump -nn -e -v -r` (relay capture-stop). */
export function parseCapture(text: string): CapPkt[] {
  const pkts: CapPkt[] = []
  let cur: CapPkt | null = null
  for (const l of text.split("\n")) {
    const h = /^\d{2}:\d{2}:\d{2}\.\d+ ([0-9a-f:]{17}) > /.exec(l)
    if (h) {
      cur = { header: l, body: "", src: h[1], vlan: null, msgType: "", client: "" }
      const v = /\bvlan (\d+),/.exec(l)
      if (v) cur.vlan = Number(v[1])
      pkts.push(cur)
      continue
    }
    if (!cur) continue
    cur.body += l + "\n"
    const t = /DHCP-Message \(53\), length 1: (\w+)/.exec(l)
    if (t) cur.msgType = t[1]
    const c = /Client-Ethernet-Address ([0-9a-f:]{17})/.exec(l)
    if (c) cur.client = c[1]
  }
  return pkts
}

/** MTU VLAN 20 dari mgmt20 server ke node (DF): 1472 B ICMP = 1500 B IP; 1473 harus ditolak lokal. */
export function mtuCheck(nodeIp: string): { ok: boolean; out: string } {
  const r = serverRun(String.raw`
echo "# ip -d link mgmt20"; ip -d link show mgmt20 | head -n 3
echo "# ping -M do -s 1472 -c 3 $NODE_IP (dari mgmt20)"
ping -M do -s 1472 -c 3 -W 2 -I mgmt20 "$NODE_IP"; echo "# exit-1472=$?"
echo "# ping -M do -s 1473 -c 1 $NODE_IP (harus ditolak: > MTU 1500, DF)"
ping -M do -s 1473 -c 1 -W 2 -I mgmt20 "$NODE_IP"; echo "# exit-1473=$?"
`, { NODE_IP: nodeIp })
  const ok = /# exit-1472=0/.test(r.out) && /3 packets transmitted, 3 received/.test(r.out) && !/# exit-1473=0/.test(r.out)
  return { ok, out: r.out }
}

/** Penanda kernel installer di serial (Ubuntu casper/NFS, Rocky inst.ks, Debian preseed). */
export const INSTALLER_MARK = /netboot=nfs|casper\/vmlinuz|inst\.ks=|inst\.stage2=|preseed\/url=|auto=true priority=critical/g

/** DEC-027 §4: `?password=…` / `&username=…` bernilai (bukan `<REDACTED…>`, `***`, atau kosong) = temuan scan bukti. */
export const URL_CRED = /[?&](password|username)=(?!<REDACTED|\*\*\*|…|`)[^&\s"]+/i
