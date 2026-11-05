// Katalog OS image bawaan (dipakai label di UI dan seed tabel `os_images`).
// Sumber kebenaran di server = tabel `os_images` (`GET /api/os-images`,
// termasuk ketersediaan media). Id lama M2/M3 (`ubuntu-24.04.5`,
// `rocky-9.4`, …) dipetakan ke id kanonik lewat `canonicalOsImageId`.
export type InstallMethod = "autoinstall" | "kickstart" | "preseed" | "unattend"

export type OsImage = {
  id: string
  name: string
  version: string
  arch: "amd64" | "arm64"
  method: InstallMethod
}

export const OS_IMAGES: OsImage[] = [
  {
    id: "ubuntu-24.04",
    name: "Ubuntu Server",
    version: "24.04.5 LTS",
    arch: "amd64",
    method: "autoinstall",
  },
  {
    id: "ubuntu-22.04",
    name: "Ubuntu Server",
    version: "22.04.5 LTS",
    arch: "amd64",
    method: "autoinstall",
  },
  {
    id: "debian-12",
    name: "Debian",
    version: "12 (bookworm)",
    arch: "amd64",
    method: "preseed",
  },
  {
    id: "rocky-9",
    name: "Rocky Linux",
    version: "9",
    arch: "amd64",
    method: "kickstart",
  },
  {
    id: "windows-2022",
    name: "Windows Server",
    version: "2022",
    arch: "amd64",
    method: "unattend",
  },
]

/** Id OS image lama (M2/M3) → id kanonik M4. */
export const LEGACY_OS_IMAGE_IDS: Readonly<Record<string, string>> = {
  "ubuntu-24.04.5": "ubuntu-24.04",
  "ubuntu-22.04.5": "ubuntu-22.04",
  "rocky-9.4": "rocky-9",
}

export function canonicalOsImageId(id: string): string {
  return LEGACY_OS_IMAGE_IDS[id] ?? id
}

export function osLabel(id: string | null | undefined): string | null {
  if (!id) return null
  const img = OS_IMAGES.find((i) => i.id === canonicalOsImageId(id))
  return img ? `${img.name} ${img.version}` : id
}
