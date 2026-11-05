import {
  ComputerIcon,
  DiscIcon,
  Key01Icon,
  Settings01Icon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons"

export const NAV_ITEMS = [
  {
    href: "/hosts",
    label: "Hosts",
    icon: ComputerIcon,
    description: "Host yang boot lewat jaringan dan status provisioning-nya.",
  },
  {
    href: "/os-images",
    label: "OS Images",
    icon: DiscIcon,
    description: "Image installer yang bisa ditugaskan ke host.",
  },
  {
    href: "/ssh-keys",
    label: "SSH Keys",
    icon: Key01Icon,
    description: "Library public key untuk di-inject ke host.",
  },
  {
    href: "/jobs",
    label: "Provisioning Jobs",
    icon: WorkflowSquare01Icon,
    description: "Riwayat instalasi per host beserta tahapan dan log.",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings01Icon,
    description: "Konfigurasi server PXE.",
  },
] as const

export type NavItem = (typeof NAV_ITEMS)[number]

export function navItemFor(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
  )
}
