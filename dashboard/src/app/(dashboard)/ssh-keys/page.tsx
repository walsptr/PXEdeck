import type { Metadata } from "next"

import { SshKeysView } from "@/components/ssh-keys/ssh-keys-view"

export const metadata: Metadata = { title: "SSH Keys" }

export default function Page() {
  return <SshKeysView />
}
