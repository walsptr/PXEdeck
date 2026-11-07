#!/usr/bin/env python3
"""deploy/dhcp-probe.py — deteksi DHCP server lain di segmen NIC provisioning (M8, DEC-029 §2).

Mengirim DHCPDISCOVER (broadcast, flag broadcast) lewat satu NIC (SO_BINDTODEVICE) lalu menunggu
DHCPOFFER selama --timeout detik. Offer dari alamat server ini sendiri (--ignore, mis. dnsmasq milik
instalasi sebelumnya) diabaikan. Tidak pernah menerima/meminta lease (tidak ada DHCPREQUEST).

Pakai (root):  python3 -I dhcp-probe.py --iface eth1 [--timeout 6] [--ignore 10.10.10.1 ...]
               python3 -I dhcp-probe.py --selftest
Keluaran: satu baris "OFFER server=<ip> yiaddr=<ip>" per offer asing.
Exit: 0 tidak ada DHCP lain · 1 DHCP lain terdeteksi · 2 probe tidak bisa dijalankan.
"""
import argparse
import os
import random
import select
import socket
import struct
import sys
import time

MAGIC = b"\x63\x82\x53\x63"


def build_discover(xid: int, mac: bytes) -> bytes:
    hdr = struct.pack("!BBBBIHH4s4s4s4s16s64s128s", 1, 1, 6, 0, xid, 0, 0x8000,
                      b"\0" * 4, b"\0" * 4, b"\0" * 4, b"\0" * 4, mac.ljust(16, b"\0"), b"", b"")
    opts = bytes([53, 1, 1]) + bytes([55, 4, 1, 3, 6, 54]) + bytes([61, 7, 1]) + mac + bytes([255])
    return hdr + MAGIC + opts


def parse_reply(data: bytes, xid: int):
    """Kembalikan (msgtype, server_id, yiaddr) untuk balasan BOOTREPLY dengan xid ini, atau None."""
    if len(data) < 240 or data[0] != 2 or data[236:240] != MAGIC:
        return None
    if struct.unpack("!I", data[4:8])[0] != xid:
        return None
    yiaddr = socket.inet_ntoa(data[16:20])
    siaddr = socket.inet_ntoa(data[20:24])
    msgtype, server_id, i = None, None, 240
    while i < len(data):
        code = data[i]
        if code == 255:
            break
        if code == 0:
            i += 1
            continue
        if i + 1 >= len(data):
            break
        ln = data[i + 1]
        val = data[i + 2:i + 2 + ln]
        if code == 53 and ln == 1:
            msgtype = val[0]
        elif code == 54 and ln == 4:
            server_id = socket.inet_ntoa(val)
        i += 2 + ln
    return msgtype, server_id or siaddr, yiaddr


def iface_mac(iface: str) -> bytes:
    with open(f"/sys/class/net/{iface}/address", encoding="ascii") as f:
        return bytes.fromhex(f.read().strip().replace(":", ""))


def selftest() -> int:
    mac = bytes.fromhex("525400990011")
    pkt = build_discover(0x1234ABCD, mac)
    assert len(pkt) >= 240 and pkt[236:240] == MAGIC and pkt[0] == 1
    assert pkt[28:34] == mac and pkt[10:12] == b"\x80\x00"
    offer = bytearray(pkt)
    offer[0] = 2
    offer[16:20] = socket.inet_aton("10.0.0.50")
    offer[240:] = bytes([53, 1, 2, 54, 4]) + socket.inet_aton("10.0.0.9") + bytes([255])
    assert parse_reply(bytes(offer), 0x1234ABCD) == (2, "10.0.0.9", "10.0.0.50")
    assert parse_reply(bytes(offer), 0x1) is None
    assert parse_reply(b"\x02" * 100, 0x1234ABCD) is None
    print("selftest ok")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--iface")
    ap.add_argument("--timeout", type=float, default=6.0)
    ap.add_argument("--ignore", action="append", default=[])
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.iface or not all(c.isalnum() or c in "._-" for c in a.iface) or len(a.iface) > 15:
        print("dhcp-probe: --iface tidak valid", file=sys.stderr)
        return 2
    try:
        mac = iface_mac(a.iface)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, a.iface.encode() + b"\0")
        s.bind(("", 68))
    except OSError as e:
        print(f"dhcp-probe: tidak bisa membuka socket DHCP di {a.iface}: {e}", file=sys.stderr)
        return 2
    xid = random.SystemRandom().getrandbits(32)
    pkt = build_discover(xid, mac)
    found = {}
    end = time.monotonic() + a.timeout
    next_send = 0.0
    while True:
        now = time.monotonic()
        if now >= end:
            break
        if now >= next_send:
            try:
                s.sendto(pkt, ("255.255.255.255", 67))
            except OSError as e:
                print(f"dhcp-probe: gagal mengirim DISCOVER: {e}", file=sys.stderr)
                return 2
            next_send = now + max(a.timeout / 3, 1.0)
        r, _, _ = select.select([s], [], [], min(end, next_send) - now)
        if not r:
            continue
        data, _ = s.recvfrom(4096)
        res = parse_reply(data, xid)
        if res and res[0] == 2 and res[1] not in a.ignore:
            found[res[1]] = res[2]
    for srv, yi in sorted(found.items()):
        print(f"OFFER server={srv} yiaddr={yi}")
    return 1 if found else 0


if __name__ == "__main__":
    os.umask(0o077)
    sys.exit(main())
