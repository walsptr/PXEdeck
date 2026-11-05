#!/usr/bin/env python3
"""PreToolUse guard for Bash — lapisan kedua untuk batas keras (CLAUDE.md §Batas keras).

Membaca JSON hook dari stdin. Exit 2 + pesan di stderr = perintah ditolak.
Aturan:
  - tanpa sudo / su / pkexec / doas
  - tanpa git push (termasuk --force)
  - tanpa akses block device host (/dev/sd*, /dev/nvme*, /dev/vd* host, /dev/mapper)
  - tanpa membaca ~/.ssh atau file secret di luar project
  - tanpa rm -rf ke / atau path di luar project
  - tanpa mengubah interface fisik (ip link/addr/route set, brctl, nmcli, ifconfig)
  - virsh/virt-install: hanya resource berprefix pxe-test-; VM lama pxe-test-node01,
    network default/int, dan VM ubuntu24.04 dilindungi
  - curl/wget hanya ke host di allowlist
  - ssh/scp hanya ke 10.99.0.* dengan key di .agent/keys/
"""
import json
import os
import re
import shlex
import sys

PROJECT = os.environ.get("CLAUDE_PROJECT_DIR", "/home/syawal/Project/PXE-BOOT")
HOME = os.path.expanduser("~")

# Resource libvirt milik user di luar project — tidak boleh disentuh sama sekali.
PROTECTED_NAMES = {"pxe-test-node01", "ubuntu24.04", "default", "int"}

ALLOWED_HOSTS = [
    r"localhost", r"127\.0\.0\.1", r"10\.99\.0\.\d{1,3}",
    r"registry\.npmjs\.org", r"registry\.yarnpkg\.com",
    r"releases\.ubuntu\.com", r"cloud-images\.ubuntu\.com", r"archive\.ubuntu\.com",
    r"security\.ubuntu\.com", r"cdimage\.ubuntu\.com",
    r"deb\.debian\.org", r"cdimage\.debian\.org", r"cloud\.debian\.org",
    r"download\.rockylinux\.org", r"dl\.rockylinux\.org",
    r"nodejs\.org",
    r"cdn\.playwright\.dev", r"playwright\.download\.prss\.microsoft\.com",
    r"playwright\.azureedge\.net",
]
HOST_RE = re.compile(r"^(?:%s)$" % "|".join(ALLOWED_HOSTS))

VIRSH_MUTATING = {
    "destroy", "undefine", "start", "shutdown", "reboot", "reset", "create", "define",
    "suspend", "resume", "edit", "setmem", "setvcpus", "attach-device", "detach-device",
    "attach-interface", "detach-interface", "attach-disk", "detach-disk", "autostart",
    "domif-setlink", "update-device", "managedsave", "snapshot-create", "snapshot-create-as",
    "snapshot-delete", "snapshot-revert", "console", "send-key",
    "net-destroy", "net-undefine", "net-start", "net-define", "net-create", "net-edit",
    "net-autostart", "net-update",
    "vol-create", "vol-create-as", "vol-delete", "vol-upload", "vol-wipe",
    "pool-destroy", "pool-undefine", "pool-delete",
}


def deny(msg: str) -> None:
    print(f"DITOLAK guard_bash: {msg}", file=sys.stderr)
    sys.exit(2)


def segments(cmd: str):
    """Pecah perintah jadi sub-perintah (;, &&, ||, |, newline, $( ), backtick)."""
    flat = re.sub(r"\$\(|`|\)", " ; ", cmd)
    for seg in re.split(r";|&&|\|\||\||\n", flat):
        seg = seg.strip()
        if not seg:
            continue
        try:
            toks = shlex.split(seg, posix=True)
        except ValueError:
            toks = seg.split()
        # buang prefix env VAR=... dan wrapper umum
        while toks and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[0]) or toks[0] in ("env", "time", "nice", "timeout", "nohup", "exec", "command")):
            if toks[0] == "timeout" and len(toks) > 1:
                toks = toks[2:]
            else:
                toks = toks[1:]
        if toks:
            yield toks


def under_project(path: str) -> bool:
    p = os.path.realpath(os.path.expanduser(path))
    return p == PROJECT or p.startswith(PROJECT + os.sep) or p.startswith("/tmp/claude-")


HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n(.*?)\n\s*\2\s*(?=\n|$)", re.S)


def strip_heredocs(cmd: str) -> str:
    """Isi heredoc adalah data (mis. isi file laporan), bukan perintah."""
    return HEREDOC_RE.sub(lambda m: m.group(0).split("\n", 1)[0] + "\n", cmd)


def check(cmd: str) -> None:
    cmd = strip_heredocs(cmd)
    low = cmd.lower()

    # Block device host & secret, cek mentah di seluruh string.
    if re.search(r"/dev/(sd[a-z]|nvme\d|mapper/|disk/by-)", cmd):
        deny("akses block device host dilarang")
    if re.search(r"(~|\$home|%s)/\.ssh(/|\b)" % re.escape(HOME), low):
        deny("membaca/menulis ~/.ssh dilarang; pakai .agent/keys/")
    if re.search(r"(^|[\s;&|])(\.env|\.netrc|\.aws/|\.gnupg/)", cmd) and not re.search(r"\.env\.example", cmd):
        # .env di dalam project boleh dibaca hanya .env.example
        if re.search(r"(~|%s)/(\.netrc|\.aws|\.gnupg)" % re.escape(HOME), cmd):
            deny("file secret di luar project dilarang")

    # Mutasi massal libvirt (loop/xargs atas hasil `virsh list`) tidak bisa diperiksa per nama.
    if re.search(r"virsh", cmd) and re.search(r"\b(destroy|undefine|shutdown|reboot|reset)\b", cmd) and re.search(r"(xargs|while\s+read|for\s+\w+\s+in\s+\$\(\s*virsh|list\s+--name|list\s+--all\s*\|)", cmd):
        deny("mutasi libvirt massal (loop/xargs atas virsh list) dilarang; sebut nama pxe-test-* secara eksplisit")

    for toks in segments(cmd):
        prog = os.path.basename(toks[0])
        args = toks[1:]

        if prog in ("sudo", "su", "pkexec", "doas", "run0"):
            deny("sudo/eskalasi hak akses dilarang untuk semua agent")

        if prog == "git" and "push" in args:
            deny("git push dilarang; merge hanya ke main lokal")

        if prog == "rm" and any(a.startswith("-") and ("r" in a or "R" in a) for a in args):
            targets = [a for a in args if not a.startswith("-")]
            for t in targets:
                if t in ("/", "/*", "~", "~/", "$HOME") or not under_project(t):
                    deny(f"rm -r di luar direktori project: {t}")

        if prog in ("dd", "mkfs", "wipefs", "fdisk", "sfdisk", "parted", "sgdisk", "mkswap") or prog.startswith("mkfs."):
            if not all(under_project(a.split("=", 1)[-1]) for a in args if "/" in a):
                deny(f"{prog} terhadap path di luar project dilarang")

        if prog == "ip" and len(args) >= 2 and args[0] in ("link", "l", "addr", "a", "address", "route", "r", "tuntap") and args[1] in ("set", "add", "del", "delete", "change", "replace", "flush"):
            deny("mengubah interface/route host dilarang")
        if prog in ("brctl", "nmcli", "ifconfig", "ifup", "ifdown", "iptables", "nft", "firewall-cmd", "ethtool", "tc"):
            if prog == "nmcli" and args[:1] in (["-t"], ["general"], ["device"]) and "status" in args:
                continue
            if prog == "firewall-cmd" and all(a.startswith("--get") or a.startswith("--list") or a.startswith("--zone") or a == "--state" for a in args):
                continue
            deny(f"{prog} dilarang (jaringan host tidak boleh diubah)")

        if prog == "systemctl" and any(a in ("start", "stop", "restart", "enable", "disable", "mask", "reload") for a in args) and "--user" not in args:
            deny("systemctl level sistem dilarang")

        if prog == "dnsmasq":
            deny("dnsmasq tidak boleh dijalankan di host; jalankan di dalam VM pxe-test-server")

        if prog in ("virsh", "virt-install", "virt-clone", "virt-xml"):
            check_virt(prog, args)

        if prog in ("curl", "wget"):
            for a in args:
                m = re.match(r"^(?:https?|ftp)://([^/:@\s]+@)?([^/:\s]+)", a)
                if m and not HOST_RE.match(m.group(2)):
                    deny(f"{prog} ke host di luar allowlist: {m.group(2)}")

        if prog in ("ssh", "scp", "sftp", "rsync"):
            check_ssh(prog, args)


def check_virt(prog: str, args) -> None:
    for a in args:
        if a in PROTECTED_NAMES or a.split(",")[0] in PROTECTED_NAMES:
            deny(f"resource libvirt '{a}' milik user dan dilindungi")
        m = re.search(r"(?:network|source)=([A-Za-z0-9_.-]+)", a)
        if m and not m.group(1).startswith("pxe-test"):
            deny(f"network '{m.group(1)}' bukan resource pxe-test-")
    if prog == "virt-install" or prog == "virt-clone":
        names = [args[i + 1] for i, a in enumerate(args) if a in ("--name", "-n") and i + 1 < len(args)]
        names += [a.split("=", 1)[1] for a in args if a.startswith("--name=")]
        for n in names:
            if not n.startswith("pxe-test-"):
                deny(f"nama VM harus berprefix pxe-test-: {n}")
        return
    if prog == "virt-xml":
        if args and not args[0].startswith("pxe-test-"):
            deny("virt-xml hanya untuk VM pxe-test-")
        return
    # virsh [-c uri] <sub> <target> ...
    rest = list(args)
    while rest and rest[0].startswith("-"):
        rest = rest[2:] if rest[0] in ("-c", "--connect") else rest[1:]
    if not rest:
        return
    sub, targets = rest[0], [t for t in rest[1:] if not t.startswith("-")]
    if sub in VIRSH_MUTATING:
        if sub in ("define", "create", "net-define", "net-create"):
            for t in targets:
                if not under_project(t):
                    deny("file XML libvirt harus berada di dalam project")
            return
        if not targets:
            deny(f"virsh {sub} tanpa target eksplisit")
        if not targets[0].startswith("pxe-test-") and not (sub.startswith("vol-") and "pxe-test-" in " ".join(targets)):
            deny(f"virsh {sub} hanya boleh untuk resource berprefix pxe-test-: {targets[0]}")


def check_ssh(prog: str, args) -> None:
    hosts = []
    for a in args:
        m = re.match(r"^(?:[^@\s]+@)?(\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z][A-Za-z0-9.-]*)(?::.*)?$", a)
        if m and ("@" in a or (prog in ("scp", "rsync") and ":" in a)):
            hosts.append(m.group(1))
    for h in hosts:
        if not re.match(r"^10\.99\.0\.\d{1,3}$", h):
            deny(f"{prog} hanya ke 10.99.0.*: {h}")
    if hosts:
        keys = [args[i + 1] for i, a in enumerate(args) if a == "-i" and i + 1 < len(args)]
        if not keys or not all(".agent/keys/" in k for k in keys):
            deny(f"{prog} wajib memakai key di .agent/keys/ (-i)")


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if data.get("tool_name") != "Bash":
        sys.exit(0)
    cmd = (data.get("tool_input") or {}).get("command") or ""
    check(cmd)
    sys.exit(0)


if __name__ == "__main__":
    main()
