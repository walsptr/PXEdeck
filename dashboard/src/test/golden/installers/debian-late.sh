#!/bin/sh
set -e
curl -fsS -m 15 --retry 5 --retry-delay 3 -X POST -d stage=configuring 'http://10.99.0.2/boot/52:54:00:99:00:11/FIXTURE-token-not-real_0000000000000000000/status' >/dev/null 2>&1 || wget -q -T 15 -O /dev/null --post-data=stage=configuring 'http://10.99.0.2/boot/52:54:00:99:00:11/FIXTURE-token-not-real_0000000000000000000/status' || true
mkdir -p /home/ops/.ssh && chmod 700 /home/ops/.ssh
printf %s 'c3NoLWVkMjU1MTkgQUFBQUMzTnphQzFsWkRJMU5URTVBQUFBSUM3d29KN0VpMVNIS0hmSzhROGlHWG0yL0IyS0RZdnpzaTNHRnpTUHlCK0QgZml4dHVyZS1lZDI1NTE5QHRlc3QKc3NoLWVkMjU1MTkgQUFBQUMzTnphQzFsWkRJMU5URTVBQUFBSUNVMUhmUjRhU0psU01XenNMVHg1R0orZVhTWnRpZXlLcTdVdlBWa3VvbnIgZml4dHVyZS1lZDI1NTE5LWJAdGVzdAo=' | base64 -d > /home/ops/.ssh/authorized_keys && chmod 600 /home/ops/.ssh/authorized_keys
chown -R 'ops': /home/ops/.ssh
printf %s 'b3BzIEFMTD0oQUxMKSBOT1BBU1NXRDpBTEwK' | base64 -d > /etc/sudoers.d/90-ops && chmod 440 /etc/sudoers.d/90-ops
mkdir -p /etc/ssh/sshd_config.d
printf %s 'IyBEaXBhc2FuZyBQWEUgZGFzaGJvYXJkOiBsb2dpbiBoYW55YSBkZW5nYW4ga2V5ClBhc3N3b3JkQXV0aGVudGljYXRpb24gbm8KS2JkSW50ZXJhY3RpdmVBdXRoZW50aWNhdGlvbiBubwo=' | base64 -d > /etc/ssh/sshd_config.d/60-pxe-no-password.conf && chmod 644 /etc/ssh/sshd_config.d/60-pxe-no-password.conf
IF=
for d in /sys/class/net/*; do
  [ "$(cat "$d/address" 2>/dev/null)" = '52:54:00:99:00:11' ] && IF=$(basename "$d")
done
[ -n "$IF" ] || IF=$(ip -o link | awk -F': ' '$2 != "lo" {print $2; exit}')
printf %s 'YXV0byBsbwppZmFjZSBsbyBpbmV0IGxvb3BiYWNrCgpzb3VyY2UgL2V0Yy9uZXR3b3JrL2ludGVyZmFjZXMuZC8qCg==' | base64 -d > /etc/network/interfaces && chmod 644 /etc/network/interfaces
mkdir -p /etc/network/interfaces.d
printf %s 'YXV0byAkSUYKaWZhY2UgJElGIGluZXQgc3RhdGljCiAgICBhZGRyZXNzIDEwLjk5LjAuMjEvMjQKICAgIG5ldG1hc2sgMjU1LjI1NS4yNTUuMAogICAgZ2F0ZXdheSAxMC45OS4wLjEKICAgIGRucy1uYW1lc2VydmVycyAxMC45OS4wLjIK' | base64 -d | sed "s/\$IF/$IF/g" > /etc/network/interfaces.d/mgmt
mkdir -p /etc/pxe-callback /usr/local/sbin /etc/systemd/system/multi-user.target.wants && chmod 700 /etc/pxe-callback
printf %s 'aHR0cDovLzEwLjk5LjAuMi9ib290LzUyOjU0OjAwOjk5OjAwOjExL0ZJWFRVUkUtdG9rZW4tbm90LXJlYWxfMDAwMDAwMDAwMDAwMDAwMDAwMC9zdGF0dXMK' | base64 -d > /etc/pxe-callback/url && chmod 600 /etc/pxe-callback/url
printf %s 'IyEvYmluL3NoCiMgS2lyaW0gc3RhZ2U9ZG9uZSBrZSBQWEUgZGFzaGJvYXJkIGxhbHUgaGFwdXMgZGlyaSAodG9rZW4gc2VrYWxpIHBha2FpKS4KdXJsPSQoY2F0IC9ldGMvcHhlLWNhbGxiYWNrL3VybCkgfHwgZXhpdCAxCmk9MAp3aGlsZSBbICRpIC1sdCA2MCBdOyBkbwogIGlmIGN1cmwgLWZzUyAtbSAxNSAtWCBQT1NUIC1kIHN0YWdlPWRvbmUgIiR1cmwiID4vZGV2L251bGwgMj4mMSB8fAogICAgIHdnZXQgLXEgLVQgMTUgLU8gL2Rldi9udWxsIC0tcG9zdC1kYXRhPXN0YWdlPWRvbmUgIiR1cmwiIDI+L2Rldi9udWxsOyB0aGVuCiAgICBybSAtcmYgL2V0Yy9weGUtY2FsbGJhY2sKICAgIHN5c3RlbWN0bCBkaXNhYmxlIHB4ZS1jYWxsYmFjay1kb25lLnNlcnZpY2UgPi9kZXYvbnVsbCAyPiYxIHx8IHRydWUKICAgIHJtIC1mIC9ldGMvc3lzdGVtZC9zeXN0ZW0vcHhlLWNhbGxiYWNrLWRvbmUuc2VydmljZSAvdXNyL2xvY2FsL3NiaW4vcHhlLWNhbGxiYWNrLWRvbmUKICAgIGV4aXQgMAogIGZpCiAgaT0kKChpICsgMSkpCiAgc2xlZXAgMTAKZG9uZQpleGl0IDEK' | base64 -d > /usr/local/sbin/pxe-callback-done && chmod 755 /usr/local/sbin/pxe-callback-done
printf %s 'W1VuaXRdCkRlc2NyaXB0aW9uPVBYRSBkYXNoYm9hcmQ6IGxhcG9yIGluc3RhbGFzaSBzZWxlc2FpIChzZWthbGkgamFsYW4pCldhbnRzPW5ldHdvcmstb25saW5lLnRhcmdldApBZnRlcj1uZXR3b3JrLW9ubGluZS50YXJnZXQKQ29uZGl0aW9uUGF0aEV4aXN0cz0vZXRjL3B4ZS1jYWxsYmFjay91cmwKCltTZXJ2aWNlXQpUeXBlPW9uZXNob3QKRXhlY1N0YXJ0PS91c3IvbG9jYWwvc2Jpbi9weGUtY2FsbGJhY2stZG9uZQoKW0luc3RhbGxdCldhbnRlZEJ5PW11bHRpLXVzZXIudGFyZ2V0Cg==' | base64 -d > /etc/systemd/system/pxe-callback-done.service && chmod 644 /etc/systemd/system/pxe-callback-done.service
ln -sf /etc/systemd/system/pxe-callback-done.service /etc/systemd/system/multi-user.target.wants/pxe-callback-done.service
