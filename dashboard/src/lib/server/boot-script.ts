// Script iPXE (M4-T3). Fungsi murni: semua nilai dinamis (URL, path, token,
// argumen kernel) sudah divalidasi pemanggil/settings dan hanya memakai
// karakter aman untuk iPXE (tanpa spasi tak terduga, `$`, baris baru).
import type { InstallMethod } from "@/lib/os-images"

export const IPXE_HEADER = "#!ipxe"

/** Batas iterasi loop tunggu `PXE_UNKNOWN_HOST_ACTION=wait`. */
export const WAIT_MAX_ITERATIONS = 20
export const ENTRY_RETRIES = 3

const SAFE_RE = /^[A-Za-z0-9_.,:/=@+%?&;-]*$/

/** Pastikan nilai aman disisipkan ke script iPXE (tanpa `$`, spasi, newline). */
export function ipxeSafe(v: string, what: string): string {
  if (!SAFE_RE.test(v)) throw new Error(`Nilai ${what} tidak aman untuk script iPXE`)
  return v
}

function lines(...ls: string[]): string {
  return [IPXE_HEADER, ...ls, ""].join("\n")
}

/**
 * Keluar dari iPXE agar firmware lanjut ke opsi boot berikutnya (disk).
 * Status WAJIB ≠ 0 (B-4): `exit` tanpa argumen = 0 → snponly.efi kembali
 * `EFI_SUCCESS`, dan BdsDxe OVMF/EDK2 lalu berhenti memproses BootOrder dan
 * membuka menu boot manager (spesifikasi UEFI §3.1.1), sehingga entri disk
 * tidak pernah dicoba. Status gagal → BDS mencoba Boot#### berikutnya. BIOS
 * (ROM iPXE / undionly) tidak memakai status ini: BIOS lanjut ke perangkat
 * berikutnya apa pun nilainya.
 */
export const IPXE_EXIT_TO_NEXT = "exit 1"

/**
 * `GET /boot/entry.ipxe`: chain ke script per-MAC dengan retry terbatas,
 * lalu exit (boot lokal) bila dashboard tidak bisa dihubungi. `--replace`:
 * script per-MAC menggantikan script ini, sehingga `exit 1` dari script boot
 * lokal langsung kembali ke firmware (tanpa dianggap gagal-unduh lalu
 * di-retry) dan keberhasilan chain tidak jatuh ke label retry berikutnya.
 */
export function entryScript(baseUrl: string): string {
  const url = `${ipxeSafe(baseUrl, "base URL")}/boot/\${mac}.ipxe?platform=\${platform}`
  const out: string[] = []
  for (let i = 1; i <= ENTRY_RETRIES; i++) {
    out.push(`:try${i}`)
    if (i > 1) out.push("sleep 5")
    out.push(
      `chain --replace --autofree ${url} || goto ${i < ENTRY_RETRIES ? `try${i + 1}` : "fail"}`,
    )
  }
  out.push(":fail", "echo PXE dashboard tidak dapat dihubungi, boot lokal", IPXE_EXIT_TO_NEXT)
  return lines(...out)
}

/**
 * Boot lokal: EFI → `exit 1` ke opsi boot berikutnya (disk, lihat
 * `IPXE_EXIT_TO_NEXT`); BIOS → sanboot disk pertama, gagal → exit.
 */
export function localBootScript(): string {
  return lines(
    "echo Tidak ada instalasi aktif: boot dari disk lokal",
    `iseq \${platform} efi && ${IPXE_EXIT_TO_NEXT} ||`,
    `sanboot --no-describe --drive 0x80 || ${IPXE_EXIT_TO_NEXT}`,
  )
}

/**
 * Loop tunggu untuk host tanpa OS (`PXE_UNKNOWN_HOST_ACTION=wait`): sleep 30
 * lalu chain ulang dengan `wait=<n+1>`; setelah batas → boot lokal.
 */
export function waitScript(baseUrl: string, mac: string, iteration: number): string {
  if (iteration >= WAIT_MAX_ITERATIONS) return localBootScript()
  const next = `${ipxeSafe(baseUrl, "base URL")}/boot/${ipxeSafe(mac, "MAC")}.ipxe?platform=\${platform}&wait=${iteration + 1}`
  return lines(
    `echo Menunggu tugas instalasi (${iteration + 1}/${WAIT_MAX_ITERATIONS})`,
    "sleep 30",
    // CR-4-5: `--replace` seperti entry.ipxe → `exit 1` script berikutnya langsung ke firmware.
    `chain --replace --autofree ${next} || ${IPXE_EXIT_TO_NEXT}`,
  )
}

export type InstallerScriptInput = {
  method: InstallMethod
  /** URL media (PXE_MEDIA_URL) tanpa "/" di akhir. */
  mediaUrl: string
  /** Path media di server (PXE_MEDIA_ROOT), untuk nfsroot Ubuntu. */
  mediaRoot: string
  serverIp: string
  /** Prefix konfigurasi: `${base}/boot/{mac}/{token}/` (diakhiri "/"). */
  configUrl: string
  source: { kernel: string; initrd: string; repo: string }
  extraArgs: string
}

/** Script installer per OS (docs/design/M4-plan.md §2.3). */
export function installerScript(i: InstallerScriptInput): string {
  const m = ipxeSafe(i.mediaUrl, "media URL")
  const c = ipxeSafe(i.configUrl, "config URL")
  const kernel = `${m}/${ipxeSafe(i.source.kernel, "kernel")}`
  const initrd = `${m}/${ipxeSafe(i.source.initrd, "initrd")}`
  const repo = ipxeSafe(i.source.repo, "repo")
  const x = i.extraArgs
    .split(/\s+/)
    .filter(Boolean)
    .map((a) => ipxeSafe(a, "argumen kernel"))
  const args = (...a: string[]) => [...a, ...x].join(" ")
  let cmdline: string
  switch (i.method) {
    case "autoinstall":
      // Tidak pernah `url=` (ISO ke RAM, README §10 / O6): root live via NFS.
      cmdline = args(
        "initrd=initrd",
        "ip=dhcp",
        "netboot=nfs",
        `nfsroot=${ipxeSafe(i.serverIp, "server IP")}:${ipxeSafe(i.mediaRoot, "media root")}/${repo}`,
        "autoinstall",
        `ds=nocloud-net;s=${c}`,
        "cloud-config-url=/dev/null",
      )
      return lines(
        `kernel ${kernel} ${cmdline} ---`,
        `initrd --name initrd ${initrd}`,
        "boot",
      )
    case "preseed":
      // SR-4-6 (M6): ` ---` di akhir. d-i menyalin parameter SETELAH `---` ke bootloader sistem
      // terpasang; semua parameter (termasuk `url=…/<token>/preseed.cfg`) berada sebelum `---`
      // sehingga URL ber-token tidak tertulis ke GRUB target.
      // DEC-025 §1: `netcfg/no_default_route=true` selalu dikirim. DHCP VLAN PXE sengaja tanpa
      // router (DEC-024 §3); tanpa jawaban ini netcfg menanyakan "Continue without a default route?"
      // (prioritas critical, sebelum preseed.cfg diambil) dan instalasi macet. netcfg hanya
      // membaca template ini bila DHCP TIDAK memberi gateway, jadi topologi flat (ada router) tidak
      // berubah perilakunya.
      cmdline = `${args(
        "initrd=initrd",
        "auto=true",
        "priority=critical",
        `url=${c}preseed.cfg`,
        "interface=auto",
        "netcfg/dhcp_timeout=60",
        "netcfg/no_default_route=true",
      )} ---`
      break
    case "kickstart":
      // DEC-020 (BUG-M6-4): stage2 (`images/install.img` ±1,2 GB) di-mount lewat NFS read-only dari
      // server (seperti root live Ubuntu, DEC-009), bukan diunduh dracut ke RAM (node 2 GB habis).
      // Repo paket = `url` di kickstart (HTTP); kickstart tetap HTTP per-MAC (`inst.ks=`).
      // BUG-M6-7: console serial (`console=ttyS*`) dipindah ke AKHIR — console terakhir menjadi
      // /dev/console, tempat anaconda mode cmdline menulis pesan/error (bukti di log serial).
      cmdline = [
        "initrd=initrd",
        "ip=dhcp",
        `inst.stage2=nfs:${ipxeSafe(i.serverIp, "server IP")}:${ipxeSafe(i.mediaRoot, "media root")}/${repo}`,
        `inst.ks=${c}ks.cfg`,
        "inst.cmdline", // BUG-M6-5: non-interaktif (selaras `cmdline` di kickstart; mode boot diutamakan anaconda)
        ...x.filter((a) => !/^console=ttyS/.test(a)),
        ...x.filter((a) => /^console=ttyS/.test(a)),
      ].join(" ")
      break
    default:
      throw new Error(`Metode ${i.method} tidak bisa di-boot via iPXE`)
  }
  return lines(`kernel ${kernel} ${cmdline}`, `initrd --name initrd ${initrd}`, "boot")
}
