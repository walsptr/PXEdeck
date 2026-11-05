// Fixture test bersama (unit, integration, E2E). Hanya PUBLIC key dummy yang dibuat dengan
// `ssh-keygen` di direktori sementara khusus untuk test ini (private key sudah dihapus).
// Fingerprint diharapkan = keluaran `ssh-keygen -lf <file>.pub` (di-hardcode, AC-3.4).
// Bukan bagian kode produk; tidak termasuk include coverage (DEC-004).

export const SSH_ED25519 = {
  publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC7woJ7Ei1SHKHfK8Q8iGXm2/B2KDYvzsi3GFzSPyB+D fixture-ed25519@test",
  fingerprint: "SHA256:PakX2yXWE8EsfsHWakrWM1DF//7xIY7zzqEJAJ5tJdg",
  comment: "fixture-ed25519@test",
}

export const SSH_ED25519_B = {
  publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICU1HfR4aSJlSMWzsLTx5GJ+eXSZtieyKq7UvPVkuonr fixture-ed25519-b@test",
  fingerprint: "SHA256:IFnIN0uINyXdHf2/RqMihlqgrUXRLvnOipbOndt9tv0",
  comment: "fixture-ed25519-b@test",
}

export const SSH_RSA = {
  publicKey: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDBIWU8Di1S2Ka7rfonLAtbAjAd3ERyHKe1Z/XUWJwaHDs2Xz4PWRUQK6QJC5HPNTGx2hmzW41anFKZZA/s8ODpboTt/tyl79VWgAN1YEI+rdXbt7O2bBZaApWAT3VQXrLJnxlT0mQcgpmie5Vu7zaXQ/7oraNKWBOSWvKXi4xcsLW13c0KJ6h68+XR6wNF8UnQB1lr7iWcrl4NznxqXtGdE2QrbRU7jPPpiQAr7mEYj62CtvzT+01KU8AHe+rx/HJi1r2Vk6zBM1cBN8ONqqRsFvl1sY/qG+2t+1zCzUWVLhApABz1GER2pI8XeojNnzXlLRZZVZqab/LN2TR8S9QF fixture-rsa@test",
  fingerprint: "SHA256:s/wbSOxZpO6vK9ErMW37dIUI76MjuMJb3k/NfsDTq00",
  comment: "fixture-rsa@test",
}

export const SSH_ECDSA = {
  publicKey: "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBH05yiMrA2wkt9DoiMkuuzFXqCD9ZGc86Z/+WqzTgh4GsntKT0cjn0y5tT5LFB4BnUF02UFOANZz2+PGaD4QUzY= fixture-ecdsa@test",
  fingerprint: "SHA256:tGtNbP1X+RksP19dZQTf2WS9arMo1SsDTGSaoVgrRRU",
  comment: "fixture-ecdsa@test",
}

/**
 * M4: pengganti key library seed `key-admin-wals` ("Admin workstation", ssh-rsa) — seed M4 tidak
 * lagi membawa key (SR-2-1). E2E menambahkannya lewat API sebagai prasyarat. Public key dummy
 * (`ssh-keygen -t rsa -b 2048`, private key langsung dihapus).
 */
export const SSH_RSA_ADMIN = {
  publicKey: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDilSRp1AWa97WqC/DoNQMd0sDRWz8tWQh1ZugsNAierPzag+ZZ3NOPENjtxm/PlUPsvaxJr9YGTgo6fqdZZRrY/P/H+KQQa9t9jHD509sxUmCiu3hyKtT9jU/oKoDDSO420CDLbRjpdstWUeJdIAJ6QBwBDE9K6Zq+DoUVsyg61WoX2ifSEspX+OSzfcInyqBhCfGLlj3UuKFCle+I6FRC44S4eUv+2savkLXiA5Ud6rpvo0pTD6yEVqVUbqVoZnpUvNMZZrYeMLo9CKa3yNXEu7Aiw9hgni2pi5VyXyTFIwGIM8wHhUUk7x5A29faTktM5iv/y2FaJWjYDAv7/hg1 fixture-rsa-admin@test",
  fingerprint: "SHA256:NxK8TQbbExXCQShJPtJR1PDrdppzMOYRxP2DYnOUGYY",
  comment: "fixture-rsa-admin@test",
}

/** Teks berbentuk private key (header saja, tanpa materi key asli). */
export const FAKE_PRIVATE_KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----"

/** Password dummy untuk test (bukan password sungguhan). */
export const DUMMY_PASSWORD = "Fixture-Pass-7319"
