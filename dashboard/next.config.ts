import type { NextConfig } from "next";

/**
 * `PXE_STANDALONE=1` → build `output: "standalone"` untuk deploy ke VM server
 * (`infra/deploy-dashboard.sh`, M4-T7). Tanpa env ini konfigurasi tidak berubah
 * sehingga `next dev`/`next start` (E2E M1–M3) tetap sama (risiko R12).
 * Root tracing dikunci ke folder dashboard agar `server.js` berada di akar
 * `.next/standalone/` (bukan bersarang mengikuti path worktree/repo).
 */
const standalone = process.env.PXE_STANDALONE === "1";

const nextConfig: NextConfig = {
  /* config options here */
  ...(standalone
    ? { output: "standalone" as const, outputFileTracingRoot: __dirname }
    : {}),
  cacheComponents: true,
  async redirects() {
    return [{ source: "/", destination: "/hosts", permanent: false }]
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
