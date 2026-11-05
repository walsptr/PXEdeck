// Unit first-boot `pxe-callback-done.service` (O7): berjalan sekali di OS
// terpasang, mengirim `stage=done`, lalu menghapus dirinya. URL callback
// (berisi token) disimpan di /etc/pxe-callback/url (0600 root) dan ikut
// terhapus. URL itu diturunkan saat runtime dari argumen kernel installer
// (`callbackUrlCmd`), tidak pernah tertulis di perintah yang dicetak installer
// (B-5); konten file lain ditulis lewat base64 (`b64write`).
import { b64write, callbackUrlCmd, shQuote, type CmdlineMethod } from "./shell"

export const FIRSTBOOT_UNIT = "pxe-callback-done.service"
export const FIRSTBOOT_SCRIPT = "/usr/local/sbin/pxe-callback-done"
export const CALLBACK_URL_FILE = "/etc/pxe-callback/url"

export const FIRSTBOOT_UNIT_TEXT = `[Unit]
Description=PXE dashboard: lapor instalasi selesai (sekali jalan)
Wants=network-online.target
After=network-online.target
ConditionPathExists=${CALLBACK_URL_FILE}

[Service]
Type=oneshot
ExecStart=${FIRSTBOOT_SCRIPT}

[Install]
WantedBy=multi-user.target
`

export const FIRSTBOOT_SCRIPT_TEXT = `#!/bin/sh
# Kirim log "OS terpasang" lalu stage=done ke PXE dashboard, kemudian hapus diri (token sekali pakai).
# URL (berisi token) hanya dibaca dari file 0600; tidak pernah dicetak.
url=$(cat ${CALLBACK_URL_FILE}) || exit 1
base=\${url%status}
m="first-boot: OS terpasang boot dari disk: $(hostname) $(ip -4 -o addr show scope global 2>/dev/null | awk '{print $2"="$4}' | tr '\\n' ' ')"
logged=0
i=0
while [ $i -lt 60 ]; do
  if [ $logged -eq 0 ]; then
    printf '%s\\n' "$m" | curl -fsS -m 15 --data-binary @- -H 'Content-Type: text/plain' "\${base}log" >/dev/null 2>&1 && logged=1
  fi
  if curl -fsS -m 15 -X POST -d stage=done "$url" >/dev/null 2>&1 ||
     wget -q -T 15 -O /dev/null --post-data=stage=done "$url" 2>/dev/null; then
    rm -rf /etc/pxe-callback
    systemctl disable ${FIRSTBOOT_UNIT} >/dev/null 2>&1 || true
    rm -f /etc/systemd/system/${FIRSTBOOT_UNIT} ${FIRSTBOOT_SCRIPT}
    exit 0
  fi
  i=$((i + 1))
  sleep 10
done
exit 1
`

/**
 * Perintah sh yang memasang unit first-boot di root `root` ("/target" untuk
 * Ubuntu di luar chroot, "" untuk chroot/%post/in-target). URL callback
 * diturunkan dari argumen kernel installer `method` untuk host `mac`.
 */
export function firstbootInstallCmds(root: string, method: CmdlineMethod, mac: string): string[] {
  if (root !== "" && !/^\/[a-z]+$/.test(root)) throw new Error("root tidak valid")
  const urlFile = `${root}${CALLBACK_URL_FILE}`
  return [
    `mkdir -p ${root}/etc/pxe-callback ${root}/usr/local/sbin ${root}/etc/systemd/system/multi-user.target.wants && chmod 700 ${root}/etc/pxe-callback`,
    `${callbackUrlCmd(method, mac)}; if [ -n "$u" ]; then (umask 077; printf '%s\\n' "$u" > ${urlFile}) && chmod 600 ${urlFile}; fi`,
    b64write(`${root}${FIRSTBOOT_SCRIPT}`, "755", FIRSTBOOT_SCRIPT_TEXT),
    b64write(`${root}/etc/systemd/system/${FIRSTBOOT_UNIT}`, "644", FIRSTBOOT_UNIT_TEXT),
    `ln -sf /etc/systemd/system/${FIRSTBOOT_UNIT} ${root}/etc/systemd/system/multi-user.target.wants/${FIRSTBOOT_UNIT}`,
  ]
}

/** Isi sudoers drop-in (paritas lab: NOPASSWD). */
export function sudoersText(user: string): string {
  return `${user} ALL=(ALL) NOPASSWD:ALL\n`
}

export const SSHD_NO_PASSWORD_TEXT =
  "# Dipasang PXE dashboard: login hanya dengan key\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n"

export function authorizedKeysText(keys: string[]): string {
  return keys.map((k) => `${k}\n`).join("")
}

/** Perintah tulis authorized_keys untuk `user` di root `root` (home /home/user). */
export function authorizedKeysCmds(root: string, user: string, keys: string[]): string[] {
  const dir = `${root}/home/${user}/.ssh`
  return [
    `mkdir -p ${dir} && chmod 700 ${dir}`,
    b64write(`${dir}/authorized_keys`, "600", authorizedKeysText(keys)),
    root === ""
      ? `chown -R ${shQuote(user)}: ${dir}`
      : `chroot ${root} chown -R ${shQuote(user)}: /home/${user}/.ssh`,
  ]
}
