// Setup sesi E2E per server (M6-T12, plan §2.10, DEC-018 §3): login lewat UI /login dengan admin E2E
// (password acak per run) lalu simpan storageState ke `.e2e-data/run-*/state/<server>.json`. Project
// spec lama bergantung (`dependencies`) pada project setup server-nya. Tanpa bypass auth.
import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test as setup } from "@playwright/test"

import { E2E_ADMIN_USERNAME, e2eAdminPassword, storageStatePath } from "./support/e2e-auth"

setup("login admin E2E → storageState", async ({ page }, testInfo) => {
  const server = testInfo.project.name.replace(/^setup-/, "")
  await page.goto("/hosts")
  // Tanpa sesi: Proxy mengalihkan ke /login?next=/hosts.
  await expect(page).toHaveURL(/\/login\?next=%2Fhosts$/)
  await page.getByLabel("Username").fill(E2E_ADMIN_USERNAME)
  await page.getByLabel("Password").fill(e2eAdminPassword())
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/hosts$/)
  await expect(page.getByTestId("sidebar-username")).toHaveText(new RegExp(`${E2E_ADMIN_USERNAME}$`))
  const file = storageStatePath(server)
  mkdirSync(path.dirname(file), { recursive: true })
  const state = await page.context().storageState({ path: file })
  expect(state.cookies.filter((c) => c.name === "pxe_session")).toHaveLength(1)
})
