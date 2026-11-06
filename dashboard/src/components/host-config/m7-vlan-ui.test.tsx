// M7-T6 (§2.5c): tab Network VLAN-aware dan blok Settings "VLAN management" (sisi komponen
// AC-7.10–7.12; E2E oleh test-engineer di M7-T8).
import { fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { initialForm, type Context, type FormNetwork, type NetForm } from "@/components/host-config/form-state"
import { TabNetwork } from "@/components/host-config/tab-network"
import { SettingsView, VlanNetworksCard } from "@/components/settings/settings-view"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SETTINGS_KEY, type SettingsResponse } from "@/hooks/use-settings"
import type { VlanNetwork } from "@/lib/net"
import type { Host } from "@/lib/types"

const V20: VlanNetwork = { vlan: 20, cidr: "10.99.20.0/24", prefix: 24, gateway: "10.99.20.1" }
const V30: VlanNetwork = { vlan: 30, cidr: "10.30.0.0/16", prefix: 16, gateway: "10.30.0.1" }
const MGMT = {
  cidr: "10.99.0.0/24",
  gateway: "10.99.0.1",
  dns: ["10.99.0.2"],
  pxeServer: "10.99.0.2",
  dynamicRange: ["10.99.0.100", "10.99.0.200"] as const,
}

function host(id: string, mac: string): Host {
  return {
    id,
    mac,
    hostname: null,
    currentIp: null,
    mgmtIp: null,
    vendor: null,
    firmware: "uefi",
    osInstalled: null,
    osAssigned: null,
    status: "discovered",
    statusSince: "2026-11-06T10:00:00.000Z",
    lastSeen: "2026-11-06T10:00:00.000Z",
  }
}
const HOSTS = [host("n1", "52:54:00:99:00:41"), host("n2", "52:54:00:99:00:42"), host("n3", "52:54:00:99:00:43")]

function Harness({ hosts, net }: { hosts: Host[]; net: FormNetwork }) {
  const [value, setValue] = React.useState<NetForm>(() => initialForm(hosts, undefined, net).network)
  const ctx: Context = { hosts, allHosts: hosts, net }
  return <TabNetwork value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))} ctx={ctx} />
}

const input = (id: string) => document.getElementById(id) as HTMLInputElement
const type = (id: string, value: string) => fireEvent.change(input(id), { target: { value } })

afterEach(() => vi.unstubAllGlobals())

describe("TabNetwork VLAN-aware (AC-7.10 sisi komponen)", () => {
  it("petunjuk VLAN terdaftar mono; VLAN 20 mengisi prefix/gateway; deskripsi IP VLAN", () => {
    render(<Harness hosts={[HOSTS[0]]} net={{ ...MGMT, vlanNetworks: [V20, V30] }} />)
    const hints = document.querySelectorAll('[data-slot="vlan-hint"]')
    expect([...hints].map((h) => h.textContent)).toEqual(["20 · 10.99.20.0/24", "30 · 10.30.0.0/16"])
    for (const h of hints) expect(h).toHaveClass("type-data")
    expect(screen.getByTestId("net-ip-hint")).toHaveTextContent("Di dalam 10.99.0.0/24, di luar range dinamis 10.99.0.100–10.99.0.200.")

    type("net-vlan", "20")
    expect(input("net-gw").value).toBe("10.99.20.1")
    expect(input("net-prefix").value).toBe("24")
    expect(screen.getByTestId("net-ip-hint")).toHaveTextContent("Di dalam 10.99.20.0/24 (VLAN 20).")
    expect(screen.getByTestId("net-ip-hint").textContent).not.toMatch(/range dinamis/)
    expect(screen.getByText(/IP management statis di VLAN 20/).textContent).not.toMatch(/reservasi DHCP/)
    expect(input("net-ip").placeholder).toBe("10.99.20.11")
  })

  it("IP di luar subnet VLAN → error field (bukan muted, IP mono); IP VLAN valid", () => {
    render(<Harness hosts={[HOSTS[0]]} net={{ ...MGMT, vlanNetworks: [V20] }} />)
    type("net-vlan", "20")
    type("net-ip", "10.99.10.41")
    const err = document.querySelector('[data-slot="field-error"]') as HTMLElement
    expect(err).toHaveTextContent("Di luar subnet 10.99.20.0/24 (VLAN 20)")
    expect(err.className).not.toMatch(/muted/)
    expect(within(err).getByText("10.99.20.0/24")).toHaveClass("type-data")
    expect(input("net-ip")).toHaveAttribute("aria-invalid", "true")
    type("net-ip", "10.99.20.41")
    expect(document.querySelector('[data-slot="field-error"]')).toBeNull()
    expect(input("net-ip")).not.toHaveAttribute("aria-invalid")
  })

  it("gateway manual tidak ditimpa saat VLAN diganti; VLAN dikosongkan → subnet PXE kembali", () => {
    render(<Harness hosts={[HOSTS[0]]} net={{ ...MGMT, vlanNetworks: [V20, V30] }} />)
    type("net-vlan", "20")
    type("net-gw", "10.99.20.254")
    type("net-vlan", "30")
    expect(input("net-gw").value).toBe("10.99.20.254")
    expect(input("net-prefix").value).toBe("16")
    // Gateway manual di luar subnet VLAN 30 → field ditandai invalid (aturan VLAN, bukan PXE).
    expect(input("net-gw")).toHaveAttribute("aria-invalid", "true")
    expect(input("net-prefix")).not.toHaveAttribute("aria-invalid")
    type("net-vlan", "")
    expect(input("net-prefix").value).toBe("24")
    expect(input("net-gw").value).toBe("10.99.20.254")
    expect(screen.getByTestId("net-ip-hint")).toHaveTextContent("Di dalam 10.99.0.0/24, di luar range dinamis")
  })

  it("VLAN tidak terdaftar → petunjuk jelas (teks utama) dan aturan subnet PXE", () => {
    render(<Harness hosts={[HOSTS[0]]} net={{ ...MGMT, vlanNetworks: [V20] }} />)
    type("net-vlan", "99")
    const hint = screen.getByTestId("vlan-unregistered")
    expect(hint).toHaveTextContent("VLAN 99 tidak terdaftar di PXE_VLAN_NETWORKS; IP, prefix, dan gateway mengikuti subnet PXE 10.99.0.0/24.")
    expect(hint).toHaveClass("text-foreground")
    expect(hint.className).not.toMatch(/text-muted-foreground/)
    expect(input("net-gw").value).toBe("10.99.0.1")
    expect(screen.getByTestId("net-ip-hint")).toHaveTextContent("di luar range dinamis")
  })

  it("VLAN di luar 1–4094 → field invalid dengan pesan", () => {
    render(<Harness hosts={[HOSTS[0]]} net={{ ...MGMT, vlanNetworks: [V20] }} />)
    type("net-vlan", "5000")
    expect(input("net-vlan")).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("VLAN ID 1–4094")).toBeInTheDocument()
  })

  it("server tanpa VLAN terdaftar → perilaku lama (tanpa petunjuk daftar, tanpa isi otomatis)", () => {
    render(<Harness hosts={[HOSTS[0]]} net={{ ...MGMT }} />)
    expect(screen.queryByTestId("vlan-registered")).toBeNull()
    expect(screen.queryByTestId("vlan-unregistered")).toBeNull()
    expect(screen.getByText(/dipakai juga sebagai reservasi DHCP saat PXE/)).toBeInTheDocument()
    type("net-vlan", "20")
    expect(input("net-gw").value).toBe("10.99.0.1")
    expect(screen.getByTestId("vlan-unregistered")).toBeInTheDocument()
  })
})

describe("TabNetwork bulk VLAN (AC-7.11 sisi komponen)", () => {
  it("VLAN 20 → range bulk dimulai .11 jaringan VLAN; pratinjau mengikuti", () => {
    render(<Harness hosts={HOSTS} net={{ ...MGMT, vlanNetworks: [V20] }} />)
    expect(input("net-start").value).toBe("10.99.0.11")
    type("net-vlan", "20")
    expect(input("net-start").value).toBe("10.99.20.11")
    expect(input("net-end").value).toBe("10.99.20.254")
    type("net-start", "10.99.20.41")
    const table = screen.getByRole("table", { name: "Preview IP baru" })
    expect(within(table).getByText("10.99.20.41")).toBeInTheDocument()
    expect(within(table).getByText("10.99.20.43")).toBeInTheDocument()
    expect(screen.getByText("Lewati IP yang sudah dipakai host lain atau lease aktif")).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------- Settings

const settings = (p: Partial<SettingsResponse> = {}): SettingsResponse =>
  ({
    cidr: "10.99.0.0/24",
    prefix: 24,
    gateway: "10.99.0.1",
    dns: ["10.99.0.2"],
    pxeServer: "10.99.0.2",
    dynamicRange: ["10.99.0.100", "10.99.0.200"],
    interface: "pxe0",
    baseUrl: "http://10.99.0.2",
    mediaUrl: "http://10.99.0.2/media",
    tftpRoot: "/srv/tftp",
    tokenTtlMin: 60,
    unknownHostAction: "local",
    jobTimeouts: { bootingMin: 30, installingMin: 60, configuringMin: 30 },
    maxInstallerBoots: 3,
    insecureNoLeaseCheck: false,
    insecureConfirmed: false,
    auth: {
      adminUsername: "admin",
      adminConfigured: true,
      sessionIdleMin: 120,
      sessionMaxHours: 12,
      loginMaxFailures: 5,
      loginWindowMin: 15,
      apiRatePerMin: 600,
    },
    ...p,
  }) as SettingsResponse

describe("Settings blok VLAN management (AC-7.12 sisi komponen)", () => {
  it("tabel VLAN · Subnet · Gateway mono", () => {
    render(<VlanNetworksCard settings={settings({ vlanNetworks: [V20, V30] })} />)
    const card = screen.getByTestId("settings-vlan")
    expect(within(card).getByText("VLAN management")).toBeInTheDocument()
    const table = within(card).getByRole("table", { name: "VLAN management terdaftar" })
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["VLAN", "Subnet", "Gateway"])
    const row = table.querySelector('[data-vlan="20"]') as HTMLElement
    const cells = within(row).getAllByRole("cell")
    expect(cells.map((c) => c.textContent)).toEqual(["20", "10.99.20.0/24", "10.99.20.1"])
    for (const c of cells) expect(c).toHaveClass("type-data")
    expect(card.className).not.toMatch(/shadow-(?!none)/)
    expect(card.innerHTML).not.toMatch(/bg-primary|text-primary/)
    expect(screen.queryByTestId("settings-vlan-empty")).toBeNull()
  })

  it("tanpa vlanNetworks (key tidak ada) → empty state", () => {
    render(<VlanNetworksCard settings={settings()} />)
    expect(screen.getByTestId("settings-vlan-empty")).toHaveTextContent(
      "Tidak ada VLAN management terdaftar (PXE_VLAN_NETWORKS)",
    )
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("SettingsView: blok VLAN tepat setelah Jaringan provisioning", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(settings({ vlanNetworks: [V20] }))))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(SETTINGS_KEY, settings({ vlanNetworks: [V20] }))
    render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <SettingsView />
        </TooltipProvider>
      </QueryClientProvider>,
    )
    await screen.findByText("VLAN management")
    const titles = [...document.querySelectorAll('[data-slot="settings-section"] [data-slot="card-title"]')].map(
      (t) => t.textContent,
    )
    expect(titles.slice(0, 3)).toEqual(["Jaringan provisioning", "VLAN management", "Boot & media"])
  })
})
