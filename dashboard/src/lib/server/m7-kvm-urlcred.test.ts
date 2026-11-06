// DEC-027 §4 (M7-T11) + DEC-028 §2 (CR-7-2/SR-7-5): scan bukti suite KVM (kvm-harness scanEvidence)
// menandai kredensial di query string mirip URL, termasuk bentuk percent-encoded dan JSON-escaped.
// Hanya token placeholder UTUH yang dikecualikan. Pola selaras dengan infra/redact-evidence.sh
// `_url_cred_hits` (test shell m7-te.sh).
import { describe, expect, it } from "vitest"

import { URL_CRED } from "../../../e2e-kvm/m7-shared"

/** Backslash literal (escape JSON seperti backslash-u0026 dibangun dari sini, bukan ditulis langsung). */
const BS = String.fromCharCode(92)

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

describe("URL_CRED: hanya token placeholder utuh yang dikecualikan (DEC-028 §2, CR-7-2/SR-7-5)", () => {
  it.each([
    // Nilai yang sekadar DIAWALI placeholder/backtick/elipsis = nilai nyata.
    "GET /login?password=***x HTTP/1.1",
    "GET /login?password=****",
    "GET /login?password=`secret` HTTP/1.1",
    "GET /login?username=<REDACTED>x",
    "GET /login?password=<REDACTED>&username=<REDACTED>pxeadmin",
    "GET /login?password=…abc",
    "GET /login?password=<REDACTED password>",
    // Placeholder diikuti backtick penutup kode bukan token utuh lagi (sebelumnya dikecualikan).
    "// bukan `GET /login?username=…&password=…` (komentar kode)",
    "pola (`?password=`/`&username=` bernilai)",
  ])("menandai %s", (line) => {
    expect(URL_CRED.test(line)).toBe(true)
  })
  it.each([
    "GET /login?password=***",
    "GET /login?password=***&username=*** HTTP/1.1",
    "GET /login?username=…&password=… HTTP/1.1",
    'request: "GET /login?username=<REDACTED>&password=<REDACTED-admin-password>"',
    "GET /login?password=&username=",
  ])("tidak menandai %s", (line) => {
    expect(URL_CRED.test(line)).toBe(false)
  })
})

describe("URL_CRED: bentuk ter-encode (DEC-028 §2)", () => {
  it.each([
    "GET /x?next=%2Flogin%3Fpassword%3DSecret1 HTTP/1.1",
    "GET /x?next=%2Flogin%3fPassword%3dSecret1",
    "GET /x?next=%2Flogin%3Fa%3D1%26password%3DSecret1",
    "GET /x?next=%2Flogin%3Fa%3D1%26USERNAME%3Dpxeadmin",
    "GET /x%3Fusername=pxeadmin",
    "GET /login?password%3Dabc",
    "GET /x?next=%2Flogin%3Fpassword%3D%2A%2A%2Ax",
    "GET /x?next=%2Flogin%3Fpassword%3D%3CREDACTED%3Ex",
    `{"url":"http://10.99.0.2/login?username=<REDACTED>${BS}u0026password=abc"}`,
    `{"url":"http://10.99.0.2/login${BS}u003fusername${BS}u003dpxeadmin"}`,
    `{"url":"/login?a=1${BS}u0026PASSWORD=abc"}`,
  ])("menandai %s", (line) => {
    expect(URL_CRED.test(line)).toBe(true)
  })
  it.each([
    "GET /x?next=%2Flogin%3Fpassword%3D%3CREDACTED%3E%26username%3D%2A%2A%2A HTTP/1.1",
    "GET /x?next=%2Flogin%3Fpassword%3D HTTP/1.1",
    "GET /x?next=%2Flogin%3Fpassword%3D%E2%80%A6",
    `{"message":"GET /login?username=<REDACTED>&password=<REDACTED-admin-password>${BS}" 200"}`,
    `{"url":"/login?username=***${BS}u0026password=<REDACTED>"}`,
    `{"url":"/login?username=${BS}u003cREDACTED${BS}u003e${BS}u0026password=***"}`,
    "GET /x?next=%2Fhosts%3Fq%3Dpassword",
  ])("tidak menandai %s", (line) => {
    expect(URL_CRED.test(line)).toBe(false)
  })
})
