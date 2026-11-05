import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Tanpa `globals: true`, RTL tidak membersihkan DOM otomatis.
afterEach(() => {
  cleanup()
})
