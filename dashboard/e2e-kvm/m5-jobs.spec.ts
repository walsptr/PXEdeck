// Suite KVM M5 (M5-T15) — DIJALANKAN HANYA lewat `infra/kvm-run.sh m5 --nodes "11:uefi:destroy 12:bios"`
// (PXE_KVM_SPEC=m5, lihat playwright.config.ts). Cakupan (docs/design/M5-plan.md §4, DEC-014 §6):
//  - AC-5.39 (gate, node berperan destroy): konfigurasi via dashboard → Simpan & Install →
//    node.sh reset → Installing (UI) + event installer "autoinstall mulai" di log job (UI) →
//    node.sh poweroff (virsh destroy) → node.sh start → /boot/<mac>.ipxe melayani boot lokal
//    (request nginx baru, event warn, installerBoots tetap 1, kernel installer di serial tetap) →
//    tetap Installing ≥ timeout → Failed `timeout-installing` di UI tanpa reload ≤ timeout + 2 mnt;
//    timeline job menampilkan pill Failed + alasan.
//  - AC-5.40 (gate): Install OS ulang dari UI → reset → Booting → Installing → Configuring → Done
//    ≤ 30 mnt; verify-node.sh lewat SSH dengan key yang di-inject; login password ditolak;
//    GET /api/jobs?hostId= = 2 job (done, failed timeout-installing); reboot → dari disk (tanpa
//    kernel installer baru), status tetap Done, jumlah job tetap 2 (CR-4-11).
//  - AC-5.41 (node lain, BIOS): jalur positif sambil halaman Jobs terbuka: event baru tiba lewat
//    SSE tanpa reload (penanda early / late-commands / first-boot berurutan, indikator Live),
//    timeline akhir 4 pill dengan waktu, SSH key login + hostname, reboot → jumlah job tetap 1.
//  - AC-5.42: selama job aktif, POST /boot/<mac>/<token-acak>/log dan /status dari host → 404,
//    jumlah event tidak berubah; GET /boot/<mac>.ipxe dari host → lokal tanpa token.
//  - AC-5.38: server-check (ss -lunp / layanan / Next 127.0.0.1:3000 / nginx -t) + allowlist nginx:
//    host → /api/settings 200; dari node terpasang (SSH) /api/hosts 403, /boot/<mac>.ipxe 200 lokal.
// Bukti: PXE_KVM_RUNS_DIR (results.json, <node>-*.txt, screenshots/). Password acak per sesi hanya
// di env proses; scanEvidence memastikan tidak tertulis. Cleanup oleh kvm-run.sh (trap EXIT).
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type Locator, type Page } from "@playwright/test"

import {
  consoleLog,
  installerBoots,
  isDestroyNode,
  KVM,
  kvmNodes,
  passwordLoginRejected,
  powerNode,
  publicKey,
  record,
  resetNode,
  scanEvidence,
  sessionPassword,
  ssh,
  writeResults,
  type KvmNode,
} from "./kvm-harness"

const INSTALL_TIMEOUT_MS = 30 * 60_000
const PASSWORD = sessionPassword()
const NODES = kvmNodes()
const SERVER_IP = "10.99.0.2"
const shot = (name: string) => path.join(KVM.runsDir, "screenshots", `${name}.png`)
const hostId = (mac: string) => mac.replaceAll(":", "")
const TOKEN_RE = /\/boot\/[0-9a-f:]{17}\/[A-Za-z0-9_-]{43}\//
const NO_RELOAD = () => ((window as unknown as { __noReload: boolean }).__noReload = true)
const STILL_NO_RELOAD = () => (window as unknown as { __noReload?: boolean }).__noReload === true

type Stage = { stage: string; at: string; source: string }
type Job = {
  id: string
  hostId: string
  status: string
  stages: Stage[]
  failureReason: string | null
  installerBoots: number
  createdAt: string
  finishedAt: string | null
  eventCount: number
}
type Ev = { seq: number; at: string; kind: string; level: string; source: string; message: string; repeat: number }

const stageAt = (j: Job, s: string) => j.stages.find((x) => x.stage === s)?.at ?? null

/** Catatan berwaktu per node (tanpa secret) → <node>-timeline.txt. */
function note(node: KvmNode, msg: string) {
  appendFileSync(path.join(KVM.runsDir, `${node.name}-timeline.txt`), `${new Date().toISOString()} ${msg}\n`)
}

async function jobsOf(page: Page, mac: string): Promise<{ jobs: Job[]; skewMs: number }> {
  const t = Date.now()
  const r = await page.request.get(`/api/jobs?hostId=${hostId(mac)}&limit=200`)
  expect(r.status()).toBe(200)
  const body = (await r.json()) as { jobs: Job[]; serverTime: string }
  const local = (t + Date.now()) / 2
  return { jobs: body.jobs, skewMs: Date.parse(body.serverTime) - local }
}

async function jobLog(page: Page, id: string): Promise<Ev[]> {
  const r = await page.request.get(`/api/jobs/${id}/logs?format=json&after=0`)
  expect(r.status()).toBe(200)
  return ((await r.json()) as { events: Ev[] }).events
}

async function apiHost(page: Page, mac: string) {
  const r = await page.request.get(`/api/hosts/${hostId(mac)}`)
  return r.status() === 200 ? r.json() : null
}

/**
 * ssh root@10.99.0.2 dengan key infra (.agent/keys/infra_ed25519, sama dengan infra/lib.sh) untuk
 * membaca log nginx server (bukti request /boot setelah `virsh start`). Hanya perintah baca.
 */
function serverSsh(remote: string): { code: number; out: string } {
  const key = path.join(path.dirname(path.resolve(KVM.sshKey)), "infra_ed25519")
  if (!/\/\.agent\/keys\/infra_ed25519$/.test(key)) throw new Error(`key ${key}`)
  const r = spawnSync(
    "ssh",
    ["-i", key, "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", `root@${SERVER_IP}`, remote],
    { encoding: "utf8", timeout: 60_000, input: "" },
  )
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

/** Jumlah request nginx `GET /boot/<mac>.ipxe` di log akses server. */
function nginxIpxeRequests(mac: string): number {
  const r = serverSsh(`grep -cF 'GET /boot/${mac}.ipxe' /var/log/nginx/pxe-access.log || true`)
  const n = Number(r.out.trim().split(/\s+/).pop())
  return Number.isFinite(n) ? n : -1
}

function hostRow(page: Page, mac: string): Locator {
  return page.locator("main table").first().locator("tbody tr").filter({ has: page.getByText(mac, { exact: true }) })
}

/** Discovery (host muncul + firmware) lalu konfigurasi lengkap via Sheet → Simpan & Install. */
async function discoverConfigureInstall(page: Page, node: KvmNode, hostname: string) {
  await page.goto("/hosts")
  await page.evaluate(NO_RELOAD)
  const row = hostRow(page, node.mac)
  await expect(row).toHaveCount(1, { timeout: 10 * 60_000 })
  await expect
    .poll(async () => {
      const h = await apiHost(page, node.mac)
      return h && { vendor: h.vendor, firmware: h.firmware }
    }, { timeout: 5 * 60_000, intervals: [1_000, 2_000, 5_000] })
    .toEqual({ vendor: "QEMU/KVM", firmware: node.fw })
  note(node, `discovered firmware=${node.fw}`)

  await row.getByRole("button", { name: /^Aksi untuk/ }).click()
  await page.getByRole("menuitem", { name: "Install OS" }).click()
  const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
  await sheet.locator('[id="os-ubuntu-24.04"]').click()
  await sheet.getByRole("tab", { name: /^Credentials/ }).click()
  await sheet.locator("#cred-user").fill(KVM.user)
  await sheet.locator("#cred-pass").fill(PASSWORD)
  if ((await sheet.locator("#cred-sudo").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-sudo").click()
  if ((await sheet.locator("#cred-nopw").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-nopw").click()
  await sheet.getByRole("tab", { name: /^Network/ }).click()
  await sheet.getByRole("radio", { name: "Static" }).click()
  await sheet.locator("#net-ip").fill(node.ip)
  await expect(sheet.locator("#net-gw")).toHaveValue(KVM.gateway)
  await expect(sheet.getByRole("button", { name: `Hapus DNS ${KVM.dns}` })).toBeVisible()
  await sheet.getByRole("tab", { name: /^Hostname/ }).click()
  await sheet.locator("#hn-name").fill(hostname)
  await sheet.getByRole("tab", { name: /^SSH Keys/ }).click()
  // Key run yang sama untuk semua node: node berikutnya memilihnya dari library (G3-3, attempt4 M4).
  const [kType, kBlob] = publicKey().split(/\s+/)
  const lib = (await (await page.request.get("/api/ssh-keys")).json()) as { id: string; publicKey: string }[]
  const inLib = lib.find((k) => k.publicKey.split(/\s+/)[1] === kBlob && k.publicKey.startsWith(kType))
  if (inLib) {
    const cb = sheet.locator(`[id="lib-${inLib.id}"]`)
    if ((await cb.getAttribute("aria-checked")) !== "true") await cb.click()
    await expect(cb).toHaveAttribute("aria-checked", "true")
  } else {
    await sheet.getByRole("button", { name: "Tempel / unggah key baru" }).click()
    await sheet.locator("#key-0").fill(publicKey())
    await sheet.locator("#key-name-0").fill(`${KVM.run}-${node.nn}-run-key`)
  }
  await page.screenshot({ path: shot(`${node.name}-sheet`), mask: [sheet.locator("#cred-pass")] })

  await sheet.getByRole("button", { name: "Simpan & Install" }).click()
  const confirm = page.getByRole("alertdialog", { name: /^Install OS ke / })
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/hosts/${hostId(node.mac)}`),
    { timeout: 60_000 },
  )
  const installed = page.waitForResponse((r) => r.url().endsWith(`/api/hosts/${hostId(node.mac)}/install`), { timeout: 60_000 })
  await confirm.getByRole("button", { name: "Hapus disk & install" }).click()
  const savedRes = await saved
  expect(savedRes.status(), await savedRes.text()).toBe(200)
  expect((await installed).status()).toBe(200)
  const pill = row.locator("[data-status]").first()
  await expect(pill).toHaveAttribute("data-status", "booting")
  note(node, "install dibuat (UI): booting")
  return { row, pill }
}

/** Amati status pill (UI, tanpa reload) sampai done/failed atau batas waktu. */
async function watchUntilFinal(page: Page, pill: Locator, node: KvmNode, label: string, timeoutMs: number) {
  const seen: string[] = []
  const deadline = Date.now() + timeoutMs
  let last = ""
  while (Date.now() < deadline) {
    const st = await pill.getAttribute("data-status")
    if (st && st !== last) {
      seen.push(st)
      last = st
      note(node, `${label}: ${st} (UI)`)
      await page.screenshot({ path: shot(`${node.name}-${label}-${st}`) })
    }
    if (st === "done" || st === "failed") break
    await page.waitForTimeout(2_000)
  }
  return { seen, last }
}

/** verify-node.sh (SSH key yang di-inject) + login password ditolak + reboot dari disk. */
async function verifySshAndReboot(page: Page, node: KvmNode, hostname: string) {
  const envs = [
    `EXPECT_HOSTNAME=${hostname}`,
    `EXPECT_IP=${node.ip}`,
    `EXPECT_PREFIX=${KVM.prefix}`,
    `EXPECT_MAC=${node.mac}`,
    `EXPECT_GW=${KVM.gateway}`,
    `EXPECT_DNS=${KVM.dns}`,
    `EXPECT_USER=${KVM.user}`,
    `EXPECT_PUBKEY='${publicKey()}'`,
  ].join(" ")
  const script = readFileSync(path.join(__dirname, "verify-node.sh"), "utf8")
  const v1 = ssh(node.ip, `${envs} bash -s`, script)
  const pw = passwordLoginRejected(node.ip)
  const kernelsBefore = installerBoots(node)
  const jobsBefore = (await jobsOf(page, node.mac)).jobs.length

  ssh(node.ip, "sudo -n systemctl reboot")
  let back = false
  const deadline = Date.now() + 10 * 60_000
  await page.waitForTimeout(20_000)
  while (Date.now() < deadline) {
    if (ssh(node.ip, "true").code === 0) {
      back = true
      break
    }
    await page.waitForTimeout(5_000)
  }
  const v2 = back ? ssh(node.ip, `${envs} bash -s`, script) : { code: -1, out: "node tidak kembali" }
  const kernelsAfter = installerBoots(node)
  const host = await apiHost(page, node.mac)
  const jobsAfter = (await jobsOf(page, node.mac)).jobs
  const script2 = await (await page.request.get(`/boot/${node.mac}.ipxe?platform=${node.fw === "uefi" ? "efi" : "pcbios"}`)).text()
  const file = `${node.name}-verify-ssh.txt`
  writeFileSync(
    path.join(KVM.runsDir, file),
    [
      "# verify-node.sh sebelum reboot", v1.out, `# exit=${v1.code}`,
      "# login password (PreferredAuthentications=password)", pw.out.trim(), `# ditolak=${pw.ok}`,
      `# reboot: kembali=${back}`, "# verify-node.sh sesudah reboot", v2.out, `# exit=${v2.code}`,
      `# kernel installer di serial log: sebelum reboot=${kernelsBefore} sesudah=${kernelsAfter}`,
      `# status host sesudah reboot: ${host?.status} osInstalled=${host?.osInstalled} osAssigned=${host?.osAssigned}`,
      `# jumlah job: sebelum reboot=${jobsBefore} sesudah=${jobsAfter.length} (${jobsAfter.map((j) => `${j.status}${j.failureReason ? `/${j.failureReason}` : ""}`).join(", ")})`,
      `# /boot/${node.mac}.ipxe sesudah reboot:`, script2,
    ].join("\n") + "\n",
  )
  return { v1, pw, back, v2, kernelsBefore, kernelsAfter, host, jobsBefore, jobsAfter, script2, file }
}

test.afterAll(() => {
  const findings = scanEvidence([PASSWORD])
  writeFileSync(
    path.join(KVM.runsDir, "evidence-scan.txt"),
    findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password run, token /boot/, private key (teks & base64)\n",
  )
  record({ ac: "AC-5.43-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan (scan harness)`, evidence: ["evidence-scan.txt"] })
  writeResults({ nodes: NODES.map((n) => ({ name: n.name, fw: n.fw, role: isDestroyNode(n) ? "destroy" : "install" })) })
})

for (const node of NODES) {
  const hostname = `${KVM.run}-node${node.nn}`

  if (isDestroyNode(node)) {
    test(`AC-5.39 ${node.name} (${node.fw}): virsh destroy saat Installing → boot lokal → Failed timeout-installing`, async ({ page, context }) => {
      const t0 = Date.now()
      const settings = await (await page.request.get("/api/settings")).json()
      const instMin: number = settings.jobTimeouts.installingMin
      writeResults({ jobTimeouts: settings.jobTimeouts, maxInstallerBoots: settings.maxInstallerBoots })
      note(node, `settings jobTimeouts=${JSON.stringify(settings.jobTimeouts)} maxInstallerBoots=${settings.maxInstallerBoots}`)

      const { pill } = await discoverConfigureInstall(page, node, hostname)
      const job = (await jobsOf(page, node.mac)).jobs[0]
      expect(job.status).toBe("booting")
      expect(job.installerBoots).toBe(0)

      // Halaman Jobs (tab kedua, tanpa reload) untuk log & timeline.
      const jp = await context.newPage()
      await jp.goto(`/jobs?host=${hostId(node.mac)}`)
      await jp.evaluate(NO_RELOAD)
      await expect(jp.getByTestId("job-detail")).toHaveAttribute("data-job-id", job.id)

      resetNode(node)
      note(node, "node.sh reset")
      await expect(pill).toHaveAttribute("data-status", "installing", { timeout: 15 * 60_000 })
      note(node, "installing (UI)")
      await expect
        .poll(async () => (await jobLog(page, job.id)).some((e) => e.kind === "installer" && e.message.includes("autoinstall mulai")), {
          timeout: 10 * 60_000,
          intervals: [2_000, 5_000],
        })
        .toBe(true)
      await expect(jp.getByTestId("log-line").filter({ hasText: "installer: autoinstall mulai" })).toHaveCount(1, { timeout: 30_000 })
      note(node, "event installer 'autoinstall mulai' tampil di log job (UI)")
      await jp.screenshot({ path: shot(`${node.name}-job1-installing-log`) })

      const { jobs: jbefore, skewMs } = await jobsOf(page, node.mac)
      const j1 = jbefore[0]
      const installingAt = stageAt(j1, "installing")
      expect(installingAt).not.toBeNull()
      const installingLocal = Date.parse(installingAt!) - skewMs
      const kernelsBefore = installerBoots(node)
      const warnBefore = (await jobLog(page, job.id)).filter((e) => e.level === "warn" && e.source === "boot-script").length
      const ngxBefore = nginxIpxeRequests(node.mac)
      note(node, `sebelum destroy: status=${j1.status} installerBoots=${j1.installerBoots} kernelSerial=${kernelsBefore} warn=${warnBefore} nginxIpxe=${ngxBefore} skewMs=${Math.round(skewMs)}`)
      expect(j1.status).toBe("installing")
      expect(j1.installerBoots).toBe(1)
      expect(kernelsBefore).toBeGreaterThanOrEqual(1)

      powerNode(node, "poweroff")
      note(node, "node.sh poweroff (virsh destroy)")
      await page.waitForTimeout(5_000)
      powerNode(node, "start")
      const tStart = Date.now()
      note(node, "node.sh start")

      // PXE boot ulang → /boot/<mac>.ipxe → boot lokal + event warn (CR-4-1).
      await expect
        .poll(async () => (await jobLog(page, job.id)).filter((e) => e.level === "warn" && e.source === "boot-script" && e.message.includes("PXE boot ulang saat Installing")).length, {
          timeout: 5 * 60_000,
          intervals: [2_000, 5_000],
        })
        .toBeGreaterThan(warnBefore)
      const ngxAfter = nginxIpxeRequests(node.mac)
      const afterStart = (await jobsOf(page, node.mac)).jobs[0]
      note(node, `setelah start (+${Math.round((Date.now() - tStart) / 1000)} dtk): status=${afterStart.status} installerBoots=${afterStart.installerBoots} nginxIpxe=${ngxAfter} kernelSerial=${installerBoots(node)}`)
      const localScript = await (await page.request.get(`/boot/${node.mac}.ipxe?platform=efi`)).text()
      writeFileSync(path.join(KVM.runsDir, `${node.name}-after-start-ipxe.txt`), `GET /boot/${node.mac}.ipxe (host, job installing):\n${localScript}\n`)

      // Tetap Installing sampai timeout, lalu Failed di UI tanpa reload.
      let failedSeenLocal = 0
      let earlyFail = ""
      const deadline = installingLocal + (instMin + 2) * 60_000 + 30_000
      let nextCheck = 0
      while (Date.now() < deadline) {
        const st = await pill.getAttribute("data-status")
        if (st === "failed") {
          failedSeenLocal = Date.now()
          break
        }
        if (st !== "installing") earlyFail = `status UI ${st} sebelum Failed`
        if (Date.now() > nextCheck) {
          nextCheck = Date.now() + 60_000
          const k = installerBoots(node)
          note(node, `menunggu watchdog: UI=${st} kernelSerial=${k} (+${Math.round((Date.now() - installingLocal) / 1000)} dtk sejak Installing)`)
        }
        await page.waitForTimeout(2_000)
      }
      const elapsedUiS = failedSeenLocal ? Math.round((failedSeenLocal - installingLocal) / 1000) : -1
      note(node, `Failed teramati di UI: ${failedSeenLocal ? `+${elapsedUiS} dtk sejak Installing` : "TIDAK"}`)
      await page.screenshot({ path: shot(`${node.name}-job1-failed-hosts`) })

      const jf = (await jobsOf(page, node.mac)).jobs[0]
      const events = await jobLog(page, jf.id)
      const failStage = jf.stages[jf.stages.length - 1]
      const serverElapsedS = Math.round((Date.parse(failStage.at) - Date.parse(installingAt!)) / 1000)
      const kernelsAfter = installerBoots(node)
      const warnEv = events.filter((e) => e.level === "warn" && e.message.includes("PXE boot ulang saat Installing"))
      const errEv = events.filter((e) => e.level === "error" && e.source === "watchdog")

      // Jobs page (tanpa reload): pill Failed di timeline + alasan.
      const failedStep = jp.locator('[data-testid="timeline-step"][data-stage="failed"]')
      await expect(failedStep).toHaveAttribute("data-reached", "true", { timeout: 60_000 })
      await expect(failedStep.locator('[data-status="failed"]')).toBeVisible()
      const reason = jp.getByTestId("job-failure-reason")
      await expect(reason).toHaveAttribute("data-reason", "timeout-installing")
      await expect(reason).toContainText("Timeout di tahap Installing")
      const jpNoReload = await jp.evaluate(STILL_NO_RELOAD)
      await jp.screenshot({ path: shot(`${node.name}-job1-failed-timeline`) })
      const hostsReason = (await hostRow(page, node.mac).getByTestId("host-failure-reason").allTextContents()).join(" ") || null

      writeFileSync(
        path.join(KVM.runsDir, `${node.name}-destroy.txt`),
        [
          `# AC-5.39 ${node.name} job ${jf.id}`,
          `timeout installing (settings): ${instMin} mnt`,
          `masuk Installing (server): ${installingAt}`,
          `Failed (server, stage watchdog): ${failStage.at} source=${failStage.source} → +${serverElapsedS} dtk`,
          `Failed teramati di UI hosts (tanpa reload): +${elapsedUiS} dtk sejak Installing; status lain sebelum Failed: ${earlyFail || "tidak ada"}`,
          `job: status=${jf.status} failureReason=${jf.failureReason} installerBoots=${jf.installerBoots} finishedAt=${jf.finishedAt}`,
          `kernel installer di serial: sebelum destroy=${kernelsBefore} saat Failed=${kernelsAfter}`,
          `nginx GET /boot/${node.mac}.ipxe: sebelum destroy=${ngxBefore} setelah start=${ngxAfter}`,
          `event warn boot lokal: ${warnEv.map((e) => `seq=${e.seq} repeat=${e.repeat}`).join(", ")}`,
          `event error watchdog: ${errEv.map((e) => `seq=${e.seq} "${e.message}"`).join(", ")}`,
          `UI hosts alasan: ${hostsReason ?? "-"}`,
          `halaman Jobs tanpa reload: ${jpNoReload}; hosts tanpa reload: ${await page.evaluate(STILL_NO_RELOAD)}`,
          "# event job",
          ...events.map((e) => `${e.seq} ${e.at} ${e.kind}/${e.level} ${e.source}: ${e.message}${e.repeat > 1 ? ` ×${e.repeat}` : ""}`),
        ].join("\n") + "\n",
      )
      const pass =
        failedSeenLocal > 0 &&
        !earlyFail &&
        jf.status === "failed" &&
        jf.failureReason === "timeout-installing" &&
        jf.installerBoots === 1 &&
        failStage.stage === "failed" &&
        failStage.source === "watchdog" &&
        serverElapsedS >= instMin * 60 &&
        elapsedUiS <= (instMin + 2) * 60 &&
        kernelsAfter === kernelsBefore &&
        ngxAfter > ngxBefore &&
        warnEv.length >= 1 &&
        errEv.length === 1 &&
        jpNoReload
      record({
        ac: "AC-5.39",
        node: node.name,
        status: pass ? "PASS" : "FAIL",
        durationS: Math.round((Date.now() - t0) / 1000),
        note: `Installing→Failed server +${serverElapsedS}s, UI +${elapsedUiS}s (timeout ${instMin} mnt); installerBoots ${jf.installerBoots}; kernel serial ${kernelsBefore}→${kernelsAfter}; nginx .ipxe ${ngxBefore}→${ngxAfter}`,
        evidence: [`${node.name}-destroy.txt`, `${node.name}-timeline.txt`, `${node.name}-after-start-ipxe.txt`, `${node.name}-console.txt`],
      })
      expect(failedSeenLocal).toBeGreaterThan(0)
      expect(earlyFail).toBe("")
      expect(jf).toMatchObject({ status: "failed", failureReason: "timeout-installing", installerBoots: 1 })
      expect(failStage).toMatchObject({ stage: "failed", source: "watchdog" })
      expect(serverElapsedS).toBeGreaterThanOrEqual(instMin * 60)
      expect(elapsedUiS).toBeLessThanOrEqual((instMin + 2) * 60)
      expect(kernelsAfter).toBe(kernelsBefore)
      expect(ngxAfter).toBeGreaterThan(ngxBefore)
      expect(localScript).not.toMatch(/\bkernel\b/)
      expect(localScript).not.toMatch(TOKEN_RE)
      expect(warnEv.length).toBeGreaterThanOrEqual(1)
      expect(errEv).toHaveLength(1)
      expect(jpNoReload).toBe(true)
      await jp.close()
    })

    test(`AC-5.40 ${node.name}: install ulang dari UI → Done → SSH key, 2 job, reboot dari disk`, async ({ page }) => {
      const t0 = Date.now()
      await page.goto("/hosts")
      await page.evaluate(NO_RELOAD)
      const row = hostRow(page, node.mac)
      const pill = row.locator("[data-status]").first()
      await expect(pill).toHaveAttribute("data-status", "failed")
      await row.getByRole("button", { name: /^Aksi untuk/ }).click()
      await page.getByRole("menuitem", { name: "Install OS" }).click()
      const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
      await sheet.locator('[id="os-ubuntu-24.04"]').click()
      await sheet.getByRole("button", { name: /^(Simpan & Install|Install)$/ }).click()
      const confirm = page.getByRole("alertdialog", { name: /^Install OS ke / })
      const installed = page.waitForResponse((r) => r.url().endsWith(`/api/hosts/${hostId(node.mac)}/install`), { timeout: 60_000 })
      await confirm.getByRole("button", { name: "Hapus disk & install" }).click()
      expect((await installed).status()).toBe(200)
      await expect(pill).toHaveAttribute("data-status", "booting")
      note(node, "install ulang (UI): booting")
      const j0 = (await jobsOf(page, node.mac)).jobs
      expect(j0).toHaveLength(2)
      expect(j0[0]).toMatchObject({ status: "booting", installerBoots: 0 })
      expect(j0[1]).toMatchObject({ status: "failed", failureReason: "timeout-installing" })

      resetNode(node)
      note(node, "node.sh reset (install ulang)")
      const { seen, last } = await watchUntilFinal(page, pill, node, "job2", INSTALL_TIMEOUT_MS)
      const installS = Math.round((Date.now() - t0) / 1000)
      const jobsDone = (await jobsOf(page, node.mac)).jobs
      const ordered = JSON.stringify(seen) === JSON.stringify(["booting", "installing", "configuring", "done"])
      const v = await verifySshAndReboot(page, node, hostname)
      const twoJobs =
        jobsDone.length === 2 &&
        jobsDone[0].status === "done" &&
        jobsDone[1].status === "failed" &&
        jobsDone[1].failureReason === "timeout-installing" &&
        v.jobsAfter.length === 2
      const pass =
        ordered && last === "done" && installS <= INSTALL_TIMEOUT_MS / 1000 && twoJobs && v.v1.code === 0 && v.pw.ok && v.back && v.v2.code === 0 &&
        v.kernelsAfter === v.kernelsBefore && v.host?.status === "done" && !/\bkernel\b/.test(v.script2)
      record({
        ac: "AC-5.40",
        node: node.name,
        status: pass ? "PASS" : "FAIL",
        durationS: Math.round((Date.now() - t0) / 1000),
        note: `install ulang ${seen.join(" → ")} dalam ${installS}s; job: ${v.jobsAfter.map((j) => `${j.status}${j.failureReason ? `/${j.failureReason}` : ""}`).join(", ")}; kernel serial reboot ${v.kernelsBefore}→${v.kernelsAfter}`,
        evidence: [v.file, `${node.name}-timeline.txt`],
      })
      expect(seen).toEqual(["booting", "installing", "configuring", "done"])
      expect(installS).toBeLessThanOrEqual(INSTALL_TIMEOUT_MS / 1000)
      expect(await page.evaluate(STILL_NO_RELOAD)).toBe(true)
      expect(jobsDone.map((j) => [j.status, j.failureReason])).toEqual([["done", null], ["failed", "timeout-installing"]])
      expect(v.v1.code, v.v1.out).toBe(0)
      expect(v.pw.ok, v.pw.out).toBe(true)
      expect(v.back).toBe(true)
      expect(v.v2.code, v.v2.out).toBe(0)
      expect(v.kernelsAfter).toBe(v.kernelsBefore)
      expect(v.host).toMatchObject({ status: "done", osInstalled: "ubuntu-24.04", osAssigned: null, hostname, mgmtIp: node.ip })
      expect(v.jobsAfter).toHaveLength(2)
      expect(v.script2).not.toMatch(/\bkernel\b/)
      expect(consoleLog(node).length).toBeGreaterThan(0)
    })
  } else {
    test(`AC-5.41 + AC-5.42 ${node.name} (${node.fw}): jalur positif, log live SSE, token acak ditolak`, async ({ page, context }) => {
      const t0 = Date.now()
      const { pill } = await discoverConfigureInstall(page, node, hostname)
      const job = (await jobsOf(page, node.mac)).jobs[0]
      expect(job.status).toBe("booting")

      // ---- AC-5.42: negatif selama job aktif (dari host 10.99.0.1) ----
      const evBefore = (await jobsOf(page, node.mac)).jobs[0].eventCount
      const rnd = randomBytes(32).toString("base64url").slice(0, 43)
      const logRes = await page.request.post(`/boot/${node.mac}/${rnd}/log`, { headers: { "Content-Type": "text/plain" }, data: "uji token acak\n" })
      const stRes = await page.request.post(`/boot/${node.mac}/${rnd}/status`, { headers: { "Content-Type": "application/json" }, data: JSON.stringify({ stage: "done" }) })
      const evAfter = (await jobsOf(page, node.mac)).jobs[0].eventCount
      const local = await (await page.request.get(`/boot/${node.mac}.ipxe?platform=pcbios`)).text()
      const hostAfter = await apiHost(page, node.mac)
      const neg =
        logRes.status() === 404 && stRes.status() === 404 && evAfter === evBefore && !/\bkernel\b/.test(local) && !TOKEN_RE.test(local) && hostAfter?.status === "booting"
      writeFileSync(
        path.join(KVM.runsDir, `${node.name}-negative.txt`),
        [
          `POST /boot/${node.mac}/<token-acak-43>/log → ${logRes.status()} body=${JSON.stringify(await logRes.text())}`,
          `POST /boot/${node.mac}/<token-acak-43>/status → ${stRes.status()} body=${JSON.stringify(await stRes.text())}`,
          `eventCount job sebelum=${evBefore} sesudah=${evAfter}`,
          `GET /boot/${node.mac}.ipxe dari host:`,
          local,
          `status host setelah uji negatif: ${hostAfter?.status}`,
        ].join("\n") + "\n",
      )
      record({ ac: "AC-5.42", node: node.name, status: neg ? "PASS" : "FAIL", note: `log ${logRes.status()}, status ${stRes.status()}, event ${evBefore}→${evAfter}`, evidence: [`${node.name}-negative.txt`] })
      expect(logRes.status()).toBe(404)
      expect(stRes.status()).toBe(404)
      expect(evAfter).toBe(evBefore)
      expect(local).not.toMatch(/\bkernel\b/)
      expect(local).not.toMatch(TOKEN_RE)

      // ---- AC-5.41: halaman Jobs terbuka (tab kedua, tanpa reload) selama instalasi ----
      const jp = await context.newPage()
      await jp.goto(`/jobs?host=${hostId(node.mac)}`)
      await jp.evaluate(NO_RELOAD)
      await expect(jp.getByTestId("job-detail")).toHaveAttribute("data-job-id", job.id)
      await expect(jp.getByTestId("log-connection")).toHaveAttribute("data-state", "live", { timeout: 30_000 })
      const detailPill = jp.getByTestId("job-detail").locator("[data-status]").first()

      resetNode(node)
      note(node, "node.sh reset")
      const MARKERS = ["installer: autoinstall mulai", "installer: late-commands mulai", "first-boot: OS terpasang"]
      const markerSeen: Record<string, { t: number; conn: string; status: string }> = {}
      const connStates = new Set<string>()
      const seen: string[] = []
      let last = ""
      const deadline = Date.now() + INSTALL_TIMEOUT_MS
      while (Date.now() < deadline) {
        const st = (await detailPill.getAttribute("data-status")) ?? ""
        const conn = (await jp.getByTestId("log-connection").getAttribute("data-state")) ?? ""
        connStates.add(conn)
        if (st && st !== last) {
          seen.push(st)
          last = st
          note(node, `job: ${st} (UI Jobs, koneksi log ${conn})`)
          await jp.screenshot({ path: shot(`${node.name}-jobs-${st}`) })
        }
        const lines = await jp.getByTestId("log-line").allTextContents()
        for (const m of MARKERS) {
          if (!markerSeen[m] && lines.some((l) => l.includes(m))) {
            markerSeen[m] = { t: Date.now(), conn, status: st }
            note(node, `penanda log tampil (tanpa reload): "${m}" (koneksi ${conn}, status ${st})`)
          }
        }
        if (st === "done" || st === "failed") break
        await jp.waitForTimeout(2_000)
      }
      const installS = Math.round((Date.now() - t0) / 1000)
      // Setelah Done: semua penanda + indikator Selesai + timeline 4 pill dengan waktu.
      await expect(jp.getByTestId("log-connection")).toHaveAttribute("data-state", "ended", { timeout: 60_000 })
      const lines = await jp.getByTestId("log-line").allTextContents()
      for (const m of MARKERS) {
        if (!markerSeen[m] && lines.some((l) => l.includes(m))) markerSeen[m] = { t: Date.now(), conn: "ended", status: last }
      }
      const seqOf = async (m: string) => Number(await jp.getByTestId("log-line").filter({ hasText: m }).first().getAttribute("data-seq"))
      const seqs = await Promise.all(MARKERS.map(seqOf))
      const steps = jp.getByTestId("timeline-step")
      const stepInfo = await steps.evaluateAll((els) =>
        els.map((el) => ({ stage: el.getAttribute("data-stage"), reached: el.getAttribute("data-reached"), time: el.querySelector('[data-testid="timeline-time"]')?.textContent ?? "" })),
      )
      const jpNoReload = await jp.evaluate(STILL_NO_RELOAD)
      await jp.screenshot({ path: shot(`${node.name}-jobs-final`) })
      const liveDuring = MARKERS.slice(0, 2).every((m) => markerSeen[m] && (markerSeen[m].conn === "live" || markerSeen[m].conn === "polling") && markerSeen[m].status !== "done")
      const timelineOk =
        JSON.stringify(stepInfo.map((s) => [s.stage, s.reached])) === JSON.stringify([["booting", "true"], ["installing", "true"], ["configuring", "true"], ["done", "true"]]) &&
        stepInfo.every((s) => /^\d{2}[.:]\d{2}[.:]\d{2}$/.test(s.time.trim()))
      const ordered = JSON.stringify(seen) === JSON.stringify(["booting", "installing", "configuring", "done"])
      const seqOrdered = seqs.every((s) => Number.isFinite(s) && s > 0) && seqs[0] < seqs[1] && seqs[1] < seqs[2]

      const v = await verifySshAndReboot(page, node, hostname)
      writeFileSync(
        path.join(KVM.runsDir, `${node.name}-sse.txt`),
        [
          `# AC-5.41 ${node.name} job ${job.id}`,
          `status (UI Jobs, tanpa reload): ${seen.join(" → ")} dalam ${installS}s`,
          `state koneksi log teramati: ${[...connStates].join(", ")}`,
          ...MARKERS.map((m, i) => `penanda "${m}": seq=${seqs[i]} tampil=${markerSeen[m] ? `+${Math.round((markerSeen[m].t - t0) / 1000)}s koneksi=${markerSeen[m].conn} status=${markerSeen[m].status}` : "TIDAK"}`),
          `timeline: ${stepInfo.map((s) => `${s.stage}:${s.reached}@${s.time.trim()}`).join(" ")}`,
          `halaman Jobs tanpa reload: ${jpNoReload}`,
          `jumlah job setelah reboot: ${v.jobsAfter.length}`,
          "# baris log (UI)",
          ...lines,
        ].join("\n") + "\n",
      )
      const pass =
        ordered && last === "done" && installS <= INSTALL_TIMEOUT_MS / 1000 && liveDuring && !!markerSeen[MARKERS[2]] && seqOrdered && timelineOk && jpNoReload &&
        v.v1.code === 0 && v.pw.ok && v.back && v.v2.code === 0 && v.kernelsAfter === v.kernelsBefore && v.host?.status === "done" && v.jobsAfter.length === 1
      record({
        ac: "AC-5.41",
        node: node.name,
        status: pass ? "PASS" : "FAIL",
        durationS: Math.round((Date.now() - t0) / 1000),
        note: `${seen.join(" → ")} dalam ${installS}s; penanda seq ${seqs.join("<")}; koneksi ${[...connStates].join("/")}; job setelah reboot ${v.jobsAfter.length}`,
        evidence: [`${node.name}-sse.txt`, v.file, `${node.name}-timeline.txt`],
      })
      expect(seen).toEqual(["booting", "installing", "configuring", "done"])
      expect(installS).toBeLessThanOrEqual(INSTALL_TIMEOUT_MS / 1000)
      expect(liveDuring, JSON.stringify(markerSeen)).toBe(true)
      expect(markerSeen[MARKERS[2]]).toBeTruthy()
      expect(seqOrdered, seqs.join(",")).toBe(true)
      expect(timelineOk, JSON.stringify(stepInfo)).toBe(true)
      expect(jpNoReload).toBe(true)
      expect(await page.evaluate(STILL_NO_RELOAD)).toBe(true)
      expect(pill).toBeDefined()
      expect(v.v1.code, v.v1.out).toBe(0)
      expect(v.pw.ok, v.pw.out).toBe(true)
      expect(v.back).toBe(true)
      expect(v.v2.code, v.v2.out).toBe(0)
      expect(v.kernelsAfter).toBe(v.kernelsBefore)
      expect(v.host).toMatchObject({ status: "done", osInstalled: "ubuntu-24.04", osAssigned: null, hostname, mgmtIp: node.ip })
      expect(v.jobsAfter).toHaveLength(1)
      await jp.close()
    })
  }
}

// AC-5.38: server + allowlist nginx. Dari node non-destroy pertama yang sudah terpasang.
const allowNode = NODES.find((n) => !isDestroyNode(n))
if (allowNode) {
  test(`AC-5.38 server-check + allowlist nginx (host vs ${allowNode.name})`, async ({ page }) => {
    const t0 = Date.now()
    const check = existsSync(path.join(KVM.runsDir, "server-check.txt")) ? readFileSync(path.join(KVM.runsDir, "server-check.txt"), "utf8") : ""
    const deploy = existsSync(path.join(KVM.runsDir, "deploy-dashboard.txt")) ? readFileSync(path.join(KVM.runsDir, "deploy-dashboard.txt"), "utf8") : ""
    const serverOk =
      /^RESULT: PASS$/m.test(check) &&
      /^# server-check exit=0$/m.test(check) &&
      /^pxe-dashboard\s+active$/m.test(check) &&
      /^dnsmasq\s+active$/m.test(check) &&
      /^nginx\s+active$/m.test(check) &&
      /127\.0\.0\.1:3000/.test(check) &&
      !/0\.0\.0\.0:3000|\*:3000/.test(check) &&
      /nginx\.conf test is successful/.test(deploy)
    const hostSettings = await page.request.get("/api/settings")
    const remote = [
      "set -u",
      'get() { if command -v curl >/dev/null; then curl -s -o /dev/null -w "%{http_code}" "$1"; else wget -q -S -O /dev/null "$1" 2>&1 | awk \'/HTTP\\//{c=$2} END{print c}\'; fi; }',
      'body() { if command -v curl >/dev/null; then curl -s "$1"; else wget -q -O - "$1"; fi; }',
      `echo "src_ip $(ip -4 -o addr show scope global | awk '{print $4}' | tr '\\n' ' ')"`,
      `echo "GET /api/hosts $(get http://${SERVER_IP}/api/hosts)"`,
      `echo "GET /api/settings $(get http://${SERVER_IP}/api/settings)"`,
      `echo "GET /hosts $(get http://${SERVER_IP}/hosts)"`,
      `echo "GET /boot/${allowNode.mac}.ipxe $(get 'http://${SERVER_IP}/boot/${allowNode.mac}.ipxe?platform=pcbios')"`,
      "echo '# body /boot'",
      `body 'http://${SERVER_IP}/boot/${allowNode.mac}.ipxe?platform=pcbios'`,
    ].join("\n")
    const r = ssh(allowNode.ip, "bash -s", remote + "\n")
    const file = "allowlist-check.txt"
    writeFileSync(
      path.join(KVM.runsDir, file),
      `# host 10.99.0.1: GET /api/settings → ${hostSettings.status()}\n# dari ${allowNode.name} (${allowNode.ip}) via SSH (exit=${r.code}):\n${r.out}\n# server-check.txt RESULT PASS + layanan + 127.0.0.1:3000 + nginx -t: ${serverOk}\n`,
    )
    const bootBody = r.out.split("# body /boot")[1] ?? ""
    const pass =
      serverOk &&
      hostSettings.status() === 200 &&
      /^GET \/api\/hosts 403$/m.test(r.out) &&
      /^GET \/api\/settings 403$/m.test(r.out) &&
      new RegExp(`^GET /boot/${allowNode.mac}\\.ipxe 200$`, "m").test(r.out) &&
      /^#!ipxe/m.test(bootBody) &&
      !/\bkernel\b/.test(bootBody) &&
      !TOKEN_RE.test(bootBody)
    record({ ac: "AC-5.38", node: allowNode.name, status: pass ? "PASS" : "FAIL", durationS: Math.round((Date.now() - t0) / 1000), evidence: [file, "server-check.txt", "deploy-dashboard.txt"] })
    expect(serverOk, check.slice(-2000)).toBe(true)
    expect(hostSettings.status()).toBe(200)
    expect(r.out).toMatch(/^GET \/api\/hosts 403$/m)
    expect(r.out).toMatch(/^GET \/api\/settings 403$/m)
    expect(r.out).toMatch(new RegExp(`^GET /boot/${allowNode.mac}\\.ipxe 200$`, "m"))
    expect(bootBody).toMatch(/^#!ipxe/m)
    expect(bootBody).not.toMatch(/\bkernel\b/)
  })
}
