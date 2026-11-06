// Smoke KVM dini M7 (M7-T10, docs/design/M7-plan.md §5 baris "smoke", DEC-023/DEC-024) — DIJALANKAN
// HANYA lewat
//   infra/kvm-run.sh m7 --scenario vlansmoke [--nodes "41:uefi 42:uefi:os=rocky 43:uefi:os=debian"]
// (PXE_KVM_SCENARIO=vlansmoke, PXE_KVM_TOPOLOGY=vlan; test hanya terdaftar untuk skenario itu).
//
// Lewat API dengan sesi admin (bukan UI): per node di pxe-test-port1 (VLAN 10 native, VLAN 20 ber-tag)
//   discover (lease VLAN 10) → PATCH konfigurasi (IP statis 10.99.20.(10+NN)/24, VLAN 20, gateway
//   10.99.20.1, DNS 10.99.10.2, credentials, hostname, key ed25519 sekali pakai) → install → node.sh
//   reset → Booting → Installing → Configuring → Done ≤ 30 mnt → verifikasi lewat relay di VM server
//   (verify-node.sh EXPECT_VLAN=20, login password ditolak) → MTU frame ber-tag (ping DF 1472 dari
//   mgmt20 server ke node; 1473 harus ditolak lokal) → reboot dari disk (relay) → verifikasi ulang,
//   status tetap Done, jumlah job tetap, tanpa kernel installer baru di serial.
// Bukti opsi (M7-options.md):
//   O5  Ubuntu: snapshot server selama install (koneksi NFS :2049 dan request nginx per IP sumber) →
//       <node>-o5.txt; installer pindah ke IP VLAN 20 lalu tetap selesai.
//   O6  Rocky: parent (native) tanpa IPv4 di OS terpasang (verify-node.sh) + DHCP dari MAC setelah
//       Done hanya dari boot PXE ulang (<node>-dhcp-after.txt).
//   O10 Debian: anak VLAN ifupdown naik di target sebelum & sesudah reboot (verify-node.sh).
//   MTU <node>-mtu.txt.
// Host TIDAK PERNAH menyasar 10.99.10.*/10.99.20.* (tanpa route → LAN fisik): semua ke node lewat
// infra/vlan/relay.sh atau perintah yang berjalan DI VM server (ssh root@10.99.0.2 'bash -s').
import { spawnSync } from "node:child_process"
import { appendFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type APIRequestContext } from "@playwright/test"

import {
  adminCredentials,
  consoleLog,
  KVM,
  kvmNodes,
  publicKey,
  record,
  relayAsync,
  resetNode,
  scanEvidence,
  sessionPassword,
  TOPOLOGY,
  writeResults,
  type KvmNode,
} from "./kvm-harness"

const SMOKE = process.env.PXE_KVM_SCENARIO === "vlansmoke"
const BASE = process.env.PXE_KVM_BASE_URL ?? "http://10.99.0.2"
const ORIGIN = { Origin: BASE }
const PASSWORD = sessionPassword()
const VLAN = Number(process.env.PXE_KVM_VLAN ?? "20")
const OS_IMAGE: Record<KvmNode["os"], string> = { ubuntu: "ubuntu-24.04", debian: "debian-12", rocky: "rocky-9" }
const INSTALL_TIMEOUT_MS = 30 * 60_000
const hostId = (mac: string) => mac.replaceAll(":", "")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Penanda kernel installer di serial (Ubuntu casper/NFS, Rocky inst.ks, Debian preseed). */
const INSTALLER_MARK = /netboot=nfs|casper\/vmlinuz|inst\.ks=|inst\.stage2=|preseed\/url=|auto=true priority=critical/g

type Job = { id: string; status: string; failureReason: string | null; stages: { stage: string; at: string; source: string }[]; installerBoots: number }
type Ev = { seq: number; at: string; kind: string; level: string; source: string; message: string }
type HostJson = { status: string; hostname: string | null; mgmtIp: string | null; currentIp: string | null; firmware: string }

let api: APIRequestContext

function note(node: KvmNode, msg: string) {
  appendFileSync(path.join(KVM.runsDir, `${node.name}-timeline.txt`), `${new Date().toISOString()} ${msg}\n`)
}

/**
 * Jalankan `script` sebagai root DI VM pxe-test-server (ssh root@10.99.0.2 'ENV… bash -s' dengan key
 * infra di .agent/keys). Dipakai untuk bukti sisi server (log, ss, ping dari mgmt20) — host sendiri
 * tidak pernah mengirim paket ke VLAN 10/20. `env` hanya nilai yang sudah divalidasi.
 */
function serverRun(script: string, envs: Record<string, string> = {}, timeoutMs = 120_000): { code: number; out: string } {
  const key = path.resolve(process.env.PXE_KVM_INFRA_KEY ?? "")
  if (!/\/\.agent\/keys\/infra_ed25519$/.test(key)) throw new Error(`key infra ${key}`)
  const assigns = Object.entries(envs).map(([k, v]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k) || !/^[A-Za-z0-9.:_-]*$/.test(v)) throw new Error(`env server ${k}`)
    return `${k}=${v}`
  })
  const r = spawnSync(
    "ssh",
    ["-i", key, "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "root@10.99.0.2", `${assigns.join(" ")} bash -s`],
    { encoding: "utf8", timeout: timeoutMs, input: script, maxBuffer: 64 * 1024 * 1024 },
  )
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

/** Akses nginx per IP sumber + path (token /boot/<mac>/<token>/ disamarkan DI server). */
const NGINX_BY_IP = String.raw`
L=/var/log/nginx/pxe-access.log
echo "# nginx: request per IP sumber (MAC $NODE_MAC / IP statis $NODE_IP)"
awk '{print $1}' "$L" | sort | uniq -c | sort -rn
echo "# nginx: request dari IP statis $NODE_IP (VLAN mgmt), path tanpa token"
grep -F "$NODE_IP " "$L" | awk '{print $4, $1, $6, $7, $9}' | sed -E 's#(/boot/[^/ ]+/)[A-Za-z0-9_-]{43}#\1<token>#g' | tail -n 200
`

/** Snapshot O5 (Ubuntu): koneksi NFS :2049 + neighbor mgmt20 + jumlah request per IP sumber. */
const O5_SNAPSHOT = String.raw`
echo "## $(date -u +%FT%TZ)"
echo "# ss -tn sport = :2049 (established)"; ss -tnH state established '( sport = :2049 )'
echo "# ip neigh dev mgmt20"; ip neigh show dev mgmt20
echo "# nginx request dari $NODE_IP: $(grep -cF "$NODE_IP " /var/log/nginx/pxe-access.log)"
`

/** MTU VLAN 20 dari mgmt20 server ke node (DF): 1472 B ICMP = 1500 B IP (+ tag 802.1Q di kabel). */
const MTU_SCRIPT = String.raw`
echo "# ip -d link mgmt20 / trunk0"; ip -d link show mgmt20 | head -n 3; ip -d link show trunk0 | head -n 2
echo "# ping -M do -s 1472 -c 3 $NODE_IP (dari mgmt20)"
ping -M do -s 1472 -c 3 -W 2 -I mgmt20 "$NODE_IP"; echo "# exit-1472=$?"
echo "# ping -M do -s 1473 -c 1 $NODE_IP (harus ditolak: > MTU 1500, DF)"
ping -M do -s 1473 -c 1 -W 2 -I mgmt20 "$NODE_IP"; echo "# exit-1473=$?"
`

/** DHCP dari MAC di log dnsmasq (O6: lease baru sesudah Done hanya dari boot PXE ulang). */
const DHCP_LOG = String.raw`
echo "# dnsmasq DHCP/TFTP untuk $NODE_MAC (baris DHCPDISCOVER/OFFER/REQUEST/ACK + tftp)"
grep -iE "DHCP(DISCOVER|OFFER|REQUEST|ACK)\([a-z0-9]+\) .*$NODE_MAC|sent .*(snponly|undionly)" /var/log/dnsmasq-pxe.log | tail -n 60
`

async function latestJob(mac: string): Promise<Job | null> {
  const r = await api.get(`/api/jobs?hostId=${hostId(mac)}&limit=200`)
  expect(r.status(), "GET /api/jobs").toBe(200)
  return ((await r.json()) as { jobs: Job[] }).jobs[0] ?? null
}

async function jobsCount(mac: string): Promise<number> {
  const r = await api.get(`/api/jobs?hostId=${hostId(mac)}&limit=200`)
  return ((await r.json()) as { jobs: Job[] }).jobs.length
}

async function hostJson(mac: string): Promise<HostJson> {
  const r = await api.get(`/api/hosts/${hostId(mac)}`)
  expect(r.status(), "GET /api/hosts/:id").toBe(200)
  return (await r.json()) as HostJson
}

async function jobEvents(id: string): Promise<Ev[]> {
  const out: Ev[] = []
  let after = 0
  for (;;) {
    const r = await api.get(`/api/jobs/${id}/logs?format=json&after=${after}`)
    expect(r.status(), "GET /api/jobs/:id/logs").toBe(200)
    const b = (await r.json()) as { events: Ev[] }
    if (!b.events.length) break
    out.push(...b.events)
    after = b.events[b.events.length - 1].seq
    if (b.events.length < 1000) break
  }
  return out
}

async function waitDiscovered(node: KvmNode) {
  await expect
    .poll(async () => {
      const r = await api.get(`/api/hosts/${hostId(node.mac)}`)
      return r.status() === 200 ? ((await r.json()) as HostJson).firmware : `HTTP ${r.status()}`
    }, { timeout: 10 * 60_000, intervals: [2_000, 5_000, 10_000] })
    .toBe(node.fw)
  const h = await hostJson(node.mac)
  note(node, `discovered firmware=${node.fw} currentIp=${h.currentIp} (lease VLAN 10)`)
  return h
}

async function configure(node: KvmNode) {
  const id = hostId(node.mac)
  const body = {
    os: { osImageId: OS_IMAGE[node.os], disk: "", partition: "auto", timezone: "UTC", locale: "en_US.UTF-8" },
    credentials: { mode: "same", username: KVM.user, password: PASSWORD, sudo: true, disableSshPassword: true },
    network: { mode: "static", assignments: { [id]: node.ip }, prefix: KVM.prefix, gateway: KVM.gateway, dns: [KVM.dns], vlan: VLAN, iface: { by: "mac" } },
    hostname: { assignments: { [id]: node.hostname } },
    ssh: { keyIds: [], newKeys: [{ name: `${KVM.run}-${node.nn}`, publicKey: publicKey(), saveToLibrary: false }], user: "" },
  }
  const r = await api.patch(`/api/hosts/${id}`, { data: body, headers: ORIGIN })
  expect(r.status(), `PATCH /api/hosts/${id}: ${await r.text()}`).toBe(200)
  note(node, `konfigurasi tersimpan os=${OS_IMAGE[node.os]} ip=${node.ip}/${KVM.prefix} vlan=${VLAN} gw=${KVM.gateway} dns=${KVM.dns} hostname=${node.hostname}`)
}

async function install(node: KvmNode): Promise<Job> {
  const id = hostId(node.mac)
  const r = await api.post(`/api/hosts/${id}/install`, { headers: ORIGIN })
  expect(r.status(), `POST install: ${await r.text()}`).toBe(200)
  expect(((await r.json()) as { started: string[] }).started).toContain(id)
  const job = await latestJob(node.mac)
  expect(job?.status).toBe("booting")
  note(node, `install dibuat job=${job!.id} status=booting`)
  resetNode(node)
  note(node, "node.sh reset")
  return job!
}

/** Ikuti status job sampai done/failed/batas waktu; Ubuntu: snapshot O5 per transisi + tiap ±60 dtk. */
async function follow(node: KvmNode, jobId: string, timeoutMs: number): Promise<{ job: Job; seen: string[]; ms: number }> {
  const t0 = Date.now()
  const seen: string[] = []
  let job: Job | null = null
  let lastSnap = 0
  const o5 = path.join(KVM.runsDir, `${node.name}-o5.txt`)
  while (Date.now() - t0 < timeoutMs) {
    job = await latestJob(node.mac)
    if (job && job.id !== jobId) throw new Error(`job ${jobId} tergantikan ${job.id}`)
    const changed = !!job && seen[seen.length - 1] !== job.status
    if (job && changed) {
      seen.push(job.status)
      note(node, `${job.status}${job.failureReason ? `/${job.failureReason}` : ""} (+${Math.round((Date.now() - t0) / 1000)} dtk, installerBoots=${job.installerBoots})`)
    }
    if (node.os === "ubuntu" && job && job.status !== "booting" && (changed || Date.now() - lastSnap > 60_000)) {
      lastSnap = Date.now()
      const s = serverRun(O5_SNAPSHOT, { NODE_IP: node.ip })
      appendFileSync(o5, `## status=${job.status}\n${s.out}\n`)
    }
    if (job && (job.status === "done" || job.status === "failed")) break
    await sleep(10_000)
  }
  return { job: job!, seen, ms: Date.now() - t0 }
}

async function waitSshRelay(node: KvmNode, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const r = await relayAsync("wait-ssh", node, { WAIT_SEC: "10" }, 60_000)
    if (r.code === 0) return true
    await sleep(5_000)
  }
  return false
}

function verifyEnv(node: KvmNode): Record<string, string> {
  return {
    EXPECT_HOSTNAME: node.hostname, EXPECT_IP: node.ip, EXPECT_PREFIX: String(KVM.prefix), EXPECT_MAC: node.mac,
    EXPECT_GW: KVM.gateway, EXPECT_DNS: KVM.dns, EXPECT_USER: KVM.user, EXPECT_PUBKEY: publicKey(), EXPECT_VLAN: String(VLAN),
  }
}

type Outcome = { node: string; ok: boolean; note: string; durationS: number; evidence: string[]; verdicts: Record<string, string> }

async function runNode(node: KvmNode): Promise<Outcome> {
  const t0 = Date.now()
  const problems: string[] = []
  const verdicts: Record<string, string> = {}
  const evidence = [`${node.name}-timeline.txt`]
  const disc = await waitDiscovered(node)
  if (!disc.currentIp?.startsWith("10.99.10.")) problems.push(`discover currentIp=${disc.currentIp} (harap lease 10.99.10.x)`)
  await configure(node)
  const j = await install(node)
  const r = await follow(node, j.id, INSTALL_TIMEOUT_MS)
  const evs = await jobEvents(j.id)
  writeFileSync(
    path.join(KVM.runsDir, `${node.name}-job-events.txt`),
    evs.map((e) => `${e.seq} ${e.at} ${e.level} ${e.kind}/${e.source} ${e.message.replace(/\n/g, "\n    ")}`).join("\n") + "\n",
  )
  evidence.push(`${node.name}-job-events.txt`)
  note(node, `job akhir=${r.job.status}/${r.job.failureReason ?? "-"} dalam ${Math.round(r.ms / 1000)} dtk; urutan=${r.seen.join(">")}; stages=${r.job.stages.map((s) => `${s.stage}@${s.source}`).join(",")}`)
  const nginx = serverRun(NGINX_BY_IP, { NODE_IP: node.ip, NODE_MAC: node.mac })
  writeFileSync(path.join(KVM.runsDir, `${node.name}-nginx-by-ip.txt`), nginx.out)
  evidence.push(`${node.name}-nginx-by-ip.txt`)
  if (node.os === "ubuntu") evidence.push(`${node.name}-o5.txt`)
  const fromStatic = (nginx.out.split("path tanpa token")[1] ?? "").split("\n").filter((l) => l.trim()).length
  note(node, `nginx: ${fromStatic} request dari IP statis ${node.ip} (VLAN ${VLAN})`)
  if (r.job.status !== "done") {
    problems.push(`job ${r.job.status}/${r.job.failureReason ?? "timeout 30 mnt"} (urutan ${r.seen.join(">")})`)
    if (node.os === "ubuntu") verdicts.O5 = `FAIL: job ${r.job.status} setelah ${Math.round(r.ms / 1000)} dtk; request dari IP statis=${fromStatic}`
    return { node: node.name, ok: false, note: problems.join("; "), durationS: Math.round((Date.now() - t0) / 1000), evidence, verdicts }
  }
  if (JSON.stringify(r.seen) !== JSON.stringify(["booting", "installing", "configuring", "done"])) problems.push(`urutan status ${r.seen.join(">")}`)
  const doneAt = new Date()
  if (node.os === "ubuntu") verdicts.O5 = `PASS: Done dalam ${Math.round(r.ms / 1000)} dtk; ${fromStatic} request nginx dari IP statis ${node.ip} (installer pindah ke VLAN ${VLAN})`

  // Verifikasi lewat relay (sebelum reboot).
  const up = await waitSshRelay(node, 10 * 60_000)
  note(node, `ssh (relay) key yang di-inject: ${up ? "OK" : "TIDAK tersambung dalam 10 mnt"}`)
  if (!up) {
    problems.push("SSH relay gagal")
    return { node: node.name, ok: false, note: problems.join("; "), durationS: Math.round((Date.now() - t0) / 1000), evidence, verdicts }
  }
  const v1 = await relayAsync("verify", node, verifyEnv(node), 5 * 60_000)
  const pw = await relayAsync("pwcheck", node, {}, 60_000)
  const methods = (/Permission denied \(([a-z,-]*)\)/.exec(pw.out)?.[1] ?? "").split(",")
  const pwOk = !pw.out.includes("(exit 0)") && methods.includes("publickey") && !methods.includes("password") && !methods.includes("keyboard-interactive")
  if (v1.code !== 0) problems.push(`verify-node (relay) exit ${v1.code}`)
  if (!pwOk) problems.push("login password tidak ditolak")

  // MTU frame ber-tag VLAN 20 (server mgmt20 ↔ node, DF).
  const mtu = serverRun(MTU_SCRIPT, { NODE_IP: node.ip })
  writeFileSync(path.join(KVM.runsDir, `${node.name}-mtu.txt`), mtu.out)
  evidence.push(`${node.name}-mtu.txt`)
  const mtuOk = /# exit-1472=0/.test(mtu.out) && /3 packets transmitted, 3 received/.test(mtu.out) && !/# exit-1473=0/.test(mtu.out)
  verdicts.MTU = `${mtuOk ? "PASS" : "FAIL"}: ping DF 1472 B (frame 1518 B ber-tag) ${/3 received/.test(mtu.out) ? "3/3" : "gagal"}; 1473 ${/# exit-1473=0/.test(mtu.out) ? "LOLOS (tak terduga)" : "ditolak"}`
  if (!mtuOk) problems.push("MTU VLAN 20 (lihat mtu.txt)")

  // Reboot dari disk lewat relay.
  const jobsBefore = await jobsCount(node.mac)
  const marksBefore = (consoleLog(node).match(INSTALLER_MARK) ?? []).length
  const consoleLenBefore = consoleLog(node).length
  const rb = await relayAsync("reboot", node, {}, 60_000)
  note(node, `reboot (relay): ${rb.out.trim().split("\n").pop()}`)
  await sleep(30_000)
  const back = await waitSshRelay(node, 10 * 60_000)
  const v2 = back ? await relayAsync("verify", node, verifyEnv(node), 5 * 60_000) : { code: -1, out: "node tidak kembali" }
  const cons = consoleLog(node)
  const marksAfter = (cons.match(INSTALLER_MARK) ?? []).length
  const localBoot = /boot dari disk lokal|Tidak ada instalasi aktif/.test(cons.slice(consoleLenBefore))
  const h = await hostJson(node.mac)
  const jobsAfter = await jobsCount(node.mac)
  const rbLine = `reboot: kembali=${back} verify2=${v2.code} status=${h.status} currentIp=${h.currentIp} job ${jobsBefore}->${jobsAfter} penanda-installer-serial ${marksBefore}->${marksAfter} iPXE-boot-lokal=${localBoot}`
  note(node, rbLine)
  if (!back || v2.code !== 0 || h.status !== "done" || jobsAfter !== jobsBefore || marksAfter !== marksBefore) problems.push(rbLine)

  // O6: DHCP dari MAC sesudah Done (hanya boot PXE ulang yang boleh), dicatat dengan waktu Done.
  const dhcp = serverRun(DHCP_LOG, { NODE_MAC: node.mac })
  writeFileSync(path.join(KVM.runsDir, `${node.name}-dhcp-after.txt`), `# Done (API) pada ${doneAt.toISOString()}; reboot verifikasi setelahnya\n${dhcp.out}`)
  evidence.push(`${node.name}-dhcp-after.txt`)

  const parentNoIp = (o: string) => /^OK +parent \S+ tanpa IPv4/m.test(o) && /^OK +tidak ada IPv4 di interface lain/m.test(o)
  const childUp = (o: string) => /^OK +anak VLAN 802\.1Q id \d+ di \S+ ditemukan/m.test(o) && /^OK +ip -4 addr \S+ memuat /m.test(o)
  if (node.os === "rocky") verdicts.O6 = `${parentNoIp(v1.out) && parentNoIp(v2.out) ? "PASS" : "FAIL"}: parent native tanpa IPv4 sebelum reboot=${parentNoIp(v1.out)} sesudah=${parentNoIp(v2.out)}`
  if (node.os === "debian") verdicts.O10 = `${childUp(v1.out) && childUp(v2.out) ? "PASS" : "FAIL"}: anak VLAN ifupdown naik sebelum reboot=${childUp(v1.out)} sesudah=${childUp(v2.out)} (tanpa paket vlan tambahan)`
  verdicts.parentNoIPv4 = `${parentNoIp(v1.out) && parentNoIp(v2.out)}`

  const file = `${node.name}-relay-verify.txt`
  writeFileSync(
    path.join(KVM.runsDir, file),
    [
      `# ${node.name} (${node.os}, ${node.fw}) VLAN ${VLAN} ${node.ip}/${KVM.prefix}: ${r.seen.join(" → ")} dalam ${Math.round(r.ms / 1000)} dtk`,
      "# verify-node.sh lewat relay (sebelum reboot)", v1.out.trim(), `# exit=${v1.code}`,
      "# pwcheck (relay)", pw.out.trim(), `# password ditolak=${pwOk}`,
      "# verify-node.sh lewat relay (sesudah reboot)", v2.out.trim(), `# exit=${v2.code}`,
      `# ${rbLine}`,
      `# verdicts: ${JSON.stringify(verdicts)}`,
      `# masalah: ${problems.join("; ") || "tidak ada"}`,
    ].join("\n") + "\n",
  )
  evidence.push(file)
  return { node: node.name, ok: problems.length === 0, note: problems.join("; ") || `Done ${Math.round(r.ms / 1000)}s; verify ${v1.code}/${v2.code}; ${Object.entries(verdicts).map(([k, v]) => `${k}=${v.split(":")[0]}`).join(" ")}`, durationS: Math.round((Date.now() - t0) / 1000), evidence, verdicts }
}

if (SMOKE) {
  if (TOPOLOGY !== "vlan") throw new Error("m7-vlansmoke: PXE_KVM_TOPOLOGY harus vlan")
  const NODES = kvmNodes()

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext({ baseURL: BASE })
    const [user, pw] = adminCredentials()
    const r = await api.post("/api/auth/login", { data: { username: user, password: pw }, headers: ORIGIN })
    expect(r.status(), "login admin").toBe(204)
  })

  test.afterAll(async () => {
    await api?.dispose()
    const [, adminPw] = adminCredentials()
    const findings = scanEvidence([PASSWORD, adminPw])
    writeFileSync(
      path.join(KVM.runsDir, "evidence-scan.txt"),
      findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password node/admin, token /boot/, private key (teks & base64)\n",
    )
    record({ ac: "smoke-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan (scan harness)`, evidence: ["evidence-scan.txt"] })
    writeResults({ smoke: "vlansmoke", vlan: VLAN, nodes: NODES.map((n) => ({ name: n.name, fw: n.fw, os: n.os, ip: n.ip, hostname: n.hostname })) })
  })

  test("T10 settings server VLAN: cidr PXE 10.99.10.0/24 + vlanNetworks VLAN 20", async () => {
    const r = await api.get("/api/settings")
    expect(r.status()).toBe(200)
    const s = (await r.json()) as { cidr?: string; vlanNetworks?: { vlan: number; cidr: string; prefix: number; gateway: string }[] }
    const ok = s.cidr === "10.99.10.0/24" && !!s.vlanNetworks?.some((v) => v.vlan === VLAN && v.cidr === "10.99.20.0/24" && v.gateway === KVM.gateway)
    writeFileSync(path.join(KVM.runsDir, "smoke-settings.txt"), `cidr=${s.cidr}\nvlanNetworks=${JSON.stringify(s.vlanNetworks)}\n`)
    record({ ac: "smoke-settings", status: ok ? "PASS" : "FAIL", note: `cidr=${s.cidr} vlanNetworks=${JSON.stringify(s.vlanNetworks)}`, evidence: ["smoke-settings.txt"] })
    expect(ok).toBe(true)
  })

  test("T10 smoke VLAN: node port1 (VLAN 10 native) → IP statis VLAN 20 → Done + relay verify + MTU + reboot dari disk", async () => {
    test.setTimeout(110 * 60_000)
    const settled = await Promise.allSettled(NODES.map((n) => runNode(n)))
    const outcomes: Outcome[] = settled.map((s, i) =>
      s.status === "fulfilled"
        ? s.value
        : { node: NODES[i].name, ok: false, note: `exception: ${String((s.reason as Error)?.message ?? s.reason).slice(0, 400)}`, durationS: -1, evidence: [`${NODES[i].name}-timeline.txt`], verdicts: {} },
    )
    for (const [i, o] of outcomes.entries()) {
      const n = NODES[i]
      record({ ac: `smoke-vlan-${n.os}`, node: o.node, status: o.ok ? "PASS" : "FAIL", durationS: o.durationS, note: o.note, evidence: o.evidence })
      for (const [k, v] of Object.entries(o.verdicts)) {
        if (k === "parentNoIPv4") continue
        record({ ac: `smoke-${k}`, node: o.node, status: v.startsWith("PASS") ? "PASS" : "FAIL", note: v, evidence: o.evidence })
      }
    }
    expect(outcomes.filter((o) => !o.ok).map((o) => `${o.node}: ${o.note}`)).toEqual([])
  })
}
