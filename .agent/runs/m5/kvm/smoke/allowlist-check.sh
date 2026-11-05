#!/bin/bash
# Dijalankan di pxe-test-server (sumber 10.99.0.2, bukan IP admin): /api & UI harus 403, /boot & /media terbuka.
for p in /api/hosts /api/settings /api/jobs /hosts "/api/jobs/job-x/logs"; do
  printf '%-28s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' --interface 10.99.0.2 "http://10.99.0.2$p")"
done
printf '%-28s %s\n' "/boot/52:54:00:99:00:77.ipxe" "$(curl -s -o /dev/null -w '%{http_code}' --interface 10.99.0.2 'http://10.99.0.2/boot/52:54:00:99:00:77.ipxe?platform=efi')"
printf '%-28s %s\n' "HEAD /media/.../vmlinuz" "$(curl -sI -o /dev/null -w '%{http_code}' --interface 10.99.0.2 http://10.99.0.2/media/ubuntu-24.04/casper/vmlinuz)"
