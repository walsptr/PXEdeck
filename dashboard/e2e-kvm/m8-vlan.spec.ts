// Suite KVM M8 iterasi 2 — mode VLAN install.sh (DEC-030 §4). DIJALANKAN HANYA lewat
// `PXE_KVM_TOPOLOGY=vlan infra/test/m8-kvm/run.sh vlan-node` (test terdaftar hanya bila topologi vlan):
// VM pxe-test-install dipasang `install.sh --interface trunk0 --vlan-id 10 --vlan-networks 20:…`
// (switch lab M7: port1 = VLAN 10 native + VLAN 20 ber-tag), node pxe-test-m8-node52 di pxe-test-port1.
//  - M8-VLAN-login: dashboard admin di http://10.99.0.2 (--admin-listen); settings cidr 10.99.10.0/24 +
//    vlanNetworks VLAN 20 10.99.20.0/24 gw 10.99.20.1.
//  - M8-VLAN-node: host muncul dengan lease 10.99.10.x → konfigurasi IP statis 10.99.20.62/24 VLAN 20
//    (gw 10.99.20.1, DNS 10.99.10.2) → install → Done ≤ 30 menit.
//  - M8-VLAN-ssh: verifikasi lewat relay di VM install (host TIDAK PERNAH menyasar 10.99.10/20):
//    verify-node.sh EXPECT_VLAN=20, login password ditolak, reboot dari disk, verify ulang, job tetap 1.
import { writeFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type APIRequestContext } from "@playwright/test"

import {
  adminCredentials,
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

const VLAN = 20
const BASE = process.env.PXE_KVM_BASE_URL ?? "http://10.99.0.2"
const ORIGIN = { Origin: BASE }
const PASSWORD = sessionPassword()
const INSTALL_TIMEOUT_MS = 30 * 60_000
const hostId = (mac: string) => mac.replaceAll(":", "")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Job = { id: string; status: string; failureReason: string | null; installerBoots: number; stages: { stage: string; source: string }[] }

if (TOPOLOGY === "vlan") {
  test.describe.configure({ mode: "serial" })
  const NODES = kvmNodes()
  let api: APIRequestContext

  const note = (node: KvmNode, msg: string) =>
    writeFileSync(path.join(KVM.runsDir, `${node.name}-timeline.txt`), `${new Date().toISOString()} ${msg}\n`, { flag: "a" })
  const jobs = async (mac: string): Promise<Job[]> => {
    const r = await api.get(`/api/jobs?hostId=${hostId(mac)}&limit=200`)
    expect(r.status()).toBe(200)
    return ((await r.json()) as { jobs: Job[] }).jobs
  }
  const verifyEnv = (node: KvmNode) => ({
    EXPECT_HOSTNAME: node.hostname,
    EXPECT_IP: node.ip,
    EXPECT_PREFIX: String(KVM.prefix),
    EXPECT_MAC: node.mac,
    EXPECT_GW: KVM.gateway,
    EXPECT_DNS: KVM.dns,
    EXPECT_USER: KVM.user,
    EXPECT_PUBKEY: publicKey(),
    EXPECT_VLAN: String(VLAN),
  })

  test.beforeAll(async ({ playwright }) => {
    expect(NODES).toHaveLength(1)
    api = await playwright.request.newContext({ baseURL: BASE })
  })

  test.afterAll(async () => {
    await api?.dispose()
    const [, adminPw] = adminCredentials()
    const findings = scanEvidence([PASSWORD, adminPw])
    writeFileSync(path.join(KVM.runsDir, "evidence-scan-playwright-vlan.txt"), findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password node/admin, token /boot/, private key (teks & base64)\n")
    record({ ac: "M8-VLAN-scan-playwright", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan`, evidence: ["evidence-scan-playwright-vlan.txt"] })
    writeResults({ topology: "vlan", vlan: VLAN, nodes: NODES.map((n) => ({ name: n.name, fw: n.fw, ip: n.ip, hostname: n.hostname })) })
  })

  test("M8-VLAN-login: dashboard install.sh mode VLAN — 401 tanpa sesi, login 204, settings VLAN", async () => {
    const no = await api.get("/api/settings")
    const [user, pw] = adminCredentials()
    const r = await api.post("/api/auth/login", { data: { username: user, password: pw }, headers: ORIGIN })
    const s = await api.get("/api/settings")
    const j = (s.status() === 200 ? await s.json() : {}) as { cidr?: string; vlanNetworks?: { vlan: number; cidr: string; gateway: string }[] }
    const ok = no.status() === 401 && r.status() === 204 && s.status() === 200 && j.cidr === "10.99.10.0/24" && !!j.vlanNetworks?.some((v) => v.vlan === VLAN && v.cidr === "10.99.20.0/24" && v.gateway === "10.99.20.1")
    writeFileSync(path.join(KVM.runsDir, "m8-vlan-login.txt"), `GET /api/settings tanpa sesi: ${no.status()}\nPOST /api/auth/login: ${r.status()}\nGET /api/settings: ${s.status()} cidr=${j.cidr} vlanNetworks=${JSON.stringify(j.vlanNetworks)}\n`)
    record({ ac: "M8-VLAN-login", status: ok ? "PASS" : "FAIL", note: `cidr=${j.cidr}`, evidence: ["m8-vlan-login.txt"] })
    expect(ok).toBe(true)
  })

  for (const node of NODES) {
    test(`M8-VLAN-node ${node.name}: PXE VLAN 10 → IP statis VLAN ${VLAN} → Done ≤ 30 menit`, async () => {
      test.setTimeout(55 * 60_000)
      const t0 = Date.now()
      const id = hostId(node.mac)
      let currentIp = ""
      await expect
        .poll(async () => {
          const r = await api.get(`/api/hosts/${id}`)
          if (r.status() !== 200) return `HTTP ${r.status()}`
          const h = (await r.json()) as { firmware: string; currentIp: string | null }
          currentIp = h.currentIp ?? ""
          return h.firmware
        }, { timeout: 10 * 60_000, intervals: [2_000, 5_000, 10_000] })
        .toBe(node.fw)
      note(node, `discovered firmware=${node.fw} currentIp=${currentIp}`)
      const body = {
        os: { osImageId: "ubuntu-24.04", disk: "", partition: "auto", timezone: "UTC", locale: "en_US.UTF-8" },
        credentials: { mode: "same", username: KVM.user, password: PASSWORD, sudo: true, disableSshPassword: true },
        network: { mode: "static", assignments: { [id]: node.ip }, prefix: KVM.prefix, gateway: KVM.gateway, dns: [KVM.dns], vlan: VLAN, iface: { by: "mac" } },
        hostname: { assignments: { [id]: node.hostname } },
        ssh: { keyIds: [], newKeys: [{ name: `${KVM.run}-${node.nn}`, publicKey: publicKey(), saveToLibrary: false }], user: "" },
      }
      const p = await api.patch(`/api/hosts/${id}`, { data: body, headers: ORIGIN })
      expect(p.status(), await p.text()).toBe(200)
      note(node, `konfigurasi ip=${node.ip}/${KVM.prefix} vlan=${VLAN} gw=${KVM.gateway} dns=${KVM.dns}`)
      const ins = await api.post(`/api/hosts/${id}/install`, { headers: ORIGIN })
      expect(ins.status(), await ins.text()).toBe(200)
      const job0 = (await jobs(node.mac))[0]
      expect(job0.status).toBe("booting")
      resetNode(node)
      note(node, `install job=${job0.id}; node.sh reset`)
      const seen = ["booting"]
      let job = job0
      while (Date.now() - t0 < INSTALL_TIMEOUT_MS) {
        job = (await jobs(node.mac))[0]
        expect(job.id).toBe(job0.id)
        if (seen[seen.length - 1] !== job.status) {
          seen.push(job.status)
          note(node, `status ${job.status}${job.failureReason ? `/${job.failureReason}` : ""} (+${Math.round((Date.now() - t0) / 1000)} dtk)`)
        }
        if (job.status === "done" || job.status === "failed") break
        await sleep(10_000)
      }
      const host = (await (await api.get(`/api/hosts/${id}`)).json()) as Record<string, unknown>
      note(node, `akhir ${seen.join(">")} host.status=${host.status} mgmtIp=${host.mgmtIp}`)
      const ok = currentIp.startsWith("10.99.10.") && JSON.stringify(seen) === JSON.stringify(["booting", "installing", "configuring", "done"]) && host.status === "done" && host.mgmtIp === node.ip
      record({ ac: "M8-VLAN-node", node: node.name, status: ok ? "PASS" : "FAIL", durationS: Math.round((Date.now() - t0) / 1000), note: `lease ${currentIp}; ${seen.join(" → ")}`, evidence: [`${node.name}-timeline.txt`, `${node.name}-console.log`] })
      expect(currentIp).toMatch(/^10\.99\.10\./)
      expect(seen).toEqual(["booting", "installing", "configuring", "done"])
      expect(host).toMatchObject({ status: "done", osInstalled: "ubuntu-24.04", mgmtIp: node.ip })
    })

    test(`M8-VLAN-ssh ${node.name}: relay — verify EXPECT_VLAN=${VLAN}, password ditolak, reboot dari disk`, async () => {
      test.setTimeout(30 * 60_000)
      const t0 = Date.now()
      const w1 = await relayAsync("wait-ssh", node, { WAIT_SEC: "600" }, 11 * 60_000)
      const v1 = await relayAsync("verify", node, verifyEnv(node), 5 * 60_000)
      const pw = await relayAsync("pwcheck", node, {}, 60_000)
      const methods = (/Permission denied \(([a-z,-]*)\)/.exec(pw.out)?.[1] ?? "").split(",")
      const pwOk = !pw.out.includes("(exit 0)") && methods.includes("publickey") && !methods.includes("password") && !methods.includes("keyboard-interactive")
      const jobsBefore = (await jobs(node.mac)).length
      const rb = await relayAsync("reboot", node, {}, 60_000)
      await sleep(30_000)
      const w2 = await relayAsync("wait-ssh", node, { WAIT_SEC: "600" }, 11 * 60_000)
      const v2 = w2.code === 0 ? await relayAsync("verify", node, verifyEnv(node), 5 * 60_000) : { code: -1, out: "node tidak kembali" }
      const host = (await (await api.get(`/api/hosts/${hostId(node.mac)}`)).json()) as Record<string, unknown>
      const jobsAfter = (await jobs(node.mac)).length
      writeFileSync(
        path.join(KVM.runsDir, `${node.name}-relay-verify.txt`),
        [
          `# relay wait-ssh: ${w1.out.trim()}`, "# verify-node.sh (relay, EXPECT_VLAN=20) sebelum reboot", v1.out.trim(), `# exit=${v1.code}`,
          "# pwcheck", pw.out.trim(), `# password ditolak=${pwOk}`, `# reboot: ${rb.out.trim()}`, `# wait-ssh sesudah reboot: ${w2.out.trim()}`,
          "# verify-node.sh sesudah reboot", v2.out.trim(), `# exit=${v2.code}`,
          `# status host: ${host.status} osInstalled=${host.osInstalled}; jumlah job ${jobsBefore} -> ${jobsAfter}`,
        ].join("\n") + "\n",
      )
      const ok = w1.code === 0 && v1.code === 0 && pwOk && w2.code === 0 && v2.code === 0 && host.status === "done" && jobsAfter === jobsBefore
      record({ ac: "M8-VLAN-ssh", node: node.name, status: ok ? "PASS" : "FAIL", durationS: Math.round((Date.now() - t0) / 1000), evidence: [`${node.name}-relay-verify.txt`] })
      expect(v1.code, v1.out).toBe(0)
      expect(pwOk, pw.out).toBe(true)
      expect(v2.code, v2.out).toBe(0)
      expect(host).toMatchObject({ status: "done" })
      expect(jobsAfter).toBe(jobsBefore)
    })
  }
}
