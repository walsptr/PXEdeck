import { defineConfig } from "vitest/config"

// Tooling & cakupan coverage mengikuti DEC-004. Mengubah ambang, include, atau exclude di file
// ini butuh decision baru (gatekeeper memperlakukan perubahan diam-diam sebagai pelemahan test).
export default defineConfig({
  resolve: {
    // Alias `@/*` dari tsconfig.json.
    tsconfigPaths: true,
  },
  test: {
    // CR-1-1: `.only` tidak boleh lolos diam-diam (lokal maupun CI).
    allowOnly: false,
    // Dua lingkungan: DOM (jsdom) untuk komponen `.tsx` dan hook; node untuk sisanya
    // (lib, route handler, server).
    projects: [
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx", "src/hooks/**/*.test.ts"],
          setupFiles: ["./vitest.setup.dom.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/hooks/**"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "json-summary", "html"],
      include: [
        "src/lib/**",
        "src/app/api/**",
        "src/app/boot/**", // mulai M4
        "src/hooks/**",
        // Hanya logika non-JSX di components; komponen view .tsx dibuktikan per AC lewat E2E.
        "src/components/**/*.ts",
      ],
      exclude: [
        // Vendor shadcn; restyle diuji lewat AC-1.x / E2E.
        "src/components/ui/**",
        // Deklarasi tipe tidak punya kode runtime.
        "**/*.d.ts",
        // File test bukan kode produk.
        "**/*.test.ts",
        "**/*.test.tsx",
      ],
      thresholds: {
        lines: 80,
        branches: 80,
      },
    },
  },
})
