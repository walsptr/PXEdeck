// Peta file konfigurasi per metode instalasi yang boleh dilayani di
// `/boot/{mac}/{token}/{file}`. Windows (unattend) tidak dilayani di M4.
import type { InstallMethod } from "@/lib/os-images"

import type { InstallContext } from "./context"
import { debianPreseed } from "./debian"
import { rockyKickstart } from "./rocky"
import { ubuntuMetaData, ubuntuUserData, ubuntuVendorData } from "./ubuntu"

export type InstallerFile = {
  render: (c: InstallContext) => string
  contentType: string
  /** Fetch pertama file utama → host & job `installing`. */
  primary: boolean
}

const TEXT = "text/plain; charset=utf-8"

export const INSTALLER_FILES: Record<InstallMethod, Record<string, InstallerFile>> = {
  autoinstall: {
    "user-data": { render: ubuntuUserData, contentType: TEXT, primary: true },
    "meta-data": { render: ubuntuMetaData, contentType: TEXT, primary: false },
    "vendor-data": { render: () => ubuntuVendorData(), contentType: TEXT, primary: false },
  },
  preseed: {
    "preseed.cfg": { render: debianPreseed, contentType: TEXT, primary: true },
  },
  kickstart: {
    "ks.cfg": { render: rockyKickstart, contentType: TEXT, primary: true },
  },
  unattend: {},
}

/** File untuk metode, atau null bila tidak dikenal (→ 404). */
export function installerFile(method: InstallMethod, name: string): InstallerFile | null {
  return Object.hasOwn(INSTALLER_FILES[method], name) ? INSTALLER_FILES[method][name] : null
}

export { buildContext, InstallerInputError, validateContext } from "./context"
export type { InstallContext } from "./context"
export { debianLateScript, debianPreseed } from "./debian"
export { rockyKickstart, rockyPostScript } from "./rocky"
export { ubuntuAutoinstall, ubuntuMetaData, ubuntuUserData, ubuntuVendorData } from "./ubuntu"
export { windowsUnattend } from "./windows"
