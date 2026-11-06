// M6 iterasi 2 (server `m6-ui-iter2`: seed m6-ui + host Failed dengan job failed; subnet KVM; media
// palsu tanpa Ubuntu 22.04). Gate M6 iter1 R1 (DR-6-1), R2 (DR-6-2), R3 (DR-6-3, DEC-022 §1),
// R7 (DR-6-5) dan DEC-022 §3 (DR-6-4, DR-6-6, DR-6-7, DR-6-8). DEC-017 §9: informasi penting (error,
// alasan Failed, label status) tidak boleh memakai `muted` (#807d72) — diukur dari warna komputasi.
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { AUTHORIZED_KEYS_MAX_BYTES, authorizedKeysBytes } from "../src/lib/host-config"
import { synthKeysTotal } from "../src/test/synth-keys"
import { ORANGE, SHOTS } from "./helpers"
import { auditA11y, writeAxeEvidence } from "./support/axe"
import { M6_FAILED_JOB, M6_LONG_HOSTNAME } from "./support/m6-seed"

const MUTED = "rgb(128, 125, 114)" // --muted-foreground #807d72
const BODY = "rgb(90, 88, 82)" // --body #5a5852
const DESTRUCTIVE = "rgb(207, 45, 86)" // --destructive #cf2d56
const MONO = /JetBrains Mono/
/** Ring fokus 3px oranye 40% (Chromium melaporkan `ring/40` sebagai oklab ≈ #f54e00 / 0.4). */
const RING_40 = /(rgba\(245, 78, 0, 0\.4\)|oklab\(0\.65\d* 0\.168\d* 0\.131\d* \/ 0\.4\)) 0px 0px 0px 3px/
const WIDTHS = [375, 414, 768, 800, 1024, 1279, 1280, 1440]

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState("networkidle").catch(() => {})
}

/** Warna komputasi elemen + semua turunan teksnya (span di dalam alasan juga tidak boleh muted). */
async function colorsOf(page: Page, selector: string) {
  return page.evaluate((sel) => {
    return [...document.querySelectorAll<HTMLElement>(sel)].map((el) => {
      const colors = new Set<string>([getComputedStyle(el).color])
      for (const d of el.querySelectorAll<HTMLElement>("*")) {
        if (d.closest("svg") || d.tagName.toLowerCase() === "svg") continue
        if ([...d.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())) colors.add(getComputedStyle(d).color)
      }
      return { text: el.textContent!.trim(), color: getComputedStyle(el).color, colors: [...colors] }
    })
  }, selector)
}

function expectNotMuted(items: { text: string; colors: string[] }[], label: string) {
  expect(items.length, `${label}: elemen ada`).toBeGreaterThan(0)
  for (const it of items) {
    expect(it.text, label).not.toBe("")
    expect(it.colors, `${label}: ${it.text}`).not.toContain(MUTED)
  }
}

test.describe("R1 / DR-6-1 alasan Failed dan pesan error tidak muted (DEC-017 §9)", () => {
  test("Jobs: job-row-failure = body di 375 dan 1440", async ({ page }) => {
    for (const w of [1440, 375]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto("/jobs")
      await expect(page.getByTestId("job-row-failure").first()).toBeVisible()
      const items = await colorsOf(page, '[data-testid="job-row-failure"]')
      expectNotMuted(items, `job-row-failure@${w}`)
      for (const it of items) expect(it.color).toBe(BODY)
    }
  })

  test("Hosts: host-failure-reason = body; Sheet: sheet-last-job-failure seluruh alasan tidak muted", async ({ page }) => {
    for (const w of [1440, 375]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto("/hosts")
      await settle(page)
      const reason = page.getByTestId("host-failure-reason")
      await expect(reason).toHaveCount(1)
      await expect(reason).toHaveAttribute("data-reason", "timeout-installing")
      const items = await colorsOf(page, '[data-testid="host-failure-reason"]')
      expectNotMuted(items, `host-failure-reason@${w}`)
      expect(items[0].color).toBe(BODY)
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole("button", { name: "Aksi untuk compute-03" }).click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    const note = page.getByRole("dialog").getByTestId("sheet-last-job-failure")
    await expect(note).toBeVisible()
    const items = await colorsOf(page, '[data-testid="sheet-last-job-failure"]')
    expectNotMuted(items, "sheet-last-job-failure")
    expect(items[0].color).toBe(BODY)
    // Prefix tetap destructive; teks alasan (bukan prefix) = body.
    expect(items[0].colors).toContain(DESTRUCTIVE)
    expect(items[0].colors).toContain(BODY)
    await page.screenshot({ path: SHOTS(6, "iter2-sheet-last-job-failure") })
  })

  test("Log viewer: 'Job tidak ditemukan — …' (SSE end deleted) tidak muted", async ({ page }) => {
    await page.route(`**/api/jobs/${M6_FAILED_JOB}/logs**`, (r) =>
      r.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
        body: 'event: end\ndata: {"status":"deleted"}\n\n',
      }),
    )
    await page.goto(`/jobs?job=${M6_FAILED_JOB}`)
    const msg = page.getByTestId("log-empty")
    await expect(msg).toHaveAttribute("data-state", "not-found")
    await expect(msg).toHaveText(/^Job tidak ditemukan — mungkin sudah dihapus/)
    expect(await msg.evaluate((e) => getComputedStyle(e).color)).toBe(BODY)
  })

  test("Log viewer: 'Sesi berakhir…' (SSE end session) tidak muted — diukur sebelum redirect login", async ({ page }) => {
    // Pesan tampil sesaat sebelum alur sesi habis mengalihkan ke /login: warna direkam oleh
    // MutationObserver saat elemen muncul dan disimpan di sessionStorage (bertahan antar navigasi).
    await page.addInitScript(() => {
      const grab = () => {
        const el = document.querySelector<HTMLElement>('[data-testid="log-empty"][data-state="session"]')
        if (el && !sessionStorage.getItem("iter2-session-msg"))
          sessionStorage.setItem("iter2-session-msg", JSON.stringify({ text: el.textContent, color: getComputedStyle(el).color }))
      }
      new MutationObserver(grab).observe(document, { subtree: true, childList: true, attributes: true })
    })
    await page.route(`**/api/jobs/${M6_FAILED_JOB}/logs**`, (r) =>
      r.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
        body: 'event: end\ndata: {"reason":"session"}\n\n',
      }),
    )
    await page.goto(`/jobs?job=${M6_FAILED_JOB}`)
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem("iter2-session-msg")).catch(() => null), { timeout: 15_000 })
      .not.toBeNull()
    const got = JSON.parse((await page.evaluate(() => sessionStorage.getItem("iter2-session-msg")))!) as { text: string; color: string }
    expect(got.text).toBe("Sesi berakhir. Masuk lagi untuk melihat log.")
    expect(got.color).not.toBe(MUTED)
    expect(got.color).toBe(BODY)
  })
})

test("R2 / DR-6-2 timeline: label tahap belum tercapai = body", async ({ page }) => {
  await page.goto(`/jobs?job=${M6_FAILED_JOB}`)
  await expect(page.getByTestId("job-timeline")).toBeVisible()
  const pending = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="timeline-step"][data-reached="false"] [data-slot="badge"]')].map((b) => ({
      text: b.textContent!.trim(),
      color: getComputedStyle(b).color,
    })),
  )
  expect(pending.map((p) => p.text)).toEqual(["Installing", "Configuring"])
  for (const p of pending) {
    expect(p.color, p.text).not.toBe(MUTED)
    expect(p.color, p.text).toBe(BODY)
  }
})

test.describe("R3 / DR-6-3 'Media … tidak tersedia' = body + ikon info, tidak merah (DEC-022 §1)", () => {
  for (const w of [1440, 768, 375]) {
    test(`/os-images @${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto("/os-images")
      await settle(page)
      const cells = page.locator('[data-testid="img-available"][data-available="false"]:visible')
      await expect(cells.first()).toBeVisible()
      const m = await cells.evaluateAll((els) =>
        els.map((el) => ({
          text: el.textContent!.trim(),
          color: getComputedStyle(el).color,
          icon: Boolean(el.querySelector("svg")),
          reasonColors: [...el.querySelectorAll<HTMLElement>("*")]
            .filter((d) => !d.closest("svg") && [...d.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()))
            .map((d) => getComputedStyle(d).color),
        })),
      )
      expect(m.length).toBeGreaterThan(0)
      // Alasan "Media … tidak tersedia" (Ubuntu 22.04 tanpa media) ada; semua alasan tidak tersedia
      // (termasuk Windows "hanya generator") mengikuti aturan yang sama.
      expect(m.some((c) => /^Media .* tidak tersedia/.test(c.text)), JSON.stringify(m.map((c) => c.text))).toBe(true)
      for (const c of m) {
        expect(c.color).toBe(BODY)
        expect(c.icon).toBe(true)
        expect(c.reasonColors).not.toContain(MUTED)
        expect(c.reasonColors).not.toContain(DESTRUCTIVE)
      }
    })
  }

  test("Sheet tab OS: catatan kartu image tidak tersedia = body + ikon, tidak merah", async ({ page }) => {
    await page.goto("/hosts")
    await page.getByRole("button", { name: "Aksi untuk node01" }).click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    const dialog = page.getByRole("dialog")
    const card = dialog.locator('[data-slot="field"][data-available="false"]').first()
    await expect(card).toBeVisible()
    const note = card.getByTestId("os-option-note")
    await expect(note).toContainText(/tidak tersedia/)
    const m = await note.evaluate((el) => ({ color: getComputedStyle(el).color, icon: Boolean(el.querySelector("svg")) }))
    expect(m.color).not.toBe(MUTED)
    expect(m.color).not.toBe(DESTRUCTIVE)
    expect(m.color).toBe(BODY)
    expect(m.icon).toBe(true)
  })
})

test.describe("R7 / DR-6-5 status server tidak hanya warna (WCAG 1.4.1); nama layanan terlihat", () => {
  const body = {
    services: [
      { name: "DHCP", state: "online", online: true, detail: "dnsmasq aktif" },
      { name: "TFTP", state: "offline", online: false, detail: "file hilang" },
      { name: "HTTP", state: "unknown", online: false, detail: "media tidak ada" },
    ],
    checkedAt: "2026-11-06T10:00:00.000Z",
  }

  for (const w of WIDTHS) {
    test(`@${w}: glyph berbeda per state, nama DHCP/TFTP/HTTP terlihat, tanpa overflow`, async ({ page }) => {
      await page.route("**/api/server-status", (r) => r.fulfill({ json: body, headers: { "cache-control": "no-store" } }))
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto("/hosts")
      await settle(page)
      const group = page.locator("header").getByRole("group", { name: "Status server PXE" })
      await expect(group.locator('[data-service="TFTP"]')).toHaveAttribute("data-state", "offline")
      const m = await page.evaluate(() => {
        const vw = window.innerWidth
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect()
          const cs = getComputedStyle(el)
          return (
            r.width > 2 && r.height > 2 && r.left >= 0 && r.right <= vw && cs.visibility !== "hidden" && cs.clipPath === "none" && cs.clip === "auto" && cs.position !== "absolute"
          )
        }
        return {
          doc: document.documentElement.scrollWidth,
          vw,
          badges: [...document.querySelectorAll<HTMLElement>("header [data-service]")].map((b) => {
            const name = b.querySelector('[data-slot="service-name"]')
            const glyph = b.querySelector('[data-slot="status-dot"] svg')
            return {
              service: b.dataset.service,
              state: b.dataset.state,
              nameText: name?.textContent ?? null,
              nameVisible: name ? visible(name) : false,
              glyph: glyph?.innerHTML ?? null,
              glyphVisible: glyph ? visible(glyph) : false,
            }
          }),
        }
      })
      expect(m.doc).toBe(m.vw)
      expect(m.badges.map((b) => [b.service, b.state])).toEqual([
        ["DHCP", "online"],
        ["TFTP", "offline"],
        ["HTTP", "unknown"],
      ])
      for (const b of m.badges) {
        expect(b.nameText).toBe(b.service)
        expect(b.nameVisible, `${b.service} nama terlihat`).toBe(true)
        expect(b.glyphVisible, `${b.service} glyph terlihat`).toBe(true)
      }
      // Penanda non-warna: bentuk glyph berbeda untuk ketiga state.
      expect(new Set(m.badges.map((b) => b.glyph)).size).toBe(3)
      if (w === 375 || w === 1440) await group.screenshot({ path: SHOTS(6, `iter2-server-status-${w}`) })
    })
  }
})

test("DR-6-4 fokus input: border ring + ring ≥ 40% (login, keyboard)", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, locale: "id-ID", storageState: { cookies: [], origins: [] } })
  const page = await ctx.newPage()
  await page.goto("/login")
  await page.mouse.click(2, 2)
  await page.keyboard.press("Tab")
  const user = page.getByLabel("Username")
  await expect(user).toBeFocused()
  await page.waitForTimeout(250) // transisi warna border
  const u = await user.evaluate((e) => ({ border: getComputedStyle(e).borderTopColor, shadow: getComputedStyle(e).boxShadow }))
  expect(u.border).toBe(ORANGE)
  expect(u.shadow).toMatch(RING_40)
  await page.keyboard.press("Tab")
  await expect(page.getByLabel("Password")).toBeFocused()
  await page.waitForTimeout(250)
  const g = await page.locator('[data-slot="input-group"]').first().evaluate((e) => ({ border: getComputedStyle(e).borderTopColor, shadow: getComputedStyle(e).boxShadow }))
  expect(g.border).toBe(ORANGE)
  expect(g.shadow).toMatch(RING_40)
  await ctx.close()
})

test("DR-6-6 hostname 63 karakter dipotong 24ch + title; kolom Status tidak terdorong ke scroll tabel di 1440", async ({ page }) => {
  await page.goto("/hosts")
  await settle(page)
  const cell = page.getByTestId("host-hostname").filter({ hasText: M6_LONG_HOSTNAME })
  await expect(cell).toHaveAttribute("title", M6_LONG_HOSTNAME)
  await expect(cell).toHaveText(M6_LONG_HOSTNAME)
  const m = await cell.evaluate((e) => {
    const cs = getComputedStyle(e)
    // Lebar 24ch diukur dengan font elemen itu sendiri.
    const probe = document.createElement("span")
    probe.style.cssText = `position:absolute;visibility:hidden;width:24ch;font:${cs.font}`
    document.body.appendChild(probe)
    const w24 = probe.getBoundingClientRect().width
    probe.remove()
    const table = e.closest("table")!
    const container = table.parentElement!
    const status = [...table.querySelectorAll("thead th")].find((th) => th.textContent!.trim().startsWith("Status"))!
    return {
      width: e.getBoundingClientRect().width,
      maxCh: w24 + 0.5,
      truncated: e.scrollWidth > e.clientWidth,
      overflow: cs.textOverflow,
      font: cs.fontFamily,
      tableW: table.getBoundingClientRect().width,
      statusRight: status.getBoundingClientRect().right,
      containerRight: container.getBoundingClientRect().right,
    }
  })
  expect(m.width).toBeLessThanOrEqual(m.maxCh)
  expect(m.truncated).toBe(true)
  expect(m.overflow).toBe("ellipsis")
  expect(m.font).toMatch(MONO)
  // Sebelumnya tabel 1795 px di 1440 (kolom Hostname tak terbatas, STATUS terdorong ke scroll tabel).
  // Sekarang kolom Status utuh di area terlihat; lebar tabel turun ≤ 1250 px.
  expect(m.statusRight).toBeLessThanOrEqual(m.containerRight)
  expect(m.tableW).toBeLessThanOrEqual(1250)
})

test("DR-6-7 'Di luar subnet …': CIDR mono, teks pesan tetap", async ({ page }) => {
  await page.goto("/hosts")
  await page.getByRole("button", { name: "Aksi untuk node01" }).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  const sheet = page.getByRole("dialog", { name: /Konfigurasi node01/ })
  await sheet.getByRole("tab", { name: /^Network/ }).click()
  await sheet.locator("#net-ip").fill("10.10.10.5")
  const err = sheet.locator('[data-slot="field-error"]').first()
  await expect(err).toHaveText("Di luar subnet 10.99.0.0/24")
  const tok = err.locator('[data-slot="ip-token"]')
  await expect(tok).toHaveText("10.99.0.0/24")
  expect(await tok.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(MONO)
  expect(await err.evaluate((e) => getComputedStyle(e).fontFamily)).not.toMatch(MONO)
})

test("DR-6-8 /jobs?job=<tidak ada>: deskripsi tidak mengulang judul", async ({ page }) => {
  await page.goto("/jobs?job=job-tidak-ada-iter2")
  const err = page.getByTestId("job-detail-error")
  await expect(err.locator('[data-slot="alert-title"]')).toHaveText("Job tidak ditemukan")
  const desc = page.getByTestId("job-detail-error-description")
  await expect(desc).toHaveText("Mungkin sudah dihapus oleh retensi riwayat atau host dihapus.")
  await expect(desc).not.toContainText("Job tidak ditemukan")
})

test("CR-6-9 / CR-6-1 batas total authorized_keys 32 KiB tampil di tab SSH Sheet; config host tidak berubah", async ({ page }) => {
  // Key SINTETIS (synth-keys.ts, bukan key sungguhan). Total = batas + 1 byte (tanpa key library);
  // key library yang sudah terpilih di host ikut dihitung server, jadi total yang dilaporkan ≥ 32769.
  const keys = synthKeysTotal(AUTHORIZED_KEYS_MAX_BYTES + 1, 12_000)
  expect(authorizedKeysBytes(keys)).toBe(AUTHORIZED_KEYS_MAX_BYTES + 1)
  expect(keys.length).toBeGreaterThan(1)
  const HOST = "ac1f6b227d40" // compute-03 (seed demo)
  const snapshot = async () => ({
    host: await (await page.request.get(`/api/hosts/${HOST}`)).json(),
    config: await (await page.request.get(`/api/hosts/${HOST}/config`)).json(),
    library: await (await page.request.get("/api/ssh-keys")).json(),
  })
  const before = await snapshot()
  expect(before.host.hostname).toBe("compute-03")

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/hosts")
  await settle(page)
  await page.getByRole("button", { name: "Aksi untuk compute-03" }).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  const sheet = page.getByRole("dialog")
  await sheet.getByRole("tab", { name: /^SSH Keys/ }).click()
  for (const [i, k] of keys.entries()) {
    await sheet.getByRole("button", { name: "Tempel / unggah key baru" }).click()
    await sheet.locator(`#key-${i}`).fill(k)
    const lib = sheet.locator(`#key-save-${i}`)
    if ((await lib.getAttribute("aria-checked")) === "true" || (await lib.getAttribute("data-state")) === "checked") await lib.click()
    await expect(sheet.locator(`#key-${i}`)).not.toHaveAttribute("aria-invalid", "true")
  }
  await sheet.getByRole("tab", { name: /^OS/ }).click() // server harus membawa kembali ke tab SSH
  const res = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/hosts/${HOST}`))
  await sheet.getByRole("button", { name: "Simpan konfigurasi" }).click()
  const resp = await res
  expect(resp.status()).toBe(422)
  const body = await resp.json()
  const sshErr = (body.errors as { section: string; message: string }[]).find((e) => e.section === "ssh" && /melebihi batas/.test(e.message))
  expect(sshErr, JSON.stringify(body)).toBeTruthy()
  const reported = Number(/^Total SSH key (\d+) byte/.exec(sshErr!.message)?.[1])
  expect(reported).toBeGreaterThanOrEqual(AUTHORIZED_KEYS_MAX_BYTES + 1)

  await expect(sheet.getByRole("tab", { name: /^SSH Keys/ })).toHaveAttribute("aria-selected", "true")
  await expect(sheet.getByRole("tab", { name: /^SSH Keys/ })).toContainText("(ada error)")
  const alert = sheet.getByRole("tabpanel").getByRole("alert").filter({ hasText: "Ditolak server" })
  await expect(alert).toContainText(
    new RegExp(`Total SSH key ${reported} byte melebihi batas 32768 byte \\(32 KiB\\) per host — kurangi jumlah key`),
  )
  await expect(page.getByText("Konfigurasi ditolak server")).toBeVisible()
  await page.screenshot({ path: SHOTS(6, "iter2-cr-6-9-ssh-byte-cap") })

  // Tanpa efek: host, config dan library SSH identik dengan sebelum Simpan.
  expect(await snapshot()).toEqual(before)
})

test.describe("axe (filter tidak berubah) pada halaman yang diubah", () => {
  test.afterAll(() => writeAxeEvidence(path.resolve(__dirname, "../../.agent/runs/m6/axe-results-iter2-ui.json")))

  for (const [label, url] of [
    ["/hosts", "/hosts"],
    ["/jobs", "/jobs"],
    ["/jobs detail", `/jobs?job=${M6_FAILED_JOB}`],
    ["/jobs 404", "/jobs?job=job-tidak-ada-iter2"],
    ["/os-images", "/os-images"],
  ] as const) {
    test(`${label} 1440 & 375`, async ({ page }) => {
      const found: Record<string, unknown> = {}
      for (const w of [1440, 375]) {
        await page.setViewportSize({ width: w, height: 900 })
        await page.goto(url)
        await settle(page)
        const a = await auditA11y(page, `iter2 ${label}@${w}`)
        if (a.violations.length) found[`${label}@${w}`] = a.violations
      }
      expect(found, JSON.stringify(found, null, 1)).toEqual({})
    })
  }
})
