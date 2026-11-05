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
 * `GET /boot/entry.ipxe`: chain ke script per-MAC dengan retry terbatas,
 * lalu exit (boot lokal) bila dashboard tidak bisa dihubungi.
 */
export function entryScript(baseUrl: string): string {
  const url = `${ipxeSafe(baseUrl, "base URL")}/boot/\${mac}.ipxe?platform=\${platform}`
  const out: string[] = []
  for (let i = 1; i <= ENTRY_RETRIES; i++) {
    out.push(`:try${i}`)
    if (i > 1) out.push("sleep 5")
    out.push(
      `chain --autofree ${url} || goto ${i < ENTRY_RETRIES ? `try${i + 1}` : "fail"}`,
    )
  }
  out.push(":fail", "echo PXE dashboard tidak dapat dihubungi, boot lokal", "exit")
  return lines(...out)
}

/** Boot lokal: EFI → exit ke opsi boot berikutnya; BIOS → sanboot disk pertama. */
export function localBootScript(): string {
  return lines(
    "echo Tidak ada instalasi aktif: boot dari disk lokal",
    "iseq ${platform} efi && exit ||",
    "sanboot --no-describe --drive 0x80 || exit",
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
    `chain --autofree ${next} || exit`,
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
      cmdline = args(
        "initrd=initrd",
        "auto=true",
        "priority=critical",
        `url=${c}preseed.cfg`,
        "interface=auto",
        "netcfg/dhcp_timeout=60",
      )
      break
    case "kickstart":
      cmdline = args(
        "initrd=initrd",
        "ip=dhcp",
        `inst.repo=${m}/${repo}`,
        `inst.ks=${c}ks.cfg`,
        "inst.text",
      )
      break
    default:
      throw new Error(`Metode ${i.method} tidak bisa di-boot via iPXE`)
  }
  return lines(`kernel ${kernel} ${cmdline}`, `initrd --name initrd ${initrd}`, "boot")
}
