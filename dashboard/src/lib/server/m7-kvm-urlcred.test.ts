// DEC-027 §4 (M7-T11): scan bukti suite KVM (kvm-harness scanEvidence) menandai kredensial di query
// string mirip URL. Pola sama dengan infra/redact-evidence.sh URL_CRED_RE (test shell m7-te.sh).
import { describe, expect, it } from "vitest"

import { URL_CRED } from "../../../e2e-kvm/m7-shared"

describe("URL_CRED (scan bukti KVM, DEC-027 §4)", () => {
  it.each([
    '10.99.0.1 [t] "GET /login?username=pxeadmin&password=NVMxx" 200',
    "GET /login?password=abc HTTP/1.1",
    "Received string:  \"http://10.99.0.2/login?username=pxeadmin\"",
    "GET /x?next=%2F&PASSWORD=Secret1",
  ])("menandai %s", (line) => {
    expect(URL_CRED.test(line)).toBe(true)
  })
  it.each([
    '10.99.0.1 [t] "GET /login?***" 200',
    "GET /login?username=<REDACTED>&password=<REDACTED-admin-password>",
    "GET /login?password= 200",
    "d-i passwd/user-password-crypted password $6$REDACTED",
    "password: $6$REDACTED",
    "GET /boot/52:54:00:99:00:31.ipxe?platform=efi",
  ])("tidak menandai %s", (line) => {
    expect(URL_CRED.test(line)).toBe(false)
  })
})
