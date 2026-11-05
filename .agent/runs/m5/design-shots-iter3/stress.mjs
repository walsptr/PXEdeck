// Image uji stres iter3 (independen dari fixture E2E): didaftarkan lewat API nyata di :3260.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
const B = "http://localhost:3260"
const MEDIA = "/home/syawal/Project/PXE-BOOT/.agent/wt-m5/dashboard/.e2e-data/design-m5-iter3/media"
export const IMAGES = [
  // 48 karakter dengan banyak titik pecah ("-"), media TIDAK ada -> alasan panjang
  { id: "ubuntu-24.04-custom-hwe-lab-rack07-node-image-02", name: "Ubuntu Server Custom HWE Lab Rack 07 Node Image Edisi Panjang 02", version: "24.04.5 LTS hwe-6.8", seg: "ubuntu-24.04-custom-hwe-lab-rack07-node-image-02-media-root-directory", media: false, bootable: true, method: "autoinstall" },
  // 48 karakter TANPA titik pecah (kasus terburuk wrap), media ADA -> "tersedia" sebaris
  { id: "rocky9customlabimagebuildnumber00000000000000001", name: "RockyLinuxCustomLabImageBuildNumberSatuTanpaSpasiSamaSekali", version: "9.4", seg: "rocky9customlabimagebuildnumber00000000000000001segmenpathtunggalyangpanjangsekalimelebihidelapanpuluhkarakter", media: true, bootable: true, method: "kickstart" },
  // 47 karakter, tidak bootable, media ada
  { id: "debian-12.7-bookworm-netinst-lab-cluster-b-arm", name: "Debian Bookworm Netinst Lab Cluster B", version: "12.7", seg: "debian-12.7-bookworm-netinst-lab-cluster-b-installer-amd64", media: true, bootable: false, method: "preseed" },
]
const mode = process.argv[2] ?? "add"
for (const x of IMAGES) {
  const source = { kernel: `${x.seg}/casper/hwe-vmlinuz-6.8.0-generic-panjang`, initrd: `${x.seg}/casper/hwe-initrd-6.8.0-generic-panjang`, repo: x.seg }
  if (mode === "add") {
    if (x.media) for (const f of [source.kernel, source.initrd]) { mkdirSync(path.dirname(path.join(MEDIA, f)), { recursive: true }); writeFileSync(path.join(MEDIA, f), "dummy\n") }
    const r = await fetch(B + "/api/os-images", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: x.id, name: x.name, version: x.version, arch: "amd64", method: x.method, bootable: x.bootable, source }) })
    console.log(x.id, x.id.length, r.status, (await r.text()).slice(0, 200))
  } else {
    const r = await fetch(B + "/api/os-images/" + x.id, { method: "DELETE" }); console.log("del", x.id, r.status)
  }
}
