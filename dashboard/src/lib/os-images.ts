// Tahap 2: katalog statis. Tahap 4 diganti dengan tabel os_images (GET /api/os-images).
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
    id: "ubuntu-24.04.5",
    name: "Ubuntu Server",
    version: "24.04.5 LTS",
    arch: "amd64",
    method: "autoinstall",
  },
  {
    id: "ubuntu-22.04.5",
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
    id: "rocky-9.4",
    name: "Rocky Linux",
    version: "9.4",
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

export function osLabel(id: string | null | undefined): string | null {
  if (!id) return null
  const img = OS_IMAGES.find((i) => i.id === id)
  return img ? `${img.name} ${img.version}` : id
}
