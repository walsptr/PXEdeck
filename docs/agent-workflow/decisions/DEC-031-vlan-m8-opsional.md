# DEC-031: Uji KVM VLAN M8 tidak lagi menjadi syarat gate
- Tanggal: 2026-11-07
- Milestone: 8
- Status: Accepted
## Konteks
DEC-030 §4 mewajibkan uji KVM mode VLAN untuk installer. Pada 2026-11-07 user memutuskan:
"skip yang vlan, saya ingin make sure saja instalasi berjalan". Keputusan ini sampai ke test-engineer
setelah skenario VLAN iterasi 3 selesai. Hasilnya PASS pada `06517b9` (`.agent/runs/m8/kvm/iter3/vlan/`):
- urutan netplan `70-`/`99-` diterima;
- node sampai Done di VLAN 20;
- uninstall menghapus link `pxe10` dan melepas ISO;
- install ulang berhasil.
## Keputusan
1. Uji KVM VLAN **bukan** syarat gate M8. Gate dinilai dari skenario flat (`kvm/iter3/`).
2. Hasil VLAN iterasi 3 tetap disimpan sebagai informasi (`countedInOverall: false`).
## Konsekuensi
- DEC-030 §4 diamandemen sebatas poin VLAN. Poin lain DEC-030 §4 tetap berlaku.
