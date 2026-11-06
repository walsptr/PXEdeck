// Generator Windows unattend.xml (generator + unit test saja, DEC-010; tetap TIDAK dilayani di M6,
// DEC-017 §8: `INSTALLER_FILES.unattend` kosong, image `unattend` tidak bisa bootable, install 422).
// O9: TIDAK ada password/hash dari konfigurasi. Akun lokal dibuat dengan
// password acak yang dibuang setelah render; akses hanya lewat OpenSSH +
// administrators_authorized_keys. Semua teks lewat `xmlEscape`; key SSH
// dikirim ke PowerShell sebagai base64.
// M6 (CR-4-7/SR-4-3): unattend tidak memuat URL `/boot/` maupun token dalam bentuk apa pun
// (`InstallContext.callbackUrl` sengaja tidak dipakai); FirstLogonCommands diakhiri pembersihan
// (`cleanupCommands`).
import { randomBytes } from "node:crypto"

import { InstallerInputError, validateContext, type InstallContext } from "./context"
import { authorizedKeysText } from "./firstboot"
import { b64 } from "./shell"
import { xmlEscape } from "./xml"

const ARCH = 'processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"'
const NS = 'xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'

/** `raw`: atribut konstan (bukan input) yang ditulis apa adanya. */
type Node = { tag: string; attrs?: Record<string, string>; raw?: string; children?: (Node | string)[] }

function el(tag: string, children: (Node | string)[] | string = [], attrs?: Record<string, string>): Node {
  return { tag, attrs, children: typeof children === "string" ? [children] : children }
}

function render(n: Node | string, indent = ""): string {
  if (typeof n === "string") return xmlEscape(n)
  const attrs = Object.entries(n.attrs ?? {})
    .map(([k, v]) => ` ${k}="${xmlEscape(v)}"`)
    .join("") + (n.raw ? ` ${n.raw}` : "")
  const kids = n.children ?? []
  if (kids.length === 0) return `${indent}<${n.tag}${attrs}/>`
  if (kids.every((k) => typeof k === "string"))
    return `${indent}<${n.tag}${attrs}>${kids.map((k) => render(k)).join("")}</${n.tag}>`
  return `${indent}<${n.tag}${attrs}>\n${kids.map((k) => render(k, `${indent}  `)).join("\n")}\n${indent}</${n.tag}>`
}

function component(name: string, children: Node[]): Node {
  return { tag: "component", attrs: { name }, raw: `${ARCH} ${NS}`, children }
}

/** MAC Windows: `52-54-00-AA-BB-CC`. */
export function windowsMac(mac: string): string {
  return mac.toUpperCase().replaceAll(":", "-")
}

/** Password acak sekali pakai (dibuang, O9). */
function throwawayPassword(): string {
  return `${randomBytes(24).toString("base64url")}!a1`
}

const ADMIN_USER = "pxeadmin"

/** File unattend yang disalin Setup ke disk target (memuat password AutoLogon sementara). */
export const WINDOWS_UNATTEND_PATHS = [
  "C:\\Windows\\Panther\\unattend*.xml",
  "C:\\Windows\\Panther\\Unattend\\unattend*.xml",
  "C:\\Windows\\System32\\Sysprep\\unattend.xml",
] as const

const WINLOGON = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon"

const encoded = (script: string) =>
  `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`

/**
 * M6 (CR-4-7/SR-4-3, DEC-017 §8): langkah TERAKHIR FirstLogonCommands, berurutan:
 *  1. hapus salinan unattend di disk target (Panther/Sysprep) — memuat password AutoLogon;
 *  2. matikan AutoLogon: `AutoAdminLogon=0`, hapus `DefaultPassword`/`AutoLogonCount`;
 *  3. acak ulang password `pxeadmin` (RandomNumberGenerator di host, tidak pernah dicetak/di-log) —
 *     password sementara dari unattend tidak berlaku lagi; akses hanya lewat OpenSSH + key;
 *  4. `logoff` sesi AutoLogon admin.
 * Tidak ada URL `/boot/` atau token: callback status Windows tidak didukung (install Windows 422).
 */
export function cleanupCommands(): string[] {
  return [
    encoded(
      `Remove-Item -Path ${WINDOWS_UNATTEND_PATHS.map((p) => `'${p}'`).join(", ")} -Force -ErrorAction SilentlyContinue`,
    ),
    encoded(
      [
        `$k = '${WINLOGON}'`,
        "Set-ItemProperty -Path $k -Name AutoAdminLogon -Value '0'",
        "Remove-ItemProperty -Path $k -Name DefaultPassword -ErrorAction SilentlyContinue",
        "Remove-ItemProperty -Path $k -Name AutoLogonCount -ErrorAction SilentlyContinue",
      ].join("; "),
    ),
    encoded(
      [
        "$b = New-Object byte[] 48",
        "$r = [Security.Cryptography.RandomNumberGenerator]::Create()",
        "$r.GetBytes($b)",
        "$r.Dispose()",
        "$s = ConvertTo-SecureString -String ([Convert]::ToBase64String($b) + 'a1!') -AsPlainText -Force",
        `Set-LocalUser -Name '${ADMIN_USER}' -Password $s`,
        "[Array]::Clear($b, 0, $b.Length)",
        "Remove-Variable -Name b, r, s",
      ].join("; "),
    ),
    "logoff",
  ]
}

function firstLogonCommands(c: InstallContext): string[] {
  const keysB64 = b64(authorizedKeysText(c.authorizedKeys))
  const ps = encoded
  const cmds = [
    ps("Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0"),
    ps(
      [
        "$d = 'C:\\ProgramData\\ssh'",
        "New-Item -ItemType Directory -Force -Path $d | Out-Null",
        "$f = Join-Path $d 'administrators_authorized_keys'",
        `[IO.File]::WriteAllBytes($f, [Convert]::FromBase64String('${keysB64}'))`,
        "icacls.exe $f /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null",
      ].join("; "),
    ),
  ]
  if (c.disableSshPassword) {
    cmds.push(
      ps(
        "$c = 'C:\\ProgramData\\ssh\\sshd_config'; if (-not (Test-Path $c)) { Start-Service sshd; Stop-Service sshd }; Add-Content -Path $c -Value 'PasswordAuthentication no'",
      ),
    )
  }
  cmds.push(
    ps("Set-Service -Name sshd -StartupType Automatic; Start-Service sshd; New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server' -Protocol TCP -LocalPort 22 -Action Allow -ErrorAction SilentlyContinue | Out-Null"),
    ...cleanupCommands(),
  )
  return cmds
}

export function windowsUnattend(ctx: InstallContext): string {
  const c = validateContext(ctx)
  if (c.hostname.length > 15)
    throw new InstallerInputError("Hostname Windows maksimal 15 karakter (NetBIOS)")
  const mac = windowsMac(c.mac)
  const n = c.network
  const specialize: Node[] = [
    component("Microsoft-Windows-Shell-Setup", [
      el("ComputerName", c.hostname),
      el("TimeZone", "UTC"),
    ]),
  ]
  if (n.mode === "static") {
    specialize.push(
      component("Microsoft-Windows-TCPIP", [
        el("Interfaces", [
          el(
            "Interface",
            [
              el("Ipv4Settings", [el("DhcpEnabled", "false")]),
              el("Identifier", mac),
              el("UnicastIpAddresses", [
                el("IpAddress", `${n.ip}/${n.prefix}`, { "wcm:action": "add", "wcm:keyValue": "1" }),
              ]),
              el("Routes", [
                el(
                  "Route",
                  [el("Identifier", "0"), el("Prefix", "0.0.0.0/0"), el("NextHopAddress", n.gateway)],
                  { "wcm:action": "add" },
                ),
              ]),
            ],
            { "wcm:action": "add" },
          ),
        ]),
      ]),
      component("Microsoft-Windows-DNS-Client", [
        el("Interfaces", [
          el(
            "Interface",
            [
              el("Identifier", mac),
              el(
                "DNSServerSearchOrder",
                n.dns.map((d, i) => el("IpAddress", d, { "wcm:action": "add", "wcm:keyValue": String(i + 1) })),
              ),
            ],
            { "wcm:action": "add" },
          ),
        ]),
      ]),
    )
  }
  const pw = throwawayPassword()
  const oobe = component("Microsoft-Windows-Shell-Setup", [
    el("OOBE", [
      el("HideEULAPage", "true"),
      el("HideOnlineAccountScreens", "true"),
      el("HideWirelessSetupInOOBE", "true"),
      el("ProtectYourPC", "3"),
    ]),
    el("UserAccounts", [
      el("LocalAccounts", [
        el(
          "LocalAccount",
          [
            el("Password", [el("Value", pw), el("PlainText", "true")]),
            el("Group", "Administrators"),
            el("Name", ADMIN_USER),
          ],
          { "wcm:action": "add" },
        ),
      ]),
    ]),
    el("AutoLogon", [
      el("Password", [el("Value", pw), el("PlainText", "true")]),
      el("Enabled", "true"),
      el("LogonCount", "1"),
      el("Username", ADMIN_USER),
    ]),
    el(
      "FirstLogonCommands",
      firstLogonCommands(c).map((cmd, i) =>
        el(
          "SynchronousCommand",
          [el("Order", String(i + 1)), el("CommandLine", cmd), el("Description", `pxe-${i + 1}`)],
          { "wcm:action": "add" },
        ),
      ),
    ),
  ])
  const pass = (name: string, comps: Node[]): Node => ({ tag: "settings", attrs: { pass: name }, children: comps })
  const doc: Node = {
    tag: "unattend",
    attrs: { xmlns: "urn:schemas-microsoft-com:unattend" },
    children: [
      pass("windowsPE", [
        component("Microsoft-Windows-International-Core-WinPE", [
          el("SetupUILanguage", [el("UILanguage", "en-US")]),
          el("InputLocale", "en-US"),
          el("SystemLocale", "en-US"),
          el("UILanguage", "en-US"),
          el("UserLocale", "en-US"),
        ]),
        component("Microsoft-Windows-Setup", [
          el("UserData", [el("AcceptEula", "true")]),
        ]),
      ]),
      pass("specialize", specialize),
      pass("oobeSystem", [oobe]),
    ],
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n${render(doc)}\n`
}
