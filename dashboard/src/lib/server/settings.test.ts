// AC-4.5 (unit): konfigurasi env (zod, fail fast, pesan menyebut nama variabel) + aturan DEC-006
// untuk subnet KVM 10.99.0.0/24. Juga toSettingsResponse (bentuk AC-4.6, tanpa path DB/rahasia).
import { describe, expect, it } from "vitest"

import { validateStaticIp, validateStaticNetwork } from "@/lib/net"
import { isolateEnv } from "@/test/env"

import { getSettings, mgmtPrefix, settingsFromEnv, toSettingsResponse, type SettingsEnv } from "./settings"

isolateEnv()

const KVM: SettingsEnv = {
  PXE_MGMT_CIDR: "10.99.0.0/24",
  PXE_MGMT_GATEWAY: "10.99.0.1",
  PXE_MGMT_DNS: "10.99.0.2",
  PXE_SERVER_IP: "10.99.0.2",
  PXE_DHCP_RANGE: "10.99.0.100-10.99.0.200",
  PXE_DHCP_INTERFACE: "pxe0",
  PXE_BASE_URL: "http://10.99.0.2",
  PXE_DNSMASQ_LEASES: "/var/lib/misc/dnsmasq.leases",
  PXE_DNSMASQ_PIDFILE: "/run/dnsmasq/dnsmasq.pid",
  PXE_TRUST_PROXY: "1",
  PXE_TOKEN_TTL_MIN: "360",
  PXE_UNKNOWN_HOST_ACTION: "local",
  PXE_KERNEL_EXTRA_ARGS: "console=ttyS0,115200n8 console=tty0",
  PXE_DB_PATH: "/var/lib/pxe-dashboard/pxe.db",
  PXE_SEED: "empty",
}

describe("AC-4.5 settingsFromEnv: konfigurasi valid", () => {
  it("default lab (env kosong) sesuai plan §2.1", () => {
    const s = settingsFromEnv({})
    expect(s.network).toEqual({
      cidr: "10.10.10.0/24",
      gateway: "10.10.10.1",
      dns: ["10.10.10.1"],
      pxeServer: "10.10.10.1",
      dynamicRange: ["10.10.10.100", "10.10.10.200"],
    })
    expect(s).toMatchObject({
      dhcpInterface: "enp7s0",
      baseUrl: "http://10.10.10.1",
      mediaUrl: "http://10.10.10.1/media",
      mediaRoot: "/srv/pxe/media",
      tftpRoot: "/srv/pxe/tftp",
      dnsmasqLeases: null,
      dnsmasqPidfile: null,
      trustProxy: false,
      tokenTtlMin: 360,
      unknownHostAction: "local",
      kernelExtraArgs: "",
      dbPath: "./data/pxe.db",
      seed: "empty",
    })
    expect(s.allowedHosts).toEqual(["localhost", "127.0.0.1", "[::1]", "10.10.10.1"])
    expect(settingsFromEnv({ VITEST: "true" }).dbPath).toBe(":memory:")
  })

  it("lingkungan KVM ter-parse lengkap", () => {
    const s = settingsFromEnv(KVM)
    expect(s.network).toEqual({
      cidr: "10.99.0.0/24",
      gateway: "10.99.0.1",
      dns: ["10.99.0.2"],
      pxeServer: "10.99.0.2",
      dynamicRange: ["10.99.0.100", "10.99.0.200"],
    })
    expect(s).toMatchObject({
      dhcpInterface: "pxe0",
      baseUrl: "http://10.99.0.2",
      mediaUrl: "http://10.99.0.2/media",
      dnsmasqLeases: "/var/lib/misc/dnsmasq.leases",
      dnsmasqPidfile: "/run/dnsmasq/dnsmasq.pid",
      trustProxy: true,
      kernelExtraArgs: "console=ttyS0,115200n8 console=tty0",
      dbPath: "/var/lib/pxe-dashboard/pxe.db",
    })
    expect(mgmtPrefix(s)).toBe(24)
  })

  it("variasi valid: PXE_DYNAMIC_RANGE (nama M3), trailing slash, https, true/false, wait, demo di dev, allowlist", () => {
    const s = settingsFromEnv({
      ...KVM,
      PXE_DHCP_RANGE: undefined,
      PXE_DYNAMIC_RANGE: "10.99.0.100-10.99.0.200",
      PXE_BASE_URL: "https://pxe.lab.example:8443/",
      PXE_MEDIA_URL: "http://10.99.0.2/media///",
      PXE_MEDIA_ROOT: "/srv/pxe/media/",
      PXE_TRUST_PROXY: "TRUE",
      PXE_UNKNOWN_HOST_ACTION: "WAIT",
      PXE_SEED: "Demo",
      PXE_TOKEN_TTL_MIN: "5",
      // DEC-014 (M5): TTL token ≥ jumlah timeout tahap → timeout tahap kecil agar TTL 5 tetap sah.
      PXE_JOB_BOOTING_TIMEOUT_MIN: "1",
      PXE_JOB_INSTALLING_TIMEOUT_MIN: "2",
      PXE_JOB_CONFIGURING_TIMEOUT_MIN: "1",
      PXE_ALLOWED_HOSTS: " Pxe.Lab.Example:8443, localhost ,,",
    })
    expect(s.network.dynamicRange).toEqual(["10.99.0.100", "10.99.0.200"])
    expect(s.baseUrl).toBe("https://pxe.lab.example:8443")
    expect(s.mediaUrl).toBe("http://10.99.0.2/media")
    expect(s.mediaRoot).toBe("/srv/pxe/media")
    expect(s.trustProxy).toBe(true)
    expect(s.unknownHostAction).toBe("wait")
    expect(s.seed).toBe("demo")
    expect(s.tokenTtlMin).toBe(5)
    expect(s.allowedHosts).toEqual(["pxe.lab.example:8443", "localhost"])
    expect(settingsFromEnv({ ...KVM, PXE_TRUST_PROXY: "false" }).trustProxy).toBe(false)
    // Default allowlist memuat host PXE_BASE_URL (SR-3-5).
    expect(settingsFromEnv({ ...KVM, PXE_BASE_URL: "http://pxe.lab.example:8080" }).allowedHosts).toContain("pxe.lab.example:8080")
  })
})

describe("AC-4.5 settingsFromEnv: error menyebut nama variabel", () => {
  const cases: [string, SettingsEnv, RegExp][] = [
    ["CIDR invalid", { PXE_MGMT_CIDR: "10.99.0.0/33" }, /PXE_MGMT_CIDR/],
    ["CIDR bukan IP", { PXE_MGMT_CIDR: "abc" }, /PXE_MGMT_CIDR/],
    ["gateway di luar subnet", { ...KVM, PXE_MGMT_GATEWAY: "10.10.10.1" }, /PXE_MGMT_GATEWAY/],
    ["server di luar subnet", { ...KVM, PXE_SERVER_IP: "10.10.10.2" }, /PXE_SERVER_IP/],
    ["DNS alamat khusus", { ...KVM, PXE_MGMT_DNS: "127.0.0.1" }, /PXE_MGMT_DNS/],
    ["DNS bukan IPv4", { ...KVM, PXE_MGMT_DNS: "dns.example" }, /PXE_MGMT_DNS/],
    ["range di luar subnet", { ...KVM, PXE_DHCP_RANGE: "10.10.10.100-10.10.10.200" }, /PXE_DHCP_RANGE/],
    ["range di luar subnet (nama M3)", { ...KVM, PXE_DHCP_RANGE: undefined, PXE_DYNAMIC_RANGE: "10.10.10.100-10.10.10.200" }, /PXE_DYNAMIC_RANGE/],
    ["range memuat gateway", { ...KVM, PXE_DHCP_RANGE: "10.99.0.1-10.99.0.50" }, /PXE_DHCP_RANGE .*memuat gateway 10\.99\.0\.1/],
    ["range memuat server", { ...KVM, PXE_MGMT_GATEWAY: "10.99.0.254", PXE_DHCP_RANGE: "10.99.0.2-10.99.0.50" }, /PXE_DHCP_RANGE .*memuat PXE server 10\.99\.0\.2/],
    ["range rusak", { ...KVM, PXE_DHCP_RANGE: "10.99.0.100" }, /PXE_DHCP_RANGE/],
    ["base URL ftp", { ...KVM, PXE_BASE_URL: "ftp://10.99.0.2" }, /PXE_BASE_URL harus http/],
    ["base URL bukan URL", { ...KVM, PXE_BASE_URL: "10.99.0.2" }, /PXE_BASE_URL/],
    ["base URL dengan query", { ...KVM, PXE_BASE_URL: "http://10.99.0.2/?a=1" }, /PXE_BASE_URL/],
    ["base URL dengan kredensial", { ...KVM, PXE_BASE_URL: "http://u:p@10.99.0.2" }, /PXE_BASE_URL/],
    ["media URL bukan http", { ...KVM, PXE_MEDIA_URL: "file:///srv" }, /PXE_MEDIA_URL/],
    ["media URL karakter aneh", { ...KVM, PXE_MEDIA_URL: "http://10.99.0.2/me$dia" }, /PXE_MEDIA_URL/],
    ["media root relatif", { ...KVM, PXE_MEDIA_ROOT: "srv/pxe" }, /PXE_MEDIA_ROOT/],
    ["media root ..", { ...KVM, PXE_MEDIA_ROOT: "/srv/../etc" }, /PXE_MEDIA_ROOT/],
    ["tftp root", { ...KVM, PXE_TFTP_ROOT: "/srv/tftp;rm" }, /PXE_TFTP_ROOT/],
    ["leases relatif", { ...KVM, PXE_DNSMASQ_LEASES: "dnsmasq.leases" }, /PXE_DNSMASQ_LEASES/],
    ["pidfile relatif", { ...KVM, PXE_DNSMASQ_PIDFILE: "x.pid" }, /PXE_DNSMASQ_PIDFILE/],
    ["interface", { ...KVM, PXE_DHCP_INTERFACE: "eth0;reboot" }, /PXE_DHCP_INTERFACE/],
    ["trust proxy", { ...KVM, PXE_TRUST_PROXY: "yes" }, /PXE_TRUST_PROXY/],
    ["TTL bukan angka", { ...KVM, PXE_TOKEN_TTL_MIN: "abc" }, /PXE_TOKEN_TTL_MIN/],
    ["TTL terlalu kecil", { ...KVM, PXE_TOKEN_TTL_MIN: "4" }, /PXE_TOKEN_TTL_MIN/],
    ["TTL terlalu besar", { ...KVM, PXE_TOKEN_TTL_MIN: "10081" }, /PXE_TOKEN_TTL_MIN/],
    ["unknown host action", { ...KVM, PXE_UNKNOWN_HOST_ACTION: "reboot" }, /PXE_UNKNOWN_HOST_ACTION/],
    ["kernel args injeksi", { ...KVM, PXE_KERNEL_EXTRA_ARGS: "console=ttyS0 ${token}" }, /PXE_KERNEL_EXTRA_ARGS/],
    ["kernel args newline", { ...KVM, PXE_KERNEL_EXTRA_ARGS: "a\nkernel x" }, /PXE_KERNEL_EXTRA_ARGS/],
    ["kernel args terlalu panjang", { ...KVM, PXE_KERNEL_EXTRA_ARGS: "a".repeat(513) }, /PXE_KERNEL_EXTRA_ARGS/],
    ["seed tak dikenal", { ...KVM, PXE_SEED: "full" }, /PXE_SEED/],
    ["seed demo di production", { ...KVM, PXE_SEED: "demo", NODE_ENV: "production" }, /PXE_SEED=demo .*production/],
    ["allowlist rusak", { ...KVM, PXE_ALLOWED_HOSTS: "evil host" }, /PXE_ALLOWED_HOSTS/],
  ]
  for (const [name, env, re] of cases) {
    it(name, () => {
      expect(() => settingsFromEnv(env)).toThrow(re)
    })
  }
})

describe("AC-4.5 DEC-006 dengan PXE_MGMT_CIDR=10.99.0.0/24", () => {
  const net = settingsFromEnv(KVM).network
  it("10.99.0.21 diterima", () => {
    expect(validateStaticIp("10.99.0.21", undefined, net)).toBeNull()
  })
  it("10.10.10.21 (subnet lain), 10.99.0.150 (range dinamis), 10.99.0.2 (server), 10.99.0.1 (gateway) ditolak", () => {
    expect(validateStaticIp("10.10.10.21", undefined, net)).toMatch(/Di luar subnet 10\.99\.0\.0\/24/)
    expect(validateStaticIp("10.99.0.150", undefined, net)).toMatch(/range DHCP dinamis 10\.99\.0\.100–10\.99\.0\.200/)
    expect(validateStaticIp("10.99.0.2", undefined, net)).toBe("Dipakai gateway/PXE server")
    expect(validateStaticIp("10.99.0.1", undefined, net)).toBe("Dipakai gateway/PXE server")
  })
  it("prefix ≠ 24 ditolak; prefix 24 + gateway 10.99.0.1 + DNS 10.99.0.2 diterima", () => {
    expect(validateStaticNetwork({ prefix: 16, gateway: "10.99.0.1", dns: ["10.99.0.2"] }, net)[0]).toMatch(/Prefix \/16 tidak sesuai .* \(harus \/24\)/)
    expect(validateStaticNetwork({ prefix: 24, gateway: "10.99.0.1", dns: ["10.99.0.2"] }, net)).toEqual([])
  })
})

describe("getSettings (process.env) & toSettingsResponse", () => {
  it("membaca env tiap panggilan (cache per nilai)", () => {
    const a = getSettings()
    expect(getSettings()).toBe(a)
    Object.assign(process.env, KVM)
    const b = getSettings()
    expect(b).not.toBe(a)
    expect(b.network.cidr).toBe("10.99.0.0/24")
  })
  it("env invalid → getSettings melempar (fail fast)", () => {
    process.env.PXE_TOKEN_TTL_MIN = "0"
    expect(() => getSettings()).toThrow(/PXE_TOKEN_TTL_MIN/)
  })
  it("respons berisi nilai non-rahasia saja (tanpa dbPath/seed/allowedHosts/leases/pidfile)", () => {
    const r = toSettingsResponse(settingsFromEnv(KVM))
    expect(r).toEqual({
      cidr: "10.99.0.0/24",
      prefix: 24,
      gateway: "10.99.0.1",
      dns: ["10.99.0.2"],
      dynamicRange: ["10.99.0.100", "10.99.0.200"],
      pxeServer: "10.99.0.2",
      interface: "pxe0",
      baseUrl: "http://10.99.0.2",
      mediaUrl: "http://10.99.0.2/media",
      tftpRoot: "/srv/pxe/tftp",
      tokenTtlMin: 360,
      unknownHostAction: "local",
      // M5 (AC-5.1): pengaturan job non-rahasia.
      jobTimeouts: { bootingMin: 60, installingMin: 120, configuringMin: 60 },
      maxInstallerBoots: 3,
      insecureNoLeaseCheck: false,
    })
    const json = JSON.stringify(r)
    for (const secret of ["pxe.db", "dnsmasq.leases", "dnsmasq.pid", "seed", "allowed"]) expect(json).not.toContain(secret)
  })
})
