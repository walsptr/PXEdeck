Verdict: PASS

# Code review M6 (hardening + full E2E), iteration 1

- **Scope:** worktree `.agent/wt-m6`, branch `milestone/6-hardening`, HEAD `4fabdb4`, diff `main...HEAD -- dashboard infra`.
- **Reviewer:** code-reviewer (read-only). Disimpan oleh Orchestrator dari jawaban akhir reviewer tanpa diubah isinya.

## Independent checks
- `npx tsc --noEmit`: exit 0.
- `npm run lint`: clean.
- `vitest run` on `src/lib/server/auth`, `src/app/api/auth`, `m6-auth-matrix`, `auth-next`, `src/lib/server/installers`: 12 files, 453/453 pass.
- **Code drift since the official KVM run:** `git diff 019502a 4fabdb4 -- dashboard infra docs` is empty. The KVM evidence (`kvm/results.json`: core 20/20, bulk 12/12, distro 10/10 PASS, harness exit 0) applies to the code under review.
- **Assertion counts:** recounted for every modified old test file (main vs HEAD; `expect(`, `expect.poll/soft(`, `expectTypeOf(`, `assert_*`, `_fail`). All 33 files are equal or higher; none dropped. No test file was deleted.
- **Skips:** no `.skip`/`.only`/`.todo`/`fixme`/`skipIf` in `dashboard/src`, `e2e`, `e2e-kvm`, `test`.

## Findings

| ID | Severity | File:line | Finding | Concrete failure scenario | Suggested fix |
|---|---|---|---|---|---|
| CR-6-1 | minor | `dashboard/src/lib/server/installers/debian.ts:260-264` (+ `firstboot.ts:86`, `shell.ts:23`) | `preseed/late_command` puts the whole late script in a single `in-target sh -c '…'` argument, base64-encoded twice (`authorized_keys` → b64write inside the script → whole script b64). Size grows about 1.78× per key byte. The golden with one key is already 7,673 chars. Linux caps one argv string at `MAX_ARG_STRLEN` = 131,072 bytes. Validation accepts up to 100 `keyIds` + 20 new keys, each `publicKey` ≤ 16,384 chars. M6 adds hostname, untrust and firstboot to the script, so the margin shrinks. No test bounds the line length. | A host gets about 70 KB of keys (e.g. ~95 RSA-4096 keys, or 5 keys with long comments). The config is accepted. In d-i, `in-target` fails with E2BIG, `late_command` errors, and no configuring/done callback is sent. The job only becomes Failed after `PXE_JOB_INSTALLING_TIMEOUT_MIN`, with no clear cause. | Cap total `authorized_keys` bytes per host in config validation (UI and API, 422 with a message), e.g. ≤ 32 KiB. Make the generator throw `InstallerInputError` when the `late_command` line exceeds ~100 KB. Add a unit test at the maximum allowed config. Alternative: fetch the late script over HTTP with `wget` from `/boot/<mac>/<token>/late.sh`. |
| CR-6-2 | minor | `dashboard/src/lib/server/installers/windows.ts:105-131`, golden `src/test/golden/installers/windows-unattend.xml` | Windows Setup limits `FirstLogonCommands/SynchronousCommand/CommandLine` to 1024 chars. In the golden, the `administrators_authorized_keys` command (pre-existing since M4) is 1,550 chars. The new M6 `cleanupCommands` are 538/830/930, close to the limit. No test checks the length. | Once the image is served: Setup rejects the answer file or truncates the command, so keys are not written. Windows is not served (DEC-017 §8), so the impact is latent. | Split the key write into several commands of ≤ 1024 chars. Add a test `every CommandLine.length <= 1024` with several RSA keys. |
| CR-6-3 | minor | `dashboard/src/lib/server/installers/context.ts:58`, `debian.ts:160,191,212,221`; test `m6-smoke-fixes.test.ts:475` | `mediaSigned` is not set by any production code path (only in tests). It is always false, so `[trusted=yes]` is used for every Debian image. This matches DEC-021 for local DVD media, but the "signed" path is dead code. If ever enabled, `debian-installer/allow_unauthenticated true` (line 212) stays unconditional while `DEBIAN_UNTRUST_CMD`, which also deletes `00AllowUnauthenticated`, is skipped. The test at line 475 locks in that behaviour. | An image later marked `mediaSigned: true` → target installed with apt allowed to accept unauthenticated packages, `00AllowUnauthenticated` not cleaned up. Contradicts the spirit of DEC-021 §2. | Either remove `mediaSigned` (YAGNI) or wire it from OS image metadata; when true, also set `allow_unauthenticated false`, and test that the target has no `AllowUnauthenticated`. |
| CR-6-4 | minor | `dashboard/src/lib/server/installers/m5-te-hooks.test.ts:213-223` | The M5 test changed from exact `toEqual([[LOG_URL, start]])` to "first call exact + loop over the remaining calls". The loop passes with zero calls (can be vacuous), and the result depends on the test host's `/sys/module`. `runSh` runs the generated early_command against the real `/usr/bin`: `modprobe`, `insmod /tmp/virtio_*.ko`, `udevadm settle --timeout=15` (up to 15 s vs a 20 s timeout). Run as root it would load kernel modules on the host. Assertion count does not drop and there is deterministic coverage in `m6-smoke-fixes.test.ts:323-372`, so not weakening of a critical class; a test-quality/flakiness risk. | (a) Host with `virtio_blk` already loaded → different call set, test passes but proves nothing. (b) Slow host → `udevadm settle` near the 20 s timeout → intermittent red. (c) Under root → `modprobe virtio*` on the host. | In `runSh`, stub `modprobe`/`insmod`/`udevadm`/`uname` in `bin` and redirect `/sys/module` (seam already used in `m6-smoke-fixes`). Return to exact `toEqual` of the expected call list. |
| CR-6-5 | info | `dashboard/src/lib/server/boot-http.ts:41` | `BootDeniedPath` variant `"ipxe"` is never logged; `logBootDenied` is only called from `file`/`log`/`status` routes. | No failure; dead type variant, plan/code mismatch for SR-5-3 auditors. | Remove `"ipxe"` from the type, or log iPXE denials through the same throttle, with a test. |
| CR-6-6 | info | `dashboard/src/lib/server/auth/login-service.ts:341`, `request-ip.ts:9-13` | IP unknown (`PXE_TRUST_PROXY=0` or non-IPv4 `X-Real-IP`) → all clients share key `login-ip:unknown` (20 failures / 15 min). Follows plan §2.4, but without nginx one actor can lock out all admins for 15 minutes. | `npm start` without proxy: 20 failed logins → valid admin gets 429 until window ends. | Document (single-user lab assumption) or add a startup warning when `trustProxy=false` and `NODE_ENV=production`. |
| CR-6-7 | info | `dashboard/src/app/api/auth/logout/route.ts:9-11` | Logout with expired/invalid session → `guardMutation` 401 without `Set-Cookie: Max-Age=0`; stale cookie stays. | Harmless; extra proxy round-trip and DB lookup. | Attach `clearSessionCookieHeader()` to a session-caused 401 on logout. |
| CR-6-8 | info | `dashboard/src/app/api/auth/session/route.ts:13-16`, `app/api/jobs/[id]/logs/route.ts:34-35` | `guardRead` validates the session, then `currentSession` reads the DB again: two queries per request. | No functional failure; extra SQLite load under 5 s polling. | Have `guardRead` return the session for reuse. |

## Notes per focus area (no findings unless listed above)

### 1. Auth
- **Session lifecycle:** 32 B id, sha256 stored, format checked before any DB query; validation covers absolute expiry, idle, `cred_fp`, active username; invalid session deleted on detection; `pruneSessions` in the watchdog; throttled touch `min(60 s, idle/2)` acceptable per DEC-019 §1; old session destroyed at login (fixation covered).
- **Cookie:** `HttpOnly; SameSite=Strict; Path=/; Max-Age`; `Secure` when base URL is https.
- **Guards:** session checked after Host/Origin/CT; only `session:false` exception is login.
- **`proxy.ts`:** optimistic format check, matcher excludes `api`/`boot`/`_next`/`login`; `SessionGate` second layer with `connection()`; `x-pxe-path` overwritten and sanitised.
- **`safeNextPath`:** rejects `//`, `/\`, whitespace/control chars, `/login*`, > 2048 chars.

### 2. Rate limit
Attempts recorded synchronously before `await` scrypt (races closed); lockout 429 even for correct password; success clears (ip,user) and unrecords per-IP; `peek` `retryAfter` correct; memory bounded (`MAX_KEYS` + sweep); API limit per session `idHash`.

### 3. `/boot` throttle
20 detail lines per window per path; summary count only, via `unref` timer or next call; `dispose`/`reset` for tests. Correct.

### 4. Start guard
Production without admin, invalid hash, or `INSECURE` without confirm phrase → settings throw → start rejected; messages never contain the hash; process test runs standalone `server.js`.

### 5. Generators
- **Debian:** both `early_command`s pass `sh -n`; DEC-021 hook disables `50mirror`, source from `local0` with `[trusted=yes by-hash=no]`; untrust verified over SSH in distro run (`trusted_files=0`). Size risk = CR-6-1.
- **Rocky:** `%pre --erroronfail` + `%include` prevents `clearpart` on all disks in auto mode; stage2 over NFS; `console=ttyS` moved last.
- **Windows:** no token/URL; cleanup order correct. Length issue = CR-6-2.

### 6. Redaction
4 display views + match view, marks merged per raw character; no leak path found beyond documented residual risks; 16 KB perf thresholds kept.

### 7. `infra/kvm-run.sh` BUG-M6-10
Fix correct (`verify_partial_suffix` returns 0, `verify_one` ends `return 0`, clamp via `if/elif`); no remaining `$( ((…)) && …)` without `||`; loop `&&` lists safe under `set -e`; `m6-bug10.sh` covers the non-dry path with fake ssh.

### 8. Frontend
`apiFetch` 401 halts once with full redirect to `/login?next=`; 429 holds until `Retry-After` (cap 3600 s); TanStack does not retry 401/429; `JobLogClient` final states; login form uniform 401 text, 429 minutes, Alert focus; logout clears cache then `location.replace`; bfcache restore reloads.

### Test quality
No test skipped, deleted, or with reduced assertion count. Behaviour changes to old tests all justified in `test-migration.md` as tightenings or plan-driven. Only weaker spot: CR-6-4.

## Summary per severity
| Severity | Count |
|---|---|
| critical | 0 |
| major | 0 |
| minor | 4 (CR-6-1, CR-6-2, CR-6-3, CR-6-4) |
| info | 4 (CR-6-5, CR-6-6, CR-6-7, CR-6-8) |

No critical or major findings open. CR-6-1 and CR-6-2 are latent limits at the edge of valid input (CR-6-2: Windows not served). Fix, or carry over explicitly in REPORT-final.
