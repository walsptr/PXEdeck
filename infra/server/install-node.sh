#!/bin/bash
# Dijalankan di VM pxe-test-server (sebagai root VM, via ssh_root): pasang Node dari tarball resmi.
# Input env: NODE_TARBALL (path di VM, sudah di-scp).
set -euo pipefail
: "${NODE_TARBALL:?}"
rm -rf /opt/node.new
mkdir -p /opt/node.new
tar -xJf "$NODE_TARBALL" -C /opt/node.new --strip-components=1
rm -rf /opt/node
mv /opt/node.new /opt/node
ln -sf /opt/node/bin/node /usr/local/bin/node
ln -sf /opt/node/bin/npm /usr/local/bin/npm
rm -f "$NODE_TARBALL"
node --version
