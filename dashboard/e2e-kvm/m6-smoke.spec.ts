// Smoke KVM dini M6 (M6-T15, docs/design/M6-plan.md §5 baris "smoke") — DIJALANKAN HANYA lewat
//   PXE_RUNS_DIR=<...>/.agent/runs/m6/smoke infra/kvm-run.sh m6 \
//     --nodes "41:uefi:os=debian 42:uefi:os=rocky 43:uefi:failpath"
// (tanpa --scenario → PXE_KVM_SCENARIO kosong; spec ini hanya mendaftarkan test untuk run tanpa
// skenario, run `core`/`distro`/`bulk` memakai spec m6-<skenario> sendiri).
//
// Lewat API dengan sesi admin (bukan UI — UI M6 belum selesai saat smoke):
//  - Login admin: POST /api/auth/login → 204 + cookie `pxe_session` (AC-6.5); tanpa sesi → 401.
//  - Node os=debian/rocky: konfigurasi (OS, credentials, IP statis, hostname, SSH key sekali pakai)
//    → install → node.sh reset → Booting → … → Done ≤ 30 mnt. Membuktikan CR-4-6 (URL dari
//    /proc/cmdline di d-i/chroot & %pre/%post, `:` dalam path MAC di `url=`/`inst.ks=`) dan O11
//    (paket cukup dari media lokal).
//  - Node failpath (Ubuntu): disk `/dev/vdz` → Failed `installer-error` ≤ 15 mnt dengan event
//    installer dari `error-commands` (SR-5-5(c)) → disk otomatis → install ulang → Done.
//  - Verifikasi SSH (verify-node.sh, login password ditolak) dijalankan kvm-run.sh setelah suite.
//  - Log installer nyata dari target (lewat SSH key yang di-inject) → installer-logs/ (bahan
//    fixture AC-6.17; disamarkan redact-evidence.sh oleh kvm-run.sh sebelum dipakai).
// Password node per sesi & password admin hanya di memori; scanEvidence memastikan tidak tertulis.
import { spawnSync } from "node:child_process"
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type APIRequestContext } from "@playwright/test"

import {
  adminCredentials,
  consoleLog,
  KVM,
  kvmNodes,
  publicKey,
  record,
  resetNode,
  scanEvidence,
  sessionPassword,
  ssh,
  writeResults,
  type KvmNode,
} from "./kvm-harness"

const SMOKE = (process.env.PXE_KVM_SCENARIO ?? "") === ""
const BASE = process.env.PXE_KVM_BASE_URL ?? "http://10.99.0.2"
const ORIGIN = { Origin: BASE }
const PASSWORD = sessionPassword()
const OS_IMAGE: Record<KvmNode["os"], string> = { ubuntu: "ubuntu-24.04", debian: "debian-12", rocky: "rocky-9" }
const INSTALL_TIMEOUT_MS = 30 * 60_000
const FAIL_TIMEOUT_MS = 15 * 60_000
const hostId = (mac: string) => mac.replaceAll(":", "")
/** Disk target untuk install (non-failpath). Default "" = otomatis; diagnostik: PXE_KVM_SMOKE_DISK=/dev/vda. */
const INSTALL_DISK = process.env.PXE_KVM_SMOKE_DISK ?? ""
if (!/^$|^\/dev\/[a-z0-9]+$/.test(INSTALL_DISK)) throw new Error(`PXE_KVM_SMOKE_DISK ${INSTALL_DISK}`)

/** Log installer di target (dibaca `sudo -n cat`) per OS → installer-logs/<node>-<nama>. */
const INSTALLER_LOGS: Record<KvmNode["os"], string[]> = {
  ubuntu: ["/var/log/installer/subiquity-server-debug.log", "/var/log/installer/curtin-install.log"],
  debian: ["/var/log/installer/syslog"],
  rocky: ["/var/log/anaconda/anaconda.log", "/var/log/anaconda/program.log"],
}

type Job = { id: string; status: string; failureReason: string | null; stages: { stage: string; at: string; source: string }[]; installerBoots: number }
type Ev = { seq: number; at: string; kind: string; level: string; source: string; message: string }

function note(node: KvmNode, msg: string) {
  appendFileSync(path.join(KVM.runsDir, `${node.name}-timeline.txt`), `${new Date().toISOString()} ${msg}\n`)
}

let api: APIRequestContext

/**
 * ssh root@10.99.0.2 dengan key infra (.agent/keys/infra_ed25519, sama dengan infra/lib.sh) — hanya
 * perintah baca (bukti NFS stage2 Rocky, DEC-020).
 */
function serverSsh(remote: string): { code: number; out: string } {
  const key = path.join(path.dirname(path.resolve(KVM.sshKey)), "infra_ed25519")
  if (!/\/\.agent\/keys\/infra_ed25519$/.test(key)) throw new Error(`key ${key}`)
  const r = spawnSync(
    "ssh",
    ["-i", key, "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "root@10.99.0.2", remote],
    { encoding: "utf8", timeout: 60_000, input: "" },
  )
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

/** Snapshot NFS server (exportfs, koneksi :2049, request install.img di nginx) → <node>-nfs.txt. */
function nfsSnapshot(node: KvmNode, label: string) {
  const r = serverSsh(
    "echo '# exportfs -v'; exportfs -v; echo '# koneksi NFS (ss -tn sport = :2049)'; ss -tnH state established '( sport = :2049 )'; " +
      "echo '# nginx GET install.img (harus 0)'; grep -c 'GET /media/rocky-9/images/install.img' /var/log/nginx/pxe-access.log; " +
      "echo '# nginx GET Minimal/Packages'; grep -c 'GET /media/rocky-9/Minimal/Packages/' /var/log/nginx/pxe-access.log; " +
      "echo '# nginx GET AppStream'; grep -c 'GET /media/rocky-9/AppStream' /var/log/nginx/pxe-access.log; true",
  )
  appendFileSync(path.join(KVM.runsDir, `${node.name}-nfs.txt`), `## ${new Date().toISOString()} ${label} (ssh exit=${r.code})\n${r.out}\n`)
}

async function latestJob(mac: string): Promise<Job | null> {
  const r = await api.get(`/api/jobs?hostId=${hostId(mac)}&limit=200`)
  expect(r.status(), "GET /api/jobs").toBe(200)
  return ((await r.json()) as { jobs: Job[] }).jobs[0] ?? null
}

async function jobsCount(mac: string): Promise<number> {
  const r = await api.get(`/api/jobs?hostId=${hostId(mac)}&limit=200`)
  return ((await r.json()) as { jobs: Job[] }).jobs.length
}

async function jobEvents(id: string): Promise<Ev[]> {
  const out: Ev[] = []
  let after = 0
  for (;;) {
    const r = await api.get(`/api/jobs/${id}/logs?format=json&after=${after}`)
    expect(r.status(), "GET /api/jobs/:id/logs").toBe(200)
    const b = (await r.json()) as { events: Ev[]; lastSeq: number }
    if (!b.events.length) break
    out.push(...b.events)
    after = b.events[b.events.length - 1].seq
    if (b.events.length < 1000) break
  }
  return out
}

function writeEvents(node: KvmNode, label: string, evs: Ev[]) {
  writeFileSync(
    path.join(KVM.runsDir, `${node.name}-${label}-events.txt`),
    evs.map((e) => `${e.seq} ${e.at} ${e.level} ${e.kind}/${e.source} ${e.message.replace(/\n/g, "\n    ")}`).join("\n") + "\n",
  )
}

async function waitDiscovered(node: KvmNode) {
  await expect
    .poll(async () => {
      const r = await api.get(`/api/hosts/${hostId(node.mac)}`)
      return r.status() === 200 ? ((await r.json()) as { firmware: string }).firmware : `HTTP ${r.status()}`
    }, { timeout: 10 * 60_000, intervals: [2_000, 5_000, 10_000] })
    .toBe(node.fw)
  note(node, `discovered firmware=${node.fw}`)
}

async function configure(node: KvmNode, disk: string) {
  const id = hostId(node.mac)
  const body = {
    os: { osImageId: OS_IMAGE[node.os], disk, partition: "auto", timezone: "UTC", locale: "en_US.UTF-8" },
    credentials: { mode: "same", username: KVM.user, password: PASSWORD, sudo: true, disableSshPassword: true },
    network: { mode: "static", assignments: { [id]: node.ip }, prefix: KVM.prefix, gateway: KVM.gateway, dns: [KVM.dns], vlan: null, iface: { by: "mac" } },
    hostname: { assignments: { [id]: node.hostname } },
    ssh: { keyIds: [], newKeys: [{ name: `${KVM.run}-${node.nn}`, publicKey: publicKey(), saveToLibrary: false }], user: "" },
  }
  const r = await api.patch(`/api/hosts/${id}`, { data: body, headers: ORIGIN })
  expect(r.status(), `PATCH /api/hosts/${id}: ${await r.text()}`).toBe(200)
  note(node, `konfigurasi tersimpan os=${OS_IMAGE[node.os]} disk=${disk || "(otomatis)"} ip=${node.ip} hostname=${node.hostname}`)
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

/** Ikuti status job (API) sampai done/failed atau batas waktu; transisi dicatat ke timeline. */
async function follow(node: KvmNode, jobId: string, label: string, timeoutMs: number): Promise<{ job: Job; seen: string[]; ms: number }> {
  const t0 = Date.now()
  const seen: string[] = []
  let job: Job | null = null
  while (Date.now() - t0 < timeoutMs) {
    job = await latestJob(node.mac)
    if (job && job.id !== jobId) throw new Error(`job ${jobId} tergantikan ${job.id}`)
    if (job && seen[seen.length - 1] !== job.status) {
      seen.push(job.status)
      note(node, `${label}: ${job.status}${job.failureReason ? `/${job.failureReason}` : ""} (+${Math.round((Date.now() - t0) / 1000)} dtk, installerBoots=${job.installerBoots})`)
      if (node.os === "rocky" && (job.status === "installing" || job.status === "configuring")) nfsSnapshot(node, `${label} ${job.status}`)
    }
    if (job && (job.status === "done" || job.status === "failed")) break
    await new Promise((r) => setTimeout(r, 10_000))
  }
  return { job: job!, seen, ms: Date.now() - t0 }
}

async function waitSsh(node: KvmNode, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (ssh(node.ip, "true").code === 0) return true
    await new Promise((r) => setTimeout(r, 10_000))
  }
  return false
}

/** Log installer nyata dari target (bahan fixture AC-6.17). */
function fetchInstallerLogs(node: KvmNode): string[] {
  const dir = path.join(KVM.runsDir, "installer-logs")
  mkdirSync(dir, { recursive: true })
  const got: string[] = []
  const ls = ssh(node.ip, "sudo -n ls -la /var/log/installer /var/log/anaconda 2>&1; true")
  writeFileSync(path.join(dir, `${node.name}-ls.txt`), ls.out)
  for (const f of INSTALLER_LOGS[node.os]) {
    const r = ssh(node.ip, `sudo -n cat ${f}`, undefined, { maxBuffer: 256 * 1024 * 1024, stdoutOnly: true })
    const out = `${node.name}-${path.basename(f)}`
    if (r.code === 0 && r.out.length > 0) {
      writeFileSync(path.join(dir, out), r.out)
      got.push(`installer-logs/${out}`)
    }
    note(node, `log installer ${f}: exit=${r.code} bytes=${r.out.length}`)
  }
  return got
}

type Outcome = { node: string; ok: boolean; note: string; durationS: number; evidence: string[] }

async function runInstallNode(node: KvmNode): Promise<Outcome> {
  const t0 = Date.now()
  const problems: string[] = []
  const evidence = [`${node.name}-timeline.txt`]
  await waitDiscovered(node)

  if (node.role === "failpath") {
    // Jalur gagal nyata (SR-5-5(c)): disk target tidak ada → error-commands subiquity.
    await configure(node, "/dev/vdz")
    const j1 = await install(node)
    const f = await follow(node, j1.id, "job1(/dev/vdz)", FAIL_TIMEOUT_MS)
    const ev1 = await jobEvents(j1.id)
    writeEvents(node, "job1", ev1)
    evidence.push(`${node.name}-job1-events.txt`)
    const errEv = ev1.filter((e) => e.kind === "installer" && /installer gagal/.test(e.message))
    note(node, `job1 akhir=${f.job.status}/${f.job.failureReason} dalam ${Math.round(f.ms / 1000)} dtk; event installer error-commands=${errEv.length}; urutan=${f.seen.join(">")}`)
    if (f.job.status !== "failed" || f.job.failureReason !== "installer-error") problems.push(`job1 ${f.job.status}/${f.job.failureReason} (harap failed/installer-error ≤ 15 mnt)`)
    if (errEv.length < 1) problems.push("job1 tanpa event installer dari error-commands")
    if (f.job.status !== "failed") {
      return { node: node.name, ok: false, note: problems.join("; "), durationS: Math.round((Date.now() - t0) / 1000), evidence }
    }
    // Install ulang dengan disk otomatis (atau PXE_KVM_SMOKE_DISK).
    await configure(node, INSTALL_DISK)
  } else {
    await configure(node, INSTALL_DISK)
  }

  const j = await install(node)
  const r = await follow(node, j.id, node.role === "failpath" ? "job2" : "job1", INSTALL_TIMEOUT_MS)
  const evs = await jobEvents(j.id)
  const label = node.role === "failpath" ? "job2" : "job1"
  writeEvents(node, label, evs)
  evidence.push(`${node.name}-${label}-events.txt`)
  note(node, `${label} akhir=${r.job.status}/${r.job.failureReason ?? "-"} dalam ${Math.round(r.ms / 1000)} dtk; urutan=${r.seen.join(">")}; stages=${r.job.stages.map((s) => `${s.stage}@${s.source}`).join(",")}`)
  if (r.job.status !== "done") problems.push(`${label} ${r.job.status}/${r.job.failureReason ?? "timeout 30 mnt"}`)
  // Event installer per tahap (CR-4-6: callback dari /proc/cmdline di d-i/chroot, %pre/%post).
  const inst = evs.filter((e) => e.kind === "installer").map((e) => e.message.split("\n")[0].slice(0, 100))
  note(node, `event installer (${inst.length}): ${inst.join(" | ")}`)
  // M6-T15 (BUG-M6-6/7): disk otomatis Debian/Rocky dipilih saat runtime → event installer.
  if (node.os !== "ubuntu" && INSTALL_DISK === "" && r.job.status === "done" && !inst.some((m) => /disk target dipilih/.test(m))) problems.push("event 'disk target dipilih' tidak ada")
  // BUG-M6-8: d-i netboot memuat driver disk virtio dari server sebelum partman.
  if (node.os === "debian" && r.job.status === "done" && !inst.some((m) => /modul disk virtio dimuat/.test(m))) problems.push("event 'modul disk virtio dimuat' tidak ada")
  if (r.job.status === "done") {
    const up = await waitSsh(node, 10 * 60_000)
    note(node, `ssh key yang di-inject: ${up ? "OK" : "TIDAK tersambung dalam 10 mnt"}`)
    if (!up) problems.push("SSH key gagal")
    else {
      evidence.push(...fetchInstallerLogs(node))
      const f = ssh(node.ip, "echo \"# hostname: $(hostname)\"; echo '# locale'; localectl status 2>&1; cat /etc/default/locale /etc/locale.conf 2>/dev/null; echo '# timezone'; timedatectl show -p Timezone 2>&1; echo '# id'; id; echo '# sudo -n true'; sudo -n true && echo sudo-ok; echo '# os-release'; head -n 3 /etc/os-release; echo '# lsblk'; lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT 2>&1")
      writeFileSync(path.join(KVM.runsDir, `${node.name}-facts.txt`), f.out)
      evidence.push(`${node.name}-facts.txt`)
      if (!new RegExp(`# hostname: ${node.hostname}\\b`).test(f.out)) problems.push("hostname target tidak sesuai config")
      // Reboot → boot dari disk tanpa reinstall: SSH kembali, hostname sama, status host done, jumlah job tetap.
      const jobsBefore = await jobsCount(node.mac)
      ssh(node.ip, "sudo -n systemctl reboot")
      await new Promise((res) => setTimeout(res, 20_000))
      const back = await waitSsh(node, 10 * 60_000)
      const hn = back ? ssh(node.ip, "hostname; cat /proc/cmdline").out : ""
      const h = (await (await api.get(`/api/hosts/${hostId(node.mac)}`)).json()) as { status: string }
      const jobsAfter = await jobsCount(node.mac)
      const rb = `reboot: kembali=${back} hostname=${hn.split("\n")[0]} status=${h.status} job ${jobsBefore}->${jobsAfter} installerCmdline=${/\b(auto=true|inst\.ks=|autoinstall)\b/.test(hn)}`
      note(node, rb)
      if (!back || !hn.startsWith(node.hostname) || h.status !== "done" || jobsAfter !== jobsBefore || /\b(auto=true|inst\.ks=|autoinstall)\b/.test(hn)) problems.push(rb)
    }
  }
  const consoleTail = consoleLog(node).slice(-200_000)
  note(node, `console log: ${consoleTail.length} byte terakhir dibaca; kernel panic=${/Kernel panic/.test(consoleTail)}`)
  if (node.os === "rocky") {
    nfsSnapshot(node, "akhir")
    evidence.push(`${node.name}-nfs.txt`)
  }
  note(node, `jumlah job host=${await jobsCount(node.mac)}`)
  return { node: node.name, ok: problems.length === 0, note: problems.join("; ") || "Done + SSH key", durationS: Math.round((Date.now() - t0) / 1000), evidence }
}

if (SMOKE) {
  const NODES = kvmNodes()

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext({ baseURL: BASE })
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
    writeResults({ smoke: true, nodes: NODES.map((n) => ({ name: n.name, fw: n.fw, os: n.os, role: n.role, hostname: n.hostname })) })
  })

  test("T15 login admin API: tanpa sesi 401, login 204 + cookie pxe_session, sesi → 200", async () => {
    const no = await api.get("/api/settings")
    const [user, pw] = adminCredentials()
    const bad = await api.post("/api/auth/login", { data: { username: user, password: `${pw}-salah` }, headers: ORIGIN })
    const r = await api.post("/api/auth/login", { data: { username: user, password: pw }, headers: ORIGIN })
    const setCookie = r.headers()["set-cookie"] ?? ""
    const cookies = await api.storageState()
    const sess = cookies.cookies.find((c) => c.name === "pxe_session")
    const yes = await api.get("/api/settings")
    const ok = no.status() === 401 && bad.status() === 401 && r.status() === 204 && /pxe_session=/.test(setCookie) && /HttpOnly/i.test(setCookie) && !!sess && yes.status() === 200
    writeFileSync(
      path.join(KVM.runsDir, "smoke-login.txt"),
      [
        `GET /api/settings tanpa sesi: ${no.status()}`,
        `POST /api/auth/login password salah: ${bad.status()}`,
        `POST /api/auth/login: ${r.status()}`,
        `Set-Cookie atribut: ${setCookie.split(";").slice(1).map((s) => s.trim()).join("; ")} (nilai tidak dicatat)`,
        `cookie pxe_session di jar: ${!!sess}`,
        `GET /api/settings dengan sesi: ${yes.status()}`,
      ].join("\n") + "\n",
    )
    record({ ac: "smoke-login", status: ok ? "PASS" : "FAIL", note: `401/401/${r.status()}/${yes.status()}`, evidence: ["smoke-login.txt"] })
    expect(no.status()).toBe(401)
    expect(bad.status()).toBe(401)
    expect(r.status()).toBe(204)
    expect(setCookie).toMatch(/pxe_session=/)
    expect(sess).toBeTruthy()
    expect(yes.status()).toBe(200)
  })

  test("T15 smoke: Debian 12 & Rocky 9 UEFI → Done + SSH; Ubuntu /dev/vdz → Failed installer-error → install ulang", async () => {
    test.setTimeout(100 * 60_000)
    const settled = await Promise.allSettled(NODES.map((n) => runInstallNode(n)))
    const outcomes: Outcome[] = settled.map((s, i) =>
      s.status === "fulfilled"
        ? s.value
        : { node: NODES[i].name, ok: false, note: `exception: ${String((s.reason as Error)?.message ?? s.reason).slice(0, 400)}`, durationS: -1, evidence: [`${NODES[i].name}-timeline.txt`] },
    )
    for (const [i, o] of outcomes.entries()) {
      const n = NODES[i]
      record({ ac: `smoke-${n.os}${n.role === "failpath" ? "-failpath" : ""}`, node: o.node, status: o.ok ? "PASS" : "FAIL", durationS: o.durationS, note: o.note, evidence: o.evidence })
    }
    expect(outcomes.filter((o) => !o.ok).map((o) => `${o.node}: ${o.note}`)).toEqual([])
  })
}
