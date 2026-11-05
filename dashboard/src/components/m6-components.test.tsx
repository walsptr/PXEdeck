// M6-T8/T9 komponen (jsdom): form login (error/fokus/lockout/next), akun di footer sidebar (logout),
// penanganan 401/429 global, ReasonText/PathText (DR-5-11/DR-5-14), kartu SSH Keys < md (DR-5-10),
// top bar responsif (I-5-9), log viewer (CR-5-5, CR-5-7), blok Settings "Akses".
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  params: new URLSearchParams(),
  pathname: "/hosts",
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => nav.pathname,
}))
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock("sonner", () => ({ toast: toastMock }))

import { LoginForm, lockoutText } from "@/components/auth/login-form"
import { SidebarAccount } from "@/components/auth/sidebar-account"
import { LogViewer } from "@/components/jobs/log-viewer"
import { OsImagesView } from "@/components/os-images/os-images-view"
import { PathText, ReasonText } from "@/components/os-images/path-text"
import { RATE_LIMIT_TOAST_ID, useApiSessionHandling, useReloadOnBfcacheRestore } from "@/components/providers"
import { SettingsView } from "@/components/settings/settings-view"
import { StatusPill } from "@/components/status-pill"
import { TabOs } from "@/components/host-config/tab-os"
import type { OsForm } from "@/components/host-config/form-state"
import { SshKeysView } from "@/components/ssh-keys/ssh-keys-view"
import { TopBar } from "@/components/top-bar"
import { EmptyDescription } from "@/components/ui/empty"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { OS_IMAGES_KEY } from "@/hooks/use-os-images"
import { SESSION_KEY } from "@/hooks/use-session"
import { SETTINGS_KEY, type SettingsResponse } from "@/hooks/use-settings"
import { SSH_KEYS_KEY } from "@/hooks/use-ssh-keys"
import {
  isSessionHalted,
  noteRateLimited,
  notifySessionExpired,
  resetApiState,
} from "@/lib/api-client"
import type { JobLogEvent, OsImageInfo, SshKeyInfo } from "@/lib/types"

function newQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}
function wrap(children: ReactNode, qc = newQc()) {
  return (
    <QueryClientProvider client={qc}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  )
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers })

beforeEach(() => {
  resetApiState()
  nav.replace.mockReset()
  nav.params = new URLSearchParams()
  toastMock.error.mockReset()
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  resetApiState()
})

// ---------------------------------------------------------------- Login

describe("LoginForm (AC-6.30/6.31/6.33 sisi komponen)", () => {
  function submit(username = "admin", password = "salah-sekali") {
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: username } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } })
    fireEvent.submit(screen.getByRole("button", { name: "Masuk" }).closest("form")!)
  }

  it("label terasosiasi, autocomplete, username mono, fokus awal di username", () => {
    render(wrap(<LoginForm />))
    const user = screen.getByLabelText("Username")
    const pass = screen.getByLabelText("Password")
    expect(user).toHaveAttribute("autocomplete", "username")
    expect(user).toHaveAttribute("autocapitalize", "none")
    expect(user).toHaveAttribute("spellcheck", "false")
    expect(user).toHaveClass("type-data")
    expect(pass).toHaveAttribute("autocomplete", "current-password")
    expect(pass).toHaveAttribute("type", "password")
    expect(document.activeElement).toBe(user)
    expect(screen.getByRole("button", { name: "Masuk" })).toHaveAttribute("type", "submit")
  })

  it("tombol tampilkan/sembunyikan password ber-aria-label dan mengganti tipe input", () => {
    render(wrap(<LoginForm />))
    const toggle = screen.getByRole("button", { name: "Tampilkan kata sandi" })
    fireEvent.click(toggle)
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text")
    expect(screen.getByRole("button", { name: "Sembunyikan kata sandi" })).toBeInTheDocument()
  })

  it("401 → Alert role=alert 'Username atau password salah' menerima fokus; ulang → tetap fokus", async () => {
    const f = vi.fn(async () => json({ error: "Username atau password salah" }, 401))
    vi.stubGlobal("fetch", f)
    render(wrap(<LoginForm />))
    submit()
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Username atau password salah")
    await waitFor(() => expect(document.activeElement).toBe(alert))
    expect(f).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" }))
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      username: "admin",
      password: "salah-sekali",
    })
    screen.getByLabelText("Password").focus()
    submit()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("alert")))
    expect(nav.replace).not.toHaveBeenCalled()
    // 401 login bukan sesi habis.
    expect(isSessionHalted()).toBe(false)
  })

  it("429 → 'Terlalu banyak percobaan. Coba lagi dalam N menit.' dari Retry-After; tombol tetap aktif", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "x" }, 429, { "Retry-After": "601" })))
    render(wrap(<LoginForm />))
    submit()
    expect(await screen.findByRole("alert")).toHaveTextContent("Terlalu banyak percobaan. Coba lagi dalam 11 menit.")
    expect(screen.getByRole("button", { name: "Masuk" })).toBeEnabled()
    expect(lockoutText(30)).toBe("Terlalu banyak percobaan. Coba lagi dalam 1 menit.")
    expect(lockoutText(900)).toBe("Terlalu banyak percobaan. Coba lagi dalam 15 menit.")
  })

  it("error lain → pesan server; jaringan gagal → pesan koneksi", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "Request lintas-origin ditolak" }, 403))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("x", { status: 500 }))
    vi.stubGlobal("fetch", f)
    render(wrap(<LoginForm />))
    submit()
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Request lintas-origin ditolak"))
    submit()
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Tidak bisa menghubungi server"))
    submit()
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Login gagal (500)"))
  })

  it("204 → router.replace(next yang disanitasi) dan state API direset", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
    nav.params = new URLSearchParams("next=/jobs?host=525400990011")
    notifySessionExpired()
    render(wrap(<LoginForm />))
    submit("admin", "benar-sekali-12")
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/jobs?host=525400990011"))
    expect(isSessionHalted()).toBe(false)
    expect(screen.getByTestId("login-submit")).toBeDisabled()
  })

  it.each(["//evil.test", "/\\evil.test", "https://evil.test", "javascript:alert(1)", "/login"])(
    "next berbahaya %s → /hosts",
    async (next) => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
      nav.params = new URLSearchParams({ next })
      render(wrap(<LoginForm />))
      submit("admin", "benar-sekali-12")
      await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/hosts"))
    },
  )
})

// ---------------------------------------------------------------- Sesi habis / rate limit global

function HandlingProbe({ qc, navigate }: { qc: QueryClient; navigate: (h: string) => void }) {
  useApiSessionHandling(qc, navigate)
  return null
}

describe("useApiSessionHandling (Providers)", () => {
  it("401 → cache dibersihkan + navigasi SEKALI ke /login?next=<path+query>", () => {
    window.history.pushState({}, "", "/jobs?host=525400990011&job=j1")
    const qc = newQc()
    qc.setQueryData(["hosts"], { hosts: [1] })
    const navigate = vi.fn()
    render(<HandlingProbe qc={qc} navigate={navigate} />)
    act(() => {
      notifySessionExpired()
      notifySessionExpired()
    })
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/jobs?host=525400990011&job=j1")}`)
    expect(qc.getQueryData(["hosts"])).toBeUndefined()
    window.history.pushState({}, "", "/")
  })

  it("di halaman /login sendiri tidak ada redirect", () => {
    window.history.pushState({}, "", "/login")
    const navigate = vi.fn()
    render(<HandlingProbe qc={newQc()} navigate={navigate} />)
    act(() => notifySessionExpired())
    expect(navigate).not.toHaveBeenCalled()
    window.history.pushState({}, "", "/")
  })

  it("429 → toast tunggal ber-id tetap dengan jeda detik", () => {
    render(<HandlingProbe qc={newQc()} navigate={vi.fn()} />)
    act(() => noteRateLimited(30))
    expect(toastMock.error).toHaveBeenCalledWith(
      "Terlalu banyak request",
      expect.objectContaining({ id: RATE_LIMIT_TOAST_ID, description: expect.stringContaining("30 detik") }),
    )
  })
})

function BfcacheProbe({ reload }: { reload: () => void }) {
  useReloadOnBfcacheRestore(reload)
  return null
}

describe("useReloadOnBfcacheRestore (Back setelah logout)", () => {
  it("pageshow persisted → muat ulang dari server; pageshow biasa → tidak", () => {
    const reload = vi.fn()
    render(<BfcacheProbe reload={reload} />)
    const ev = (persisted: boolean) => {
      const e = new Event("pageshow") as PageTransitionEvent
      Object.defineProperty(e, "persisted", { value: persisted })
      return e
    }
    window.dispatchEvent(ev(false))
    expect(reload).not.toHaveBeenCalled()
    window.dispatchEvent(ev(true))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------- Sidebar account

describe("SidebarAccount (AC-6.31 sisi komponen)", () => {
  it("username mono di footer; Keluar → POST logout, cache dibersihkan, navigasi /login", async () => {
    const f = vi.fn(async (url: string) =>
      url === "/api/auth/logout"
        ? new Response(null, { status: 204 })
        : json({ username: "admin-lab", expiresAt: "2026-11-06T22:00:00.000Z" }),
    )
    vi.stubGlobal("fetch", f)
    const qc = newQc()
    qc.setQueryData(["hosts"], { hosts: [] })
    const navigate = vi.fn()
    render(wrap(<SidebarProvider><SidebarAccount navigate={navigate} /></SidebarProvider>, qc))
    const name = await screen.findByTestId("sidebar-username")
    await waitFor(() => expect(name).toHaveTextContent("admin-lab"))
    expect(name).toHaveClass("type-data")
    expect(name).toHaveClass("text-muted-foreground")
    fireEvent.click(screen.getByRole("button", { name: "Keluar" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/login"))
    expect(f).toHaveBeenCalledWith("/api/auth/logout", { method: "POST", cache: "no-store" })
    expect(qc.getQueryData(["hosts"])).toBeUndefined()
    expect(qc.getQueryData(SESSION_KEY)).toBeUndefined()
  })

  it("logout gagal → toast error, tetap di halaman", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/auth/logout" ? json({ error: "Host tidak diizinkan" }, 403) : json({ username: "a", expiresAt: "x" }),
      ),
    )
    const navigate = vi.fn()
    render(wrap(<SidebarProvider><SidebarAccount navigate={navigate} /></SidebarProvider>))
    fireEvent.click(screen.getByRole("button", { name: "Keluar" }))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Gagal keluar", { description: "Host tidak diizinkan" }))
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Keluar" })).toBeEnabled()
  })
})

// ---------------------------------------------------------------- PathText / ReasonText

describe("ReasonText / PathText (DR-5-11, DR-5-14)", () => {
  const builtin = "Media ubuntu-22.04 tidak tersedia (ubuntu-22.04/casper/vmlinuz tidak ada)"

  it("format server: id + path mono, textContent utuh, span alasan tanpa wrap-anywhere", () => {
    const { container } = render(<ReasonText reason={builtin} data-testid="r" />)
    const r = screen.getByTestId("r")
    expect(r.textContent).toBe(builtin)
    expect(r.className).not.toMatch(/wrap-anywhere/)
    expect(r).toHaveClass("wrap-break-word")
    const token = container.querySelector('[data-slot="data-token"]')!
    expect(token).toHaveTextContent("ubuntu-22.04")
    expect(token).toHaveClass("type-data", "inline-block")
    const path = container.querySelector('[data-slot="path-text"]')!
    expect(path).toHaveClass("type-data")
    // "(" menempel di segmen pertama (tidak tertinggal di ujung baris).
    expect([...path.querySelectorAll('[data-slot="path-segment"]')].map((s) => s.textContent)).toEqual([
      "(ubuntu-22.04/",
      "casper/",
      "vmlinuz",
    ])
  })

  it("format lain: token ber-'/' jadi path (tanda baca di luar), teks lain biasa", () => {
    const reason = "Kernel (x/y/vmlinuz) hilang, cek /srv/media."
    const { container } = render(<ReasonText reason={reason} data-testid="r" />)
    expect(screen.getByTestId("r").textContent).toBe(reason)
    const paths = [...container.querySelectorAll('[data-slot="path-text"]')].map((p) => p.textContent)
    expect(paths).toEqual(["(x/y/vmlinuz", "/srv/media"])
    const plain = "Image tidak bootable via PXE"
    const { container: c2 } = render(<ReasonText reason={plain} />)
    expect(c2.querySelector('[data-slot="path-text"]')).toBeNull()
    expect(c2.textContent).toBe(plain)
  })

  it("PathText: segmen inline-block per '/'", () => {
    const { container } = render(<PathText value="a/b" />)
    expect(container.querySelectorAll('[data-slot="path-segment"].inline-block')).toHaveLength(2)
  })
})

// ---------------------------------------------------------------- OS Images availability

function img(p: Partial<OsImageInfo>): OsImageInfo {
  return {
    id: "ubuntu-22.04",
    name: "Ubuntu Server",
    version: "22.04.5 LTS",
    arch: "amd64",
    method: "autoinstall",
    bootable: true,
    available: false,
    reason: "Media ubuntu-22.04 tidak tersedia (ubuntu-22.04/casper/vmlinuz tidak ada)",
    builtin: true,
    source: { kernel: "ubuntu-22.04/casper/vmlinuz", initrd: "ubuntu-22.04/casper/initrd", repo: "ubuntu-22.04" },
    repoUrl: "http://10.99.0.2/media/ubuntu-22.04",
    usedBy: 0,
    createdAt: "2026-11-06T10:00:00.000Z",
    ...p,
  } as OsImageInfo
}

describe("OsImagesView kolom Ketersediaan (DR-5-11/14)", () => {
  it("alasan dirender ReasonText (path mono) dengan lebar kolom desktop tetap, tanpa wrap-anywhere", () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([])))
    const qc = newQc()
    qc.setQueryData(OS_IMAGES_KEY, [img({})])
    render(wrap(<OsImagesView />, qc))
    const cell = screen.getByTestId("img-available")
    expect(cell).toHaveClass("xl:w-[24ch]")
    const reason = within(cell).getByTestId("img-reason")
    expect(reason.className).not.toMatch(/wrap-anywhere/)
    expect(reason.querySelector('[data-slot="path-text"]')).toHaveTextContent("ubuntu-22.04/casper/vmlinuz")
  })
})

describe("TabOs kartu image (DR-5-11 + a11y)", () => {
  it("radio image bernama judul kartu; alasan tidak tersedia dengan path mono", () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([])))
    const qc = newQc()
    qc.setQueryData(OS_IMAGES_KEY, [img({}), img({ id: "ubuntu-24.04", version: "24.04.5 LTS", available: true, reason: null })])
    const { container } = render(
      wrap(
        <TabOs
          value={{ osImageId: "", disk: "", partition: "auto", customStorage: "", timezone: "Asia/Jakarta", locale: "id_ID.UTF-8" } as OsForm}
          onChange={() => {}}
          hosts={[]}
        />,
        qc,
      ),
    )
    expect(screen.getByRole("radio", { name: "Ubuntu Server 22.04.5 LTS" })).toBeDisabled()
    expect(screen.getByRole("radio", { name: "Ubuntu Server 24.04.5 LTS" })).toBeEnabled()
    const note = container.querySelector("#os-ubuntu-22\\.04-note")!
    expect(note.querySelector('[data-slot="path-text"]')).toHaveTextContent("ubuntu-22.04/casper/vmlinuz")
    expect(note.querySelector('[data-slot="path-text"]')).toHaveClass("type-data")
  })
})

// ---------------------------------------------------------------- SSH Keys < md

function key(p: Partial<SshKeyInfo> = {}): SshKeyInfo {
  return {
    id: "k1",
    name: "k".repeat(64),
    type: "ssh-ed25519",
    publicKey: "ssh-ed25519 AAAA",
    fingerprint: "SHA256:" + "A".repeat(43),
    comment: "budi@" + "x".repeat(80),
    createdAt: "2026-11-06T10:00:00.000Z",
    usedBy: 2,
    ...p,
  } as SshKeyInfo
}

describe("SshKeysView kartu < lg (DR-5-10)", () => {
  it("tabel → kartu di bawah lg: header disembunyikan, baris flex-wrap, nama utuh, fingerprint selebar kartu, label Dibuat/Dipakai", () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([])))
    const qc = newQc()
    qc.setQueryData(SSH_KEYS_KEY, [key()])
    render(wrap(<SshKeysView />, qc))
    const table = screen.getByTestId("ssh-keys-table")
    expect(table).toHaveClass("max-lg:block")
    expect(table.querySelector("thead")).toHaveClass("max-lg:hidden")
    const row = screen.getByTestId("ssh-key-row")
    expect(row).toHaveClass("max-lg:flex", "max-lg:flex-wrap")
    const name = within(row).getByTestId("key-name")
    expect(name).toHaveClass("max-lg:whitespace-normal", "max-lg:wrap-anywhere", "max-lg:max-w-full")
    expect(name.textContent).toBe("k".repeat(64))
    const fp = within(row).getByTestId("key-fingerprint")
    expect(fp).toHaveClass("type-data", "max-lg:max-w-full")
    expect(fp.closest("td")).toHaveClass("max-lg:basis-full", "max-lg:order-4")
    expect(within(row).getByRole("button", { name: `Ubah nama ${"k".repeat(64)}` })).toBeInTheDocument()
    expect(within(row).getByRole("button", { name: `Hapus ${"k".repeat(64)}` }).closest("td")).toHaveClass("max-lg:order-2")
    expect(within(row).getByText("Dibuat")).toHaveClass("lg:hidden")
    expect(within(row).getByText("Dipakai")).toHaveClass("lg:hidden")
  })
})

// ---------------------------------------------------------------- Top bar

describe("TopBar (I-5-9)", () => {
  it("pencarian global menyusut di md (ikon), lg 192 px, xl 256 px; judul boleh terpotong; nama aksesibel tetap", () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ services: [], checkedAt: "x" })))
    nav.pathname = "/hosts"
    render(wrap(<SidebarProvider><TopBar /></SidebarProvider>))
    const btn = screen.getByRole("button", { name: /Cari MAC, hostname, IP/ })
    expect(btn).toHaveClass("md:w-9", "lg:w-48", "xl:w-64")
    expect(btn.className).not.toMatch(/(^|\s)w-64/)
    // md: ikon saja, teks tetap jadi nama aksesibel (sr-only, bukan aria-label → WCAG 2.5.3).
    expect(within(btn).getByText("Cari MAC, hostname, IP…")).toHaveClass("sr-only", "lg:not-sr-only")
    expect(btn).not.toHaveAttribute("aria-label")
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("min-w-0", "truncate")
    expect(screen.getByRole("group", { name: "Status server PXE" })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------- Log viewer

describe("LogViewer (CR-5-5, CR-5-7)", () => {
  it("event gabungan menampilkan 'terakhir HH:MM:SS' dari lastAt", async () => {
    const e: JobLogEvent = {
      seq: 1,
      at: "2026-11-06T10:00:00.000Z",
      kind: "system",
      level: "warn",
      source: "boot-script",
      message: "PXE boot ulang",
      repeat: 11,
      lastAt: "2026-11-06T10:05:00.000Z",
    }
    vi.stubGlobal("fetch", vi.fn(async () => json({ events: [e], lastSeq: 1, final: true })))
    render(wrap(<LogViewer jobId="job-1" />))
    const rep = await screen.findByTestId("log-repeat")
    expect(rep).toHaveTextContent(/×11 · terakhir/)
    expect(within(rep).getByTestId("log-last-at")).toHaveAttribute("dateTime", e.lastAt)
  })

  it("job tidak ada (404) → status final 'Job tidak ditemukan' (bukan muted), tanpa polling ulang", async () => {
    const f = vi.fn(async () => json({ error: "Job tidak ditemukan" }, 404))
    vi.stubGlobal("fetch", f)
    render(wrap(<LogViewer jobId="job-x" />))
    await waitFor(() => expect(screen.getByTestId("log-connection")).toHaveAttribute("data-state", "not-found"))
    expect(screen.getByTestId("log-connection")).toHaveTextContent("Job tidak ditemukan")
    expect(screen.getByTestId("log-connection")).toHaveClass("text-foreground")
    expect(screen.getByTestId("log-lines")).toHaveTextContent(/Job tidak ditemukan/)
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe("EmptyDescription (a11y O10)", () => {
  it("deskripsi empty state di atas canvas-soft memakai body (muted/canvas-soft 3,94:1 di luar pengecualian DEC-017 §9)", () => {
    render(<EmptyDescription>Belum ada SSH key</EmptyDescription>)
    const el = screen.getByText("Belum ada SSH key")
    expect(el).toHaveClass("text-body")
    expect(el.className).not.toMatch(/text-muted-foreground/)
  })
})

describe("StatusPill Offline (a11y O10)", () => {
  it("label status Offline tidak memakai muted (kontras ≥ 4,5:1 di atas surface-strong)", () => {
    render(<StatusPill status="offline" />)
    const pill = screen.getByText("Offline")
    expect(pill).toHaveClass("bg-secondary", "text-body")
    expect(pill.className).not.toMatch(/text-muted-foreground/)
  })
})

// ---------------------------------------------------------------- Settings Akses

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
      adminUsername: "admin-lab",
      adminConfigured: true,
      sessionIdleMin: 120,
      sessionMaxHours: 12,
      loginMaxFailures: 5,
      loginWindowMin: 15,
      apiRatePerMin: 600,
    },
    ...p,
  }) as SettingsResponse

describe("SettingsView blok Akses (AC-6.1 sisi UI)", () => {
  it("username admin mono + sesi/rate limit; tanpa hash; banner konfirmasi insecure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(settings({ insecureNoLeaseCheck: true, insecureConfirmed: true }))))
    const qc = newQc()
    qc.setQueryData(SETTINGS_KEY, settings({ insecureNoLeaseCheck: true, insecureConfirmed: true }))
    render(wrap(<SettingsView />, qc))
    const title = await screen.findByText("Akses")
    const card = title.closest('[data-slot="settings-section"]') as HTMLElement
    const admin = within(card).getByText("admin-lab")
    expect(admin).toHaveClass("type-data")
    expect(within(card).getByText("120 menit")).toBeInTheDocument()
    expect(within(card).getByText("5 kali / 15 menit")).toBeInTheDocument()
    expect(within(card).getByText("600 / menit per sesi")).toBeInTheDocument()
    expect(card.textContent).not.toMatch(/scrypt|HASH=/)
    expect(screen.getByTestId("insecure-confirmed")).toHaveTextContent("PXE_INSECURE_NO_LEASE_CHECK_CONFIRM")
  })

  it("admin belum dikonfigurasi → teks + petunjuk; tanpa konfirmasi → tanpa baris konfirmasi", async () => {
    const s = settings({
      insecureNoLeaseCheck: true,
      auth: { ...settings().auth, adminUsername: null, adminConfigured: false },
    })
    vi.stubGlobal("fetch", vi.fn(async () => json(s)))
    const qc = newQc()
    qc.setQueryData(SETTINGS_KEY, s)
    render(wrap(<SettingsView />, qc))
    expect(await screen.findByText("Belum dikonfigurasi")).toBeInTheDocument()
    expect(screen.getByTestId("insecure-lease-warning")).toBeInTheDocument()
    expect(screen.queryByTestId("insecure-confirmed")).toBeNull()
  })
})
