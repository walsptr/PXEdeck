// Suite KVM M7 uji negatif isolasi (M7-T11, docs/design/M7-plan.md §2.7, AC-7.26–7.28, DEC-024 O9-A) —
// DIJALANKAN HANYA lewat
//   infra/kvm-run.sh m7 --scenario vlanneg   (node "36:uefi:neg=admin 37:bios:neg=access20 38:uefi:neg=tagged10")
// kvm-run.sh menjalankan alur per node (satu node pada satu waktu: profil sw-p2 → capture DHCP → node →
// tunggu 240 dtk → ringkasan pcap, log dnsmasq/nginx, /api/hosts, domifstat, counter sw-p2 → destroy) dan
// menulis entri AC-7.26/27/28 per node. Suite ini (berjalan SESUDAHNYA) memeriksa keadaan akhir lewat
// dashboard dan VM server/switch:
//  - /api/hosts (sesi admin, UI login) tidak memuat MAC node negatif; tabel /hosts kosong untuk MAC itu.
//  - Log dnsmasq seluruh run: tidak ada OFFER/ACK untuk MAC node negatif; log nginx: tidak ada request
//    dengan MAC itu.
//  - dnsmasq hanya terikat pxe10 (`ss -lunp`), ip_forward=0 (perimeter isolasi DEC-023 §3).
//  - sw-p2 kembali ke profil access20 setelah N3 (pxe-switch.sh verify di VM switch).
//  - Bukti pcap/kvm-run per node ada dan berisi hasil yang diharapkan (silang-periksa entri kvm-run).
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { expect, test } from "@playwright/test"

import { adminCredentials, KVM, kvmNodes, record, scanEvidence, TOPOLOGY, writeResults } from "./kvm-harness"
import { serverRun, switchRun } from "./m7-shared"

const NEG = process.env.PXE_KVM_SCENARIO === "vlanneg"
/** Node negatif dari PXE_KVM_NODES: NN 36 (admin), 37 (access20), 38 (tagged10) — urutan default kvm-run. */
const NEG_OF: Record<string, { ac: string; neg: string; capIf: string }> = {
  "36": { ac: "AC-7.26", neg: "admin", capIf: "pxe0" },
  "37": { ac: "AC-7.27", neg: "access20", capIf: "trunk0" },
  "38": { ac: "AC-7.28", neg: "tagged10", capIf: "trunk0" },
}

if (NEG) {
  if (TOPOLOGY !== "vlan") throw new Error("m7-vlanneg: PXE_KVM_TOPOLOGY harus vlan")
  const NODES = kvmNodes()

  test.afterAll(() => {
    const [, adminPw] = adminCredentials()
    const findings = scanEvidence([adminPw])
    writeFileSync(
      path.join(KVM.runsDir, "evidence-scan.txt"),
      findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password admin, token /boot/, private key (teks & base64)\n",
    )
    record({ ac: "AC-7.30-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan (scan harness)`, evidence: ["evidence-scan.txt"] })
    writeResults({ scenario: "vlanneg", nodes: NODES.map((n) => ({ name: n.name, fw: n.fw, mac: n.mac })) })
  })

  test("vlanneg: keadaan akhir — host negatif tidak ada di dashboard (UI + API), dnsmasq/nginx tanpa jawaban, dnsmasq hanya pxe10, sw-p2 access20", async ({ page }) => {
    const problems: string[] = []
    const lines: string[] = []
    // UI login + tabel host.
    const [user, pw] = adminCredentials()
    await page.goto("/hosts")
    await expect(page).toHaveURL(/\/login\?next=%2Fhosts$/)
    await page.getByLabel("Username").fill(user)
    await page.getByLabel("Password", { exact: true }).fill(pw)
    await page.getByTestId("login-submit").click()
    await expect(page).toHaveURL(/\/hosts$/, { timeout: 30_000 })
    await page.screenshot({ path: path.join(KVM.runsDir, "screenshots", "vlanneg-hosts.png") })
    const hosts = (await (await page.request.get("/api/hosts")).json()) as { hosts: { mac: string }[] }
    lines.push(`GET /api/hosts (sesi): ${hosts.hosts.length} host: ${hosts.hosts.map((h) => h.mac).join(", ") || "—"}`)
    for (const n of NODES) {
      const inApi = hosts.hosts.some((h) => h.mac.toLowerCase() === n.mac)
      const inUi = await page.getByText(n.mac, { exact: true }).count()
      lines.push(`${n.name} ${n.mac}: di /api/hosts=${inApi} di tabel UI=${inUi}`)
      if (inApi || inUi) problems.push(`${n.mac} muncul di dashboard`)
    }
    // dnsmasq & nginx seluruh run; socket dnsmasq; ip_forward.
    const macs = NODES.map((n) => n.mac).join(",")
    const srv = serverRun(String.raw`
MACS="$(echo "$MACS" | tr , "|")"
echo "# dnsmasq: baris yang memuat MAC negatif"; grep -aiE "$MACS" /var/log/dnsmasq-pxe.log | grep -aE "DHCP(OFFER|ACK)|tftp" || echo "(tidak ada OFFER/ACK/tftp)"
echo "# dnsmasq OFFER/ACK count=$(grep -aiE "$MACS" /var/log/dnsmasq-pxe.log | grep -acE 'DHCP(OFFER|ACK)')"
echo "# nginx count=$(grep -aciE "$MACS" /var/log/nginx/pxe-access.log)"
echo "# ip_forward=$(cat /proc/sys/net/ipv4/ip_forward)"
echo "# ss -lunp dnsmasq"; ss -lunp | grep dnsmasq`, { MACS: macs })
    writeFileSync(path.join(KVM.runsDir, "vlanneg-server-final.txt"), srv.out)
    if (!/# dnsmasq OFFER\/ACK count=0\b/.test(srv.out)) problems.push("dnsmasq menjawab MAC negatif")
    if (!/# nginx count=0\b/.test(srv.out)) problems.push("nginx menerima request MAC negatif")
    if (!/# ip_forward=0/.test(srv.out)) problems.push("ip_forward bukan 0")
    const sock = srv.out.split("# ss -lunp dnsmasq")[1]?.split("\n").filter((l) => l.includes("dnsmasq")) ?? []
    const badSock = sock.filter((l) => !/\s(10\.99\.10\.2:(53|67|69)|\S*%pxe10\]?:\d+)\s/.test(l))
    if (!sock.length || badSock.length) problems.push(`socket dnsmasq di luar pxe10: ${badSock.join(" | ") || "tidak ada"}`)
    // Switch: sw-p2 kembali access20.
    const sw = switchRun("/usr/local/sbin/pxe-switch.sh verify")
    writeFileSync(path.join(KVM.runsDir, "vlanneg-switch-final.txt"), sw.out)
    if (!/sw-p2 20 pvid-untagged/.test(sw.out) || /sw-p2 10 /.test(sw.out) || !/RESULT: PASS/.test(sw.out)) problems.push("sw-p2 tidak kembali ke access20")
    // Silang-periksa bukti kvm-run per node (ringkasan pcap DHCP saja).
    for (const n of NODES) {
      const meta = NEG_OF[n.nn]
      if (!meta) {
        problems.push(`${n.name}: NN ${n.nn} bukan node vlanneg default`)
        continue
      }
      const cf = path.join(KVM.runsDir, `${n.name}-capture-${meta.capIf}.txt`)
      const cap = existsSync(cf) ? readFileSync(cf, "utf8") : ""
      const req = (cap.match(new RegExp(`Request from ${n.mac}`, "g")) ?? []).length
      const rep = (cap.match(/BOOTP\/DHCP, Reply/g) ?? []).length
      const tag20 = (cap.match(new RegExp(`${n.mac} > [^\\n]*vlan 20,`, "g")) ?? []).length
      const from = (cap.match(new RegExp(`${n.mac} > `, "g")) ?? []).length
      let ok = rep === 0 && cap.length > 0
      if (meta.neg === "admin") ok &&= req >= 1
      if (meta.neg === "access20") ok &&= tag20 >= 1
      if (meta.neg === "tagged10") ok &&= from === 0
      lines.push(`${meta.ac} ${n.name} neg=${meta.neg} pcap ${meta.capIf}: request=${req} reply=${rep} tag20=${tag20} frame-dari-MAC=${from} → ${ok ? "sesuai" : "TIDAK sesuai"}`)
      if (!ok) problems.push(`${meta.ac} pcap ${meta.capIf} tidak sesuai`)
    }
    lines.push(`masalah: ${problems.join("; ") || "tidak ada"}`)
    writeFileSync(path.join(KVM.runsDir, "vlanneg-final.txt"), lines.join("\n") + "\n")
    record({ ac: "AC-7.26-28-final", status: problems.length ? "FAIL" : "PASS", note: problems.join("; ") || "dashboard tanpa host negatif; dnsmasq/nginx tanpa jawaban; dnsmasq hanya pxe10; sw-p2 access20", evidence: ["vlanneg-final.txt", "vlanneg-server-final.txt", "vlanneg-switch-final.txt", "screenshots/vlanneg-hosts.png"] })
    expect(problems).toEqual([])
  })
}
