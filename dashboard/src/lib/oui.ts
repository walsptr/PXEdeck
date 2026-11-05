// Lookup vendor dari 3 byte pertama MAC (OUI). Daftar kecil untuk vendor
// server/NIC yang umum di lab; MAC lain tampil sebagai "—".
const OUI: Record<string, string> = {
  "52:54:00": "QEMU/KVM",
  "00:50:56": "VMware",
  "00:0c:29": "VMware",
  "08:00:27": "VirtualBox",
  "00:15:5d": "Microsoft Hyper-V",
  "14:18:77": "Dell",
  "f8:bc:12": "Dell",
  "b0:83:fe": "Dell",
  "d0:94:66": "Dell",
  "94:40:c9": "HPE",
  "3c:a8:2a": "HP",
  "0c:c4:7a": "Supermicro",
  "ac:1f:6b": "Supermicro",
  "3c:fd:fe": "Intel",
  "a0:36:9f": "Intel",
  "98:03:9b": "Mellanox",
  "00:10:18": "Broadcom",
}

export function lookupVendor(mac: string): string | null {
  return OUI[mac.toLowerCase().slice(0, 8)] ?? null
}
