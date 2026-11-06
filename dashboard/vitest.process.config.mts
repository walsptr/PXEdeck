import { defineConfig } from "vitest/config"

// Uji level proses (M6-T11, plan §2.9, SR-5-10 / SR-5-4 / O3): menjalankan build standalone
// (`.next/standalone/server.js`, bentuk yang di-deploy ke VM) sebagai proses terpisah dengan env buruk/baik.
// Config terpisah dari `vitest.config.mts` (DEC-004, coverage) karena butuh `next build` dan proses
// anak; tidak mengubah include/exclude/ambang coverage suite unit. Dijalankan `npm run test:process`.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    name: "process",
    environment: "node",
    include: ["test/process/**/*.test.ts"],
    allowOnly: false,
    globalSetup: ["./test/process/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 600_000,
    // Satu server per test, port berbeda; berurutan agar waktu start terukur stabil.
    fileParallelism: false,
  },
})
