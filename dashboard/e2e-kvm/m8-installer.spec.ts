// Suite KVM M8 (DEC-029 §4) — DIJALANKAN HANYA lewat `infra/test/m8-kvm/run.sh node` yang menyiapkan
// VM pxe-test-install (dashboard dipasang install.sh, BUKAN deploy-dashboard.sh lab) + node
// pxe-test-m8-node51 (UEFI, MAC 52:54:00:99:00:51) di network pxe-test.
//  - M8-KVM-login: tanpa sesi /api/settings 401; login admin (password dari file 0600 yang sama yang
//    diberikan ke `install.sh --admin-password-file`) 204 + cookie; settings memuat subnet install.sh.
//  - M8-KVM-node: host muncul (vendor QEMU/KVM, firmware uefi) → konfigurasi lewat API (Ubuntu 24.04,
//    IP statis 10.99.0.61/24 gw 10.99.0.1 DNS 10.99.0.2, user + password acak per sesi, key ed25519
//    sekali pakai, sudo, password SSH dinonaktifkan) → install → node.sh reset → booting →
//    installing → configuring → done ≤ 30 menit.
//  - M8-KVM-ssh: verify-node.sh lewat SSH dengan key yang di-inject; login password ditolak; reboot →
//    kembali dari disk (cmdline bukan installer), status tetap done, jumlah job tetap.
// Password node (sesi) & admin hanya di memori; scanEvidence di afterAll memastikan tidak tertulis.
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type APIRequestContext } from "@playwright/test"

import {
  adminCredentials,
  KVM,
  kvmNodes,
  passwordLoginRejected,
  publicKey,
  record,
  resetNode,
  scanEvidence,
  sessionPassword,
  ssh,
  TOPOLOGY,
  writeResults,
  type KvmNode,
} from "./kvm-harness"

// Hanya topologi flat (iterasi 2: m8-vlan.spec.ts untuk PXE_KVM_TOPOLOGY=vlan; test didaftarkan bersyarat,
// bukan di-skip).
if (TOPOLOGY !== "vlan") {
test.describe.configure({ mode: "serial" })

const BASE = process.env.PXE_KVM_BASE_URL ?? "http://10.99.0.2"
const ORIGIN = { Origin: BASE }
const PASSWORD = sessionPassword()
const INSTALL_TIMEOUT_MS = 30 * 60_000
const NODES = kvmNodes()
const hostId = (mac: string) => mac.replaceAll(":", "")
const shot = (name: string) => path.join(KVM.runsDir, "screenshots", `${name}.png`)

type Job = { id: string; status: string; failureReason: string | null; installerBoots: number; stages: { stage: string; at: string; source: string }[] }

let api: APIRequestContext

function note(node: KvmNode, msg: string) {
  const f = path.join(KVM.runsDir, `${node.name}-timeline.txt`)
  writeFileSync(f, `${new Date().toISOString()} ${msg}\n`, { flag: "a" })
}

async function jobs(mac: string): Promise<Job[]> {
  const r = await api.get(`/api/jobs?hostId=${hostId(mac)}&limit=200`)
  expect(r.status(), "GET /api/jobs").toBe(200)
  return ((await r.json()) as { jobs: Job[] }).jobs
}

async function waitSsh(ip: string, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (ssh(ip, "true").code === 0) return true
    await new Promise((r) => setTimeout(r, 10_000))
  }
  return false
}

test.beforeAll(async ({ playwright }) => {
  expect(NODES).toHaveLength(1)
  api = await playwright.request.newContext({ baseURL: BASE })
})

test.afterAll(async () => {
  await api?.dispose()
  const [, adminPw] = adminCredentials()
  const findings = scanEvidence([PASSWORD, adminPw])
  writeFileSync(
    path.join(KVM.runsDir, "evidence-scan-playwright.txt"),
    findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password node/admin, token /boot/, private key (teks & base64)\n",
  )
  record({ ac: "M8-KVM-scan-playwright", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan`, evidence: ["evidence-scan-playwright.txt"] })
  writeResults({ nodes: NODES.map((n) => ({ name: n.name, fw: n.fw, os: n.os, ip: n.ip, hostname: n.hostname })) })
})

test("M8-KVM-login: dashboard hasil install.sh — tanpa sesi 401, login admin 204, settings sesuai install.sh", async ({ page }) => {
  const no = await api.get("/api/settings")
  const [user, pw] = adminCredentials()
  const r = await api.post("/api/auth/login", { data: { username: user, password: pw }, headers: ORIGIN })
  const state = await api.storageState()
  const sess = state.cookies.find((c) => c.name === "pxe_session")
  const s = await api.get("/api/settings")
  const settings = s.status() === 200 ? ((await s.json()) as Record<string, unknown>) : {}
  const flat = JSON.stringify(settings)
  writeFileSync(
    path.join(KVM.runsDir, "m8-login.txt"),
    [
      `GET /api/settings tanpa sesi: ${no.status()}`,
      `POST /api/auth/login (${user}, password dari file 0600 install.sh): ${r.status()}`,
      `cookie pxe_session di jar: ${!!sess} (nilai tidak dicatat)`,
      `GET /api/settings dengan sesi: ${s.status()}`,
      `settings memuat 10.99.0.0/24: ${flat.includes("10.99.0.0/24")}; gateway 10.99.0.1: ${flat.includes("10.99.0.1")}; DNS 10.99.0.2: ${flat.includes("10.99.0.2")}`,
    ].join("\n") + "\n",
  )
  // UI: sesi admin yang sama → halaman /hosts (screenshot, tanpa password di layar).
  if (sess) {
    await page.context().addCookies(state.cookies)
    await page.goto("/hosts")
    await expect(page.locator("main")).toBeVisible()
    await page.screenshot({ path: shot("m8-hosts-after-install") })
  }
  const ok = no.status() === 401 && r.status() === 204 && !!sess && s.status() === 200 && flat.includes("10.99.0.0/24")
  record({ ac: "M8-KVM-login", status: ok ? "PASS" : "FAIL", note: `401/${r.status()}/${s.status()}`, evidence: ["m8-login.txt"] })
  expect(no.status()).toBe(401)
  expect(r.status()).toBe(204)
  expect(sess).toBeTruthy()
  expect(s.status()).toBe(200)
  expect(flat).toContain("10.99.0.0/24")
})

for (const node of NODES) {
  test(`M8-KVM-node ${node.name}: PXE boot → muncul di dashboard → install Ubuntu 24.04 → Done ≤ 30 menit`, async () => {
    test.setTimeout(55 * 60_000)
    const t0 = Date.now()
    const id = hostId(node.mac)
    // 1. discovery
    await expect
      .poll(async () => {
        const r = await api.get(`/api/hosts/${id}`)
        if (r.status() !== 200) return `HTTP ${r.status()}`
        const h = (await r.json()) as { vendor: string; firmware: string }
        return `${h.vendor}/${h.firmware}`
      }, { timeout: 10 * 60_000, intervals: [2_000, 5_000, 10_000] })
      .toBe(`QEMU/KVM/${node.fw}`)
    note(node, `discovered vendor=QEMU/KVM firmware=${node.fw} (+${Math.round((Date.now() - t0) / 1000)} dtk)`)

    // 2. konfigurasi (API, sama dengan Sheet)
    const body = {
      os: { osImageId: "ubuntu-24.04", disk: "", partition: "auto", timezone: "UTC", locale: "en_US.UTF-8" },
      credentials: { mode: "same", username: KVM.user, password: PASSWORD, sudo: true, disableSshPassword: true },
      network: { mode: "static", assignments: { [id]: node.ip }, prefix: KVM.prefix, gateway: KVM.gateway, dns: [KVM.dns], vlan: null, iface: { by: "mac" } },
      hostname: { assignments: { [id]: node.hostname } },
      ssh: { keyIds: [], newKeys: [{ name: `${KVM.run}-${node.nn}`, publicKey: publicKey(), saveToLibrary: false }], user: "" },
    }
    const p = await api.patch(`/api/hosts/${id}`, { data: body, headers: ORIGIN })
    expect(p.status(), `PATCH /api/hosts/${id}: ${await p.text()}`).toBe(200)
    note(node, `konfigurasi tersimpan os=ubuntu-24.04 ip=${node.ip}/${KVM.prefix} gw=${KVM.gateway} dns=${KVM.dns} hostname=${node.hostname} user=${KVM.user}`)

    // 3. install + reset
    const ins = await api.post(`/api/hosts/${id}/install`, { headers: ORIGIN })
    expect(ins.status(), `POST install: ${await ins.text()}`).toBe(200)
    const job0 = (await jobs(node.mac))[0]
    expect(job0?.status).toBe("booting")
    note(node, `install job=${job0.id} status=booting`)
    resetNode(node)
    note(node, "node.sh reset")

    // 4. ikuti status
    const seen: string[] = ["booting"]
    let job: Job = job0
    const deadline = Date.now() + INSTALL_TIMEOUT_MS
    while (Date.now() < deadline) {
      job = (await jobs(node.mac))[0]
      expect(job.id, "job tergantikan").toBe(job0.id)
      if (seen[seen.length - 1] !== job.status) {
        seen.push(job.status)
        note(node, `status ${job.status}${job.failureReason ? `/${job.failureReason}` : ""} (+${Math.round((Date.now() - t0) / 1000)} dtk, installerBoots=${job.installerBoots})`)
      }
      if (job.status === "done" || job.status === "failed") break
      await new Promise((r) => setTimeout(r, 10_000))
    }
    const host = (await (await api.get(`/api/hosts/${id}`)).json()) as Record<string, unknown>
    note(node, `akhir status=${job.status} urutan=${seen.join(">")} stages=${job.stages.map((s) => `${s.stage}@${s.source}`).join(",")} host.status=${host.status} osInstalled=${host.osInstalled} mgmtIp=${host.mgmtIp} hostname=${host.hostname}`)
    const ordered = JSON.stringify(seen) === JSON.stringify(["booting", "installing", "configuring", "done"])
    record({
      ac: "M8-KVM-node",
      node: node.name,
      status: ordered && host.status === "done" ? "PASS" : "FAIL",
      durationS: Math.round((Date.now() - t0) / 1000),
      note: seen.join(" → "),
      evidence: [`${node.name}-timeline.txt`, `${node.name}-console.log`],
    })
    expect(job.status).toBe("done")
    expect(seen).toEqual(["booting", "installing", "configuring", "done"])
    expect(host).toMatchObject({ status: "done", osInstalled: "ubuntu-24.04", osAssigned: null, hostname: node.hostname, mgmtIp: node.ip })
  })

  test(`M8-KVM-ssh ${node.name}: SSH key yang di-inject, password ditolak, reboot dari disk`, async () => {
    test.setTimeout(30 * 60_000)
    const t0 = Date.now()
    const up = await waitSsh(node.ip, 10 * 60_000)
    expect(up, "SSH dengan key yang di-inject").toBe(true)
    const env = [
      `EXPECT_HOSTNAME=${node.hostname}`,
      `EXPECT_IP=${node.ip}`,
      `EXPECT_PREFIX=${KVM.prefix}`,
      `EXPECT_MAC=${node.mac}`,
      `EXPECT_GW=${KVM.gateway}`,
      `EXPECT_DNS=${KVM.dns}`,
      `EXPECT_USER=${KVM.user}`,
      `EXPECT_PUBKEY='${publicKey()}'`,
    ].join(" ")
    const script = readFileSync(path.join(__dirname, "verify-node.sh"), "utf8")
    const v1 = ssh(node.ip, `${env} bash -s`, script)
    const pw = passwordLoginRejected(node.ip)
    const jobsBefore = (await jobs(node.mac)).length
    const boot1 = ssh(node.ip, "cat /proc/sys/kernel/random/boot_id").out.trim()

    ssh(node.ip, "sudo -n systemctl reboot")
    await new Promise((r) => setTimeout(r, 20_000))
    const back = await waitSsh(node.ip, 10 * 60_000)
    const v2 = back ? ssh(node.ip, `${env} bash -s`, script) : { code: -1, out: "node tidak kembali" }
    const after = back ? ssh(node.ip, "cat /proc/sys/kernel/random/boot_id; cat /proc/cmdline; findmnt -no SOURCE /").out : ""
    const [boot2 = "", cmdline = "", rootSrc = ""] = after.split("\n")
    const installerCmdline = /\b(autoinstall|ds=nocloud|netboot=nfs|casper|inst\.ks=|auto=true)\b/.test(cmdline)
    const host = (await (await api.get(`/api/hosts/${hostId(node.mac)}`)).json()) as Record<string, unknown>
    const jobsAfter = (await jobs(node.mac)).length
    const bootScript = await (await api.get(`/boot/${node.mac}.ipxe?platform=efi`)).text()
    writeFileSync(
      path.join(KVM.runsDir, `${node.name}-verify-ssh.txt`),
      [
        "# verify-node.sh (SSH key yang di-inject) sebelum reboot", v1.out, `# exit=${v1.code}`,
        "# login password (PreferredAuthentications=password)", pw.out.trim(), `# ditolak=${pw.ok}`,
        `# reboot: kembali=${back} boot_id berubah=${!!boot1 && !!boot2 && boot1 !== boot2}`,
        "# verify-node.sh sesudah reboot", v2.out, `# exit=${v2.code}`,
        `# /proc/cmdline sesudah reboot: ${cmdline}`, `# root fs: ${rootSrc}`, `# cmdline installer: ${installerCmdline}`,
        `# status host sesudah reboot: ${host.status} osInstalled=${host.osInstalled} osAssigned=${host.osAssigned}`,
        `# jumlah job: sebelum reboot=${jobsBefore} sesudah=${jobsAfter}`,
        `# /boot/${node.mac}.ipxe sesudah reboot:`, bootScript,
      ].join("\n") + "\n",
    )
    const pass = v1.code === 0 && pw.ok && back && v2.code === 0 && boot1 !== boot2 && !installerCmdline && host.status === "done" && jobsAfter === jobsBefore && !/\bkernel\b/.test(bootScript)
    record({ ac: "M8-KVM-ssh", node: node.name, status: pass ? "PASS" : "FAIL", durationS: Math.round((Date.now() - t0) / 1000), evidence: [`${node.name}-verify-ssh.txt`] })
    expect(v1.code, v1.out).toBe(0)
    expect(pw.ok, pw.out).toBe(true)
    expect(back).toBe(true)
    expect(v2.code, v2.out).toBe(0)
    expect(boot2).not.toBe(boot1)
    expect(installerCmdline, cmdline).toBe(false)
    expect(host).toMatchObject({ status: "done", osInstalled: "ubuntu-24.04", osAssigned: null })
    expect(jobsAfter).toBe(jobsBefore)
    expect(bootScript).not.toMatch(/\bkernel\b/)
  })
}
}
