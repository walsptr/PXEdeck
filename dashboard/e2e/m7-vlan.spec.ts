// M7-T8 E2E PXE lewat VLAN (mock): AC-7.10 (Sheet satu host VLAN terdaftar + 422 server), AC-7.11 (bulk
// VLAN), DEC-006 untuk VLAN tidak terdaftar, AC-7.12 (Settings "VLAN management"), axe + lebar layar.
// Server sendiri (project "m7-vlan", playwright.config.ts): subnet PXE lab 10.10.10.0/24 + env
// PXE_VLAN_NETWORKS="20:10.99.20.0/24:10.99.20.1;30:10.99.30.0/26:10.99.30.1" (DEC-024 §4).
//
// Setiap test yang menyimpan memulihkan host yang diubahnya lewat API di akhir (`restore`), sehingga
// urutan/--grep tidak memengaruhi hasil. Pemegang IP tetap: storage-02 = 10.99.20.42 (VLAN 20).
import path from "node:path"

import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test"

import { gotoHosts, orangeElements, rowByMac, SHOTS, dropShadowViolations, waitForLocatorAnimations } from "./helpers"
import { auditA11y, writeAxeEvidence } from "./support/axe"

const JSON_HEADERS = { "content-type": "application/json" }
const MUTED = "rgb(128, 125, 114)" // --muted-foreground #807d72 (DEC-017 §9)
const MONO = '"JetBrains Mono Variable"'
const WIDTHS = [375, 768, 1280, 1440] as const

const V20 = { vlan: 20, cidr: "10.99.20.0/24", prefix: 24, gateway: "10.99.20.1" }
const V30 = { vlan: 30, cidr: "10.99.30.0/26", prefix: 26, gateway: "10.99.30.1" }

const STORAGE01 = { id: "9440c96e01aa", mac: "94:40:c9:6e:01:aa", name: "storage-01" }
const STORAGE02 = { id: "9440c96e01ab", mac: "94:40:c9:6e:01:ab", name: "storage-02" }
const CTRL02 = { id: "1418774a2c02", mac: "14:18:77:4a:2c:02", name: "ctrl-02" }
const BULK = [
  { id: "b083fe5c19e2", mac: "b0:83:fe:5c:19:e2" },
  { id: "b083fe5c19e3", mac: "b0:83:fe:5c:19:e3" },
  { id: "a0369f0b725d", mac: "a0:36:9f:0b:72:5d" },
]

/** Jaringan statis payload API (bentuk sama dengan form). */
function staticNet(assignments: Record<string, string>, over: Record<string, unknown> = {}) {
  return { mode: "static", assignments, prefix: 24, gateway: "10.10.10.1", dns: ["10.10.10.1"], vlan: null, iface: { by: "mac" }, ...over }
}

async function patchNetwork(request: APIRequestContext, id: string, network: unknown) {
  const res = await request.patch(`/api/hosts/${id}`, { headers: JSON_HEADERS, data: { network } })
  expect(res.status(), `PATCH ${id}: ${await res.text()}`).toBe(200)
}

/** Keadaan DB satu host yang terlihat lewat API (host + konfigurasi publik). */
async function hostState(request: APIRequestContext, id: string) {
  const host = await (await request.get(`/api/hosts/${id}`)).json()
  const config = await (await request.get(`/api/hosts/${id}/config`)).json()
  return { host, config }
}

test.beforeAll(async ({ request }) => {
  // Pemegang IP VLAN 20 di luar batch (AC-7.11 "satu IP terpakai → dilewati", bentrok 422).
  await patchNetwork(request, STORAGE02.id, staticNet({ [STORAGE02.id]: "10.99.20.42" }, { gateway: V20.gateway, vlan: 20 }))
})

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState("networkidle").catch(() => {})
}

async function openSingle(page: Page, name: string) {
  await gotoHosts(page)
  await page.getByRole("button", { name: `Aksi untuk ${name}` }).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  const sheet = page.getByRole("dialog", { name: `Konfigurasi ${name}` })
  await expect(sheet).toBeVisible()
  await waitForLocatorAnimations(sheet)
  await sheet.getByRole("tab", { name: /^Network/ }).click()
  return sheet
}

async function openBulk(page: Page) {
  await gotoHosts(page)
  for (const h of BULK) await page.getByRole("checkbox", { name: `Pilih ${h.mac}` }).click()
  const bar = page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })
  await expect(bar).toContainText("3 host dipilih")
  await bar.getByRole("button", { name: "Set IP" }).click()
  const sheet = page.getByRole("dialog", { name: "Konfigurasi 3 host" })
  await expect(sheet.getByRole("tab", { name: /^Network/ })).toHaveAttribute("aria-selected", "true")
  await waitForLocatorAnimations(sheet)
  return sheet
}

/** font-family terhitung elemen-elemen `loc` (semua harus JetBrains Mono). */
async function fontsOf(loc: Locator) {
  return loc.evaluateAll((els) => els.map((el) => ({ text: el.textContent!.trim(), font: getComputedStyle(el).fontFamily })))
}
async function expectMono(loc: Locator, label: string) {
  const fonts = await fontsOf(loc)
  expect(fonts.length, `${label}: elemen ditemukan`).toBeGreaterThan(0)
  for (const f of fonts) expect(f.font.startsWith(MONO), `${label}: "${f.text}" → ${f.font}`).toBe(true)
}

/** Warna terhitung elemen + semua turunan yang punya teks langsung (informasi penting tidak boleh muted). */
async function expectNotMuted(loc: Locator, label: string) {
  const items = await loc.evaluateAll((els) =>
    els.map((el) => {
      const colors = new Set<string>([getComputedStyle(el).color])
      for (const d of Array.from(el.querySelectorAll<HTMLElement>("*")))
        if (Array.from(d.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())) colors.add(getComputedStyle(d).color)
      return { text: el.textContent!.trim(), colors: [...colors] }
    }),
  )
  expect(items.length, `${label}: elemen ditemukan`).toBeGreaterThan(0)
  for (const it of items) expect(it.colors, `${label}: ${it.text}`).not.toContain(MUTED)
}

/** Lebar halaman tidak meluap (scrollWidth dokumen = viewport) + Sheet tidak meluap horizontal. */
async function overflowOf(page: Page) {
  return page.evaluate(() => {
    const sheet = document.querySelector<HTMLElement>('[data-slot="sheet-content"]')
    const scroller = sheet ? Array.from(sheet.querySelectorAll<HTMLElement>("*")).filter((el) => getComputedStyle(el).overflowY === "auto") : []
    return {
      vw: window.innerWidth,
      doc: document.documentElement.scrollWidth,
      sheet: sheet ? { scroll: sheet.scrollWidth, client: sheet.clientWidth, right: Math.round(sheet.getBoundingClientRect().right) } : null,
      scrollers: scroller.map((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, slot: el.dataset.slot ?? el.className.slice(0, 40) })),
    }
  })
}
async function expectNoOverflow(page: Page, label: string) {
  const m = await overflowOf(page)
  expect(m.doc, `${label}: scrollWidth dokumen`).toBe(m.vw)
  if (m.sheet) {
    expect(m.sheet.scroll, `${label}: scrollWidth Sheet`).toBeLessThanOrEqual(m.sheet.client)
    expect(m.sheet.right, `${label}: tepi kanan Sheet`).toBeLessThanOrEqual(m.vw)
  }
}

// ---------------------------------------------------------------------------------------------------------
test.describe("AC-7.12 Settings blok VLAN management + API", () => {
  test("GET /api/settings & /api/network memuat vlanNetworks terdaftar (identik)", async ({ request }) => {
    const settings = await (await request.get("/api/settings")).json()
    const network = await (await request.get("/api/network")).json()
    expect(settings.vlanNetworks).toEqual([V20, V30])
    expect(network.vlanNetworks).toEqual(settings.vlanNetworks)
  })

  test("/settings: card VLAN · Subnet · Gateway (mono) tepat setelah Jaringan provisioning, hairline tanpa shadow, tanpa oranye; 4 lebar tanpa overflow", async ({ page }) => {
    await page.goto("/settings")
    const card = page.getByTestId("settings-vlan")
    await expect(card).toBeVisible()
    await settle(page)
    // Urutan card: Jaringan provisioning → VLAN management → sisanya (satu card tambahan).
    const titles = (await page.locator('[data-slot="settings-section"] [data-slot="card-title"]').allTextContents()).map((t) => t.trim())
    expect(titles.slice(0, 2)).toEqual(["Jaringan provisioning", "VLAN management"])
    expect(titles.filter((t) => t === "VLAN management")).toHaveLength(1)
    await expect(card).toHaveAttribute("data-slot", "settings-section")
    await expect(page.getByTestId("settings-vlan-empty")).toHaveCount(0)

    const table = card.getByRole("table", { name: "VLAN management terdaftar" })
    await expect(table.locator("thead th")).toHaveText(["VLAN", "Subnet", "Gateway"])
    const rows = table.locator("tbody tr")
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0).locator("td")).toHaveText(["20", "10.99.20.0/24", "10.99.20.1"])
    await expect(rows.nth(1).locator("td")).toHaveText(["30", "10.99.30.0/26", "10.99.30.1"])
    await expectMono(table.locator("tbody td"), "sel VLAN/subnet/gateway")
    // Nilai VLAN/subnet/gateway = informasi penting (bukan muted).
    await expectNotMuted(table.locator("tbody td"), "sel tabel VLAN")

    // Card hairline (border 1px), tanpa drop shadow, tanpa elemen oranye di dalamnya.
    const border = await card.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { w: cs.borderTopWidth, style: cs.borderTopStyle, shadow: cs.boxShadow }
    })
    const ring = border.w === "1px" && border.style === "solid"
    const spreadRing = /0px 0px 0px 1px/.test(border.shadow)
    expect(ring || spreadRing, `hairline card: ${JSON.stringify(border)}`).toBe(true)
    expect(await dropShadowViolations(page, '[data-testid="settings-vlan"], [data-testid="settings-vlan"] *')).toEqual([])
    const orange = (await orangeElements(page)).filter((o) => o.text.includes("VLAN management") || o.text.includes("10.99.20.0/24"))
    expect(orange).toEqual([])
    expect(await card.evaluate((el) => {
      const orangeRgb = "rgb(245, 78, 0)"
      return [el as Element, ...Array.from(el.querySelectorAll("*"))]
        .filter((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color, getComputedStyle(e).borderTopColor].includes(orangeRgb))
        .map((e) => e.tagName)
    })).toEqual([])

    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 })
      await expect(card).toBeVisible()
      await waitForLocatorAnimations(card)
      await expectNoOverflow(page, `/settings@${w}`)
      // Tabel VLAN tidak terpotong di dalam card (sel terakhir di dalam viewport).
      const right = await rows.nth(0).locator("td").last().evaluate((el) => el.getBoundingClientRect().right)
      expect(right, `/settings@${w}: sel gateway di dalam viewport`).toBeLessThanOrEqual(w)
      await card.scrollIntoViewIfNeeded()
      await page.screenshot({ path: SHOTS(7, `ac-7.12-settings-vlan-${w}`), fullPage: true })
    }
  })
})

// ---------------------------------------------------------------------------------------------------------
test.describe("AC-7.10 Sheet satu host, tab Network VLAN terdaftar", () => {
  test.afterEach(async ({ request }) => {
    // Pulihkan storage-01 ke jaringan PXE (seed) agar test lain tidak bergantung urutan.
    await patchNetwork(request, STORAGE01.id, staticNet({ [STORAGE01.id]: "10.10.10.41" }))
  })

  test("petunjuk mono, isi otomatis prefix/gateway, validasi subnet VLAN, gateway manual dipertahankan, VLAN dikosongkan → subnet PXE, simpan vlan 20 → 200", async ({ page, request }) => {
    const sheet = await openSingle(page, STORAGE01.name)
    const ip = sheet.locator("#net-ip")
    const vlan = sheet.locator("#net-vlan")
    const prefix = sheet.locator("#net-prefix")
    const gw = sheet.locator("#net-gw")
    const hint = sheet.getByTestId("net-ip-hint")
    const ipError = sheet.locator('[data-slot="field-error"]').first()
    const save = sheet.getByRole("button", { name: "Simpan konfigurasi" })

    // Keadaan awal: tanpa VLAN → subnet PXE (DEC-006).
    await expect(ip).toHaveValue("10.10.10.41")
    await expect(vlan).toHaveValue("")
    await expect(prefix).toHaveValue("24")
    await expect(gw).toHaveValue("10.10.10.1")
    await expect(hint).toHaveText("Di dalam 10.10.10.0/24, di luar range dinamis 10.10.10.100–10.10.10.200.")

    // Petunjuk VLAN terdaftar "20 · 10.99.20.0/24" (JetBrains Mono).
    const registered = sheet.getByTestId("vlan-registered")
    await expect(registered).toHaveText("Terdaftar: 20 · 10.99.20.0/24, 30 · 10.99.30.0/26")
    await expect(registered.locator('[data-slot="vlan-hint"]')).toHaveText(["20 · 10.99.20.0/24", "30 · 10.99.30.0/26"])
    await expectMono(registered.locator('[data-slot="vlan-hint"]'), "petunjuk VLAN")
    await expect(sheet.getByTestId("vlan-unregistered")).toHaveCount(0)

    // VLAN 20 → gateway VLAN terisi; IP lama (subnet PXE) kini di luar subnet VLAN.
    await vlan.fill("20")
    await expect(prefix).toHaveValue("24")
    await expect(gw).toHaveValue("10.99.20.1")
    await expect(ipError).toHaveText("Di luar subnet 10.99.20.0/24 (VLAN 20)")
    await expect(save).toBeDisabled()

    // IP 10.99.10.41 → error field, simpan nonaktif, tab ditandai error.
    await ip.fill("10.99.10.41")
    await expect(ipError).toHaveText("Di luar subnet 10.99.20.0/24 (VLAN 20)")
    await expect(ip).toHaveAttribute("aria-invalid", "true")
    await expect(sheet.getByRole("tab", { name: /^Network/ })).toContainText("(ada error)")
    await expect(save).toBeDisabled()
    await expectNotMuted(sheet.locator('[data-slot="field-error"]'), "error field IP")
    await expectMono(ipError.locator('[data-slot="ip-token"]'), "IP/CIDR di pesan error")
    await page.screenshot({ path: SHOTS(7, "ac-7.10-single-vlan20-invalid") })

    // IP 10.99.20.1 = gateway VLAN → ditolak.
    await ip.fill("10.99.20.1")
    await expect(ipError).toHaveText("Dipakai gateway VLAN 20")
    await expect(save).toBeDisabled()
    // Bentrok dengan storage-02 (10.99.20.42, VLAN 20).
    await ip.fill("10.99.20.42")
    await expect(ipError).toHaveText("Bentrok dengan storage-02")
    await expect(save).toBeDisabled()

    // IP 10.99.20.41 → valid; deskripsi IP VLAN.
    await ip.fill("10.99.20.41")
    await expect(sheet.locator('[data-slot="field-error"]')).toHaveCount(0)
    await expect(hint).toHaveText("Di dalam 10.99.20.0/24 (VLAN 20).")
    await expectMono(hint.locator("span"), "CIDR di deskripsi IP")
    await expect(save).toBeEnabled()
    await page.screenshot({ path: SHOTS(7, "ac-7.10-single-vlan20-valid") })

    // VLAN 30 (/26) → prefix & gateway mengikuti VLAN 30; IP VLAN 20 kini di luar subnet.
    await vlan.fill("30")
    await expect(prefix).toHaveValue("26")
    await expect(gw).toHaveValue("10.99.30.1")
    await expect(ipError).toHaveText("Di luar subnet 10.99.30.0/26 (VLAN 30)")
    await expect(save).toBeDisabled()
    await vlan.fill("20")
    await expect(prefix).toHaveValue("24")
    await expect(gw).toHaveValue("10.99.20.1")
    await expect(save).toBeEnabled()

    // Gateway diubah manual → tidak ditimpa saat VLAN diganti (prefix default tetap mengikuti).
    await gw.fill("10.99.20.254")
    await vlan.fill("30")
    await expect(gw).toHaveValue("10.99.20.254")
    await expect(prefix).toHaveValue("26")
    await expect(gw).toHaveAttribute("aria-invalid", "true")
    await expect(save).toBeDisabled()
    await vlan.fill("20")
    await expect(gw).toHaveValue("10.99.20.254")
    await expect(gw).not.toHaveAttribute("aria-invalid", "true")
    await gw.fill("10.99.20.1")

    // VLAN dikosongkan → aturan subnet PXE kembali (prefix/gateway default PXE, IP VLAN ditolak).
    await vlan.fill("")
    await expect(prefix).toHaveValue("24")
    await expect(gw).toHaveValue("10.10.10.1")
    await expect(ipError).toHaveText("Di luar subnet 10.10.10.0/24")
    await expect(save).toBeDisabled()
    await ip.fill("10.10.10.45")
    await expect(hint).toHaveText("Di dalam 10.10.10.0/24, di luar range dinamis 10.10.10.100–10.10.10.200.")
    await expect(save).toBeEnabled()

    // Kembali ke VLAN 20 + IP valid → simpan: payload vlan 20, status 200, tersimpan.
    await vlan.fill("20")
    await expect(gw).toHaveValue("10.99.20.1")
    await ip.fill("10.99.20.41")
    await expect(save).toBeEnabled()
    const req = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/api/hosts/${STORAGE01.id}`))
    const res = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/hosts/${STORAGE01.id}`))
    await save.click()
    const payload = (await req).postDataJSON()
    expect(payload.network).toEqual({
      mode: "static",
      assignments: { [STORAGE01.id]: "10.99.20.41" },
      prefix: 24,
      gateway: "10.99.20.1",
      dns: ["10.10.10.1"],
      vlan: 20,
      iface: { by: "mac" },
    })
    expect((await res).status()).toBe(200)
    await expect(page.getByText("Konfigurasi disimpan")).toBeVisible()
    await expect(sheet).toBeHidden()
    await expect(rowByMac(page, STORAGE01.mac).locator("td").nth(3)).toContainText("mgmt 10.99.20.41")
    const after = await hostState(request, STORAGE01.id)
    expect(after.host.mgmtIp).toBe("10.99.20.41")
    expect(after.config.network).toMatchObject({ mode: "static", ip: "10.99.20.41", prefix: 24, gateway: "10.99.20.1", vlan: 20 })

    // Buka ulang: VLAN 20 termuat, deskripsi VLAN.
    const again = await openSingle(page, STORAGE01.name)
    await expect(again.locator("#net-vlan")).toHaveValue("20")
    await expect(again.locator("#net-ip")).toHaveValue("10.99.20.41")
    await expect(again.getByTestId("net-ip-hint")).toHaveText("Di dalam 10.99.20.0/24 (VLAN 20).")
  })

  // Validasi klien dilewati dengan menulis ulang body PATCH yang dikirim UI (page.route): server tetap
  // menolak (DEC-024 §4) dan pesannya tampil di tab Network ("Ditolak server"); DB tidak berubah.
  const SERVER_422 = [
    {
      name: "IP di luar subnet VLAN",
      mutate: (n: Record<string, unknown>) => (n.assignments = { [STORAGE01.id]: "10.99.10.41" }),
      message: "storage-01: Di luar subnet 10.99.20.0/24 (VLAN 20)",
    },
    {
      name: "gateway di luar subnet VLAN",
      mutate: (n: Record<string, unknown>) => (n.gateway = "10.10.10.1"),
      message: "Gateway 10.10.10.1 di luar subnet VLAN 20 10.99.20.0/24",
    },
    {
      name: "IP bentrok dengan host lain di VLAN",
      mutate: (n: Record<string, unknown>) => (n.assignments = { [STORAGE01.id]: "10.99.20.42" }),
      message: "storage-01: Bentrok dengan storage-02",
    },
  ]
  test("422 server (luar subnet / gateway / bentrok) tampil di tab Network, DB tidak berubah", async ({ page, request }) => {
    const sheet = await openSingle(page, STORAGE01.name)
    await sheet.locator("#net-vlan").fill("20")
    await sheet.locator("#net-ip").fill("10.99.20.41")
    const save = sheet.getByRole("button", { name: "Simpan konfigurasi" })
    await expect(save).toBeEnabled()
    const before = await hostState(request, STORAGE01.id)
    expect(before.host.mgmtIp).toBe("10.10.10.41")

    for (const c of SERVER_422) {
      let sent: Record<string, unknown> | null = null
      const url = `**/api/hosts/${STORAGE01.id}`
      await page.route(url, async (route) => {
        const r = route.request()
        if (r.method() !== "PATCH") return route.fallback()
        const body = r.postDataJSON()
        c.mutate(body.network)
        sent = body
        await route.continue({ postData: JSON.stringify(body), headers: { ...r.headers(), "content-type": "application/json" } })
      })
      // Pindah tab dulu: server harus membawa kembali ke tab Network.
      await sheet.getByRole("tab", { name: /^OS/ }).click()
      const res = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/hosts/${STORAGE01.id}`))
      await save.click()
      const response = await res
      expect(response.status(), c.name).toBe(422)
      const body = await response.json()
      expect(body.errors.filter((e: { section: string }) => e.section === "network").map((e: { message: string }) => e.message), c.name).toContain(c.message)
      expect(sent, c.name).not.toBeNull()
      await page.unroute(url)

      await expect(sheet.getByRole("tab", { name: /^Network/ })).toHaveAttribute("aria-selected", "true")
      const alert = sheet.getByRole("tabpanel").getByRole("alert").filter({ hasText: "Ditolak server" })
      await expect(alert, c.name).toContainText(c.message)
      await expectNotMuted(alert, `alert 422 ${c.name}`)
      await expect(sheet.getByRole("tab", { name: /^Network/ })).toContainText("(ada error)")
      await expect(page.getByText("Konfigurasi ditolak server").first()).toBeVisible()
      await expect(sheet).toBeVisible()
      expect(await hostState(request, STORAGE01.id), `${c.name}: DB tidak berubah`).toEqual(before)
      await page.screenshot({ path: SHOTS(7, `ac-7.10-server-422-${SERVER_422.indexOf(c) + 1}`) })
    }
  })
})

// ---------------------------------------------------------------------------------------------------------
test.describe("DEC-006 VLAN tidak terdaftar (M7 §2.5c)", () => {
  test.afterEach(async ({ request }) => {
    await patchNetwork(request, CTRL02.id, staticNet({ [CTRL02.id]: "10.10.10.22" }))
  })

  test("VLAN 99: petunjuk teks utama (bukan muted), aturan subnet PXE (range DHCP, luar subnet), simpan vlan 99 → 200; VLAN 5000 invalid", async ({ page, request }) => {
    const sheet = await openSingle(page, CTRL02.name)
    const ip = sheet.locator("#net-ip")
    const vlan = sheet.locator("#net-vlan")
    const ipError = sheet.locator('[data-slot="field-error"]').first()
    const save = sheet.getByRole("button", { name: "Simpan konfigurasi" })

    await vlan.fill("99")
    const unreg = sheet.getByTestId("vlan-unregistered")
    await expect(unreg).toHaveText(
      "VLAN 99 tidak terdaftar di PXE_VLAN_NETWORKS; IP, prefix, dan gateway mengikuti subnet PXE 10.10.10.0/24.",
    )
    await expectNotMuted(unreg, "petunjuk VLAN tidak terdaftar")
    await expectMono(unreg.locator("span"), "PXE_VLAN_NETWORKS/CIDR di petunjuk")
    // Daftar VLAN terdaftar tetap tampil.
    await expect(sheet.getByTestId("vlan-registered")).toContainText("20 · 10.99.20.0/24")
    // Prefix/gateway tetap subnet PXE.
    await expect(sheet.locator("#net-prefix")).toHaveValue("24")
    await expect(sheet.locator("#net-gw")).toHaveValue("10.10.10.1")
    await expect(sheet.getByTestId("net-ip-hint")).toHaveText("Di dalam 10.10.10.0/24, di luar range dinamis 10.10.10.100–10.10.10.200.")

    await ip.fill("10.99.20.41")
    await expect(ipError).toHaveText("Di luar subnet 10.10.10.0/24")
    await expect(save).toBeDisabled()
    await ip.fill("10.10.10.150")
    await expect(ipError).toHaveText("Di dalam range DHCP dinamis 10.10.10.100–10.10.10.200")
    await expect(save).toBeDisabled()
    await page.screenshot({ path: SHOTS(7, "dec-006-vlan99-range") })

    // VLAN di luar 1–4094 → error field.
    await vlan.fill("5000")
    await expect(sheet.locator('[data-slot="field-error"]').filter({ hasText: "VLAN ID 1–4094" })).toBeVisible()
    await expect(vlan).toHaveAttribute("aria-invalid", "true")
    await expect(save).toBeDisabled()

    await vlan.fill("99")
    await ip.fill("10.10.10.46")
    await expect(sheet.locator('[data-slot="field-error"]')).toHaveCount(0)
    await expect(save).toBeEnabled()
    const req = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/api/hosts/${CTRL02.id}`))
    const res = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/hosts/${CTRL02.id}`))
    await save.click()
    const payload = (await req).postDataJSON()
    expect(payload.network).toMatchObject({ assignments: { [CTRL02.id]: "10.10.10.46" }, prefix: 24, gateway: "10.10.10.1", vlan: 99 })
    expect((await res).status()).toBe(200)
    await expect(sheet).toBeHidden()
    const after = await hostState(request, CTRL02.id)
    expect(after.host.mgmtIp).toBe("10.10.10.46")
    expect(after.config.network).toMatchObject({ ip: "10.10.10.46", vlan: 99, gateway: "10.10.10.1" })
  })
})

// ---------------------------------------------------------------------------------------------------------
test.describe("AC-7.11 bulk 3 host VLAN 20", () => {
  test.afterEach(async ({ request }) => {
    for (const h of BULK) await patchNetwork(request, h.id, { mode: "dhcp" })
  })

  test("range mulai 10.99.20.41: pratinjau .41/.43/.44 (.42 storage-02 dilewati), simpan → tersimpan identik dengan pratinjau", async ({ page, request }) => {
    const sheet = await openBulk(page)
    const preview = sheet.getByRole("table", { name: "Preview IP baru" })
    const rows = preview.locator("tbody tr")
    await expect(rows).toHaveCount(3)
    await sheet.locator("#net-vlan").fill("20")
    // Range default VLAN = .11 sampai sebelum broadcast; gateway VLAN terisi.
    await expect(sheet.locator("#net-start")).toHaveValue("10.99.20.11")
    await expect(sheet.locator("#net-end")).toHaveValue("10.99.20.254")
    await expect(sheet.locator("#net-gw")).toHaveValue("10.99.20.1")
    await expect(sheet.locator('label[for="net-skip"]')).toHaveText("Lewati IP yang sudah dipakai host lain atau lease aktif")

    await sheet.locator("#net-start").fill("10.99.20.41")
    await sheet.locator("#net-end").fill("10.99.20.60")
    await expect(rows.locator("td:nth-child(3) .type-data")).toHaveText(["10.99.20.41", "10.99.20.43", "10.99.20.44"])
    await expect(preview.locator('tbody tr[data-state="ok"]')).toHaveCount(3)
    await expectMono(rows.locator("td:nth-child(3) .type-data"), "IP pratinjau")
    await expectMono(rows.locator("td:nth-child(1)"), "MAC pratinjau")

    // Tanpa "lewati": .42 bentrok dengan storage-02 → baris error, simpan nonaktif.
    await sheet.locator("#net-skip").click()
    await expect(rows.locator("td:nth-child(3) .type-data")).toHaveText(["10.99.20.41", "10.99.20.42", "10.99.20.43"])
    await expect(rows.nth(1)).toHaveAttribute("data-state", "error")
    await expect(rows.nth(1)).toContainText("Bentrok dengan storage-02")
    await expectNotMuted(rows.nth(1).locator(".text-destructive"), "error baris pratinjau")
    await expect(sheet.getByRole("button", { name: "Simpan konfigurasi" })).toBeDisabled()
    await sheet.locator("#net-skip").click()
    await expect(rows.locator("td:nth-child(3) .type-data")).toHaveText(["10.99.20.41", "10.99.20.43", "10.99.20.44"])
    // Range di luar subnet VLAN → setiap baris error.
    await sheet.locator("#net-start").fill("10.10.10.41")
    await expect(preview.locator('tbody tr[data-state="error"]')).toHaveCount(3)
    await expect(rows.first()).toContainText("IP awal di luar subnet 10.99.20.0/24 (VLAN 20)")
    await sheet.locator("#net-start").fill("10.99.20.41")
    await expect(preview.locator('tbody tr[data-state="ok"]')).toHaveCount(3)
    await page.screenshot({ path: SHOTS(7, "ac-7.11-bulk-vlan20-preview") })

    // Pratinjau MAC → IP sesuai urutan baris.
    const plan: Record<string, string> = {}
    for (const r of await rows.all()) plan[(await r.getAttribute("data-host-id"))!] = (await r.locator("td:nth-child(3) .type-data").textContent())!.trim()
    expect(Object.keys(plan).sort()).toEqual(BULK.map((h) => h.id).sort())
    expect(Object.values(plan).sort()).toEqual(["10.99.20.41", "10.99.20.43", "10.99.20.44"])

    const req = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/hosts/bulk"))
    const res = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/hosts/bulk"))
    await sheet.getByRole("button", { name: "Simpan konfigurasi" }).click()
    const payload = (await req).postDataJSON()
    expect(payload.hostIds.slice().sort()).toEqual(BULK.map((h) => h.id).sort())
    expect(payload.network).toMatchObject({ mode: "static", prefix: 24, gateway: "10.99.20.1", vlan: 20, assignments: plan })
    expect((await res).status()).toBe(200)
    await expect(sheet).toBeHidden()
    for (const h of BULK) {
      const s = await hostState(request, h.id)
      expect(s.host.mgmtIp, h.mac).toBe(plan[h.id])
      expect(s.config.network, h.mac).toMatchObject({ mode: "static", ip: plan[h.id], vlan: 20, prefix: 24, gateway: "10.99.20.1" })
      await expect(rowByMac(page, h.mac).locator("td").nth(3)).toContainText(`mgmt ${plan[h.id]}`)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------
test.describe("M7 axe + lebar layar (Sheet VLAN, Settings)", () => {
  test.afterAll(() => writeAxeEvidence(path.resolve(__dirname, "../../.agent/runs/m7/axe-results-m7-vlan.json")))

  let found: Record<string, unknown> = {}
  async function expectClean(page: Page, label: string, include?: string) {
    const a = await auditA11y(page, label, { include })
    if (a.violations.length) found[label] = a.violations
  }
  function expectNoViolations() {
    const f = found
    found = {}
    expect(f, JSON.stringify(f, null, 1)).toEqual({})
  }

  test("/settings dengan VLAN: axe 0 pelanggaran (375/768/1280/1440)", async ({ page }) => {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto("/settings")
      await expect(page.getByTestId("settings-vlan")).toBeVisible()
      await settle(page)
      await expectNoOverflow(page, `/settings@${w}`)
      await expectClean(page, `m7 /settings vlan@${w}`)
    }
    expectNoViolations()
  })

  /**
   * Audit Sheet tanpa konten yang tertutup footer sticky (`bg-canvas-soft`): pada tinggi 900 sebagian isi
   * tab Network berada DI BELAKANG footer (tidak terlihat sama sekali), sehingga warna latar terhitung =
   * footer (#fafaf7) walau teks itu, saat di-scroll ke area baca, berada di atas latar putih Sheet. Tinggi
   * viewport dinaikkan sampai area scroll Sheet tidak lagi meluap vertikal (diasersi), lalu SELURUH Sheet
   * diaudit dengan filter yang sama (axe.ts tidak berubah). Lebar tetap `w`; tinggi dikembalikan ke 900.
   */
  async function auditSheetUnoccluded(page: Page, w: number, label: string) {
    const scroller = page.locator('[data-slot="sheet-content"] .overflow-y-auto').first()
    const need = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight)
    await page.setViewportSize({ width: w, height: 900 + Math.max(0, need) + 40 })
    await waitForLocatorAnimations(page.locator('[data-slot="sheet-content"]'))
    const after = await scroller.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }))
    expect(after.scroll, `${label}: isi Sheet terlihat utuh tanpa scroll`).toBeLessThanOrEqual(after.client + 1)
    await expectClean(page, label, '[data-slot="sheet-content"]')
    await page.setViewportSize({ width: w, height: 900 })
  }

  /** State Sheet satu host (storage-01, tanpa simpan): VLAN 20 valid, VLAN 20 invalid, VLAN 99. */
  const SINGLE_STATES = [
    { key: "vlan20-valid", vlan: "20", ip: "10.99.20.41", expectText: "Di dalam 10.99.20.0/24 (VLAN 20)." },
    { key: "vlan20-invalid", vlan: "20", ip: "10.99.10.41", expectText: "Di luar subnet 10.99.20.0/24 (VLAN 20)" },
    { key: "vlan99", vlan: "99", ip: "10.10.10.45", expectText: "VLAN 99 tidak terdaftar" },
  ]
  test("Sheet satu host VLAN (valid / invalid / tidak terdaftar): axe, tanpa overflow di 4 lebar", async ({ page }) => {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 })
      const sheet = await openSingle(page, STORAGE01.name)
      for (const s of SINGLE_STATES) {
        await sheet.locator("#net-vlan").fill(s.vlan)
        await sheet.locator("#net-ip").fill(s.ip)
        await expect(sheet.getByRole("tabpanel")).toContainText(s.expectText)
        await sheet.locator("#net-vlan").scrollIntoViewIfNeeded()
        await waitForLocatorAnimations(sheet)
        await expectNoOverflow(page, `sheet ${s.key}@${w}`)
        // Petunjuk VLAN tidak terpotong: tepi kanan di dalam Sheet.
        const hintBoxes = await sheet.locator('[data-slot="vlan-hint"], [data-testid="vlan-unregistered"]').evaluateAll((els) =>
          els.map((el) => ({ right: el.getBoundingClientRect().right, sheet: el.closest('[data-slot="sheet-content"]')!.getBoundingClientRect().right })),
        )
        for (const b of hintBoxes) expect(b.right, `sheet ${s.key}@${w}: petunjuk VLAN di dalam Sheet`).toBeLessThanOrEqual(b.sheet + 0.5)
        await page.screenshot({ path: SHOTS(7, `m7-sheet-single-${s.key}-${w}`) })
        await auditSheetUnoccluded(page, w, `m7 sheet single ${s.key}@${w}`)
      }
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)
    }
    expectNoViolations()
  })

  test("Sheet bulk VLAN 20 (pratinjau): axe, tanpa overflow di 4 lebar", async ({ page }) => {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 })
      const sheet = await openBulk(page)
      await sheet.locator("#net-vlan").fill("20")
      await sheet.locator("#net-start").fill("10.99.20.41")
      const preview = sheet.getByRole("table", { name: "Preview IP baru" })
      await expect(preview.locator('tbody tr[data-state="ok"]')).toHaveCount(3)
      await waitForLocatorAnimations(sheet)
      await expectNoOverflow(page, `sheet bulk@${w}`)
      await page.screenshot({ path: SHOTS(7, `m7-sheet-bulk-vlan20-${w}`) })
      await auditSheetUnoccluded(page, w, `m7 sheet bulk vlan20@${w}`)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)
      // Pilihan host dibatalkan (gotoHosts memuat ulang halaman).
    }
    expectNoViolations()
  })
})
