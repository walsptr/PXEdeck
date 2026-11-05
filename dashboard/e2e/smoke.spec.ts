import { expect, test } from "@playwright/test"

// Smoke setup tooling (M1-T1): server build produksi hidup dan halaman Hosts ter-render.
test("halaman /hosts terbuka", async ({ page }) => {
  await page.goto("/hosts")
  await expect(page).toHaveTitle(/Hosts · PXE Lab/)
  await expect(page.getByRole("table")).toBeVisible()
})
